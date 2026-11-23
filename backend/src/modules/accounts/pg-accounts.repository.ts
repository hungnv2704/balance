import { Injectable } from '@nestjs/common';
import { AccountType, SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import {
  AccountsRepository,
  CreateAccountInput,
  UpdateAccountInput,
} from './accounts.repository';
import { AccountEntity } from './accounts.types';

interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  account_type: AccountType;
  currency_code: SupportedCurrencyCode;
  opening_balance_minor: string;
  opening_balance_date: string | Date;
  is_default: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function normalizeDate(val: string | Date): string {
  return typeof val === 'string' ? val.slice(0, 10) : val.toISOString().slice(0, 10);
}

function mapAccountRow(row: AccountRow): AccountEntity {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    accountType: row.account_type,
    currencyCode: row.currency_code.trim() as SupportedCurrencyCode,
    openingBalanceMinor: BigInt(row.opening_balance_minor),
    openingBalanceDate: normalizeDate(row.opening_balance_date),
    isDefault: row.is_default,
    archivedAt: row.archived_at,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const SELECT_ACCOUNT_COLUMNS = `
  id, user_id, name, account_type, currency_code, opening_balance_minor,
  opening_balance_date::text AS opening_balance_date, is_default,
  archived_at, created_at, updated_at
`;

@Injectable()
export class PgAccountsRepository implements AccountsRepository {
  public async findById(
    db: DbQueryClient,
    userId: string,
    accountId: string,
    forUpdate = false,
  ): Promise<AccountEntity | null> {
    const sql = `SELECT ${SELECT_ACCOUNT_COLUMNS}
                 FROM accounts
                 WHERE id = $1 AND user_id = $2${forUpdate ? ' FOR UPDATE' : ''}`;
    const result = await db.query<AccountRow>(sql, [accountId, userId]);
    return result.rows[0] ? mapAccountRow(result.rows[0]) : null;
  }

  public async findManyByIdsForUpdate(
    tx: DbTransactionClient,
    userId: string,
    accountIds: ReadonlyArray<string>,
  ): Promise<AccountEntity[]> {
    if (accountIds.length === 0) {
      return [];
    }
    const sortedIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b));
    const result = await tx.query<AccountRow>(
      `SELECT ${SELECT_ACCOUNT_COLUMNS}
       FROM accounts
       WHERE user_id = $1 AND id = ANY($2::uuid[])
       ORDER BY id ASC
       FOR UPDATE`,
      [userId, sortedIds],
    );
    return result.rows.map(mapAccountRow);
  }

  public async findAllByUser(
    db: DbQueryClient,
    userId: string,
    includeArchived: boolean,
  ): Promise<AccountEntity[]> {
    const sql = includeArchived
      ? `SELECT ${SELECT_ACCOUNT_COLUMNS}
         FROM accounts
         WHERE user_id = $1
         ORDER BY is_default DESC, archived_at NULLS FIRST, created_at ASC`
      : `SELECT ${SELECT_ACCOUNT_COLUMNS}
         FROM accounts
         WHERE user_id = $1 AND archived_at IS NULL
         ORDER BY is_default DESC, created_at ASC`;
    const result = await db.query<AccountRow>(sql, [userId]);
    return result.rows.map(mapAccountRow);
  }

  public async findActiveByUserForUpdate(
    tx: DbTransactionClient,
    userId: string,
  ): Promise<AccountEntity[]> {
    const result = await tx.query<AccountRow>(
      `SELECT ${SELECT_ACCOUNT_COLUMNS}
       FROM accounts
       WHERE user_id = $1 AND archived_at IS NULL
       ORDER BY id ASC
       FOR UPDATE`,
      [userId],
    );
    return result.rows.map(mapAccountRow);
  }

  public async findDefaultActiveByUser(
    db: DbQueryClient,
    userId: string,
  ): Promise<AccountEntity | null> {
    const result = await db.query<AccountRow>(
      `SELECT ${SELECT_ACCOUNT_COLUMNS}
       FROM accounts
       WHERE user_id = $1 AND is_default = TRUE AND archived_at IS NULL
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ? mapAccountRow(result.rows[0]) : null;
  }

  public async countActiveByUser(db: DbQueryClient, userId: string): Promise<number> {
    const result = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM accounts
       WHERE user_id = $1 AND archived_at IS NULL`,
      [userId],
    );
    return Number(result.rows[0]?.cnt ?? '0');
  }

  public async create(tx: DbTransactionClient, input: CreateAccountInput): Promise<AccountEntity> {
    const result = await tx.query<AccountRow>(
      `INSERT INTO accounts (
         user_id, name, account_type, currency_code,
         opening_balance_minor, opening_balance_date, is_default
       ) VALUES ($1, $2, $3, $4, $5, $6::date, $7)
       RETURNING ${SELECT_ACCOUNT_COLUMNS}`,
      [
        input.userId,
        input.name,
        input.accountType,
        input.currencyCode,
        input.openingBalanceMinor.toString(),
        input.openingBalanceDate,
        input.isDefault,
      ],
    );
    return mapAccountRow(result.rows[0]);
  }

  public async clearDefaultForUser(tx: DbTransactionClient, userId: string): Promise<void> {
    await tx.query(
      `UPDATE accounts
       SET is_default = FALSE, updated_at = now()
       WHERE user_id = $1 AND is_default = TRUE AND archived_at IS NULL`,
      [userId],
    );
  }

  public async update(
    tx: DbTransactionClient,
    userId: string,
    accountId: string,
    updates: UpdateAccountInput,
  ): Promise<AccountEntity> {
    const setClauses: string[] = ['updated_at = now()'];
    const params: unknown[] = [accountId, userId];

    if (updates.name !== undefined) {
      params.push(updates.name);
      setClauses.push(`name = $${params.length}`);
    }
    if (updates.accountType !== undefined) {
      params.push(updates.accountType);
      setClauses.push(`account_type = $${params.length}`);
    }
    if (updates.currencyCode !== undefined) {
      params.push(updates.currencyCode);
      setClauses.push(`currency_code = $${params.length}`);
    }
    if (updates.isDefault !== undefined) {
      params.push(updates.isDefault);
      setClauses.push(`is_default = $${params.length}`);
    }

    const result = await tx.query<AccountRow>(
      `UPDATE accounts
       SET ${setClauses.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_ACCOUNT_COLUMNS}`,
      params,
    );
    return mapAccountRow(result.rows[0]);
  }

  public async archive(
    tx: DbTransactionClient,
    userId: string,
    accountId: string,
  ): Promise<AccountEntity> {
    const result = await tx.query<AccountRow>(
      `UPDATE accounts
       SET archived_at = now(),
           is_default = FALSE,
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_ACCOUNT_COLUMNS}`,
      [accountId, userId],
    );
    return mapAccountRow(result.rows[0]);
  }
}
