export interface AppConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly corsOrigins: string[];
  readonly databaseUrl: string;
  readonly pgPoolMax: number;
  readonly jwtAccessSecret: string;
  readonly jwtAccessTtlSeconds: number;
  readonly refreshTokenTtlDays: number;
  readonly mfaEncryptionKey?: string;
  readonly attachmentStorageDir?: string;
  readonly cookieSecure: boolean;
  readonly cookieSameSite: 'lax' | 'strict';
  readonly argon2MemoryKib: number;
  readonly argon2Iterations: number;
  readonly argon2Parallelism: number;
  readonly rateLimitAuthMax: number;
  readonly rateLimitAuthWindowSeconds: number;
  readonly rateLimitExportMax: number;
  readonly rateLimitExportWindowSeconds: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const port = Number(env.PORT ?? 3001);
  const corsOrigins = (env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const jwtAccessSecret =
    env.JWT_ACCESS_SECRET ??
    (nodeEnv === 'production'
      ? (() => {
          throw new Error('JWT_ACCESS_SECRET must be set in production.');
        })()
      : 'dev-only-insecure-secret-change-me-32chars');

  const sameSiteRaw = (env.COOKIE_SAME_SITE ?? 'lax').toLowerCase();
  const cookieSameSite: 'lax' | 'strict' = sameSiteRaw === 'strict' ? 'strict' : 'lax';

  return {
    nodeEnv,
    port: Number.isFinite(port) && port > 0 ? port : 3001,
    corsOrigins,
    databaseUrl:
      env.DATABASE_URL ?? 'postgresql://pfm_user:pfm_local_dev_change_me@localhost:5432/pfm_db',
    pgPoolMax: Number(env.PG_POOL_MAX ?? 10),
    jwtAccessSecret,
    jwtAccessTtlSeconds: Number(env.JWT_ACCESS_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    mfaEncryptionKey: env.MFA_ENCRYPTION_KEY ?? jwtAccessSecret,
    attachmentStorageDir:
      env.ATTACHMENT_STORAGE_DIR && env.ATTACHMENT_STORAGE_DIR.trim().length > 0
        ? env.ATTACHMENT_STORAGE_DIR.trim()
        : undefined,
    cookieSecure: env.COOKIE_SECURE === 'true' || nodeEnv === 'production',
    cookieSameSite,
    argon2MemoryKib: Number(env.ARGON2_MEMORY_KIB ?? 19456),
    argon2Iterations: Number(env.ARGON2_ITERATIONS ?? 2),
    argon2Parallelism: Number(env.ARGON2_PARALLELISM ?? 1),
    rateLimitAuthMax: parsePositiveInt(env.RATE_LIMIT_AUTH_MAX, 10),
    rateLimitAuthWindowSeconds: parsePositiveInt(env.RATE_LIMIT_AUTH_WINDOW_SECONDS, 60),
    rateLimitExportMax: parsePositiveInt(env.RATE_LIMIT_EXPORT_MAX, 5),
    rateLimitExportWindowSeconds: parsePositiveInt(env.RATE_LIMIT_EXPORT_WINDOW_SECONDS, 3600),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
