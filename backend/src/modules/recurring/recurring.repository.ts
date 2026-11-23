import { CategoryKind, RecurringFrequency, SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { RecurringRuleEntity } from './recurring.types';

export const RECURRING_REPOSITORY = Symbol('RECURRING_REPOSITORY');

export interface ListRecurringRulesFilter {
  readonly ruleKind?: CategoryKind;
  readonly isActive?: boolean;
}

export interface CreateRecurringRuleInput {
  readonly userId: string;
  readonly ruleKind: CategoryKind;
  readonly accountId: string;
  readonly categoryId: string;
  readonly amountMinor: bigint;
  readonly currencyCode: SupportedCurrencyCode;
  readonly frequency: RecurringFrequency;
  readonly intervalCount: number;
  readonly nextRunDate: string;
  readonly endDate: string | null;
  readonly timezone: string;
  readonly isActive: boolean;
}

export interface UpdateRecurringRuleInput {
  readonly accountId?: string;
  readonly categoryId?: string;
  readonly amountMinor?: bigint;
  readonly frequency?: RecurringFrequency;
  readonly intervalCount?: number;
  readonly nextRunDate?: string;
  readonly endDate?: string | null;
  readonly timezone?: string;
  readonly isActive?: boolean;
}

export interface RecurringRepository {
  findById(
    db: DbQueryClient,
    userId: string,
    ruleId: string,
    forUpdate?: boolean,
  ): Promise<RecurringRuleEntity | null>;

  list(
    db: DbQueryClient,
    userId: string,
    filter?: ListRecurringRulesFilter,
  ): Promise<RecurringRuleEntity[]>;

  findDueActiveForUpdate(
    tx: DbTransactionClient,
    userId: string,
    asOfDate: string,
  ): Promise<RecurringRuleEntity[]>;

  create(
    tx: DbTransactionClient,
    input: CreateRecurringRuleInput,
  ): Promise<RecurringRuleEntity>;

  update(
    tx: DbTransactionClient,
    userId: string,
    ruleId: string,
    updates: UpdateRecurringRuleInput,
  ): Promise<RecurringRuleEntity>;
}
