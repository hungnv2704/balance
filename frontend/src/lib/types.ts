export type CurrencyCode = 'VND' | 'USD' | 'EUR' | 'JPY';

export interface CurrencyMeta {
  code: CurrencyCode;
  name: string;
  minorUnit: 0 | 2;
  symbol: string;
  locale: string;
}

export type AccountType = 'CASH' | 'BANK' | 'E_WALLET' | 'CREDIT_CARD' | 'SAVINGS';

export type CategoryKind = 'INCOME' | 'EXPENSE';

export type TransactionEntryType =
  | 'INCOME'
  | 'EXPENSE'
  | 'EXPENSE_REFUND'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'ADJUSTMENT_CREDIT'
  | 'ADJUSTMENT_DEBIT';

export type TransactionStatus = 'DRAFT' | 'PENDING' | 'POSTED' | 'VOIDED' | 'REVERSED';

export interface Account {
  id: string;
  name: string;
  accountType: AccountType;
  currencyCode: CurrencyCode;
  openingBalanceMinor: number;
  openingBalanceDate: string; // YYYY-MM-DD
  isDefault: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  kind: CategoryKind;
  name: string;
  archivedAt: string | null;
}

export interface IncomeSource {
  id: string;
  name: string;
}

export interface Merchant {
  id: string;
  name: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  entryType: TransactionEntryType;
  status: TransactionStatus;
  amountMinor: number; // always > 0
  currencyCode: CurrencyCode;
  transactionDate: string; // YYYY-MM-DD
  description: string;
  note?: string;
  categoryId?: string;
  incomeSourceId?: string;
  merchantId?: string;
  transferId?: string;
  refundsTransactionId?: string;
  reversesTransactionId?: string;
  voidReason?: string;
  createdAt: string;
}

export interface Transfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  fromAmountMinor: number;
  fromCurrencyCode: CurrencyCode;
  toAmountMinor: number;
  toCurrencyCode: CurrencyCode;
  exchangeRate: string; // decimal string for precision
  feeAmountMinor?: number;
  feeTransactionId?: string;
  transferDate: string; // YYYY-MM-DD
  note?: string;
  status: 'POSTED' | 'VOIDED' | 'REVERSED';
  createdAt: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  limitMinor: number;
  currencyCode: CurrencyCode;
  month: string; // YYYY-MM
}

export type RecurringRuleKind = 'INCOME' | 'EXPENSE';

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurringRule {
  id: string;
  title?: string;
  ruleKind: RecurringRuleKind;
  accountId: string;
  categoryId: string;
  amountMinor: number;
  currencyCode: CurrencyCode;
  frequency: RecurringFrequency;
  intervalCount: number;
  nextRunDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD | null
  isActive: boolean;
  createdAt: string;
}

export interface ToastLinkAction {
  label: string;
  href: string;
}

export interface TransactionAttachment {
  id: string;
  transactionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64?: string;
  createdAt: string;
}

export interface ToastMessage {
  id: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
  links?: ToastLinkAction[];
}
