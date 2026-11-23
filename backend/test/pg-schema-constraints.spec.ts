import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  AccountType,
  CategoryKind,
  EntryType,
  TransactionStatus,
  TransferStatus,
} from '@pfm/shared-types';
import { AppModule } from '../src/app.module';
import { APP_CONFIG, loadAppConfig } from '../src/config/app-config';
import { DatabaseService } from '../src/database/database.service';
import {
  DATABASE_EXECUTOR,
  DatabaseExecutor,
  DbTransactionClient,
  QueryResultLike,
} from '../src/database/database.types';
import { configureHttpApp } from '../src/main';
import { TEST_APP_CONFIG } from './helpers/in-memory-backend';

const MIGRATION_PATH = path.resolve(__dirname, '../../database/migrations/001_initial_schema.sql');
const WORKER_PATH = path.resolve(__dirname, './helpers/pglite-worker.cjs');

interface PgErrorLike extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
  schema?: string;
  table?: string;
  column?: string;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: {
    name?: string;
    message: string;
    code?: string;
    constraint?: string;
    detail?: string;
    schema?: string;
    table?: string;
    column?: string;
  };
}

/**
 * Runs PGlite in-process inside a Node worker_threads Worker so PGlite's internal
 * ESM dynamic imports execute outside Jest's VM sandbox without requiring --experimental-vm-modules.
 */
class PGliteWorkerExecutor implements DatabaseExecutor {
  private readonly worker: Worker;
  private nextMsgId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  public constructor() {
    this.worker = new Worker(WORKER_PATH);
    this.worker.on('message', (msg: WorkerResponse) => {
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        waiter.resolve(msg.result);
      } else {
        const err = new Error(msg.error?.message ?? 'Unknown PGlite worker error') as PgErrorLike;
        if (msg.error) {
          err.name = msg.error.name ?? 'DatabaseError';
          err.code = msg.error.code;
          err.constraint = msg.error.constraint;
          err.detail = msg.error.detail;
          err.schema = msg.error.schema;
          err.table = msg.error.table;
          err.column = msg.error.column;
        }
        waiter.reject(err);
      }
    });
    this.worker.on('error', (err) => {
      for (const waiter of this.pending.values()) {
        waiter.reject(err);
      }
      this.pending.clear();
    });
  }

  private call<T = unknown>(payload: Record<string, unknown>): Promise<T> {
    const id = this.nextMsgId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.worker.postMessage({ id, ...payload });
    });
  }

  public async init(): Promise<void> {
    await this.call({ type: 'init' });
  }

  public async exec(sql: string): Promise<void> {
    await this.call({ type: 'exec', sql });
  }

  public async query<R = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResultLike<R>> {
    return this.call<QueryResultLike<R>>({
      type: 'query',
      text,
      params: params ? [...params] : undefined,
    });
  }

  public async withTransaction<T>(fn: (tx: DbTransactionClient) => Promise<T>): Promise<T> {
    const { txId } = await this.call<{ txId: number }>({ type: 'beginTx' });
    const txClient: DbTransactionClient = {
      isTransaction: true,
      query: async <R = Record<string, unknown>>(
        text: string,
        params?: ReadonlyArray<unknown>,
      ): Promise<QueryResultLike<R>> => {
        return this.call<QueryResultLike<R>>({
          type: 'query',
          txId,
          text,
          params: params ? [...params] : undefined,
        });
      },
    };

    try {
      const result = await fn(txClient);
      await this.call({ type: 'commitTx', txId });
      return result;
    } catch (error) {
      await this.call({ type: 'rollbackTx', txId }).catch(() => undefined);
      throw error;
    }
  }

  public async close(): Promise<void> {
    try {
      await this.call({ type: 'close' });
    } finally {
      await this.worker.terminate();
    }
  }
}

async function expectPgError(
  promise: Promise<unknown>,
  expectedCode: string,
  expectedConstraint?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  const pgErr = caught as PgErrorLike;
  expect(pgErr.code).toBe(expectedCode);
  if (expectedConstraint) {
    expect(pgErr.constraint).toBe(expectedConstraint);
  }
}

async function bootSchemaDb(): Promise<PGliteWorkerExecutor> {
  const db = new PGliteWorkerExecutor();
  await db.init();
  const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  await db.exec(migrationSql);
  return db;
}

interface FixtureTenant {
  userId: string;
  defaultAccountId: string;
  savingsAccountId: string;
  incomeCategoryId: string;
  expenseCategoryId: string;
  incomeSourceId: string;
  merchantId: string;
  transferId: string;
}

async function createTenantFixture(
  db: PGliteWorkerExecutor,
  email: string,
): Promise<FixtureTenant> {
  const userRes = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, base_currency_code)
     VALUES ($1, $2, $3, 'VND')
     RETURNING id`,
    [email, '$argon2id$v=19$m=64,t=1,p=1$c2FsdA$aGFzaA', `User ${email}`],
  );
  const userId = userRes.rows[0].id;

  const defaultAccRes = await db.query<{ id: string }>(
    `INSERT INTO accounts (user_id, name, account_type, currency_code, opening_balance_minor, opening_balance_date, is_default)
     VALUES ($1, 'Sổ chung', 'CASH', 'VND', 1000000, '2026-01-01', TRUE)
     RETURNING id`,
    [userId],
  );
  const defaultAccountId = defaultAccRes.rows[0].id;

  const savingsAccRes = await db.query<{ id: string }>(
    `INSERT INTO accounts (user_id, name, account_type, currency_code, opening_balance_minor, opening_balance_date, is_default)
     VALUES ($1, 'VCB Savings', 'SAVINGS', 'VND', 5000000, '2026-01-01', FALSE)
     RETURNING id`,
    [userId],
  );
  const savingsAccountId = savingsAccRes.rows[0].id;

  const incCatRes = await db.query<{ id: string }>(
    `INSERT INTO categories (user_id, kind, name)
     VALUES ($1, 'INCOME', 'Lương')
     RETURNING id`,
    [userId],
  );
  const incomeCategoryId = incCatRes.rows[0].id;

  const expCatRes = await db.query<{ id: string }>(
    `INSERT INTO categories (user_id, kind, name)
     VALUES ($1, 'EXPENSE', 'Ăn uống')
     RETURNING id`,
    [userId],
  );
  const expenseCategoryId = expCatRes.rows[0].id;

  const incSrcRes = await db.query<{ id: string }>(
    `INSERT INTO income_sources (user_id, name)
     VALUES ($1, 'Employer Corp')
     RETURNING id`,
    [userId],
  );
  const incomeSourceId = incSrcRes.rows[0].id;

  const merchantRes = await db.query<{ id: string }>(
    `INSERT INTO merchants (user_id, name)
     VALUES ($1, 'Highlands Coffee')
     RETURNING id`,
    [userId],
  );
  const merchantId = merchantRes.rows[0].id;

  const transferRes = await db.query<{ id: string }>(
    `INSERT INTO transfers (
       user_id, from_account_id, to_account_id,
       from_amount_minor, from_currency_code,
       to_amount_minor, to_currency_code,
       exchange_rate, transfer_date
     ) VALUES ($1, $2, $3, 500000, 'VND', 500000, 'VND', 1.0, '2026-11-10')
     RETURNING id`,
    [userId, defaultAccountId, savingsAccountId],
  );
  const transferId = transferRes.rows[0].id;

  return {
    userId,
    defaultAccountId,
    savingsAccountId,
    incomeCategoryId,
    expenseCategoryId,
    incomeSourceId,
    merchantId,
    transferId,
  };
}

describe('Real PostgreSQL DDL & Constraints Verification (PGlite)', () => {
  let db: PGliteWorkerExecutor;
  let tenantA: FixtureTenant;
  let tenantB: FixtureTenant;

  beforeAll(async () => {
    db = await bootSchemaDb();
    tenantA = await createTenantFixture(db, 'tenant-a@example.com');
    tenantB = await createTenantFixture(db, 'tenant-b@example.com');
  }, 30000);

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it('boots real PostgreSQL (PGlite >= 16), executes 001_initial_schema.sql, and creates all 13 tables & 5 currency seeds', async () => {
    const versionResult = await db.query<{ version: string }>('SELECT version()');
    const versionStr = versionResult.rows[0]?.version ?? '';
    const match = /PostgreSQL (\d+)\./.exec(versionStr);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(16);

    const tablesResult = await db.query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename ASC`,
    );
    expect(tablesResult.rows.map((r) => r.tablename)).toEqual([
      'accounts',
      'audit_logs',
      'budgets',
      'categories',
      'currencies',
      'idempotency_keys',
      'income_sources',
      'merchants',
      'recurring_rules',
      'transactions',
      'transfers',
      'user_sessions',
      'users',
    ]);

    const currenciesResult = await db.query<{
      code: string;
      name: string;
      minor_unit: number;
      symbol: string;
    }>('SELECT code, name, minor_unit, symbol FROM currencies ORDER BY code ASC');

    expect(currenciesResult.rows).toEqual([
      { code: 'EUR', name: 'Euro', minor_unit: 2, symbol: '€' },
      { code: 'JPY', name: 'Japanese Yen', minor_unit: 0, symbol: '¥' },
      { code: 'KWD', name: 'Kuwaiti Dinar', minor_unit: 3, symbol: 'KD' },
      { code: 'USD', name: 'US Dollar', minor_unit: 2, symbol: '$' },
      { code: 'VND', name: 'Vietnamese Dong', minor_unit: 0, symbol: '₫' },
    ]);
  });

  describe('Strict Type-Specific Transaction CHECK Constraints', () => {
    it('chk_tx_income_rules rejects INCOME with merchant_id, transfer_id, or null category_id', async () => {
      // Valid INCOME succeeds
      await db.query(
        `INSERT INTO transactions (
           user_id, account_id, entry_type, status, amount_minor, currency_code,
           transaction_date, category_id, income_source_id
         ) VALUES ($1, $2, 'INCOME', 'POSTED', 15000000, 'VND', '2026-11-01', $3, $4)`,
        [tenantA.userId, tenantA.defaultAccountId, tenantA.incomeCategoryId, tenantA.incomeSourceId],
      );

      // INCOME with merchant_id -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id, merchant_id
           ) VALUES ($1, $2, 'INCOME', 'POSTED', 1000, 'VND', '2026-11-01', $3, $4)`,
          [tenantA.userId, tenantA.defaultAccountId, tenantA.incomeCategoryId, tenantA.merchantId],
        ),
        '23514',
        'chk_tx_income_rules',
      );

      // INCOME with transfer_id -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id, transfer_id
           ) VALUES ($1, $2, 'INCOME', 'POSTED', 1000, 'VND', '2026-11-01', $3, $4)`,
          [tenantA.userId, tenantA.defaultAccountId, tenantA.incomeCategoryId, tenantA.transferId],
        ),
        '23514',
        'chk_tx_income_rules',
      );

      // INCOME without category_id -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id
           ) VALUES ($1, $2, 'INCOME', 'POSTED', 1000, 'VND', '2026-11-01', NULL)`,
          [tenantA.userId, tenantA.defaultAccountId],
        ),
        '23514',
        'chk_tx_income_rules',
      );
    });

    it('chk_tx_expense_rules rejects EXPENSE with income_source_id, transfer_id, or null category_id', async () => {
      // Valid EXPENSE succeeds
      await db.query(
        `INSERT INTO transactions (
           user_id, account_id, entry_type, status, amount_minor, currency_code,
           transaction_date, category_id, merchant_id
         ) VALUES ($1, $2, 'EXPENSE', 'POSTED', 65000, 'VND', '2026-11-02', $3, $4)`,
        [tenantA.userId, tenantA.defaultAccountId, tenantA.expenseCategoryId, tenantA.merchantId],
      );

      // EXPENSE with income_source_id -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id, income_source_id
           ) VALUES ($1, $2, 'EXPENSE', 'POSTED', 50000, 'VND', '2026-11-02', $3, $4)`,
          [tenantA.userId, tenantA.defaultAccountId, tenantA.expenseCategoryId, tenantA.incomeSourceId],
        ),
        '23514',
        'chk_tx_expense_rules',
      );

      // EXPENSE with transfer_id -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id, transfer_id
           ) VALUES ($1, $2, 'EXPENSE', 'POSTED', 50000, 'VND', '2026-11-02', $3, $4)`,
          [tenantA.userId, tenantA.defaultAccountId, tenantA.expenseCategoryId, tenantA.transferId],
        ),
        '23514',
        'chk_tx_expense_rules',
      );

      // EXPENSE without category_id -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id
           ) VALUES ($1, $2, 'EXPENSE', 'POSTED', 50000, 'VND', '2026-11-02', NULL)`,
          [tenantA.userId, tenantA.defaultAccountId],
        ),
        '23514',
        'chk_tx_expense_rules',
      );
    });

    it('chk_tx_transfer_rules rejects TRANSFER_OUT/TRANSFER_IN with category_id or missing transfer_id', async () => {
      // Valid TRANSFER_OUT and TRANSFER_IN succeed
      await db.query(
        `INSERT INTO transactions (
           user_id, account_id, entry_type, status, amount_minor, currency_code,
           transaction_date, transfer_id
         ) VALUES ($1, $2, 'TRANSFER_OUT', 'POSTED', 500000, 'VND', '2026-11-10', $3)`,
        [tenantA.userId, tenantA.defaultAccountId, tenantA.transferId],
      );
      await db.query(
        `INSERT INTO transactions (
           user_id, account_id, entry_type, status, amount_minor, currency_code,
           transaction_date, transfer_id
         ) VALUES ($1, $2, 'TRANSFER_IN', 'POSTED', 500000, 'VND', '2026-11-10', $3)`,
        [tenantA.userId, tenantA.savingsAccountId, tenantA.transferId],
      );

      // TRANSFER_OUT with category_id -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id, transfer_id
           ) VALUES ($1, $2, 'TRANSFER_OUT', 'POSTED', 500000, 'VND', '2026-11-10', $3, $4)`,
          [tenantA.userId, tenantA.defaultAccountId, tenantA.expenseCategoryId, tenantA.transferId],
        ),
        '23514',
        'chk_tx_transfer_rules',
      );

      // TRANSFER_IN with category_id -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id, transfer_id
           ) VALUES ($1, $2, 'TRANSFER_IN', 'POSTED', 500000, 'VND', '2026-11-10', $3, $4)`,
          [tenantA.userId, tenantA.savingsAccountId, tenantA.incomeCategoryId, tenantA.transferId],
        ),
        '23514',
        'chk_tx_transfer_rules',
      );

      // TRANSFER_OUT without transfer_id -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, transfer_id
           ) VALUES ($1, $2, 'TRANSFER_OUT', 'POSTED', 500000, 'VND', '2026-11-10', NULL)`,
          [tenantA.userId, tenantA.defaultAccountId],
        ),
        '23514',
        'chk_tx_transfer_rules',
      );
    });
  });

  describe('Composite FK Tenant Isolation', () => {
    it('rejects inserting User A transactions referencing User B account, category, income_source, merchant, or transfer', async () => {
      // User A transaction into User B account -> rejected by (account_id, user_id) composite FK
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id
           ) VALUES ($1, $2, 'EXPENSE', 'POSTED', 25000, 'VND', '2026-11-05', $3)`,
          [tenantA.userId, tenantB.defaultAccountId, tenantA.expenseCategoryId],
        ),
        '23503',
        'transactions_account_id_user_id_fkey',
      );

      // User A transaction into User B category -> rejected by (category_id, user_id) composite FK
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id
           ) VALUES ($1, $2, 'EXPENSE', 'POSTED', 25000, 'VND', '2026-11-05', $3)`,
          [tenantA.userId, tenantA.defaultAccountId, tenantB.expenseCategoryId],
        ),
        '23503',
        'transactions_category_id_user_id_fkey',
      );

      // User A income referencing User B income_source -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id, income_source_id
           ) VALUES ($1, $2, 'INCOME', 'POSTED', 25000, 'VND', '2026-11-05', $3, $4)`,
          [tenantA.userId, tenantA.defaultAccountId, tenantA.incomeCategoryId, tenantB.incomeSourceId],
        ),
        '23503',
        'transactions_income_source_id_user_id_fkey',
      );

      // User A expense referencing User B merchant -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, category_id, merchant_id
           ) VALUES ($1, $2, 'EXPENSE', 'POSTED', 25000, 'VND', '2026-11-05', $3, $4)`,
          [tenantA.userId, tenantA.defaultAccountId, tenantA.expenseCategoryId, tenantB.merchantId],
        ),
        '23503',
        'transactions_merchant_id_user_id_fkey',
      );

      // User A transfer entry referencing User B transfer header -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transactions (
             user_id, account_id, entry_type, status, amount_minor, currency_code,
             transaction_date, transfer_id
           ) VALUES ($1, $2, 'TRANSFER_OUT', 'POSTED', 25000, 'VND', '2026-11-05', $3)`,
          [tenantA.userId, tenantA.defaultAccountId, tenantB.transferId],
        ),
        '23503',
        'transactions_transfer_id_user_id_fkey',
      );

      // User A transfer header referencing User B account -> rejected
      await expectPgError(
        db.query(
          `INSERT INTO transfers (
             user_id, from_account_id, to_account_id,
             from_amount_minor, from_currency_code,
             to_amount_minor, to_currency_code,
             exchange_rate, transfer_date
           ) VALUES ($1, $2, $3, 10000, 'VND', 10000, 'VND', 1.0, '2026-11-05')`,
          [tenantA.userId, tenantA.defaultAccountId, tenantB.savingsAccountId],
        ),
        '23503',
        'transfers_to_account_id_user_id_fkey',
      );

      // User A budget referencing User A's INCOME category -> rejected by (category_id, user_id, category_kind) FK
      await expectPgError(
        db.query(
          `INSERT INTO budgets (
             user_id, category_id, category_kind, limit_minor, currency_code, period_start, period_end
           ) VALUES ($1, $2, 'EXPENSE', 1000000, 'VND', '2026-11-01', '2026-11-30')`,
          [tenantA.userId, tenantA.incomeCategoryId],
        ),
        '23503',
        'budgets_category_id_user_id_category_kind_fkey',
      );

      // User A recurring_rule referencing User A's INCOME category as EXPENSE -> rejected by (category_id, user_id, rule_kind) FK
      await expectPgError(
        db.query(
          `INSERT INTO recurring_rules (
             user_id, rule_kind, account_id, category_id, amount_minor, currency_code,
             frequency, interval_count, next_run_date, timezone
           ) VALUES ($1, 'EXPENSE', $2, $3, 500000, 'VND', 'MONTHLY', 1, '2026-11-30', 'Asia/Ho_Chi_Minh')`,
          [tenantA.userId, tenantA.defaultAccountId, tenantA.incomeCategoryId],
        ),
        '23503',
        'recurring_rules_category_id_user_id_rule_kind_fkey',
      );

      // User A recurring_rule referencing User B's account -> rejected by (account_id, user_id) FK
      await expectPgError(
        db.query(
          `INSERT INTO recurring_rules (
             user_id, rule_kind, account_id, category_id, amount_minor, currency_code,
             frequency, interval_count, next_run_date, timezone
           ) VALUES ($1, 'EXPENSE', $2, $3, 500000, 'VND', 'MONTHLY', 1, '2026-11-30', 'Asia/Ho_Chi_Minh')`,
          [tenantA.userId, tenantB.defaultAccountId, tenantA.expenseCategoryId],
        ),
        '23503',
        'recurring_rules_account_id_user_id_fkey',
      );
    });
  });

  describe('Partial Unique Index & Transfers Integrity', () => {
    it('idx_accounts_one_default_per_user rejects 2 active default accounts for the same user but allows archived defaults', async () => {
      // tenantA already has 1 active default account ('Sổ chung')
      await expectPgError(
        db.query(
          `INSERT INTO accounts (
             user_id, name, account_type, currency_code, opening_balance_minor, opening_balance_date, is_default
           ) VALUES ($1, 'Second Default', 'BANK', 'VND', 0, '2026-11-01', TRUE)`,
          [tenantA.userId],
        ),
        '23505',
        'idx_accounts_one_default_per_user',
      );

      // Archived row with is_default=TRUE does NOT violate active partial unique index
      await db.query(
        `INSERT INTO accounts (
           user_id, name, account_type, currency_code, opening_balance_minor, opening_balance_date, is_default, archived_at
         ) VALUES ($1, 'Legacy Archived Default', 'CASH', 'VND', 0, '2025-01-01', TRUE, now())`,
        [tenantA.userId],
      );
    });

    it('enforces transfers.from_account_id <> to_account_id and fk_transfers_fee_tx', async () => {
      // Self-transfer rejected
      await expectPgError(
        db.query(
          `INSERT INTO transfers (
             user_id, from_account_id, to_account_id,
             from_amount_minor, from_currency_code,
             to_amount_minor, to_currency_code,
             exchange_rate, transfer_date
           ) VALUES ($1, $2, $2, 100000, 'VND', 100000, 'VND', 1.0, '2026-11-11')`,
          [tenantA.userId, tenantA.defaultAccountId],
        ),
        '23514',
        'transfers_check',
      );

      // Non-existent fee_transaction_id rejected by fk_transfers_fee_tx
      const missingTxId = randomUUID();
      await expectPgError(
        db.query(
          `INSERT INTO transfers (
             user_id, from_account_id, to_account_id,
             from_amount_minor, from_currency_code,
             to_amount_minor, to_currency_code,
             exchange_rate, fee_transaction_id, transfer_date
           ) VALUES ($1, $2, $3, 100000, 'VND', 100000, 'VND', 1.0, $4, '2026-11-11')`,
          [tenantA.userId, tenantA.defaultAccountId, tenantA.savingsAccountId, missingTxId],
        ),
        '23503',
        'fk_transfers_fee_tx',
      );

      // Valid EXPENSE fee transaction linked via fk_transfers_fee_tx succeeds
      const feeTxRes = await db.query<{ id: string }>(
        `INSERT INTO transactions (
           user_id, account_id, entry_type, status, amount_minor, currency_code,
           transaction_date, category_id, description
         ) VALUES ($1, $2, 'EXPENSE', 'POSTED', 11000, 'VND', '2026-11-11', $3, 'Transfer fee')
         RETURNING id`,
        [tenantA.userId, tenantA.defaultAccountId, tenantA.expenseCategoryId],
      );
      const feeTxId = feeTxRes.rows[0].id;

      const linkedTransferRes = await db.query<{ id: string; fee_transaction_id: string }>(
        `INSERT INTO transfers (
           user_id, from_account_id, to_account_id,
           from_amount_minor, from_currency_code,
           to_amount_minor, to_currency_code,
           exchange_rate, fee_transaction_id, transfer_date
         ) VALUES ($1, $2, $3, 100000, 'VND', 100000, 'VND', 1.0, $4, '2026-11-11')
         RETURNING id, fee_transaction_id`,
        [tenantA.userId, tenantA.defaultAccountId, tenantA.savingsAccountId, feeTxId],
      );
      expect(linkedTransferRes.rows[0].fee_transaction_id).toBe(feeTxId);

      // Cannot delete referenced fee transaction while fk_transfers_fee_tx points to it
      await expectPgError(
        db.query('DELETE FROM transactions WHERE id = $1', [feeTxId]),
        '23503',
        'fk_transfers_fee_tx',
      );
    });
  });
});

describe('Real NestJS AppModule + Pg*Repositories against PostgreSQL (PGlite) & main.ts Config/CORS', () => {
  let pg: PGliteWorkerExecutor;
  let app: INestApplication;

  beforeAll(async () => {
    pg = await bootSchemaDb();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(TEST_APP_CONFIG)
      .overrideProvider(DatabaseService)
      .useValue(pg)
      .overrideProvider(DATABASE_EXECUTOR)
      .useValue(pg)
      .compile();

    app = moduleRef.createNestApplication();
    configureHttpApp(app, loadAppConfig({}));
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (pg) {
      await pg.close();
    }
  });

  it('verifies main.ts / app-config defaults (PORT ?? 3001) and CORS headers for http://localhost:3000 with credentials: true', async () => {
    const defaultConfig = loadAppConfig({});
    expect(defaultConfig.port).toBe(3001);
    expect(defaultConfig.corsOrigins).toEqual(['http://localhost:3000']);

    const customPortConfig = loadAppConfig({ PORT: '4200' });
    expect(customPortConfig.port).toBe(4200);

    const preflight = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');

    const health = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');
    expect(health.status).toBe(200);
    expect(health.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(health.headers['access-control-allow-credentials']).toBe('true');

    const disallowed = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://evil.example');
    expect(disallowed.status).toBe(200);
    expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('runs real Pg*Repositories end-to-end (register, idempotent income/expense, FX transfer with fee, budgets, cash-flow report)', async () => {
    // 1. Register user via real AuthController -> AuthService -> PgAuthRepository/PgAccountsRepository/PgCategoriesRepository
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'pg-e2e@example.com',
        password: 'StrongPassword1234!',
        fullName: 'PG E2E User',
        baseCurrencyCode: 'VND',
        timezone: 'Asia/Ho_Chi_Minh',
      });
    expect(regRes.status).toBe(201);
    const accessToken: string = regRes.body.accessToken;
    const defaultAccountId: string = regRes.body.defaultAccount.id;
    expect(regRes.body.defaultAccount.name).toBe('Sổ chung');

    // 2. Create KWD (3 minor units) account to test non-2-decimal persistence & FX transfer
    const kwdAccRes = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'KWD Travel Wallet',
        accountType: AccountType.SAVINGS,
        currencyCode: 'KWD',
        openingBalance: '10.500',
      });
    expect(kwdAccRes.status).toBe(201);
    expect(kwdAccRes.body.openingBalanceMinor).toBe('10500');
    const kwdAccountId: string = kwdAccRes.body.id;

    // 3. Fetch seeded categories from PostgreSQL
    const catsRes = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(catsRes.status).toBe(200);
    const incomeCat = catsRes.body.find((c: { kind: string }) => c.kind === CategoryKind.INCOME);
    const expenseCat = catsRes.body.find((c: { kind: string }) => c.kind === CategoryKind.EXPENSE);
    expect(incomeCat).toBeDefined();
    expect(expenseCat).toBeDefined();

    // 4. Create INCOME with Idempotency-Key and verify DB-backed idempotent replay
    const incKey = randomUUID();
    const incBody = {
      accountId: defaultAccountId,
      categoryId: incomeCat.id,
      amount: '20000000',
      transactionDate: '2026-11-10',
      description: 'Monthly salary',
    };
    const inc1 = await request(app.getHttpServer())
      .post('/api/v1/incomes')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', incKey)
      .send(incBody);
    expect(inc1.status).toBe(201);
    expect(inc1.body.amountMinor).toBe('20000000');
    expect(inc1.body.entryType).toBe(EntryType.INCOME);
    expect(inc1.body.status).toBe(TransactionStatus.POSTED);

    const inc2 = await request(app.getHttpServer())
      .post('/api/v1/incomes')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', incKey)
      .send(incBody);
    expect(inc2.status).toBe(201);
    expect(inc2.body.id).toBe(inc1.body.id);

    // 5. Create EXPENSE & Budget against real PostgreSQL
    const budgetRes = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        categoryId: expenseCat.id,
        limit: '1000000',
        currencyCode: 'VND',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
      });
    expect(budgetRes.status).toBe(201);

    const expRes = await request(app.getHttpServer())
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        accountId: defaultAccountId,
        categoryId: expenseCat.id,
        amount: '250000',
        transactionDate: '2026-11-12',
        description: 'Lunch',
      });
    expect(expRes.status).toBe(201);

    // 6. Cross-currency Transfer (VND -> KWD) with fee in VND
    const trfRes = await request(app.getHttpServer())
      .post('/api/v1/transfers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        fromAccountId: defaultAccountId,
        toAccountId: kwdAccountId,
        fromAmount: '825000',
        exchangeRate: '0.0000125',
        fee: '11000',
        transferDate: '2026-11-15',
        note: 'FX transfer to KWD wallet',
      });
    expect(trfRes.status).toBe(201);
    expect(trfRes.body.status).toBe(TransferStatus.POSTED);
    // 825000 * 0.0000125 = 10.3125 KWD -> 10312.5 fils -> Banker's rounding -> 10312 fils
    expect(trfRes.body.toAmountMinor).toBe('10312');
    expect(trfRes.body.feeTransactionId).toEqual(expect.any(String));

    // 7. Verify Posted Balances & Cash-Flow Report (transfers excluded, fee expense included)
    const balancesRes = await request(app.getHttpServer())
      .get('/api/v1/reports/balances')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(balancesRes.status).toBe(200);
    const vndGroup = balancesRes.body.currencies.find(
      (g: { currencyCode: string }) => g.currencyCode === 'VND',
    );
    const kwdGroup = balancesRes.body.currencies.find(
      (g: { currencyCode: string }) => g.currencyCode === 'KWD',
    );
    const vndAcc = vndGroup.accounts.find((a: { id: string }) => a.id === defaultAccountId);
    const kwdAcc = kwdGroup.accounts.find((a: { id: string }) => a.id === kwdAccountId);
    // 20,000,000 - 250,000 - 825,000 - 11,000 = 18,914,000 VND
    expect(vndAcc.postedBalanceMinor).toBe('18914000');
    // 10,500 + 10,312 = 20,812 fils (20.812 KWD)
    expect(kwdAcc.postedBalanceMinor).toBe('20812');

    const cashFlowRes = await request(app.getHttpServer())
      .get('/api/v1/reports/cash-flow?from=2026-11-01&to=2026-11-30')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(cashFlowRes.status).toBe(200);
    expect(cashFlowRes.body.currencies).toHaveLength(1);
    expect(cashFlowRes.body.currencies[0].currencyCode).toBe('VND');
    expect(cashFlowRes.body.currencies[0].totalIncomeMinor).toBe('20000000');
    // 250,000 expense + 11,000 transfer fee = 261,000 (transfer principal 825,000 excluded)
    expect(cashFlowRes.body.currencies[0].grossExpenseMinor).toBe('261000');
    expect(cashFlowRes.body.currencies[0].netCashFlowMinor).toBe('19739000');

    const budgetsListRes = await request(app.getHttpServer())
      .get('/api/v1/budgets')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(budgetsListRes.status).toBe(200);
    expect(budgetsListRes.body).toHaveLength(1);
    // Budget is scoped to the chosen EXPENSE category ('Ăn uống'), while fee sits under 'Phí chuyển khoản'
    expect(budgetsListRes.body[0].actualSpentMinor).toBe('250000');
  });

  it('enforces immediate access token revocation via PgAuthRepository after logout-all and DELETE /api/v1/users/me', async () => {
    const server = app.getHttpServer();

    const reg1 = await request(server).post('/api/v1/auth/register').send({
      email: 'pg-revoke@example.com',
      password: 'StrongPassword1234!',
      fullName: 'PG Revoke User',
    });
    expect(reg1.status).toBe(201);
    const token1 = reg1.body.accessToken as string;

    const login2 = await request(server).post('/api/v1/auth/login').send({
      email: 'pg-revoke@example.com',
      password: 'StrongPassword1234!',
    });
    expect(login2.status).toBe(200);
    const token2 = login2.body.accessToken as string;

    // Both tokens initially valid against real PostgreSQL
    expect(
      (await request(server).get('/api/v1/auth/me').set('Authorization', `Bearer ${token1}`)).status,
    ).toBe(200);
    expect(
      (await request(server).get('/api/v1/auth/me').set('Authorization', `Bearer ${token2}`)).status,
    ).toBe(200);

    // logout-all revokes all sessions in PostgreSQL -> stale access tokens immediately fail with 401
    const logoutAllRes = await request(server)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${token1}`);
    expect(logoutAllRes.status).toBe(204);

    const staleAfterLogout1 = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token1}`);
    expect(staleAfterLogout1.status).toBe(401);
    expect(staleAfterLogout1.headers['content-type']).toContain('application/problem+json');
    expect(staleAfterLogout1.body.code).toBe('UNAUTHORIZED');

    const staleAfterLogout2 = await request(server)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${token2}`);
    expect(staleAfterLogout2.status).toBe(401);

    // Login again, then schedule deletion -> stale accessToken immediately returns 401
    const login3 = await request(server).post('/api/v1/auth/login').send({
      email: 'pg-revoke@example.com',
      password: 'StrongPassword1234!',
    });
    expect(login3.status).toBe(200);
    const token3 = login3.body.accessToken as string;

    const deleteRes = await request(server)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${token3}`)
      .send({ password: 'StrongPassword1234!' });
    expect(deleteRes.status).toBe(200);

    const staleAfterDelete = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token3}`);
    expect(staleAfterDelete.status).toBe(401);
    expect(staleAfterDelete.body.code).toBe('UNAUTHORIZED');
  });

  it('runs PgRecurringRepository + ON CONFLICT (recurring_rule_id, occurrence_date) DO NOTHING end-to-end against PostgreSQL (PGlite)', async () => {
    const server = app.getHttpServer();

    const regRes = await request(server).post('/api/v1/auth/register').send({
      email: 'pg-recurring@example.com',
      password: 'StrongPassword1234!',
      fullName: 'PG Recurring User',
      baseCurrencyCode: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    expect(regRes.status).toBe(201);
    const token = regRes.body.accessToken as string;
    const defaultAccountId = regRes.body.defaultAccount.id as string;

    const catsRes = await request(server)
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${token}`);
    const expCat = catsRes.body.find((c: { kind: string }) => c.kind === CategoryKind.EXPENSE);
    const incCat = catsRes.body.find((c: { kind: string }) => c.kind === CategoryKind.INCOME);

    // Mismatched ruleKind vs category.kind -> 422
    const badKindRes = await request(server)
      .post('/api/v1/recurring-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ruleKind: CategoryKind.EXPENSE,
        categoryId: incCat.id,
        amountMinor: '500000',
        frequency: 'MONTHLY',
        nextRunDate: '2028-01-31',
      });
    expect(badKindRes.status).toBe(422);

    // Create monthly rule on leap-year Jan 31 with endDate = 2028-02-28
    const createRes = await request(server)
      .post('/api/v1/recurring-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ruleKind: CategoryKind.EXPENSE,
        categoryId: expCat.id,
        amountMinor: '750000',
        frequency: 'MONTHLY',
        intervalCount: 1,
        nextRunDate: '2028-01-31',
        endDate: '2028-02-28',
      });
    expect(createRes.status).toBe(201);
    const ruleId = createRes.body.id as string;
    expect(createRes.body.accountId).toBe(defaultAccountId);
    expect(createRes.body.currencyCode).toBe('VND');

    // Run due on 2028-01-31 -> generates 1 DRAFT, advances to 2028-02-29 (> endDate 2028-02-28 -> auto-deactivates)
    const run1 = await request(server)
      .post('/api/v1/recurring-rules/run-due')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ asOfDate: '2028-01-31' });
    expect(run1.status).toBe(200);
    expect(run1.body.generatedCount).toBe(1);
    expect(run1.body.skippedDuplicateCount).toBe(0);
    expect(run1.body.deactivatedRuleIds).toEqual([ruleId]);
    expect(run1.body.generatedTransactions[0].status).toBe(TransactionStatus.DRAFT);
    expect(run1.body.generatedTransactions[0].recurringRuleId).toBe(ruleId);
    expect(run1.body.generatedTransactions[0].occurrenceDate).toBe('2028-01-31');
    expect(run1.body.updatedRules[0].nextRunDate).toBe('2028-02-29');
    expect(run1.body.updatedRules[0].isActive).toBe(false);

    const draftTxId = run1.body.generatedTransactions[0].id as string;

    // Posted Balance remains 0 while generated transaction is DRAFT
    const accBefore = await request(server)
      .get(`/api/v1/accounts/${defaultAccountId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(accBefore.status).toBe(200);
    expect(accBefore.body.postedBalanceMinor).toBe('0');

    // Re-enable rule and force nextRunDate back to 2028-01-31 to exercise real PostgreSQL
    // ON CONFLICT (recurring_rule_id, occurrence_date) WHERE recurring_rule_id IS NOT NULL DO NOTHING
    const patchRes = await request(server)
      .patch(`/api/v1/recurring-rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nextRunDate: '2028-01-31', endDate: null, amountMinor: '900000' });
    expect(patchRes.status).toBe(200);

    const resumeRes = await request(server)
      .post(`/api/v1/recurring-rules/${ruleId}/resume`)
      .set('Authorization', `Bearer ${token}`);
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.isActive).toBe(true);

    const run2 = await request(server)
      .post('/api/v1/recurring-rules/run-due')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ asOfDate: '2028-01-31' });
    expect(run2.status).toBe(200);
    expect(run2.body.generatedCount).toBe(0);
    expect(run2.body.skippedDuplicateCount).toBe(1);
    expect(run2.body.updatedRules[0].nextRunDate).toBe('2028-02-29');

    // Confirm existing DRAFT transaction retains original 750,000 minor amount and updates Posted Balance on POST
    const expGetRes = await request(server)
      .get(`/api/v1/expenses/${draftTxId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(expGetRes.status).toBe(200);
    expect(expGetRes.body.amountMinor).toBe('750000');

    const postRes = await request(server)
      .post(`/api/v1/expenses/${draftTxId}/post`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID());
    expect(postRes.status).toBe(200);
    expect(postRes.body.status).toBe(TransactionStatus.POSTED);
    expect(postRes.body.accountPostedBalanceMinor).toBe('-750000');
  });
});
