import { Injectable } from '@nestjs/common';
import { CategoryKind, EntryType, SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import {
  BudgetDailyExpenseEntry,
  BudgetsRepository,
  CreateBudgetInput,
  ListBudgetsFilter,
  UpdateBudgetInput,
} from './budgets.repository';
import { BudgetEntity } from './budgets.types';

interface BudgetRow {
  id: string;
  user_id: string;
  category_id: string;
  category_kind: CategoryKind.EXPENSE;
  limit_minor: string;
  currency_code: SupportedCurrencyCode;
  period_start: string | Date;
  period_end: string | Date;
  archived_at: Date | null;
  created_at: Date;
}

function normalizeDate(val: string | Date): string {
  return typeof val === 'string' ? val.slice(0, 10) : val.toISOString().slice(0, 10);
}

function mapBudgetRow(row: BudgetRow): BudgetEntity {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    categoryKind: CategoryKind.EXPENSE,
    limitMinor: BigInt(row.limit_minor),
    currencyCode: row.currency_code.trim() as SupportedCurrencyCode,
    periodStart: normalizeDate(row.period_start),
    periodEnd: normalizeDate(row.period_end),
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
    createdAt: new Date(row.created_at),
  };
}

const SELECT_BUDGET_COLUMNS = `
  id, user_id, category_id, category_kind, limit_minor, currency_code,
  period_start::text AS period_start, period_end::text AS period_end,
  archived_at, created_at
`;

@Injectable()
export class PgBudgetsRepository implements BudgetsRepository {
  public async findById(
    db: DbQueryClient,
    userId: string,
    budgetId: string,
    forUpdate = false,
  ): Promise<BudgetEntity | null> {
    const sql = `SELECT ${SELECT_BUDGET_COLUMNS}
                 FROM budgets
                 WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`;
    const result = await db.query<BudgetRow>(sql, [budgetId, userId]);
    return result.rows[0] ? mapBudgetRow(result.rows[0]) : null;
  }

  public async findOverlappingActive(
    tx: DbTransactionClient,
    params: {
      userId: string;
      categoryId: string;
      currencyCode: SupportedCurrencyCode;
      periodStart: string;
      periodEnd: string;
      excludeBudgetId?: string;
    },
  ): Promise<BudgetEntity | null> {
    const sqlParams: unknown[] = [
      params.userId,
      params.categoryId,
      params.currencyCode,
      params.periodStart,
      params.periodEnd,
    ];
    let excludeClause = '';
    if (params.excludeBudgetId) {
      sqlParams.push(params.excludeBudgetId);
      excludeClause = `AND id <> $${sqlParams.length}`;
    }

    const result = await tx.query<BudgetRow>(
      `SELECT ${SELECT_BUDGET_COLUMNS}
       FROM budgets
       WHERE user_id = $1
         AND category_id = $2
         AND currency_code = $3
         AND archived_at IS NULL
         AND period_start <= $5::date
         AND period_end >= $4::date
         ${excludeClause}
       LIMIT 1`,
      sqlParams,
    );
    return result.rows[0] ? mapBudgetRow(result.rows[0]) : null;
  }

  public async list(
    db: DbQueryClient,
    userId: string,
    filter?: ListBudgetsFilter,
  ): Promise<BudgetEntity[]> {
    const params: unknown[] = [userId];
    const whereClauses = ['user_id = $1'];

    if (!filter?.includeArchived) {
      whereClauses.push('archived_at IS NULL');
    }
    if (filter?.currencyCode) {
      params.push(filter.currencyCode);
      whereClauses.push(`currency_code = $${params.length}`);
    }
    if (filter?.categoryId) {
      params.push(filter.categoryId);
      whereClauses.push(`category_id = $${params.length}`);
    }
    if (filter?.fromDate) {
      params.push(filter.fromDate);
      whereClauses.push(`period_end >= $${params.length}::date`);
    }
    if (filter?.toDate) {
      params.push(filter.toDate);
      whereClauses.push(`period_start <= $${params.length}::date`);
    }

    const result = await db.query<BudgetRow>(
      `SELECT ${SELECT_BUDGET_COLUMNS}
       FROM budgets
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY period_start DESC, created_at DESC, id DESC`,
      params,
    );
    return result.rows.map(mapBudgetRow);
  }

  public async create(tx: DbTransactionClient, input: CreateBudgetInput): Promise<BudgetEntity> {
    const result = await tx.query<BudgetRow>(
      `INSERT INTO budgets (
         user_id, category_id, category_kind, limit_minor, currency_code, period_start, period_end
       ) VALUES ($1, $2, 'EXPENSE', $3, $4, $5::date, $6::date)
       RETURNING ${SELECT_BUDGET_COLUMNS}`,
      [
        input.userId,
        input.categoryId,
        input.limitMinor.toString(),
        input.currencyCode,
        input.periodStart,
        input.periodEnd,
      ],
    );
    return mapBudgetRow(result.rows[0]);
  }

  public async update(
    tx: DbTransactionClient,
    userId: string,
    budgetId: string,
    updates: UpdateBudgetInput,
  ): Promise<BudgetEntity> {
    const setClauses: string[] = [];
    const params: unknown[] = [budgetId, userId];

    if (updates.limitMinor !== undefined) {
      params.push(updates.limitMinor.toString());
      setClauses.push(`limit_minor = $${params.length}`);
    }
    if (updates.periodStart !== undefined) {
      params.push(updates.periodStart);
      setClauses.push(`period_start = $${params.length}::date`);
    }
    if (updates.periodEnd !== undefined) {
      params.push(updates.periodEnd);
      setClauses.push(`period_end = $${params.length}::date`);
    }
    if (updates.archivedAt !== undefined) {
      params.push(updates.archivedAt);
      setClauses.push(`archived_at = $${params.length}`);
    }

    if (setClauses.length === 0) {
      const existing = await this.findById(tx, userId, budgetId);
      return existing!;
    }

    const result = await tx.query<BudgetRow>(
      `UPDATE budgets
       SET ${setClauses.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_BUDGET_COLUMNS}`,
      params,
    );
    return mapBudgetRow(result.rows[0]);
  }

  public async getPostedExpenseTotalsForRange(
    db: DbQueryClient,
    params: {
      userId: string;
      minDate: string;
      maxDate: string;
      categoryIds?: ReadonlyArray<string>;
      currencyCodes?: ReadonlyArray<SupportedCurrencyCode>;
    },
  ): Promise<BudgetDailyExpenseEntry[]> {
    const sqlParams: unknown[] = [params.userId, params.minDate, params.maxDate];
    const extraClauses: string[] = [];

    if (params.categoryIds && params.categoryIds.length > 0) {
      sqlParams.push([...new Set(params.categoryIds)]);
      extraClauses.push(`AND category_id = ANY($${sqlParams.length}::uuid[])`);
    }
    if (params.currencyCodes && params.currencyCodes.length > 0) {
      sqlParams.push([...new Set(params.currencyCodes)]);
      extraClauses.push(`AND currency_code = ANY($${sqlParams.length}::char(3)[])`);
    }

    const result = await db.query<{
      category_id: string;
      currency_code: SupportedCurrencyCode;
      transaction_date: string | Date;
      entry_type: EntryType.EXPENSE | EntryType.EXPENSE_REFUND;
      total_minor: string;
    }>(
      `SELECT
         category_id,
         currency_code,
         transaction_date::text AS transaction_date,
         entry_type,
         SUM(amount_minor)::text AS total_minor
       FROM transactions
       WHERE user_id = $1
         AND status = 'POSTED'
         AND entry_type IN ('EXPENSE', 'EXPENSE_REFUND')
         AND transaction_date >= $2::date
         AND transaction_date <= $3::date
         ${extraClauses.join('\n         ')}
       GROUP BY category_id, currency_code, transaction_date, entry_type`,
      sqlParams,
    );

    return result.rows.map((row) => ({
      categoryId: row.category_id,
      currencyCode: row.currency_code.trim() as SupportedCurrencyCode,
      transactionDate: normalizeDate(row.transaction_date),
      entryType: row.entry_type,
      totalMinor: BigInt(row.total_minor),
    }));
  }
}
