import { CategoryKind, EntryType, SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient } from '../../database/database.types';

export const REPORTING_REPOSITORY = Symbol('REPORTING_REPOSITORY');

export interface CashFlowAggregateRow {
  readonly currencyCode: SupportedCurrencyCode;
  readonly entryType: EntryType.INCOME | EntryType.EXPENSE | EntryType.EXPENSE_REFUND;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly categoryKind: CategoryKind;
  readonly totalMinor: bigint;
  readonly transactionCount: number;
}

export interface CashFlowQueryParams {
  readonly userId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly currencyCode?: SupportedCurrencyCode;
  readonly accountId?: string;
}

export interface ReportingRepository {
  aggregatePostedCashFlow(
    db: DbQueryClient,
    params: CashFlowQueryParams,
  ): Promise<CashFlowAggregateRow[]>;
}
