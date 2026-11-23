'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  accountsApi,
  authApi,
  budgetsApi,
  categoriesApi,
  expenseApi,
  generateUuidV4,
  incomeApi,
  isApiError,
  recurringApi,
  setOnUnauthorizedHandler,
  transfersApi,
  type ApiAccountWithBalance,
  type ApiBudget,
  type ApiCategory,
  type ApiCurrencyCode,
  type ApiIncomeSource,
  type ApiMerchant,
  type ApiRecurringRule,
  type ApiTransactionRecord,
  type ApiTransferDetail,
  type ApiUserProfile,
} from './api-client';
import { computeAccountPostedBalance } from './money';
import type {
  Account,
  AccountType,
  Budget,
  Category,
  CurrencyCode,
  IncomeSource,
  Merchant,
  RecurringFrequency,
  RecurringRule,
  RecurringRuleKind,
  ToastMessage,
  Transaction,
  TransactionAttachment,
  TransactionStatus,
  Transfer,
} from './types';

const STORAGE_KEY = 'pfm_workspace_state_v2';
const MODE_STORAGE_KEY = 'pfm_data_mode_v1';

export type DataMode = 'demo' | 'live';

export interface PreviewDataState {
  baseCurrency: CurrencyCode;
  timezone: string;
  accounts: Account[];
  categories: Category[];
  incomeSources: IncomeSource[];
  merchants: Merchant[];
  transactions: Transaction[];
  transfers: Transfer[];
  budgets: Budget[];
  recurringRules: RecurringRule[];
}

function normalizeCurrency(code: ApiCurrencyCode): CurrencyCode {
  if (code === 'VND' || code === 'USD' || code === 'EUR' || code === 'JPY') {
    return code;
  }
  return 'USD';
}

function mapApiAccount(dto: ApiAccountWithBalance): Account {
  return {
    id: dto.id,
    name: dto.name,
    accountType: dto.accountType,
    currencyCode: normalizeCurrency(dto.currencyCode),
    openingBalanceMinor: Number(dto.openingBalanceMinor),
    openingBalanceDate: dto.openingBalanceDate,
    isDefault: dto.isDefault,
    archivedAt: dto.archivedAt,
    createdAt: dto.createdAt,
  };
}

function mapApiCategory(dto: ApiCategory): Category {
  return {
    id: dto.id,
    kind: dto.kind,
    name: dto.name,
    archivedAt: dto.archivedAt,
  };
}

function mapApiSource(dto: ApiIncomeSource): IncomeSource {
  return { id: dto.id, name: dto.name };
}

function mapApiMerchant(dto: ApiMerchant): Merchant {
  return { id: dto.id, name: dto.name };
}

function mapApiTransaction(dto: ApiTransactionRecord): Transaction {
  return {
    id: dto.id,
    accountId: dto.accountId,
    entryType: dto.entryType,
    status: dto.status,
    amountMinor: Number(dto.amountMinor),
    currencyCode: normalizeCurrency(dto.currencyCode),
    transactionDate: dto.transactionDate,
    description: dto.description ?? '',
    note: dto.note ?? undefined,
    categoryId: dto.categoryId ?? undefined,
    incomeSourceId: dto.incomeSourceId ?? undefined,
    merchantId: dto.merchantId ?? undefined,
    transferId: dto.transferId ?? undefined,
    refundsTransactionId: dto.refundsTransactionId ?? undefined,
    reversesTransactionId: dto.reversesTransactionId ?? undefined,
    createdAt: dto.createdAt,
  };
}

function mapApiTransfer(dto: ApiTransferDetail): Transfer {
  return {
    id: dto.id,
    fromAccountId: dto.fromAccountId,
    toAccountId: dto.toAccountId,
    fromAmountMinor: Number(dto.fromAmountMinor),
    fromCurrencyCode: normalizeCurrency(dto.fromCurrencyCode),
    toAmountMinor: Number(dto.toAmountMinor),
    toCurrencyCode: normalizeCurrency(dto.toCurrencyCode),
    exchangeRate: dto.exchangeRate,
    feeAmountMinor: dto.feeTransaction ? Number(dto.feeTransaction.amountMinor) : undefined,
    feeTransactionId: dto.feeTransactionId ?? undefined,
    transferDate: dto.transferDate,
    note: dto.note ?? undefined,
    status: dto.status,
    createdAt: dto.createdAt,
  };
}

function mapApiBudget(dto: ApiBudget): Budget {
  return {
    id: dto.id,
    categoryId: dto.categoryId,
    limitMinor: Number(dto.limitMinor),
    currencyCode: normalizeCurrency(dto.currencyCode),
    month: dto.periodStart.slice(0, 7),
  };
}

function mapApiRecurringRule(dto: ApiRecurringRule): RecurringRule {
  return {
    id: dto.id,
    ruleKind: dto.ruleKind,
    accountId: dto.accountId,
    categoryId: dto.categoryId,
    amountMinor: Number(dto.amountMinor ?? dto.amount ?? 0),
    currencyCode: normalizeCurrency(dto.currencyCode),
    frequency: dto.frequency,
    intervalCount: dto.intervalCount,
    nextRunDate: dto.nextRunDate,
    endDate: dto.endDate ?? null,
    isActive: dto.isActive,
    createdAt: dto.createdAt,
  };
}

function advanceRecurringDate(
  isoDate: string,
  frequency: RecurringFrequency,
  intervalCount: number,
): string {
  const [yStr, mStr, dStr] = isoDate.split('-');
  const year = Number.parseInt(yStr, 10);
  const month = Number.parseInt(mStr, 10); // 1..12
  const day = Number.parseInt(dStr, 10);

  if (frequency === 'DAILY') {
    const dt = new Date(Date.UTC(year, month - 1, day + intervalCount));
    return dt.toISOString().slice(0, 10);
  }
  if (frequency === 'WEEKLY') {
    const dt = new Date(Date.UTC(year, month - 1, day + intervalCount * 7));
    return dt.toISOString().slice(0, 10);
  }
  if (frequency === 'MONTHLY') {
    const totalMonths = year * 12 + (month - 1) + intervalCount;
    const nextYear = Math.floor(totalMonths / 12);
    const nextMonthIdx = totalMonths % 12; // 0..11
    const maxDay = new Date(Date.UTC(nextYear, nextMonthIdx + 1, 0)).getUTCDate();
    const clampedDay = Math.min(day, maxDay);
    return `${String(nextYear).padStart(4, '0')}-${String(nextMonthIdx + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
  }
  // YEARLY
  const nextYear = year + intervalCount;
  const maxDay = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, maxDay);
  return `${String(nextYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

function createEmptyLiveState(user?: ApiUserProfile | null): PreviewDataState {
  return {
    baseCurrency: user ? normalizeCurrency(user.baseCurrencyCode) : 'VND',
    timezone: user?.timezone ?? 'Asia/Ho_Chi_Minh',
    accounts: [],
    categories: [],
    incomeSources: [],
    merchants: [],
    transactions: [],
    transfers: [],
    budgets: [],
    recurringRules: [],
  };
}

function createInitialSeed(): PreviewDataState {
  return {
    baseCurrency: 'VND',
    timezone: 'Asia/Ho_Chi_Minh',
    accounts: [
      {
        id: 'acc-default',
        name: 'Ví tiền mặt',
        accountType: 'CASH',
        currencyCode: 'VND',
        openingBalanceMinor: 5_000_000,
        openingBalanceDate: '2026-10-01',
        isDefault: true,
        archivedAt: null,
        createdAt: '2026-10-01T08:00:00Z',
      },
      {
        id: 'acc-vcb',
        name: 'Vietcombank',
        accountType: 'BANK',
        currencyCode: 'VND',
        openingBalanceMinor: 15_000_000,
        openingBalanceDate: '2026-10-01',
        isDefault: false,
        archivedAt: null,
        createdAt: '2026-10-01T08:05:00Z',
      },
      {
        id: 'acc-usd',
        name: 'Ví USD',
        accountType: 'E_WALLET',
        currencyCode: 'USD',
        openingBalanceMinor: 850_00,
        openingBalanceDate: '2026-11-01',
        isDefault: false,
        archivedAt: null,
        createdAt: '2026-11-01T08:10:00Z',
      },
    ],
    categories: [
      { id: 'cat-inc-salary', kind: 'INCOME', name: 'Lương', archivedAt: null },
      { id: 'cat-inc-freelance', kind: 'INCOME', name: 'Freelance', archivedAt: null },
      { id: 'cat-inc-bonus', kind: 'INCOME', name: 'Thưởng', archivedAt: null },
      { id: 'cat-inc-interest', kind: 'INCOME', name: 'Lãi tiết kiệm', archivedAt: null },
      { id: 'cat-inc-gift', kind: 'INCOME', name: 'Quà tặng', archivedAt: null },
      { id: 'cat-exp-food', kind: 'EXPENSE', name: 'Ăn uống', archivedAt: null },
      { id: 'cat-exp-transport', kind: 'EXPENSE', name: 'Di chuyển', archivedAt: null },
      { id: 'cat-exp-housing', kind: 'EXPENSE', name: 'Nhà ở & Điện nước', archivedAt: null },
      { id: 'cat-exp-shopping', kind: 'EXPENSE', name: 'Mua sắm', archivedAt: null },
      { id: 'cat-exp-health', kind: 'EXPENSE', name: 'Sức khỏe', archivedAt: null },
      { id: 'cat-exp-entertain', kind: 'EXPENSE', name: 'Giải trí', archivedAt: null },
      { id: 'cat-exp-fee', kind: 'EXPENSE', name: 'Phí giao dịch', archivedAt: null },
    ],
    incomeSources: [
      { id: 'src-company', name: 'Công ty TechViet' },
      { id: 'src-client', name: 'Khách hàng Freelance' },
      { id: 'src-bank', name: 'Ngân hàng' },
    ],
    merchants: [
      { id: 'mrc-highlands', name: 'Highlands Coffee' },
      { id: 'mrc-winmart', name: 'WinMart' },
      { id: 'mrc-grab', name: 'Grab' },
      { id: 'mrc-shopee', name: 'Shopee' },
      { id: 'mrc-evn', name: 'Điện lực EVN' },
      { id: 'mrc-longchau', name: 'Nhà thuốc Long Châu' },
    ],
    transactions: [
      // October 2026 baseline
      {
        id: 'tx-oct-inc-1',
        accountId: 'acc-vcb',
        entryType: 'INCOME',
        status: 'POSTED',
        amountMinor: 22_000_000,
        currencyCode: 'VND',
        transactionDate: '2026-10-05',
        description: 'Lương tháng 10/2026',
        categoryId: 'cat-inc-salary',
        incomeSourceId: 'src-company',
        createdAt: '2026-10-05T09:00:00Z',
      },
      {
        id: 'tx-oct-exp-1',
        accountId: 'acc-vcb',
        entryType: 'EXPENSE',
        status: 'POSTED',
        amountMinor: 4_500_000,
        currencyCode: 'VND',
        transactionDate: '2026-10-12',
        description: 'Tiền thuê nhà & điện nước T10',
        categoryId: 'cat-exp-housing',
        merchantId: 'mrc-evn',
        createdAt: '2026-10-12T10:30:00Z',
      },
      // November 2026 — multi-wallet & statuses + refund
      {
        id: 'tx-nov-inc-1',
        accountId: 'acc-vcb',
        entryType: 'INCOME',
        status: 'POSTED',
        amountMinor: 25_000_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-05',
        description: 'Lương tháng 11/2026',
        note: 'Nhận lương định kỳ đầu tháng',
        categoryId: 'cat-inc-salary',
        incomeSourceId: 'src-company',
        createdAt: '2026-11-05T09:15:00Z',
      },
      {
        id: 'tx-nov-trf-out-1',
        accountId: 'acc-vcb',
        entryType: 'TRANSFER_OUT',
        status: 'POSTED',
        amountMinor: 3_000_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-06',
        description: 'Chuyển đi tới Ví tiền mặt',
        note: 'Rút tiền mặt chi tiêu tuần',
        transferId: 'trf-nov-1',
        createdAt: '2026-11-06T08:30:00Z',
      },
      {
        id: 'tx-nov-trf-in-1',
        accountId: 'acc-default',
        entryType: 'TRANSFER_IN',
        status: 'POSTED',
        amountMinor: 3_000_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-06',
        description: 'Nhận chuyển từ Vietcombank',
        note: 'Rút tiền mặt chi tiêu tuần',
        transferId: 'trf-nov-1',
        createdAt: '2026-11-06T08:30:00Z',
      },
      {
        id: 'tx-nov-inc-2',
        accountId: 'acc-vcb',
        entryType: 'INCOME',
        status: 'PENDING',
        amountMinor: 6_500_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-22',
        description: 'Thiết kế giao diện Landing Page',
        note: 'Chờ khách hàng thanh toán đợt 2',
        categoryId: 'cat-inc-freelance',
        incomeSourceId: 'src-client',
        createdAt: '2026-11-22T14:20:00Z',
      },
      {
        id: 'tx-nov-inc-3',
        accountId: 'acc-vcb',
        entryType: 'INCOME',
        status: 'DRAFT',
        amountMinor: 2_000_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-23',
        description: 'Thưởng dự án Q4 (Nháp)',
        note: 'Chờ duyệt mức thưởng cuối quý',
        categoryId: 'cat-inc-bonus',
        incomeSourceId: 'src-company',
        createdAt: '2026-11-23T08:30:00Z',
      },
      {
        id: 'tx-nov-inc-4',
        accountId: 'acc-default',
        entryType: 'INCOME',
        status: 'VOIDED',
        amountMinor: 1_200_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-08',
        description: 'Nhập nhầm khoản hoàn tiền vào thu nhập',
        voidReason: 'Hoàn tiền cần được ghi nhận tại mục Chi tiêu',
        categoryId: 'cat-inc-gift',
        incomeSourceId: 'src-bank',
        createdAt: '2026-11-08T11:00:00Z',
      },
      {
        id: 'tx-nov-exp-1',
        accountId: 'acc-default',
        entryType: 'EXPENSE',
        status: 'POSTED',
        amountMinor: 4_100_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-10',
        description: 'Ăn uống & đi chợ tháng 11',
        note: 'Bao gồm siêu thị WinMart và ăn trưa văn phòng',
        categoryId: 'cat-exp-food',
        merchantId: 'mrc-winmart',
        createdAt: '2026-11-10T18:45:00Z',
      },
      {
        id: 'tx-usd-inc-1',
        accountId: 'acc-usd',
        entryType: 'INCOME',
        status: 'POSTED',
        amountMinor: 420_00,
        currencyCode: 'USD',
        transactionDate: '2026-11-12',
        description: 'Remote Consulting Retainer',
        categoryId: 'cat-inc-freelance',
        incomeSourceId: 'src-client',
        createdAt: '2026-11-12T10:00:00Z',
      },
      {
        id: 'tx-nov-exp-2',
        accountId: 'acc-vcb',
        entryType: 'EXPENSE',
        status: 'POSTED',
        amountMinor: 2_500_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-14',
        description: 'Mua sắm thiết bị làm việc Shopee',
        categoryId: 'cat-exp-shopping',
        merchantId: 'mrc-shopee',
        createdAt: '2026-11-14T16:10:00Z',
      },
      {
        id: 'tx-usd-exp-1',
        accountId: 'acc-usd',
        entryType: 'EXPENSE',
        status: 'POSTED',
        amountMinor: 64_50,
        currencyCode: 'USD',
        transactionDate: '2026-11-15',
        description: 'Cloud Hosting & SaaS Tools',
        categoryId: 'cat-exp-shopping',
        merchantId: 'mrc-shopee',
        createdAt: '2026-11-15T12:00:00Z',
      },
      {
        id: 'tx-nov-exp-refund-1',
        accountId: 'acc-vcb',
        entryType: 'EXPENSE_REFUND',
        status: 'POSTED',
        amountMinor: 300_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-16',
        description: 'Hoàn tiền trả 1 phụ kiện Shopee',
        note: 'Hoàn trả một phần đơn ngày 14/11',
        categoryId: 'cat-exp-shopping',
        merchantId: 'mrc-shopee',
        refundsTransactionId: 'tx-nov-exp-2',
        createdAt: '2026-11-16T10:00:00Z',
      },
      {
        id: 'tx-nov-exp-3',
        accountId: 'acc-default',
        entryType: 'EXPENSE',
        status: 'POSTED',
        amountMinor: 680_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-18',
        description: 'Di chuyển Grab tuần 3',
        categoryId: 'cat-exp-transport',
        merchantId: 'mrc-grab',
        createdAt: '2026-11-18T19:20:00Z',
      },
      {
        id: 'tx-nov-exp-4',
        accountId: 'acc-vcb',
        entryType: 'EXPENSE',
        status: 'POSTED',
        amountMinor: 4_800_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-20',
        description: 'Tiền nhà & điện nước T11',
        categoryId: 'cat-exp-housing',
        merchantId: 'mrc-evn',
        createdAt: '2026-11-20T09:00:00Z',
      },
      {
        id: 'tx-nov-exp-5',
        accountId: 'acc-default',
        entryType: 'EXPENSE',
        status: 'PENDING',
        amountMinor: 450_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-23',
        description: 'Đặt thuốc Long Châu (Chờ giao)',
        categoryId: 'cat-exp-health',
        merchantId: 'mrc-longchau',
        createdAt: '2026-11-23T07:50:00Z',
      },
      {
        id: 'tx-nov-exp-6',
        accountId: 'acc-default',
        entryType: 'EXPENSE',
        status: 'DRAFT',
        amountMinor: 120_000,
        currencyCode: 'VND',
        transactionDate: '2026-11-23',
        description: 'Cà phê họp nhóm (Nháp)',
        categoryId: 'cat-exp-food',
        merchantId: 'mrc-highlands',
        createdAt: '2026-11-23T09:10:00Z',
      },
    ],
    transfers: [
      {
        id: 'trf-nov-1',
        fromAccountId: 'acc-vcb',
        toAccountId: 'acc-default',
        fromAmountMinor: 3_000_000,
        fromCurrencyCode: 'VND',
        toAmountMinor: 3_000_000,
        toCurrencyCode: 'VND',
        exchangeRate: '1.00000000',
        transferDate: '2026-11-06',
        note: 'Rút tiền mặt chi tiêu tuần',
        status: 'POSTED',
        createdAt: '2026-11-06T08:30:00Z',
      },
    ],
    budgets: [
      {
        id: 'bdg-nov-food',
        categoryId: 'cat-exp-food',
        limitMinor: 5_000_000,
        currencyCode: 'VND',
        month: '2026-11',
      },
      {
        id: 'bdg-nov-shopping',
        categoryId: 'cat-exp-shopping',
        limitMinor: 2_000_000,
        currencyCode: 'VND',
        month: '2026-11',
      },
      {
        id: 'bdg-nov-transport',
        categoryId: 'cat-exp-transport',
        limitMinor: 1_500_000,
        currencyCode: 'VND',
        month: '2026-11',
      },
      {
        id: 'bdg-nov-housing',
        categoryId: 'cat-exp-housing',
        limitMinor: 5_000_000,
        currencyCode: 'VND',
        month: '2026-11',
      },
      {
        id: 'bdg-nov-usd-shop',
        categoryId: 'cat-exp-shopping',
        limitMinor: 100_00,
        currencyCode: 'USD',
        month: '2026-11',
      },
    ],
    recurringRules: [
      {
        id: 'rec-demo-salary',
        title: 'Lương tháng',
        ruleKind: 'INCOME',
        accountId: 'acc-vcb',
        categoryId: 'cat-inc-salary',
        amountMinor: 25_000_000,
        currencyCode: 'VND',
        frequency: 'MONTHLY',
        intervalCount: 1,
        nextRunDate: '2026-11-23',
        endDate: null,
        isActive: true,
        createdAt: '2026-10-05T08:00:00Z',
      },
      {
        id: 'rec-demo-rent',
        title: 'Tiền thuê nhà',
        ruleKind: 'EXPENSE',
        accountId: 'acc-vcb',
        categoryId: 'cat-exp-housing',
        amountMinor: 6_500_000,
        currencyCode: 'VND',
        frequency: 'MONTHLY',
        intervalCount: 1,
        nextRunDate: '2026-11-23',
        endDate: null,
        isActive: true,
        createdAt: '2026-10-12T08:00:00Z',
      },
    ],
  };
}

export interface CreateTransactionInput {
  accountId: string;
  entryType: 'INCOME' | 'EXPENSE';
  status: 'DRAFT' | 'PENDING' | 'POSTED';
  amountMinor: number;
  transactionDate: string;
  description: string;
  note?: string;
  categoryId: string;
  incomeSourceId?: string;
  merchantId?: string;
  idempotencyKey?: string;
}

export interface CreateRefundInput {
  originalTransactionId: string;
  accountId: string;
  amountMinor: number;
  transactionDate: string;
  note?: string;
  idempotencyKey?: string;
}

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  fromAmountMinor: number;
  toAmountMinor: number;
  exchangeRate: string;
  feeAmountMinor?: number;
  transferDate: string;
  note?: string;
  idempotencyKey?: string;
}

export interface CreateAccountInput {
  name: string;
  accountType: AccountType;
  currencyCode: CurrencyCode;
  openingBalanceMinor: number;
  openingBalanceDate: string;
}

export interface CreateRecurringRuleInput {
  title?: string;
  ruleKind: RecurringRuleKind;
  accountId: string;
  categoryId: string;
  amountMinor: number;
  frequency: RecurringFrequency;
  intervalCount: number;
  nextRunDate: string;
  endDate?: string | null;
  idempotencyKey?: string;
}

export interface UpdateRecurringRuleInput {
  title?: string;
  accountId?: string;
  categoryId?: string;
  amountMinor?: number;
  frequency?: RecurringFrequency;
  intervalCount?: number;
  nextRunDate?: string;
  endDate?: string | null;
}

export interface PreviewContextValue {
  state: PreviewDataState;
  dataMode: DataMode;
  setDataMode: (mode: DataMode) => void;
  authUser: ApiUserProfile | null;
  authChecked: boolean;
  isLiveSyncing: boolean;
  loginWithCredentials: (email: string, password: string, mfaCode?: string) => Promise<ApiUserProfile>;
  updateAuthUserMfaEnabled: (enabled: boolean) => void;
  demoMfaEnabled: boolean;
  setDemoMfaEnabled: (enabled: boolean) => void;
  getDemoAttachments: (transactionId: string) => TransactionAttachment[];
  addDemoAttachment: (transactionId: string, attachment: TransactionAttachment) => void;
  removeDemoAttachment: (transactionId: string, attachmentId: string) => void;
  registerWithCredentials: (payload: {
    email: string;
    password: string;
    fullName: string;
    baseCurrencyCode?: ApiCurrencyCode;
    timezone?: string;
  }) => Promise<ApiUserProfile>;
  logoutSession: () => Promise<void>;
  refreshLiveData: () => Promise<void>;
  activeAccounts: Account[];
  archivedAccounts: Account[];
  isLoadingSkeleton: boolean;
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  getAccountBalance: (accountId: string) => number;
  getAccountTxCount: (accountId: string) => number;
  getCategoryById: (categoryId?: string) => Category | undefined;
  getAccountById: (accountId?: string) => Account | undefined;
  getRefundableRemaining: (expenseTxId: string) => number;
  createTransaction: (input: CreateTransactionInput) => { ok: boolean; error?: string };
  postTransaction: (txId: string) => void;
  cancelDraftOptimistic: (txId: string) => void;
  voidOrReverseTransaction: (txId: string, mode: 'VOIDED' | 'REVERSED', reason: string) => void;
  createExpenseRefund: (input: CreateRefundInput) => { ok: boolean; error?: string };
  createTransfer: (input: CreateTransferInput) => { ok: boolean; error?: string };
  voidTransfer: (transferId: string) => void;
  createAccount: (input: CreateAccountInput) => Account;
  updateAccount: (
    accountId: string,
    patch: { name: string; accountType: AccountType; currencyCode: CurrencyCode },
  ) => { ok: boolean; error?: string };
  archiveAccount: (accountId: string) => { ok: boolean; error?: string };
  adjustAccountBalance: (accountId: string, actualBalanceMinor: number, reason: string) => void;
  upsertBudget: (
    categoryId: string,
    currencyCode: CurrencyCode,
    month: string,
    limitMinor: number,
  ) => void;
  createRecurringRule: (input: CreateRecurringRuleInput) => { ok: boolean; error?: string };
  updateRecurringRule: (
    ruleId: string,
    patch: UpdateRecurringRuleInput,
  ) => { ok: boolean; error?: string };
  pauseRecurringRule: (ruleId: string) => void;
  resumeRecurringRule: (ruleId: string) => void;
  runDueRecurringRules: (idempotencyKey?: string) => Promise<{ ok: boolean; createdCount: number }>;
  commitBulkImportDemo: (input: {
    accountId: string;
    rows: Array<{
      entryType: 'INCOME' | 'EXPENSE';
      transactionDate: string;
      amountMinor: number;
      categoryId?: string | null;
      description: string;
      note?: string | null;
    }>;
    idempotencyKey?: string;
  }) => { ok: boolean; importedCount: number; error?: string };
  setBaseCurrency: (currency: CurrencyCode) => void;
  setTimezone: (tz: string) => void;
  resetDemoData: () => void;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

export function PreviewStoreProvider({ children }: { children: React.ReactNode }) {
  const [demoState, setDemoState] = useState<PreviewDataState>(() => {
    const seed = createInitialSeed();
    if (typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PreviewDataState>;
          return {
            ...seed,
            ...parsed,
            recurringRules: Array.isArray(parsed.recurringRules)
              ? parsed.recurringRules
              : seed.recurringRules,
          };
        }
      } catch {
        // Fallback to seed
      }
    }
    return seed;
  });

  const [liveState, setLiveState] = useState<PreviewDataState>(() => createEmptyLiveState(null));
  const [liveAccountBalances, setLiveAccountBalances] = useState<Record<string, number>>({});
  const [liveAccountTxCounts, setLiveAccountTxCounts] = useState<Record<string, number>>({});

  const [dataMode, setDataModeState] = useState<DataMode>('demo');
  const dataModeRef = useRef<DataMode>('demo');
  const [authUser, setAuthUser] = useState<ApiUserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isLiveSyncing, setIsLiveSyncing] = useState(false);

  const [isLoadingSkeleton, setIsLoadingSkeleton] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const usedIdempotencyKeysRef = useRef<Set<string>>(new Set());
  const [demoMfaEnabled, setDemoMfaEnabled] = useState(false);
  const [demoAttachments, setDemoAttachments] = useState<Record<string, TransactionAttachment[]>>({
    'tx-nov-exp-2': [
      {
        id: 'att-demo-shopee-1',
        transactionId: 'tx-nov-exp-2',
        filename: 'hoa-don-shopee-thiet-bi.png',
        mimeType: 'image/png',
        sizeBytes: 68,
        // Valid 1x1 PNG sample for local attachment preview
        contentBase64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        createdAt: '2026-11-14T16:12:00Z',
      },
    ],
  });

  const state = dataMode === 'live' && authUser ? liveState : demoState;

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    if (!toast.onRetry) {
      const duration = toast.links && toast.links.length > 0 ? 8000 : 4200;
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const persistDemo = useCallback((next: PreviewDataState) => {
    setDemoState(next);
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota issues
      }
    }
  }, []);

  const updateDemoState = useCallback(
    (updater: (prev: PreviewDataState) => PreviewDataState) => {
      setDemoState((prev) => {
        const next = updater(prev);
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            // Ignore
          }
        }
        return next;
      });
    },
    [],
  );

  const applyDataMode = useCallback((mode: DataMode) => {
    dataModeRef.current = mode;
    setDataModeState(mode);
  }, []);

  const persistModePreference = useCallback((mode: DataMode) => {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(MODE_STORAGE_KEY, mode);
      } catch {
        // Ignore
      }
    }
  }, []);

  const refreshLiveData = useCallback(
    async (profileOverride?: ApiUserProfile | null) => {
      setIsLiveSyncing(true);
      let settled = false;
      const showSkeletonTimer =
        liveState.accounts.length === 0
          ? setTimeout(() => {
              if (!settled) setIsLoadingSkeleton(true);
            }, 300)
          : null;
      try {
        const [
          accountsDto,
          categoriesDto,
          sourcesDto,
          merchantsDto,
          incomesPage,
          expensesPage,
          transfersPage,
          budgetsDto,
          recurringRes,
        ] = await Promise.all([
          accountsApi.list(true),
          categoriesApi.list(true),
          incomeApi.listSources(),
          expenseApi.listMerchants(),
          incomeApi.list(100),
          expenseApi.list(100),
          transfersApi.list(100),
          budgetsApi.list(false),
          recurringApi.list().catch((err) => {
            if (isApiError(err) && (err.status === 404 || err.status === 501)) {
              return { items: [] as ApiRecurringRule[] };
            }
            throw err;
          }),
        ]);

        const txMap = new Map<string, Transaction>();
        for (const inc of incomesPage.items) {
          txMap.set(inc.id, mapApiTransaction(inc));
        }
        for (const exp of expensesPage.items) {
          txMap.set(exp.id, mapApiTransaction(exp));
        }
        for (const trf of transfersPage.items) {
          if (trf.fromTransaction) {
            txMap.set(trf.fromTransaction.id, mapApiTransaction(trf.fromTransaction));
          }
          if (trf.toTransaction) {
            txMap.set(trf.toTransaction.id, mapApiTransaction(trf.toTransaction));
          }
          if (trf.feeTransaction) {
            txMap.set(trf.feeTransaction.id, mapApiTransaction(trf.feeTransaction));
          }
        }

        const mergedTransactions = Array.from(txMap.values()).sort((a, b) => {
          if (a.transactionDate !== b.transactionDate) {
            return b.transactionDate.localeCompare(a.transactionDate);
          }
          return b.createdAt.localeCompare(a.createdAt);
        });

        const balances: Record<string, number> = {};
        const txCounts: Record<string, number> = {};
        for (const acc of accountsDto) {
          balances[acc.id] = Number(acc.postedBalanceMinor);
          txCounts[acc.id] = acc.transactionCount;
        }
        setLiveAccountBalances(balances);
        setLiveAccountTxCounts(txCounts);

        const profile = profileOverride ?? authUser;
        setLiveState({
          baseCurrency: profile ? normalizeCurrency(profile.baseCurrencyCode) : 'VND',
          timezone: profile?.timezone ?? 'Asia/Ho_Chi_Minh',
          accounts: accountsDto.map(mapApiAccount),
          categories: categoriesDto.map(mapApiCategory),
          incomeSources: sourcesDto.map(mapApiSource),
          merchants: merchantsDto.map(mapApiMerchant),
          transactions: mergedTransactions,
          transfers: transfersPage.items.map(mapApiTransfer),
          budgets: budgetsDto.map(mapApiBudget),
          recurringRules: recurringRes.items.map(mapApiRecurringRule),
        });
      } catch (err) {
        const message = isApiError(err) ? err.detail : 'Không thể đồng bộ dữ liệu từ máy chủ.';
        pushToast({
          tone: 'danger',
          title: 'Lỗi tải dữ liệu',
          description: message,
        });
      } finally {
        settled = true;
        if (showSkeletonTimer) clearTimeout(showSkeletonTimer);
        setIsLoadingSkeleton(false);
        setIsLiveSyncing(false);
      }
    },
    [authUser, liveState.accounts.length, pushToast],
  );

  useEffect(() => {
    let active = true;

    setOnUnauthorizedHandler(() => {
      if (!active) return;
      const wasLive = dataModeRef.current === 'live';
      setAuthUser(null);
      applyDataMode('demo');
      persistModePreference('demo');
      if (wasLive) {
        pushToast({
          tone: 'warning',
          title: 'Phiên đăng nhập đã hết hạn',
          description: 'Vui lòng đăng nhập lại để tiếp tục đồng bộ dữ liệu.',
        });
      }
    });

    (async () => {
      try {
        const me = await authApi.me({ suppressUnauthorizedHandler: true });
        if (!active) return;
        setAuthUser(me.user);

        const savedMode =
          typeof window !== 'undefined'
            ? (window.sessionStorage.getItem(MODE_STORAGE_KEY) as DataMode | null)
            : null;

        if (savedMode === 'live' || savedMode === null) {
          applyDataMode('live');
          persistModePreference('live');
          await refreshLiveData(me.user);
        }
      } catch {
        if (!active) return;
        setAuthUser(null);
        applyDataMode('demo');
      } finally {
        if (active) setAuthChecked(true);
      }
    })();

    return () => {
      active = false;
      setOnUnauthorizedHandler(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDataMode = useCallback(
    (mode: DataMode) => {
      if (mode === 'live' && !authUser) {
        pushToast({
          tone: 'info',
          title: 'Vui lòng đăng nhập để đồng bộ dữ liệu',
          description: 'Mở trang Đăng nhập để kết nối tài khoản của bạn.',
        });
        return;
      }
      applyDataMode(mode);
      persistModePreference(mode);
      if (mode === 'live') {
        void refreshLiveData(authUser);
      }
    },
    [applyDataMode, authUser, persistModePreference, pushToast, refreshLiveData],
  );

  const loginWithCredentials = useCallback(
    async (email: string, password: string, mfaCode?: string): Promise<ApiUserProfile> => {
      const res = await authApi.login({
        email,
        password,
        ...(mfaCode ? { mfaCode } : {}),
      });
      setAuthUser(res.user);
      applyDataMode('live');
      persistModePreference('live');
      await refreshLiveData(res.user);
      pushToast({
        tone: 'success',
        title: `Đã đăng nhập — ${res.user.fullName}`,
        description: 'Dữ liệu của bạn đã được đồng bộ.',
      });
      return res.user;
    },
    [applyDataMode, persistModePreference, pushToast, refreshLiveData],
  );

  const updateAuthUserMfaEnabled = useCallback((enabled: boolean) => {
    setAuthUser((prev) => (prev ? { ...prev, mfaEnabled: enabled } : prev));
  }, []);

  const getDemoAttachments = useCallback(
    (transactionId: string): TransactionAttachment[] => {
      return demoAttachments[transactionId] ?? [];
    },
    [demoAttachments],
  );

  const addDemoAttachment = useCallback(
    (transactionId: string, attachment: TransactionAttachment) => {
      setDemoAttachments((prev) => ({
        ...prev,
        [transactionId]: [attachment, ...(prev[transactionId] ?? [])],
      }));
    },
    [],
  );

  const removeDemoAttachment = useCallback(
    (transactionId: string, attachmentId: string) => {
      setDemoAttachments((prev) => ({
        ...prev,
        [transactionId]: (prev[transactionId] ?? []).filter((a) => a.id !== attachmentId),
      }));
    },
    [],
  );

  const registerWithCredentials = useCallback(
    async (payload: {
      email: string;
      password: string;
      fullName: string;
      baseCurrencyCode?: ApiCurrencyCode;
      timezone?: string;
    }): Promise<ApiUserProfile> => {
      const res = await authApi.register(payload);
      setAuthUser(res.user);
      applyDataMode('live');
      persistModePreference('live');
      await refreshLiveData(res.user);
      pushToast({
        tone: 'success',
        title: 'Tạo tài khoản thành công',
        description: 'Đã khởi tạo sổ mặc định và đồng bộ dữ liệu.',
      });
      return res.user;
    },
    [applyDataMode, persistModePreference, pushToast, refreshLiveData],
  );

  const logoutSession = useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch {
      // Clear client session state even if network fails
    }
    setAuthUser(null);
    applyDataMode('demo');
    persistModePreference('demo');
    setLiveState(createEmptyLiveState(null));
    setLiveAccountBalances({});
    setLiveAccountTxCounts({});
    pushToast({
      tone: 'info',
      title: 'Đã đăng xuất',
      description: 'Bạn đã thoát khỏi phiên đăng nhập hiện tại.',
    });
  }, [applyDataMode, persistModePreference, pushToast]);

  const activeAccounts = useMemo(
    () => state.accounts.filter((a) => a.archivedAt === null),
    [state.accounts],
  );

  const archivedAccounts = useMemo(
    () => state.accounts.filter((a) => a.archivedAt !== null),
    [state.accounts],
  );

  const getAccountBalance = useCallback(
    (accountId: string) => {
      if (dataMode === 'live' && Object.prototype.hasOwnProperty.call(liveAccountBalances, accountId)) {
        return liveAccountBalances[accountId];
      }
      const acc = state.accounts.find((a) => a.id === accountId);
      if (!acc) return 0;
      return computeAccountPostedBalance(acc, state.transactions);
    },
    [dataMode, liveAccountBalances, state.accounts, state.transactions],
  );

  const getAccountTxCount = useCallback(
    (accountId: string) => {
      if (dataMode === 'live' && Object.prototype.hasOwnProperty.call(liveAccountTxCounts, accountId)) {
        return liveAccountTxCounts[accountId];
      }
      return state.transactions.filter((t) => t.accountId === accountId).length;
    },
    [dataMode, liveAccountTxCounts, state.transactions],
  );

  const getCategoryById = useCallback(
    (categoryId?: string) => state.categories.find((c) => c.id === categoryId),
    [state.categories],
  );

  const getAccountById = useCallback(
    (accountId?: string) => state.accounts.find((a) => a.id === accountId),
    [state.accounts],
  );

  const getRefundableRemaining = useCallback(
    (expenseTxId: string) => {
      const original = state.transactions.find((t) => t.id === expenseTxId);
      if (!original || original.entryType !== 'EXPENSE' || original.status !== 'POSTED') return 0;
      const alreadyRefunded = state.transactions
        .filter(
          (t) =>
            t.entryType === 'EXPENSE_REFUND' &&
            t.refundsTransactionId === expenseTxId &&
            (t.status === 'POSTED' || t.status === 'PENDING'),
        )
        .reduce((acc, t) => acc + t.amountMinor, 0);
      return Math.max(0, original.amountMinor - alreadyRefunded);
    },
    [state.transactions],
  );

  const executeLiveAction = useCallback(
    (params: {
      actionTitle: string;
      applyOptimistic: (prev: PreviewDataState) => PreviewDataState;
      applyBalanceOptimistic?: (prev: Record<string, number>) => Record<string, number>;
      apiCall: () => Promise<unknown>;
    }) => {
      const runAttempt = () => {
        const snapshot = liveState;
        const balSnapshot = { ...liveAccountBalances };

        setLiveState(params.applyOptimistic);
        if (params.applyBalanceOptimistic) {
          setLiveAccountBalances(params.applyBalanceOptimistic);
        }

        void (async () => {
          try {
            await params.apiCall();
            await refreshLiveData();
          } catch (err) {
            setLiveState(snapshot);
            setLiveAccountBalances(balSnapshot);
            const detail = isApiError(err) ? err.detail : 'Không thể đồng bộ với máy chủ.';
            pushToast({
              tone: 'danger',
              title: `${params.actionTitle} thất bại — đã hoàn tác`,
              description: detail,
              retryLabel: 'Thử lại',
              onRetry: () => {
                runAttempt();
              },
            });
          }
        })();
      };

      runAttempt();
    },
    [liveAccountBalances, liveState, pushToast, refreshLiveData],
  );

  const createTransaction = useCallback(
    (input: CreateTransactionInput): { ok: boolean; error?: string } => {
      if (
        dataMode === 'demo' &&
        input.idempotencyKey &&
        usedIdempotencyKeysRef.current.has(input.idempotencyKey)
      ) {
        return { ok: true };
      }

      const account = state.accounts.find((a) => a.id === input.accountId && a.archivedAt === null);
      if (!account) {
        return { ok: false, error: 'Tài khoản không tồn tại hoặc đã lưu trữ.' };
      }
      if (input.amountMinor <= 0) {
        return { ok: false, error: 'Số tiền phải lớn hơn 0.' };
      }

      const newTx: Transaction = {
        id: `tx-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        accountId: account.id,
        entryType: input.entryType,
        status: input.status,
        amountMinor: input.amountMinor,
        currencyCode: account.currencyCode,
        transactionDate: input.transactionDate,
        description: input.description.trim(),
        note: input.note?.trim() || undefined,
        categoryId: input.categoryId,
        incomeSourceId: input.entryType === 'INCOME' ? input.incomeSourceId : undefined,
        merchantId: input.entryType === 'EXPENSE' ? input.merchantId : undefined,
        createdAt: new Date().toISOString(),
      };

      if (dataMode === 'live') {
        const reqKey = input.idempotencyKey ?? generateUuidV4();
        executeLiveAction({
          actionTitle: input.entryType === 'INCOME' ? 'Ghi Thu nhập' : 'Ghi Chi tiêu',
          applyOptimistic: (prev) => ({
            ...prev,
            transactions: [newTx, ...prev.transactions],
          }),
          applyBalanceOptimistic:
            input.status === 'POSTED'
              ? (prev) => ({
                  ...prev,
                  [account.id]:
                    (prev[account.id] ?? 0) +
                    (input.entryType === 'INCOME' ? input.amountMinor : -input.amountMinor),
                })
              : undefined,
          apiCall: () =>
            input.entryType === 'INCOME'
              ? incomeApi.create(
                  {
                    accountId: account.id,
                    categoryId: input.categoryId,
                    incomeSourceId: input.incomeSourceId,
                    amountMinor: String(input.amountMinor),
                    currencyCode: account.currencyCode,
                    transactionDate: input.transactionDate,
                    status: input.status,
                    description: input.description.trim(),
                    note: input.note?.trim() || undefined,
                  },
                  reqKey,
                )
              : expenseApi.create(
                  {
                    accountId: account.id,
                    categoryId: input.categoryId,
                    merchantId: input.merchantId,
                    amountMinor: String(input.amountMinor),
                    currencyCode: account.currencyCode,
                    transactionDate: input.transactionDate,
                    status: input.status,
                    description: input.description.trim(),
                    note: input.note?.trim() || undefined,
                  },
                  reqKey,
                ),
        });
      } else {
        if (input.idempotencyKey) {
          usedIdempotencyKeysRef.current.add(input.idempotencyKey);
        }
        updateDemoState((prev) => ({
          ...prev,
          transactions: [newTx, ...prev.transactions],
        }));
      }

      const statusText =
        input.status === 'POSTED'
          ? 'Đã ghi sổ'
          : input.status === 'PENDING'
            ? 'Đã lưu chờ xử lý'
            : 'Đã lưu nháp';

      pushToast({
        tone: 'success',
        title: `${statusText} ${input.entryType === 'INCOME' ? 'Thu nhập' : 'Chi tiêu'}`,
        description: newTx.description,
      });

      return { ok: true };
    },
    [dataMode, executeLiveAction, pushToast, state.accounts, updateDemoState],
  );

  const postTransaction = useCallback(
    (txId: string) => {
      if (dataMode === 'live') {
        const target = liveState.transactions.find((t) => t.id === txId);
        if (!target || (target.status !== 'DRAFT' && target.status !== 'PENDING')) return;

        const reqKey = generateUuidV4();
        pushToast({
          tone: 'success',
          title: 'Đã xác nhận ghi sổ',
          description: 'Đang đồng bộ số dư & báo cáo với máy chủ.',
        });

        executeLiveAction({
          actionTitle: 'Xác nhận ghi sổ',
          applyOptimistic: (prev) => ({
            ...prev,
            transactions: prev.transactions.map((t) =>
              t.id === txId ? { ...t, status: 'POSTED' } : t,
            ),
          }),
          applyBalanceOptimistic: (prev) => ({
            ...prev,
            [target.accountId]:
              (prev[target.accountId] ?? 0) +
              (target.entryType === 'INCOME' ? target.amountMinor : -target.amountMinor),
          }),
          apiCall: () =>
            target.entryType === 'INCOME'
              ? incomeApi.post(txId, reqKey)
              : expenseApi.post(txId, reqKey),
        });
        return;
      }

      updateDemoState((prev) => ({
        ...prev,
        transactions: prev.transactions.map((t) =>
          t.id === txId && (t.status === 'DRAFT' || t.status === 'PENDING')
            ? { ...t, status: 'POSTED' }
            : t,
        ),
      }));
      pushToast({
        tone: 'success',
        title: 'Đã xác nhận ghi sổ',
        description: 'Số dư tài khoản và báo cáo đã được cập nhật.',
      });
    },
    [dataMode, executeLiveAction, liveState.transactions, pushToast, updateDemoState],
  );

  const cancelDraftOptimistic = useCallback(
    (txId: string) => {
      if (dataMode === 'live') {
        const target = liveState.transactions.find((t) => t.id === txId);
        if (!target || (target.status !== 'DRAFT' && target.status !== 'PENDING')) return;

        const reqKey = generateUuidV4();
        pushToast({
          tone: 'info',
          title: 'Đã hủy bản nháp / giao dịch chờ',
        });

        executeLiveAction({
          actionTitle: 'Hủy bản nháp',
          applyOptimistic: (prev) => ({
            ...prev,
            transactions: prev.transactions.map((t) =>
              t.id === txId ? { ...t, status: 'VOIDED', voidReason: 'Đã hủy bản nháp/chờ' } : t,
            ),
          }),
          apiCall: () =>
            target.entryType === 'INCOME'
              ? incomeApi.void(txId, 'CANCEL_DRAFT', reqKey)
              : expenseApi.void(txId, 'CANCEL_DRAFT', reqKey),
        });
        return;
      }

      const execute = (targetId: string) => {
        const target = demoState.transactions.find((t) => t.id === targetId);
        if (!target || (target.status !== 'DRAFT' && target.status !== 'PENDING')) return;

        updateDemoState((prev) => ({
          ...prev,
          transactions: prev.transactions.map((t) =>
            t.id === targetId ? { ...t, status: 'VOIDED', voidReason: 'Đã hủy bản nháp/chờ' } : t,
          ),
        }));

        pushToast({
          tone: 'info',
          title: 'Đã hủy bản nháp / giao dịch chờ',
        });
      };

      execute(txId);
    },
    [
      dataMode,
      demoState.transactions,
      executeLiveAction,
      liveState.transactions,
      pushToast,
      updateDemoState,
    ],
  );

  const voidOrReverseTransaction = useCallback(
    (txId: string, mode: 'VOIDED' | 'REVERSED', reason: string) => {
      const target = state.transactions.find((t) => t.id === txId);
      if (!target || target.status !== 'POSTED') return;

      const applyTransform = (prev: PreviewDataState): PreviewDataState => {
        if (mode === 'VOIDED') {
          return {
            ...prev,
            transactions: prev.transactions.map((t) =>
              t.id === txId ? { ...t, status: 'VOIDED', voidReason: reason } : t,
            ),
          };
        }

        const reverseEntryType =
          target.entryType === 'INCOME'
            ? 'ADJUSTMENT_DEBIT'
            : target.entryType === 'EXPENSE'
              ? 'EXPENSE_REFUND'
              : target.entryType;

        const reversalTx: Transaction = {
          id: `tx-rev-${Date.now()}`,
          accountId: target.accountId,
          entryType: reverseEntryType,
          status: 'POSTED',
          amountMinor: target.amountMinor,
          currencyCode: target.currencyCode,
          transactionDate: new Date().toISOString().slice(0, 10),
          description: `Đảo bút toán: ${target.description}`,
          note: reason,
          categoryId: target.categoryId,
          reversesTransactionId: target.id,
          createdAt: new Date().toISOString(),
        };

        return {
          ...prev,
          transactions: [
            reversalTx,
            ...prev.transactions.map((t) =>
              t.id === txId
                ? { ...t, status: 'REVERSED' as TransactionStatus, voidReason: reason }
                : t,
            ),
          ],
        };
      };

      if (dataMode === 'live') {
        const reqKey = generateUuidV4();
        pushToast({
          tone: 'warning',
          title: mode === 'VOIDED' ? 'Đã hủy sổ' : 'Đã đảo ngược bút toán',
          description: reason,
        });

        executeLiveAction({
          actionTitle: mode === 'VOIDED' ? 'Hủy sổ giao dịch' : 'Đảo bút toán',
          applyOptimistic: applyTransform,
          apiCall: () => {
            if (target.entryType === 'INCOME') {
              return mode === 'VOIDED'
                ? incomeApi.void(txId, reason, reqKey)
                : incomeApi.reverse(txId, reason, reqKey);
            }
            return mode === 'VOIDED'
              ? expenseApi.void(txId, reason, reqKey)
              : expenseApi.reverse(txId, reason, reqKey);
          },
        });
        return;
      }

      updateDemoState(applyTransform);
      pushToast({
        tone: 'warning',
        title: mode === 'VOIDED' ? 'Đã hủy sổ' : 'Đã đảo ngược bút toán',
        description: reason,
      });
    },
    [dataMode, executeLiveAction, pushToast, state.transactions, updateDemoState],
  );

  const createExpenseRefund = useCallback(
    (input: CreateRefundInput): { ok: boolean; error?: string } => {
      if (
        dataMode === 'demo' &&
        input.idempotencyKey &&
        usedIdempotencyKeysRef.current.has(input.idempotencyKey)
      ) {
        return { ok: true };
      }

      const original = state.transactions.find((t) => t.id === input.originalTransactionId);
      if (!original || original.entryType !== 'EXPENSE' || original.status !== 'POSTED') {
        return { ok: false, error: 'Không tìm thấy giao dịch chi tiêu gốc hợp lệ.' };
      }

      const remaining = getRefundableRemaining(original.id);
      if (input.amountMinor <= 0) {
        return { ok: false, error: 'Số tiền hoàn phải lớn hơn 0.' };
      }
      if (input.amountMinor > remaining) {
        return {
          ok: false,
          error: 'Số tiền hoàn vượt quá số tiền còn có thể hoàn của giao dịch gốc.',
        };
      }

      const targetAccount = state.accounts.find(
        (a) => a.id === input.accountId && a.archivedAt === null,
      );
      if (!targetAccount || targetAccount.currencyCode !== original.currencyCode) {
        return {
          ok: false,
          error: `Tài khoản nhận hoàn phải dùng cùng tiền tệ ${original.currencyCode}.`,
        };
      }

      const refundTx: Transaction = {
        id: `tx-ref-${Date.now()}`,
        accountId: targetAccount.id,
        entryType: 'EXPENSE_REFUND',
        status: 'POSTED',
        amountMinor: input.amountMinor,
        currencyCode: original.currencyCode,
        transactionDate: input.transactionDate,
        description: `Hoàn tiền: ${original.description}`,
        note: input.note?.trim() || undefined,
        categoryId: original.categoryId,
        merchantId: original.merchantId,
        refundsTransactionId: original.id,
        createdAt: new Date().toISOString(),
      };

      if (dataMode === 'live') {
        const reqKey = input.idempotencyKey ?? generateUuidV4();
        executeLiveAction({
          actionTitle: 'Ghi nhận Hoàn tiền',
          applyOptimistic: (prev) => ({
            ...prev,
            transactions: [refundTx, ...prev.transactions],
          }),
          applyBalanceOptimistic: (prev) => ({
            ...prev,
            [targetAccount.id]: (prev[targetAccount.id] ?? 0) + input.amountMinor,
          }),
          apiCall: () =>
            expenseApi.createRefund(
              original.id,
              {
                accountId: targetAccount.id,
                amountMinor: String(input.amountMinor),
                transactionDate: input.transactionDate,
                note: input.note?.trim() || undefined,
              },
              reqKey,
            ),
        });
      } else {
        if (input.idempotencyKey) {
          usedIdempotencyKeysRef.current.add(input.idempotencyKey);
        }
        updateDemoState((prev) => ({
          ...prev,
          transactions: [refundTx, ...prev.transactions],
        }));
      }

      pushToast({
        tone: 'success',
        title: 'Đã ghi nhận hoàn tiền',
        description: 'Đã tăng số dư tài khoản và giảm chi tiêu ròng của danh mục gốc.',
      });

      return { ok: true };
    },
    [
      dataMode,
      executeLiveAction,
      getRefundableRemaining,
      pushToast,
      state.accounts,
      state.transactions,
      updateDemoState,
    ],
  );

  const createTransfer = useCallback(
    (input: CreateTransferInput): { ok: boolean; error?: string } => {
      if (
        dataMode === 'demo' &&
        input.idempotencyKey &&
        usedIdempotencyKeysRef.current.has(input.idempotencyKey)
      ) {
        return { ok: true };
      }
      if (input.fromAccountId === input.toAccountId) {
        return { ok: false, error: 'Tài khoản nguồn và đích không được trùng nhau.' };
      }

      const fromAcc = state.accounts.find(
        (a) => a.id === input.fromAccountId && a.archivedAt === null,
      );
      const toAcc = state.accounts.find(
        (a) => a.id === input.toAccountId && a.archivedAt === null,
      );
      if (!fromAcc || !toAcc) {
        return { ok: false, error: 'Tài khoản nguồn hoặc đích không hợp lệ.' };
      }
      if (input.fromAmountMinor <= 0 || input.toAmountMinor <= 0) {
        return { ok: false, error: 'Số tiền chuyển và số tiền nhận phải lớn hơn 0.' };
      }

      const transferId = `trf-${Date.now()}`;
      const createdAt = new Date().toISOString();

      let feeTx: Transaction | undefined;
      if (input.feeAmountMinor && input.feeAmountMinor > 0) {
        feeTx = {
          id: `tx-fee-${Date.now()}`,
          accountId: fromAcc.id,
          entryType: 'EXPENSE',
          status: 'POSTED',
          amountMinor: input.feeAmountMinor,
          currencyCode: fromAcc.currencyCode,
          transactionDate: input.transferDate,
          description: `Phí chuyển khoản: ${fromAcc.name} -> ${toAcc.name}`,
          note: 'Phí chuyển khoản được tách thành khoản chi tiêu riêng',
          categoryId: 'cat-exp-fee',
          createdAt,
        };
      }

      const transferOutTx: Transaction = {
        id: `tx-tout-${Date.now()}`,
        accountId: fromAcc.id,
        entryType: 'TRANSFER_OUT',
        status: 'POSTED',
        amountMinor: input.fromAmountMinor,
        currencyCode: fromAcc.currencyCode,
        transactionDate: input.transferDate,
        description: `Chuyển đi tới ${toAcc.name}`,
        note: input.note?.trim() || undefined,
        transferId,
        createdAt,
      };

      const transferInTx: Transaction = {
        id: `tx-tin-${Date.now() + 1}`,
        accountId: toAcc.id,
        entryType: 'TRANSFER_IN',
        status: 'POSTED',
        amountMinor: input.toAmountMinor,
        currencyCode: toAcc.currencyCode,
        transactionDate: input.transferDate,
        description: `Nhận chuyển từ ${fromAcc.name}`,
        note: input.note?.trim() || undefined,
        transferId,
        createdAt,
      };

      const transfer: Transfer = {
        id: transferId,
        fromAccountId: fromAcc.id,
        toAccountId: toAcc.id,
        fromAmountMinor: input.fromAmountMinor,
        fromCurrencyCode: fromAcc.currencyCode,
        toAmountMinor: input.toAmountMinor,
        toCurrencyCode: toAcc.currencyCode,
        exchangeRate: input.exchangeRate,
        feeAmountMinor:
          input.feeAmountMinor && input.feeAmountMinor > 0 ? input.feeAmountMinor : undefined,
        feeTransactionId: feeTx?.id,
        transferDate: input.transferDate,
        note: input.note?.trim() || undefined,
        status: 'POSTED',
        createdAt,
      };

      if (dataMode === 'live') {
        const reqKey = input.idempotencyKey ?? generateUuidV4();
        executeLiveAction({
          actionTitle: 'Chuyển khoản nội bộ',
          applyOptimistic: (prev) => ({
            ...prev,
            transfers: [transfer, ...prev.transfers],
            transactions: feeTx
              ? [feeTx, transferInTx, transferOutTx, ...prev.transactions]
              : [transferInTx, transferOutTx, ...prev.transactions],
          }),
          applyBalanceOptimistic: (prev) => ({
            ...prev,
            [fromAcc.id]:
              (prev[fromAcc.id] ?? 0) - input.fromAmountMinor - (input.feeAmountMinor ?? 0),
            [toAcc.id]: (prev[toAcc.id] ?? 0) + input.toAmountMinor,
          }),
          apiCall: () =>
            transfersApi.create(
              {
                fromAccountId: fromAcc.id,
                toAccountId: toAcc.id,
                fromAmountMinor: String(input.fromAmountMinor),
                toAmountMinor: String(input.toAmountMinor),
                exchangeRate: input.exchangeRate,
                ...(input.feeAmountMinor && input.feeAmountMinor > 0
                  ? { feeMinor: String(input.feeAmountMinor) }
                  : {}),
                transferDate: input.transferDate,
                note: input.note?.trim() || undefined,
              },
              reqKey,
            ),
        });
      } else {
        if (input.idempotencyKey) {
          usedIdempotencyKeysRef.current.add(input.idempotencyKey);
        }
        updateDemoState((prev) => ({
          ...prev,
          transfers: [transfer, ...prev.transfers],
          transactions: feeTx
            ? [feeTx, transferInTx, transferOutTx, ...prev.transactions]
            : [transferInTx, transferOutTx, ...prev.transactions],
        }));
      }

      pushToast({
        tone: 'success',
        title: 'Chuyển khoản nội bộ thành công',
        description: feeTx
          ? 'Đã cập nhật số dư 2 tài khoản và tách riêng phí giao dịch thành khoản chi tiêu.'
          : 'Đã cập nhật số dư 2 tài khoản (không ảnh hưởng Dòng tiền ròng).',
      });

      return { ok: true };
    },
    [dataMode, executeLiveAction, pushToast, state.accounts, updateDemoState],
  );

  const voidTransfer = useCallback(
    (transferId: string) => {
      const target = state.transfers.find((tr) => tr.id === transferId);
      if (!target || target.status !== 'POSTED') return;

      const applyVoid = (prev: PreviewDataState): PreviewDataState => ({
        ...prev,
        transfers: prev.transfers.map((tr) =>
          tr.id === transferId ? { ...tr, status: 'VOIDED' } : tr,
        ),
        transactions: prev.transactions.map((tx) =>
          tx.transferId === transferId || tx.id === target.feeTransactionId
            ? { ...tx, status: 'VOIDED', voidReason: 'Hủy giao dịch chuyển khoản' }
            : tx,
        ),
      });

      if (dataMode === 'live') {
        const reqKey = generateUuidV4();
        pushToast({
          tone: 'warning',
          title: 'Đã hủy chuyển khoản',
          description: 'Đang đồng bộ hoàn nguyên số dư với máy chủ.',
        });

        executeLiveAction({
          actionTitle: 'Hủy chuyển khoản',
          applyOptimistic: applyVoid,
          apiCall: () => transfersApi.void(transferId, 'USER_VOID', reqKey),
        });
        return;
      }

      updateDemoState(applyVoid);
      pushToast({
        tone: 'warning',
        title: 'Đã hủy chuyển khoản',
        description: 'Cả 2 bút toán chuyển khoản (và phí nếu có) đã được hoàn nguyên.',
      });
    },
    [dataMode, executeLiveAction, pushToast, state.transfers, updateDemoState],
  );

  const createAccount = useCallback(
    (input: CreateAccountInput): Account => {
      const acc: Account = {
        id: `acc-${Date.now()}-${Math.random().toString(16).slice(2, 5)}`,
        name: input.name.trim(),
        accountType: input.accountType,
        currencyCode: input.currencyCode,
        openingBalanceMinor: input.openingBalanceMinor,
        openingBalanceDate: input.openingBalanceDate,
        isDefault: false,
        archivedAt: null,
        createdAt: new Date().toISOString(),
      };

      if (dataMode === 'live') {
        executeLiveAction({
          actionTitle: 'Tạo tài khoản',
          applyOptimistic: (prev) => ({
            ...prev,
            accounts: [...prev.accounts, acc],
          }),
          applyBalanceOptimistic: (prev) => ({
            ...prev,
            [acc.id]: acc.openingBalanceMinor,
          }),
          apiCall: () =>
            accountsApi.create({
              name: acc.name,
              accountType: acc.accountType,
              currencyCode: acc.currencyCode,
              openingBalanceMinor: String(acc.openingBalanceMinor),
              openingBalanceDate: acc.openingBalanceDate,
            }),
        });
      } else {
        updateDemoState((prev) => ({
          ...prev,
          accounts: [...prev.accounts, acc],
        }));
      }

      pushToast({
        tone: 'success',
        title: `Đã tạo tài khoản "${acc.name}"`,
        description: `Tiền tệ ${acc.currencyCode}`,
      });

      return acc;
    },
    [dataMode, executeLiveAction, pushToast, updateDemoState],
  );

  const updateAccount = useCallback(
    (
      accountId: string,
      patch: { name: string; accountType: AccountType; currencyCode: CurrencyCode },
    ): { ok: boolean; error?: string } => {
      const txCount = getAccountTxCount(accountId);
      const existing = state.accounts.find((a) => a.id === accountId);
      if (!existing) return { ok: false, error: 'Không tìm thấy tài khoản.' };

      if (txCount > 0 && patch.currencyCode !== existing.currencyCode) {
        return {
          ok: false,
          error: 'Không thể đổi mã tiền tệ khi tài khoản đã phát sinh giao dịch.',
        };
      }

      const applyPatch = (prev: PreviewDataState): PreviewDataState => ({
        ...prev,
        accounts: prev.accounts.map((a) =>
          a.id === accountId
            ? {
                ...a,
                name: patch.name.trim(),
                accountType: patch.accountType,
                currencyCode: patch.currencyCode,
              }
            : a,
        ),
      });

      if (dataMode === 'live') {
        executeLiveAction({
          actionTitle: 'Cập nhật tài khoản',
          applyOptimistic: applyPatch,
          apiCall: () =>
            accountsApi.update(accountId, {
              name: patch.name.trim(),
              accountType: patch.accountType,
              ...(patch.currencyCode !== existing.currencyCode
                ? { currencyCode: patch.currencyCode }
                : {}),
            }),
        });
      } else {
        updateDemoState(applyPatch);
      }

      pushToast({
        tone: 'success',
        title: `Đã cập nhật tài khoản "${patch.name.trim()}"`,
      });
      return { ok: true };
    },
    [dataMode, executeLiveAction, getAccountTxCount, pushToast, state.accounts, updateDemoState],
  );

  const archiveAccount = useCallback(
    (accountId: string): { ok: boolean; error?: string } => {
      const active = state.accounts.filter((a) => a.archivedAt === null);
      if (active.length <= 1) {
        return {
          ok: false,
          error: 'Không thể lưu trữ tài khoản đang hoạt động duy nhất cuối cùng.',
        };
      }

      const target = active.find((a) => a.id === accountId);
      if (!target) {
        return { ok: false, error: 'Tài khoản không tồn tại hoặc đã lưu trữ.' };
      }

      const applyArchive = (prev: PreviewDataState): PreviewDataState => {
        const remainingActive = prev.accounts.filter(
          (a) => a.id !== accountId && a.archivedAt === null,
        );
        const reassignDefaultId = target.isDefault ? remainingActive[0]?.id : null;

        return {
          ...prev,
          accounts: prev.accounts.map((a) => {
            if (a.id === accountId) {
              return { ...a, isDefault: false, archivedAt: new Date().toISOString() };
            }
            if (reassignDefaultId && a.id === reassignDefaultId) {
              return { ...a, isDefault: true };
            }
            return a;
          }),
        };
      };

      if (dataMode === 'live') {
        executeLiveAction({
          actionTitle: 'Lưu trữ tài khoản',
          applyOptimistic: applyArchive,
          apiCall: () => accountsApi.archive(accountId),
        });
      } else {
        updateDemoState(applyArchive);
      }

      pushToast({
        tone: 'info',
        title: `Đã lưu trữ tài khoản "${target.name}"`,
        description: 'Lịch sử giao dịch và báo cáo cũ vẫn được giữ nguyên.',
      });

      return { ok: true };
    },
    [dataMode, executeLiveAction, pushToast, state.accounts, updateDemoState],
  );

  const adjustAccountBalance = useCallback(
    (accountId: string, actualBalanceMinor: number, reason: string) => {
      const acc = state.accounts.find((a) => a.id === accountId);
      if (!acc) return;
      const currentPosted = getAccountBalance(accountId);
      const diff = actualBalanceMinor - currentPosted;
      if (diff === 0) {
        pushToast({
          tone: 'info',
          title: 'Số dư đã khớp thực tế',
          description: 'Không cần tạo bút toán điều chỉnh.',
        });
        return;
      }

      const adjTx: Transaction = {
        id: `tx-adj-${Date.now()}`,
        accountId: acc.id,
        entryType: diff > 0 ? 'ADJUSTMENT_CREDIT' : 'ADJUSTMENT_DEBIT',
        status: 'POSTED',
        amountMinor: Math.abs(diff),
        currencyCode: acc.currencyCode,
        transactionDate: new Date().toISOString().slice(0, 10),
        description: `Điều chỉnh đối soát số dư (${acc.name})`,
        note: reason.trim() || 'Đối soát thực tế — loại trừ khỏi Thu nhập & Chi tiêu',
        createdAt: new Date().toISOString(),
      };

      if (dataMode === 'live') {
        const reqKey = generateUuidV4();
        executeLiveAction({
          actionTitle: 'Điều chỉnh số dư',
          applyOptimistic: (prev) => ({
            ...prev,
            transactions: [adjTx, ...prev.transactions],
          }),
          applyBalanceOptimistic: (prev) => ({
            ...prev,
            [acc.id]: actualBalanceMinor,
          }),
          apiCall: () =>
            accountsApi.createAdjustment(
              accountId,
              {
                actualBalanceMinor: String(actualBalanceMinor),
                transactionDate: adjTx.transactionDate,
                description: adjTx.description,
                note: adjTx.note,
              },
              reqKey,
            ),
        });
      } else {
        updateDemoState((prev) => ({
          ...prev,
          transactions: [adjTx, ...prev.transactions],
        }));
      }

      pushToast({
        tone: 'success',
        title: 'Đã điều chỉnh số dư tài khoản',
        description: `Tạo bút toán ${adjTx.entryType === 'ADJUSTMENT_CREDIT' ? 'điều chỉnh tăng' : 'điều chỉnh giảm'} (không tính vào Thu/Chi).`,
      });
    },
    [
      dataMode,
      executeLiveAction,
      getAccountBalance,
      pushToast,
      state.accounts,
      updateDemoState,
    ],
  );

  const upsertBudget = useCallback(
    (categoryId: string, currencyCode: CurrencyCode, month: string, limitMinor: number) => {
      const existingBudget = state.budgets.find(
        (b) => b.categoryId === categoryId && b.currencyCode === currencyCode && b.month === month,
      );

      const applyUpsert = (prev: PreviewDataState): PreviewDataState => {
        const idx = prev.budgets.findIndex(
          (b) => b.categoryId === categoryId && b.currencyCode === currencyCode && b.month === month,
        );
        if (idx >= 0) {
          const next = [...prev.budgets];
          next[idx] = { ...next[idx], limitMinor };
          return { ...prev, budgets: next };
        }
        return {
          ...prev,
          budgets: [
            ...prev.budgets,
            {
              id: `bdg-${Date.now()}`,
              categoryId,
              limitMinor,
              currencyCode,
              month,
            },
          ],
        };
      };

      if (dataMode === 'live') {
        executeLiveAction({
          actionTitle: 'Lưu ngân sách',
          applyOptimistic: applyUpsert,
          apiCall: () =>
            existingBudget
              ? budgetsApi.update(existingBudget.id, { limitMinor: String(limitMinor) })
              : budgetsApi.create({
                  categoryId,
                  currencyCode,
                  month,
                  limitMinor: String(limitMinor),
                }),
        });
      } else {
        updateDemoState(applyUpsert);
      }

      pushToast({
        tone: 'success',
        title: 'Đã lưu ngân sách danh mục',
      });
    },
    [dataMode, executeLiveAction, pushToast, state.budgets, updateDemoState],
  );

  const createRecurringRule = useCallback(
    (input: CreateRecurringRuleInput): { ok: boolean; error?: string } => {
      if (
        dataMode === 'demo' &&
        input.idempotencyKey &&
        usedIdempotencyKeysRef.current.has(input.idempotencyKey)
      ) {
        return { ok: true };
      }

      const account = state.accounts.find((a) => a.id === input.accountId && a.archivedAt === null);
      if (!account) {
        return { ok: false, error: 'Tài khoản không tồn tại hoặc đã lưu trữ.' };
      }
      if (input.amountMinor <= 0) {
        return { ok: false, error: 'Số tiền định kỳ phải lớn hơn 0.' };
      }
      const category = state.categories.find(
        (c) => c.id === input.categoryId && c.kind === input.ruleKind && !c.archivedAt,
      );
      if (!category) {
        return { ok: false, error: 'Danh mục không hợp lệ cho loại lịch định kỳ đã chọn.' };
      }
      if (input.intervalCount < 1 || !Number.isInteger(input.intervalCount)) {
        return { ok: false, error: 'Chu kỳ lặp phải là số nguyên từ 1 trở lên.' };
      }
      if (input.endDate && input.endDate < input.nextRunDate) {
        return { ok: false, error: 'Ngày kết thúc phải lớn hơn hoặc bằng ngày chạy kế tiếp.' };
      }

      const newRule: RecurringRule = {
        id: `rec-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        title: input.title?.trim() || category.name,
        ruleKind: input.ruleKind,
        accountId: account.id,
        categoryId: category.id,
        amountMinor: input.amountMinor,
        currencyCode: account.currencyCode,
        frequency: input.frequency,
        intervalCount: input.intervalCount,
        nextRunDate: input.nextRunDate,
        endDate: input.endDate || null,
        isActive: true,
        createdAt: new Date().toISOString(),
      };

      if (dataMode === 'live') {
        const reqKey = input.idempotencyKey ?? generateUuidV4();
        executeLiveAction({
          actionTitle: 'Tạo lịch định kỳ',
          applyOptimistic: (prev) => ({
            ...prev,
            recurringRules: [newRule, ...prev.recurringRules],
          }),
          apiCall: () =>
            recurringApi.create(
              {
                ruleKind: input.ruleKind,
                accountId: account.id,
                categoryId: category.id,
                amount: String(input.amountMinor),
                frequency: input.frequency,
                intervalCount: input.intervalCount,
                nextRunDate: input.nextRunDate,
                ...(input.endDate ? { endDate: input.endDate } : {}),
              },
              reqKey,
            ),
        });
      } else {
        if (input.idempotencyKey) {
          usedIdempotencyKeysRef.current.add(input.idempotencyKey);
        }
        updateDemoState((prev) => ({
          ...prev,
          recurringRules: [newRule, ...prev.recurringRules],
        }));
      }

      pushToast({
        tone: 'success',
        title: 'Đã tạo lịch định kỳ mới',
        description: `${newRule.title} · Khi đến hạn sẽ tạo bản nháp.`,
      });

      return { ok: true };
    },
    [dataMode, executeLiveAction, pushToast, state.accounts, state.categories, updateDemoState],
  );

  const updateRecurringRule = useCallback(
    (ruleId: string, patch: UpdateRecurringRuleInput): { ok: boolean; error?: string } => {
      const existing = state.recurringRules.find((r) => r.id === ruleId);
      if (!existing) {
        return { ok: false, error: 'Không tìm thấy lịch định kỳ.' };
      }

      const nextAccountId = patch.accountId ?? existing.accountId;
      const account = state.accounts.find((a) => a.id === nextAccountId && a.archivedAt === null);
      if (!account) {
        return { ok: false, error: 'Tài khoản không hợp lệ.' };
      }
      const nextAmount = patch.amountMinor ?? existing.amountMinor;
      if (nextAmount <= 0) {
        return { ok: false, error: 'Số tiền định kỳ phải lớn hơn 0.' };
      }
      const nextInterval = patch.intervalCount ?? existing.intervalCount;
      if (nextInterval < 1 || !Number.isInteger(nextInterval)) {
        return { ok: false, error: 'Chu kỳ lặp phải là số nguyên từ 1 trở lên.' };
      }
      const nextRunDate = patch.nextRunDate ?? existing.nextRunDate;
      const nextEndDate = patch.endDate !== undefined ? patch.endDate : existing.endDate;
      if (nextEndDate && nextEndDate < nextRunDate) {
        return { ok: false, error: 'Ngày kết thúc phải lớn hơn hoặc bằng ngày chạy kế tiếp.' };
      }

      const applyPatch = (prev: PreviewDataState): PreviewDataState => ({
        ...prev,
        recurringRules: prev.recurringRules.map((r) =>
          r.id === ruleId
            ? {
                ...r,
                title: patch.title !== undefined ? patch.title.trim() || r.title : r.title,
                accountId: nextAccountId,
                currencyCode: account.currencyCode,
                categoryId: patch.categoryId ?? r.categoryId,
                amountMinor: nextAmount,
                frequency: patch.frequency ?? r.frequency,
                intervalCount: nextInterval,
                nextRunDate,
                endDate: nextEndDate,
              }
            : r,
        ),
      });

      if (dataMode === 'live') {
        executeLiveAction({
          actionTitle: 'Cập nhật lịch định kỳ',
          applyOptimistic: applyPatch,
          apiCall: () =>
            recurringApi.update(ruleId, {
              accountId: nextAccountId,
              categoryId: patch.categoryId ?? existing.categoryId,
              amount: String(nextAmount),
              frequency: patch.frequency ?? existing.frequency,
              intervalCount: nextInterval,
              nextRunDate,
              endDate: nextEndDate,
            }),
        });
      } else {
        updateDemoState(applyPatch);
      }

      pushToast({
        tone: 'success',
        title: 'Đã cập nhật lịch định kỳ',
      });
      return { ok: true };
    },
    [dataMode, executeLiveAction, pushToast, state.accounts, state.recurringRules, updateDemoState],
  );

  const pauseRecurringRule = useCallback(
    (ruleId: string) => {
      const target = state.recurringRules.find((r) => r.id === ruleId);
      if (!target || !target.isActive) return;

      const applyPause = (prev: PreviewDataState): PreviewDataState => ({
        ...prev,
        recurringRules: prev.recurringRules.map((r) =>
          r.id === ruleId ? { ...r, isActive: false } : r,
        ),
      });

      if (dataMode === 'live') {
        const reqKey = generateUuidV4();
        pushToast({
          tone: 'info',
          title: 'Đã tạm dừng lịch định kỳ',
        });
        executeLiveAction({
          actionTitle: 'Tạm dừng lịch định kỳ',
          applyOptimistic: applyPause,
          apiCall: () => recurringApi.pause(ruleId, reqKey),
        });
      } else {
        updateDemoState(applyPause);
        pushToast({
          tone: 'info',
          title: 'Đã tạm dừng lịch định kỳ',
        });
      }
    },
    [dataMode, executeLiveAction, pushToast, state.recurringRules, updateDemoState],
  );

  const resumeRecurringRule = useCallback(
    (ruleId: string) => {
      const target = state.recurringRules.find((r) => r.id === ruleId);
      if (!target || target.isActive) return;

      const applyResume = (prev: PreviewDataState): PreviewDataState => ({
        ...prev,
        recurringRules: prev.recurringRules.map((r) =>
          r.id === ruleId ? { ...r, isActive: true } : r,
        ),
      });

      if (dataMode === 'live') {
        const reqKey = generateUuidV4();
        pushToast({
          tone: 'success',
          title: 'Đã tiếp tục lịch định kỳ',
        });
        executeLiveAction({
          actionTitle: 'Tiếp tục lịch định kỳ',
          applyOptimistic: applyResume,
          apiCall: () => recurringApi.resume(ruleId, reqKey),
        });
      } else {
        updateDemoState(applyResume);
        pushToast({
          tone: 'success',
          title: 'Đã tiếp tục lịch định kỳ',
        });
      }
    },
    [dataMode, executeLiveAction, pushToast, state.recurringRules, updateDemoState],
  );

  const runDueRecurringRules = useCallback(
    async (idempotencyKey?: string): Promise<{ ok: boolean; createdCount: number }> => {
      const reqKey = idempotencyKey ?? generateUuidV4();

      if (dataMode === 'live') {
        const attemptLiveRunDue = async (): Promise<{ ok: boolean; createdCount: number }> => {
          try {
            const res = await recurringApi.runDue(reqKey);
            const createdItems = res.items ?? res.transactions ?? [];
            const createdCount =
              res.generatedCount ?? res.createdCount ?? res.count ?? createdItems.length;
            await refreshLiveData();

            if (createdCount > 0) {
              const hasIncome = createdItems.some((tx) => tx.entryType === 'INCOME');
              const hasExpense = createdItems.some((tx) => tx.entryType === 'EXPENSE');
              const links =
                hasIncome || hasExpense
                  ? [
                      ...(hasIncome ? [{ label: 'Xác nhận Thu nhập', href: '/incomes' }] : []),
                      ...(hasExpense ? [{ label: 'Xác nhận Chi tiêu', href: '/expenses' }] : []),
                    ]
                  : [
                      { label: 'Xem Thu nhập', href: '/incomes' },
                      { label: 'Xem Chi tiêu', href: '/expenses' },
                    ];

              pushToast({
                tone: 'success',
                title: `Đã tạo ${createdCount} bản nháp đến hạn`,
                description: 'Mở trang Thu nhập hoặc Chi tiêu để xác nhận ghi sổ.',
                links,
              });
            } else {
              pushToast({
                tone: 'info',
                title: 'Chưa có lịch định kỳ nào đến hạn',
                description: 'Không có bản nháp mới được tạo.',
              });
            }

            return { ok: true, createdCount };
          } catch (err) {
            const detail = isApiError(err) ? err.detail : 'Không thể chạy tạo nháp định kỳ.';
            pushToast({
              tone: 'danger',
              title: 'Tạo nháp đến hạn thất bại',
              description: detail,
              retryLabel: 'Thử lại',
              onRetry: () => {
                void attemptLiveRunDue();
              },
            });
            return { ok: false, createdCount: 0 };
          }
        };

        return attemptLiveRunDue();
      }

      // Local workspace mode
      if (idempotencyKey && usedIdempotencyKeysRef.current.has(idempotencyKey)) {
        pushToast({
          tone: 'info',
          title: 'Yêu cầu đã được xử lý trước đó',
          description: 'Không tạo trùng bản nháp giao dịch.',
        });
        return { ok: true, createdCount: 0 };
      }

      const realToday = new Date().toLocaleDateString('en-CA');
      const demoToday = realToday > '2026-11-23' ? realToday : '2026-11-23';

      const generatedTxs: Transaction[] = [];
      let hasIncome = false;
      let hasExpense = false;

      const updatedRules = demoState.recurringRules.map((rule) => {
        if (!rule.isActive) return rule;

        let cursorDate = rule.nextRunDate;
        let guard = 0;

        while (
          cursorDate <= demoToday &&
          (!rule.endDate || cursorDate <= rule.endDate) &&
          guard < 24
        ) {
          guard += 1;
          const catName =
            demoState.categories.find((c) => c.id === rule.categoryId)?.name ?? 'Định kỳ';
          const txTitle = rule.title?.trim() || catName;
          generatedTxs.push({
            id: `tx-rec-${rule.id}-${cursorDate}-${Math.random().toString(16).slice(2, 6)}`,
            accountId: rule.accountId,
            entryType: rule.ruleKind,
            status: 'DRAFT',
            amountMinor: rule.amountMinor,
            currencyCode: rule.currencyCode,
            transactionDate: cursorDate,
            description: `${txTitle} (Định kỳ)`,
            note: 'Bản nháp tự động từ lịch định kỳ — bấm "Xác nhận ghi sổ" để cộng vào số dư.',
            categoryId: rule.categoryId,
            createdAt: new Date().toISOString(),
          });

          if (rule.ruleKind === 'INCOME') hasIncome = true;
          if (rule.ruleKind === 'EXPENSE') hasExpense = true;

          cursorDate = advanceRecurringDate(cursorDate, rule.frequency, rule.intervalCount);
        }

        if (guard === 0) return rule;
        const stillActive = !rule.endDate || cursorDate <= rule.endDate;
        return {
          ...rule,
          nextRunDate: cursorDate,
          isActive: stillActive,
        };
      });

      if (idempotencyKey) {
        usedIdempotencyKeysRef.current.add(idempotencyKey);
      }

      if (generatedTxs.length > 0) {
        updateDemoState((prev) => ({
          ...prev,
          recurringRules: updatedRules,
          transactions: [...generatedTxs, ...prev.transactions],
        }));

        const links = [
          ...(hasIncome ? [{ label: 'Xác nhận Thu nhập', href: '/incomes' }] : []),
          ...(hasExpense ? [{ label: 'Xác nhận Chi tiêu', href: '/expenses' }] : []),
        ];

        pushToast({
          tone: 'success',
          title: `Đã tạo ${generatedTxs.length} bản nháp đến hạn`,
          description: 'Các bản nháp chưa ảnh hưởng số dư cho tới khi bạn xác nhận.',
          links,
        });
      } else {
        pushToast({
          tone: 'info',
          title: 'Chưa có lịch định kỳ nào đến hạn',
          description: 'Các lịch đang hoạt động đều có ngày chạy kế tiếp ở tương lai.',
        });
      }

      return { ok: true, createdCount: generatedTxs.length };
    },
    [
      dataMode,
      demoState.categories,
      demoState.recurringRules,
      pushToast,
      refreshLiveData,
      updateDemoState,
    ],
  );

  const setBaseCurrency = useCallback(
    (currency: CurrencyCode) => {
      const applyCurrency = (prev: PreviewDataState): PreviewDataState => {
        const active = prev.accounts.filter((a) => a.archivedAt === null);
        const defaultAcc = active.find((a) => a.isDefault);
        const defaultTxCount = defaultAcc
          ? prev.transactions.filter((t) => t.accountId === defaultAcc.id).length
          : 1;

        const updatedAccounts =
          active.length === 1 && defaultAcc && defaultTxCount === 0
            ? prev.accounts.map((a) =>
                a.id === defaultAcc.id ? { ...a, currencyCode: currency } : a,
              )
            : prev.accounts;

        return {
          ...prev,
          baseCurrency: currency,
          accounts: updatedAccounts,
        };
      };

      if (dataMode === 'live') {
        executeLiveAction({
          actionTitle: 'Cập nhật tiền tệ cơ sở',
          applyOptimistic: applyCurrency,
          apiCall: () => authApi.updatePreferences({ baseCurrencyCode: currency }),
        });
      } else {
        updateDemoState(applyCurrency);
      }

      pushToast({
        tone: 'success',
        title: `Đã đổi tiền tệ cơ sở sang ${currency}`,
      });
    },
    [dataMode, executeLiveAction, pushToast, updateDemoState],
  );

  const setTimezone = useCallback(
    (tz: string) => {
      if (dataMode === 'live') {
        executeLiveAction({
          actionTitle: 'Cập nhật múi giờ',
          applyOptimistic: (prev) => ({ ...prev, timezone: tz }),
          apiCall: () => authApi.updatePreferences({ timezone: tz }),
        });
      } else {
        updateDemoState((prev) => ({ ...prev, timezone: tz }));
      }
      pushToast({ tone: 'success', title: `Đã cập nhật múi giờ: ${tz}` });
    },
    [dataMode, executeLiveAction, pushToast, updateDemoState],
  );

  const resetDemoData = useCallback(() => {
    const seed = createInitialSeed();
    persistDemo(seed);
    setDemoMfaEnabled(false);
    setDemoAttachments({});
    usedIdempotencyKeysRef.current.clear();
    pushToast({
      tone: 'info',
      title: 'Đã đặt lại dữ liệu về trạng thái mặc định',
    });
  }, [persistDemo, pushToast]);

  const commitBulkImportDemo = useCallback(
    (input: {
      accountId: string;
      rows: Array<{
        entryType: 'INCOME' | 'EXPENSE';
        transactionDate: string;
        amountMinor: number;
        categoryId?: string | null;
        description: string;
        note?: string | null;
      }>;
      idempotencyKey?: string;
    }): { ok: boolean; importedCount: number; error?: string } => {
      if (input.idempotencyKey && usedIdempotencyKeysRef.current.has(input.idempotencyKey)) {
        pushToast({
          tone: 'info',
          title: 'Yêu cầu nhập CSV đã được xử lý trước đó',
          description: 'Không ghi trùng các giao dịch vừa nhập.',
        });
        return { ok: true, importedCount: input.rows.length };
      }

      const account = demoState.accounts.find(
        (a) => a.id === input.accountId && a.archivedAt === null,
      );
      if (!account) {
        return { ok: false, importedCount: 0, error: 'Tài khoản đích không tồn tại hoặc đã lưu trữ.' };
      }
      if (input.rows.length === 0) {
        return { ok: false, importedCount: 0, error: 'Không có dòng hợp lệ nào được chọn để nhập.' };
      }

      const nowIso = new Date().toISOString();
      const newTxs: Transaction[] = input.rows.map((row, idx) => ({
        id: `tx-csv-${Date.now()}-${idx}-${Math.random().toString(16).slice(2, 6)}`,
        accountId: account.id,
        entryType: row.entryType,
        status: 'POSTED',
        amountMinor: row.amountMinor,
        currencyCode: account.currencyCode,
        transactionDate: row.transactionDate,
        description: row.description.trim() || 'Giao dịch nhập CSV',
        note: row.note?.trim() || undefined,
        categoryId: row.categoryId ?? undefined,
        createdAt: nowIso,
      }));

      if (input.idempotencyKey) {
        usedIdempotencyKeysRef.current.add(input.idempotencyKey);
      }

      updateDemoState((prev) => ({
        ...prev,
        transactions: [...newTxs, ...prev.transactions],
      }));

      pushToast({
        tone: 'success',
        title: `Đã nhập ${newTxs.length} giao dịch từ CSV`,
        description: `Đã ghi sổ vào tài khoản ${account.name} (${account.currencyCode}).`,
      });

      return { ok: true, importedCount: newTxs.length };
    },
    [demoState.accounts, pushToast, updateDemoState],
  );

  const value: PreviewContextValue = {
    state,
    dataMode,
    setDataMode,
    authUser,
    authChecked,
    isLiveSyncing,
    loginWithCredentials,
    updateAuthUserMfaEnabled,
    demoMfaEnabled,
    setDemoMfaEnabled,
    getDemoAttachments,
    addDemoAttachment,
    removeDemoAttachment,
    registerWithCredentials,
    logoutSession,
    refreshLiveData,
    activeAccounts,
    archivedAccounts,
    isLoadingSkeleton,
    toasts,
    dismissToast,
    pushToast,
    getAccountBalance,
    getAccountTxCount,
    getCategoryById,
    getAccountById,
    getRefundableRemaining,
    createTransaction,
    postTransaction,
    cancelDraftOptimistic,
    voidOrReverseTransaction,
    createExpenseRefund,
    createTransfer,
    voidTransfer,
    createAccount,
    updateAccount,
    archiveAccount,
    adjustAccountBalance,
    upsertBudget,
    createRecurringRule,
    updateRecurringRule,
    pauseRecurringRule,
    resumeRecurringRule,
    runDueRecurringRules,
    commitBulkImportDemo,
    setBaseCurrency,
    setTimezone,
    resetDemoData,
  };

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreviewStore() {
  const ctx = useContext(PreviewContext);
  if (!ctx) {
    throw new Error('usePreviewStore must be used inside PreviewStoreProvider');
  }
  return ctx;
}
