/**
 * Shared domain types, enums, currency metadata, and API contracts
 * for the Personal Finance Management platform.
 *
 * Financial invariant:
 * - Authoritative monetary values are BIGINT minor units.
 * - Across JSON boundaries, minor units are serialized as decimal integer strings
 *   (`MinorUnitString`) to prevent IEEE-754 Number precision loss (> 2^53 - 1).
 */

export enum AccountType {
  CASH = 'CASH',
  BANK = 'BANK',
  E_WALLET = 'E_WALLET',
  CREDIT_CARD = 'CREDIT_CARD',
  SAVINGS = 'SAVINGS',
}

export enum EntryType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  EXPENSE_REFUND = 'EXPENSE_REFUND',
  TRANSFER_OUT = 'TRANSFER_OUT',
  TRANSFER_IN = 'TRANSFER_IN',
  ADJUSTMENT_CREDIT = 'ADJUSTMENT_CREDIT',
  ADJUSTMENT_DEBIT = 'ADJUSTMENT_DEBIT',
}

export enum TransactionStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  POSTED = 'POSTED',
  VOIDED = 'VOIDED',
  REVERSED = 'REVERSED',
}

export enum CategoryKind {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export enum TransferStatus {
  POSTED = 'POSTED',
  VOIDED = 'VOIDED',
  REVERSED = 'REVERSED',
}

export type SupportedCurrencyCode = 'VND' | 'USD' | 'EUR' | 'JPY' | 'KWD';

export interface CurrencyMetadata {
  readonly code: SupportedCurrencyCode;
  readonly name: string;
  readonly minorUnit: 0 | 1 | 2 | 3 | 4;
  readonly symbol: string;
}

export const CURRENCY_METADATA: Readonly<Record<SupportedCurrencyCode, CurrencyMetadata>> = Object.freeze({
  VND: { code: 'VND', name: 'Vietnamese Dong', minorUnit: 0, symbol: '₫' },
  USD: { code: 'USD', name: 'US Dollar', minorUnit: 2, symbol: '$' },
  EUR: { code: 'EUR', name: 'Euro', minorUnit: 2, symbol: '€' },
  JPY: { code: 'JPY', name: 'Japanese Yen', minorUnit: 0, symbol: '¥' },
  KWD: { code: 'KWD', name: 'Kuwaiti Dinar', minorUnit: 3, symbol: 'KD' },
});

export const SUPPORTED_CURRENCY_CODES: readonly SupportedCurrencyCode[] = Object.freeze(
  Object.keys(CURRENCY_METADATA) as SupportedCurrencyCode[],
);

export function isSupportedCurrencyCode(code: string): code is SupportedCurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCY_METADATA, code.toUpperCase());
}

export function getCurrencyMetadata(code: string): CurrencyMetadata | undefined {
  const normalized = code.trim().toUpperCase();
  if (!isSupportedCurrencyCode(normalized)) {
    return undefined;
  }
  return CURRENCY_METADATA[normalized];
}

/**
 * Canonical JSON-safe string representation of signed 64-bit integer minor units.
 */
export type MinorUnitString = string;

/**
 * ISO 8601 Calendar date string (`YYYY-MM-DD`) in user's local timezone.
 */
export type LocalDateString = string;

/**
 * ISO 8601 UTC timestamp string.
 */
export type UtcTimestampString = string;

export interface UserProfileDto {
  id: string;
  email: string;
  fullName: string;
  baseCurrencyCode: SupportedCurrencyCode;
  timezone: string;
  mfaEnabled: boolean;
  createdAt: UtcTimestampString;
}

export interface AccountDto {
  id: string;
  name: string;
  accountType: AccountType;
  currencyCode: SupportedCurrencyCode;
  openingBalanceMinor: MinorUnitString;
  openingBalanceDate: LocalDateString;
  isDefault: boolean;
  archivedAt: UtcTimestampString | null;
  createdAt: UtcTimestampString;
  updatedAt: UtcTimestampString;
}

export interface AccountWithBalanceDto extends AccountDto {
  postedBalanceMinor: MinorUnitString;
  pendingInMinor: MinorUnitString;
  pendingOutMinor: MinorUnitString;
  transactionCount: number;
}

export interface AuthResponseDto {
  user: UserProfileDto;
  defaultAccount?: AccountWithBalanceDto;
  accessToken: string;
  expiresInSeconds: number;
}

export interface CategoryDto {
  id: string;
  kind: CategoryKind;
  name: string;
  parentId: string | null;
  archivedAt: UtcTimestampString | null;
  createdAt: UtcTimestampString;
}

export interface IncomeSourceDto {
  id: string;
  name: string;
  archivedAt: UtcTimestampString | null;
  createdAt: UtcTimestampString;
}

export interface MerchantDto {
  id: string;
  name: string;
  archivedAt: UtcTimestampString | null;
  createdAt: UtcTimestampString;
}

export interface TransactionRecordDto {
  id: string;
  accountId: string;
  entryType: EntryType;
  status: TransactionStatus;
  amountMinor: MinorUnitString;
  currencyCode: SupportedCurrencyCode;
  transactionDate: LocalDateString;
  description: string | null;
  note: string | null;
  categoryId: string | null;
  incomeSourceId: string | null;
  merchantId: string | null;
  transferId: string | null;
  recurringRuleId?: string | null;
  occurrenceDate?: LocalDateString | null;
  refundsTransactionId: string | null;
  reversesTransactionId: string | null;
  voidedAt: UtcTimestampString | null;
  createdAt: UtcTimestampString;
  updatedAt: UtcTimestampString;
}

export interface IncomeResponseDto extends TransactionRecordDto {
  entryType: EntryType.INCOME;
  accountPostedBalanceMinor?: MinorUnitString;
}

export interface ExpenseResponseDto extends TransactionRecordDto {
  entryType: EntryType.EXPENSE | EntryType.EXPENSE_REFUND;
  accountPostedBalanceMinor?: MinorUnitString;
  warnings?: string[];
}

export interface TransferDto {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  fromAmountMinor: MinorUnitString;
  fromCurrencyCode: SupportedCurrencyCode;
  toAmountMinor: MinorUnitString;
  toCurrencyCode: SupportedCurrencyCode;
  exchangeRate: string;
  rateSource: string;
  rateEffectiveAt: UtcTimestampString;
  feeTransactionId: string | null;
  transferDate: LocalDateString;
  note: string | null;
  status: TransferStatus;
  voidedAt: UtcTimestampString | null;
  createdAt: UtcTimestampString;
  updatedAt: UtcTimestampString;
}

export interface TransferDetailDto extends TransferDto {
  fromTransaction?: TransactionRecordDto | null;
  toTransaction?: TransactionRecordDto | null;
  feeTransaction?: TransactionRecordDto | null;
  fromAccountPostedBalanceMinor?: MinorUnitString;
  toAccountPostedBalanceMinor?: MinorUnitString;
}

export interface CurrencyBalanceSummaryDto {
  currencyCode: SupportedCurrencyCode;
  totalOpeningBalanceMinor: MinorUnitString;
  totalPostedBalanceMinor: MinorUnitString;
  totalPendingInMinor: MinorUnitString;
  totalPendingOutMinor: MinorUnitString;
  activeAccountCount: number;
  accounts: AccountWithBalanceDto[];
}

export interface BalancesReportDto {
  asOfUtc: UtcTimestampString;
  includeArchived: boolean;
  currencies: CurrencyBalanceSummaryDto[];
}

export interface CashFlowCategoryBreakdownDto {
  categoryId: string;
  categoryName: string;
  kind: CategoryKind;
  grossMinor: MinorUnitString;
  refundMinor: MinorUnitString;
  netMinor: MinorUnitString;
  transactionCount: number;
}

export interface CashFlowCurrencySummaryDto {
  currencyCode: SupportedCurrencyCode;
  totalIncomeMinor: MinorUnitString;
  grossExpenseMinor: MinorUnitString;
  totalRefundMinor: MinorUnitString;
  netExpenseMinor: MinorUnitString;
  netCashFlowMinor: MinorUnitString;
  incomeCount: number;
  expenseCount: number;
  refundCount: number;
  byCategory: CashFlowCategoryBreakdownDto[];
}

export interface CashFlowReportDto {
  fromDate: LocalDateString;
  toDate: LocalDateString;
  accountId: string | null;
  currencyCode: SupportedCurrencyCode | null;
  excludedEntryTypes: EntryType[];
  currencies: CashFlowCurrencySummaryDto[];
}

export enum BudgetStatus {
  OK = 'OK',
  WARNING = 'WARNING',
  EXCEEDED = 'EXCEEDED',
}

export interface BudgetDto {
  id: string;
  categoryId: string;
  categoryName?: string;
  categoryKind: CategoryKind.EXPENSE;
  limitMinor: MinorUnitString;
  currencyCode: SupportedCurrencyCode;
  periodStart: LocalDateString;
  periodEnd: LocalDateString;
  archivedAt: UtcTimestampString | null;
  createdAt: UtcTimestampString;
  grossExpenseMinor: MinorUnitString;
  refundMinor: MinorUnitString;
  actualSpentMinor: MinorUnitString;
  remainingMinor: MinorUnitString;
  percentUsed: number;
  status: BudgetStatus;
}

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = Object.freeze([
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
]);

export interface RecurringRuleDto {
  id: string;
  ruleKind: CategoryKind;
  accountId: string;
  categoryId: string;
  amountMinor: MinorUnitString;
  currencyCode: SupportedCurrencyCode;
  frequency: RecurringFrequency;
  intervalCount: number;
  nextRunDate: LocalDateString;
  endDate: LocalDateString | null;
  timezone: string;
  isActive: boolean;
  createdAt: UtcTimestampString;
  updatedAt: UtcTimestampString;
}

export interface RunDueRecurringResultDto {
  asOfDate: LocalDateString;
  processedRules: number;
  generatedCount: number;
  skippedDuplicateCount: number;
  deactivatedRuleIds: string[];
  generatedTransactions: TransactionRecordDto[];
  updatedRules: RecurringRuleDto[];
}

export type ExportFormat = 'CSV' | 'JSON';

export interface DataExportJsonDto {
  exportedAt: UtcTimestampString;
  filters: {
    fromDate: LocalDateString | null;
    toDate: LocalDateString | null;
    accountId: string | null;
  };
  user: UserProfileDto;
  accounts: AccountDto[];
  categories: CategoryDto[];
  incomeSources: IncomeSourceDto[];
  merchants: MerchantDto[];
  transfers: TransferDto[];
  transactions: TransactionRecordDto[];
  budgets: Array<{
    id: string;
    categoryId: string;
    categoryKind: CategoryKind.EXPENSE;
    limitMinor: MinorUnitString;
    currencyCode: SupportedCurrencyCode;
    periodStart: LocalDateString;
    periodEnd: LocalDateString;
    archivedAt: UtcTimestampString | null;
    createdAt: UtcTimestampString;
  }>;
}

export interface AccountDeletionScheduledResponseDto {
  userId: string;
  deletionScheduledAt: UtcTimestampString;
  gracePeriodDays: number;
  sessionsRevoked: boolean;
}

export type ImportEntryType = 'INCOME' | 'EXPENSE';

export type ImportPreviewRowStatus = 'VALID' | 'DUPLICATE_SUSPECTED' | 'INVALID';

export interface ImportPreviewRowDto {
  rowNumber: number;
  entryType: ImportEntryType | null;
  transactionDate: LocalDateString | null;
  amountMinor: MinorUnitString | null;
  currencyCode: string;
  categoryName: string | null;
  categoryId: string | null;
  description: string | null;
  counterparty: string | null;
  status: ImportPreviewRowStatus;
  duplicateReason?: string | null;
  errors: string[];
}

export interface ImportPreviewResultDto {
  accountId: string;
  currencyCode: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  rows: ImportPreviewRowDto[];
}

export interface ImportCommitRowInput {
  entryType: ImportEntryType;
  transactionDate: LocalDateString;
  amountMinor: MinorUnitString;
  categoryId: string;
  description?: string | null;
  counterparty?: string | null;
}

export interface ImportCommitResultDto {
  accountId: string;
  importedCount: number;
  skippedCount: number;
  transactionIds: string[];
}

export interface CursorPaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MfaStatusDto {
  enabled: boolean;
  enabledAt: UtcTimestampString | null;
  remainingRecoveryCodes: number;
}

export interface MfaSetupResponseDto {
  secretBase32: string;
  otpauthUri: string;
}

export interface MfaVerifyResponseDto {
  enabled: boolean;
  recoveryCodes: string[];
}

export interface MfaDisableResponseDto {
  enabled: boolean;
}

export type AttachmentMimeType = 'image/png' | 'image/jpeg' | 'application/pdf';

export interface AttachmentDto {
  id: string;
  transactionId: string;
  originalFilename: string;
  mimeType: AttachmentMimeType;
  sizeBytes: number;
  sha256Hash: string;
  createdAt: UtcTimestampString;
}

export interface AttachmentListResponseDto {
  items: AttachmentDto[];
}

export interface ProblemFieldErrorDto {
  field: string;
  message: string;
}

export interface ProblemDetailsDto {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  correlationId?: string;
  errors?: ProblemFieldErrorDto[];
}
