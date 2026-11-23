import { Injectable } from '@nestjs/common';
import { EntryType, SupportedCurrencyCode, TransactionStatus } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { LedgerBalanceEntry } from '../../shared-kernel/domain/posted-balance';
import { ActiveDuplicateCandidate, LedgerRepository } from './ledger.repository';
import {
  CreateLedgerTransactionInput,
  CreateRecurringDraftTransactionInput,
  LedgerTransactionEntity,
  ListTransactionsFilter,
  UpdateEditableTransactionInput,
} from './ledger.types';

interface TransactionRow {
  id: string;
  user_id: string;
  account_id: string;
  entry_type: EntryType;
  status: TransactionStatus;
  amount_minor: string;
  currency_code: SupportedCurrencyCode;
  transaction_date: string | Date;
  description: string | null;
  note: string | null;
  category_id: string | null;
  income_source_id: string | null;
  merchant_id: string | null;
  transfer_id: string | null;
  recurring_rule_id: string | null;
  occurrence_date: string | Date | null;
  refunds_transaction_id: string | null;
  reverses_transaction_id: string | null;
  voided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function normalizeDateColumn(val: string | Date | null): string | null {
  if (val === null) return null;
  if (typeof val === 'string') return val.slice(0, 10);
  return val.toISOString().slice(0, 10);
}

function mapTransactionRow(row: TransactionRow): LedgerTransactionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    entryType: row.entry_type,
    status: row.status,
    amountMinor: BigInt(row.amount_minor),
    currencyCode: row.currency_code.trim() as SupportedCurrencyCode,
    transactionDate: normalizeDateColumn(row.transaction_date) ?? '',
    description: row.description,
    note: row.note,
    categoryId: row.category_id,
    incomeSourceId: row.income_source_id,
    merchantId: row.merchant_id,
    transferId: row.transfer_id,
    recurringRuleId: row.recurring_rule_id,
    occurrenceDate: normalizeDateColumn(row.occurrence_date),
    refundsTransactionId: row.refunds_transaction_id,
    reversesTransactionId: row.reverses_transaction_id,
    voidedAt: row.voided_at,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const SELECT_TRANSACTION_COLUMNS = `
  id, user_id, account_id, entry_type, status, amount_minor, currency_code,
  transaction_date::text AS transaction_date, description, note, category_id,
  income_source_id, merchant_id, transfer_id, recurring_rule_id,
  occurrence_date::text AS occurrence_date, refunds_transaction_id,
  reverses_transaction_id, voided_at, created_at, updated_at
`;

@Injectable()
export class PgLedgerRepository implements LedgerRepository {
  public async insert(
    tx: DbTransactionClient,
    input: CreateLedgerTransactionInput,
  ): Promise<LedgerTransactionEntity> {
    const result = await tx.query<TransactionRow>(
      `INSERT INTO transactions (
         user_id, account_id, entry_type, status, amount_minor, currency_code,
         transaction_date, description, note, category_id, income_source_id,
         merchant_id, transfer_id, recurring_rule_id, occurrence_date,
         refunds_transaction_id, reverses_transaction_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13, $14, $15::date, $16, $17)
       RETURNING ${SELECT_TRANSACTION_COLUMNS}`,
      [
        input.userId,
        input.accountId,
        input.entryType,
        input.status,
        input.amountMinor.toString(),
        input.currencyCode,
        input.transactionDate,
        input.description ?? null,
        input.note ?? null,
        input.categoryId ?? null,
        input.incomeSourceId ?? null,
        input.merchantId ?? null,
        input.transferId ?? null,
        input.recurringRuleId ?? null,
        input.occurrenceDate ?? null,
        input.refundsTransactionId ?? null,
        input.reversesTransactionId ?? null,
      ],
    );
    return mapTransactionRow(result.rows[0]);
  }

  public async insertRecurringDraftIfAbsent(
    tx: DbTransactionClient,
    input: CreateRecurringDraftTransactionInput,
  ): Promise<LedgerTransactionEntity | null> {
    const result = await tx.query<TransactionRow>(
      `INSERT INTO transactions (
         user_id, account_id, entry_type, status, amount_minor, currency_code,
         transaction_date, description, note, category_id, recurring_rule_id, occurrence_date
       ) VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6::date, $7, $8, $9, $10, $11::date)
       ON CONFLICT (recurring_rule_id, occurrence_date)
         WHERE recurring_rule_id IS NOT NULL
       DO NOTHING
       RETURNING ${SELECT_TRANSACTION_COLUMNS}`,
      [
        input.userId,
        input.accountId,
        input.entryType,
        input.amountMinor.toString(),
        input.currencyCode,
        input.transactionDate,
        input.description ?? null,
        input.note ?? null,
        input.categoryId,
        input.recurringRuleId,
        input.occurrenceDate,
      ],
    );
    return result.rows[0] ? mapTransactionRow(result.rows[0]) : null;
  }

  public async findById(
    db: DbQueryClient,
    userId: string,
    transactionId: string,
    allowedEntryTypes?: ReadonlyArray<EntryType>,
    forUpdate = false,
  ): Promise<LedgerTransactionEntity | null> {
    const params: unknown[] = [transactionId, userId];
    let sql = `SELECT ${SELECT_TRANSACTION_COLUMNS}
               FROM transactions
               WHERE id = $1 AND user_id = $2`;

    if (allowedEntryTypes && allowedEntryTypes.length > 0) {
      params.push(allowedEntryTypes);
      sql += ` AND entry_type = ANY($3::varchar[])`;
    }

    if (forUpdate) {
      sql += ` FOR UPDATE`;
    }

    const result = await db.query<TransactionRow>(sql, params);
    return result.rows[0] ? mapTransactionRow(result.rows[0]) : null;
  }

  public async findByTransferId(
    db: DbQueryClient,
    userId: string,
    transferId: string,
    forUpdate = false,
  ): Promise<LedgerTransactionEntity[]> {
    const sql = `SELECT ${SELECT_TRANSACTION_COLUMNS}
                 FROM transactions
                 WHERE user_id = $1 AND transfer_id = $2
                 ORDER BY id ASC${forUpdate ? ' FOR UPDATE' : ''}`;
    const result = await db.query<TransactionRow>(sql, [userId, transferId]);
    return result.rows.map(mapTransactionRow);
  }

  public async listAllForExport(
    db: DbQueryClient,
    userId: string,
    filter?: {
      accountId?: string;
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<LedgerTransactionEntity[]> {
    const params: unknown[] = [userId];
    const whereClauses: string[] = ['user_id = $1'];

    if (filter?.accountId) {
      params.push(filter.accountId);
      whereClauses.push(`account_id = $${params.length}`);
    }
    if (filter?.fromDate) {
      params.push(filter.fromDate);
      whereClauses.push(`transaction_date >= $${params.length}::date`);
    }
    if (filter?.toDate) {
      params.push(filter.toDate);
      whereClauses.push(`transaction_date <= $${params.length}::date`);
    }

    const result = await db.query<TransactionRow>(
      `SELECT ${SELECT_TRANSACTION_COLUMNS}
       FROM transactions
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY transaction_date DESC, created_at DESC, id DESC`,
      params,
    );
    return result.rows.map(mapTransactionRow);
  }

  public async updateEditable(
    tx: DbTransactionClient,
    userId: string,
    transactionId: string,
    updates: UpdateEditableTransactionInput,
  ): Promise<LedgerTransactionEntity> {
    const setClauses: string[] = ['updated_at = now()'];
    const params: unknown[] = [transactionId, userId];

    const addField = (column: string, value: unknown, cast = ''): void => {
      if (value !== undefined) {
        params.push(value);
        setClauses.push(`${column} = $${params.length}${cast}`);
      }
    };

    addField('account_id', updates.accountId);
    addField(
      'amount_minor',
      updates.amountMinor !== undefined ? updates.amountMinor.toString() : undefined,
    );
    addField('currency_code', updates.currencyCode);
    addField('transaction_date', updates.transactionDate, '::date');
    addField('description', updates.description);
    addField('note', updates.note);
    addField('category_id', updates.categoryId);
    addField('income_source_id', updates.incomeSourceId);
    addField('merchant_id', updates.merchantId);

    const result = await tx.query<TransactionRow>(
      `UPDATE transactions
       SET ${setClauses.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_TRANSACTION_COLUMNS}`,
      params,
    );
    return mapTransactionRow(result.rows[0]);
  }

  public async updateStatus(
    tx: DbTransactionClient,
    userId: string,
    transactionId: string,
    status: TransactionStatus,
    voidedAt?: Date | null,
  ): Promise<LedgerTransactionEntity> {
    const result = await tx.query<TransactionRow>(
      `UPDATE transactions
       SET status = $3,
           voided_at = COALESCE($4, voided_at),
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_TRANSACTION_COLUMNS}`,
      [transactionId, userId, status, voidedAt ?? null],
    );
    return mapTransactionRow(result.rows[0]);
  }

  public async list(
    db: DbQueryClient,
    filter: ListTransactionsFilter,
  ): Promise<{ items: LedgerTransactionEntity[]; hasMore: boolean }> {
    const params: unknown[] = [filter.userId];
    const whereClauses: string[] = ['user_id = $1'];

    if (filter.entryTypes && filter.entryTypes.length > 0) {
      params.push(filter.entryTypes);
      whereClauses.push(`entry_type = ANY($${params.length}::varchar[])`);
    }
    if (filter.accountId) {
      params.push(filter.accountId);
      whereClauses.push(`account_id = $${params.length}`);
    }
    if (filter.categoryId) {
      params.push(filter.categoryId);
      whereClauses.push(`category_id = $${params.length}`);
    }
    if (filter.incomeSourceId) {
      params.push(filter.incomeSourceId);
      whereClauses.push(`income_source_id = $${params.length}`);
    }
    if (filter.merchantId) {
      params.push(filter.merchantId);
      whereClauses.push(`merchant_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      whereClauses.push(`status = $${params.length}`);
    }
    if (filter.fromDate) {
      params.push(filter.fromDate);
      whereClauses.push(`transaction_date >= $${params.length}::date`);
    }
    if (filter.toDate) {
      params.push(filter.toDate);
      whereClauses.push(`transaction_date <= $${params.length}::date`);
    }
    if (filter.cursor) {
      params.push(filter.cursor.transactionDate);
      const pDate = params.length;
      params.push(filter.cursor.createdAt);
      const pCreated = params.length;
      params.push(filter.cursor.id);
      const pId = params.length;
      whereClauses.push(
        `(transaction_date, created_at, id) < ($${pDate}::date, $${pCreated}::timestamptz, $${pId}::uuid)`,
      );
    }

    params.push(filter.limit + 1);
    const pLimit = params.length;

    const result = await db.query<TransactionRow>(
      `SELECT ${SELECT_TRANSACTION_COLUMNS}
       FROM transactions
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY transaction_date DESC, created_at DESC, id DESC
       LIMIT $${pLimit}`,
      params,
    );

    const hasMore = result.rows.length > filter.limit;
    const rows = hasMore ? result.rows.slice(0, filter.limit) : result.rows;
    return {
      items: rows.map(mapTransactionRow),
      hasMore,
    };
  }

  public async getBalanceEntriesForAccounts(
    db: DbQueryClient,
    userId: string,
    accountIds: ReadonlyArray<string>,
  ): Promise<Map<string, LedgerBalanceEntry[]>> {
    const map = new Map<string, LedgerBalanceEntry[]>();
    for (const id of accountIds) {
      map.set(id, []);
    }
    if (accountIds.length === 0) {
      return map;
    }

    const result = await db.query<{
      account_id: string;
      entry_type: EntryType;
      status: TransactionStatus;
      amount_minor: string;
      currency_code: SupportedCurrencyCode;
    }>(
      `SELECT account_id, entry_type, status, amount_minor, currency_code
       FROM transactions
       WHERE user_id = $1 AND account_id = ANY($2::uuid[])`,
      [userId, accountIds],
    );

    for (const row of result.rows) {
      const list = map.get(row.account_id);
      if (list) {
        list.push({
          entryType: row.entry_type,
          status: row.status,
          amountMinor: BigInt(row.amount_minor),
          currencyCode: row.currency_code.trim(),
        });
      }
    }

    return map;
  }

  public async countTransactionsForAccount(
    db: DbQueryClient,
    userId: string,
    accountId: string,
  ): Promise<number> {
    const result = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM transactions
       WHERE user_id = $1 AND account_id = $2`,
      [userId, accountId],
    );
    return Number(result.rows[0]?.cnt ?? '0');
  }

  public async sumRefundsForExpense(
    tx: DbTransactionClient,
    userId: string,
    originalExpenseId: string,
  ): Promise<bigint> {
    const result = await tx.query<{ amount_minor: string }>(
      `SELECT amount_minor
       FROM transactions
       WHERE user_id = $1
         AND refunds_transaction_id = $2
         AND entry_type = 'EXPENSE_REFUND'
         AND status IN ('POSTED', 'PENDING')
       FOR UPDATE`,
      [userId, originalExpenseId],
    );
    let total = 0n;
    for (const row of result.rows) {
      total += BigInt(row.amount_minor);
    }
    return total;
  }

  public async findActiveDuplicateCandidates(
    db: DbQueryClient,
    params: {
      userId: string;
      accountId: string;
      entryTypes: ReadonlyArray<EntryType>;
      minDate: string;
      maxDate: string;
    },
  ): Promise<ActiveDuplicateCandidate[]> {
    if (params.entryTypes.length === 0) {
      return [];
    }

    const result = await db.query<{
      transaction_date: string;
      amount_minor: string;
      entry_type: EntryType;
    }>(
      `SELECT DISTINCT transaction_date::text AS transaction_date, amount_minor, entry_type
       FROM transactions
       WHERE user_id = $1
         AND account_id = $2
         AND status <> 'VOIDED'
         AND entry_type = ANY($3::varchar[])
         AND transaction_date >= $4::date
         AND transaction_date <= $5::date`,
      [params.userId, params.accountId, params.entryTypes, params.minDate, params.maxDate],
    );

    return result.rows.map((row) => ({
      transactionDate: row.transaction_date.slice(0, 10),
      amountMinor: BigInt(row.amount_minor),
      entryType: row.entry_type,
    }));
  }
}
