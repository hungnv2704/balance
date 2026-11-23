import { Inject, Injectable } from '@nestjs/common';
import {
  AccountDeletionScheduledResponseDto,
  DataExportJsonDto,
} from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import { assertValidLocalDate } from '../../shared-kernel/domain/date-time';
import {
  AuthenticationException,
  InvalidStateTransitionException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { Money } from '../../shared-kernel/domain/money';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from '../accounts/accounts.repository';
import { toAccountDto } from '../accounts/accounts.types';
import { AUDIT_REPOSITORY, AuditRepository } from '../audit/audit.repository';
import { AUTH_REPOSITORY, AuthRepository } from '../auth/auth.repository';
import { toUserProfileDto } from '../auth/auth.types';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { BUDGETS_REPOSITORY, BudgetsRepository } from '../budgets/budgets.repository';
import { CATEGORIES_REPOSITORY, CategoriesRepository } from '../categories/categories.repository';
import { toCategoryDto } from '../categories/categories.types';
import {
  MERCHANTS_REPOSITORY,
  MerchantsRepository,
  toMerchantDto,
} from '../expense/merchants.repository';
import {
  INCOME_SOURCES_REPOSITORY,
  IncomeSourcesRepository,
  toIncomeSourceDto,
} from '../income/income-sources.repository';
import { LEDGER_REPOSITORY, LedgerRepository } from '../ledger/ledger.repository';
import { toTransactionRecordDto } from '../ledger/ledger.types';
import { TRANSFERS_REPOSITORY, TransfersRepository } from '../transfers/transfers.repository';
import { toTransferDto } from '../transfers/transfers.types';
import { buildCsvDocument } from './csv-sanitizer';
import { CreateExportDto, ScheduleAccountDeletionDto } from './data-ops.dto';

export const ACCOUNT_DELETION_GRACE_PERIOD_DAYS = 14;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type ExportGenerationResult =
  | {
      readonly format: 'CSV';
      readonly filename: string;
      readonly contentType: 'text/csv; charset=utf-8';
      readonly csv: string;
      readonly rowCount: number;
    }
  | {
      readonly format: 'JSON';
      readonly filename: string;
      readonly contentType: 'application/json; charset=utf-8';
      readonly data: DataExportJsonDto;
      readonly rowCount: number;
    };

const CSV_HEADERS = [
  'recordType',
  'id',
  'transactionDate',
  'entryType',
  'status',
  'amountMinor',
  'amountDecimal',
  'currencyCode',
  'accountId',
  'accountName',
  'categoryId',
  'categoryName',
  'incomeSourceId',
  'incomeSourceName',
  'merchantId',
  'merchantName',
  'transferId',
  'description',
  'note',
  'createdAt',
] as const;

@Injectable()
export class DataOpsService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(AUTH_REPOSITORY) private readonly authRepo: AuthRepository,
    @Inject(ACCOUNTS_REPOSITORY) private readonly accountsRepo: AccountsRepository,
    @Inject(CATEGORIES_REPOSITORY) private readonly categoriesRepo: CategoriesRepository,
    @Inject(INCOME_SOURCES_REPOSITORY) private readonly incomeSourcesRepo: IncomeSourcesRepository,
    @Inject(MERCHANTS_REPOSITORY) private readonly merchantsRepo: MerchantsRepository,
    @Inject(TRANSFERS_REPOSITORY) private readonly transfersRepo: TransfersRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(BUDGETS_REPOSITORY) private readonly budgetsRepo: BudgetsRepository,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  public async exportUserData(
    userId: string,
    dto: CreateExportDto,
  ): Promise<ExportGenerationResult> {
    const fromDate = dto.fromDate ? assertValidLocalDate(dto.fromDate) : undefined;
    const toDate = dto.toDate ? assertValidLocalDate(dto.toDate) : undefined;
    if (fromDate && toDate && fromDate > toDate) {
      throw new ValidationDomainException(
        'fromDate cannot be after toDate.',
        'INVALID_DATE_RANGE',
      );
    }

    const user = await this.authRepo.findUserById(this.db, userId);
    if (!user) {
      throw new ResourceNotFoundException('User');
    }

    if (dto.accountId) {
      const account = await this.accountsRepo.findById(this.db, userId, dto.accountId);
      if (!account) {
        throw new ResourceNotFoundException('Account');
      }
    }

    const includeArchived = dto.includeArchived ?? true;

    const [accounts, categories, incomeSources, merchants, transfers, transactions, budgets] =
      await Promise.all([
        this.accountsRepo.findAllByUser(this.db, userId, includeArchived),
        this.categoriesRepo.list(this.db, userId, undefined, includeArchived),
        this.incomeSourcesRepo.list(this.db, userId, includeArchived),
        this.merchantsRepo.list(this.db, userId, includeArchived),
        this.transfersRepo.listAllByUser(this.db, userId, {
          accountId: dto.accountId,
          fromDate,
          toDate,
        }),
        this.ledgerRepo.listAllForExport(this.db, userId, {
          accountId: dto.accountId,
          fromDate,
          toDate,
        }),
        this.budgetsRepo.list(this.db, userId, { includeArchived }),
      ]);

    await this.auditRepo.record(this.db, {
      userId,
      entityType: 'user',
      entityId: userId,
      action: 'DATA_EXPORT_GENERATED',
      metadata: {
        format: dto.format,
        transactionCount: transactions.length,
        transferCount: transfers.length,
        accountCount: accounts.length,
      },
    });

    const dateStamp = new Date().toISOString().slice(0, 10);

    if (dto.format === 'CSV') {
      const accountNameMap = new Map(accounts.map((a) => [a.id, a.name]));
      const categoryNameMap = new Map(categories.map((c) => [c.id, c.name]));
      const incomeSourceNameMap = new Map(incomeSources.map((s) => [s.id, s.name]));
      const merchantNameMap = new Map(merchants.map((m) => [m.id, m.name]));

      const rows = transactions.map((tx) => [
        'TRANSACTION',
        tx.id,
        tx.transactionDate,
        tx.entryType,
        tx.status,
        tx.amountMinor.toString(),
        Money.fromMinor(tx.amountMinor, tx.currencyCode).toDecimalString(),
        tx.currencyCode,
        tx.accountId,
        accountNameMap.get(tx.accountId) ?? '',
        tx.categoryId ?? '',
        tx.categoryId ? (categoryNameMap.get(tx.categoryId) ?? '') : '',
        tx.incomeSourceId ?? '',
        tx.incomeSourceId ? (incomeSourceNameMap.get(tx.incomeSourceId) ?? '') : '',
        tx.merchantId ?? '',
        tx.merchantId ? (merchantNameMap.get(tx.merchantId) ?? '') : '',
        tx.transferId ?? '',
        tx.description ?? '',
        tx.note ?? '',
        tx.createdAt.toISOString(),
      ]);

      const csv = buildCsvDocument(CSV_HEADERS, rows);
      return {
        format: 'CSV',
        filename: `pfm-export-${dateStamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
        csv,
        rowCount: transactions.length,
      };
    }

    const data: DataExportJsonDto = {
      exportedAt: new Date().toISOString(),
      filters: {
        fromDate: fromDate ?? null,
        toDate: toDate ?? null,
        accountId: dto.accountId ?? null,
      },
      user: toUserProfileDto(user),
      accounts: accounts.map(toAccountDto),
      categories: categories.map(toCategoryDto),
      incomeSources: incomeSources.map(toIncomeSourceDto),
      merchants: merchants.map(toMerchantDto),
      transfers: transfers.map(toTransferDto),
      transactions: transactions.map(toTransactionRecordDto),
      budgets: budgets.map((b) => ({
        id: b.id,
        categoryId: b.categoryId,
        categoryKind: b.categoryKind,
        limitMinor: b.limitMinor.toString(),
        currencyCode: b.currencyCode,
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        archivedAt: b.archivedAt ? b.archivedAt.toISOString() : null,
        createdAt: b.createdAt.toISOString(),
      })),
    };

    return {
      format: 'JSON',
      filename: `pfm-export-${dateStamp}.json`,
      contentType: 'application/json; charset=utf-8',
      data,
      rowCount: transactions.length,
    };
  }

  public async scheduleAccountDeletion(
    userId: string,
    dto: ScheduleAccountDeletionDto,
  ): Promise<AccountDeletionScheduledResponseDto> {
    if (
      dto.password !== undefined &&
      dto.currentPassword !== undefined &&
      dto.password !== dto.currentPassword
    ) {
      throw new ValidationDomainException(
        'Conflicting password confirmation values provided.',
        'AMBIGUOUS_PASSWORD_INPUT',
      );
    }

    const providedPassword = dto.password ?? dto.currentPassword;
    if (!providedPassword || providedPassword.length === 0) {
      throw new AuthenticationException(
        'Step-up password verification is required to delete your account.',
        'STEP_UP_PASSWORD_REQUIRED',
      );
    }

    const deletionScheduledAt = await this.db.withTransaction(async (tx) => {
      const user = await this.authRepo.findUserById(tx, userId);
      if (!user) {
        throw new ResourceNotFoundException('User');
      }

      if (user.deletionScheduledAt !== null) {
        throw new InvalidStateTransitionException(
          'Account deletion has already been scheduled.',
          'ACCOUNT_DELETION_ALREADY_SCHEDULED',
        );
      }

      const validPassword = await this.passwordHasher.verify(
        providedPassword,
        user.passwordHash,
      );
      if (!validPassword) {
        throw new AuthenticationException(
          'Invalid password for step-up verification.',
          'INVALID_CREDENTIALS',
        );
      }

      const scheduledAt = new Date(
        Date.now() + ACCOUNT_DELETION_GRACE_PERIOD_DAYS * DAY_IN_MS,
      );

      await this.authRepo.scheduleDeletion(tx, userId, scheduledAt);
      await this.authRepo.revokeAllUserSessions(tx, userId);

      await this.auditRepo.record(tx, {
        userId,
        entityType: 'user',
        entityId: userId,
        action: 'ACCOUNT_DELETION_SCHEDULED',
        metadata: {
          deletionScheduledAt: scheduledAt.toISOString(),
          gracePeriodDays: ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
        },
      });

      return scheduledAt;
    });

    return {
      userId,
      deletionScheduledAt: deletionScheduledAt.toISOString(),
      gracePeriodDays: ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
      sessionsRevoked: true,
    };
  }
}
