import { EntryType, TransactionStatus } from '@pfm/shared-types';
import { CurrencyMismatchException, ValidationDomainException } from './domain-exceptions';

export interface LedgerBalanceEntry {
  readonly entryType: EntryType;
  readonly status: TransactionStatus;
  readonly amountMinor: bigint;
  readonly currencyCode?: string;
}

export interface AccountBalanceSummary {
  readonly openingBalanceMinor: bigint;
  readonly postedBalanceMinor: bigint;
  readonly pendingInMinor: bigint;
  readonly pendingOutMinor: bigint;
  readonly postedTransactionCount: number;
  readonly totalTransactionCount: number;
}

/**
 * Authoritative Posted-Only Account Balance Formula (BR-ACC-01 / docs/04):
 *
 * Posted Balance = opening_balance_minor
 *   + SUM(INCOME)
 *   - SUM(EXPENSE)
 *   + SUM(EXPENSE_REFUND)
 *   + SUM(TRANSFER_IN)
 *   - SUM(TRANSFER_OUT)
 *   + SUM(ADJUSTMENT_CREDIT)
 *   - SUM(ADJUSTMENT_DEBIT)
 *
 * ONLY entries with status === POSTED affect Posted Balance.
 * DRAFT, PENDING, VOIDED, and REVERSED are strictly excluded.
 */
export function summarizeAccountBalances(
  openingBalanceMinor: bigint,
  entries: ReadonlyArray<LedgerBalanceEntry>,
  accountCurrencyCode?: string,
): AccountBalanceSummary {
  let postedBalanceMinor = openingBalanceMinor;
  let pendingInMinor = 0n;
  let pendingOutMinor = 0n;
  let postedTransactionCount = 0;

  for (const entry of entries) {
    if (entry.amountMinor <= 0n) {
      throw new ValidationDomainException(
        'Ledger entry amountMinor must be strictly positive (> 0).',
        'NON_POSITIVE_LEDGER_ENTRY',
      );
    }

    if (accountCurrencyCode && entry.currencyCode && entry.currencyCode !== accountCurrencyCode) {
      throw new CurrencyMismatchException(accountCurrencyCode, entry.currencyCode);
    }

    const signedDelta = getSignedEffect(entry.entryType, entry.amountMinor);

    if (entry.status === TransactionStatus.POSTED) {
      postedBalanceMinor += signedDelta;
      postedTransactionCount += 1;
    } else if (entry.status === TransactionStatus.PENDING) {
      if (signedDelta > 0n) {
        pendingInMinor += signedDelta;
      } else {
        pendingOutMinor += -signedDelta;
      }
    }
    // DRAFT, VOIDED, REVERSED never change postedBalanceMinor or pending totals
  }

  return {
    openingBalanceMinor,
    postedBalanceMinor,
    pendingInMinor,
    pendingOutMinor,
    postedTransactionCount,
    totalTransactionCount: entries.length,
  };
}

export function calculatePostedBalance(
  openingBalanceMinor: bigint,
  entries: ReadonlyArray<LedgerBalanceEntry>,
  accountCurrencyCode?: string,
): bigint {
  return summarizeAccountBalances(openingBalanceMinor, entries, accountCurrencyCode).postedBalanceMinor;
}

function getSignedEffect(entryType: EntryType, amountMinor: bigint): bigint {
  switch (entryType) {
    case EntryType.INCOME:
    case EntryType.EXPENSE_REFUND:
    case EntryType.TRANSFER_IN:
    case EntryType.ADJUSTMENT_CREDIT:
      return amountMinor;

    case EntryType.EXPENSE:
    case EntryType.TRANSFER_OUT:
    case EntryType.ADJUSTMENT_DEBIT:
      return -amountMinor;

    default: {
      const exhaustive: never = entryType;
      throw new ValidationDomainException(`Unsupported entry type: ${String(exhaustive)}`);
    }
  }
}
