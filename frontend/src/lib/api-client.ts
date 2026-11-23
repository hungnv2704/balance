'use client';

import type { AccountType, CategoryKind, CurrencyCode, TransactionEntryType, TransactionStatus } from './types';

export interface ProblemFieldError {
  field: string;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  correlationId?: string;
  errors?: ProblemFieldError[];
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly correlationId?: string;
  public readonly errors: ProblemFieldError[];
  public readonly problem?: ProblemDetails;

  constructor(params: {
    status: number;
    code: string;
    title: string;
    detail: string;
    correlationId?: string;
    errors?: ProblemFieldError[];
    problem?: ProblemDetails;
  }) {
    super(params.detail || params.title);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.title = params.title;
    this.detail = params.detail;
    this.correlationId = params.correlationId;
    this.errors = params.errors ?? [];
    this.problem = params.problem;
  }

  public getFieldError(field: string): string | undefined {
    return this.errors.find((e) => e.field === field)?.message;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/**
 * Generates an RFC 4122 UUID v4 suitable for the `Idempotency-Key` header.
 */
export function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('Secure random UUID generator is unavailable in this environment.');
}

// --- Backend DTOs matching @pfm/shared-types ---

export type ApiCurrencyCode = CurrencyCode | 'KWD';

export interface ApiUserProfile {
  id: string;
  email: string;
  fullName: string;
  baseCurrencyCode: ApiCurrencyCode;
  timezone: string;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface ApiAccountWithBalance {
  id: string;
  name: string;
  accountType: AccountType;
  currencyCode: ApiCurrencyCode;
  openingBalanceMinor: string;
  openingBalanceDate: string;
  isDefault: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  postedBalanceMinor: string;
  pendingInMinor: string;
  pendingOutMinor: string;
  transactionCount: number;
}

export interface ApiAuthResponse {
  user: ApiUserProfile;
  defaultAccount?: ApiAccountWithBalance;
  accessToken: string;
  expiresInSeconds: number;
}

export interface ApiAuthMeResponse {
  user: ApiUserProfile;
  activeAccountCount: number;
}

export interface ApiCategory {
  id: string;
  kind: CategoryKind;
  name: string;
  parentId: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface ApiIncomeSource {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
}

export interface ApiMerchant {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
}

export interface ApiTransactionRecord {
  id: string;
  accountId: string;
  entryType: TransactionEntryType;
  status: TransactionStatus;
  amountMinor: string;
  currencyCode: ApiCurrencyCode;
  transactionDate: string;
  description: string | null;
  note: string | null;
  categoryId: string | null;
  incomeSourceId: string | null;
  merchantId: string | null;
  transferId: string | null;
  refundsTransactionId: string | null;
  reversesTransactionId: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  accountPostedBalanceMinor?: string;
  warnings?: string[];
}

export interface ApiTransferDetail {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  fromAmountMinor: string;
  fromCurrencyCode: ApiCurrencyCode;
  toAmountMinor: string;
  toCurrencyCode: ApiCurrencyCode;
  exchangeRate: string;
  rateSource: string;
  rateEffectiveAt: string;
  feeTransactionId: string | null;
  transferDate: string;
  note: string | null;
  status: 'POSTED' | 'VOIDED' | 'REVERSED';
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  fromTransaction?: ApiTransactionRecord | null;
  toTransaction?: ApiTransactionRecord | null;
  feeTransaction?: ApiTransactionRecord | null;
  fromAccountPostedBalanceMinor?: string;
  toAccountPostedBalanceMinor?: string;
}

export interface ApiBudget {
  id: string;
  categoryId: string;
  categoryName?: string;
  categoryKind: 'EXPENSE';
  limitMinor: string;
  currencyCode: ApiCurrencyCode;
  periodStart: string;
  periodEnd: string;
  archivedAt: string | null;
  createdAt: string;
  grossExpenseMinor: string;
  refundMinor: string;
  actualSpentMinor: string;
  remainingMinor: string;
  percentUsed: number;
  status: 'OK' | 'WARNING' | 'EXCEEDED';
}

export type ApiRecurringRuleKind = 'INCOME' | 'EXPENSE';
export type ApiRecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface ApiRecurringRule {
  id: string;
  ruleKind: ApiRecurringRuleKind;
  accountId: string;
  categoryId: string;
  amountMinor?: string;
  amount?: string;
  currencyCode: ApiCurrencyCode;
  frequency: ApiRecurringFrequency;
  intervalCount: number;
  nextRunDate: string;
  endDate: string | null;
  timezone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ApiRecurringListResponse {
  items: ApiRecurringRule[];
}

export interface ApiRecurringRunDueResponse {
  generatedCount?: number;
  createdCount?: number;
  count?: number;
  items?: ApiTransactionRecord[];
  transactions?: ApiTransactionRecord[];
}

export type ImportRowStatus = 'VALID' | 'DUPLICATE_SUSPECTED' | 'INVALID';

export interface ApiImportPreviewRow {
  rowIndex: number;
  status: ImportRowStatus;
  entryType?: 'INCOME' | 'EXPENSE' | null;
  transactionDate?: string | null;
  amountMinor?: string | null;
  currencyCode?: ApiCurrencyCode | null;
  categoryId?: string | null;
  categoryName?: string | null;
  description?: string | null;
  note?: string | null;
  duplicateReason?: string | null;
  matchedTransactionId?: string | null;
  errors?: string[];
  error?: string | null;
}

export interface ApiImportPreviewResponse {
  accountId: string;
  currencyCode?: ApiCurrencyCode;
  totalRows?: number;
  validCount?: number;
  duplicateCount?: number;
  invalidCount?: number;
  summary?: {
    totalRows?: number;
    validCount?: number;
    duplicateCount?: number;
    invalidCount?: number;
  };
  rows: ApiImportPreviewRow[];
}

export interface ApiImportCommitRow {
  rowIndex?: number;
  entryType: 'INCOME' | 'EXPENSE';
  transactionDate: string;
  amountMinor: string;
  categoryId?: string | null;
  description?: string | null;
  note?: string | null;
}

export interface ApiImportCommitResponse {
  accountId?: string;
  importedCount?: number;
  createdCount?: number;
  skippedCount?: number;
  transactions?: ApiTransactionRecord[];
}

export interface ApiCursorPaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ApiMfaStatusResponse {
  mfaEnabled: boolean;
  recoveryCodesRemaining?: number;
}

export interface ApiMfaSetupResponse {
  secret: string;
  otpauthUri: string;
}

export interface ApiMfaVerifyResponse {
  mfaEnabled: boolean;
  recoveryCodes: string[];
}

export interface ApiMfaDisableResponse {
  mfaEnabled: boolean;
}

export interface ApiAttachment {
  id: string;
  transactionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

// --- Core Fetch Wrapper ---

export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'credentials'> {
  body?: unknown;
  idempotencyKey?: string;
  idempotent?: boolean;
  skipAuthRefresh?: boolean;
  suppressUnauthorizedHandler?: boolean;
  query?: Record<string, string | number | boolean | undefined | null>;
}

const AUTH_NO_REFRESH_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
]);

let refreshInFlight: Promise<boolean> | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setOnUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function buildUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!query) return normalizedPath;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${normalizedPath}?${qs}` : normalizedPath;
}

async function parseProblemError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get('content-type') ?? '';
  const isJsonLike =
    contentType.includes('application/problem+json') ||
    contentType.includes('application/json');

  if (isJsonLike) {
    try {
      const payload = (await response.json()) as Partial<ProblemDetails> & {
        message?: string | string[];
      };

      const title =
        typeof payload.title === 'string' && payload.title.trim()
          ? payload.title
          : response.statusText || 'Lỗi yêu cầu';

      const detail =
        typeof payload.detail === 'string' && payload.detail.trim()
          ? payload.detail
          : typeof payload.message === 'string'
            ? payload.message
            : Array.isArray(payload.message)
              ? payload.message.join('; ')
              : `Yêu cầu thất bại với mã HTTP ${response.status}.`;

      const code =
        typeof payload.code === 'string' && payload.code.trim()
          ? payload.code
          : `HTTP_${response.status}`;

      const errors: ProblemFieldError[] = Array.isArray(payload.errors)
        ? payload.errors.filter(
            (e): e is ProblemFieldError =>
              Boolean(e) && typeof e.field === 'string' && typeof e.message === 'string',
          )
        : [];

      const problem: ProblemDetails | undefined =
        typeof payload.type === 'string' && typeof payload.status === 'number'
          ? {
              type: payload.type,
              title,
              status: payload.status,
              detail,
              instance: payload.instance ?? '',
              code,
              correlationId: payload.correlationId,
              errors: errors.length > 0 ? errors : undefined,
            }
          : undefined;

      return new ApiError({
        status: response.status,
        code,
        title,
        detail,
        correlationId: payload.correlationId,
        errors,
        problem,
      });
    } catch {
      // Fallback below when JSON body is malformed
    }
  }

  let textDetail = '';
  try {
    textDetail = (await response.text()).trim();
  } catch {
    // Ignore body read failures
  }

  if (response.status >= 502 && response.status <= 504) {
    return new ApiError({
      status: response.status,
      code: 'BACKEND_UNAVAILABLE',
      title: 'Không kết nối được máy chủ API',
      detail:
        'Máy chủ tạm thời không phản hồi. Vui lòng thử lại sau ít phút.',
    });
  }

  return new ApiError({
    status: response.status,
    code: `HTTP_${response.status}`,
    title: response.statusText || 'Lỗi máy chủ',
    detail: textDetail || `Máy chủ trả về mã lỗi HTTP ${response.status}.`,
  });
}

async function refreshAccessSession(): Promise<boolean> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, application/problem+json',
        },
        body: JSON.stringify({}),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    body,
    idempotencyKey,
    idempotent,
    skipAuthRefresh,
    suppressUnauthorizedHandler,
    query,
    headers: customHeaders,
    method = 'GET',
    ...restInit
  } = options;

  const url = buildUrl(path, query);
  const pathWithoutQuery = url.split('?')[0] ?? url;

  const headers = new Headers(customHeaders);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json, application/problem+json');
  }

  let serializedBody: BodyInit | undefined;
  if (body !== undefined) {
    if (
      typeof body === 'string' ||
      body instanceof FormData ||
      body instanceof Blob ||
      body instanceof URLSearchParams
    ) {
      serializedBody = body;
    } else {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      serializedBody = JSON.stringify(body);
    }
  }

  const effectiveIdempotencyKey =
    idempotencyKey ?? (idempotent ? generateUuidV4() : undefined);
  if (effectiveIdempotencyKey && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', effectiveIdempotencyKey);
  }

  const executeFetch = async (): Promise<Response> => {
    try {
      return await fetch(url, {
        ...restInit,
        method,
        headers,
        body: serializedBody,
        credentials: 'include',
      });
    } catch {
      throw new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        title: 'Lỗi kết nối mạng',
        detail:
          'Không thể kết nối tới API (/api/v1). Kiểm tra kết nối mạng hoặc trạng thái máy chủ.',
      });
    }
  };

  let response = await executeFetch();

  const canAttemptRefresh =
    response.status === 401 &&
    !skipAuthRefresh &&
    !AUTH_NO_REFRESH_PATHS.has(pathWithoutQuery);

  if (canAttemptRefresh) {
    const refreshed = await refreshAccessSession();
    if (refreshed) {
      response = await executeFetch();
    } else {
      if (!suppressUnauthorizedHandler) {
        unauthorizedHandler?.();
      }
      throw await parseProblemError(response);
    }
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      !suppressUnauthorizedHandler &&
      !AUTH_NO_REFRESH_PATHS.has(pathWithoutQuery)
    ) {
      unauthorizedHandler?.();
    }
    throw await parseProblemError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as unknown as T;
}

// --- Typed Resource API Helpers ---

export const authApi = {
  register(payload: {
    email: string;
    password: string;
    fullName: string;
    baseCurrencyCode?: ApiCurrencyCode;
    timezone?: string;
  }): Promise<ApiAuthResponse> {
    return apiRequest<ApiAuthResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: payload,
      skipAuthRefresh: true,
    });
  },

  login(payload: { email: string; password: string; mfaCode?: string }): Promise<ApiAuthResponse> {
    return apiRequest<ApiAuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: payload,
      skipAuthRefresh: true,
    });
  },

  refresh(): Promise<ApiAuthResponse> {
    return apiRequest<ApiAuthResponse>('/api/v1/auth/refresh', {
      method: 'POST',
      body: {},
      skipAuthRefresh: true,
    });
  },

  logout(): Promise<void> {
    return apiRequest<void>('/api/v1/auth/logout', {
      method: 'POST',
      body: {},
      skipAuthRefresh: true,
    });
  },

  logoutAll(): Promise<void> {
    return apiRequest<void>('/api/v1/auth/logout-all', {
      method: 'POST',
      body: {},
    });
  },

  me(options?: {
    skipAuthRefresh?: boolean;
    suppressUnauthorizedHandler?: boolean;
  }): Promise<ApiAuthMeResponse> {
    return apiRequest<ApiAuthMeResponse>('/api/v1/auth/me', {
      method: 'GET',
      skipAuthRefresh: options?.skipAuthRefresh,
      suppressUnauthorizedHandler: options?.suppressUnauthorizedHandler,
    });
  },

  updatePreferences(payload: {
    baseCurrencyCode?: ApiCurrencyCode;
    timezone?: string;
  }): Promise<ApiUserProfile> {
    return apiRequest<ApiUserProfile>('/api/v1/auth/preferences', {
      method: 'PATCH',
      body: payload,
    });
  },
};

export const accountsApi = {
  list(includeArchived = true): Promise<ApiAccountWithBalance[]> {
    return apiRequest<ApiAccountWithBalance[]>('/api/v1/accounts', {
      query: { includeArchived },
    });
  },

  create(payload: {
    name: string;
    accountType: AccountType;
    currencyCode: ApiCurrencyCode;
    openingBalanceMinor: string;
    openingBalanceDate: string;
  }): Promise<ApiAccountWithBalance> {
    return apiRequest<ApiAccountWithBalance>('/api/v1/accounts', {
      method: 'POST',
      body: payload,
    });
  },

  update(
    accountId: string,
    payload: {
      name?: string;
      accountType?: AccountType;
      currencyCode?: ApiCurrencyCode;
    },
  ): Promise<ApiAccountWithBalance> {
    return apiRequest<ApiAccountWithBalance>(`/api/v1/accounts/${accountId}`, {
      method: 'PATCH',
      body: payload,
    });
  },

  archive(accountId: string): Promise<ApiAccountWithBalance> {
    return apiRequest<ApiAccountWithBalance>(`/api/v1/accounts/${accountId}/archive`, {
      method: 'POST',
      body: {},
    });
  },

  createAdjustment(
    accountId: string,
    payload: {
      actualBalanceMinor: string;
      transactionDate?: string;
      description?: string;
      note?: string;
    },
    idempotencyKey?: string,
  ): Promise<{ transaction: ApiTransactionRecord; postedBalanceMinor: string }> {
    return apiRequest(`/api/v1/accounts/${accountId}/adjustments`, {
      method: 'POST',
      body: payload,
      idempotencyKey,
      idempotent: true,
    });
  },
};

export const categoriesApi = {
  list(includeArchived = true): Promise<ApiCategory[]> {
    return apiRequest<ApiCategory[]>('/api/v1/categories', {
      query: { includeArchived },
    });
  },
};

export const incomeApi = {
  list(limit = 100): Promise<ApiCursorPaginatedResponse<ApiTransactionRecord>> {
    return apiRequest('/api/v1/incomes', { query: { limit } });
  },

  listSources(): Promise<ApiIncomeSource[]> {
    return apiRequest<ApiIncomeSource[]>('/api/v1/income-sources');
  },

  create(
    payload: {
      accountId?: string;
      categoryId: string;
      incomeSourceId?: string;
      amountMinor: string;
      currencyCode?: ApiCurrencyCode;
      transactionDate?: string;
      status?: 'DRAFT' | 'PENDING' | 'POSTED';
      description?: string;
      note?: string;
    },
    idempotencyKey?: string,
  ): Promise<ApiTransactionRecord> {
    return apiRequest<ApiTransactionRecord>('/api/v1/incomes', {
      method: 'POST',
      body: payload,
      idempotencyKey,
      idempotent: true,
    });
  },

  post(incomeId: string, idempotencyKey?: string): Promise<ApiTransactionRecord> {
    return apiRequest<ApiTransactionRecord>(`/api/v1/incomes/${incomeId}/post`, {
      method: 'POST',
      body: {},
      idempotencyKey,
      idempotent: true,
    });
  },

  void(
    incomeId: string,
    reasonCode?: string,
    idempotencyKey?: string,
  ): Promise<ApiTransactionRecord> {
    return apiRequest<ApiTransactionRecord>(`/api/v1/incomes/${incomeId}/void`, {
      method: 'POST',
      body: reasonCode ? { reasonCode } : {},
      idempotencyKey,
      idempotent: true,
    });
  },

  reverse(
    incomeId: string,
    reasonCode?: string,
    idempotencyKey?: string,
  ): Promise<ApiTransactionRecord> {
    return apiRequest<ApiTransactionRecord>(`/api/v1/incomes/${incomeId}/reverse`, {
      method: 'POST',
      body: reasonCode ? { reasonCode } : {},
      idempotencyKey,
      idempotent: true,
    });
  },
};

export const expenseApi = {
  list(limit = 100): Promise<ApiCursorPaginatedResponse<ApiTransactionRecord>> {
    return apiRequest('/api/v1/expenses', { query: { limit } });
  },

  listMerchants(): Promise<ApiMerchant[]> {
    return apiRequest<ApiMerchant[]>('/api/v1/merchants');
  },

  create(
    payload: {
      accountId?: string;
      categoryId: string;
      merchantId?: string;
      amountMinor: string;
      currencyCode?: ApiCurrencyCode;
      transactionDate?: string;
      status?: 'DRAFT' | 'PENDING' | 'POSTED';
      description?: string;
      note?: string;
    },
    idempotencyKey?: string,
  ): Promise<ApiTransactionRecord> {
    return apiRequest<ApiTransactionRecord>('/api/v1/expenses', {
      method: 'POST',
      body: payload,
      idempotencyKey,
      idempotent: true,
    });
  },

  post(expenseId: string, idempotencyKey?: string): Promise<ApiTransactionRecord> {
    return apiRequest<ApiTransactionRecord>(`/api/v1/expenses/${expenseId}/post`, {
      method: 'POST',
      body: {},
      idempotencyKey,
      idempotent: true,
    });
  },

  void(
    expenseId: string,
    reasonCode?: string,
    idempotencyKey?: string,
  ): Promise<ApiTransactionRecord> {
    return apiRequest<ApiTransactionRecord>(`/api/v1/expenses/${expenseId}/void`, {
      method: 'POST',
      body: reasonCode ? { reasonCode } : {},
      idempotencyKey,
      idempotent: true,
    });
  },

  reverse(
    expenseId: string,
    reasonCode?: string,
    idempotencyKey?: string,
  ): Promise<ApiTransactionRecord> {
    return apiRequest<ApiTransactionRecord>(`/api/v1/expenses/${expenseId}/reverse`, {
      method: 'POST',
      body: reasonCode ? { reasonCode } : {},
      idempotencyKey,
      idempotent: true,
    });
  },

  createRefund(
    expenseId: string,
    payload: {
      accountId?: string;
      amountMinor: string;
      transactionDate?: string;
      note?: string;
    },
    idempotencyKey?: string,
  ): Promise<ApiTransactionRecord> {
    return apiRequest<ApiTransactionRecord>(`/api/v1/expenses/${expenseId}/refunds`, {
      method: 'POST',
      body: payload,
      idempotencyKey,
      idempotent: true,
    });
  },
};

export const transfersApi = {
  list(limit = 100): Promise<ApiCursorPaginatedResponse<ApiTransferDetail>> {
    return apiRequest('/api/v1/transfers', { query: { limit } });
  },

  create(
    payload: {
      fromAccountId: string;
      toAccountId: string;
      fromAmountMinor: string;
      toAmountMinor?: string;
      exchangeRate?: string;
      feeMinor?: string;
      transferDate?: string;
      note?: string;
    },
    idempotencyKey?: string,
  ): Promise<ApiTransferDetail> {
    return apiRequest<ApiTransferDetail>('/api/v1/transfers', {
      method: 'POST',
      body: payload,
      idempotencyKey,
      idempotent: true,
    });
  },

  void(
    transferId: string,
    reasonCode?: string,
    idempotencyKey?: string,
  ): Promise<ApiTransferDetail> {
    return apiRequest<ApiTransferDetail>(`/api/v1/transfers/${transferId}/void`, {
      method: 'POST',
      body: reasonCode ? { reasonCode } : {},
      idempotencyKey,
      idempotent: true,
    });
  },
};

export const budgetsApi = {
  list(includeArchived = false): Promise<ApiBudget[]> {
    return apiRequest<ApiBudget[]>('/api/v1/budgets', {
      query: { includeArchived },
    });
  },

  create(payload: {
    categoryId: string;
    currencyCode: ApiCurrencyCode;
    month: string;
    limitMinor: string;
  }): Promise<ApiBudget> {
    return apiRequest<ApiBudget>('/api/v1/budgets', {
      method: 'POST',
      body: payload,
    });
  },

  update(
    budgetId: string,
    payload: { limitMinor: string },
  ): Promise<ApiBudget> {
    return apiRequest<ApiBudget>(`/api/v1/budgets/${budgetId}`, {
      method: 'PATCH',
      body: payload,
    });
  },
};

export const recurringApi = {
  list(): Promise<ApiRecurringListResponse> {
    return apiRequest<ApiRecurringListResponse>('/api/v1/recurring-rules');
  },

  create(
    payload: {
      ruleKind: ApiRecurringRuleKind;
      accountId?: string;
      categoryId: string;
      amount: string;
      frequency: ApiRecurringFrequency;
      intervalCount: number;
      nextRunDate: string;
      endDate?: string;
    },
    idempotencyKey?: string,
  ): Promise<ApiRecurringRule> {
    return apiRequest<ApiRecurringRule>('/api/v1/recurring-rules', {
      method: 'POST',
      body: payload,
      idempotencyKey,
      idempotent: true,
    });
  },

  update(
    ruleId: string,
    payload: {
      accountId?: string;
      categoryId?: string;
      amount?: string;
      frequency?: ApiRecurringFrequency;
      intervalCount?: number;
      nextRunDate?: string;
      endDate?: string | null;
    },
  ): Promise<ApiRecurringRule> {
    return apiRequest<ApiRecurringRule>(`/api/v1/recurring-rules/${ruleId}`, {
      method: 'PATCH',
      body: payload,
    });
  },

  pause(ruleId: string, idempotencyKey?: string): Promise<ApiRecurringRule> {
    return apiRequest<ApiRecurringRule>(`/api/v1/recurring-rules/${ruleId}/pause`, {
      method: 'POST',
      body: {},
      idempotencyKey,
      idempotent: true,
    });
  },

  resume(ruleId: string, idempotencyKey?: string): Promise<ApiRecurringRule> {
    return apiRequest<ApiRecurringRule>(`/api/v1/recurring-rules/${ruleId}/resume`, {
      method: 'POST',
      body: {},
      idempotencyKey,
      idempotent: true,
    });
  },

  runDue(idempotencyKey?: string): Promise<ApiRecurringRunDueResponse> {
    return apiRequest<ApiRecurringRunDueResponse>('/api/v1/recurring-rules/run-due', {
      method: 'POST',
      body: {},
      idempotencyKey,
      idempotent: true,
    });
  },
};

export const importsApi = {
  preview(payload: {
    accountId?: string;
    csvContent: string;
  }): Promise<ApiImportPreviewResponse> {
    return apiRequest<ApiImportPreviewResponse>('/api/v1/imports/preview', {
      method: 'POST',
      body: payload,
    });
  },

  commit(
    payload: {
      accountId?: string;
      rows: ApiImportCommitRow[];
    },
    idempotencyKey?: string,
  ): Promise<ApiImportCommitResponse> {
    return apiRequest<ApiImportCommitResponse>('/api/v1/imports/commit', {
      method: 'POST',
      body: payload,
      idempotencyKey,
      idempotent: true,
    });
  },
};

export const mfaApi = {
  async status(): Promise<ApiMfaStatusResponse> {
    const raw = await apiRequest<{
      enabled?: boolean;
      mfaEnabled?: boolean;
      remainingRecoveryCodes?: number;
      recoveryCodesRemaining?: number;
    }>('/api/v1/auth/mfa/status', {
      method: 'GET',
    });
    return {
      mfaEnabled: Boolean(raw.enabled ?? raw.mfaEnabled),
      recoveryCodesRemaining: raw.remainingRecoveryCodes ?? raw.recoveryCodesRemaining,
    };
  },

  async setup(): Promise<ApiMfaSetupResponse> {
    const raw = await apiRequest<{
      secretBase32?: string;
      secret?: string;
      otpauthUri: string;
    }>('/api/v1/auth/mfa/setup', {
      method: 'POST',
      body: {},
    });
    return {
      secret: raw.secretBase32 ?? raw.secret ?? '',
      otpauthUri: raw.otpauthUri,
    };
  },

  async verify(code: string): Promise<ApiMfaVerifyResponse> {
    const raw = await apiRequest<{
      enabled?: boolean;
      mfaEnabled?: boolean;
      recoveryCodes: string[];
    }>('/api/v1/auth/mfa/verify', {
      method: 'POST',
      body: { code },
      suppressUnauthorizedHandler: true,
    });
    return {
      mfaEnabled: Boolean(raw.enabled ?? raw.mfaEnabled ?? true),
      recoveryCodes: raw.recoveryCodes ?? [],
    };
  },

  async disable(password: string, code: string): Promise<ApiMfaDisableResponse> {
    const raw = await apiRequest<{
      enabled?: boolean;
      mfaEnabled?: boolean;
    }>('/api/v1/auth/mfa/disable', {
      method: 'POST',
      body: { password, code },
      suppressUnauthorizedHandler: true,
    });
    return {
      mfaEnabled: Boolean(raw.enabled ?? raw.mfaEnabled ?? false),
    };
  },
};

interface RawApiAttachment {
  id: string;
  transactionId: string;
  originalFilename?: string;
  filename?: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

function normalizeApiAttachment(raw: RawApiAttachment): ApiAttachment {
  return {
    id: raw.id,
    transactionId: raw.transactionId,
    filename: raw.originalFilename ?? raw.filename ?? 'attachment',
    mimeType: raw.mimeType,
    sizeBytes: raw.sizeBytes,
    createdAt: raw.createdAt,
  };
}

export const attachmentsApi = {
  async list(transactionId: string): Promise<ApiAttachment[]> {
    const res = await apiRequest<RawApiAttachment[] | { items: RawApiAttachment[] }>(
      `/api/v1/transactions/${transactionId}/attachments`,
      { method: 'GET' },
    );
    const items = Array.isArray(res) ? res : (res?.items ?? []);
    return items.map(normalizeApiAttachment);
  },

  async upload(
    transactionId: string,
    payload: { filename: string; contentBase64: string },
  ): Promise<ApiAttachment> {
    const raw = await apiRequest<RawApiAttachment>(
      `/api/v1/transactions/${transactionId}/attachments`,
      {
        method: 'POST',
        body: payload,
      },
    );
    return normalizeApiAttachment(raw);
  },

  downloadUrl(attachmentId: string): string {
    return `/api/v1/attachments/${attachmentId}/download`;
  },

  remove(attachmentId: string): Promise<void> {
    return apiRequest<void>(`/api/v1/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
  },
};
