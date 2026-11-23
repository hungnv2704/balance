import {
  CategoryKind,
  RecurringFrequency,
  RecurringRuleDto,
  SupportedCurrencyCode,
} from '@pfm/shared-types';
import { assertValidLocalDate } from '../../shared-kernel/domain/date-time';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';

export interface RecurringRuleEntity {
  readonly id: string;
  readonly userId: string;
  readonly ruleKind: CategoryKind;
  readonly accountId: string;
  readonly categoryId: string;
  readonly amountMinor: bigint;
  readonly currencyCode: SupportedCurrencyCode;
  readonly frequency: RecurringFrequency;
  readonly intervalCount: number;
  readonly nextRunDate: string;
  readonly endDate: string | null;
  readonly timezone: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toRecurringRuleDto(entity: RecurringRuleEntity): RecurringRuleDto {
  return {
    id: entity.id,
    ruleKind: entity.ruleKind,
    accountId: entity.accountId,
    categoryId: entity.categoryId,
    amountMinor: entity.amountMinor.toString(),
    currencyCode: entity.currencyCode,
    frequency: entity.frequency,
    intervalCount: entity.intervalCount,
    nextRunDate: entity.nextRunDate,
    endDate: entity.endDate,
    timezone: entity.timezone,
    isActive: entity.isActive,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new ValidationDomainException(`Invalid month '${month}'.`, 'INVALID_CALENDAR_DATE');
  }
}

function formatCalendarDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addUtcDays(year: number, month: number, day: number, deltaDays: number): string {
  const dt = new Date(0);
  dt.setUTCFullYear(year, month - 1, day + deltaDays);
  return formatCalendarDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Pure calendar date math for recurring schedules without local timezone or DST drift.
 * Handles month-end clamping (e.g. Jan 31 -> Feb 28 / Feb 29) and leap-year Feb 29 -> Feb 28.
 */
export function calculateNextRunDate(
  currentDate: string,
  frequency: RecurringFrequency,
  intervalCount: number,
  anchorDay?: number,
): string {
  const validatedDate = assertValidLocalDate(currentDate);
  if (!Number.isInteger(intervalCount) || intervalCount < 1) {
    throw new ValidationDomainException(
      'intervalCount must be a positive integer.',
      'INVALID_INTERVAL_COUNT',
    );
  }
  if (anchorDay !== undefined && (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31)) {
    throw new ValidationDomainException(
      'anchorDay must be an integer between 1 and 31.',
      'INVALID_ANCHOR_DAY',
    );
  }

  const [yearStr, monthStr, dayStr] = validatedDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  switch (frequency) {
    case 'DAILY':
      return addUtcDays(year, month, day, intervalCount);

    case 'WEEKLY':
      return addUtcDays(year, month, day, intervalCount * 7);

    case 'MONTHLY': {
      const totalMonths = year * 12 + (month - 1) + intervalCount;
      const targetYear = Math.floor(totalMonths / 12);
      const targetMonth = (totalMonths % 12) + 1;
      const desiredDay = anchorDay ?? day;
      const targetDay = Math.min(desiredDay, getDaysInMonth(targetYear, targetMonth));
      return formatCalendarDate(targetYear, targetMonth, targetDay);
    }

    case 'YEARLY': {
      const targetYear = year + intervalCount;
      const desiredDay = anchorDay ?? day;
      const targetDay = Math.min(desiredDay, getDaysInMonth(targetYear, month));
      return formatCalendarDate(targetYear, month, targetDay);
    }

    default: {
      const exhaustive: never = frequency;
      throw new ValidationDomainException(
        `Unsupported recurring frequency '${String(exhaustive)}'.`,
        'INVALID_RECURRING_FREQUENCY',
      );
    }
  }
}
