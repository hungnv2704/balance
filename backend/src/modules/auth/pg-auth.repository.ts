import { Injectable } from '@nestjs/common';
import { SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import {
  ActiveSessionAuthContext,
  AuthRepository,
  CreateSessionInput,
  CreateUserInput,
} from './auth.repository';
import { UserEntity, UserSessionEntity } from './auth.types';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  base_currency_code: SupportedCurrencyCode;
  timezone: string;
  mfa_enabled: boolean;
  deletion_scheduled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_family_id: string;
  refresh_token_hash: string;
  user_agent_hash: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

interface ActiveSessionAuthRow {
  session_id: string;
  user_id: string;
  token_family_id: string;
  timezone: string;
  base_currency_code: SupportedCurrencyCode;
}

function mapUserRow(row: UserRow): UserEntity {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    baseCurrencyCode: row.base_currency_code.trim() as SupportedCurrencyCode,
    timezone: row.timezone,
    mfaEnabled: row.mfa_enabled,
    deletionScheduledAt: row.deletion_scheduled_at ? new Date(row.deletion_scheduled_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapSessionRow(row: SessionRow): UserSessionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    tokenFamilyId: row.token_family_id,
    refreshTokenHash: row.refresh_token_hash,
    userAgentHash: row.user_agent_hash,
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    createdAt: new Date(row.created_at),
  };
}

@Injectable()
export class PgAuthRepository implements AuthRepository {
  public async findUserByEmail(db: DbQueryClient, email: string): Promise<UserEntity | null> {
    const result = await db.query<UserRow>(
      `SELECT id, email, password_hash, full_name, base_currency_code, timezone,
              mfa_enabled, deletion_scheduled_at, created_at, updated_at
       FROM users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  public async findUserById(db: DbQueryClient, userId: string): Promise<UserEntity | null> {
    const result = await db.query<UserRow>(
      `SELECT id, email, password_hash, full_name, base_currency_code, timezone,
              mfa_enabled, deletion_scheduled_at, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [userId],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  }

  public async createUser(tx: DbTransactionClient, input: CreateUserInput): Promise<UserEntity> {
    const result = await tx.query<UserRow>(
      `INSERT INTO users (email, password_hash, full_name, base_currency_code, timezone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, password_hash, full_name, base_currency_code, timezone,
                 mfa_enabled, deletion_scheduled_at, created_at, updated_at`,
      [input.email, input.passwordHash, input.fullName, input.baseCurrencyCode, input.timezone],
    );
    return mapUserRow(result.rows[0]);
  }

  public async updateUserPreferences(
    tx: DbTransactionClient,
    userId: string,
    updates: { baseCurrencyCode?: SupportedCurrencyCode; timezone?: string },
  ): Promise<UserEntity> {
    const setClauses = ['updated_at = now()'];
    const params: unknown[] = [userId];
    if (updates.baseCurrencyCode !== undefined) {
      params.push(updates.baseCurrencyCode);
      setClauses.push(`base_currency_code = $${params.length}`);
    }
    if (updates.timezone !== undefined) {
      params.push(updates.timezone);
      setClauses.push(`timezone = $${params.length}`);
    }

    const result = await tx.query<UserRow>(
      `UPDATE users
       SET ${setClauses.join(', ')}
       WHERE id = $1
       RETURNING id, email, password_hash, full_name, base_currency_code, timezone,
                 mfa_enabled, deletion_scheduled_at, created_at, updated_at`,
      params,
    );
    return mapUserRow(result.rows[0]);
  }

  public async scheduleDeletion(
    tx: DbTransactionClient,
    userId: string,
    deletionScheduledAt: Date,
  ): Promise<UserEntity> {
    const result = await tx.query<UserRow>(
      `UPDATE users
       SET deletion_scheduled_at = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING id, email, password_hash, full_name, base_currency_code, timezone,
                 mfa_enabled, deletion_scheduled_at, created_at, updated_at`,
      [userId, deletionScheduledAt],
    );
    return mapUserRow(result.rows[0]);
  }

  public async setMfaEnabled(
    tx: DbTransactionClient,
    userId: string,
    enabled: boolean,
  ): Promise<void> {
    await tx.query(
      `UPDATE users
       SET mfa_enabled = $2,
           updated_at = now()
       WHERE id = $1`,
      [userId, enabled],
    );
  }

  public async createSession(
    tx: DbTransactionClient,
    input: CreateSessionInput,
  ): Promise<UserSessionEntity> {
    const result = await tx.query<SessionRow>(
      `INSERT INTO user_sessions (user_id, token_family_id, refresh_token_hash, user_agent_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, token_family_id, refresh_token_hash, user_agent_hash, expires_at, revoked_at, created_at`,
      [
        input.userId,
        input.tokenFamilyId,
        input.refreshTokenHash,
        input.userAgentHash,
        input.expiresAt,
      ],
    );
    return mapSessionRow(result.rows[0]);
  }

  public async findSessionByTokenHash(
    db: DbQueryClient,
    refreshTokenHash: string,
    forUpdate = false,
  ): Promise<UserSessionEntity | null> {
    const sql = `SELECT id, user_id, token_family_id, refresh_token_hash, user_agent_hash,
                        expires_at, revoked_at, created_at
                 FROM user_sessions
                 WHERE refresh_token_hash = $1${forUpdate ? ' FOR UPDATE' : ''}`;
    const result = await db.query<SessionRow>(sql, [refreshTokenHash]);
    return result.rows[0] ? mapSessionRow(result.rows[0]) : null;
  }

  public async findActiveSessionForAuth(
    db: DbQueryClient,
    sessionId: string,
    userId: string,
  ): Promise<ActiveSessionAuthContext | null> {
    const result = await db.query<ActiveSessionAuthRow>(
      `SELECT s.id AS session_id,
              s.user_id,
              s.token_family_id,
              u.timezone,
              u.base_currency_code
       FROM user_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.id = $1
         AND s.user_id = $2
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.deletion_scheduled_at IS NULL
       LIMIT 1`,
      [sessionId, userId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      tokenFamilyId: row.token_family_id,
      timezone: row.timezone,
      baseCurrencyCode: row.base_currency_code.trim() as SupportedCurrencyCode,
    };
  }

  public async revokeSession(tx: DbTransactionClient, sessionId: string): Promise<void> {
    await tx.query(
      `UPDATE user_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE id = $1`,
      [sessionId],
    );
  }

  public async revokeSessionByTokenHash(
    db: DbQueryClient,
    refreshTokenHash: string,
  ): Promise<void> {
    await db.query(
      `UPDATE user_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE refresh_token_hash = $1`,
      [refreshTokenHash],
    );
  }

  public async revokeTokenFamily(tx: DbTransactionClient, tokenFamilyId: string): Promise<void> {
    await tx.query(
      `UPDATE user_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE token_family_id = $1 AND revoked_at IS NULL`,
      [tokenFamilyId],
    );
  }

  public async revokeAllUserSessions(tx: DbTransactionClient, userId: string): Promise<void> {
    await tx.query(
      `UPDATE user_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }
}
