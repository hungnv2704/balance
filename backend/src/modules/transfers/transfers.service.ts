import { Inject, Injectable } from '@nestjs/common';
import {
  CategoryKind,
  CursorPaginatedResponse,
  EntryType,
  TransactionStatus,
  TransferDetailDto,
  TransferStatus,
} from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor, DbTransactionClient } from '../../database/database.types';
import {
  assertValidLocalDate,
  getLocalDateInTimezone,
} from '../../shared-kernel/domain/date-time';
import {
  InvalidStateTransitionException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { Money, roundHalfEven } from '../../shared-kernel/domain/money';
import { calculatePostedBalance } from '../../shared-kernel/domain/posted-balance';
import { IdempotencyService } from '../../shared-kernel/idempotency/idempotency.service';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from '../accounts/accounts.repository';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { CATEGORIES_REPOSITORY, CategoriesRepository } from '../categories/categories.repository';
import { LEDGER_REPOSITORY, LedgerRepository } from '../ledger/ledger.repository';
import { LedgerTransactionEntity } from '../ledger/ledger.types';
import { CreateTransferDto } from './transfers.dto';
import { TRANSFERS_REPOSITORY, TransfersRepository } from './transfers.repository';
import {
  DEFAULT_TRANSFER_FEE_CATEGORY_NAME,
  decodeTransferCursor,
  encodeTransferCursor,
  toTransferDetailDto,
} from './transfers.types';

const RATE_FORMAT_REGEX = /^\s*(\d+)(?:\.(\d+))?\s*$/;
const MAX_RATE_INT_DIGITS = 10;
const MAX_RATE_SCALE = 8;

function normalizeRateString(rawRate: string): string {
  const match = RATE_FORMAT_REGEX.exec(rawRate);
  if (!match) {
    throw new ValidationDomainException(
      'Exchange rate must be a valid positive decimal string.',
      'INVALID_EXCHANGE_RATE',
    );
  }
  const intPart = match[1].replace(/^0+(?=\d)/, '');
  const fracPart = match[2] ?? '';

  if (intPart.length > MAX_RATE_INT_DIGITS || fracPart.length > MAX_RATE_SCALE) {
    throw new ValidationDomainException(
      `Exchange rate must fit NUMERIC(18, 8) (at most ${MAX_RATE_INT_DIGITS} integer digits and ${MAX_RATE_SCALE} decimal places).`,
      'INVALID_EXCHANGE_RATE',
    );
  }

  const combined = BigInt(`${intPart}${fracPart}`);
  if (combined <= 0n) {
    throw new ValidationDomainException(
      'Exchange rate must be strictly positive (> 0).',
      'INVALID_EXCHANGE_RATE',
    );
  }

  return `${intPart}.${fracPart.padEnd(MAX_RATE_SCALE, '0')}`;
}

function isParityRate(normalizedRate: string): boolean {
  const [intPart, fracPart = ''] = normalizedRate.split('.');
  return BigInt(intPart) === 1n && /^0*$/.test(fracPart);
}

function deriveExchangeRate(fromMoney: Money, toMoney: Money): string {
  const numerator = toMoney.amountMinor * 10n ** BigInt(fromMoney.metadata.minorUnit + MAX_RATE_SCALE);
  const denominator = fromMoney.amountMinor * 10n ** BigInt(toMoney.metadata.minorUnit);
  const scaled = roundHalfEven(numerator, denominator);

  if (scaled <= 0n) {
    throw new ValidationDomainException(
      'Derived exchange rate underflows minimum NUMERIC(18, 8) precision.',
      'INVALID_EXCHANGE_RATE',
    );
  }
  if (scaled >= 10n ** 18n) {
    throw new ValidationDomainException(
      'Derived exchange rate exceeds NUMERIC(18, 8) bounds.',
      'INVALID_EXCHANGE_RATE',
    );
  }

  const raw = scaled.toString().padStart(MAX_RATE_SCALE + 1, '0');
  const splitIdx = raw.length - MAX_RATE_SCALE;
  return `${raw.slice(0, splitIdx)}.${raw.slice(splitIdx)}`;
}

@Injectable()
export class TransfersService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(TRANSFERS_REPOSITORY) private readonly transfersRepo: TransfersRepository,
    @Inject(ACCOUNTS_REPOSITORY) private readonly accountsRepo: AccountsRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(CATEGORIES_REPOSITORY) private readonly categoriesRepo: CategoriesRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  public async list(
    userId: string,
    query: {
      accountId?: string;
      status?: TransferStatus;
      fromDate?: string;
      toDate?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<CursorPaginatedResponse<TransferDetailDto>> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const cursor = query.cursor ? decodeTransferCursor(query.cursor) : undefined;
    const fromDate = query.fromDate ? assertValidLocalDate(query.fromDate) : undefined;
    const toDate = query.toDate ? assertValidLocalDate(query.toDate) : undefined;

    const { items, hasMore } = await this.transfersRepo.list(this.db, {
      userId,
      accountId: query.accountId,
      status: query.status,
      fromDate,
      toDate,
      limit,
      cursor,
    });

    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeTransferCursor({
            transferDate: last.transferDate,
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    return {
      items: items.map((transfer) => toTransferDetailDto({ transfer })),
      nextCursor,
      hasMore,
    };
  }

  public async getOne(userId: string, transferId: string): Promise<TransferDetailDto> {
    const transfer = await this.transfersRepo.findById(this.db, userId, transferId);
    if (!transfer) {
      throw new ResourceNotFoundException('Transfer');
    }

    const linkedTxs = await this.ledgerRepo.findByTransferId(this.db, userId, transfer.id);
    const fromTransaction = linkedTxs.find((t) => t.entryType === EntryType.TRANSFER_OUT) ?? null;
    const toTransaction = linkedTxs.find((t) => t.entryType === EntryType.TRANSFER_IN) ?? null;
    const feeTransaction = transfer.feeTransactionId
      ? await this.ledgerRepo.findById(this.db, userId, transfer.feeTransactionId, [
          EntryType.EXPENSE,
        ])
      : null;

    return toTransferDetailDto({
      transfer,
      fromTransaction,
      toTransaction,
      feeTransaction,
    });
  }

  public async create(
    userId: string,
    userTimezone: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    dto: CreateTransferDto,
  ): Promise<{ status: number; body: TransferDetailDto }> {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new ValidationDomainException(
        'Source and destination accounts must be different.',
        'SAME_ACCOUNT_TRANSFER',
      );
    }

    const transferDate = dto.transferDate
      ? assertValidLocalDate(dto.transferDate)
      : getLocalDateInTimezone(new Date(), userTimezone);

    return this.db.withTransaction(async (tx) => {
      const exec = await this.idempotencyService.execute(
        tx,
        {
          userId,
          idempotencyKey,
          method: 'POST',
          path: requestPath,
          payload: dto,
        },
        async () => {
          // Deterministic id ASC locking to prevent deadlocks across concurrent opposite transfers
          const lockedIds = [dto.fromAccountId, dto.toAccountId].sort((a, b) => a.localeCompare(b));
          const lockedAccounts = await this.accountsRepo.findManyByIdsForUpdate(
            tx,
            userId,
            lockedIds,
          );

          const fromAccount = lockedAccounts.find((a) => a.id === dto.fromAccountId);
          const toAccount = lockedAccounts.find((a) => a.id === dto.toAccountId);

          if (!fromAccount) {
            throw new ResourceNotFoundException('Source account');
          }
          if (!toAccount) {
            throw new ResourceNotFoundException('Destination account');
          }
          if (fromAccount.archivedAt !== null || toAccount.archivedAt !== null) {
            throw new InvalidStateTransitionException(
              'Cannot transfer using an archived account.',
              'ACCOUNT_ARCHIVED',
            );
          }

          const fromMoney = Money.fromApiInput({
            amountMinor: dto.fromAmountMinor,
            amount: dto.fromAmount,
            currencyCode: fromAccount.currencyCode,
            allowZero: false,
            allowNegative: false,
          });

          const { toMoney, exchangeRate, rateSource } = this.resolveConversion({
            fromMoney,
            toCurrencyCode: toAccount.currencyCode,
            dto,
          });

          const feeMoney =
            dto.feeMinor !== undefined || dto.fee !== undefined
              ? Money.fromApiInput({
                  amountMinor: dto.feeMinor,
                  amount: dto.fee,
                  currencyCode: fromAccount.currencyCode,
                  allowZero: false,
                  allowNegative: false,
                })
              : null;

          const rateEffectiveAt = new Date();
          let transfer = await this.transfersRepo.create(tx, {
            userId,
            fromAccountId: fromAccount.id,
            toAccountId: toAccount.id,
            fromAmountMinor: fromMoney.amountMinor,
            fromCurrencyCode: fromAccount.currencyCode,
            toAmountMinor: toMoney.amountMinor,
            toCurrencyCode: toAccount.currencyCode,
            exchangeRate,
            rateSource,
            rateEffectiveAt,
            transferDate,
            note: dto.note ?? null,
            status: TransferStatus.POSTED,
          });

          const fromTransaction = await this.ledgerRepo.insert(tx, {
            userId,
            accountId: fromAccount.id,
            entryType: EntryType.TRANSFER_OUT,
            status: TransactionStatus.POSTED,
            amountMinor: fromMoney.amountMinor,
            currencyCode: fromAccount.currencyCode,
            transactionDate: transferDate,
            description: null,
            note: dto.note ?? null,
            transferId: transfer.id,
          });

          const toTransaction = await this.ledgerRepo.insert(tx, {
            userId,
            accountId: toAccount.id,
            entryType: EntryType.TRANSFER_IN,
            status: TransactionStatus.POSTED,
            amountMinor: toMoney.amountMinor,
            currencyCode: toAccount.currencyCode,
            transactionDate: transferDate,
            description: null,
            note: dto.note ?? null,
            transferId: transfer.id,
          });

          let feeTransaction: LedgerTransactionEntity | null = null;
          if (feeMoney) {
            const feeCategory = await this.resolveOrCreateFeeCategory(tx, userId);
            feeTransaction = await this.ledgerRepo.insert(tx, {
              userId,
              accountId: fromAccount.id,
              entryType: EntryType.EXPENSE,
              status: TransactionStatus.POSTED,
              amountMinor: feeMoney.amountMinor,
              currencyCode: fromAccount.currencyCode,
              transactionDate: transferDate,
              description: DEFAULT_TRANSFER_FEE_CATEGORY_NAME,
              note: dto.note ?? null,
              categoryId: feeCategory.id,
              transferId: null,
            });
            transfer = await this.transfersRepo.setFeeTransactionId(
              tx,
              userId,
              transfer.id,
              feeTransaction.id,
            );
          }

          await this.auditRepo.record(tx, {
            userId,
            entityType: 'transfer',
            entityId: transfer.id,
            action: 'TRANSFER_CREATED',
            metadata: {
              fromAccountId: fromAccount.id,
              toAccountId: toAccount.id,
              fromCurrencyCode: fromAccount.currencyCode,
              toCurrencyCode: toAccount.currencyCode,
              hasFee: feeTransaction !== null,
              feeTransactionId: feeTransaction?.id ?? null,
            },
          });

          const balanceMap = await this.ledgerRepo.getBalanceEntriesForAccounts(tx, userId, [
            fromAccount.id,
            toAccount.id,
          ]);
          const fromAccountPostedBalanceMinor = calculatePostedBalance(
            fromAccount.openingBalanceMinor,
            balanceMap.get(fromAccount.id) ?? [],
            fromAccount.currencyCode,
          );
          const toAccountPostedBalanceMinor = calculatePostedBalance(
            toAccount.openingBalanceMinor,
            balanceMap.get(toAccount.id) ?? [],
            toAccount.currencyCode,
          );

          return {
            status: 201,
            body: toTransferDetailDto({
              transfer,
              fromTransaction,
              toTransaction,
              feeTransaction,
              fromAccountPostedBalanceMinor,
              toAccountPostedBalanceMinor,
            }),
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }

  public async void(
    userId: string,
    transferId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    reasonCode?: string,
  ): Promise<{ status: number; body: TransferDetailDto }> {
    return this.transitionStatus(
      userId,
      transferId,
      idempotencyKey,
      requestPath,
      TransferStatus.VOIDED,
      TransactionStatus.VOIDED,
      'TRANSFER_VOIDED',
      reasonCode,
    );
  }

  public async reverse(
    userId: string,
    transferId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    reasonCode?: string,
  ): Promise<{ status: number; body: TransferDetailDto }> {
    return this.transitionStatus(
      userId,
      transferId,
      idempotencyKey,
      requestPath,
      TransferStatus.REVERSED,
      TransactionStatus.REVERSED,
      'TRANSFER_REVERSED',
      reasonCode,
    );
  }

  private resolveConversion(params: {
    fromMoney: Money;
    toCurrencyCode: string;
    dto: CreateTransferDto;
  }): { toMoney: Money; exchangeRate: string; rateSource: string } {
    const { fromMoney, toCurrencyCode, dto } = params;
    const rateSource =
      dto.rateSource && dto.rateSource.trim().length > 0
        ? dto.rateSource.trim()
        : 'USER_SUPPLIED';

    if (fromMoney.currencyCode === toCurrencyCode) {
      if (dto.exchangeRate !== undefined) {
        const normalized = normalizeRateString(dto.exchangeRate);
        if (!isParityRate(normalized)) {
          throw new ValidationDomainException(
            'Same-currency transfer must have exchangeRate equal to 1.',
            'INVALID_EXCHANGE_RATE',
          );
        }
      }

      if (dto.toAmountMinor !== undefined || dto.toAmount !== undefined) {
        const explicitTo = Money.fromApiInput({
          amountMinor: dto.toAmountMinor,
          amount: dto.toAmount,
          currencyCode: toCurrencyCode,
          allowZero: false,
          allowNegative: false,
        });
        if (!explicitTo.equals(fromMoney)) {
          throw new ValidationDomainException(
            'Same-currency transfer requires equal source and destination amounts.',
            'TRANSFER_AMOUNT_MISMATCH',
          );
        }
      }

      return {
        toMoney: fromMoney,
        exchangeRate: '1.00000000',
        rateSource,
      };
    }

    // Cross-currency conversion
    const hasExplicitTo = dto.toAmountMinor !== undefined || dto.toAmount !== undefined;
    const hasExplicitRate = dto.exchangeRate !== undefined;

    if (!hasExplicitTo && !hasExplicitRate) {
      throw new ValidationDomainException(
        'Cross-currency transfer requires exchangeRate or destination amount.',
        'MISSING_EXCHANGE_RATE',
      );
    }

    if (hasExplicitRate) {
      const normalizedRate = normalizeRateString(dto.exchangeRate!);
      const converted = fromMoney.convertWithRate(toCurrencyCode, normalizedRate);
      if (converted.amountMinor <= 0n) {
        throw new ValidationDomainException(
          'Converted destination amount must be strictly greater than zero.',
          'NON_POSITIVE_CONVERTED_AMOUNT',
        );
      }

      if (hasExplicitTo) {
        const explicitTo = Money.fromApiInput({
          amountMinor: dto.toAmountMinor,
          amount: dto.toAmount,
          currencyCode: toCurrencyCode,
          allowZero: false,
          allowNegative: false,
        });
        if (!explicitTo.equals(converted)) {
          throw new ValidationDomainException(
            'Destination amount conflicts with fromAmount and exchangeRate (Banker Rounding).',
            'AMBIGUOUS_TRANSFER_CONVERSION',
          );
        }
      }

      return {
        toMoney: converted,
        exchangeRate: normalizedRate,
        rateSource,
      };
    }

    // Explicit destination amount without exchangeRate -> derive effective rate
    const toMoney = Money.fromApiInput({
      amountMinor: dto.toAmountMinor,
      amount: dto.toAmount,
      currencyCode: toCurrencyCode,
      allowZero: false,
      allowNegative: false,
    });
    const derivedRate = deriveExchangeRate(fromMoney, toMoney);

    return {
      toMoney,
      exchangeRate: derivedRate,
      rateSource,
    };
  }

  private async resolveOrCreateFeeCategory(tx: DbTransactionClient, userId: string) {
    const existing = await this.categoriesRepo.findActiveByName(
      tx,
      userId,
      CategoryKind.EXPENSE,
      DEFAULT_TRANSFER_FEE_CATEGORY_NAME,
    );
    if (existing) {
      return existing;
    }
    return this.categoriesRepo.create(tx, {
      userId,
      kind: CategoryKind.EXPENSE,
      name: DEFAULT_TRANSFER_FEE_CATEGORY_NAME,
    });
  }

  private async transitionStatus(
    userId: string,
    transferId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    targetTransferStatus: TransferStatus.VOIDED | TransferStatus.REVERSED,
    targetTxStatus: TransactionStatus.VOIDED | TransactionStatus.REVERSED,
    auditAction: string,
    reasonCode?: string,
  ): Promise<{ status: number; body: TransferDetailDto }> {
    return this.db.withTransaction(async (tx) => {
      const exec = await this.idempotencyService.execute(
        tx,
        {
          userId,
          idempotencyKey,
          method: 'POST',
          path: requestPath,
          payload: { transferId, targetTransferStatus, reasonCode: reasonCode ?? null },
        },
        async () => {
          const existing = await this.transfersRepo.findById(tx, userId, transferId, true);
          if (!existing) {
            throw new ResourceNotFoundException('Transfer');
          }
          if (existing.status !== TransferStatus.POSTED) {
            throw new InvalidStateTransitionException(
              `Cannot transition transfer from '${existing.status}' to '${targetTransferStatus}'.`,
            );
          }

          // Lock both accounts in deterministic id ASC order
          const sortedAccountIds = [existing.fromAccountId, existing.toAccountId].sort((a, b) =>
            a.localeCompare(b),
          );
          const lockedAccounts = await this.accountsRepo.findManyByIdsForUpdate(
            tx,
            userId,
            sortedAccountIds,
          );
          const fromAccount = lockedAccounts.find((a) => a.id === existing.fromAccountId);
          const toAccount = lockedAccounts.find((a) => a.id === existing.toAccountId);
          if (!fromAccount || !toAccount) {
            throw new ResourceNotFoundException('Account');
          }

          const now = new Date();
          const voidedAt = targetTransferStatus === TransferStatus.VOIDED ? now : null;

          const linkedTxs = await this.ledgerRepo.findByTransferId(tx, userId, existing.id, true);
          let updatedFromTx: LedgerTransactionEntity | null = null;
          let updatedToTx: LedgerTransactionEntity | null = null;

          for (const linked of linkedTxs) {
            const updatedLinked = await this.ledgerRepo.updateStatus(
              tx,
              userId,
              linked.id,
              targetTxStatus,
              voidedAt,
            );
            if (updatedLinked.entryType === EntryType.TRANSFER_OUT) {
              updatedFromTx = updatedLinked;
            } else if (updatedLinked.entryType === EntryType.TRANSFER_IN) {
              updatedToTx = updatedLinked;
            }
          }

          let updatedFeeTx: LedgerTransactionEntity | null = null;
          if (existing.feeTransactionId) {
            const feeTx = await this.ledgerRepo.findById(
              tx,
              userId,
              existing.feeTransactionId,
              [EntryType.EXPENSE],
              true,
            );
            if (feeTx) {
              if (
                feeTx.status === TransactionStatus.POSTED ||
                feeTx.status === TransactionStatus.DRAFT ||
                feeTx.status === TransactionStatus.PENDING
              ) {
                updatedFeeTx = await this.ledgerRepo.updateStatus(
                  tx,
                  userId,
                  feeTx.id,
                  targetTxStatus,
                  voidedAt,
                );
              } else {
                updatedFeeTx = feeTx;
              }
            }
          }

          const updatedTransfer = await this.transfersRepo.updateStatus(
            tx,
            userId,
            existing.id,
            targetTransferStatus,
            voidedAt,
          );

          await this.auditRepo.record(tx, {
            userId,
            entityType: 'transfer',
            entityId: existing.id,
            action: auditAction,
            metadata: {
              fromStatus: existing.status,
              toStatus: targetTransferStatus,
              feeTransactionId: existing.feeTransactionId,
              ...(reasonCode ? { reasonCode } : {}),
            },
          });

          const balanceMap = await this.ledgerRepo.getBalanceEntriesForAccounts(tx, userId, [
            fromAccount.id,
            toAccount.id,
          ]);
          const fromAccountPostedBalanceMinor = calculatePostedBalance(
            fromAccount.openingBalanceMinor,
            balanceMap.get(fromAccount.id) ?? [],
            fromAccount.currencyCode,
          );
          const toAccountPostedBalanceMinor = calculatePostedBalance(
            toAccount.openingBalanceMinor,
            balanceMap.get(toAccount.id) ?? [],
            toAccount.currencyCode,
          );

          return {
            status: 200,
            body: toTransferDetailDto({
              transfer: updatedTransfer,
              fromTransaction: updatedFromTx,
              toTransaction: updatedToTx,
              feeTransaction: updatedFeeTx,
              fromAccountPostedBalanceMinor,
              toAccountPostedBalanceMinor,
            }),
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }
}
