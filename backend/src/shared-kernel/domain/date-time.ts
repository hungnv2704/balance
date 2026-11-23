import { ValidationDomainException } from './domain-exceptions';

const LOCAL_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates `YYYY-MM-DD` calendar date including leap years and month lengths.
 */
export function assertValidLocalDate(dateStr: string): string {
  const match = LOCAL_DATE_REGEX.exec(dateStr);
  if (!match) {
    throw new ValidationDomainException(
      `Invalid date format '${dateStr}'. Expected YYYY-MM-DD.`,
      'INVALID_DATE_FORMAT',
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() + 1 !== month ||
    dt.getUTCDate() !== day
  ) {
    throw new ValidationDomainException(
      `Calendar date '${dateStr}' does not exist.`,
      'INVALID_CALENDAR_DATE',
    );
  }
  return dateStr;
}

/**
 * Validates an IANA timezone identifier (e.g. `Asia/Ho_Chi_Minh`, `UTC`).
 */
export function assertValidTimezone(timezone: string): string {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch {
    throw new ValidationDomainException(
      `Invalid IANA timezone '${timezone}'.`,
      'INVALID_TIMEZONE',
    );
  }
}

/**
 * Resolves a UTC Date instant into a `YYYY-MM-DD` calendar date in the user's local timezone.
 * Enforces NFR-FIN-02 / BR-BDG-02 timezone date boundaries deterministically.
 */
export function getLocalDateInTimezone(instant: Date, timezone: string): string {
  assertValidTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new ValidationDomainException('Failed to resolve local date in timezone.');
  }
  return `${year}-${month}-${day}`;
}
