import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  AccountType,
  CategoryKind,
  EntryType,
  TransactionStatus,
} from '@pfm/shared-types';
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
  MAX_CSV_PAYLOAD_BYTES,
  MAX_IMPORT_ROWS,
  parseImportCsv,
} from '../src/modules/imports/csv-parser';
import {
  IdempotencyConflictException,
  InvalidIdempotencyKeyException,
  MissingIdempotencyKeyException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../src/shared-kernel/domain/domain-exceptions';
import {
  LogSink,
  RedactedLogger,
} from '../src/shared-kernel/logging/redacted-logger';
import { TEST_APP_CONFIG } from './helpers/in-memory-backend';
import { createFullHttpTestApp, createFullServiceHarness } from './helpers/test-app';

const MIGRATION_PATH = path.resolve(__dirname, '../../database/migrations/001_initial_schema.sql');
const WORKER_PATH = path.resolve(__dirname, './helpers/pglite-worker.cjs');

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

class LocalPGliteExecutor implements DatabaseExecutor {
  private readonly worker: Worker;
  private nextMsgId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(WORKER_PATH);
    this.worker.on('message', (msg: WorkerResponse) => {
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        waiter.resolve(msg.result);
      } else {
        const err = new Error(msg.error?.message ?? 'Unknown PGlite worker error') as Error & {
          code?: string;
          constraint?: string;
        };
        err.name = msg.error?.name ?? 'DatabaseError';
        err.code = msg.error?.code;
        err.constraint = msg.error?.constraint;
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
    const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    await this.call({ type: 'exec', sql: migrationSql });
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

describe('Phase 2 / Slice 8 — ImportsModule (Bulk CSV Import with Preview & Duplicate Detection)', () => {
  describe('RFC 4180 CSV Parser & T-10 DoS Guards', () => {
    it('parses RFC 4180 quoted fields, escaped quotes, embedded newlines, BOM, and case-insensitive header aliases', () => {
      const csv =
        '\uFEFFTransaction_Date,Entry_Type,AMOUNT,Category,Description,Merchant,Source\r\n' +
        '2026-11-18,EXPENSE,65000,"Ăn uống","Coffee, ""iced""\nwith friends","Highlands Coffee",\r\n' +
        '2026-11-19,INCOME,25000000,"Lương","Monthly salary",,"ACME Corp"\r\n';

      const rows = parseImportCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        rowNumber: 1,
        rawDate: '2026-11-18',
        rawType: 'EXPENSE',
        rawAmount: '65000',
        rawCategory: 'Ăn uống',
        rawDescription: 'Coffee, "iced"\nwith friends',
        rawCounterparty: 'Highlands Coffee',
      });
      expect(rows[1]).toEqual({
        rowNumber: 2,
        rawDate: '2026-11-19',
        rawType: 'INCOME',
        rawAmount: '25000000',
        rawCategory: 'Lương',
        rawDescription: 'Monthly salary',
        rawCounterparty: 'ACME Corp',
      });
    });

    it('supports short header aliases (date, type, amount, category, description, counterparty) and exactly 500 rows', () => {
      const lines = ['date,type,amount,category,description,counterparty'];
      for (let i = 1; i <= MAX_IMPORT_ROWS; i += 1) {
        lines.push(`2026-11-01,EXPENSE,${1000 + i},Ăn uống,Item ${i},Shop ${i}`);
      }
      const rows = parseImportCsv(lines.join('\n'));
      expect(rows).toHaveLength(MAX_IMPORT_ROWS);
      expect(rows[0].rowNumber).toBe(1);
      expect(rows[499].rowNumber).toBe(500);
    });

    it('rejects > 500 rows, > 1 MB payloads, missing headers, and malformed RFC 4180 quotes (T-10)', () => {
      const overLimitLines = ['date,type,amount,category'];
      for (let i = 1; i <= MAX_IMPORT_ROWS + 1; i += 1) {
        overLimitLines.push(`2026-11-01,EXPENSE,${i},Ăn uống`);
      }
      expect(() => parseImportCsv(overLimitLines.join('\n'))).toThrow(ValidationDomainException);

      const over1Mb = `date,type,amount,category,description\n2026-11-01,EXPENSE,1000,Ăn uống,${'x'.repeat(MAX_CSV_PAYLOAD_BYTES)}`;
      expect(() => parseImportCsv(over1Mb)).toThrow(ValidationDomainException);

      expect(() => parseImportCsv('date,type,amount\n2026-11-01,EXPENSE,1000')).toThrow(
        ValidationDomainException,
      );

      expect(() =>
        parseImportCsv('date,type,amount,category\n2026-11-01,EXPENSE,1000,"unterminated'),
      ).toThrow(ValidationDomainException);

      expect(() =>
        parseImportCsv('date,type,amount,category\n2026-11-01,EXPENSE,1000,foo"bar'),
      ).toThrow(ValidationDomainException);
    });
  });

  describe('ImportsService Business Rules, Duplicate Detection & Atomic Rollback (In-Memory)', () => {
    it('validates preview rows, detects invalid decimal VND / bad dates / unknown categories, and detects DB + within-file duplicates', async () => {
      const {
        authService,
        accountsService,
        categoriesService,
        incomeService,
        expenseService,
        importsService,
      } = createFullServiceHarness();

      const reg = await authService.register({
        email: 'import-svc@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Import Service User',
        baseCurrencyCode: 'VND',
      });
      const userId = reg.response.user.id;
      const defaultAccId = reg.response.defaultAccount!.id;

      const incCats = await categoriesService.list(userId, CategoryKind.INCOME);
      const expCats = await categoriesService.list(userId, CategoryKind.EXPENSE);
      const salaryCat = incCats.find((c) => c.name === 'Lương')!;
      const foodCat = expCats.find((c) => c.name === 'Ăn uống')!;
      const shoppingCat = expCats.find((c) => c.name === 'Mua sắm')!;

      // Create existing POSTED expense (2026-11-10, 50000 VND) and a VOIDED expense (2026-11-11, 75000 VND)
      await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
        categoryId: foodCat.id,
        amount: '50000',
        transactionDate: '2026-11-10',
        description: 'Existing coffee',
      });

      const toVoid = await expenseService.create(
        userId,
        'Asia/Ho_Chi_Minh',
        randomUUID(),
        '/api/v1/expenses',
        {
          categoryId: foodCat.id,
          amount: '75000',
          transactionDate: '2026-11-11',
          description: 'Voided coffee',
        },
      );
      await expenseService.void(
        userId,
        toVoid.body.id,
        randomUUID(),
        `/api/v1/expenses/${toVoid.body.id}/void`,
      );

      // Also create a second VND account with an existing transaction that must NOT trigger duplicate on defaultAccId
      const otherAcc = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
        name: 'Secondary Cash',
        accountType: AccountType.CASH,
        currencyCode: 'VND',
      });
      await incomeService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/incomes', {
        accountId: otherAcc.id,
        categoryId: salaryCat.id,
        amount: '1200000',
        transactionDate: '2026-11-12',
      });

      const csv = [
        'date,type,amount,category,description,counterparty',
        '2026-11-15,INCOME,15000000,lương,November Salary,ACME Corp', // 1. VALID
        '2026-11-10,EXPENSE,50000,Ăn uống,Coffee duplicate DB,Highlands', // 2. DUPLICATE_SUSPECTED (matches DB)
        '2026-11-11,EXPENSE,75000,Ăn uống,Was voided in DB so valid,Highlands', // 3. VALID (DB tx is VOIDED)
        '2026-11-12,INCOME,1200000,Lương,Different account in DB so valid,Bonus', // 4. VALID (different account)
        '2026-11-16,EXPENSE,90000,Mua sắm,First occurrence in file,Store A', // 5. VALID
        '2026-11-16,EXPENSE,90000,Mua sắm,Second occurrence in file,Store A', // 6. DUPLICATE_SUSPECTED (within-file)
        '2026-11-17,EXPENSE,100.50,Ăn uống,Decimal VND invalid,', // 7. INVALID (VND decimal)
        '2026-02-30,EXPENSE,25000,Ăn uống,Bad calendar date,', // 8. INVALID (bad date)
        '2026-11-18,EXPENSE,30000,NonExistentCat,Unknown category,', // 9. INVALID (unknown category)
        '2026-11-19,INCOME,500000,Ăn uống,Wrong category kind,', // 10. INVALID (EXPENSE category on INCOME)
      ].join('\n');

      const preview = await importsService.preview(userId, { csvContent: csv });
      expect(preview.accountId).toBe(defaultAccId);
      expect(preview.currencyCode).toBe('VND');
      expect(preview.totalRows).toBe(10);
      expect(preview.validRows).toBe(4);
      expect(preview.duplicateRows).toBe(2);
      expect(preview.invalidRows).toBe(4);

      expect(preview.rows[0]).toMatchObject({
        rowNumber: 1,
        entryType: 'INCOME',
        transactionDate: '2026-11-15',
        amountMinor: '15000000',
        currencyCode: 'VND',
        categoryName: 'lương',
        categoryId: salaryCat.id,
        description: 'November Salary',
        counterparty: 'ACME Corp',
        status: 'VALID',
        duplicateReason: null,
        errors: [],
      });

      expect(preview.rows[1].status).toBe('DUPLICATE_SUSPECTED');
      expect(preview.rows[1].duplicateReason).toContain('2026-11-10');
      expect(preview.rows[1].duplicateReason).toContain('50000');

      expect(preview.rows[2].status).toBe('VALID');
      expect(preview.rows[3].status).toBe('VALID');
      expect(preview.rows[4].status).toBe('VALID');

      expect(preview.rows[5].status).toBe('DUPLICATE_SUSPECTED');
      expect(preview.rows[5].duplicateReason).toContain('CSV row 5');

      expect(preview.rows[6].status).toBe('INVALID');
      expect(preview.rows[6].amountMinor).toBeNull();
      expect(preview.rows[6].errors[0]).toContain('0 decimal places');

      expect(preview.rows[7].status).toBe('INVALID');
      expect(preview.rows[7].transactionDate).toBeNull();
      expect(preview.rows[7].errors[0]).toContain('does not exist');

      expect(preview.rows[8].status).toBe('INVALID');
      expect(preview.rows[8].categoryId).toBeNull();
      expect(preview.rows[8].errors[0]).toContain('Unknown active EXPENSE category');

      expect(preview.rows[9].status).toBe('INVALID');
      expect(preview.rows[9].categoryId).toBeNull();
      expect(preview.rows[9].errors[0]).toContain('does not match entry type');

      // Test USD currency minor_unit = 2 and KWD minor_unit = 3
      const usdAcc = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
        name: 'USD Account',
        accountType: AccountType.BANK,
        currencyCode: 'USD',
      });
      const usdPreview = await importsService.preview(userId, {
        accountId: usdAcc.id,
        csvContent: [
          'date,type,amount,category,description',
          '2026-11-20,EXPENSE,12.50,Ăn uống,Lunch',
          '2026-11-20,EXPENSE,12.555,Ăn uống,Too many decimals',
        ].join('\n'),
      });
      expect(usdPreview.currencyCode).toBe('USD');
      expect(usdPreview.rows[0].status).toBe('VALID');
      expect(usdPreview.rows[0].amountMinor).toBe('1250');
      expect(usdPreview.rows[1].status).toBe('INVALID');
      expect(usdPreview.rows[1].errors[0]).toContain('at most 2 decimal place');

      const kwdAcc = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
        name: 'KWD Account',
        accountType: AccountType.BANK,
        currencyCode: 'KWD',
      });
      const kwdPreview = await importsService.preview(userId, {
        accountId: kwdAcc.id,
        csvContent: 'date,type,amount,category\n2026-11-20,EXPENSE,1.235,Ăn uống',
      });
      expect(kwdPreview.rows[0].status).toBe('VALID');
      expect(kwdPreview.rows[0].amountMinor).toBe('1235');

      // Ensure Shopping category was resolved properly
      expect(preview.rows[4].categoryId).toBe(shoppingCat.id);
    });

    it('rolls back entire batch atomically on invalid row during commit, and supports idempotency replay/conflict', async () => {
      const {
        db,
        authService,
        accountsService,
        categoriesService,
        importsService,
      } = createFullServiceHarness();

      const reg = await authService.register({
        email: 'import-atomic@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Atomic User',
        baseCurrencyCode: 'VND',
      });
      const userId = reg.response.user.id;
      const defaultAccId = reg.response.defaultAccount!.id;
      const incCat = (await categoriesService.list(userId, CategoryKind.INCOME))[0];
      const expCat = (await categoriesService.list(userId, CategoryKind.EXPENSE))[0];

      // Missing / malformed Idempotency-Key
      await expect(
        importsService.commit(userId, undefined, '/api/v1/imports/commit', {
          rows: [
            {
              entryType: 'INCOME',
              transactionDate: '2026-11-20',
              amountMinor: '100000',
              categoryId: incCat.id,
            },
          ],
        }),
      ).rejects.toThrow(MissingIdempotencyKeyException);

      await expect(
        importsService.commit(userId, 'not-uuid-v4', '/api/v1/imports/commit', {
          rows: [
            {
              entryType: 'INCOME',
              transactionDate: '2026-11-20',
              amountMinor: '100000',
              categoryId: incCat.id,
            },
          ],
        }),
      ).rejects.toThrow(InvalidIdempotencyKeyException);

      // Atomic rollback: Row 1 valid, Row 2 invalid (EXPENSE category mismatched on INCOME or non-positive amount)
      const rollbackKey = randomUUID();
      await expect(
        importsService.commit(userId, rollbackKey, '/api/v1/imports/commit', {
          rows: [
            {
              entryType: 'INCOME',
              transactionDate: '2026-11-20',
              amountMinor: '500000',
              categoryId: incCat.id,
              description: 'Should roll back',
              counterparty: 'Rollback Source',
            },
            {
              entryType: 'INCOME',
              transactionDate: '2026-11-20',
              amountMinor: '100000',
              categoryId: expCat.id, // Kind mismatch -> throws after row 1!
            },
          ],
        }),
      ).rejects.toThrow(ValidationDomainException);

      // Zero transactions, zero incomeSources, zero audit logs, and key NOT poisoned
      expect(
        Array.from(db.state.transactions.values()).filter((t) => t.userId === userId),
      ).toHaveLength(0);
      expect(
        Array.from(db.state.incomeSources.values()).filter((s) => s.userId === userId),
      ).toHaveLength(0);
      expect(
        db.state.auditLogs.filter(
          (a) => a.input.userId === userId && a.input.action === 'BULK_IMPORT_COMMITTED',
        ),
      ).toHaveLength(0);
      expect(db.state.idempotencyKeys.has(`${userId}:${rollbackKey}`)).toBe(false);

      // Retry with fixed payload using the SAME key succeeds!
      const validPayload = {
        rows: [
          {
            entryType: 'INCOME' as const,
            transactionDate: '2026-11-20',
            amountMinor: '500000',
            categoryId: incCat.id,
            description: 'CONFIDENTIAL_SALARY_NOTE',
            counterparty: 'ACME Corp',
          },
          {
            entryType: 'EXPENSE' as const,
            transactionDate: '2026-11-21',
            amountMinor: '125000',
            categoryId: expCat.id,
            description: 'CONFIDENTIAL_LUNCH_NOTE',
            counterparty: 'Highlands Coffee',
          },
        ],
      };

      const committed = await importsService.commit(
        userId,
        rollbackKey,
        '/api/v1/imports/commit',
        validPayload,
      );
      expect(committed.status).toBe(201);
      expect(committed.body.accountId).toBe(defaultAccId);
      expect(committed.body.importedCount).toBe(2);
      expect(committed.body.skippedCount).toBe(0);
      expect(committed.body.transactionIds).toHaveLength(2);

      // Posted balance updated: 500,000 - 125,000 = 375,000
      const acc = await accountsService.getAccount(userId, defaultAccId);
      expect(acc.postedBalanceMinor).toBe('375000');

      // Idempotent replay returns exact same result without duplicating transactions
      const replayed = await importsService.commit(
        userId,
        rollbackKey,
        '/api/v1/imports/commit',
        validPayload,
      );
      expect(replayed).toEqual(committed);
      expect(
        Array.from(db.state.transactions.values()).filter((t) => t.userId === userId),
      ).toHaveLength(2);

      // Same key with modified payload -> 409 Conflict
      await expect(
        importsService.commit(userId, rollbackKey, '/api/v1/imports/commit', {
          rows: [validPayload.rows[0]],
        }),
      ).rejects.toThrow(IdempotencyConflictException);

      // Single redacted BULK_IMPORT_COMMITTED audit log entry with importedCount only
      const importAudits = db.state.auditLogs.filter(
        (a) => a.input.userId === userId && a.input.action === 'BULK_IMPORT_COMMITTED',
      );
      expect(importAudits).toHaveLength(1);
      expect(importAudits[0].input.metadata).toEqual({ importedCount: 2 });
      const auditSerialized = JSON.stringify(importAudits[0]);
      expect(auditSerialized).not.toContain('CONFIDENTIAL_SALARY_NOTE');
      expect(auditSerialized).not.toContain('CONFIDENTIAL_LUNCH_NOTE');
      expect(auditSerialized).not.toContain('500000');
      expect(auditSerialized).not.toContain('125000');
      expect(auditSerialized).not.toContain('ACME Corp');
    });
  });

  describe('HTTP Pipeline: Auth, Isolation (404), >500 rows / >1MB (422), Atomic Rollback, Replay & Rate Limit', () => {
    let app: INestApplication;
    let db: Awaited<ReturnType<typeof createFullHttpTestApp>>['db'];

    beforeAll(async () => {
      ({ app, db } = await createFullHttpTestApp());
    });

    afterAll(async () => {
      await app.close();
    });

    it('enforces AuthGuard, cross-user 404, mass assignment 400, >500 rows 422, >1MB 422, and RedactedLogger', async () => {
      const server = app.getHttpServer();

      // Unauthenticated -> 401
      const unauthPreview = await request(server)
        .post('/api/v1/imports/preview')
        .send({ csvContent: 'date,type,amount,category\n' });
      expect(unauthPreview.status).toBe(401);
      expect(unauthPreview.headers['content-type']).toContain('application/problem+json');

      const regA = await request(server).post('/api/v1/auth/register').send({
        email: 'http-imp-a@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP Import A',
      });
      const regB = await request(server).post('/api/v1/auth/register').send({
        email: 'http-imp-b@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP Import B',
      });

      const tokenA = regA.body.accessToken as string;
      const tokenB = regB.body.accessToken as string;
      const userBAccId = regB.body.defaultAccount.id as string;

      const catsA = await request(server)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${tokenA}`);
      const expCatA = catsA.body.find((c: { kind: string }) => c.kind === CategoryKind.EXPENSE);

      const catsB = await request(server)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${tokenB}`);
      const expCatB = catsB.body.find((c: { kind: string }) => c.kind === CategoryKind.EXPENSE);

      // Cross-user accountId on preview -> 404
      const crossAccPreview = await request(server)
        .post('/api/v1/imports/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: userBAccId,
          csvContent: 'date,type,amount,category\n2026-11-20,EXPENSE,10000,Ăn uống',
        });
      expect(crossAccPreview.status).toBe(404);

      // Cross-user accountId on commit -> 404
      const crossAccCommit = await request(server)
        .post('/api/v1/imports/commit')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          accountId: userBAccId,
          rows: [
            {
              entryType: 'EXPENSE',
              transactionDate: '2026-11-20',
              amountMinor: '10000',
              categoryId: expCatA.id,
            },
          ],
        });
      expect(crossAccCommit.status).toBe(404);

      // Cross-user categoryId on commit -> 404 (and atomic rollback of row 1!)
      const crossCatCommit = await request(server)
        .post('/api/v1/imports/commit')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          rows: [
            {
              entryType: 'EXPENSE',
              transactionDate: '2026-11-20',
              amountMinor: '10000',
              categoryId: expCatA.id,
              description: 'First row should roll back',
            },
            {
              entryType: 'EXPENSE',
              transactionDate: '2026-11-20',
              amountMinor: '20000',
              categoryId: expCatB.id,
            },
          ],
        });
      expect(crossCatCommit.status).toBe(404);
      expect(
        Array.from(db.state.transactions.values()).filter((t) => t.userId === regA.body.user.id),
      ).toHaveLength(0);

      // >500 rows on preview -> 422
      const lines501 = ['date,type,amount,category'];
      for (let i = 1; i <= 501; i += 1) {
        lines501.push(`2026-11-20,EXPENSE,${i},Ăn uống`);
      }
      const over500Preview = await request(server)
        .post('/api/v1/imports/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ csvContent: lines501.join('\n') });
      expect(over500Preview.status).toBe(422);
      expect(over500Preview.body.code).toBe('IMPORT_ROW_LIMIT_EXCEEDED');

      // >500 rows on commit -> 422
      const rows501 = Array.from({ length: 501 }, () => ({
        entryType: 'EXPENSE',
        transactionDate: '2026-11-20',
        amountMinor: '1000',
        categoryId: expCatA.id,
      }));
      const over500Commit = await request(server)
        .post('/api/v1/imports/commit')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({ rows: rows501 });
      expect(over500Commit.status).toBe(422);
      expect(over500Commit.body.code).toBe('IMPORT_ROW_LIMIT_EXCEEDED');

      // > 1 MB CSV payload over HTTP -> 422 (requires express.json limit > 1MB)
      const hugeCsv = `date,type,amount,category,description\n2026-11-20,EXPENSE,1000,Ăn uống,${'a'.repeat(1_048_600)}`;
      const over1MbRes = await request(server)
        .post('/api/v1/imports/preview')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ csvContent: hugeCsv });
      expect(over1MbRes.status).toBe(422);
      expect(over1MbRes.body.code).toBe('CSV_PAYLOAD_TOO_LARGE');

      // Mass assignment attempt (T-04) inside rows[0] -> 400
      const massAssignRes = await request(server)
        .post('/api/v1/imports/commit')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          rows: [
            {
              entryType: 'EXPENSE',
              transactionDate: '2026-11-20',
              amountMinor: '10000',
              categoryId: expCatA.id,
              userId: regB.body.user.id,
            },
          ],
        });
      expect(massAssignRes.status).toBe(400);

      // RedactedLogger redacts counterparty & csvContent
      const captured: string[] = [];
      const sink: LogSink = { write: (_l, s) => captured.push(s) };
      const logger = new RedactedLogger(sink);
      logger.logEvent('log', 'import_debug', 'ImportsService', {
        userId: 'u-imp-1',
        counterparty: 'Secret Merchant Co',
        csvContent: '2026-11-20,EXPENSE,50000,Food',
        importedCount: 3,
      });
      expect(captured[0]).toContain('u-imp-1');
      expect(captured[0]).toContain('"importedCount":3');
      expect(captured[0]).not.toContain('Secret Merchant Co');
      expect(captured[0]).not.toContain('50000');
    });

    it('enforces per-user rate limiting on POST /api/v1/imports/commit (429 + Retry-After)', async () => {
      const server = app.getHttpServer();

      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'import-rl@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Import RL User',
      });
      const token = reg.body.accessToken as string;
      const cats = await request(server)
        .get('/api/v1/categories?kind=EXPENSE')
        .set('Authorization', `Bearer ${token}`);
      const expCatId = cats.body[0].id as string;

      // Default limit = 5 requests per 3600s
      for (let i = 0; i < 5; i += 1) {
        const ok = await request(server)
          .post('/api/v1/imports/commit')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID())
          .send({
            rows: [
              {
                entryType: 'EXPENSE',
                transactionDate: '2026-11-20',
                amountMinor: String(1000 + i),
                categoryId: expCatId,
              },
            ],
          });
        expect(ok.status).toBe(201);
        expect(ok.headers['x-ratelimit-limit']).toBe('5');
      }

      const blocked = await request(server)
        .post('/api/v1/imports/commit')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          rows: [
            {
              entryType: 'EXPENSE',
              transactionDate: '2026-11-20',
              amountMinor: '9999',
              categoryId: expCatId,
            },
          ],
        });
      expect(blocked.status).toBe(429);
      expect(blocked.headers['content-type']).toContain('application/problem+json');
      expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Real PostgreSQL (PGlite) E2E Verification for ImportsModule', () => {
    let pg: LocalPGliteExecutor;
    let app: INestApplication;

    beforeAll(async () => {
      pg = new LocalPGliteExecutor();
      await pg.init();

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(APP_CONFIG)
        .useValue(TEST_APP_CONFIG)
        .overrideProvider(DatabaseService)
        .useValue(pg)
        .overrideProvider(DATABASE_EXECUTOR)
        .useValue(pg)
        .compile();

      app = moduleRef.createNestApplication();
      configureHttpApp(app, TEST_APP_CONFIG);
      await app.init();
    }, 30000);

    afterAll(async () => {
      if (app) {
        await app.close();
      }
      if (pg) {
        await pg.close();
      }
    });

    it('runs preview duplicate detection, atomic PG transaction rollback, commit + audit log, and idempotent replay on real PostgreSQL', async () => {
      const server = app.getHttpServer();

      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'pg-import@example.com',
        password: 'StrongPassword1234!',
        fullName: 'PG Import User',
        baseCurrencyCode: 'VND',
      });
      expect(reg.status).toBe(201);
      const token = reg.body.accessToken as string;
      const userId = reg.body.user.id as string;
      const defaultAccId = reg.body.defaultAccount.id as string;

      const catsRes = await request(server)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${token}`);
      const salaryCat = catsRes.body.find(
        (c: { kind: string; name: string }) => c.kind === 'INCOME' && c.name === 'Lương',
      );
      const foodCat = catsRes.body.find(
        (c: { kind: string; name: string }) => c.kind === 'EXPENSE' && c.name === 'Ăn uống',
      );

      // Seed an existing transaction in PG so preview detects DB duplicate
      const seedRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          categoryId: foodCat.id,
          amount: '45000',
          transactionDate: '2026-11-15',
          description: 'Existing PG expense',
        });
      expect(seedRes.status).toBe(201);

      // Preview CSV against real PgLedgerRepository
      const previewRes = await request(server)
        .post('/api/v1/imports/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({
          csvContent: [
            'date,type,amount,category,description,counterparty',
            '2026-11-15,EXPENSE,45000,Ăn uống,Duplicate of PG tx,Coffee House',
            '2026-11-16,INCOME,10000000,Lương,November payroll,TechCorp',
            '2026-11-17,EXPENSE,55000,Ăn uống,Lunch bowl,Pho 24',
            '2026-11-18,EXPENSE,12.50,Ăn uống,Invalid VND decimal,',
          ].join('\n'),
        });
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.accountId).toBe(defaultAccId);
      expect(previewRes.body.totalRows).toBe(4);
      expect(previewRes.body.validRows).toBe(2);
      expect(previewRes.body.duplicateRows).toBe(1);
      expect(previewRes.body.invalidRows).toBe(1);
      expect(previewRes.body.rows[0].status).toBe('DUPLICATE_SUSPECTED');

      // Atomic PG rollback test: row 1 valid, row 2 invalid calendar date -> 422 and 0 new rows in PG
      const rollbackRes = await request(server)
        .post('/api/v1/imports/commit')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          rows: [
            {
              entryType: 'INCOME',
              transactionDate: '2026-11-16',
              amountMinor: '10000000',
              categoryId: salaryCat.id,
              description: 'Rollback check',
              counterparty: 'TechCorp',
            },
            {
              entryType: 'EXPENSE',
              transactionDate: '2026-02-30',
              amountMinor: '55000',
              categoryId: foodCat.id,
            },
          ],
        });
      expect(rollbackRes.status).toBe(422);

      const countAfterRollback = await pg.query<{ cnt: string }>(
        'SELECT COUNT(*)::text AS cnt FROM transactions WHERE user_id = $1',
        [userId],
      );
      expect(countAfterRollback.rows[0].cnt).toBe('1'); // Only the seeded expense exists

      // Commit the 2 valid rows atomically
      const commitKey = randomUUID();
      const commitPayload = {
        rows: [
          {
            entryType: 'INCOME',
            transactionDate: '2026-11-16',
            amountMinor: '10000000',
            categoryId: salaryCat.id,
            description: 'November payroll',
            counterparty: 'TechCorp',
          },
          {
            entryType: 'EXPENSE',
            transactionDate: '2026-11-17',
            amountMinor: '55000',
            categoryId: foodCat.id,
            description: 'Lunch bowl',
            counterparty: 'Pho 24',
          },
        ],
      };

      const commitRes = await request(server)
        .post('/api/v1/imports/commit')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', commitKey)
        .send(commitPayload);
      expect(commitRes.status).toBe(201);
      expect(commitRes.body.accountId).toBe(defaultAccId);
      expect(commitRes.body.importedCount).toBe(2);
      expect(commitRes.body.skippedCount).toBe(0);
      expect(commitRes.body.transactionIds).toHaveLength(2);

      // Idempotent replay on PG
      const replayRes = await request(server)
        .post('/api/v1/imports/commit')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', commitKey)
        .send(commitPayload);
      expect(replayRes.status).toBe(201);
      expect(replayRes.body).toEqual(commitRes.body);

      // Verify posted balance in PG: -45,000 + 10,000,000 - 55,000 = 9,900,000
      const accRes = await request(server)
        .get(`/api/v1/accounts/${defaultAccId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(accRes.status).toBe(200);
      expect(accRes.body.postedBalanceMinor).toBe('9900000');
      expect(accRes.body.transactionCount).toBe(3);

      // Verify single redacted BULK_IMPORT_COMMITTED audit log in PG
      const auditRes = await pg.query<{ action: string; metadata: { importedCount?: number } }>(
        `SELECT action, metadata
         FROM audit_logs
         WHERE user_id = $1 AND action = 'BULK_IMPORT_COMMITTED'`,
        [userId],
      );
      expect(auditRes.rows).toHaveLength(1);
      expect(auditRes.rows[0].metadata).toEqual({ importedCount: 2 });
    });
  });
});
