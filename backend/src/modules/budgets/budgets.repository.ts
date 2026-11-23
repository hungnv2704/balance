import { EntryType, SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { BudgetEntity } from './budgets.types';

export const BUDGETS_REPOSITORY = Symbol('BUDGETS_REPOSITORY');

export interface CreateBudgetInput {
  readonly userId: string;
  readonly categoryId: string;
  readonly limitMinor: bigint;
  readonly currencyCode: SupportedCurrencyCode;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface UpdateBudgetInput {
  readonly limitMinor?: bigint;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly archivedAt?: Date | null;
}

export interface ListBudgetsFilter {
  readonly currencyCode?: SupportedCurrencyCode;
  readonly categoryId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly includeArchived?: boolean;
}

export interface BudgetDailyExpenseEntry {
  readonly categoryId: string;
  readonly currencyCode: SupportedCurrencyCode;
  readonly transactionDate: string;
  readonly entryType: EntryType.EXPENSE | EntryType.EXPENSE_REFUND;
  readonly totalMinor: bigint;
}

export interface BudgetsRepository {
  findById(
    db: DbQueryClient,
    userId: string,
    budgetId: string,
    forUpdate?: boolean,
  ): Promise<BudgetEntity | null>;

  findOverlappingActive(
    tx: DbTransactionClient,
    params: {
      userId: string;
      categoryId: string;
      currencyCode: SupportedCurrencyCode;
      periodStart: string;
      periodEnd: string;
      excludeBudgetId?: string;
    },
  ): Promise<BudgetEntity | null>;

  list(
    db: DbQueryClient,
    userId: string,
    filter?: ListBudgetsFilter,
  ): Promise<BudgetEntity[]>;

  create(tx: DbTransactionClient, input: CreateBudgetInput): Promise<BudgetEntity>;

  update(
    tx: DbTransactionClient,
    userId: string,
    budgetId: string,
    updates: UpdateBudgetInput,
  ): Promise<BudgetEntity>;

  getPostedExpenseTotalsForRange(
    db: DbQueryClient,
    params: {
      userId: string;
      minDate: string;
      maxDate: string;
      categoryIds?: ReadonlyArray<string>;
      currencyCodes?: ReadonlyArray<SupportedCurrencyCode>;
    },
  ): Promise<BudgetDailyExpenseEntry[]>;
}
