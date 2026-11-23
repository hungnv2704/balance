import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadAppConfig } from '../src/config/app-config';
import { createFullHttpTestApp } from './helpers/test-app';

describe('Gate C Security Controls — Session Revocation & Rate Limiting', () => {
  describe('AppConfig Rate Limit Configuration', () => {
    it('enables sensible rate limits by default and supports positive integer env overrides', () => {
      const defaults = loadAppConfig({});
      expect(defaults.rateLimitAuthMax).toBe(10);
      expect(defaults.rateLimitAuthWindowSeconds).toBe(60);
      expect(defaults.rateLimitExportMax).toBe(5);
      expect(defaults.rateLimitExportWindowSeconds).toBe(3600);

      const overridden = loadAppConfig({
        RATE_LIMIT_AUTH_MAX: '25',
        RATE_LIMIT_AUTH_WINDOW_SECONDS: '120',
        RATE_LIMIT_EXPORT_MAX: '8',
        RATE_LIMIT_EXPORT_WINDOW_SECONDS: '1800',
      });
      expect(overridden.rateLimitAuthMax).toBe(25);
      expect(overridden.rateLimitAuthWindowSeconds).toBe(120);
      expect(overridden.rateLimitExportMax).toBe(8);
      expect(overridden.rateLimitExportWindowSeconds).toBe(1800);

      const invalidFallback = loadAppConfig({
        RATE_LIMIT_AUTH_MAX: '0',
        RATE_LIMIT_AUTH_WINDOW_SECONDS: '-5',
        RATE_LIMIT_EXPORT_MAX: 'abc',
      });
      expect(invalidFallback.rateLimitAuthMax).toBe(10);
      expect(invalidFallback.rateLimitAuthWindowSeconds).toBe(60);
      expect(invalidFallback.rateLimitExportMax).toBe(5);
    });
  });

  describe('Immediate Access Token Revocation (AuthGuard)', () => {
    let app: INestApplication;
    let db: Awaited<ReturnType<typeof createFullHttpTestApp>>['db'];

    beforeEach(async () => {
      ({ app, db } = await createFullHttpTestApp());
    });

    afterEach(async () => {
      await app.close();
    });

    it('immediately rejects stale accessToken with 401 after POST /api/v1/auth/logout-all', async () => {
      const server = app.getHttpServer();

      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'revoke-all@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Revoke All User',
      });
      expect(reg.status).toBe(201);
      const token1 = reg.body.accessToken as string;

      const login2 = await request(server).post('/api/v1/auth/login').send({
        email: 'revoke-all@example.com',
        password: 'StrongPassword1234!',
      });
      expect(login2.status).toBe(200);
      const token2 = login2.body.accessToken as string;

      // Both tokens work prior to logout-all
      expect(
        (await request(server).get('/api/v1/auth/me').set('Authorization', `Bearer ${token1}`))
          .status,
      ).toBe(200);
      expect(
        (await request(server).get('/api/v1/accounts').set('Authorization', `Bearer ${token2}`))
          .status,
      ).toBe(200);

      // Call logout-all using session 1
      const logoutAllRes = await request(server)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${token1}`);
      expect(logoutAllRes.status).toBe(204);

      // Both token1 and token2 must immediately fail with 401 UNAUTHORIZED
      const replay1 = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token1}`);
      expect(replay1.status).toBe(401);
      expect(replay1.headers['content-type']).toContain('application/problem+json');
      expect(replay1.body.code).toBe('UNAUTHORIZED');

      const replay2 = await request(server)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${token2}`);
      expect(replay2.status).toBe(401);
      expect(replay2.headers['content-type']).toContain('application/problem+json');
      expect(replay2.body.code).toBe('UNAUTHORIZED');
    });

    it('immediately rejects stale accessToken with 401 after DELETE /api/v1/users/me', async () => {
      const server = app.getHttpServer();

      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'revoke-del@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Revoke Delete User',
      });
      expect(reg.status).toBe(201);
      const token1 = reg.body.accessToken as string;

      const login2 = await request(server).post('/api/v1/auth/login').send({
        email: 'revoke-del@example.com',
        password: 'StrongPassword1234!',
      });
      expect(login2.status).toBe(200);
      const token2 = login2.body.accessToken as string;

      const delRes = await request(server)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${token1}`)
        .send({ password: 'StrongPassword1234!' });
      expect(delRes.status).toBe(200);

      // Stale tokens from both sessions immediately return 401
      const afterDel1 = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token1}`);
      expect(afterDel1.status).toBe(401);
      expect(afterDel1.body.code).toBe('UNAUTHORIZED');

      const afterDel2 = await request(server)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${token2}`);
      expect(afterDel2.status).toBe(401);
      expect(afterDel2.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects accessToken on single-session logout, expired session, and deletion_scheduled_at', async () => {
      const server = app.getHttpServer();

      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'revoke-single@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Single Logout User',
      });
      const userId = reg.body.user.id as string;
      const token1 = reg.body.accessToken as string;
      const cookies1 = reg.headers['set-cookie'] as unknown as string[];

      const login2 = await request(server).post('/api/v1/auth/login').send({
        email: 'revoke-single@example.com',
        password: 'StrongPassword1234!',
      });
      const token2 = login2.body.accessToken as string;

      // Single-session logout revokes session 1 only
      const logoutRes = await request(server)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookies1)
        .send({});
      expect(logoutRes.status).toBe(204);

      expect(
        (await request(server).get('/api/v1/auth/me').set('Authorization', `Bearer ${token1}`))
          .status,
      ).toBe(401);
      expect(
        (await request(server).get('/api/v1/auth/me').set('Authorization', `Bearer ${token2}`))
          .status,
      ).toBe(200);

      // Force session 2 to appear expired in DB -> 401
      for (const [sid, session] of db.state.sessions.entries()) {
        if (session.userId === userId && session.revokedAt === null) {
          db.state.sessions.set(sid, {
            ...session,
            expiresAt: new Date(Date.now() - 1000),
          });
        }
      }
      expect(
        (await request(server).get('/api/v1/auth/me').set('Authorization', `Bearer ${token2}`))
          .status,
      ).toBe(401);

      // Restore session expiry, but set deletion_scheduled_at directly -> 401
      for (const [sid, session] of db.state.sessions.entries()) {
        if (session.userId === userId && session.revokedAt === null) {
          db.state.sessions.set(sid, {
            ...session,
            expiresAt: new Date(Date.now() + 60_000),
          });
        }
      }
      const user = db.state.users.get(userId)!;
      db.state.users.set(userId, { ...user, deletionScheduledAt: new Date() });

      const deletedUserRes = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token2}`);
      expect(deletedUserRes.status).toBe(401);
      expect(deletedUserRes.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Rate Limiting (429 Too Many Requests + RFC 9457 + Retry-After)', () => {
    let app: INestApplication;

    beforeEach(async () => {
      ({ app } = await createFullHttpTestApp());
    });

    afterEach(async () => {
      await app.close();
    });

    it('triggers 429 on brute-force POST /api/v1/auth/login with application/problem+json and Retry-After', async () => {
      const server = app.getHttpServer();

      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'bruteforce@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Brute Force Target',
      });
      expect(reg.status).toBe(201);

      // Default auth limit is 10 requests per 60s
      for (let i = 0; i < 10; i += 1) {
        const attempt = await request(server).post('/api/v1/auth/login').send({
          email: 'bruteforce@example.com',
          password: 'WrongPassword1234!',
        });
        expect(attempt.status).toBe(401);
        expect(attempt.headers['x-ratelimit-limit']).toBe('10');
        expect(attempt.headers['x-ratelimit-remaining']).toBe(String(9 - i));
      }

      // 11th request exceeds threshold -> 429 Too Many Requests
      const blocked = await request(server).post('/api/v1/auth/login').send({
        email: 'bruteforce@example.com',
        password: 'StrongPassword1234!',
      });
      expect(blocked.status).toBe(429);
      expect(blocked.headers['content-type']).toContain('application/problem+json');
      expect(blocked.headers['x-ratelimit-limit']).toBe('10');
      expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
      const retryAfter = Number(blocked.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);
      expect(blocked.body.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blocked.body.title).toBe('Too Many Requests');
    });

    it('enforces rate limit on POST /api/v1/auth/register and POST /api/v1/auth/refresh', async () => {
      const server = app.getHttpServer();

      // Register 10 times (within limit), 11th returns 429
      let cookies: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        const res = await request(server).post('/api/v1/auth/register').send({
          email: `rl-reg-${i}@example.com`,
          password: 'StrongPassword1234!',
          fullName: `RL User ${i}`,
        });
        expect(res.status).toBe(201);
        if (i === 0) {
          cookies = res.headers['set-cookie'] as unknown as string[];
        }
      }

      const regBlocked = await request(server).post('/api/v1/auth/register').send({
        email: 'rl-reg-overflow@example.com',
        password: 'StrongPassword1234!',
        fullName: 'RL Overflow',
      });
      expect(regBlocked.status).toBe(429);
      expect(regBlocked.headers['content-type']).toContain('application/problem+json');
      expect(Number(regBlocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);

      // Refresh 10 times (rotating cookie each time), 11th returns 429
      let activeCookies = cookies;
      for (let i = 0; i < 10; i += 1) {
        const res = await request(server)
          .post('/api/v1/auth/refresh')
          .set('Cookie', activeCookies)
          .send({});
        expect(res.status).toBe(200);
        activeCookies = res.headers['set-cookie'] as unknown as string[];
      }

      const refreshBlocked = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', activeCookies)
        .send({});
      expect(refreshBlocked.status).toBe(429);
      expect(refreshBlocked.headers['content-type']).toContain('application/problem+json');
      expect(Number(refreshBlocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    });

    it('enforces 5/hour per-user rate limit on POST /api/v1/exports while isolating separate users', async () => {
      const server = app.getHttpServer();

      // Unauthenticated request gets 401 from AuthGuard before rate limiter
      const unauth = await request(server).post('/api/v1/exports').send({ format: 'JSON' });
      expect(unauth.status).toBe(401);

      const regA = await request(server).post('/api/v1/auth/register').send({
        email: 'export-rl-a@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Export RL A',
      });
      const regB = await request(server).post('/api/v1/auth/register').send({
        email: 'export-rl-b@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Export RL B',
      });

      const tokenA = regA.body.accessToken as string;
      const tokenB = regB.body.accessToken as string;

      // User A: 5 exports succeed
      for (let i = 0; i < 5; i += 1) {
        const res = await request(server)
          .post('/api/v1/exports')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ format: 'JSON' });
        expect(res.status).toBe(200);
      }

      // User A: 6th export -> 429
      const blockedA = await request(server)
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ format: 'JSON' });
      expect(blockedA.status).toBe(429);
      expect(blockedA.headers['content-type']).toContain('application/problem+json');
      expect(blockedA.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(Number(blockedA.headers['retry-after'])).toBeGreaterThanOrEqual(1);

      // User B from same IP still has their own export quota -> 200
      const okB = await request(server)
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ format: 'JSON' });
      expect(okB.status).toBe(200);
    });
  });
});
