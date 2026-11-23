import { AccountType, SupportedCurrencyCode } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { AccountEntity } from './accounts.types';

export const ACCOUNTS_REPOSITORY = Symbol('ACCOUNTS_REPOSITORY');

export interface CreateAccountInput {
  readonly userId: string;
  readonly name: string;
  readonly accountType: AccountType;
  readonly currencyCode: SupportedCurrencyCode;
  readonly openingBalanceMinor: bigint;
  readonly openingBalanceDate: string;
  readonly isDefault: boolean;
}

export interface UpdateAccountInput {
  readonly name?: string;
  readonly accountType?: AccountType;
  readonly currencyCode?: SupportedCurrencyCode;
  readonly isDefault?: boolean;
}

export interface AccountsRepository {
  findById(
    db: DbQueryClient,
    userId: string,
    accountId: string,
    forUpdate?: boolean,
  ): Promise<AccountEntity | null>;

  findManyByIdsForUpdate(
    tx: DbTransactionClient,
    userId: string,
    accountIds: ReadonlyArray<string>,
  ): Promise<AccountEntity[]>;

  findAllByUser(
    db: DbQueryClient,
    userId: string,
    includeArchived: boolean,
  ): Promise<AccountEntity[]>;

  findActiveByUserForUpdate(
    tx: DbTransactionClient,
    userId: string,
  ): Promise<AccountEntity[]>;

  findDefaultActiveByUser(
    db: DbQueryClient,
    userId: string,
  ): Promise<AccountEntity | null>;

  countActiveByUser(db: DbQueryClient, userId: string): Promise<number>;

  create(tx: DbTransactionClient, input: CreateAccountInput): Promise<AccountEntity>;

  clearDefaultForUser(tx: DbTransactionClient, userId: string): Promise<void>;

  update(
    tx: DbTransactionClient,
    userId: string,
    accountId: string,
    updates: UpdateAccountInput,
  ): Promise<AccountEntity>;

  archive(
    tx: DbTransactionClient,
    userId: string,
    accountId: string,
  ): Promise<AccountEntity>;
}
