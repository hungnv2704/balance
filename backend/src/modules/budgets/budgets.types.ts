import {
  BudgetDto,
  BudgetStatus,
  CategoryKind,
  SupportedCurrencyCode,
} from '@pfm/shared-types';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';
import { roundHalfEven } from '../../shared-kernel/domain/money';

export interface BudgetEntity {
  readonly id: string;
  readonly userId: string;
  readonly categoryId: string;
  readonly categoryKind: CategoryKind.EXPENSE;
  readonly limitMinor: bigint;
  readonly currencyCode: SupportedCurrencyCode;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

const MONTH_REGEX = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function resolveMonthBounds(monthStr: string): { periodStart: string; periodEnd: string } {
  const match = MONTH_REGEX.exec(monthStr.trim());
  if (!match) {
    throw new ValidationDomainException(
      `Invalid month format '${monthStr}'. Expected YYYY-MM.`,
      'INVALID_BUDGET_MONTH',
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    periodStart: `${match[1]}-${match[2]}-01`,
    periodEnd: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

export interface ComputedBudgetMetrics {
  readonly grossExpenseMinor: bigint;
  readonly refundMinor: bigint;
  readonly actualSpentMinor: bigint;
  readonly remainingMinor: bigint;
  readonly percentUsed: number;
  readonly status: BudgetStatus;
}

export function computeBudgetMetrics(params: {
  limitMinor: bigint;
  grossExpenseMinor: bigint;
  refundMinor: bigint;
}): ComputedBudgetMetrics {
  const { limitMinor, grossExpenseMinor, refundMinor } = params;
  if (limitMinor <= 0n) {
    throw new ValidationDomainException('Budget limit must be strictly positive.');
  }

  const actualSpentMinor = grossExpenseMinor - refundMinor;
  const remainingMinor = limitMinor - actualSpentMinor;

  let status: BudgetStatus;
  if (actualSpentMinor >= limitMinor) {
    status = BudgetStatus.EXCEEDED;
  } else if (actualSpentMinor * 100n >= limitMinor * 80n) {
    status = BudgetStatus.WARNING;
  } else {
    status = BudgetStatus.OK;
  }

  let percentUsed: number;
  if (actualSpentMinor <= 0n) {
    percentUsed = 0;
  } else {
    const basisPoints = roundHalfEven(actualSpentMinor * 10000n, limitMinor);
    percentUsed = Number(basisPoints) / 100;
    if (status === BudgetStatus.OK && percentUsed >= 80) {
      percentUsed = 79.99;
    } else if (status === BudgetStatus.WARNING && percentUsed >= 100) {
      percentUsed = 99.99;
    } else if (status === BudgetStatus.WARNING && percentUsed < 80) {
      percentUsed = 80;
    } else if (status === BudgetStatus.EXCEEDED && percentUsed < 100) {
      percentUsed = 100;
    }
  }

  return {
    grossExpenseMinor,
    refundMinor,
    actualSpentMinor,
    remainingMinor,
    percentUsed,
    status,
  };
}

export function toBudgetDto(
  entity: BudgetEntity,
  metrics: ComputedBudgetMetrics,
  categoryName?: string,
): BudgetDto {
  return {
    id: entity.id,
    categoryId: entity.categoryId,
    ...(categoryName !== undefined ? { categoryName } : {}),
    categoryKind: CategoryKind.EXPENSE,
    limitMinor: entity.limitMinor.toString(),
    currencyCode: entity.currencyCode,
    periodStart: entity.periodStart,
    periodEnd: entity.periodEnd,
    archivedAt: entity.archivedAt ? entity.archivedAt.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
    grossExpenseMinor: metrics.grossExpenseMinor.toString(),
    refundMinor: metrics.refundMinor.toString(),
    actualSpentMinor: metrics.actualSpentMinor.toString(),
    remainingMinor: metrics.remainingMinor.toString(),
    percentUsed: metrics.percentUsed,
    status: metrics.status,
  };
}
