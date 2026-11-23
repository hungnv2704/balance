import { SupportedCurrencyCode, TransferStatus } from '@pfm/shared-types';
import { DbQueryClient, DbTransactionClient } from '../../database/database.types';
import { TransferCursor, TransferEntity } from './transfers.types';

export const TRANSFERS_REPOSITORY = Symbol('TRANSFERS_REPOSITORY');

export interface CreateTransferInput {
  readonly userId: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly fromAmountMinor: bigint;
  readonly fromCurrencyCode: SupportedCurrencyCode;
  readonly toAmountMinor: bigint;
  readonly toCurrencyCode: SupportedCurrencyCode;
  readonly exchangeRate: string;
  readonly rateSource: string;
  readonly rateEffectiveAt: Date;
  readonly transferDate: string;
  readonly note: string | null;
  readonly status: TransferStatus;
}

export interface ListTransfersFilter {
  readonly userId: string;
  readonly accountId?: string;
  readonly status?: TransferStatus;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit: number;
  readonly cursor?: TransferCursor;
}

export interface TransfersRepository {
  create(tx: DbTransactionClient, input: CreateTransferInput): Promise<TransferEntity>;

  findById(
    db: DbQueryClient,
    userId: string,
    transferId: string,
    forUpdate?: boolean,
  ): Promise<TransferEntity | null>;

  setFeeTransactionId(
    tx: DbTransactionClient,
    userId: string,
    transferId: string,
    feeTransactionId: string,
  ): Promise<TransferEntity>;

  updateStatus(
    tx: DbTransactionClient,
    userId: string,
    transferId: string,
    status: TransferStatus,
    voidedAt?: Date | null,
  ): Promise<TransferEntity>;

  list(
    db: DbQueryClient,
    filter: ListTransfersFilter,
  ): Promise<{ items: TransferEntity[]; hasMore: boolean }>;

  listAllByUser(
    db: DbQueryClient,
    userId: string,
    filter?: { accountId?: string; fromDate?: string; toDate?: string },
  ): Promise<TransferEntity[]>;
}
