import { ArgumentsHost } from '@nestjs/common';
import { Rfc9457ExceptionFilter } from '../src/shared-kernel/filters/rfc9457-exception.filter';
import { ValidationDomainException } from '../src/shared-kernel/domain/domain-exceptions';
import {
  LogSink,
  REDACTED_VALUE,
  RedactedLogger,
} from '../src/shared-kernel/logging/redacted-logger';

describe('RedactedLogger & Rfc9457ExceptionFilter (T-07 Log Redaction)', () => {
  it('redacts description, note, merchant, amount, password, token, and email across nested structures', () => {
    const captured: string[] = [];
    const sink: LogSink = {
      write: (_level, line) => {
        captured.push(line);
      },
    };
    const logger = new RedactedLogger(sink);

    logger.logEvent('log', 'transaction_attempt', 'IncomeService', {
      userId: 'user-uuid-1234',
      accountId: 'acc-uuid-5678',
      description: 'Monthly Salary Secret Memo',
      note: 'Private personal note',
      merchant: 'Highlands Coffee',
      merchantName: 'GrabFood',
      amount: '25000000',
      amountMinor: 25000000n,
      openingBalanceMinor: 500000n,
      password: 'SuperSecretPassword123!',
      token: 'opaque-refresh-secret-xyz',
      accessToken: 'jwt.header.payload',
      email: 'alice@example.com',
      nested: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        balance: '99999999',
      },
      inlineText: 'Bearer mySecretTokenValue123 password=MyRawPassword99',
    });

    expect(captured).toHaveLength(1);
    const line = captured[0];

    expect(line).toContain('user-uuid-1234');
    expect(line).toContain(REDACTED_VALUE);

    const forbiddenValues = [
      'Monthly Salary Secret Memo',
      'Private personal note',
      'Highlands Coffee',
      'GrabFood',
      '25000000',
      '500000',
      'SuperSecretPassword123!',
      'opaque-refresh-secret-xyz',
      'jwt.header.payload',
      'alice@example.com',
      'eyJhbGciOiJIUzI1NiJ9',
      '99999999',
      'mySecretTokenValue123',
      'MyRawPassword99',
    ];

    for (const secret of forbiddenValues) {
      expect(line).not.toContain(secret);
    }
  });

  it('handles circular references and Error instances safely without throwing', () => {
    const captured: string[] = [];
    const logger = new RedactedLogger({ write: (_l, s) => captured.push(s) });

    const circular: Record<string, unknown> = { ok: true, password: 'hidden' };
    circular.self = circular;

    logger.error(new Error('DB failure with token=secret123'), circular as never, 'TestCtx');

    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toContain('hidden');
    expect(captured[0]).not.toContain('secret123');
    expect(captured[0]).toContain('[Circular]');
  });

  it('redacts MFA secrets, otpauth URIs, recovery codes, MFA codes, and base64 attachment payloads', () => {
    const captured: string[] = [];
    const logger = new RedactedLogger({ write: (_l, s) => captured.push(s) });

    logger.logEvent('log', 'mfa_and_attachment_attempt', 'SecurityTest', {
      userId: 'user-uuid-9999',
      totpSecret: 'raw-totp-secret-value',
      secretBase32: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/SoTaiChinh:alice%40example.com?secret=JBSWY3DPEHPK3PXP',
      recoveryCodes: ['A1B2C-3D4E5', 'F6A7B-8C9D0'],
      mfaCode: '654321',
      contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
      inlineMfa: 'otpauthUri=otpauth://totp/SoTaiChinh:bob@example.com?secret=XYZ123 mfaCode=112233',
    });

    expect(captured).toHaveLength(1);
    const line = captured[0];
    expect(line).toContain('user-uuid-9999');
    expect(line).toContain(REDACTED_VALUE);

    const forbiddenValues = [
      'raw-totp-secret-value',
      'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      'JBSWY3DPEHPK3PXP',
      'A1B2C-3D4E5',
      'F6A7B-8C9D0',
      '654321',
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
      'bob@example.com',
      'XYZ123',
      '112233',
    ];
    for (const secret of forbiddenValues) {
      expect(line).not.toContain(secret);
    }
  });

  it('formats DomainException and unexpected 500 errors as RFC 9457 application/problem+json without stack traces', () => {
    const captured: string[] = [];
    const logger = new RedactedLogger({ write: (_l, s) => captured.push(s) });
    const filter = new Rfc9457ExceptionFilter(logger);

    const makeHost = () => {
      let statusCode = 0;
      const headers: Record<string, string> = {};
      let jsonBody: unknown;
      const response = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        setHeader(name: string, val: string) {
          headers[name] = val;
          return this;
        },
        json(body: unknown) {
          jsonBody = body;
          return this;
        },
      };
      const request = {
        url: '/api/v1/incomes',
        path: '/api/v1/incomes',
        method: 'POST',
        headers: { 'x-correlation-id': 'corr-1' },
      };
      const host = {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => request,
        }),
      } as unknown as ArgumentsHost;

      return {
        host,
        getResult: () => ({ statusCode, headers, jsonBody }),
      };
    };

    const h1 = makeHost();
    filter.catch(new ValidationDomainException('Invalid amount', 'INVALID_AMOUNT'), h1.host);
    const r1 = h1.getResult();
    expect(r1.statusCode).toBe(422);
    expect(r1.headers['Content-Type']).toContain('application/problem+json');
    expect(r1.jsonBody).toMatchObject({
      status: 422,
      code: 'INVALID_AMOUNT',
      detail: 'Invalid amount',
      instance: '/api/v1/incomes',
      correlationId: 'corr-1',
    });

    const h2 = makeHost();
    const internalErr = new Error('SELECT password_hash FROM users failed');
    filter.catch(internalErr, h2.host);
    const r2 = h2.getResult();
    expect(r2.statusCode).toBe(500);
    expect(JSON.stringify(r2.jsonBody)).not.toContain('password_hash');
    expect(JSON.stringify(r2.jsonBody)).not.toContain('stack');
  });
});
