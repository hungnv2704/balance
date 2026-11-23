import {
  SupportedCurrencyCode,
  TransferDetailDto,
  TransferDto,
  TransferStatus,
} from '@pfm/shared-types';
import { assertValidLocalDate } from '../../shared-kernel/domain/date-time';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';
import { LedgerTransactionEntity, toTransactionRecordDto } from '../ledger/ledger.types';

export const DEFAULT_TRANSFER_FEE_CATEGORY_NAME = 'Phí ngân hàng / Chuyển khoản';

export interface TransferEntity {
  readonly id: string;
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
  readonly feeTransactionId: string | null;
  readonly transferDate: string;
  readonly note: string | null;
  readonly status: TransferStatus;
  readonly voidedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TransferCursor {
  readonly transferDate: string;
  readonly createdAt: string;
  readonly id: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeTransferCursor(cursor: TransferCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeTransferCursor(rawCursor: string): TransferCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(rawCursor, 'base64url').toString('utf8'),
    ) as Partial<TransferCursor>;
    if (
      !parsed ||
      typeof parsed.transferDate !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error('Malformed cursor fields');
    }
    assertValidLocalDate(parsed.transferDate);
    if (Number.isNaN(Date.parse(parsed.createdAt))) {
      throw new Error('Malformed cursor createdAt');
    }
    if (!UUID_REGEX.test(parsed.id)) {
      throw new Error('Malformed cursor id');
    }
    return {
      transferDate: parsed.transferDate,
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    throw new ValidationDomainException('Invalid pagination cursor.', 'INVALID_CURSOR');
  }
}

export function toTransferDto(entity: TransferEntity): TransferDto {
  return {
    id: entity.id,
    fromAccountId: entity.fromAccountId,
    toAccountId: entity.toAccountId,
    fromAmountMinor: entity.fromAmountMinor.toString(),
    fromCurrencyCode: entity.fromCurrencyCode,
    toAmountMinor: entity.toAmountMinor.toString(),
    toCurrencyCode: entity.toCurrencyCode,
    exchangeRate: entity.exchangeRate,
    rateSource: entity.rateSource,
    rateEffectiveAt: entity.rateEffectiveAt.toISOString(),
    feeTransactionId: entity.feeTransactionId,
    transferDate: entity.transferDate,
    note: entity.note,
    status: entity.status,
    voidedAt: entity.voidedAt ? entity.voidedAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toTransferDetailDto(params: {
  transfer: TransferEntity;
  fromTransaction?: LedgerTransactionEntity | null;
  toTransaction?: LedgerTransactionEntity | null;
  feeTransaction?: LedgerTransactionEntity | null;
  fromAccountPostedBalanceMinor?: bigint;
  toAccountPostedBalanceMinor?: bigint;
}): TransferDetailDto {
  return {
    ...toTransferDto(params.transfer),
    ...(params.fromTransaction !== undefined
      ? { fromTransaction: params.fromTransaction ? toTransactionRecordDto(params.fromTransaction) : null }
      : {}),
    ...(params.toTransaction !== undefined
      ? { toTransaction: params.toTransaction ? toTransactionRecordDto(params.toTransaction) : null }
      : {}),
    ...(params.feeTransaction !== undefined
      ? { feeTransaction: params.feeTransaction ? toTransactionRecordDto(params.feeTransaction) : null }
      : {}),
    ...(params.fromAccountPostedBalanceMinor !== undefined
      ? { fromAccountPostedBalanceMinor: params.fromAccountPostedBalanceMinor.toString() }
      : {}),
    ...(params.toAccountPostedBalanceMinor !== undefined
      ? { toAccountPostedBalanceMinor: params.toAccountPostedBalanceMinor.toString() }
      : {}),
  };
}
