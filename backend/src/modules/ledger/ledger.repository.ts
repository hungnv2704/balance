import { EntryType, TransactionStatus } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { LedgerBalanceEntry } from '../../shared-kernel/domain/posted-balance';
import {
  CreateLedgerTransactionInput,
  CreateRecurringDraftTransactionInput,
  LedgerTransactionEntity,
  ListTransactionsFilter,
  UpdateEditableTransactionInput,
} from './ledger.types';

export const LEDGER_REPOSITORY = Symbol('LEDGER_REPOSITORY');

export interface ActiveDuplicateCandidate {
  readonly transactionDate: string;
  readonly amountMinor: bigint;
  readonly entryType: EntryType;
}

export interface LedgerRepository {
  insert(
    tx: DbTransactionClient,
    input: CreateLedgerTransactionInput,
  ): Promise<LedgerTransactionEntity>;

  insertRecurringDraftIfAbsent(
    tx: DbTransactionClient,
    input: CreateRecurringDraftTransactionInput,
  ): Promise<LedgerTransactionEntity | null>;

  findById(
    db: DbQueryClient,
    userId: string,
    transactionId: string,
    allowedEntryTypes?: ReadonlyArray<EntryType>,
    forUpdate?: boolean,
  ): Promise<LedgerTransactionEntity | null>;

  findByTransferId(
    db: DbQueryClient,
    userId: string,
    transferId: string,
    forUpdate?: boolean,
  ): Promise<LedgerTransactionEntity[]>;

  listAllForExport(
    db: DbQueryClient,
    userId: string,
    filter?: {
      accountId?: string;
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<LedgerTransactionEntity[]>;

  updateEditable(
    tx: DbTransactionClient,
    userId: string,
    transactionId: string,
    updates: UpdateEditableTransactionInput,
  ): Promise<LedgerTransactionEntity>;

  updateStatus(
    tx: DbTransactionClient,
    userId: string,
    transactionId: string,
    status: TransactionStatus,
    voidedAt?: Date | null,
  ): Promise<LedgerTransactionEntity>;

  list(
    db: DbQueryClient,
    filter: ListTransactionsFilter,
  ): Promise<{ items: LedgerTransactionEntity[]; hasMore: boolean }>;

  getBalanceEntriesForAccounts(
    db: DbQueryClient,
    userId: string,
    accountIds: ReadonlyArray<string>,
  ): Promise<Map<string, LedgerBalanceEntry[]>>;

  countTransactionsForAccount(
    db: DbQueryClient,
    userId: string,
    accountId: string,
  ): Promise<number>;

  sumRefundsForExpense(
    tx: DbTransactionClient,
    userId: string,
    originalExpenseId: string,
  ): Promise<bigint>;

  findActiveDuplicateCandidates(
    db: DbQueryClient,
    params: {
      userId: string;
      accountId: string;
      entryTypes: ReadonlyArray<EntryType>;
      minDate: string;
      maxDate: string;
    },
  ): Promise<ActiveDuplicateCandidate[]>;
}
