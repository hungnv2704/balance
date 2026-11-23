import { Injectable } from '@nestjs/common';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { MfaRepository } from './mfa.repository';
import { UserMfaEntity } from './mfa.types';

interface UserMfaRow {
  user_id: string;
  totp_secret_encrypted: string;
  enabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapUserMfaRow(row: UserMfaRow): UserMfaEntity {
  return {
    userId: row.user_id,
    totpSecretEncrypted: row.totp_secret_encrypted,
    enabledAt: row.enabled_at ? new Date(row.enabled_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

@Injectable()
export class PgMfaRepository implements MfaRepository {
  public async findByUserId(
    db: DbQueryClient,
    userId: string,
    forUpdate = false,
  ): Promise<UserMfaEntity | null> {
    const sql = `SELECT user_id, totp_secret_encrypted, enabled_at, created_at, updated_at
                 FROM user_mfa
                 WHERE user_id = $1${forUpdate ? ' FOR UPDATE' : ''}`;
    const result = await db.query<UserMfaRow>(sql, [userId]);
    return result.rows[0] ? mapUserMfaRow(result.rows[0]) : null;
  }

  public async upsertPendingSecret(
    tx: DbTransactionClient,
    userId: string,
    totpSecretEncrypted: string,
  ): Promise<UserMfaEntity> {
    const result = await tx.query<UserMfaRow>(
      `INSERT INTO user_mfa (user_id, totp_secret_encrypted, enabled_at)
       VALUES ($1, $2, NULL)
       ON CONFLICT (user_id) DO UPDATE
         SET totp_secret_encrypted = EXCLUDED.totp_secret_encrypted,
             enabled_at = NULL,
             updated_at = now()
       RETURNING user_id, totp_secret_encrypted, enabled_at, created_at, updated_at`,
      [userId, totpSecretEncrypted],
    );
    return mapUserMfaRow(result.rows[0]);
  }

  public async markEnabled(
    tx: DbTransactionClient,
    userId: string,
    enabledAt: Date,
  ): Promise<UserMfaEntity> {
    const result = await tx.query<UserMfaRow>(
      `UPDATE user_mfa
       SET enabled_at = $2,
           updated_at = now()
       WHERE user_id = $1
       RETURNING user_id, totp_secret_encrypted, enabled_at, created_at, updated_at`,
      [userId, enabledAt],
    );
    return mapUserMfaRow(result.rows[0]);
  }

  public async replaceRecoveryCodes(
    tx: DbTransactionClient,
    userId: string,
    codeHashes: ReadonlyArray<string>,
  ): Promise<void> {
    await tx.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = $1', [userId]);

    if (codeHashes.length === 0) {
      return;
    }

    const valuesSql: string[] = [];
    const params: unknown[] = [userId];
    for (const hash of codeHashes) {
      params.push(hash);
      valuesSql.push(`($1, $${params.length})`);
    }

    await tx.query(
      `INSERT INTO user_mfa_recovery_codes (user_id, code_hash)
       VALUES ${valuesSql.join(', ')}`,
      params,
    );
  }

  public async countRemainingRecoveryCodes(db: DbQueryClient, userId: string): Promise<number> {
    const result = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
       FROM user_mfa_recovery_codes
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );
    return result.rows[0]?.cnt ?? 0;
  }

  public async consumeRecoveryCode(
    tx: DbTransactionClient,
    userId: string,
    codeHash: string,
  ): Promise<boolean> {
    const result = await tx.query<{ id: string }>(
      `UPDATE user_mfa_recovery_codes
       SET used_at = now()
       WHERE user_id = $1
         AND code_hash = $2
         AND used_at IS NULL
       RETURNING id`,
      [userId, codeHash],
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  public async deleteAllForUser(tx: DbTransactionClient, userId: string): Promise<void> {
    await tx.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = $1', [userId]);
    await tx.query('DELETE FROM user_mfa WHERE user_id = $1', [userId]);
  }
}
