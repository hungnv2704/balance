import { Inject, Injectable } from '@nestjs/common';
import {
  CategoryKind,
  EntryType,
  RecurringRuleDto,
  RunDueRecurringResultDto,
  TransactionRecordDto,
  TransactionStatus,
} from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import {
  assertValidLocalDate,
  assertValidTimezone,
  getLocalDateInTimezone,
} from '../../shared-kernel/domain/date-time';
import {
  CurrencyMismatchException,
  InvalidStateTransitionException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { Money } from '../../shared-kernel/domain/money';
import { IdempotencyService } from '../../shared-kernel/idempotency/idempotency.service';
import { DefaultAccountResolver } from '../accounts/default-account.resolver';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { CategoriesService } from '../categories/categories.service';
import { LEDGER_REPOSITORY, LedgerRepository } from '../ledger/ledger.repository';
import { toTransactionRecordDto } from '../ledger/ledger.types';
import {
  CreateRecurringRuleDto,
  RunDueRecurringDto,
  UpdateRecurringRuleDto,
} from './recurring.dto';
import {
  ListRecurringRulesFilter,
  RECURRING_REPOSITORY,
  RecurringRepository,
} from './recurring.repository';
import { calculateNextRunDate, toRecurringRuleDto } from './recurring.types';

@Injectable()
export class RecurringService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(RECURRING_REPOSITORY) private readonly recurringRepo: RecurringRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly defaultAccountResolver: DefaultAccountResolver,
    private readonly categoriesService: CategoriesService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  public async list(
    userId: string,
    filter?: ListRecurringRulesFilter,
  ): Promise<{ items: RecurringRuleDto[] }> {
    const rules = await this.recurringRepo.list(this.db, userId, filter);
    return {
      items: rules.map(toRecurringRuleDto),
    };
  }

  public async getOne(userId: string, ruleId: string): Promise<RecurringRuleDto> {
    const rule = await this.recurringRepo.findById(this.db, userId, ruleId);
    if (!rule) {
      throw new ResourceNotFoundException('Recurring rule');
    }
    return toRecurringRuleDto(rule);
  }

  public async create(
    userId: string,
    userTimezone: string,
    dto: CreateRecurringRuleDto,
  ): Promise<RecurringRuleDto> {
    const timezone = dto.timezone ? assertValidTimezone(dto.timezone) : assertValidTimezone(userTimezone);
    const nextRunDate = dto.nextRunDate
      ? assertValidLocalDate(dto.nextRunDate)
      : getLocalDateInTimezone(new Date(), timezone);
    const endDate =
      dto.endDate === undefined || dto.endDate === null
        ? null
        : assertValidLocalDate(dto.endDate);

    if (endDate !== null && endDate < nextRunDate) {
      throw new ValidationDomainException(
        'endDate must be greater than or equal to nextRunDate.',
        'INVALID_DATE_RANGE',
      );
    }

    const intervalCount = dto.intervalCount ?? 1;
    if (!Number.isInteger(intervalCount) || intervalCount < 1) {
      throw new ValidationDomainException(
        'intervalCount must be a positive integer.',
        'INVALID_INTERVAL_COUNT',
      );
    }

    const created = await this.db.withTransaction(async (tx) => {
      const account = await this.defaultAccountResolver.resolveForTransaction(
        tx,
        userId,
        dto.accountId,
      );

      if (dto.currencyCode !== undefined) {
        const requestedCurrency = Money.zero(dto.currencyCode).currencyCode;
        if (requestedCurrency !== account.currencyCode) {
          throw new CurrencyMismatchException(account.currencyCode, requestedCurrency);
        }
      }

      const money = Money.fromApiInput({
        amountMinor: dto.amountMinor,
        amount: dto.amount,
        currencyCode: account.currencyCode,
        allowZero: false,
        allowNegative: false,
      });

      await this.categoriesService.assertActiveCategoryForKind(
        userId,
        dto.categoryId,
        dto.ruleKind,
        tx,
      );

      const rule = await this.recurringRepo.create(tx, {
        userId,
        ruleKind: dto.ruleKind,
        accountId: account.id,
        categoryId: dto.categoryId,
        amountMinor: money.amountMinor,
        currencyCode: account.currencyCode,
        frequency: dto.frequency,
        intervalCount,
        nextRunDate,
        endDate,
        timezone,
        isActive: dto.isActive ?? true,
      });

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'recurring_rule',
        entityId: rule.id,
        action: 'RECURRING_RULE_CREATED',
        metadata: {
          ruleKind: rule.ruleKind,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          currencyCode: rule.currencyCode,
          frequency: rule.frequency,
          intervalCount: rule.intervalCount,
          nextRunDate: rule.nextRunDate,
          endDate: rule.endDate,
          isActive: rule.isActive,
        },
      });

      return rule;
    });

    return toRecurringRuleDto(created);
  }

  public async update(
    userId: string,
    ruleId: string,
    dto: UpdateRecurringRuleDto,
  ): Promise<RecurringRuleDto> {
    const updated = await this.db.withTransaction(async (tx) => {
      const existing = await this.recurringRepo.findById(tx, userId, ruleId, true);
      if (!existing) {
        throw new ResourceNotFoundException('Recurring rule');
      }

      let nextAccountId: string | undefined;
      if (dto.accountId !== undefined) {
        const account = await this.defaultAccountResolver.resolveForTransaction(
          tx,
          userId,
          dto.accountId,
        );
        if (account.currencyCode !== existing.currencyCode) {
          throw new CurrencyMismatchException(existing.currencyCode, account.currencyCode);
        }
        nextAccountId = account.id;
      }

      if (dto.categoryId !== undefined) {
        await this.categoriesService.assertActiveCategoryForKind(
          userId,
          dto.categoryId,
          existing.ruleKind,
          tx,
        );
      }

      let nextAmountMinor: bigint | undefined;
      if (dto.amountMinor !== undefined || dto.amount !== undefined) {
        nextAmountMinor = Money.fromApiInput({
          amountMinor: dto.amountMinor,
          amount: dto.amount,
          currencyCode: existing.currencyCode,
          allowZero: false,
          allowNegative: false,
        }).amountMinor;
      }

      if (dto.intervalCount !== undefined && (!Number.isInteger(dto.intervalCount) || dto.intervalCount < 1)) {
        throw new ValidationDomainException(
          'intervalCount must be a positive integer.',
          'INVALID_INTERVAL_COUNT',
        );
      }

      const nextRunDate = dto.nextRunDate
        ? assertValidLocalDate(dto.nextRunDate)
        : undefined;
      const effectiveNextRunDate = nextRunDate ?? existing.nextRunDate;

      const endDateUpdate =
        dto.endDate === undefined
          ? undefined
          : dto.endDate === null
            ? null
            : assertValidLocalDate(dto.endDate);
      const effectiveEndDate =
        endDateUpdate === undefined ? existing.endDate : endDateUpdate;

      if (effectiveEndDate !== null && effectiveEndDate < effectiveNextRunDate) {
        throw new ValidationDomainException(
          'endDate must be greater than or equal to nextRunDate.',
          'INVALID_DATE_RANGE',
        );
      }

      const nextTimezone =
        dto.timezone !== undefined ? assertValidTimezone(dto.timezone) : undefined;

      // Never modifies historical generated transactions; only updates the rule template.
      const saved = await this.recurringRepo.update(tx, userId, ruleId, {
        accountId: nextAccountId,
        categoryId: dto.categoryId,
        amountMinor: nextAmountMinor,
        frequency: dto.frequency,
        intervalCount: dto.intervalCount,
        nextRunDate,
        endDate: endDateUpdate,
        timezone: nextTimezone,
      });

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'recurring_rule',
        entityId: saved.id,
        action: 'RECURRING_RULE_UPDATED',
        metadata: {
          ruleKind: saved.ruleKind,
          accountId: saved.accountId,
          categoryId: saved.categoryId,
          frequency: saved.frequency,
          intervalCount: saved.intervalCount,
          nextRunDate: saved.nextRunDate,
          endDate: saved.endDate,
        },
      });

      return saved;
    });

    return toRecurringRuleDto(updated);
  }

  public async pause(userId: string, ruleId: string): Promise<RecurringRuleDto> {
    const updated = await this.db.withTransaction(async (tx) => {
      const existing = await this.recurringRepo.findById(tx, userId, ruleId, true);
      if (!existing) {
        throw new ResourceNotFoundException('Recurring rule');
      }
      if (!existing.isActive) {
        return existing;
      }

      const saved = await this.recurringRepo.update(tx, userId, ruleId, {
        isActive: false,
      });

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'recurring_rule',
        entityId: ruleId,
        action: 'RECURRING_RULE_PAUSED',
        metadata: { isActive: false },
      });

      return saved;
    });

    return toRecurringRuleDto(updated);
  }

  public async resume(userId: string, ruleId: string): Promise<RecurringRuleDto> {
    const updated = await this.db.withTransaction(async (tx) => {
      const existing = await this.recurringRepo.findById(tx, userId, ruleId, true);
      if (!existing) {
        throw new ResourceNotFoundException('Recurring rule');
      }
      if (existing.endDate !== null && existing.nextRunDate > existing.endDate) {
        throw new InvalidStateTransitionException(
          'Cannot resume a recurring rule whose nextRunDate is past its endDate.',
          'RECURRING_RULE_EXPIRED',
        );
      }
      if (existing.isActive) {
        return existing;
      }

      const saved = await this.recurringRepo.update(tx, userId, ruleId, {
        isActive: true,
      });

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'recurring_rule',
        entityId: ruleId,
        action: 'RECURRING_RULE_RESUMED',
        metadata: { isActive: true, nextRunDate: saved.nextRunDate },
      });

      return saved;
    });

    return toRecurringRuleDto(updated);
  }

  public async runDue(
    userId: string,
    userTimezone: string,
    idempotencyKey: string | undefined,
    requestPath: string,
    dto?: RunDueRecurringDto,
  ): Promise<{ status: number; body: RunDueRecurringResultDto }> {
    const asOfDate =
      dto?.asOfDate !== undefined
        ? assertValidLocalDate(dto.asOfDate)
        : getLocalDateInTimezone(new Date(), userTimezone);

    return this.db.withTransaction(async (tx) => {
      const exec = await this.idempotencyService.execute<RunDueRecurringResultDto>(
        tx,
        {
          userId,
          idempotencyKey,
          method: 'POST',
          path: requestPath,
          payload: { asOfDate: dto?.asOfDate ?? null },
        },
        async () => {
          const dueRules = await this.recurringRepo.findDueActiveForUpdate(tx, userId, asOfDate);

          const generatedTransactions: TransactionRecordDto[] = [];
          const updatedRules: RecurringRuleDto[] = [];
          const deactivatedRuleIds: string[] = [];
          let skippedDuplicateCount = 0;

          for (const rule of dueRules) {
            if (rule.endDate !== null && rule.nextRunDate > rule.endDate) {
              const deactivated = await this.recurringRepo.update(tx, userId, rule.id, {
                isActive: false,
              });
              deactivatedRuleIds.push(rule.id);
              updatedRules.push(toRecurringRuleDto(deactivated));
              continue;
            }

            const occurrenceDate = rule.nextRunDate;
            const entryType =
              rule.ruleKind === CategoryKind.INCOME ? EntryType.INCOME : EntryType.EXPENSE;

            // PM decision: recurring occurrences are generated as DRAFT so Posted Balance
            // stays untouched until the user confirms POST.
            const created = await this.ledgerRepo.insertRecurringDraftIfAbsent(tx, {
              userId,
              accountId: rule.accountId,
              entryType,
              amountMinor: rule.amountMinor,
              currencyCode: rule.currencyCode,
              transactionDate: occurrenceDate,
              categoryId: rule.categoryId,
              recurringRuleId: rule.id,
              occurrenceDate,
              description: null,
              note: null,
            });

            if (created) {
              generatedTransactions.push(toTransactionRecordDto(created));
              await this.auditRepo.record(tx, {
                userId,
                entityType: 'transaction',
                entityId: created.id,
                action: 'RECURRING_DRAFT_GENERATED',
                metadata: {
                  recurringRuleId: rule.id,
                  occurrenceDate,
                  entryType,
                  status: TransactionStatus.DRAFT,
                },
              });
            } else {
              skippedDuplicateCount += 1;
            }

            const newNextRunDate = calculateNextRunDate(
              occurrenceDate,
              rule.frequency,
              rule.intervalCount,
            );
            const shouldDeactivate =
              rule.endDate !== null && newNextRunDate > rule.endDate;

            const advanced = await this.recurringRepo.update(tx, userId, rule.id, {
              nextRunDate: newNextRunDate,
              isActive: !shouldDeactivate,
            });
            updatedRules.push(toRecurringRuleDto(advanced));

            if (shouldDeactivate) {
              deactivatedRuleIds.push(rule.id);
              await this.auditRepo.record(tx, {
                userId,
                entityType: 'recurring_rule',
                entityId: rule.id,
                action: 'RECURRING_RULE_COMPLETED',
                metadata: {
                  newNextRunDate,
                  endDate: rule.endDate,
                },
              });
            }
          }

          return {
            status: 200,
            body: {
              asOfDate,
              processedRules: dueRules.length,
              generatedCount: generatedTransactions.length,
              skippedDuplicateCount,
              deactivatedRuleIds,
              generatedTransactions,
              updatedRules,
            },
          };
        },
      );

      return { status: exec.status, body: exec.body };
    });
  }
}
