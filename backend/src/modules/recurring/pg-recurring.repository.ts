import { Injectable } from '@nestjs/common';
import { CategoryKind, RecurringFrequency, SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import {
  CreateRecurringRuleInput,
  ListRecurringRulesFilter,
  RecurringRepository,
  UpdateRecurringRuleInput,
} from './recurring.repository';
import { RecurringRuleEntity } from './recurring.types';

interface RecurringRuleRow {
  id: string;
  user_id: string;
  rule_kind: CategoryKind;
  account_id: string;
  category_id: string;
  amount_minor: string;
  currency_code: SupportedCurrencyCode;
  frequency: RecurringFrequency;
  interval_count: number;
  next_run_date: string | Date;
  end_date: string | Date | null;
  timezone: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function normalizeDate(val: string | Date): string {
  return typeof val === 'string' ? val.slice(0, 10) : val.toISOString().slice(0, 10);
}

function mapRecurringRuleRow(row: RecurringRuleRow): RecurringRuleEntity {
  return {
    id: row.id,
    userId: row.user_id,
    ruleKind: row.rule_kind,
    accountId: row.account_id,
    categoryId: row.category_id,
    amountMinor: BigInt(row.amount_minor),
    currencyCode: row.currency_code.trim() as SupportedCurrencyCode,
    frequency: row.frequency,
    intervalCount: Number(row.interval_count),
    nextRunDate: normalizeDate(row.next_run_date),
    endDate: row.end_date !== null ? normalizeDate(row.end_date) : null,
    timezone: row.timezone,
    isActive: Boolean(row.is_active),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const SELECT_RECURRING_COLUMNS = `
  id, user_id, rule_kind, account_id, category_id, amount_minor, currency_code,
  frequency, interval_count, next_run_date::text AS next_run_date,
  end_date::text AS end_date, timezone, is_active, created_at, updated_at
`;

@Injectable()
export class PgRecurringRepository implements RecurringRepository {
  public async findById(
    db: DbQueryClient,
    userId: string,
    ruleId: string,
    forUpdate = false,
  ): Promise<RecurringRuleEntity | null> {
    const sql = `SELECT ${SELECT_RECURRING_COLUMNS}
                 FROM recurring_rules
                 WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`;
    const result = await db.query<RecurringRuleRow>(sql, [ruleId, userId]);
    return result.rows[0] ? mapRecurringRuleRow(result.rows[0]) : null;
  }

  public async list(
    db: DbQueryClient,
    userId: string,
    filter?: ListRecurringRulesFilter,
  ): Promise<RecurringRuleEntity[]> {
    const params: unknown[] = [userId];
    const whereClauses = ['user_id = $1'];

    if (filter?.ruleKind !== undefined) {
      params.push(filter.ruleKind);
      whereClauses.push(`rule_kind = $${params.length}`);
    }
    if (filter?.isActive !== undefined) {
      params.push(filter.isActive);
      whereClauses.push(`is_active = $${params.length}`);
    }

    const result = await db.query<RecurringRuleRow>(
      `SELECT ${SELECT_RECURRING_COLUMNS}
       FROM recurring_rules
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY is_active DESC, next_run_date ASC, created_at DESC, id DESC`,
      params,
    );
    return result.rows.map(mapRecurringRuleRow);
  }

  public async findDueActiveForUpdate(
    tx: DbTransactionClient,
    userId: string,
    asOfDate: string,
  ): Promise<RecurringRuleEntity[]> {
    const result = await tx.query<RecurringRuleRow>(
      `SELECT ${SELECT_RECURRING_COLUMNS}
       FROM recurring_rules
       WHERE user_id = $1
         AND is_active = TRUE
         AND next_run_date <= $2::date
       ORDER BY next_run_date ASC, created_at ASC, id ASC
       FOR UPDATE`,
      [userId, asOfDate],
    );
    return result.rows.map(mapRecurringRuleRow);
  }

  public async create(
    tx: DbTransactionClient,
    input: CreateRecurringRuleInput,
  ): Promise<RecurringRuleEntity> {
    const result = await tx.query<RecurringRuleRow>(
      `INSERT INTO recurring_rules (
         user_id, rule_kind, account_id, category_id, amount_minor, currency_code,
         frequency, interval_count, next_run_date, end_date, timezone, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11, $12)
       RETURNING ${SELECT_RECURRING_COLUMNS}`,
      [
        input.userId,
        input.ruleKind,
        input.accountId,
        input.categoryId,
        input.amountMinor.toString(),
        input.currencyCode,
        input.frequency,
        input.intervalCount,
        input.nextRunDate,
        input.endDate,
        input.timezone,
        input.isActive,
      ],
    );
    return mapRecurringRuleRow(result.rows[0]);
  }

  public async update(
    tx: DbTransactionClient,
    userId: string,
    ruleId: string,
    updates: UpdateRecurringRuleInput,
  ): Promise<RecurringRuleEntity> {
    const setClauses: string[] = ['updated_at = now()'];
    const params: unknown[] = [ruleId, userId];

    if (updates.accountId !== undefined) {
      params.push(updates.accountId);
      setClauses.push(`account_id = $${params.length}`);
    }
    if (updates.categoryId !== undefined) {
      params.push(updates.categoryId);
      setClauses.push(`category_id = $${params.length}`);
    }
    if (updates.amountMinor !== undefined) {
      params.push(updates.amountMinor.toString());
      setClauses.push(`amount_minor = $${params.length}`);
    }
    if (updates.frequency !== undefined) {
      params.push(updates.frequency);
      setClauses.push(`frequency = $${params.length}`);
    }
    if (updates.intervalCount !== undefined) {
      params.push(updates.intervalCount);
      setClauses.push(`interval_count = $${params.length}`);
    }
    if (updates.nextRunDate !== undefined) {
      params.push(updates.nextRunDate);
      setClauses.push(`next_run_date = $${params.length}::date`);
    }
    if (updates.endDate !== undefined) {
      if (updates.endDate === null) {
        setClauses.push('end_date = NULL');
      } else {
        params.push(updates.endDate);
        setClauses.push(`end_date = $${params.length}::date`);
      }
    }
    if (updates.timezone !== undefined) {
      params.push(updates.timezone);
      setClauses.push(`timezone = $${params.length}`);
    }
    if (updates.isActive !== undefined) {
      params.push(updates.isActive);
      setClauses.push(`is_active = $${params.length}`);
    }

    const result = await tx.query<RecurringRuleRow>(
      `UPDATE recurring_rules
       SET ${setClauses.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_RECURRING_COLUMNS}`,
      params,
    );
    return mapRecurringRuleRow(result.rows[0]);
  }
}
