import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CategoryKind } from '@pfm/shared-types';
import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/config/app-config';
import { DatabaseService } from '../src/database/database.service';
import {
  DATABASE_EXECUTOR,
  DatabaseExecutor,
  DbTransactionClient,
  QueryResultLike,
} from '../src/database/database.types';
import { configureHttpApp } from '../src/main';
import {
  ATTACHMENT_STORAGE_DIR,
} from '../src/modules/attachments/local-attachment.storage';
import {
  decodeAndValidateAttachmentBase64,
  detectAllowedAttachmentType,
  MAX_ATTACHMENT_BYTES,
  sanitizeAttachmentFilename,
} from '../src/modules/attachments/magic-bytes';
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpCode,
  verifyTotpCode,
} from '../src/modules/mfa/totp.crypto';
import { TEST_APP_CONFIG } from './helpers/in-memory-backend';
import { createFullHttpTestApp } from './helpers/test-app';

const MIGRATION_001_PATH = path.resolve(
  __dirname,
  '../../database/migrations/001_initial_schema.sql',
);
const MIGRATION_002_PATH = path.resolve(
  __dirname,
  '../../database/migrations/002_phase2_mfa_and_attachments.sql',
);
const WORKER_PATH = path.resolve(__dirname, './helpers/pglite-worker.cjs');

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const VALID_JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const VALID_PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'utf8');
const DISGUISED_EXE_BYTES = Buffer.concat([Buffer.from('MZ'), Buffer.from([0x90, 0x00, 0x03, 0x00])]);
const DISGUISED_SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
const DISGUISED_HTML_BYTES = Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf8');

interface PgErrorLike extends Error {
  code?: string;
  constraint?: string;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: {
    name?: string;
    message: string;
    code?: string;
    constraint?: string;
  };
}

class PGliteWorkerExecutor implements DatabaseExecutor {
  private readonly worker: Worker;
  private nextMsgId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  public constructor() {
    this.worker = new Worker(WORKER_PATH);
    this.worker.on('message', (msg: WorkerResponse) => {
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        waiter.resolve(msg.result);
      } else {
        const err = new Error(msg.error?.message ?? 'Unknown PGlite worker error') as PgErrorLike;
        if (msg.error) {
          err.name = msg.error.name ?? 'DatabaseError';
          err.code = msg.error.code;
          err.constraint = msg.error.constraint;
        }
        waiter.reject(err);
      }
    });
    this.worker.on('error', (err) => {
      for (const waiter of this.pending.values()) {
        waiter.reject(err);
      }
      this.pending.clear();
    });
  }

  private call<T = unknown>(payload: Record<string, unknown>): Promise<T> {
    const id = this.nextMsgId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.worker.postMessage({ id, ...payload });
    });
  }

  public async init(): Promise<void> {
    await this.call({ type: 'init' });
  }

  public async exec(sql: string): Promise<void> {
    await this.call({ type: 'exec', sql });
  }

  public async query<R = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResultLike<R>> {
    return this.call<QueryResultLike<R>>({
      type: 'query',
      text,
      params: params ? [...params] : undefined,
    });
  }

  public async withTransaction<T>(fn: (tx: DbTransactionClient) => Promise<T>): Promise<T> {
    const { txId } = await this.call<{ txId: number }>({ type: 'beginTx' });
    const txClient: DbTransactionClient = {
      isTransaction: true,
      query: async <R = Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<QueryResultLike<R>> => {
        return this.call<QueryResultLike<R>>({
          type: 'query',
          txId,
          text,
          params: params ? [...params] : undefined,
        });
      },
    };

    try {
      const result = await fn(txClient);
      await this.call({ type: 'commitTx', txId });
      return result;
    } catch (error) {
      await this.call({ type: 'rollbackTx', txId }).catch(() => undefined);
      throw error;
    }
  }

  public async close(): Promise<void> {
    try {
      await this.call({ type: 'close' });
    } finally {
      await this.worker.terminate();
    }
  }
}

describe('Phase 2 / Slice 9 — MFA (TOTP + Recovery Codes) & Attachments (Magic Bytes)', () => {
  describe('Pure TOTP RFC 6238, Base32 & AES-256-GCM Cryptography', () => {
    it('encodes and decodes Base32 per RFC 4648 and matches RFC 6238 SHA-1 TOTP test vectors', () => {
      const rfcSecret = Buffer.from('12345678901234567890', 'ascii');
      const b32 = base32Encode(rfcSecret);
      expect(b32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
      expect(base32Decode(b32).equals(rfcSecret)).toBe(true);
      expect(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq====').equals(rfcSecret)).toBe(
        true,
      );

      // RFC 6238 Appendix B: SHA-1 8-digit vectors truncated to 6 digits
      // T = 59s -> 94287082 -> 287082
      expect(generateTotpCode(rfcSecret, 59_000)).toBe('287082');
      // T = 1111111109s -> 07081804 -> 081804
      expect(generateTotpCode(rfcSecret, 1111111109_000)).toBe('081804');
    });

    it('accepts ±1 step window and rejects codes outside window or malformed codes', () => {
      const secret = Buffer.from('12345678901234567890', 'ascii');
      const baseTimeMs = 1_700_000_010_000; // 10s into a 30s period
      const prevStepCode = generateTotpCode(secret, baseTimeMs - 30_000);
      const currStepCode = generateTotpCode(secret, baseTimeMs);
      const nextStepCode = generateTotpCode(secret, baseTimeMs + 30_000);
      const twoStepsAgoCode = generateTotpCode(secret, baseTimeMs - 60_000);
      const twoStepsAheadCode = generateTotpCode(secret, baseTimeMs + 60_000);

      expect(verifyTotpCode(secret, prevStepCode, baseTimeMs)).toBe(true);
      expect(verifyTotpCode(secret, currStepCode, baseTimeMs)).toBe(true);
      expect(verifyTotpCode(secret, nextStepCode, baseTimeMs)).toBe(true);
      expect(verifyTotpCode(secret, twoStepsAgoCode, baseTimeMs)).toBe(false);
      expect(verifyTotpCode(secret, twoStepsAheadCode, baseTimeMs)).toBe(false);
      expect(verifyTotpCode(secret, 'abcdef', baseTimeMs)).toBe(false);
      expect(verifyTotpCode(secret, '12345', baseTimeMs)).toBe(false);
    });

    it('encrypts/decrypts TOTP secrets with AES-256-GCM and binds userId via AAD', () => {
      const secret = Buffer.from('12345678901234567890', 'ascii');
      const masterKey = 'super-strong-master-encryption-key-for-tests';
      const userA = randomUUID();
      const userB = randomUUID();

      const encrypted = encryptTotpSecret(secret, userA, masterKey);
      expect(encrypted.startsWith('v1:')).toBe(true);
      expect(encrypted).not.toContain(secret.toString('base64'));

      const decrypted = decryptTotpSecret(encrypted, userA, masterKey);
      expect(decrypted.equals(secret)).toBe(true);

      // Cross-user AAD binding prevents transplanting ciphertext to another user
      expect(() => decryptTotpSecret(encrypted, userB, masterKey)).toThrow();

      // Tampering authTag fails decryption
      const parts = encrypted.split(':');
      parts[2] = Buffer.alloc(16, 0).toString('base64');
      expect(() => decryptTotpSecret(parts.join(':'), userA, masterKey)).toThrow();
    });
  });

  describe('Pure Magic Bytes Detector & Filename Sanitization', () => {
    it('detects PNG, JPEG, and PDF magic bytes and rejects EXE, SVG, HTML, and invalid Base64', () => {
      expect(detectAllowedAttachmentType(VALID_PNG_BYTES)).toEqual({
        mimeType: 'image/png',
        extension: 'png',
      });
      expect(detectAllowedAttachmentType(VALID_JPEG_BYTES)).toEqual({
        mimeType: 'image/jpeg',
        extension: 'jpg',
      });
      expect(detectAllowedAttachmentType(VALID_PDF_BYTES)).toEqual({
        mimeType: 'application/pdf',
        extension: 'pdf',
      });

      expect(detectAllowedAttachmentType(DISGUISED_EXE_BYTES)).toBeNull();
      expect(detectAllowedAttachmentType(DISGUISED_SVG_BYTES)).toBeNull();
      expect(detectAllowedAttachmentType(DISGUISED_HTML_BYTES)).toBeNull();
      expect(detectAllowedAttachmentType(Buffer.alloc(0))).toBeNull();

      expect(() => decodeAndValidateAttachmentBase64('not!valid!base64!')).toThrow();
      expect(() => decodeAndValidateAttachmentBase64('')).toThrow();
      expect(sanitizeAttachmentFilename('../../etc/passwd')).toBe('passwd');
      expect(sanitizeAttachmentFilename('C:\\fakepath\\receipt\r\n.png')).toBe('receipt.png');
    });
  });

  describe('MFA HTTP Lifecycle & Login Enforcement (In-Memory App)', () => {
    let app: INestApplication;
    let db: Awaited<ReturnType<typeof createFullHttpTestApp>>['db'];
    let attachmentStorageDir: string;

    beforeEach(async () => {
      ({ app, db, attachmentStorageDir } = await createFullHttpTestApp({
        rateLimitAuthMax: 50,
      }));
    });

    afterEach(async () => {
      await app.close();
      fs.rmSync(attachmentStorageDir, { recursive: true, force: true });
    });

    it('completes setup -> verify -> login requires MFA -> TOTP login -> single-use recovery code -> disable', async () => {
      const server = app.getHttpServer();

      // Unauthenticated requests are rejected with 401
      expect((await request(server).get('/api/v1/auth/mfa/status')).status).toBe(401);

      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'mfa-user@example.com',
        password: 'StrongPassword1234!',
        fullName: 'MFA Tester',
      });
      expect(reg.status).toBe(201);
      const token = reg.body.accessToken as string;
      const userId = reg.body.user.id as string;

      // Initial status: disabled
      const statusBefore = await request(server)
        .get('/api/v1/auth/mfa/status')
        .set('Authorization', `Bearer ${token}`);
      expect(statusBefore.status).toBe(200);
      expect(statusBefore.body).toEqual({
        enabled: false,
        enabledAt: null,
        remainingRecoveryCodes: 0,
      });

      // Verify before setup -> 422 MFA_NOT_SETUP
      const verifyBeforeSetup = await request(server)
        .post('/api/v1/auth/mfa/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '123456' });
      expect(verifyBeforeSetup.status).toBe(422);
      expect(verifyBeforeSetup.body.code).toBe('MFA_NOT_SETUP');

      // Setup -> returns Base32 secret & otpauth URI with issuer SoTaiChinh
      const setupRes = await request(server)
        .post('/api/v1/auth/mfa/setup')
        .set('Authorization', `Bearer ${token}`);
      expect(setupRes.status).toBe(200);
      expect(setupRes.body.secretBase32).toMatch(/^[A-Z2-7]{32}$/);
      expect(setupRes.body.otpauthUri).toContain('otpauth://totp/SoTaiChinh:');
      expect(setupRes.body.otpauthUri).toContain('issuer=SoTaiChinh');
      expect(setupRes.body.otpauthUri).toContain(`secret=${setupRes.body.secretBase32}`);

      const secretBuf = base32Decode(setupRes.body.secretBase32 as string);

      // Verify with wrong TOTP -> 401 MFA_INVALID_CODE
      const badVerify = await request(server)
        .post('/api/v1/auth/mfa/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '000000' === generateTotpCode(secretBuf) ? '111111' : '000000' });
      expect(badVerify.status).toBe(401);
      expect(badVerify.body.code).toBe('MFA_INVALID_CODE');

      // Verify with valid TOTP -> enables MFA, generates 8 recovery codes, logs audit event
      const validTotp = generateTotpCode(secretBuf);
      const verifyRes = await request(server)
        .post('/api/v1/auth/mfa/verify')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: validTotp });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.enabled).toBe(true);
      expect(verifyRes.body.recoveryCodes).toHaveLength(8);
      for (const code of verifyRes.body.recoveryCodes as string[]) {
        expect(code).toMatch(/^[A-F0-9]{5}-[A-F0-9]{5}$/);
      }
      expect(
        db.state.auditLogs.some((a) => a.input.userId === userId && a.input.action === 'MFA_ENABLED'),
      ).toBe(true);

      // Status reflects enabled = true, 8 remaining recovery codes
      const statusEnabled = await request(server)
        .get('/api/v1/auth/mfa/status')
        .set('Authorization', `Bearer ${token}`);
      expect(statusEnabled.status).toBe(200);
      expect(statusEnabled.body.enabled).toBe(true);
      expect(typeof statusEnabled.body.enabledAt).toBe('string');
      expect(statusEnabled.body.remainingRecoveryCodes).toBe(8);

      // Setup while already enabled -> 409 MFA_ALREADY_ENABLED
      const setupAgain = await request(server)
        .post('/api/v1/auth/mfa/setup')
        .set('Authorization', `Bearer ${token}`);
      expect(setupAgain.status).toBe(409);
      expect(setupAgain.body.code).toBe('MFA_ALREADY_ENABLED');

      // Login with wrong password still returns INVALID_CREDENTIALS (never leaks MFA_REQUIRED)
      const wrongPassLogin = await request(server).post('/api/v1/auth/login').send({
        email: 'mfa-user@example.com',
        password: 'WrongPassword1234!',
      });
      expect(wrongPassLogin.status).toBe(401);
      expect(wrongPassLogin.body.code).toBe('INVALID_CREDENTIALS');

      // Login with right password & omitted mfaCode -> 401 MFA_REQUIRED
      const missingMfaLogin = await request(server).post('/api/v1/auth/login').send({
        email: 'mfa-user@example.com',
        password: 'StrongPassword1234!',
      });
      expect(missingMfaLogin.status).toBe(401);
      expect(missingMfaLogin.body.code).toBe('MFA_REQUIRED');

      // Login with invalid mfaCode -> 401 MFA_INVALID_CODE
      const wrongMfaLogin = await request(server).post('/api/v1/auth/login').send({
        email: 'mfa-user@example.com',
        password: 'StrongPassword1234!',
        mfaCode: '000000' === generateTotpCode(secretBuf) ? '111111' : '000000',
      });
      expect(wrongMfaLogin.status).toBe(401);
      expect(wrongMfaLogin.body.code).toBe('MFA_INVALID_CODE');

      // Login with valid TOTP -> 200
      const totpLogin = await request(server).post('/api/v1/auth/login').send({
        email: 'mfa-user@example.com',
        password: 'StrongPassword1234!',
        mfaCode: generateTotpCode(secretBuf),
      });
      expect(totpLogin.status).toBe(200);
      expect(totpLogin.body.user.mfaEnabled).toBe(true);
      expect(totpLogin.body.accessToken).toEqual(expect.any(String));

      // Login with single-use recovery code -> 200 once (remaining drops to 7), fails on reuse
      const recoveryCode0 = verifyRes.body.recoveryCodes[0] as string;
      const recoveryLogin1 = await request(server).post('/api/v1/auth/login').send({
        email: 'mfa-user@example.com',
        password: 'StrongPassword1234!',
        mfaCode: recoveryCode0.toLowerCase().replace('-', ''),
      });
      expect(recoveryLogin1.status).toBe(200);
      expect(
        db.state.auditLogs.some(
          (a) => a.input.userId === userId && a.input.action === 'MFA_RECOVERY_CODE_USED',
        ),
      ).toBe(true);

      const statusAfterRecovery = await request(server)
        .get('/api/v1/auth/mfa/status')
        .set('Authorization', `Bearer ${token}`);
      expect(statusAfterRecovery.body.remainingRecoveryCodes).toBe(7);

      const recoveryLoginReuse = await request(server).post('/api/v1/auth/login').send({
        email: 'mfa-user@example.com',
        password: 'StrongPassword1234!',
        mfaCode: recoveryCode0,
      });
      expect(recoveryLoginReuse.status).toBe(401);
      expect(recoveryLoginReuse.body.code).toBe('MFA_INVALID_CODE');

      // Disable with wrong password -> 401 INVALID_CREDENTIALS
      const disableWrongPass = await request(server)
        .post('/api/v1/auth/mfa/disable')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'WrongPassword1234!', code: generateTotpCode(secretBuf) });
      expect(disableWrongPass.status).toBe(401);
      expect(disableWrongPass.body.code).toBe('INVALID_CREDENTIALS');

      // Disable with wrong code -> 401 MFA_INVALID_CODE
      const disableWrongCode = await request(server)
        .post('/api/v1/auth/mfa/disable')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'StrongPassword1234!', code: recoveryCode0 });
      expect(disableWrongCode.status).toBe(401);
      expect(disableWrongCode.body.code).toBe('MFA_INVALID_CODE');

      // Disable with valid password + valid TOTP -> 200 { enabled: false }
      const disableOk = await request(server)
        .post('/api/v1/auth/mfa/disable')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'StrongPassword1234!', code: generateTotpCode(secretBuf) });
      expect(disableOk.status).toBe(200);
      expect(disableOk.body).toEqual({ enabled: false });
      expect(
        db.state.auditLogs.some((a) => a.input.userId === userId && a.input.action === 'MFA_DISABLED'),
      ).toBe(true);

      const statusDisabled = await request(server)
        .get('/api/v1/auth/mfa/status')
        .set('Authorization', `Bearer ${token}`);
      expect(statusDisabled.body).toEqual({
        enabled: false,
        enabledAt: null,
        remainingRecoveryCodes: 0,
      });

      // Login after MFA disabled succeeds without mfaCode
      const loginAfterDisable = await request(server).post('/api/v1/auth/login').send({
        email: 'mfa-user@example.com',
        password: 'StrongPassword1234!',
      });
      expect(loginAfterDisable.status).toBe(200);
      expect(loginAfterDisable.body.user.mfaEnabled).toBe(false);
    });
  });

  describe('Attachments HTTP Lifecycle, Magic Bytes & Cross-User Isolation (In-Memory App)', () => {
    let app: INestApplication;
    let attachmentStorageDir: string;

    beforeEach(async () => {
      ({ app, attachmentStorageDir } = await createFullHttpTestApp());
    });

    afterEach(async () => {
      await app.close();
      fs.rmSync(attachmentStorageDir, { recursive: true, force: true });
    });

    async function registerAndCreateExpense(email: string) {
      const server = app.getHttpServer();
      const reg = await request(server).post('/api/v1/auth/register').send({
        email,
        password: 'StrongPassword1234!',
        fullName: email,
      });
      expect(reg.status).toBe(201);
      const token = reg.body.accessToken as string;
      const defaultAccountId = reg.body.defaultAccount.id as string;

      const cats = await request(server)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${token}`);
      const expCat = cats.body.find((c: { kind: string }) => c.kind === CategoryKind.EXPENSE);

      const expRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          accountId: defaultAccountId,
          categoryId: expCat.id,
          amount: '75000',
          transactionDate: '2026-11-23',
          description: 'Receipt test expense',
        });
      expect(expRes.status).toBe(201);
      return { token, transactionId: expRes.body.id as string };
    }

    it('uploads and downloads PNG, JPEG, and PDF with magic-byte detection and security headers', async () => {
      const server = app.getHttpServer();
      const { token, transactionId } = await registerAndCreateExpense('att-happy@example.com');

      const files = [
        { filename: 'receipt.png', bytes: VALID_PNG_BYTES, expectedMime: 'image/png' },
        { filename: 'photo.jpg', bytes: VALID_JPEG_BYTES, expectedMime: 'image/jpeg' },
        { filename: 'invoice.pdf', bytes: VALID_PDF_BYTES, expectedMime: 'application/pdf' },
      ];

      const uploadedIds: string[] = [];
      for (const f of files) {
        const res = await request(server)
          .post(`/api/v1/transactions/${transactionId}/attachments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            filename: f.filename,
            contentBase64: f.bytes.toString('base64'),
          });
        expect(res.status).toBe(201);
        expect(res.body.transactionId).toBe(transactionId);
        expect(res.body.originalFilename).toBe(f.filename);
        expect(res.body.mimeType).toBe(f.expectedMime);
        expect(res.body.sizeBytes).toBe(f.bytes.length);
        expect(res.body.sha256Hash).toBe(createHash('sha256').update(f.bytes).digest('hex'));
        expect(res.body.storedFilename).toBeUndefined();
        uploadedIds.push(res.body.id as string);

        const dlRes = await request(server)
          .get(`/api/v1/attachments/${res.body.id}/download`)
          .set('Authorization', `Bearer ${token}`);
        expect(dlRes.status).toBe(200);
        expect(dlRes.headers['content-type']).toContain(f.expectedMime);
        expect(dlRes.headers['content-disposition']).toBe(`attachment; filename="${f.filename}"`);
        expect(dlRes.headers['x-content-type-options']).toBe('nosniff');
        expect(Buffer.compare(dlRes.body as Buffer, f.bytes)).toBe(0);
      }

      const listRes = await request(server)
        .get(`/api/v1/transactions/${transactionId}/attachments`)
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.items).toHaveLength(3);

      // Delete first attachment -> 204 and file removed from disk + subsequent download returns 404
      const storedFilesBeforeDelete = fs.readdirSync(attachmentStorageDir);
      expect(storedFilesBeforeDelete).toHaveLength(3);

      const delRes = await request(server)
        .delete(`/api/v1/attachments/${uploadedIds[0]}`)
        .set('Authorization', `Bearer ${token}`);
      expect(delRes.status).toBe(204);

      expect(fs.readdirSync(attachmentStorageDir)).toHaveLength(2);
      const dlAfterDelete = await request(server)
        .get(`/api/v1/attachments/${uploadedIds[0]}/download`)
        .set('Authorization', `Bearer ${token}`);
      expect(dlAfterDelete.status).toBe(404);
    });

    it('rejects disguised EXE/SVG/HTML named receipt.png (422), oversized/empty payloads (422), and enforces max 5 attachments per tx', async () => {
      const server = app.getHttpServer();
      const { token, transactionId } = await registerAndCreateExpense('att-guards@example.com');

      // Disguised files with .png extension -> 422 INVALID_FILE_TYPE
      for (const badBytes of [DISGUISED_EXE_BYTES, DISGUISED_SVG_BYTES, DISGUISED_HTML_BYTES]) {
        const res = await request(server)
          .post(`/api/v1/transactions/${transactionId}/attachments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            filename: 'receipt.png',
            contentBase64: badBytes.toString('base64'),
          });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('INVALID_FILE_TYPE');
      }

      // 0-byte payload -> 422
      const emptyRes = await request(server)
        .post(`/api/v1/transactions/${transactionId}/attachments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          filename: 'empty.png',
          contentBase64: '',
        });
      expect(emptyRes.status).toBe(422);

      // > 5 MiB (5_242_881 bytes) -> 422 INVALID_FILE_SIZE (fits under 8mb Express JSON limit)
      const over5Mb = Buffer.concat([
        VALID_PNG_BYTES,
        Buffer.alloc(MAX_ATTACHMENT_BYTES + 1 - VALID_PNG_BYTES.length, 0xaa),
      ]);
      expect(over5Mb.length).toBe(MAX_ATTACHMENT_BYTES + 1);
      const overRes = await request(server)
        .post(`/api/v1/transactions/${transactionId}/attachments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          filename: 'huge.png',
          contentBase64: over5Mb.toString('base64'),
        });
      expect(overRes.status).toBe(422);
      expect(overRes.body.code).toBe('INVALID_FILE_SIZE');

      // Exact 5 MiB (5_242_880 bytes) succeeds under 8mb JSON body limit
      const exact5Mb = Buffer.concat([
        VALID_PNG_BYTES,
        Buffer.alloc(MAX_ATTACHMENT_BYTES - VALID_PNG_BYTES.length, 0xbb),
      ]);
      const exactRes = await request(server)
        .post(`/api/v1/transactions/${transactionId}/attachments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          filename: 'exact-5mb.png',
          contentBase64: exact5Mb.toString('base64'),
        });
      expect(exactRes.status).toBe(201);
      expect(exactRes.body.sizeBytes).toBe(MAX_ATTACHMENT_BYTES);

      // Upload 4 more to hit limit of 5
      const ids: string[] = [exactRes.body.id as string];
      for (let i = 2; i <= 5; i += 1) {
        const r = await request(server)
          .post(`/api/v1/transactions/${transactionId}/attachments`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            filename: `receipt-${i}.png`,
            contentBase64: VALID_PNG_BYTES.toString('base64'),
          });
        expect(r.status).toBe(201);
        ids.push(r.body.id as string);
      }

      // 6th attachment rejected with 422 ATTACHMENT_LIMIT_EXCEEDED
      const sixthRes = await request(server)
        .post(`/api/v1/transactions/${transactionId}/attachments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          filename: 'receipt-6.png',
          contentBase64: VALID_PNG_BYTES.toString('base64'),
        });
      expect(sixthRes.status).toBe(422);
      expect(sixthRes.body.code).toBe('ATTACHMENT_LIMIT_EXCEEDED');

      // Delete one, then 6th succeeds
      expect(
        (
          await request(server)
            .delete(`/api/v1/attachments/${ids[0]}`)
            .set('Authorization', `Bearer ${token}`)
        ).status,
      ).toBe(204);

      const afterFreeSlot = await request(server)
        .post(`/api/v1/transactions/${transactionId}/attachments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          filename: 'receipt-replacement.pdf',
          contentBase64: VALID_PDF_BYTES.toString('base64'),
        });
      expect(afterFreeSlot.status).toBe(201);
    });

    it('enforces strict cross-user 404 isolation on list, upload, download, and delete', async () => {
      const server = app.getHttpServer();
      const userA = await registerAndCreateExpense('att-owner-a@example.com');
      const userB = await registerAndCreateExpense('att-other-b@example.com');

      const uploadA = await request(server)
        .post(`/api/v1/transactions/${userA.transactionId}/attachments`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          filename: 'private-receipt.png',
          contentBase64: VALID_PNG_BYTES.toString('base64'),
        });
      expect(uploadA.status).toBe(201);
      const attachmentIdA = uploadA.body.id as string;

      // User B listing User A's transaction attachments -> 404
      expect(
        (
          await request(server)
            .get(`/api/v1/transactions/${userA.transactionId}/attachments`)
            .set('Authorization', `Bearer ${userB.token}`)
        ).status,
      ).toBe(404);

      // User B uploading to User A's transaction -> 404
      expect(
        (
          await request(server)
            .post(`/api/v1/transactions/${userA.transactionId}/attachments`)
            .set('Authorization', `Bearer ${userB.token}`)
            .send({
              filename: 'hack.png',
              contentBase64: VALID_PNG_BYTES.toString('base64'),
            })
        ).status,
      ).toBe(404);

      // User B downloading User A's attachment -> 404
      expect(
        (
          await request(server)
            .get(`/api/v1/attachments/${attachmentIdA}/download`)
            .set('Authorization', `Bearer ${userB.token}`)
        ).status,
      ).toBe(404);

      // User B deleting User A's attachment -> 404
      expect(
        (
          await request(server)
            .delete(`/api/v1/attachments/${attachmentIdA}`)
            .set('Authorization', `Bearer ${userB.token}`)
        ).status,
      ).toBe(404);

      // User A can still download intact attachment
      expect(
        (
          await request(server)
            .get(`/api/v1/attachments/${attachmentIdA}/download`)
            .set('Authorization', `Bearer ${userA.token}`)
        ).status,
      ).toBe(200);
    });
  });

  describe('Real PostgreSQL (PGlite) Migration 002_phase2_mfa_and_attachments.sql & Pg*Repositories E2E', () => {
    let pg: PGliteWorkerExecutor;
    let app: INestApplication;
    let attachmentStorageDir: string;

    beforeAll(async () => {
      pg = new PGliteWorkerExecutor();
      await pg.init();

      const sql001 = fs.readFileSync(MIGRATION_001_PATH, 'utf8');
      const sql002 = fs.readFileSync(MIGRATION_002_PATH, 'utf8');
      await pg.exec(sql001);
      await pg.exec(sql002);
      // Verify 002 migration is idempotent when executed a second time
      await pg.exec(sql002);

      attachmentStorageDir = path.join(os.tmpdir(), `pfm-pg-attachments-${randomUUID()}`);
      const pgConfig = {
        ...TEST_APP_CONFIG,
        rateLimitAuthMax: 50,
        attachmentStorageDir,
      };

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(APP_CONFIG)
        .useValue(pgConfig)
        .overrideProvider(DatabaseService)
        .useValue(pg)
        .overrideProvider(DATABASE_EXECUTOR)
        .useValue(pg)
        .overrideProvider(ATTACHMENT_STORAGE_DIR)
        .useValue(attachmentStorageDir)
        .compile();

      app = moduleRef.createNestApplication();
      configureHttpApp(app, pgConfig);
      await app.init();
    }, 30000);

    afterAll(async () => {
      if (app) {
        await app.close();
      }
      if (pg) {
        await pg.close();
      }
      if (attachmentStorageDir) {
        fs.rmSync(attachmentStorageDir, { recursive: true, force: true });
      }
    });

    it('creates user_mfa, user_mfa_recovery_codes, transaction_attachments, indexes, and enforces composite FK & CHECK constraints', async () => {
      const tablesRes = await pg.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename ASC`,
      );
      const tableNames = tablesRes.rows.map((r) => r.tablename);
      expect(tableNames).toContain('user_mfa');
      expect(tableNames).toContain('user_mfa_recovery_codes');
      expect(tableNames).toContain('transaction_attachments');

      const indexRes = await pg.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const indexNames = indexRes.rows.map((r) => r.indexname);
      expect(indexNames).toContain('idx_user_mfa_recovery_codes_user_id');
      expect(indexNames).toContain('idx_transaction_attachments_tx_user');

      // Seed 2 tenants in PostgreSQL to verify composite FK tenant isolation & CHECK constraints
      const userARes = await pg.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, base_currency_code)
         VALUES ('pg-fk-a@example.com', 'hash', 'FK A', 'VND') RETURNING id`,
      );
      const userBRes = await pg.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, base_currency_code)
         VALUES ('pg-fk-b@example.com', 'hash', 'FK B', 'VND') RETURNING id`,
      );
      const userAId = userARes.rows[0].id;
      const userBId = userBRes.rows[0].id;

      const accARes = await pg.query<{ id: string }>(
        `INSERT INTO accounts (user_id, name, account_type, currency_code, opening_balance_minor, opening_balance_date, is_default)
         VALUES ($1, 'Sổ chung', 'CASH', 'VND', 0, '2026-11-01', TRUE) RETURNING id`,
        [userAId],
      );
      const catARes = await pg.query<{ id: string }>(
        `INSERT INTO categories (user_id, kind, name) VALUES ($1, 'EXPENSE', 'Food') RETURNING id`,
        [userAId],
      );
      const txARes = await pg.query<{ id: string }>(
        `INSERT INTO transactions (user_id, account_id, entry_type, status, amount_minor, currency_code, transaction_date, category_id)
         VALUES ($1, $2, 'EXPENSE', 'POSTED', 50000, 'VND', '2026-11-23', $3) RETURNING id`,
        [userAId, accARes.rows[0].id, catARes.rows[0].id],
      );
      const txAId = txARes.rows[0].id;

      // Cross-tenant insert into transaction_attachments must fail composite FK (23503)
      let crossTenantErr: PgErrorLike | undefined;
      try {
        await pg.query(
          `INSERT INTO transaction_attachments (
             user_id, transaction_id, original_filename, stored_filename, mime_type, size_bytes, sha256_hash
           ) VALUES ($1, $2, 'x.png', $3, 'image/png', 100, $4)`,
          [userBId, txAId, `${randomUUID()}.png`, 'a'.repeat(64)],
        );
      } catch (err) {
        crossTenantErr = err as PgErrorLike;
      }
      expect(crossTenantErr?.code).toBe('23503');
      expect(crossTenantErr?.constraint).toBe('transaction_attachments_transaction_id_user_id_fkey');

      // Disallowed mime_type -> CHECK constraint (23514)
      let badMimeErr: PgErrorLike | undefined;
      try {
        await pg.query(
          `INSERT INTO transaction_attachments (
             user_id, transaction_id, original_filename, stored_filename, mime_type, size_bytes, sha256_hash
           ) VALUES ($1, $2, 'x.svg', $3, 'image/svg+xml', 100, $4)`,
          [userAId, txAId, `${randomUUID()}.svg`, 'b'.repeat(64)],
        );
      } catch (err) {
        badMimeErr = err as PgErrorLike;
      }
      expect(badMimeErr?.code).toBe('23514');

      // Disallowed size_bytes > 5242880 -> CHECK constraint (23514)
      let badSizeErr: PgErrorLike | undefined;
      try {
        await pg.query(
          `INSERT INTO transaction_attachments (
             user_id, transaction_id, original_filename, stored_filename, mime_type, size_bytes, sha256_hash
           ) VALUES ($1, $2, 'big.png', $3, 'image/png', 5242881, $4)`,
          [userAId, txAId, `${randomUUID()}.png`, 'c'.repeat(64)],
        );
      } catch (err) {
        badSizeErr = err as PgErrorLike;
      }
      expect(badSizeErr?.code).toBe('23514');
    });

    it('runs PgMfaRepository & PgAttachmentsRepository end-to-end through NestJS HTTP endpoints', async () => {
      const server = app.getHttpServer();

      const regA = await request(server).post('/api/v1/auth/register').send({
        email: 'pg-slice9-a@example.com',
        password: 'StrongPassword1234!',
        fullName: 'PG Slice 9 A',
      });
      expect(regA.status).toBe(201);
      const tokenA = regA.body.accessToken as string;
      const defaultAccA = regA.body.defaultAccount.id as string;

      const regB = await request(server).post('/api/v1/auth/register').send({
        email: 'pg-slice9-b@example.com',
        password: 'StrongPassword1234!',
        fullName: 'PG Slice 9 B',
      });
      expect(regB.status).toBe(201);
      const tokenB = regB.body.accessToken as string;

      // 1. MFA setup -> verify -> login challenge -> recovery code single-use -> disable via recovery code
      const setup = await request(server)
        .post('/api/v1/auth/mfa/setup')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(setup.status).toBe(200);
      const secret = base32Decode(setup.body.secretBase32 as string);

      const verify = await request(server)
        .post('/api/v1/auth/mfa/verify')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ code: generateTotpCode(secret) });
      expect(verify.status).toBe(200);
      expect(verify.body.recoveryCodes).toHaveLength(8);

      const needMfa = await request(server).post('/api/v1/auth/login').send({
        email: 'pg-slice9-a@example.com',
        password: 'StrongPassword1234!',
      });
      expect(needMfa.status).toBe(401);
      expect(needMfa.body.code).toBe('MFA_REQUIRED');

      const loginTotp = await request(server).post('/api/v1/auth/login').send({
        email: 'pg-slice9-a@example.com',
        password: 'StrongPassword1234!',
        mfaCode: generateTotpCode(secret),
      });
      expect(loginTotp.status).toBe(200);
      expect(loginTotp.body.user.mfaEnabled).toBe(true);

      const recoveryCode0 = verify.body.recoveryCodes[0] as string;
      const loginRec = await request(server).post('/api/v1/auth/login').send({
        email: 'pg-slice9-a@example.com',
        password: 'StrongPassword1234!',
        mfaCode: recoveryCode0,
      });
      expect(loginRec.status).toBe(200);

      const reuseRec = await request(server).post('/api/v1/auth/login').send({
        email: 'pg-slice9-a@example.com',
        password: 'StrongPassword1234!',
        mfaCode: recoveryCode0,
      });
      expect(reuseRec.status).toBe(401);
      expect(reuseRec.body.code).toBe('MFA_INVALID_CODE');

      // Disable using second unused recovery code
      const recoveryCode1 = verify.body.recoveryCodes[1] as string;
      const disableRes = await request(server)
        .post('/api/v1/auth/mfa/disable')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ password: 'StrongPassword1234!', code: recoveryCode1 });
      expect(disableRes.status).toBe(200);
      expect(disableRes.body).toEqual({ enabled: false });

      // 2. Attachments via PostgreSQL
      const catsA = await request(server)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${tokenA}`);
      const expCatA = catsA.body.find((c: { kind: string }) => c.kind === CategoryKind.EXPENSE);

      const expA = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          accountId: defaultAccA,
          categoryId: expCatA.id,
          amount: '120000',
          transactionDate: '2026-11-23',
          description: 'PG attachment test',
        });
      expect(expA.status).toBe(201);
      const txIdA = expA.body.id as string;

      const badExe = await request(server)
        .post(`/api/v1/transactions/${txIdA}/attachments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          filename: 'receipt.png',
          contentBase64: DISGUISED_EXE_BYTES.toString('base64'),
        });
      expect(badExe.status).toBe(422);
      expect(badExe.body.code).toBe('INVALID_FILE_TYPE');

      const uploadPdf = await request(server)
        .post(`/api/v1/transactions/${txIdA}/attachments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          filename: 'invoice.pdf',
          contentBase64: VALID_PDF_BYTES.toString('base64'),
        });
      expect(uploadPdf.status).toBe(201);
      expect(uploadPdf.body.mimeType).toBe('application/pdf');
      const attId = uploadPdf.body.id as string;

      // Cross-user 404 in real PostgreSQL
      expect(
        (
          await request(server)
            .get(`/api/v1/attachments/${attId}/download`)
            .set('Authorization', `Bearer ${tokenB}`)
        ).status,
      ).toBe(404);

      const dlPdf = await request(server)
        .get(`/api/v1/attachments/${attId}/download`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(dlPdf.status).toBe(200);
      expect(dlPdf.headers['content-type']).toContain('application/pdf');
      expect(dlPdf.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(dlPdf.body as Buffer, VALID_PDF_BYTES)).toBe(0);

      expect(
        (
          await request(server)
            .delete(`/api/v1/attachments/${attId}`)
            .set('Authorization', `Bearer ${tokenA}`)
        ).status,
      ).toBe(204);
    });
  });
});
