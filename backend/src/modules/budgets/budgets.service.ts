import { Inject, Injectable } from '@nestjs/common';
import {
  BudgetDto,
  CategoryKind,
  EntryType,
  SupportedCurrencyCode,
} from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor, DbQueryClient } from '../../database/database.types';
import {
  assertValidLocalDate,
  getLocalDateInTimezone,
} from '../../shared-kernel/domain/date-time';
import {
  DomainConflictException,
  InvalidStateTransitionException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { Money } from '../../shared-kernel/domain/money';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { CATEGORIES_REPOSITORY, CategoriesRepository } from '../categories/categories.repository';
import { CategoriesService } from '../categories/categories.service';
import { CreateBudgetDto, UpdateBudgetDto } from './budgets.dto';
import { BUDGETS_REPOSITORY, BudgetsRepository } from './budgets.repository';
import {
  BudgetEntity,
  computeBudgetMetrics,
  resolveMonthBounds,
  toBudgetDto,
} from './budgets.types';

@Injectable()
export class BudgetsService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(BUDGETS_REPOSITORY) private readonly budgetsRepo: BudgetsRepository,
    @Inject(CATEGORIES_REPOSITORY) private readonly categoriesRepo: CategoriesRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly categoriesService: CategoriesService,
  ) {}

  public async list(
    userId: string,
    query: {
      currency?: string;
      month?: string;
      fromDate?: string;
      toDate?: string;
      categoryId?: string;
      includeArchived?: boolean;
    },
  ): Promise<BudgetDto[]> {
    const currencyCode = query.currency
      ? Money.zero(query.currency).currencyCode
      : undefined;

    let fromDate = query.fromDate ? assertValidLocalDate(query.fromDate) : undefined;
    let toDate = query.toDate ? assertValidLocalDate(query.toDate) : undefined;

    if (query.month !== undefined) {
      const bounds = resolveMonthBounds(query.month);
      fromDate = fromDate ?? bounds.periodStart;
      toDate = toDate ?? bounds.periodEnd;
    }

    if (fromDate && toDate && fromDate > toDate) {
      throw new ValidationDomainException(
        'fromDate cannot be after toDate.',
        'INVALID_DATE_RANGE',
      );
    }

    const budgets = await this.budgetsRepo.list(this.db, userId, {
      currencyCode,
      categoryId: query.categoryId,
      fromDate,
      toDate,
      includeArchived: query.includeArchived ?? false,
    });

    if (budgets.length === 0) {
      return [];
    }

    return this.enrichBudgets(this.db, userId, budgets);
  }

  public async getOne(userId: string, budgetId: string): Promise<BudgetDto> {
    const budget = await this.budgetsRepo.findById(this.db, userId, budgetId);
    if (!budget) {
      throw new ResourceNotFoundException('Budget');
    }
    const [enriched] = await this.enrichBudgets(this.db, userId, [budget]);
    return enriched;
  }

  public async create(
    userId: string,
    userTimezone: string,
    dto: CreateBudgetDto,
  ): Promise<BudgetDto> {
    const currency = Money.zero(dto.currencyCode).currencyCode;
    const limitMoney = Money.fromApiInput({
      amountMinor: dto.limitMinor,
      amount: dto.limit,
      currencyCode: currency,
      allowZero: false,
      allowNegative: false,
    });

    const { periodStart, periodEnd } = this.resolveCreatePeriod(dto, userTimezone);

    const { budget, categoryName } = await this.db.withTransaction(async (tx) => {
      const category = await this.categoriesService.assertActiveCategoryForKind(
        userId,
        dto.categoryId,
        CategoryKind.EXPENSE,
        tx,
      );

      const overlapping = await this.budgetsRepo.findOverlappingActive(tx, {
        userId,
        categoryId: category.id,
        currencyCode: currency,
        periodStart,
        periodEnd,
      });
      if (overlapping) {
        throw new DomainConflictException(
          'An active budget already exists for this expense category, currency, and overlapping period.',
          'BUDGET_OVERLAP_CONFLICT',
        );
      }

      const created = await this.budgetsRepo.create(tx, {
        userId,
        categoryId: category.id,
        limitMinor: limitMoney.amountMinor,
        currencyCode: currency,
        periodStart,
        periodEnd,
      });

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'budget',
        entityId: created.id,
        action: 'BUDGET_CREATED',
        metadata: {
          categoryId: created.categoryId,
          currencyCode: created.currencyCode,
          periodStart: created.periodStart,
          periodEnd: created.periodEnd,
        },
      });

      return { budget: created, categoryName: category.name };
    });

    const [enriched] = await this.enrichBudgets(this.db, userId, [budget], new Map([[budget.categoryId, categoryName]]));
    return enriched;
  }

  public async update(
    userId: string,
    budgetId: string,
    dto: UpdateBudgetDto,
  ): Promise<BudgetDto> {
    const updated = await this.db.withTransaction(async (tx) => {
      const existing = await this.budgetsRepo.findById(tx, userId, budgetId, true);
      if (!existing) {
        throw new ResourceNotFoundException('Budget');
      }
      if (existing.archivedAt !== null) {
        throw new InvalidStateTransitionException(
          'Cannot update an archived budget.',
          'BUDGET_ARCHIVED',
        );
      }

      const nextLimitMinor =
        dto.limitMinor !== undefined || dto.limit !== undefined
          ? Money.fromApiInput({
              amountMinor: dto.limitMinor,
              amount: dto.limit,
              currencyCode: existing.currencyCode,
              allowZero: false,
              allowNegative: false,
            }).amountMinor
          : undefined;

      const nextStart = dto.periodStart
        ? assertValidLocalDate(dto.periodStart)
        : existing.periodStart;
      const nextEnd = dto.periodEnd
        ? assertValidLocalDate(dto.periodEnd)
        : existing.periodEnd;

      if (nextEnd < nextStart) {
        throw new ValidationDomainException(
          'periodEnd must be greater than or equal to periodStart.',
          'INVALID_DATE_RANGE',
        );
      }

      if (
        (dto.periodStart !== undefined || dto.periodEnd !== undefined) &&
        dto.archived !== true
      ) {
        const overlapping = await this.budgetsRepo.findOverlappingActive(tx, {
          userId,
          categoryId: existing.categoryId,
          currencyCode: existing.currencyCode,
          periodStart: nextStart,
          periodEnd: nextEnd,
          excludeBudgetId: existing.id,
        });
        if (overlapping) {
          throw new DomainConflictException(
            'Updated period overlaps with another active budget for the same category and currency.',
            'BUDGET_OVERLAP_CONFLICT',
          );
        }
      }

      const archivedAt = dto.archived === true ? new Date() : undefined;

      const nextBudget = await this.budgetsRepo.update(tx, userId, budgetId, {
        limitMinor: nextLimitMinor,
        periodStart: dto.periodStart ? nextStart : undefined,
        periodEnd: dto.periodEnd ? nextEnd : undefined,
        archivedAt,
      });

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'budget',
        entityId: budgetId,
        action: dto.archived === true ? 'BUDGET_ARCHIVED' : 'BUDGET_UPDATED',
        metadata: {
          categoryId: nextBudget.categoryId,
          currencyCode: nextBudget.currencyCode,
          periodStart: nextBudget.periodStart,
          periodEnd: nextBudget.periodEnd,
        },
      });

      return nextBudget;
    });

    const [enriched] = await this.enrichBudgets(this.db, userId, [updated]);
    return enriched;
  }

  private resolveCreatePeriod(
    dto: CreateBudgetDto,
    userTimezone: string,
  ): { periodStart: string; periodEnd: string } {
    if (dto.periodStart !== undefined || dto.periodEnd !== undefined) {
      if (!dto.periodStart || !dto.periodEnd) {
        throw new ValidationDomainException(
          'Both periodStart and periodEnd must be provided together.',
          'INVALID_DATE_RANGE',
        );
      }
      const periodStart = assertValidLocalDate(dto.periodStart);
      const periodEnd = assertValidLocalDate(dto.periodEnd);
      if (periodEnd < periodStart) {
        throw new ValidationDomainException(
          'periodEnd must be greater than or equal to periodStart.',
          'INVALID_DATE_RANGE',
        );
      }
      if (dto.month !== undefined) {
        const monthBounds = resolveMonthBounds(dto.month);
        if (
          monthBounds.periodStart !== periodStart ||
          monthBounds.periodEnd !== periodEnd
        ) {
          throw new ValidationDomainException(
            'Provided month conflicts with periodStart/periodEnd.',
            'AMBIGUOUS_BUDGET_PERIOD',
          );
        }
      }
      return { periodStart, periodEnd };
    }

    if (dto.month !== undefined) {
      return resolveMonthBounds(dto.month);
    }

    const currentMonth = getLocalDateInTimezone(new Date(), userTimezone).slice(0, 7);
    return resolveMonthBounds(currentMonth);
  }

  private async enrichBudgets(
    db: DbQueryClient,
    userId: string,
    budgets: ReadonlyArray<BudgetEntity>,
    preloadedCategoryNames?: Map<string, string>,
  ): Promise<BudgetDto[]> {
    let minDate = budgets[0].periodStart;
    let maxDate = budgets[0].periodEnd;
    const categoryIds = new Set<string>();
    const currencyCodes = new Set<SupportedCurrencyCode>();

    for (const b of budgets) {
      if (b.periodStart < minDate) minDate = b.periodStart;
      if (b.periodEnd > maxDate) maxDate = b.periodEnd;
      categoryIds.add(b.categoryId);
      currencyCodes.add(b.currencyCode);
    }

    const [dailyEntries, categories] = await Promise.all([
      this.budgetsRepo.getPostedExpenseTotalsForRange(db, {
        userId,
        minDate,
        maxDate,
        categoryIds: Array.from(categoryIds),
        currencyCodes: Array.from(currencyCodes),
      }),
      preloadedCategoryNames
        ? Promise.resolve([])
        : this.categoriesRepo.list(db, userId, CategoryKind.EXPENSE, true),
    ]);

    const categoryNameMap = new Map<string, string>(preloadedCategoryNames);
    for (const cat of categories) {
      categoryNameMap.set(cat.id, cat.name);
    }

    return budgets.map((budget) => {
      let grossExpenseMinor = 0n;
      let refundMinor = 0n;

      for (const entry of dailyEntries) {
        if (
          entry.categoryId === budget.categoryId &&
          entry.currencyCode === budget.currencyCode &&
          entry.transactionDate >= budget.periodStart &&
          entry.transactionDate <= budget.periodEnd
        ) {
          if (entry.entryType === EntryType.EXPENSE) {
            grossExpenseMinor += entry.totalMinor;
          } else if (entry.entryType === EntryType.EXPENSE_REFUND) {
            refundMinor += entry.totalMinor;
          }
        }
      }

      const metrics = computeBudgetMetrics({
        limitMinor: budget.limitMinor,
        grossExpenseMinor,
        refundMinor,
      });

      return toBudgetDto(budget, metrics, categoryNameMap.get(budget.categoryId));
    });
  }
}
