import { Injectable, LoggerService, Optional } from '@nestjs/common';

export interface LogSink {
  write(level: 'log' | 'warn' | 'error' | 'debug' | 'verbose', serializedLine: string): void;
}

const DEFAULT_SINK: LogSink = {
  write(level, serializedLine) {
    if (level === 'error') {
      process.stderr.write(`${serializedLine}\n`);
    } else {
      process.stdout.write(`${serializedLine}\n`);
    }
  },
};

export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_EXACT = new Set([
  'description',
  'note',
  'notes',
  'merchant',
  'merchantname',
  'merchant_name',
  'payee',
  'incomesource',
  'income_source',
  'sourcename',
  'source_name',
  'amount',
  'amountminor',
  'amount_minor',
  'amountdecimal',
  'fromamountminor',
  'from_amount_minor',
  'toamountminor',
  'to_amount_minor',
  'openingbalanceminor',
  'opening_balance_minor',
  'openingbalance',
  'opening_balance',
  'balance',
  'postedbalanceminor',
  'posted_balance_minor',
  'pendinginminor',
  'pending_in_minor',
  'pendingoutminor',
  'pending_out_minor',
  'password',
  'passwordhash',
  'password_hash',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'refreshtokenhash',
  'refresh_token_hash',
  'authorization',
  'cookie',
  'setcookie',
  'set-cookie',
  'secret',
  'jwt',
  'email',
  'fullname',
  'full_name',
  'feeminor',
  'fee_minor',
  'limitminor',
  'limit_minor',
  'actualspentminor',
  'actual_spent_minor',
  'remainingminor',
  'remaining_minor',
  'exchangerate',
  'exchange_rate',
  'counterparty',
  'csvcontent',
  'csv_content',
  'totpsecret',
  'totp_secret',
  'totpsecretencrypted',
  'totp_secret_encrypted',
  'secretbase32',
  'secret_base32',
  'otpauthuri',
  'otpauth_uri',
  'recoverycodes',
  'recovery_codes',
  'recoverycode',
  'recovery_code',
  'mfacode',
  'mfa_code',
  'contentbase64',
  'content_base64',
]);

const SENSITIVE_KEY_PATTERN =
  /(password|passphrase|pwd|secret|token|authorization|cookie|description|note|merchant|payee|counterparty|csv_?content|amount|balance|email|full_?name|minor|cash_?flow|exchange_?rate|totp_?secret|secret_?base32|otpauth_?uri|recovery_?codes?|mfa_?code|content_?base64)/i;

const INLINE_BEARER_REGEX = /\bBearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+|\bBearer\s+\S+/gi;
const INLINE_OTPAUTH_REGEX = /otpauth:\/\/[^\s"']+/gi;
const INLINE_KEY_VALUE_REGEX =
  /\b(password|token|refresh_token|access_token|secret|authorization|description|note|merchant|counterparty|amount|amount_minor|amountMinor|totpSecret|totp_secret|secretBase32|secret_base32|otpauthUri|otpauth_uri|recoveryCodes|recovery_codes|mfaCode|mfa_code|contentBase64|content_base64)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;

export function isSensitiveLogKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (SENSITIVE_KEY_EXACT.has(normalized)) {
    return true;
  }
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function redactStringContent(input: string): string {
  return input
    .replace(INLINE_BEARER_REGEX, `Bearer ${REDACTED_VALUE}`)
    .replace(INLINE_OTPAUTH_REGEX, `otpauth://${REDACTED_VALUE}`)
    .replace(INLINE_KEY_VALUE_REGEX, (_match, k: string) => `${k}=${REDACTED_VALUE}`);
}

export function sanitizeForLog(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
  if (key && isSensitiveLogKey(key)) {
    return REDACTED_VALUE;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'string') {
    return redactStringContent(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactStringContent(value.message),
      code: (value as { code?: unknown }).code,
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    return value.map((item) => sanitizeForLog(item, undefined, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
      out[propKey] = sanitizeForLog(propValue, propKey, seen);
    }
    return out;
  }

  return String(value);
}

@Injectable()
export class RedactedLogger implements LoggerService {
  private readonly sink: LogSink;

  constructor(@Optional() sink?: LogSink) {
    this.sink = sink ?? DEFAULT_SINK;
  }

  public log(message: unknown, context?: string, meta?: Record<string, unknown>): void {
    this.emit('log', message, context, meta);
  }

  public warn(message: unknown, context?: string, meta?: Record<string, unknown>): void {
    this.emit('warn', message, context, meta);
  }

  public error(
    message: unknown,
    traceOrMeta?: string | Record<string, unknown>,
    context?: string,
  ): void {
    const meta =
      typeof traceOrMeta === 'object' && traceOrMeta !== null
        ? traceOrMeta
        : undefined;
    // Never emit raw stack traces to structured logs to prevent sensitive payload leakage
    this.emit('error', message, context, meta);
  }

  public debug(message: unknown, context?: string, meta?: Record<string, unknown>): void {
    this.emit('debug', message, context, meta);
  }

  public verbose(message: unknown, context?: string, meta?: Record<string, unknown>): void {
    this.emit('verbose', message, context, meta);
  }

  public logEvent(
    level: 'log' | 'warn' | 'error',
    event: string,
    context: string,
    meta?: Record<string, unknown>,
  ): void {
    this.emit(level, event, context, meta);
  }

  private emit(
    level: 'log' | 'warn' | 'error' | 'debug' | 'verbose',
    message: unknown,
    context?: string,
    meta?: Record<string, unknown>,
  ): void {
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? 'Application',
      message: sanitizeForLog(message),
    };

    if (meta && Object.keys(meta).length > 0) {
      record.meta = sanitizeForLog(meta);
    }

    const line = JSON.stringify(record);
    this.sink.write(level, line);
  }
}
