import { Injectable } from '@nestjs/common';
import { DbTransactionClient } from '../../database/database.types';
import {
  AcquireIdempotencyParams,
  AcquireIdempotencyResult,
  IdempotencyRepository,
} from './idempotency.types';

interface IdempotencyRow {
  request_method: string;
  request_path: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
  expires_at: Date;
}

@Injectable()
export class PgIdempotencyRepository implements IdempotencyRepository {
  public async acquireOrReplay(
    tx: DbTransactionClient,
    params: AcquireIdempotencyParams,
  ): Promise<AcquireIdempotencyResult> {
    // Purge expired entry for same (user_id, idempotency_key) so key can be reused after TTL
    await tx.query(
      `DELETE FROM idempotency_keys
       WHERE user_id = $1 AND idempotency_key = $2 AND expires_at <= now()`,
      [params.userId, params.idempotencyKey],
    );

    const insertResult = await tx.query<{ idempotency_key: string }>(
      `INSERT INTO idempotency_keys (
         user_id, idempotency_key, request_method, request_path, request_hash, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [
        params.userId,
        params.idempotencyKey,
        params.requestMethod,
        params.requestPath,
        params.requestHash,
        params.expiresAt,
      ],
    );

    if (insertResult.rowCount === 1) {
      return { kind: 'ACQUIRED' };
    }

    const existingResult = await tx.query<IdempotencyRow>(
      `SELECT request_method, request_path, request_hash, response_status, response_body, expires_at
       FROM idempotency_keys
       WHERE user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [params.userId, params.idempotencyKey],
    );

    if (existingResult.rows.length === 0) {
      // Edge case: expired concurrently and deleted between INSERT and SELECT
      return this.acquireOrReplay(tx, params);
    }

    const row = existingResult.rows[0];
    if (
      row.request_hash !== params.requestHash ||
      row.request_method !== params.requestMethod ||
      row.request_path !== params.requestPath
    ) {
      return { kind: 'CONFLICT' };
    }

    if (row.response_status === null) {
      return { kind: 'IN_PROGRESS' };
    }

    return {
      kind: 'REPLAY',
      status: row.response_status,
      body: row.response_body,
    };
  }

  public async saveResponse(
    tx: DbTransactionClient,
    userId: string,
    idempotencyKey: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await tx.query(
      `UPDATE idempotency_keys
       SET response_status = $3,
           response_body = $4::jsonb
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey, responseStatus, JSON.stringify(responseBody)],
    );
  }
}
