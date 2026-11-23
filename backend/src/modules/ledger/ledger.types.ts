import {
  EntryType,
  SupportedCurrencyCode,
  TransactionRecordDto,
  TransactionStatus,
} from '@pfm/shared-types';
import { assertValidLocalDate } from '../../shared-kernel/domain/date-time';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';

export interface LedgerTransactionEntity {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly entryType: EntryType;
  readonly status: TransactionStatus;
  readonly amountMinor: bigint;
  readonly currencyCode: SupportedCurrencyCode;
  readonly transactionDate: string;
  readonly description: string | null;
  readonly note: string | null;
  readonly categoryId: string | null;
  readonly incomeSourceId: string | null;
  readonly merchantId: string | null;
  readonly transferId: string | null;
  readonly recurringRuleId: string | null;
  readonly occurrenceDate: string | null;
  readonly refundsTransactionId: string | null;
  readonly reversesTransactionId: string | null;
  readonly voidedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateLedgerTransactionInput {
  readonly userId: string;
  readonly accountId: string;
  readonly entryType: EntryType;
  readonly status: TransactionStatus;
  readonly amountMinor: bigint;
  readonly currencyCode: SupportedCurrencyCode;
  readonly transactionDate: string;
  readonly description?: string | null;
  readonly note?: string | null;
  readonly categoryId?: string | null;
  readonly incomeSourceId?: string | null;
  readonly merchantId?: string | null;
  readonly transferId?: string | null;
  readonly recurringRuleId?: string | null;
  readonly occurrenceDate?: string | null;
  readonly refundsTransactionId?: string | null;
  readonly reversesTransactionId?: string | null;
}

export interface CreateRecurringDraftTransactionInput {
  readonly userId: string;
  readonly accountId: string;
  readonly entryType: EntryType.INCOME | EntryType.EXPENSE;
  readonly amountMinor: bigint;
  readonly currencyCode: SupportedCurrencyCode;
  readonly transactionDate: string;
  readonly categoryId: string;
  readonly recurringRuleId: string;
  readonly occurrenceDate: string;
  readonly description?: string | null;
  readonly note?: string | null;
}

export interface UpdateEditableTransactionInput {
  readonly accountId?: string;
  readonly amountMinor?: bigint;
  readonly currencyCode?: SupportedCurrencyCode;
  readonly transactionDate?: string;
  readonly description?: string | null;
  readonly note?: string | null;
  readonly categoryId?: string | null;
  readonly incomeSourceId?: string | null;
  readonly merchantId?: string | null;
}

export interface ListTransactionsFilter {
  readonly userId: string;
  readonly entryTypes?: ReadonlyArray<EntryType>;
  readonly accountId?: string;
  readonly categoryId?: string;
  readonly incomeSourceId?: string;
  readonly merchantId?: string;
  readonly status?: TransactionStatus;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit: number;
  readonly cursor?: LedgerCursor;
}

export interface LedgerCursor {
  readonly transactionDate: string;
  readonly createdAt: string;
  readonly id: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeLedgerCursor(cursor: LedgerCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeLedgerCursor(rawCursor: string): LedgerCursor {
  try {
    const parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')) as Partial<LedgerCursor>;
    if (
      !parsed ||
      typeof parsed.transactionDate !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error('Malformed cursor fields');
    }
    assertValidLocalDate(parsed.transactionDate);
    if (Number.isNaN(Date.parse(parsed.createdAt))) {
      throw new Error('Malformed cursor createdAt');
    }
    if (!UUID_REGEX.test(parsed.id)) {
      throw new Error('Malformed cursor id');
    }
    return {
      transactionDate: parsed.transactionDate,
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    throw new ValidationDomainException('Invalid pagination cursor.', 'INVALID_CURSOR');
  }
}

export function toTransactionRecordDto(entity: LedgerTransactionEntity): TransactionRecordDto {
  return {
    id: entity.id,
    accountId: entity.accountId,
    entryType: entity.entryType,
    status: entity.status,
    amountMinor: entity.amountMinor.toString(),
    currencyCode: entity.currencyCode,
    transactionDate: entity.transactionDate,
    description: entity.description,
    note: entity.note,
    categoryId: entity.categoryId,
    incomeSourceId: entity.incomeSourceId,
    merchantId: entity.merchantId,
    transferId: entity.transferId,
    recurringRuleId: entity.recurringRuleId,
    occurrenceDate: entity.occurrenceDate,
    refundsTransactionId: entity.refundsTransactionId,
    reversesTransactionId: entity.reversesTransactionId,
    voidedAt: entity.voidedAt ? entity.voidedAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
