import type { Account, CurrencyCode, CurrencyMeta, Transaction } from './types';

export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  VND: {
    code: 'VND',
    name: 'Việt Nam Đồng',
    minorUnit: 0,
    symbol: '₫',
    locale: 'vi-VN',
  },
  USD: {
    code: 'USD',
    name: 'Đô la Mỹ',
    minorUnit: 2,
    symbol: '$',
    locale: 'en-US',
  },
  EUR: {
    code: 'EUR',
    name: 'Euro',
    minorUnit: 2,
    symbol: '€',
    locale: 'en-IE',
  },
  JPY: {
    code: 'JPY',
    name: 'Yên Nhật',
    minorUnit: 0,
    symbol: '¥',
    locale: 'ja-JP',
  },
};

export const CURRENCY_LIST: CurrencyMeta[] = Object.values(CURRENCIES);

export function formatMoney(
  amountMinor: number,
  currency: CurrencyCode,
  opts?: { showSign?: boolean; compactCode?: boolean },
): string {
  const meta = CURRENCIES[currency];
  const isNegative = amountMinor < 0;
  const absMinor = Math.abs(amountMinor);
  const divisor = meta.minorUnit === 0 ? 1 : Math.pow(10, meta.minorUnit);
  const majorValue = absMinor / divisor;

  const formattedNumber = new Intl.NumberFormat(meta.locale, {
    minimumFractionDigits: meta.minorUnit,
    maximumFractionDigits: meta.minorUnit,
  }).format(majorValue);

  const prefix = isNegative ? '-' : opts?.showSign && amountMinor > 0 ? '+' : '';

  if (currency === 'VND') {
    return `${prefix}${formattedNumber} ${opts?.compactCode ? 'VND' : '₫'}`;
  }
  if (currency === 'USD') {
    return `${prefix}$${formattedNumber} USD`;
  }
  if (currency === 'EUR') {
    return `${prefix}€${formattedNumber} EUR`;
  }
  return `${prefix}¥${formattedNumber} JPY`;
}

export interface MoneyParseResult {
  valid: boolean;
  minorValue: number | null;
  error: string | null;
}

/**
 * Validates and converts user-entered money text into integer minor units.
 * Blocks decimals strictly when minorUnit === 0 (e.g. VND, JPY).
 */
export function parseMoneyInput(
  raw: string,
  currency: CurrencyCode,
  options?: { allowZero?: boolean },
): MoneyParseResult {
  const meta = CURRENCIES[currency];
  const trimmed = raw.trim();

  if (!trimmed) {
    return { valid: false, minorValue: null, error: 'Vui lòng nhập số tiền.' };
  }

  // Strip spaces
  const cleaned = trimmed.replace(/\s+/g, '');

  if (meta.minorUnit === 0) {
    // Reject any decimal separator (. or ,) when user intends decimal, OR thousand-separator ambiguity:
    // If there is a dot or comma followed by 1 or 2 digits, or explicitly any dot/comma if we enforce digits-only or formatted grouping.
    // Specifically: per spec, VND blocks decimals (e.g., "100.50", "50000.5", "100,5").
    if (/[.,]/.test(cleaned)) {
      // Allow strict thousand grouping only if every group after the first has exactly 3 digits and there is no trailing separator?
      // Better & safer for UX: check if user typed a decimal like "100.5" or "100.50" or "100,25" -> reject explicitly!
      const isStrictGrouping = /^\d{1,3}([.,]\d{3})+$/.test(cleaned);
      if (!isStrictGrouping) {
        return {
          valid: false,
          minorValue: null,
          error: `${currency} không hỗ trợ số thập phân. Chỉ nhập số nguyên.`,
        };
      }
      const digitsOnly = cleaned.replace(/[.,]/g, '');
      const parsed = Number.parseInt(digitsOnly, 10);
      if (!Number.isSafeInteger(parsed) || (options?.allowZero ? parsed < 0 : parsed <= 0)) {
        return {
          valid: false,
          minorValue: null,
          error: options?.allowZero ? 'Số tiền không được âm.' : 'Số tiền phải lớn hơn 0.',
        };
      }
      return { valid: true, minorValue: parsed, error: null };
    }

    if (!/^\d+$/.test(cleaned)) {
      return {
        valid: false,
        minorValue: null,
        error: `${currency} chỉ chấp nhận chữ số nguyên dương (không ký tự lạ hoặc dấu thập phân).`,
      };
    }

    const parsed = Number.parseInt(cleaned, 10);
    if (!Number.isSafeInteger(parsed) || (options?.allowZero ? parsed < 0 : parsed <= 0)) {
      return {
        valid: false,
        minorValue: null,
        error: options?.allowZero ? 'Số tiền không được âm.' : 'Số tiền phải lớn hơn 0.',
      };
    }
    return { valid: true, minorValue: parsed, error: null };
  }

  // minorUnit === 2 (USD, EUR)
  // Normalize comma decimal if no dot exists and <= 2 digits after comma
  let normalized = cleaned;
  if (/^\d+(,\d{1,2})$/.test(normalized)) {
    normalized = normalized.replace(',', '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return {
      valid: false,
      minorValue: null,
      error: `Số tiền ${currency} không hợp lệ. Ví dụ đúng: 125.50`,
    };
  }

  const [wholePart, fracPart = ''] = normalized.split('.');
  if (fracPart.length > meta.minorUnit) {
    return {
      valid: false,
      minorValue: null,
      error: `${currency} chỉ hỗ trợ tối đa ${meta.minorUnit} chữ số thập phân (ví dụ: 10.25).`,
    };
  }

  const paddedFrac = fracPart.padEnd(meta.minorUnit, '0');
  const minorValue = Number.parseInt(wholePart, 10) * 100 + Number.parseInt(paddedFrac || '0', 10);

  if (!Number.isSafeInteger(minorValue) || (options?.allowZero ? minorValue < 0 : minorValue <= 0)) {
    return {
      valid: false,
      minorValue: null,
      error: options?.allowZero ? 'Số tiền không được âm.' : 'Số tiền phải lớn hơn 0.',
    };
  }

  return { valid: true, minorValue, error: null };
}

export function formatMinorForInput(amountMinor: number, currency: CurrencyCode): string {
  const meta = CURRENCIES[currency];
  if (meta.minorUnit === 0) {
    return String(amountMinor);
  }
  return (amountMinor / 100).toFixed(2);
}

/**
 * Posted Balance formula.
 * Only includes transactions with status === 'POSTED'.
 */
export function computeAccountPostedBalance(
  account: Account,
  transactions: Transaction[],
): number {
  let balance = account.openingBalanceMinor;

  for (const tx of transactions) {
    if (tx.accountId !== account.id || tx.status !== 'POSTED') continue;
    switch (tx.entryType) {
      case 'INCOME':
      case 'EXPENSE_REFUND':
      case 'TRANSFER_IN':
      case 'ADJUSTMENT_CREDIT':
        balance += tx.amountMinor;
        break;
      case 'EXPENSE':
      case 'TRANSFER_OUT':
      case 'ADJUSTMENT_DEBIT':
        balance -= tx.amountMinor;
        break;
    }
  }

  return balance;
}

export function formatDateVN(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

export function parseDateVNToISO(vnDate: string): string | null {
  const match = vnDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1970 || year > 2100) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Banker's rounding (Half-Even) for cross-currency calculations.
 */
export function bankersRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
