import { EntryType, TransactionStatus } from '@pfm/shared-types';
import {
  assertValidLocalDate,
  getLocalDateInTimezone,
} from '../src/shared-kernel/domain/date-time';
import {
  CurrencyMismatchException,
  ValidationDomainException,
} from '../src/shared-kernel/domain/domain-exceptions';
import {
  LedgerBalanceEntry,
  calculatePostedBalance,
  summarizeAccountBalances,
} from '../src/shared-kernel/domain/posted-balance';

describe('Posted Balance Formula & Date Boundaries', () => {
  it('matches docs/08 worked example: excludes PENDING, DRAFT, VOIDED, and REVERSED', () => {
    const openingBalance = 1_000_000n;
    const entries: LedgerBalanceEntry[] = [
      { entryType: EntryType.INCOME, status: TransactionStatus.POSTED, amountMinor: 5_000_000n, currencyCode: 'VND' },
      { entryType: EntryType.INCOME, status: TransactionStatus.PENDING, amountMinor: 2_000_000n, currencyCode: 'VND' },
      { entryType: EntryType.EXPENSE, status: TransactionStatus.POSTED, amountMinor: 1_200_000n, currencyCode: 'VND' },
      { entryType: EntryType.EXPENSE, status: TransactionStatus.DRAFT, amountMinor: 500_000n, currencyCode: 'VND' },
      { entryType: EntryType.EXPENSE, status: TransactionStatus.VOIDED, amountMinor: 300_000n, currencyCode: 'VND' },
      { entryType: EntryType.EXPENSE, status: TransactionStatus.REVERSED, amountMinor: 900_000n, currencyCode: 'VND' },
      { entryType: EntryType.EXPENSE_REFUND, status: TransactionStatus.POSTED, amountMinor: 200_000n, currencyCode: 'VND' },
      { entryType: EntryType.TRANSFER_OUT, status: TransactionStatus.POSTED, amountMinor: 1_000_000n, currencyCode: 'VND' },
      { entryType: EntryType.ADJUSTMENT_CREDIT, status: TransactionStatus.POSTED, amountMinor: 50_000n, currencyCode: 'VND' },
    ];

    const summary = summarizeAccountBalances(openingBalance, entries, 'VND');

    // 1,000,000 + 5,000,000 - 1,200,000 + 200,000 - 1,000,000 + 50,000 = 4,050,000
    expect(summary.postedBalanceMinor).toBe(4_050_000n);
    expect(summary.pendingInMinor).toBe(2_000_000n);
    expect(summary.pendingOutMinor).toBe(0n);
    expect(summary.postedTransactionCount).toBe(5);
    expect(summary.totalTransactionCount).toBe(9);
  });

  it('handles TRANSFER_IN, ADJUSTMENT_DEBIT, pending outflows, and REVERSED entries correctly', () => {
    const entries: LedgerBalanceEntry[] = [
      { entryType: EntryType.TRANSFER_IN, status: TransactionStatus.POSTED, amountMinor: 500_000n },
      { entryType: EntryType.ADJUSTMENT_DEBIT, status: TransactionStatus.POSTED, amountMinor: 120_000n },
      { entryType: EntryType.EXPENSE, status: TransactionStatus.PENDING, amountMinor: 80_000n },
      { entryType: EntryType.TRANSFER_OUT, status: TransactionStatus.PENDING, amountMinor: 40_000n },
      { entryType: EntryType.INCOME, status: TransactionStatus.REVERSED, amountMinor: 999_000n },
      { entryType: EntryType.EXPENSE_REFUND, status: TransactionStatus.VOIDED, amountMinor: 75_000n },
    ];

    const summary = summarizeAccountBalances(100_000n, entries);

    // 100,000 + 500,000 - 120,000 = 480,000
    expect(summary.postedBalanceMinor).toBe(480_000n);
    expect(summary.pendingInMinor).toBe(0n);
    expect(summary.pendingOutMinor).toBe(120_000n);
    expect(calculatePostedBalance(100_000n, entries)).toBe(480_000n);
  });

  it('allows negative posted balance when expenses exceed opening balance + income', () => {
    const balance = calculatePostedBalance(0n, [
      { entryType: EntryType.EXPENSE, status: TransactionStatus.POSTED, amountMinor: 150_000n },
    ]);
    expect(balance).toBe(-150_000n);
  });

  it('rejects currency mismatches and non-positive entry amounts', () => {
    expect(() =>
      calculatePostedBalance(
        0n,
        [{ entryType: EntryType.INCOME, status: TransactionStatus.POSTED, amountMinor: 100n, currencyCode: 'USD' }],
        'VND',
      ),
    ).toThrow(CurrencyMismatchException);

    expect(() =>
      calculatePostedBalance(0n, [
        { entryType: EntryType.INCOME, status: TransactionStatus.POSTED, amountMinor: 0n },
      ]),
    ).toThrow(ValidationDomainException);
  });

  it('resolves local calendar dates accurately across UTC+7 midnight boundaries', () => {
    // 2026-11-30 16:45 UTC == 2026-11-30 23:45+07:00
    expect(getLocalDateInTimezone(new Date('2026-11-30T16:45:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe(
      '2026-11-30',
    );
    // 2026-11-30 18:00 UTC == 2026-12-01 01:00+07:00
    expect(getLocalDateInTimezone(new Date('2026-11-30T18:00:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe(
      '2026-12-01',
    );

    expect(assertValidLocalDate('2024-02-29')).toBe('2024-02-29');
    expect(() => assertValidLocalDate('2025-02-29')).toThrow(ValidationDomainException);
  });
});
