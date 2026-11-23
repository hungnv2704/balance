import { Inject, Injectable } from '@nestjs/common';
import {
  CategoryKind,
  CursorPaginatedResponse,
  EntryType,
  ExpenseResponseDto,
  MerchantDto,
  TransactionStatus,
} from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import {
  assertValidLocalDate,
  getLocalDateInTimezone,
} from '../../shared-kernel/domain/date-time';
import {
  CurrencyMismatchException,
  InvalidStateTransitionException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { Money } from '../../shared-kernel/domain/money';
import { calculatePostedBalance } from '../../shared-kernel/domain/posted-balance';
import { IdempotencyService } from '../../shared-kernel/idempotency/idempotency.service';
import { DefaultAccountResolver } from '../accounts/default-account.resolver';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { CategoriesService } from '../categories/categories.service';
import { LEDGER_REPOSITORY, LedgerRepository } from '../ledger/ledger.repository';
import {
  decodeLedgerCursor,
  encodeLedgerCursor,
  LedgerTransactionEntity,
  toTransactionRecordDto,
} from '../ledger/ledger.types';
import {
  CreateExpenseDto,
  CreateExpenseRefundDto,
  CreateMerchantDto,
  UpdateExpenseDto,
} from './expense.dto';
import {
  MERCHANTS_REPOSITORY,
  MerchantsRepository,
  toMerchantDto,
} from './merchants.repository';

function toExpenseResponseDto(
  entity: LedgerTransactionEntity,
  accountPostedBalanceMinor?: bigint,
  warnings?: string[],
): ExpenseResponseDto {
  const base = toTransactionRecordDto(entity);
  return {
    ...base,
    entryType: entity.entryType as EntryType.EXPENSE | EntryType.EXPENSE_REFUND,
    ...(accountPostedBalanceMinor !== undefined
      ? { accountPostedBalanceMinor: accountPostedBalanceMinor.toString() }
      : {}),
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
  };
}

@Injectable()
export class ExpenseService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(MERCHANTS_REPOSITORY) private readonly merchantsRepo: MerchantsRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly defaultAccountResolver: DefaultAccountResolver,
    private readonly categoriesService: CategoriesService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  public async list(
    userId: string,
    query: {
      entryType?: EntryType.EXPENSE | EntryType.EXPENSE_REFUND;
      accountId?: string;
      categoryId?: string;
      merchantId?: string;
      status?: TransactionStatus;
      fromDate?: string;
      toDate?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<CursorPaginatedResponse<ExpenseResponseDto>> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const cursor = query.cursor ? decodeLedgerCursor(query.cursor) : undefined;
    const fromDate = query.fromDate ? assertValidLocalDate(query.fromDate) : undefined;
    const toDate = query.toDate ? assertValidLocalDate(query.toDate) : undefined;

    const entryTypes = query.entryType
      ? [query.entryType]
      : [EntryType.EXPENSE, EntryType.EXPENSE_REFUND];

    const { items, hasMore } = await this.ledgerRepo.list(this.db, {
      userId,
      entryTypes,
      accountId: query.accountId,
      categoryId: query.categoryId,
      merchantId: query.merchantId,
      status: query.status,
      fromDate,
      toDate,
      limit,
      cursor,
    });

    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeLedgerCursor({
            transactionDate: last.transactionDate,
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    return {
      items: items.map((item) => toExpenseResponseDto(item)),
      nextCursor,
      hasMore,
    };
  }

  public async getOne(userId: string, expenseId: string): Promise<ExpenseResponseDto> {
    const tx = await this.ledgerRepo.findById(this.db, userId, expenseId, [
      EntryType.EXPENSE,
      EntryType.EXPENSE_REFUND,
    ]);
    if (!tx) {
      throw new ResourceNotFoundException('Expense');
    }
    return toExpenseResponseDto(tx);
  }

  public async create(
    userId: string,
    userTimezone: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    dto: CreateExpenseDto,
  ): Promise<{ status: number; body: ExpenseResponseDto }> {
    const txDate = dto.transactionDate
      ? assertValidLocalDate(dto.transactionDate)
      : getLocalDateInTimezone(new Date(), userTimezone);
    const targetStatus = dto.status ?? TransactionStatus.POSTED;

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
          // Resolve explicit account_id or fall back to user's active Default Account ("Sổ chung")
          const account = await this.defaultAccountResolver.resolveForTransaction(
            tx,
            userId,
            dto.accountId,
          );

          // BR-EXP-01: Currency must match paying account currency
          if (dto.currencyCode !== undefined) {
            const requestedCurrency = Money.zero(dto.currencyCode).currencyCode;
            if (requestedCurrency !== account.currencyCode) {
              throw new CurrencyMismatchException(account.currencyCode, requestedCurrency);
            }
          }

          // BR-EXP-01: Strictly positive amount in account currency minor units
          const money = Money.fromApiInput({
            amountMinor: dto.amountMinor,
            amount: dto.amount,
            currencyCode: account.currencyCode,
            allowZero: false,
            allowNegative: false,
          });

          // Enforce category ownership and kind === EXPENSE
          await this.categoriesService.assertActiveCategoryForKind(
            userId,
            dto.categoryId,
            CategoryKind.EXPENSE,
            tx,
          );

          if (dto.merchantId) {
            const merchant = await this.merchantsRepo.findById(tx, userId, dto.merchantId);
            if (!merchant) {
              throw new ResourceNotFoundException('Merchant');
            }
            if (merchant.archivedAt !== null) {
              throw new InvalidStateTransitionException(
                'Cannot use an archived merchant.',
                'MERCHANT_ARCHIVED',
              );
            }
          }

          const created = await this.ledgerRepo.insert(tx, {
            userId,
            accountId: account.id,
            entryType: EntryType.EXPENSE,
            status: targetStatus,
            amountMinor: money.amountMinor,
            currencyCode: account.currencyCode,
            transactionDate: txDate,
            description: dto.description ?? null,
            note: dto.note ?? null,
            categoryId: dto.categoryId,
            merchantId: dto.merchantId ?? null,
          });

          await this.auditRepo.record(tx, {
            userId,
            entityType: 'transaction',
            entityId: created.id,
            action: 'EXPENSE_CREATED',
            metadata: { status: created.status, accountId: account.id },
          });

          const balanceMap = await this.ledgerRepo.getBalanceEntriesForAccounts(tx, userId, [
            account.id,
          ]);
          const postedBalance = calculatePostedBalance(
            account.openingBalanceMinor,
            balanceMap.get(account.id) ?? [],
            account.currencyCode,
          );

          // BR-EXP-02 & BR-ACC-06: Soft warning only when Multi-Account mode (>= 2 active accounts)
          const activeAccounts = await this.defaultAccountResolver.getActiveAccountCount(tx, userId);
          const warnings: string[] = [];
          if (activeAccounts > 1 && postedBalance < 0n) {
            warnings.push('ACCOUNT_BALANCE_NEGATIVE');
          }

          return {
            status: 201,
            body: toExpenseResponseDto(created, postedBalance, warnings),
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }

  public async update(
    userId: string,
    expenseId: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    const updated = await this.db.withTransaction(async (tx) => {
      const existing = await this.ledgerRepo.findById(
        tx,
        userId,
        expenseId,
        [EntryType.EXPENSE],
        true,
      );
      if (!existing) {
        throw new ResourceNotFoundException('Expense');
      }

      if (
        existing.status !== TransactionStatus.DRAFT &&
        existing.status !== TransactionStatus.PENDING
      ) {
        throw new InvalidStateTransitionException(
          `Cannot directly edit an expense record in '${existing.status}' status. Use void or reverse instead.`,
        );
      }

      const targetAccount = dto.accountId
        ? await this.defaultAccountResolver.resolveForTransaction(tx, userId, dto.accountId)
        : await this.defaultAccountResolver.resolveForTransaction(tx, userId, existing.accountId);

      if (dto.currencyCode !== undefined) {
        const requested = Money.zero(dto.currencyCode).currencyCode;
        if (requested !== targetAccount.currencyCode) {
          throw new CurrencyMismatchException(targetAccount.currencyCode, requested);
        }
      } else if (targetAccount.currencyCode !== existing.currencyCode) {
        throw new CurrencyMismatchException(targetAccount.currencyCode, existing.currencyCode);
      }

      let updatedAmountMinor: bigint | undefined;
      if (dto.amountMinor !== undefined || dto.amount !== undefined) {
        updatedAmountMinor = Money.fromApiInput({
          amountMinor: dto.amountMinor,
          amount: dto.amount,
          currencyCode: targetAccount.currencyCode,
        }).amountMinor;
      }

      if (dto.categoryId) {
        await this.categoriesService.assertActiveCategoryForKind(
          userId,
          dto.categoryId,
          CategoryKind.EXPENSE,
          tx,
        );
      }

      if (dto.merchantId) {
        const merchant = await this.merchantsRepo.findById(tx, userId, dto.merchantId);
        if (!merchant) {
          throw new ResourceNotFoundException('Merchant');
        }
        if (merchant.archivedAt !== null) {
          throw new InvalidStateTransitionException('Cannot use an archived merchant.');
        }
      }

      const nextDate = dto.transactionDate
        ? assertValidLocalDate(dto.transactionDate)
        : undefined;

      return this.ledgerRepo.updateEditable(tx, userId, expenseId, {
        accountId: targetAccount.id,
        currencyCode: targetAccount.currencyCode,
        amountMinor: updatedAmountMinor,
        transactionDate: nextDate,
        description: dto.description,
        note: dto.note,
        categoryId: dto.categoryId,
        merchantId: dto.merchantId,
      });
    });

    return toExpenseResponseDto(updated);
  }

  public async post(
    userId: string,
    expenseId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
  ): Promise<{ status: number; body: ExpenseResponseDto }> {
    return this.transitionStatus(
      userId,
      expenseId,
      idempotencyKey,
      requestPath,
      TransactionStatus.POSTED,
      [TransactionStatus.DRAFT, TransactionStatus.PENDING],
      'EXPENSE_POSTED',
    );
  }

  public async void(
    userId: string,
    expenseId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    reasonCode?: string,
  ): Promise<{ status: number; body: ExpenseResponseDto }> {
    return this.transitionStatus(
      userId,
      expenseId,
      idempotencyKey,
      requestPath,
      TransactionStatus.VOIDED,
      [TransactionStatus.DRAFT, TransactionStatus.PENDING, TransactionStatus.POSTED],
      'EXPENSE_VOIDED',
      reasonCode,
    );
  }

  public async reverse(
    userId: string,
    expenseId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    reasonCode?: string,
  ): Promise<{ status: number; body: ExpenseResponseDto }> {
    return this.transitionStatus(
      userId,
      expenseId,
      idempotencyKey,
      requestPath,
      TransactionStatus.REVERSED,
      [TransactionStatus.POSTED],
      'EXPENSE_REVERSED',
      reasonCode,
    );
  }

  /**
   * BR-EXP-03 / BR-EXP-04: Records an EXPENSE_REFUND linked to an original POSTED expense.
   * Locks the original expense row to enforce sum(refunds) <= original.amountMinor under concurrency.
   */
  public async createRefund(
    userId: string,
    userTimezone: string,
    originalExpenseId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    dto: CreateExpenseRefundDto,
  ): Promise<{ status: number; body: ExpenseResponseDto }> {
    const txDate = dto.transactionDate
      ? assertValidLocalDate(dto.transactionDate)
      : getLocalDateInTimezone(new Date(), userTimezone);

    return this.db.withTransaction(async (tx) => {
      const exec = await this.idempotencyService.execute(
        tx,
        {
          userId,
          idempotencyKey,
          method: 'POST',
          path: requestPath,
          payload: { originalExpenseId, ...dto },
        },
        async () => {
          const original = await this.ledgerRepo.findById(
            tx,
            userId,
            originalExpenseId,
            [EntryType.EXPENSE],
            true,
          );
          if (!original) {
            throw new ResourceNotFoundException('Original expense');
          }
          if (original.status !== TransactionStatus.POSTED) {
            throw new InvalidStateTransitionException(
              'Refunds can only be recorded against a POSTED expense.',
            );
          }

          const targetAccount = await this.defaultAccountResolver.resolveForTransaction(
            tx,
            userId,
            dto.accountId ?? original.accountId,
          );

          if (targetAccount.currencyCode !== original.currencyCode) {
            throw new CurrencyMismatchException(
              original.currencyCode,
              targetAccount.currencyCode,
            );
          }

          if (dto.currencyCode !== undefined) {
            const requested = Money.zero(dto.currencyCode).currencyCode;
            if (requested !== original.currencyCode) {
              throw new CurrencyMismatchException(original.currencyCode, requested);
            }
          }

          const refundMoney = Money.fromApiInput({
            amountMinor: dto.amountMinor,
            amount: dto.amount,
            currencyCode: original.currencyCode,
            allowZero: false,
            allowNegative: false,
          });

          const existingRefundsTotal = await this.ledgerRepo.sumRefundsForExpense(
            tx,
            userId,
            original.id,
          );

          if (existingRefundsTotal + refundMoney.amountMinor > original.amountMinor) {
            throw new ValidationDomainException(
              'Total refunded amount cannot exceed the original expense amount.',
              'REFUND_EXCEEDS_ORIGINAL_EXPENSE',
            );
          }

          const created = await this.ledgerRepo.insert(tx, {
            userId,
            accountId: targetAccount.id,
            entryType: EntryType.EXPENSE_REFUND,
            status: TransactionStatus.POSTED,
            amountMinor: refundMoney.amountMinor,
            currencyCode: targetAccount.currencyCode,
            transactionDate: txDate,
            description: dto.description ?? original.description,
            note: dto.note ?? null,
            categoryId: original.categoryId,
            merchantId: original.merchantId,
            refundsTransactionId: original.id,
          });

          await this.auditRepo.record(tx, {
            userId,
            entityType: 'transaction',
            entityId: created.id,
            action: 'EXPENSE_REFUND_CREATED',
            metadata: { originalExpenseId: original.id, accountId: targetAccount.id },
          });

          const balanceMap = await this.ledgerRepo.getBalanceEntriesForAccounts(tx, userId, [
            targetAccount.id,
          ]);
          const postedBalance = calculatePostedBalance(
            targetAccount.openingBalanceMinor,
            balanceMap.get(targetAccount.id) ?? [],
            targetAccount.currencyCode,
          );

          return {
            status: 201,
            body: toExpenseResponseDto(created, postedBalance),
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }

  public async listMerchants(userId: string): Promise<MerchantDto[]> {
    const items = await this.merchantsRepo.list(this.db, userId);
    return items.map(toMerchantDto);
  }

  public async createMerchant(userId: string, dto: CreateMerchantDto): Promise<MerchantDto> {
    const trimmed = dto.name.trim();
    if (trimmed.length === 0) {
      throw new ValidationDomainException('Merchant name cannot be empty.');
    }
    const created = await this.db.withTransaction((tx) =>
      this.merchantsRepo.create(tx, userId, trimmed),
    );
    return toMerchantDto(created);
  }

  private async transitionStatus(
    userId: string,
    expenseId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    targetStatus: TransactionStatus,
    allowedFromStatuses: ReadonlyArray<TransactionStatus>,
    auditAction: string,
    reasonCode?: string,
  ): Promise<{ status: number; body: ExpenseResponseDto }> {
    return this.db.withTransaction(async (tx) => {
      const exec = await this.idempotencyService.execute(
        tx,
        {
          userId,
          idempotencyKey,
          method: 'POST',
          path: requestPath,
          payload: { expenseId, targetStatus, reasonCode: reasonCode ?? null },
        },
        async () => {
          const existing = await this.ledgerRepo.findById(
            tx,
            userId,
            expenseId,
            [EntryType.EXPENSE, EntryType.EXPENSE_REFUND],
            true,
          );
          if (!existing) {
            throw new ResourceNotFoundException('Expense');
          }

          if (!allowedFromStatuses.includes(existing.status)) {
            throw new InvalidStateTransitionException(
              `Cannot transition expense from '${existing.status}' to '${targetStatus}'.`,
            );
          }

          const updated = await this.ledgerRepo.updateStatus(
            tx,
            userId,
            expenseId,
            targetStatus,
            targetStatus === TransactionStatus.VOIDED ? new Date() : null,
          );

          await this.auditRepo.record(tx, {
            userId,
            entityType: 'transaction',
            entityId: expenseId,
            action: auditAction,
            metadata: {
              fromStatus: existing.status,
              toStatus: targetStatus,
              ...(reasonCode ? { reasonCode } : {}),
            },
          });

          const account = await this.defaultAccountResolver.resolveForTransaction(
            tx,
            userId,
            updated.accountId,
          );
          const balanceMap = await this.ledgerRepo.getBalanceEntriesForAccounts(tx, userId, [
            account.id,
          ]);
          const postedBalance = calculatePostedBalance(
            account.openingBalanceMinor,
            balanceMap.get(account.id) ?? [],
            account.currencyCode,
          );

          return {
            status: 200,
            body: toExpenseResponseDto(updated, postedBalance),
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }
}
