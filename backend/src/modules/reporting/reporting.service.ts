import { Inject, Injectable } from '@nestjs/common';
import {
  AccountWithBalanceDto,
  BalancesReportDto,
  CashFlowCategoryBreakdownDto,
  CashFlowCurrencySummaryDto,
  CashFlowReportDto,
  CategoryKind,
  CurrencyBalanceSummaryDto,
  EntryType,
  SupportedCurrencyCode,
} from '@pfm/shared-types';
import { DATABASE_EXECUTOR, DatabaseExecutor } from '../../database/database.types';
import {
  assertValidLocalDate,
  getLocalDateInTimezone,
} from '../../shared-kernel/domain/date-time';
import {
  ResourceNotFoundException,
  ValidationDomainException,
} from '../../shared-kernel/domain/domain-exceptions';
import { Money } from '../../shared-kernel/domain/money';
import { summarizeAccountBalances } from '../../shared-kernel/domain/posted-balance';
import { ACCOUNTS_REPOSITORY, AccountsRepository } from '../accounts/accounts.repository';
import { toAccountWithBalanceDto } from '../accounts/accounts.types';
import { LEDGER_REPOSITORY, LedgerRepository } from '../ledger/ledger.repository';
import { REPORTING_REPOSITORY, ReportingRepository } from './reporting.repository';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getDefaultMonthRange(timezone: string): { fromDate: string; toDate: string } {
  const todayLocal = getLocalDateInTimezone(new Date(), timezone);
  const [yearStr, monthStr] = todayLocal.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    fromDate: `${yearStr}-${monthStr}-01`,
    toDate: `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`,
  };
}

function sortCurrencyGroups<T extends { currencyCode: SupportedCurrencyCode }>(
  groups: T[],
  baseCurrency: SupportedCurrencyCode,
): T[] {
  return [...groups].sort((a, b) => {
    if (a.currencyCode === baseCurrency && b.currencyCode !== baseCurrency) return -1;
    if (b.currencyCode === baseCurrency && a.currencyCode !== baseCurrency) return 1;
    return a.currencyCode.localeCompare(b.currencyCode);
  });
}

@Injectable()
export class ReportingService {
  constructor(
    @Inject(DATABASE_EXECUTOR) private readonly db: DatabaseExecutor,
    @Inject(ACCOUNTS_REPOSITORY) private readonly accountsRepo: AccountsRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledgerRepo: LedgerRepository,
    @Inject(REPORTING_REPOSITORY) private readonly reportingRepo: ReportingRepository,
  ) {}

  public async getBalancesReport(
    userId: string,
    userBaseCurrency: SupportedCurrencyCode,
    query: { includeArchived?: boolean; currency?: string },
  ): Promise<BalancesReportDto> {
    const includeArchived = query.includeArchived ?? false;
    const filterCurrency = query.currency
      ? Money.zero(query.currency).currencyCode
      : undefined;

    const allAccounts = await this.accountsRepo.findAllByUser(this.db, userId, includeArchived);
    const filteredAccounts = filterCurrency
      ? allAccounts.filter((acc) => acc.currencyCode === filterCurrency)
      : allAccounts;

    const entriesMap = await this.ledgerRepo.getBalanceEntriesForAccounts(
      this.db,
      userId,
      filteredAccounts.map((a) => a.id),
    );

    const grouped = new Map<
      SupportedCurrencyCode,
      {
        totalOpeningBalanceMinor: bigint;
        totalPostedBalanceMinor: bigint;
        totalPendingInMinor: bigint;
        totalPendingOutMinor: bigint;
        activeAccountCount: number;
        accounts: AccountWithBalanceDto[];
      }
    >();

    for (const acc of filteredAccounts) {
      const entries = entriesMap.get(acc.id) ?? [];
      const summary = summarizeAccountBalances(
        acc.openingBalanceMinor,
        entries,
        acc.currencyCode,
      );
      const dto = toAccountWithBalanceDto(acc, summary);

      let bucket = grouped.get(acc.currencyCode);
      if (!bucket) {
        bucket = {
          totalOpeningBalanceMinor: 0n,
          totalPostedBalanceMinor: 0n,
          totalPendingInMinor: 0n,
          totalPendingOutMinor: 0n,
          activeAccountCount: 0,
          accounts: [],
        };
        grouped.set(acc.currencyCode, bucket);
      }

      bucket.totalOpeningBalanceMinor += summary.openingBalanceMinor;
      bucket.totalPostedBalanceMinor += summary.postedBalanceMinor;
      bucket.totalPendingInMinor += summary.pendingInMinor;
      bucket.totalPendingOutMinor += summary.pendingOutMinor;
      if (acc.archivedAt === null) {
        bucket.activeAccountCount += 1;
      }
      bucket.accounts.push(dto);
    }

    const currencies: CurrencyBalanceSummaryDto[] = Array.from(grouped.entries()).map(
      ([currencyCode, bucket]) => ({
        currencyCode,
        totalOpeningBalanceMinor: bucket.totalOpeningBalanceMinor.toString(),
        totalPostedBalanceMinor: bucket.totalPostedBalanceMinor.toString(),
        totalPendingInMinor: bucket.totalPendingInMinor.toString(),
        totalPendingOutMinor: bucket.totalPendingOutMinor.toString(),
        activeAccountCount: bucket.activeAccountCount,
        accounts: bucket.accounts,
      }),
    );

    return {
      asOfUtc: new Date().toISOString(),
      includeArchived,
      currencies: sortCurrencyGroups(currencies, userBaseCurrency),
    };
  }

  public async getCashFlowReport(
    userId: string,
    userTimezone: string,
    userBaseCurrency: SupportedCurrencyCode,
    query: { from?: string; to?: string; currency?: string; accountId?: string },
  ): Promise<CashFlowReportDto> {
    let fromDate: string;
    let toDate: string;

    if (query.from === undefined && query.to === undefined) {
      const defaults = getDefaultMonthRange(userTimezone);
      fromDate = defaults.fromDate;
      toDate = defaults.toDate;
    } else if (query.from !== undefined && query.to !== undefined) {
      fromDate = assertValidLocalDate(query.from);
      toDate = assertValidLocalDate(query.to);
      if (fromDate > toDate) {
        throw new ValidationDomainException(
          'from date must be less than or equal to to date.',
          'INVALID_DATE_RANGE',
        );
      }
    } else {
      throw new ValidationDomainException(
        'Both from and to query parameters must be provided together.',
        'INVALID_DATE_RANGE',
      );
    }

    const filterCurrency = query.currency
      ? Money.zero(query.currency).currencyCode
      : undefined;

    let filterAccountId: string | undefined;
    if (query.accountId !== undefined && query.accountId.trim().length > 0) {
      const normalizedAccId = query.accountId.trim();
      if (!UUID_V4_REGEX.test(normalizedAccId)) {
        throw new ValidationDomainException(
          'Invalid accountId UUID format.',
          'INVALID_ACCOUNT_ID',
        );
      }
      const account = await this.accountsRepo.findById(this.db, userId, normalizedAccId);
      if (!account) {
        throw new ResourceNotFoundException('Account');
      }
      filterAccountId = account.id;
    }

    const rows = await this.reportingRepo.aggregatePostedCashFlow(this.db, {
      userId,
      fromDate,
      toDate,
      currencyCode: filterCurrency,
      accountId: filterAccountId,
    });

    interface CategoryBucket {
      categoryId: string;
      categoryName: string;
      kind: CategoryKind;
      grossMinor: bigint;
      refundMinor: bigint;
      transactionCount: number;
    }

    interface CurrencyBucket {
      totalIncomeMinor: bigint;
      grossExpenseMinor: bigint;
      totalRefundMinor: bigint;
      incomeCount: number;
      expenseCount: number;
      refundCount: number;
      categories: Map<string, CategoryBucket>;
    }

    const byCurrency = new Map<SupportedCurrencyCode, CurrencyBucket>();

    const getOrCreateCurrencyBucket = (code: SupportedCurrencyCode): CurrencyBucket => {
      let bucket = byCurrency.get(code);
      if (!bucket) {
        bucket = {
          totalIncomeMinor: 0n,
          grossExpenseMinor: 0n,
          totalRefundMinor: 0n,
          incomeCount: 0,
          expenseCount: 0,
          refundCount: 0,
          categories: new Map(),
        };
        byCurrency.set(code, bucket);
      }
      return bucket;
    };

    for (const row of rows) {
      const currencyBucket = getOrCreateCurrencyBucket(row.currencyCode);
      const catKey = `${row.categoryKind}:${row.categoryId}`;
      let catBucket = currencyBucket.categories.get(catKey);
      if (!catBucket) {
        catBucket = {
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          kind: row.categoryKind,
          grossMinor: 0n,
          refundMinor: 0n,
          transactionCount: 0,
        };
        currencyBucket.categories.set(catKey, catBucket);
      }

      if (row.entryType === EntryType.INCOME) {
        currencyBucket.totalIncomeMinor += row.totalMinor;
        currencyBucket.incomeCount += row.transactionCount;
        catBucket.grossMinor += row.totalMinor;
        catBucket.transactionCount += row.transactionCount;
      } else if (row.entryType === EntryType.EXPENSE) {
        currencyBucket.grossExpenseMinor += row.totalMinor;
        currencyBucket.expenseCount += row.transactionCount;
        catBucket.grossMinor += row.totalMinor;
        catBucket.transactionCount += row.transactionCount;
      } else if (row.entryType === EntryType.EXPENSE_REFUND) {
        currencyBucket.totalRefundMinor += row.totalMinor;
        currencyBucket.refundCount += row.transactionCount;
        catBucket.refundMinor += row.totalMinor;
        catBucket.transactionCount += row.transactionCount;
      }
    }

    if (filterCurrency && !byCurrency.has(filterCurrency)) {
      getOrCreateCurrencyBucket(filterCurrency);
    }

    const currencies: CashFlowCurrencySummaryDto[] = Array.from(byCurrency.entries()).map(
      ([currencyCode, bucket]) => {
        const netExpenseMinor = bucket.grossExpenseMinor - bucket.totalRefundMinor;
        // BR-RPT-02: Net Cash Flow = SUM(POSTED INCOME) - (SUM(POSTED EXPENSE) - SUM(POSTED EXPENSE_REFUND))
        const netCashFlowMinor = bucket.totalIncomeMinor - netExpenseMinor;

        const byCategory: CashFlowCategoryBreakdownDto[] = Array.from(
          bucket.categories.values(),
        )
          .map((cat) => {
            const netMinor =
              cat.kind === CategoryKind.INCOME
                ? cat.grossMinor
                : cat.grossMinor - cat.refundMinor;
            return {
              categoryId: cat.categoryId,
              categoryName: cat.categoryName,
              kind: cat.kind,
              grossMinor: cat.grossMinor.toString(),
              refundMinor: cat.refundMinor.toString(),
              netMinor: netMinor.toString(),
              transactionCount: cat.transactionCount,
            };
          })
          .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
            const diff = BigInt(b.netMinor) - BigInt(a.netMinor);
            if (diff !== 0n) return diff > 0n ? 1 : -1;
            return a.categoryName.localeCompare(b.categoryName);
          });

        return {
          currencyCode,
          totalIncomeMinor: bucket.totalIncomeMinor.toString(),
          grossExpenseMinor: bucket.grossExpenseMinor.toString(),
          totalRefundMinor: bucket.totalRefundMinor.toString(),
          netExpenseMinor: netExpenseMinor.toString(),
          netCashFlowMinor: netCashFlowMinor.toString(),
          incomeCount: bucket.incomeCount,
          expenseCount: bucket.expenseCount,
          refundCount: bucket.refundCount,
          byCategory,
        };
      },
    );

    return {
      fromDate,
      toDate,
      accountId: filterAccountId ?? null,
      currencyCode: filterCurrency ?? null,
      excludedEntryTypes: [
        EntryType.TRANSFER_OUT,
        EntryType.TRANSFER_IN,
        EntryType.ADJUSTMENT_CREDIT,
        EntryType.ADJUSTMENT_DEBIT,
      ],
      currencies: sortCurrencyGroups(currencies, userBaseCurrency),
    };
  }
}
