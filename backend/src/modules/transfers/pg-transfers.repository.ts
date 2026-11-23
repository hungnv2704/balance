import { Injectable } from '@nestjs/common';
import { SupportedCurrencyCode, TransferStatus } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import {
  CreateTransferInput,
  ListTransfersFilter,
  TransfersRepository,
} from './transfers.repository';
import { TransferEntity } from './transfers.types';

interface TransferRow {
  id: string;
  user_id: string;
  from_account_id: string;
  to_account_id: string;
  from_amount_minor: string;
  from_currency_code: SupportedCurrencyCode;
  to_amount_minor: string;
  to_currency_code: SupportedCurrencyCode;
  exchange_rate: string;
  rate_source: string;
  rate_effective_at: Date;
  fee_transaction_id: string | null;
  transfer_date: string | Date;
  note: string | null;
  status: TransferStatus;
  voided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function normalizeDate(val: string | Date): string {
  return typeof val === 'string' ? val.slice(0, 10) : val.toISOString().slice(0, 10);
}

function mapTransferRow(row: TransferRow): TransferEntity {
  return {
    id: row.id,
    userId: row.user_id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    fromAmountMinor: BigInt(row.from_amount_minor),
    fromCurrencyCode: row.from_currency_code.trim() as SupportedCurrencyCode,
    toAmountMinor: BigInt(row.to_amount_minor),
    toCurrencyCode: row.to_currency_code.trim() as SupportedCurrencyCode,
    exchangeRate: String(row.exchange_rate),
    rateSource: row.rate_source,
    rateEffectiveAt: new Date(row.rate_effective_at),
    feeTransactionId: row.fee_transaction_id,
    transferDate: normalizeDate(row.transfer_date),
    note: row.note,
    status: row.status,
    voidedAt: row.voided_at ? new Date(row.voided_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const SELECT_TRANSFER_COLUMNS = `
  id, user_id, from_account_id, to_account_id, from_amount_minor, from_currency_code,
  to_amount_minor, to_currency_code, exchange_rate::text AS exchange_rate, rate_source,
  rate_effective_at, fee_transaction_id, transfer_date::text AS transfer_date, note,
  status, voided_at, created_at, updated_at
`;

@Injectable()
export class PgTransfersRepository implements TransfersRepository {
  public async create(tx: DbTransactionClient, input: CreateTransferInput): Promise<TransferEntity> {
    const result = await tx.query<TransferRow>(
      `INSERT INTO transfers (
         user_id, from_account_id, to_account_id, from_amount_minor, from_currency_code,
         to_amount_minor, to_currency_code, exchange_rate, rate_source, rate_effective_at,
         transfer_date, note, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric(18, 8), $9, $10, $11::date, $12, $13)
       RETURNING ${SELECT_TRANSFER_COLUMNS}`,
      [
        input.userId,
        input.fromAccountId,
        input.toAccountId,
        input.fromAmountMinor.toString(),
        input.fromCurrencyCode,
        input.toAmountMinor.toString(),
        input.toCurrencyCode,
        input.exchangeRate,
        input.rateSource,
        input.rateEffectiveAt,
        input.transferDate,
        input.note,
        input.status,
      ],
    );
    return mapTransferRow(result.rows[0]);
  }

  public async findById(
    db: DbQueryClient,
    userId: string,
    transferId: string,
    forUpdate = false,
  ): Promise<TransferEntity | null> {
    const sql = `SELECT ${SELECT_TRANSFER_COLUMNS}
                 FROM transfers
                 WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`;
    const result = await db.query<TransferRow>(sql, [transferId, userId]);
    return result.rows[0] ? mapTransferRow(result.rows[0]) : null;
  }

  public async setFeeTransactionId(
    tx: DbTransactionClient,
    userId: string,
    transferId: string,
    feeTransactionId: string,
  ): Promise<TransferEntity> {
    const result = await tx.query<TransferRow>(
      `UPDATE transfers
       SET fee_transaction_id = $3,
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_TRANSFER_COLUMNS}`,
      [transferId, userId, feeTransactionId],
    );
    return mapTransferRow(result.rows[0]);
  }

  public async updateStatus(
    tx: DbTransactionClient,
    userId: string,
    transferId: string,
    status: TransferStatus,
    voidedAt?: Date | null,
  ): Promise<TransferEntity> {
    const result = await tx.query<TransferRow>(
      `UPDATE transfers
       SET status = $3,
           voided_at = COALESCE($4, voided_at),
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_TRANSFER_COLUMNS}`,
      [transferId, userId, status, voidedAt ?? null],
    );
    return mapTransferRow(result.rows[0]);
  }

  public async list(
    db: DbQueryClient,
    filter: ListTransfersFilter,
  ): Promise<{ items: TransferEntity[]; hasMore: boolean }> {
    const params: unknown[] = [filter.userId];
    const whereClauses: string[] = ['user_id = $1'];

    if (filter.accountId) {
      params.push(filter.accountId);
      whereClauses.push(
        `(from_account_id = $${params.length} OR to_account_id = $${params.length})`,
      );
    }
    if (filter.status) {
      params.push(filter.status);
      whereClauses.push(`status = $${params.length}`);
    }
    if (filter.fromDate) {
      params.push(filter.fromDate);
      whereClauses.push(`transfer_date >= $${params.length}::date`);
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      whereClauses.push(`transfer_date <= $${params.length}::date`);
    }
    if (filter.cursor) {
      params.push(filter.cursor.transferDate);
      const pDate = params.length;
      params.push(filter.cursor.createdAt);
      const pCreated = params.length;
      params.push(filter.cursor.id);
      const pId = params.length;
      whereClauses.push(
        `(transfer_date, created_at, id) < ($${pDate}::date, $${pCreated}::timestamptz, $${pId}::uuid)`,
      );
    }

    params.push(filter.limit + 1);
    const pLimit = params.length;

    const result = await db.query<TransferRow>(
      `SELECT ${SELECT_TRANSFER_COLUMNS}
       FROM transfers
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY transfer_date DESC, created_at DESC, id DESC
       LIMIT $${pLimit}`,
      params,
    );

    const hasMore = result.rows.length > filter.limit;
    const rows = hasMore ? result.rows.slice(0, filter.limit) : result.rows;
    return {
      items: rows.map(mapTransferRow),
      hasMore,
    };
  }

  public async listAllByUser(
    db: DbQueryClient,
    userId: string,
    filter?: { accountId?: string; fromDate?: string; toDate?: string },
  ): Promise<TransferEntity[]> {
    const params: unknown[] = [userId];
    const whereClauses: string[] = ['user_id = $1'];

    if (filter?.accountId) {
      params.push(filter.accountId);
      whereClauses.push(
        `(from_account_id = $${params.length} OR to_account_id = $${params.length})`,
      );
    }
    if (filter?.fromDate) {
      params.push(filter.fromDate);
      whereClauses.push(`transfer_date >= $${params.length}::date`);
    }
    if (filter?.toDate) {
      params.push(filter.toDate);
      whereClauses.push(`transfer_date <= $${params.length}::date`);
    }

    const result = await db.query<TransferRow>(
      `SELECT ${SELECT_TRANSFER_COLUMNS}
       FROM transfers
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY transfer_date DESC, created_at DESC, id DESC`,
      params,
    );
    return result.rows.map(mapTransferRow);
  }
}
