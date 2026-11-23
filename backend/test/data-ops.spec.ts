import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  buildCsvDocument,
  sanitizeCsvCell,
} from '../src/modules/data-ops/csv-sanitizer';
import {
  LogSink,
  RedactedLogger,
} from '../src/shared-kernel/logging/redacted-logger';
import { createFullHttpTestApp } from './helpers/test-app';

describe('Slice 6B — DataOpsModule (CSV/JSON Export, CSV Injection Protection, Step-up Account Deletion)', () => {
  describe('CSV Formula Injection Sanitization (T-06)', () => {
    it('prefixes single quote on cells starting with =, +, -, @, \\t, \\r (including after leading spaces)', () => {
      expect(sanitizeCsvCell("=cmd|'/C calc'!A0")).toBe("'=cmd|'/C calc'!A0");
      expect(sanitizeCsvCell('+1+1')).toBe("'+1+1");
      expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
      expect(sanitizeCsvCell('@SUM(1+1)')).toBe("'@SUM(1+1)");
      expect(sanitizeCsvCell('@SUM(1,1)')).toBe('"\'@SUM(1,1)"');
      expect(sanitizeCsvCell('\t=1+1')).toBe("'\t=1+1");
      expect(sanitizeCsvCell('\r=1+1')).toBe('"\'\r=1+1"');
      expect(sanitizeCsvCell('  =1+1')).toBe("'  =1+1");
      expect(sanitizeCsvCell('=HYPERLINK("http://evil.local","Click")')).toBe(
        '"\'=HYPERLINK(""http://evil.local"",""Click"")"',
      );

      // Safe values remain unmodified
      expect(sanitizeCsvCell('2026-11-23')).toBe('2026-11-23');
      expect(sanitizeCsvCell('150000')).toBe('150000');
      expect(sanitizeCsvCell('Coffee - Morning')).toBe('Coffee - Morning');
      expect(sanitizeCsvCell(null)).toBe('');

      const doc = buildCsvDocument(['description', 'note'], [['=1+1', '+cmd']]);
      expect(doc).toBe("description,note\r\n'=1+1,'+cmd\r\n");
    });
  });

  describe('HTTP Pipeline: Exports, Cross-User Isolation, Step-Up Delete & Login Block, Log Redaction', () => {
    let app: INestApplication;
    let db: Awaited<ReturnType<typeof createFullHttpTestApp>>['db'];

    beforeAll(async () => {
      ({ app, db } = await createFullHttpTestApp());
    });

    afterAll(async () => {
      await app.close();
    });

    it('exports CSV (with formula injection neutralized) and JSON strictly scoped to authenticated user', async () => {
      const server = app.getHttpServer();

      const regA = await request(server).post('/api/v1/auth/register').send({
        email: 'export-a@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Export User A',
      });
      const regB = await request(server).post('/api/v1/auth/register').send({
        email: 'export-b@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Export User B',
      });

      const tokenA = regA.body.accessToken as string;
      const tokenB = regB.body.accessToken as string;

      const catsA = await request(server)
        .get('/api/v1/categories?kind=EXPENSE')
        .set('Authorization', `Bearer ${tokenA}`);
      const catsB = await request(server)
        .get('/api/v1/categories?kind=EXPENSE')
        .set('Authorization', `Bearer ${tokenB}`);

      // User A creates malicious formula payloads in description and note
      await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          categoryId: catsA.body[0].id,
          amount: '125000',
          description: '=cmd|"/C calc"!A0',
          note: '@SUM(1+1)',
          transactionDate: '2026-11-21',
        });

      await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          categoryId: catsA.body[0].id,
          amount: '45000',
          description: '+2+5',
          note: '-10+20',
          transactionDate: '2026-11-22',
        });

      // User B creates secret expense that MUST NOT appear in User A's export
      await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          categoryId: catsB.body[0].id,
          amount: '999999',
          description: 'USER_B_CONFIDENTIAL_TX',
          transactionDate: '2026-11-22',
        });

      // Cross-user accountId filter -> 404
      const crossAccountExport = await request(server)
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          format: 'JSON',
          accountId: regB.body.defaultAccount.id,
        });
      expect(crossAccountExport.status).toBe(404);

      // CSV Export
      const csvRes = await request(server)
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ format: 'CSV' });
      expect(csvRes.status).toBe(200);
      expect(csvRes.headers['content-type']).toContain('text/csv');
      expect(csvRes.headers['content-disposition']).toContain('attachment;');
      expect(csvRes.text).toContain('\'=cmd|""/C calc""!A0');
      expect(csvRes.text).toContain("'@SUM(1+1)");
      expect(csvRes.text).toContain("'+2+5");
      expect(csvRes.text).toContain("'-10+20");
      expect(csvRes.text).not.toContain('USER_B_CONFIDENTIAL_TX');

      // JSON Export
      const jsonRes = await request(server)
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ format: 'JSON' });
      expect(jsonRes.status).toBe(200);
      expect(jsonRes.body.user.email).toBe('export-a@example.com');
      expect(jsonRes.body.user.passwordHash).toBeUndefined();
      expect(jsonRes.body.transactions).toHaveLength(2);
      expect(JSON.stringify(jsonRes.body)).not.toContain('USER_B_CONFIDENTIAL_TX');
      expect(JSON.stringify(jsonRes.body)).not.toContain('StrongPassword1234!');

      // Audit logs recorded export without leaking sensitive descriptions/amounts
      const exportAudit = db.state.auditLogs.find(
        (a) => a.input.userId === regA.body.user.id && a.input.action === 'DATA_EXPORT_GENERATED',
      );
      expect(exportAudit).toBeDefined();
      expect(JSON.stringify(exportAudit)).not.toContain('125000');
      expect(JSON.stringify(exportAudit)).not.toContain('calc');
    });

    it('requires step-up password on DELETE /api/v1/users/me, sets 14-day deletion, revokes all sessions, and blocks login', async () => {
      const server = app.getHttpServer();

      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'delete-me@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Delete Me',
      });
      expect(reg.status).toBe(201);
      const userId = reg.body.user.id as string;
      const token1 = reg.body.accessToken as string;
      const regCookies = reg.headers['set-cookie'] as unknown as string[];

      // Create a second active session via login
      const login2 = await request(server).post('/api/v1/auth/login').send({
        email: 'delete-me@example.com',
        password: 'StrongPassword1234!',
      });
      expect(login2.status).toBe(200);
      const token2 = login2.body.accessToken as string;
      const login2Cookies = login2.headers['set-cookie'] as unknown as string[];

      // Missing password -> 401
      const missingPwd = await request(server)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token1}`)
        .send({});
      expect(missingPwd.status).toBe(401);

      // Wrong password -> 401 and user remains active
      const wrongPwd = await request(server)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token1}`)
        .send({ password: 'WrongPassword1234!' });
      expect(wrongPwd.status).toBe(401);
      expect(db.state.users.get(userId)!.deletionScheduledAt).toBeNull();

      // Correct password -> 200, sets deletion_scheduled_at ~14 days, revokes ALL sessions, logs audit
      const beforeCallMs = Date.now();
      const delRes = await request(server)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token1}`)
        .send({ password: 'StrongPassword1234!' });
      const afterCallMs = Date.now();

      expect(delRes.status).toBe(200);
      expect(delRes.body.userId).toBe(userId);
      expect(delRes.body.gracePeriodDays).toBe(14);
      expect(delRes.body.sessionsRevoked).toBe(true);

      const scheduledMs = Date.parse(delRes.body.deletionScheduledAt as string);
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      expect(scheduledMs).toBeGreaterThanOrEqual(beforeCallMs + fourteenDaysMs - 5000);
      expect(scheduledMs).toBeLessThanOrEqual(afterCallMs + fourteenDaysMs + 5000);

      const storedUser = db.state.users.get(userId)!;
      expect(storedUser.deletionScheduledAt).not.toBeNull();

      // All user_sessions must be revoked
      const userSessions = Array.from(db.state.sessions.values()).filter(
        (s) => s.userId === userId,
      );
      expect(userSessions.length).toBeGreaterThanOrEqual(2);
      expect(userSessions.every((s) => s.revokedAt !== null)).toBe(true);

      // Audit log contains ACCOUNT_DELETION_SCHEDULED
      const delAudit = db.state.auditLogs.find(
        (a) => a.input.userId === userId && a.input.action === 'ACCOUNT_DELETION_SCHEDULED',
      );
      expect(delAudit).toBeDefined();

      // Existing access tokens from all sessions MUST immediately return 401
      const staleMe1 = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token1}`);
      expect(staleMe1.status).toBe(401);
      expect(staleMe1.body.code).toBe('UNAUTHORIZED');

      const staleMe2 = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token2}`);
      expect(staleMe2.status).toBe(401);
      expect(staleMe2.body.code).toBe('UNAUTHORIZED');

      // Refresh tokens from both sessions must fail (401)
      const refresh1 = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', regCookies)
        .send({});
      expect(refresh1.status).toBe(401);

      const refresh2 = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', login2Cookies)
        .send({});
      expect(refresh2.status).toBe(401);

      // Subsequent login MUST be blocked when deletion_scheduled_at IS NOT NULL
      const loginAfterDelete = await request(server).post('/api/v1/auth/login').send({
        email: 'delete-me@example.com',
        password: 'StrongPassword1234!',
      });
      expect(loginAfterDelete.status).toBe(401);
      expect(loginAfterDelete.body.code).toBe('ACCOUNT_DELETION_SCHEDULED');
    });

    it('redacts Slice 4/5/6 monetary fields and step-up passwords in RedactedLogger', () => {
      const captured: string[] = [];
      const sink: LogSink = { write: (_l, s) => captured.push(s) };
      const logger = new RedactedLogger(sink);

      logger.logEvent('log', 'slice456_audit', 'DataOpsService', {
        userId: 'u-1',
        password: 'DeletePasswordSecret!',
        feeMinor: 15000n,
        limitMinor: 5000000n,
        actualSpentMinor: 4200000n,
        exchangeRate: '25450.00000000',
        netCashFlowMinor: '19000000',
      });

      const line = captured[0];
      expect(line).toContain('u-1');
      expect(line).not.toContain('DeletePasswordSecret!');
      expect(line).not.toContain('15000');
      expect(line).not.toContain('5000000');
      expect(line).not.toContain('4200000');
      expect(line).not.toContain('25450');
      expect(line).not.toContain('19000000');
    });
  });
});
