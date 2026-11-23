import { Inject, Injectable } from '@nestjs/common';
import {
  CategoryKind,
  CursorPaginatedResponse,
  EntryType,
  IncomeResponseDto,
  IncomeSourceDto,
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
  INCOME_SOURCES_REPOSITORY,
  IncomeSourcesRepository,
  toIncomeSourceDto,
} from './income-sources.repository';
import { CreateIncomeDto, CreateIncomeSourceDto, UpdateIncomeDto } from './income.dto';

function toIncomeResponseDto(
  entity: LedgerTransactionEntity,
  accountPostedBalanceMinor?: bigint,
): IncomeResponseDto {
  const base = toTransactionRecordDto(entity);
  return {
    ...base,
    entryType: EntryType.INCOME,
    ...(accountPostedBalanceMinor !== undefined
      ? { accountPostedBalanceMinor: accountPostedBalanceMinor.toString() }
      : {}),
  };
}

@Injectable()
export class IncomeService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(INCOME_SOURCES_REPOSITORY) private readonly incomeSourcesRepo: IncomeSourcesRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly defaultAccountResolver: DefaultAccountResolver,
    private readonly categoriesService: CategoriesService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  public async list(
    userId: string,
    query: {
      accountId?: string;
      categoryId?: string;
      incomeSourceId?: string;
      status?: TransactionStatus;
      fromDate?: string;
      toDate?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<CursorPaginatedResponse<IncomeResponseDto>> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const cursor = query.cursor ? decodeLedgerCursor(query.cursor) : undefined;
    const fromDate = query.fromDate ? assertValidLocalDate(query.fromDate) : undefined;
    const toDate = query.toDate ? assertValidLocalDate(query.toDate) : undefined;

    const { items, hasMore } = await this.ledgerRepo.list(this.db, {
      userId,
      entryTypes: [EntryType.INCOME],
      accountId: query.accountId,
      categoryId: query.categoryId,
      incomeSourceId: query.incomeSourceId,
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
      items: items.map((item) => toIncomeResponseDto(item)),
      nextCursor,
      hasMore,
    };
  }

  public async getOne(userId: string, incomeId: string): Promise<IncomeResponseDto> {
    const tx = await this.ledgerRepo.findById(this.db, userId, incomeId, [EntryType.INCOME]);
    if (!tx) {
      throw new ResourceNotFoundException('Income');
    }
    return toIncomeResponseDto(tx);
  }

  public async create(
    userId: string,
    userTimezone: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    dto: CreateIncomeDto,
  ): Promise<{ status: number; body: IncomeResponseDto }> {
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

          // BR-INC-02: Currency must match receiving account currency
          if (dto.currencyCode !== undefined) {
            const requestedCurrency = Money.zero(dto.currencyCode).currencyCode;
            if (requestedCurrency !== account.currencyCode) {
              throw new CurrencyMismatchException(account.currencyCode, requestedCurrency);
            }
          }

          // BR-INC-01: Strictly positive amount in account currency minor units
          const money = Money.fromApiInput({
            amountMinor: dto.amountMinor,
            amount: dto.amount,
            currencyCode: account.currencyCode,
            allowZero: false,
            allowNegative: false,
          });

          // Enforce category ownership and kind === INCOME
          await this.categoriesService.assertActiveCategoryForKind(
            userId,
            dto.categoryId,
            CategoryKind.INCOME,
            tx,
          );

          if (dto.incomeSourceId) {
            const source = await this.incomeSourcesRepo.findById(tx, userId, dto.incomeSourceId);
            if (!source) {
              throw new ResourceNotFoundException('Income source');
            }
            if (source.archivedAt !== null) {
              throw new InvalidStateTransitionException(
                'Cannot use an archived income source.',
                'INCOME_SOURCE_ARCHIVED',
              );
            }
          }

          const created = await this.ledgerRepo.insert(tx, {
            userId,
            accountId: account.id,
            entryType: EntryType.INCOME,
            status: targetStatus,
            amountMinor: money.amountMinor,
            currencyCode: account.currencyCode,
            transactionDate: txDate,
            description: dto.description ?? null,
            note: dto.note ?? null,
            categoryId: dto.categoryId,
            incomeSourceId: dto.incomeSourceId ?? null,
          });

          await this.auditRepo.record(tx, {
            userId,
            entityType: 'transaction',
            entityId: created.id,
            action: 'INCOME_CREATED',
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

          return {
            status: 201,
            body: toIncomeResponseDto(created, postedBalance),
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }

  public async update(
    userId: string,
    incomeId: string,
    dto: UpdateIncomeDto,
  ): Promise<IncomeResponseDto> {
    const updated = await this.db.withTransaction(async (tx) => {
      const existing = await this.ledgerRepo.findById(
        tx,
        userId,
        incomeId,
        [EntryType.INCOME],
        true,
      );
      if (!existing) {
        throw new ResourceNotFoundException('Income');
      }

      if (
        existing.status !== TransactionStatus.DRAFT &&
        existing.status !== TransactionStatus.PENDING
      ) {
        throw new InvalidStateTransitionException(
          `Cannot directly edit an income record in '${existing.status}' status. Use void or reverse instead.`,
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
          CategoryKind.INCOME,
          tx,
        );
      }

      if (dto.incomeSourceId) {
        const source = await this.incomeSourcesRepo.findById(tx, userId, dto.incomeSourceId);
        if (!source) {
          throw new ResourceNotFoundException('Income source');
        }
        if (source.archivedAt !== null) {
          throw new InvalidStateTransitionException('Cannot use an archived income source.');
        }
      }

      const nextDate = dto.transactionDate
        ? assertValidLocalDate(dto.transactionDate)
        : undefined;

      return this.ledgerRepo.updateEditable(tx, userId, incomeId, {
        accountId: targetAccount.id,
        currencyCode: targetAccount.currencyCode,
        amountMinor: updatedAmountMinor,
        transactionDate: nextDate,
        description: dto.description,
        note: dto.note,
        categoryId: dto.categoryId,
        incomeSourceId: dto.incomeSourceId,
      });
    });

    return toIncomeResponseDto(updated);
  }

  public async post(
    userId: string,
    incomeId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
  ): Promise<{ status: number; body: IncomeResponseDto }> {
    return this.transitionStatus(
      userId,
      incomeId,
      idempotencyKey,
      requestPath,
      TransactionStatus.POSTED,
      [TransactionStatus.DRAFT, TransactionStatus.PENDING],
      'INCOME_POSTED',
    );
  }

  public async void(
    userId: string,
    incomeId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    reasonCode?: string,
  ): Promise<{ status: number; body: IncomeResponseDto }> {
    return this.transitionStatus(
      userId,
      incomeId,
      idempotencyKey,
      requestPath,
      TransactionStatus.VOIDED,
      [TransactionStatus.DRAFT, TransactionStatus.PENDING, TransactionStatus.POSTED],
      'INCOME_VOIDED',
      reasonCode,
    );
  }

  public async reverse(
    userId: string,
    incomeId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    reasonCode?: string,
  ): Promise<{ status: number; body: IncomeResponseDto }> {
    return this.transitionStatus(
      userId,
      incomeId,
      idempotencyKey,
      requestPath,
      TransactionStatus.REVERSED,
      [TransactionStatus.POSTED],
      'INCOME_REVERSED',
      reasonCode,
    );
  }

  public async listSources(userId: string): Promise<IncomeSourceDto[]> {
    const items = await this.incomeSourcesRepo.list(this.db, userId);
    return items.map(toIncomeSourceDto);
  }

  public async createSource(userId: string, dto: CreateIncomeSourceDto): Promise<IncomeSourceDto> {
    const trimmed = dto.name.trim();
    if (trimmed.length === 0) {
      throw new ValidationDomainException('Income source name cannot be empty.');
    }
    const created = await this.db.withTransaction((tx) =>
      this.incomeSourcesRepo.create(tx, userId, trimmed),
    );
    return toIncomeSourceDto(created);
  }

  private async transitionStatus(
    userId: string,
    incomeId: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    targetStatus: TransactionStatus,
    allowedFromStatuses: ReadonlyArray<TransactionStatus>,
    auditAction: string,
    reasonCode?: string,
  ): Promise<{ status: number; body: IncomeResponseDto }> {
    return this.db.withTransaction(async (tx) => {
      const exec = await this.idempotencyService.execute(
        tx,
        {
          userId,
          idempotencyKey,
          method: 'POST',
          path: requestPath,
          payload: { incomeId, targetStatus, reasonCode: reasonCode ?? null },
        },
        async () => {
          const existing = await this.ledgerRepo.findById(
            tx,
            userId,
            incomeId,
            [EntryType.INCOME],
            true,
          );
          if (!existing) {
            throw new ResourceNotFoundException('Income');
          }

          if (!allowedFromStatuses.includes(existing.status)) {
            throw new InvalidStateTransitionException(
              `Cannot transition income from '${existing.status}' to '${targetStatus}'.`,
            );
          }

          const updated = await this.ledgerRepo.updateStatus(
            tx,
            userId,
            incomeId,
            targetStatus,
            targetStatus === TransactionStatus.VOIDED ? new Date() : null,
          );

          await this.auditRepo.record(tx, {
            userId,
            entityType: 'transaction',
            entityId: incomeId,
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
            body: toIncomeResponseDto(updated, postedBalance),
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }
}
