import { randomUUID } from 'node:crypto';
import {
  CategoryKind,
  EntryType,
  SupportedCurrencyCode,
  TransactionStatus,
  TransferStatus,
} from '@pfm/shared-types';
import { AppConfig } from '../../src/config/app-config';
import {
  DatabaseExecutor,
  DbQueryClient,
  DbTransactionClient,
  QueryResultLike,
} from '../../src/database/database.types';
import {
  AccountsRepository,
  CreateAccountInput,
  UpdateAccountInput,
} from '../../src/modules/accounts/accounts.repository';
import { AccountEntity } from '../../src/modules/accounts/accounts.types';
import { AuditLogInput, AuditRepository } from '../../src/modules/audit/audit.repository';
import {
  AttachmentsRepository,
  CreateAttachmentInput,
} from '../../src/modules/attachments/attachments.repository';
import { TransactionAttachmentEntity } from '../../src/modules/attachments/attachments.types';
import {
  ActiveSessionAuthContext,
  AuthRepository,
  CreateSessionInput,
  CreateUserInput,
} from '../../src/modules/auth/auth.repository';
import { UserEntity, UserSessionEntity } from '../../src/modules/auth/auth.types';
import { MfaRepository } from '../../src/modules/mfa/mfa.repository';
import { UserMfaEntity, UserMfaRecoveryCodeEntity } from '../../src/modules/mfa/mfa.types';
import {
  BudgetDailyExpenseEntry,
  BudgetsRepository,
  CreateBudgetInput,
  ListBudgetsFilter,
  UpdateBudgetInput,
} from '../../src/modules/budgets/budgets.repository';
import { BudgetEntity } from '../../src/modules/budgets/budgets.types';
import { CategoriesRepository } from '../../src/modules/categories/categories.repository';
import { CategoryEntity } from '../../src/modules/categories/categories.types';
import {
  IncomeSourceEntity,
  IncomeSourcesRepository,
} from '../../src/modules/income/income-sources.repository';
import {
  MerchantEntity,
  MerchantsRepository,
} from '../../src/modules/expense/merchants.repository';
import { ActiveDuplicateCandidate, LedgerRepository } from '../../src/modules/ledger/ledger.repository';
import {
  CreateLedgerTransactionInput,
  CreateRecurringDraftTransactionInput,
  LedgerTransactionEntity,
  ListTransactionsFilter,
  UpdateEditableTransactionInput,
} from '../../src/modules/ledger/ledger.types';
import {
  CreateRecurringRuleInput,
  ListRecurringRulesFilter,
  RecurringRepository,
  UpdateRecurringRuleInput,
} from '../../src/modules/recurring/recurring.repository';
import { RecurringRuleEntity } from '../../src/modules/recurring/recurring.types';
import {
  CashFlowAggregateRow,
  CashFlowQueryParams,
  ReportingRepository,
} from '../../src/modules/reporting/reporting.repository';
import {
  CreateTransferInput,
  ListTransfersFilter,
  TransfersRepository,
} from '../../src/modules/transfers/transfers.repository';
import { TransferEntity } from '../../src/modules/transfers/transfers.types';
import { LedgerBalanceEntry } from '../../src/shared-kernel/domain/posted-balance';
import {
  AcquireIdempotencyParams,
  AcquireIdempotencyResult,
  IdempotencyRecord,
  IdempotencyRepository,
} from '../../src/shared-kernel/idempotency/idempotency.types';
import { sanitizeForLog } from '../../src/shared-kernel/logging/redacted-logger';

export const TEST_APP_CONFIG: AppConfig = {
  nodeEnv: 'test',
  port: 3001,
  corsOrigins: ['http://localhost:3000'],
  databaseUrl: 'postgresql://unused-in-memory-unit-test',
  pgPoolMax: 2,
  jwtAccessSecret: 'test-only-access-secret-minimum-32-bytes-long',
  jwtAccessTtlSeconds: 900,
  refreshTokenTtlDays: 30,
  mfaEncryptionKey: 'test-only-mfa-encryption-secret-32-bytes',
  cookieSecure: false,
  cookieSameSite: 'lax',
  // Low cost only for fast unit-test execution
  argon2MemoryKib: 64,
  argon2Iterations: 1,
  argon2Parallelism: 1,
  rateLimitAuthMax: 10,
  rateLimitAuthWindowSeconds: 60,
  rateLimitExportMax: 5,
  rateLimitExportWindowSeconds: 3600,
};

interface StoreState {
  users: Map<string, UserEntity>;
  sessions: Map<string, UserSessionEntity>;
  userMfa: Map<string, UserMfaEntity>;
  userMfaRecoveryCodes: Map<string, UserMfaRecoveryCodeEntity>;
  accounts: Map<string, AccountEntity>;
  categories: Map<string, CategoryEntity>;
  incomeSources: Map<string, IncomeSourceEntity>;
  merchants: Map<string, MerchantEntity>;
  transfers: Map<string, TransferEntity>;
  transactions: Map<string, LedgerTransactionEntity>;
  transactionAttachments: Map<string, TransactionAttachmentEntity>;
  budgets: Map<string, BudgetEntity>;
  recurringRules: Map<string, RecurringRuleEntity>;
  idempotencyKeys: Map<string, IdempotencyRecord>;
  auditLogs: Array<{ id: string; input: AuditLogInput; metadata: unknown }>;
}

function cloneState(s: StoreState): StoreState {
  return {
    users: new Map(s.users),
    sessions: new Map(s.sessions),
    userMfa: new Map(s.userMfa),
    userMfaRecoveryCodes: new Map(s.userMfaRecoveryCodes),
    accounts: new Map(s.accounts),
    categories: new Map(s.categories),
    incomeSources: new Map(s.incomeSources),
    merchants: new Map(s.merchants),
    transfers: new Map(s.transfers),
    transactions: new Map(s.transactions),
    transactionAttachments: new Map(s.transactionAttachments),
    budgets: new Map(s.budgets),
    recurringRules: new Map(s.recurringRules),
    idempotencyKeys: new Map(s.idempotencyKeys),
    auditLogs: [...s.auditLogs],
  };
}

export class InMemoryDatabase implements DatabaseExecutor {
  public state: StoreState = {
    users: new Map(),
    sessions: new Map(),
    userMfa: new Map(),
    userMfaRecoveryCodes: new Map(),
    accounts: new Map(),
    categories: new Map(),
    incomeSources: new Map(),
    merchants: new Map(),
    transfers: new Map(),
    transactions: new Map(),
    transactionAttachments: new Map(),
    budgets: new Map(),
    recurringRules: new Map(),
    idempotencyKeys: new Map(),
    auditLogs: [],
  };

  public async query<R = Record<string, unknown>>(): Promise<QueryResultLike<R>> {
    return { rows: [], rowCount: 0 };
  }

  public async withTransaction<T>(fn: (tx: DbTransactionClient) => Promise<T>): Promise<T> {
    const snapshot = cloneState(this.state);
    const txClient: DbTransactionClient = {
      isTransaction: true,
      query: this.query.bind(this),
    };
    try {
      return await fn(txClient);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }
}

export class InMemoryAuthRepository implements AuthRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async findUserByEmail(_db: DbQueryClient, email: string): Promise<UserEntity | null> {
    const lower = email.toLowerCase();
    for (const user of this.db.state.users.values()) {
      if (user.email.toLowerCase() === lower) {
        return user;
      }
    }
    return null;
  }

  public async findUserById(_db: DbQueryClient, userId: string): Promise<UserEntity | null> {
    return this.db.state.users.get(userId) ?? null;
  }

  public async createUser(_tx: DbTransactionClient, input: CreateUserInput): Promise<UserEntity> {
    const now = new Date();
    const user: UserEntity = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      baseCurrencyCode: input.baseCurrencyCode,
      timezone: input.timezone,
      mfaEnabled: false,
      deletionScheduledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.state.users.set(user.id, user);
    return user;
  }

  public async updateUserPreferences(
    _tx: DbTransactionClient,
    userId: string,
    updates: { baseCurrencyCode?: SupportedCurrencyCode; timezone?: string },
  ): Promise<UserEntity> {
    const existing = this.db.state.users.get(userId)!;
    const updated: UserEntity = {
      ...existing,
      baseCurrencyCode: updates.baseCurrencyCode ?? existing.baseCurrencyCode,
      timezone: updates.timezone ?? existing.timezone,
      updatedAt: new Date(),
    };
    this.db.state.users.set(userId, updated);
    return updated;
  }

  public async scheduleDeletion(
    _tx: DbTransactionClient,
    userId: string,
    deletionScheduledAt: Date,
  ): Promise<UserEntity> {
    const existing = this.db.state.users.get(userId)!;
    const updated: UserEntity = {
      ...existing,
      deletionScheduledAt,
      updatedAt: new Date(),
    };
    this.db.state.users.set(userId, updated);
    return updated;
  }

  public async setMfaEnabled(
    _tx: DbTransactionClient,
    userId: string,
    enabled: boolean,
  ): Promise<void> {
    const existing = this.db.state.users.get(userId);
    if (!existing) {
      return;
    }
    this.db.state.users.set(userId, {
      ...existing,
      mfaEnabled: enabled,
      updatedAt: new Date(),
    });
  }

  public async createSession(
    _tx: DbTransactionClient,
    input: CreateSessionInput,
  ): Promise<UserSessionEntity> {
    const session: UserSessionEntity = {
      id: randomUUID(),
      userId: input.userId,
      tokenFamilyId: input.tokenFamilyId,
      refreshTokenHash: input.refreshTokenHash,
      userAgentHash: input.userAgentHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.db.state.sessions.set(session.id, session);
    return session;
  }

  public async findSessionByTokenHash(
    _db: DbQueryClient,
    refreshTokenHash: string,
  ): Promise<UserSessionEntity | null> {
    for (const s of this.db.state.sessions.values()) {
      if (s.refreshTokenHash === refreshTokenHash) {
        return s;
      }
    }
    return null;
  }

  public async findActiveSessionForAuth(
    _db: DbQueryClient,
    sessionId: string,
    userId: string,
  ): Promise<ActiveSessionAuthContext | null> {
    const session = this.db.state.sessions.get(sessionId);
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }

    const user = this.db.state.users.get(userId);
    if (!user || user.deletionScheduledAt !== null) {
      return null;
    }

    return {
      sessionId: session.id,
      userId: user.id,
      tokenFamilyId: session.tokenFamilyId,
      timezone: user.timezone,
      baseCurrencyCode: user.baseCurrencyCode,
    };
  }

  public async revokeSession(_tx: DbTransactionClient, sessionId: string): Promise<void> {
    const s = this.db.state.sessions.get(sessionId);
    if (s && s.revokedAt === null) {
      this.db.state.sessions.set(sessionId, { ...s, revokedAt: new Date() });
    }
  }

  public async revokeSessionByTokenHash(
    _db: DbQueryClient,
    refreshTokenHash: string,
  ): Promise<void> {
    for (const [id, s] of this.db.state.sessions.entries()) {
      if (s.refreshTokenHash === refreshTokenHash && s.revokedAt === null) {
        this.db.state.sessions.set(id, { ...s, revokedAt: new Date() });
      }
    }
  }

  public async revokeTokenFamily(_tx: DbTransactionClient, tokenFamilyId: string): Promise<void> {
    for (const [id, s] of this.db.state.sessions.entries()) {
      if (s.tokenFamilyId === tokenFamilyId && s.revokedAt === null) {
        this.db.state.sessions.set(id, { ...s, revokedAt: new Date() });
      }
    }
  }

  public async revokeAllUserSessions(_tx: DbTransactionClient, userId: string): Promise<void> {
    for (const [id, s] of this.db.state.sessions.entries()) {
      if (s.userId === userId && s.revokedAt === null) {
        this.db.state.sessions.set(id, { ...s, revokedAt: new Date() });
      }
    }
  }
}

export class InMemoryAccountsRepository implements AccountsRepository {
  public lockedIdBatches: string[][] = [];

  constructor(private readonly db: InMemoryDatabase) {}

  public async findById(
    _db: DbQueryClient,
    userId: string,
    accountId: string,
  ): Promise<AccountEntity | null> {
    const acc = this.db.state.accounts.get(accountId);
    return acc && acc.userId === userId ? acc : null;
  }

  public async findManyByIdsForUpdate(
    _tx: DbTransactionClient,
    userId: string,
    accountIds: ReadonlyArray<string>,
  ): Promise<AccountEntity[]> {
    const sortedIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b));
    this.lockedIdBatches.push(sortedIds);
    const results: AccountEntity[] = [];
    for (const id of sortedIds) {
      const acc = this.db.state.accounts.get(id);
      if (acc && acc.userId === userId) {
        results.push(acc);
      }
    }
    return results;
  }

  public async findAllByUser(
    _db: DbQueryClient,
    userId: string,
    includeArchived: boolean,
  ): Promise<AccountEntity[]> {
    return Array.from(this.db.state.accounts.values()).filter(
      (a) => a.userId === userId && (includeArchived || a.archivedAt === null),
    );
  }

  public async findActiveByUserForUpdate(
    _tx: DbTransactionClient,
    userId: string,
  ): Promise<AccountEntity[]> {
    return Array.from(this.db.state.accounts.values())
      .filter((a) => a.userId === userId && a.archivedAt === null)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  public async findDefaultActiveByUser(
    _db: DbQueryClient,
    userId: string,
  ): Promise<AccountEntity | null> {
    for (const acc of this.db.state.accounts.values()) {
      if (acc.userId === userId && acc.isDefault && acc.archivedAt === null) {
        return acc;
      }
    }
    return null;
  }

  public async countActiveByUser(_db: DbQueryClient, userId: string): Promise<number> {
    return Array.from(this.db.state.accounts.values()).filter(
      (a) => a.userId === userId && a.archivedAt === null,
    ).length;
  }

  public async create(_tx: DbTransactionClient, input: CreateAccountInput): Promise<AccountEntity> {
    const now = new Date();
    const acc: AccountEntity = {
      id: randomUUID(),
      userId: input.userId,
      name: input.name,
      accountType: input.accountType,
      currencyCode: input.currencyCode,
      openingBalanceMinor: input.openingBalanceMinor,
      openingBalanceDate: input.openingBalanceDate,
      isDefault: input.isDefault,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.state.accounts.set(acc.id, acc);
    return acc;
  }

  public async clearDefaultForUser(_tx: DbTransactionClient, userId: string): Promise<void> {
    for (const [id, acc] of this.db.state.accounts.entries()) {
      if (acc.userId === userId && acc.isDefault && acc.archivedAt === null) {
        this.db.state.accounts.set(id, { ...acc, isDefault: false, updatedAt: new Date() });
      }
    }
  }

  public async update(
    _tx: DbTransactionClient,
    userId: string,
    accountId: string,
    updates: UpdateAccountInput,
  ): Promise<AccountEntity> {
    const existing = this.db.state.accounts.get(accountId)!;
    if (existing.userId !== userId) {
      throw new Error('Cross-tenant update forbidden');
    }
    const updated: AccountEntity = {
      ...existing,
      name: updates.name ?? existing.name,
      accountType: updates.accountType ?? existing.accountType,
      currencyCode: updates.currencyCode ?? existing.currencyCode,
      isDefault: updates.isDefault ?? existing.isDefault,
      updatedAt: new Date(),
    };
    this.db.state.accounts.set(accountId, updated);
    return updated;
  }

  public async archive(
    _tx: DbTransactionClient,
    userId: string,
    accountId: string,
  ): Promise<AccountEntity> {
    const existing = this.db.state.accounts.get(accountId)!;
    if (existing.userId !== userId) {
      throw new Error('Cross-tenant archive forbidden');
    }
    const updated: AccountEntity = {
      ...existing,
      archivedAt: new Date(),
      isDefault: false,
      updatedAt: new Date(),
    };
    this.db.state.accounts.set(accountId, updated);
    return updated;
  }
}

export class InMemoryCategoriesRepository implements CategoriesRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async findById(
    _db: DbQueryClient,
    userId: string,
    categoryId: string,
  ): Promise<CategoryEntity | null> {
    const cat = this.db.state.categories.get(categoryId);
    return cat && cat.userId === userId ? cat : null;
  }

  public async findActiveByName(
    _db: DbQueryClient,
    userId: string,
    kind: CategoryKind,
    name: string,
  ): Promise<CategoryEntity | null> {
    const target = name.trim().toLowerCase();
    for (const cat of this.db.state.categories.values()) {
      if (
        cat.userId === userId &&
        cat.kind === kind &&
        cat.archivedAt === null &&
        cat.name.trim().toLowerCase() === target
      ) {
        return cat;
      }
    }
    return null;
  }

  public async list(
    _db: DbQueryClient,
    userId: string,
    kind?: CategoryKind,
    includeArchived = false,
  ): Promise<CategoryEntity[]> {
    return Array.from(this.db.state.categories.values()).filter(
      (c) =>
        c.userId === userId &&
        (!kind || c.kind === kind) &&
        (includeArchived || c.archivedAt === null),
    );
  }

  public async create(
    _tx: DbTransactionClient,
    input: { userId: string; kind: CategoryKind; name: string; parentId?: string | null },
  ): Promise<CategoryEntity> {
    const cat: CategoryEntity = {
      id: randomUUID(),
      userId: input.userId,
      kind: input.kind,
      name: input.name.trim(),
      parentId: input.parentId ?? null,
      archivedAt: null,
      createdAt: new Date(),
    };
    this.db.state.categories.set(cat.id, cat);
    return cat;
  }

  public async seedDefaultCategories(tx: DbTransactionClient, userId: string): Promise<void> {
    await this.create(tx, { userId, kind: CategoryKind.INCOME, name: 'Lương' });
    await this.create(tx, { userId, kind: CategoryKind.INCOME, name: 'Freelance' });
    await this.create(tx, { userId, kind: CategoryKind.EXPENSE, name: 'Ăn uống' });
    await this.create(tx, { userId, kind: CategoryKind.EXPENSE, name: 'Mua sắm' });
  }

  public async updateName(
    _tx: DbTransactionClient,
    userId: string,
    categoryId: string,
    name: string,
  ): Promise<CategoryEntity> {
    const existing = this.db.state.categories.get(categoryId)!;
    if (existing.userId !== userId) throw new Error('Forbidden');
    const updated: CategoryEntity = { ...existing, name: name.trim() };
    this.db.state.categories.set(categoryId, updated);
    return updated;
  }

  public async archive(
    _tx: DbTransactionClient,
    userId: string,
    categoryId: string,
  ): Promise<CategoryEntity> {
    const existing = this.db.state.categories.get(categoryId)!;
    if (existing.userId !== userId) throw new Error('Forbidden');
    const updated: CategoryEntity = { ...existing, archivedAt: new Date() };
    this.db.state.categories.set(categoryId, updated);
    return updated;
  }
}

export class InMemoryIncomeSourcesRepository implements IncomeSourcesRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async findById(
    _db: DbQueryClient,
    userId: string,
    id: string,
  ): Promise<IncomeSourceEntity | null> {
    const s = this.db.state.incomeSources.get(id);
    return s && s.userId === userId ? s : null;
  }

  public async list(
    _db: DbQueryClient,
    userId: string,
    includeArchived = false,
  ): Promise<IncomeSourceEntity[]> {
    return Array.from(this.db.state.incomeSources.values()).filter(
      (s) => s.userId === userId && (includeArchived || s.archivedAt === null),
    );
  }

  public async create(
    _tx: DbTransactionClient,
    userId: string,
    name: string,
  ): Promise<IncomeSourceEntity> {
    const s: IncomeSourceEntity = {
      id: randomUUID(),
      userId,
      name: name.trim(),
      archivedAt: null,
      createdAt: new Date(),
    };
    this.db.state.incomeSources.set(s.id, s);
    return s;
  }
}

export class InMemoryMerchantsRepository implements MerchantsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async findById(
    _db: DbQueryClient,
    userId: string,
    id: string,
  ): Promise<MerchantEntity | null> {
    const m = this.db.state.merchants.get(id);
    return m && m.userId === userId ? m : null;
  }

  public async list(
    _db: DbQueryClient,
    userId: string,
    includeArchived = false,
  ): Promise<MerchantEntity[]> {
    return Array.from(this.db.state.merchants.values()).filter(
      (m) => m.userId === userId && (includeArchived || m.archivedAt === null),
    );
  }

  public async create(
    _tx: DbTransactionClient,
    userId: string,
    name: string,
  ): Promise<MerchantEntity> {
    const m: MerchantEntity = {
      id: randomUUID(),
      userId,
      name: name.trim(),
      archivedAt: null,
      createdAt: new Date(),
    };
    this.db.state.merchants.set(m.id, m);
    return m;
  }
}

export class InMemoryLedgerRepository implements LedgerRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async insert(
    _tx: DbTransactionClient,
    input: CreateLedgerTransactionInput,
  ): Promise<LedgerTransactionEntity> {
    const now = new Date();
    const txEntity: LedgerTransactionEntity = {
      id: randomUUID(),
      userId: input.userId,
      accountId: input.accountId,
      entryType: input.entryType,
      status: input.status,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      transactionDate: input.transactionDate,
      description: input.description ?? null,
      note: input.note ?? null,
      categoryId: input.categoryId ?? null,
      incomeSourceId: input.incomeSourceId ?? null,
      merchantId: input.merchantId ?? null,
      transferId: input.transferId ?? null,
      recurringRuleId: input.recurringRuleId ?? null,
      occurrenceDate: input.occurrenceDate ?? null,
      refundsTransactionId: input.refundsTransactionId ?? null,
      reversesTransactionId: input.reversesTransactionId ?? null,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.state.transactions.set(txEntity.id, txEntity);
    return txEntity;
  }

  public async insertRecurringDraftIfAbsent(
    _tx: DbTransactionClient,
    input: CreateRecurringDraftTransactionInput,
  ): Promise<LedgerTransactionEntity | null> {
    for (const existing of this.db.state.transactions.values()) {
      if (
        existing.recurringRuleId === input.recurringRuleId &&
        existing.occurrenceDate === input.occurrenceDate
      ) {
        return null;
      }
    }

    const now = new Date();
    const txEntity: LedgerTransactionEntity = {
      id: randomUUID(),
      userId: input.userId,
      accountId: input.accountId,
      entryType: input.entryType,
      status: TransactionStatus.DRAFT,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      transactionDate: input.transactionDate,
      description: input.description ?? null,
      note: input.note ?? null,
      categoryId: input.categoryId,
      incomeSourceId: null,
      merchantId: null,
      transferId: null,
      recurringRuleId: input.recurringRuleId,
      occurrenceDate: input.occurrenceDate,
      refundsTransactionId: null,
      reversesTransactionId: null,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.state.transactions.set(txEntity.id, txEntity);
    return txEntity;
  }

  public async findById(
    _db: DbQueryClient,
    userId: string,
    transactionId: string,
    allowedEntryTypes?: ReadonlyArray<EntryType>,
  ): Promise<LedgerTransactionEntity | null> {
    const t = this.db.state.transactions.get(transactionId);
    if (!t || t.userId !== userId) {
      return null;
    }
    if (allowedEntryTypes && !allowedEntryTypes.includes(t.entryType)) {
      return null;
    }
    return t;
  }

  public async findByTransferId(
    _db: DbQueryClient,
    userId: string,
    transferId: string,
  ): Promise<LedgerTransactionEntity[]> {
    return Array.from(this.db.state.transactions.values())
      .filter((t) => t.userId === userId && t.transferId === transferId)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  public async listAllForExport(
    _db: DbQueryClient,
    userId: string,
    filter?: { accountId?: string; fromDate?: string; toDate?: string },
  ): Promise<LedgerTransactionEntity[]> {
    return Array.from(this.db.state.transactions.values())
      .filter(
        (t) =>
          t.userId === userId &&
          (!filter?.accountId || t.accountId === filter.accountId) &&
          (!filter?.fromDate || t.transactionDate >= filter.fromDate) &&
          (!filter?.toDate || t.transactionDate <= filter.toDate),
      )
      .sort((a, b) => {
        if (a.transactionDate !== b.transactionDate) {
          return b.transactionDate.localeCompare(a.transactionDate);
        }
        const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
        if (createdDiff !== 0) return createdDiff;
        return b.id.localeCompare(a.id);
      });
  }

  public async updateEditable(
    _tx: DbTransactionClient,
    userId: string,
    transactionId: string,
    updates: UpdateEditableTransactionInput,
  ): Promise<LedgerTransactionEntity> {
    const existing = this.db.state.transactions.get(transactionId)!;
    if (existing.userId !== userId) throw new Error('Forbidden');
    const updated: LedgerTransactionEntity = {
      ...existing,
      accountId: updates.accountId ?? existing.accountId,
      amountMinor: updates.amountMinor ?? existing.amountMinor,
      currencyCode: updates.currencyCode ?? existing.currencyCode,
      transactionDate: updates.transactionDate ?? existing.transactionDate,
      description: updates.description !== undefined ? updates.description : existing.description,
      note: updates.note !== undefined ? updates.note : existing.note,
      categoryId: updates.categoryId !== undefined ? updates.categoryId : existing.categoryId,
      incomeSourceId:
        updates.incomeSourceId !== undefined ? updates.incomeSourceId : existing.incomeSourceId,
      merchantId: updates.merchantId !== undefined ? updates.merchantId : existing.merchantId,
      updatedAt: new Date(),
    };
    this.db.state.transactions.set(transactionId, updated);
    return updated;
  }

  public async updateStatus(
    _tx: DbTransactionClient,
    userId: string,
    transactionId: string,
    status: TransactionStatus,
    voidedAt?: Date | null,
  ): Promise<LedgerTransactionEntity> {
    const existing = this.db.state.transactions.get(transactionId)!;
    if (existing.userId !== userId) throw new Error('Forbidden');
    const updated: LedgerTransactionEntity = {
      ...existing,
      status,
      voidedAt: voidedAt ?? existing.voidedAt,
      updatedAt: new Date(),
    };
    this.db.state.transactions.set(transactionId, updated);
    return updated;
  }

  public async list(
    _db: DbQueryClient,
    filter: ListTransactionsFilter,
  ): Promise<{ items: LedgerTransactionEntity[]; hasMore: boolean }> {
    let items = Array.from(this.db.state.transactions.values()).filter(
      (t) =>
        t.userId === filter.userId &&
        (!filter.entryTypes || filter.entryTypes.includes(t.entryType)) &&
        (!filter.accountId || t.accountId === filter.accountId) &&
        (!filter.categoryId || t.categoryId === filter.categoryId) &&
        (!filter.incomeSourceId || t.incomeSourceId === filter.incomeSourceId) &&
        (!filter.merchantId || t.merchantId === filter.merchantId) &&
        (!filter.status || t.status === filter.status) &&
        (!filter.fromDate || t.transactionDate >= filter.fromDate) &&
        (!filter.toDate || t.transactionDate <= filter.toDate),
    );

    items.sort((a, b) => {
      if (a.transactionDate !== b.transactionDate) {
        return b.transactionDate.localeCompare(a.transactionDate);
      }
      const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (createdDiff !== 0) return createdDiff;
      return b.id.localeCompare(a.id);
    });

    if (filter.cursor) {
      const c = filter.cursor;
      const cTime = Date.parse(c.createdAt);
      items = items.filter((item) => {
        if (item.transactionDate !== c.transactionDate) {
          return item.transactionDate < c.transactionDate;
        }
        const iTime = item.createdAt.getTime();
        if (iTime !== cTime) {
          return iTime < cTime;
        }
        return item.id < c.id;
      });
    }

    const hasMore = items.length > filter.limit;
    return {
      items: hasMore ? items.slice(0, filter.limit) : items,
      hasMore,
    };
  }

  public async getBalanceEntriesForAccounts(
    _db: DbQueryClient,
    userId: string,
    accountIds: ReadonlyArray<string>,
  ): Promise<Map<string, LedgerBalanceEntry[]>> {
    const map = new Map<string, LedgerBalanceEntry[]>();
    for (const id of accountIds) {
      map.set(id, []);
    }
    for (const t of this.db.state.transactions.values()) {
      if (t.userId === userId && map.has(t.accountId)) {
        map.get(t.accountId)!.push({
          entryType: t.entryType,
          status: t.status,
          amountMinor: t.amountMinor,
          currencyCode: t.currencyCode,
        });
      }
    }
    return map;
  }

  public async countTransactionsForAccount(
    _db: DbQueryClient,
    userId: string,
    accountId: string,
  ): Promise<number> {
    let count = 0;
    for (const t of this.db.state.transactions.values()) {
      if (t.userId === userId && t.accountId === accountId) {
        count += 1;
      }
    }
    return count;
  }

  public async sumRefundsForExpense(
    _tx: DbTransactionClient,
    userId: string,
    originalExpenseId: string,
  ): Promise<bigint> {
    let total = 0n;
    for (const t of this.db.state.transactions.values()) {
      if (
        t.userId === userId &&
        t.refundsTransactionId === originalExpenseId &&
        t.entryType === EntryType.EXPENSE_REFUND &&
        (t.status === TransactionStatus.POSTED || t.status === TransactionStatus.PENDING)
      ) {
        total += t.amountMinor;
      }
    }
    return total;
  }

  public async findActiveDuplicateCandidates(
    _db: DbQueryClient,
    params: {
      userId: string;
      accountId: string;
      entryTypes: ReadonlyArray<EntryType>;
      minDate: string;
      maxDate: string;
    },
  ): Promise<ActiveDuplicateCandidate[]> {
    const seen = new Set<string>();
    const results: ActiveDuplicateCandidate[] = [];
    for (const t of this.db.state.transactions.values()) {
      if (
        t.userId === params.userId &&
        t.accountId === params.accountId &&
        t.status !== TransactionStatus.VOIDED &&
        params.entryTypes.includes(t.entryType) &&
        t.transactionDate >= params.minDate &&
        t.transactionDate <= params.maxDate
      ) {
        const key = `${t.transactionDate}|${t.amountMinor.toString()}|${t.entryType}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            transactionDate: t.transactionDate,
            amountMinor: t.amountMinor,
            entryType: t.entryType,
          });
        }
      }
    }
    return results;
  }
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  private key(userId: string, idempotencyKey: string): string {
    return `${userId}:${idempotencyKey}`;
  }

  public async acquireOrReplay(
    _tx: DbTransactionClient,
    params: AcquireIdempotencyParams,
  ): Promise<AcquireIdempotencyResult> {
    const composite = this.key(params.userId, params.idempotencyKey);
    const existing = this.db.state.idempotencyKeys.get(composite);

    if (existing && existing.expiresAt.getTime() <= Date.now()) {
      this.db.state.idempotencyKeys.delete(composite);
    }

    const active = this.db.state.idempotencyKeys.get(composite);
    if (!active) {
      this.db.state.idempotencyKeys.set(composite, {
        userId: params.userId,
        idempotencyKey: params.idempotencyKey,
        requestMethod: params.requestMethod,
        requestPath: params.requestPath,
        requestHash: params.requestHash,
        responseStatus: null,
        responseBody: null,
        createdAt: new Date(),
        expiresAt: params.expiresAt,
      });
      return { kind: 'ACQUIRED' };
    }

    if (
      active.requestHash !== params.requestHash ||
      active.requestMethod !== params.requestMethod ||
      active.requestPath !== params.requestPath
    ) {
      return { kind: 'CONFLICT' };
    }

    if (active.responseStatus === null) {
      return { kind: 'IN_PROGRESS' };
    }

    return {
      kind: 'REPLAY',
      status: active.responseStatus,
      body: active.responseBody,
    };
  }

  public async saveResponse(
    _tx: DbTransactionClient,
    userId: string,
    idempotencyKey: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    const composite = this.key(userId, idempotencyKey);
    const existing = this.db.state.idempotencyKeys.get(composite);
    if (existing) {
      this.db.state.idempotencyKeys.set(composite, {
        ...existing,
        responseStatus,
        responseBody,
      });
    }
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async record(_db: DbQueryClient, input: AuditLogInput): Promise<void> {
    this.db.state.auditLogs.push({
      id: randomUUID(),
      input,
      metadata: sanitizeForLog(input.metadata ?? {}),
    });
  }
}

export class InMemoryTransfersRepository implements TransfersRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async create(_tx: DbTransactionClient, input: CreateTransferInput): Promise<TransferEntity> {
    const now = new Date();
    const transfer: TransferEntity = {
      id: randomUUID(),
      userId: input.userId,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      fromAmountMinor: input.fromAmountMinor,
      fromCurrencyCode: input.fromCurrencyCode,
      toAmountMinor: input.toAmountMinor,
      toCurrencyCode: input.toCurrencyCode,
      exchangeRate: input.exchangeRate,
      rateSource: input.rateSource,
      rateEffectiveAt: input.rateEffectiveAt,
      feeTransactionId: null,
      transferDate: input.transferDate,
      note: input.note,
      status: input.status,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.state.transfers.set(transfer.id, transfer);
    return transfer;
  }

  public async findById(
    _db: DbQueryClient,
    userId: string,
    transferId: string,
  ): Promise<TransferEntity | null> {
    const t = this.db.state.transfers.get(transferId);
    return t && t.userId === userId ? t : null;
  }

  public async setFeeTransactionId(
    _tx: DbTransactionClient,
    userId: string,
    transferId: string,
    feeTransactionId: string,
  ): Promise<TransferEntity> {
    const existing = this.db.state.transfers.get(transferId)!;
    if (existing.userId !== userId) throw new Error('Forbidden');
    const updated: TransferEntity = {
      ...existing,
      feeTransactionId,
      updatedAt: new Date(),
    };
    this.db.state.transfers.set(transferId, updated);
    return updated;
  }

  public async updateStatus(
    _tx: DbTransactionClient,
    userId: string,
    transferId: string,
    status: TransferStatus,
    voidedAt?: Date | null,
  ): Promise<TransferEntity> {
    const existing = this.db.state.transfers.get(transferId)!;
    if (existing.userId !== userId) throw new Error('Forbidden');
    const updated: TransferEntity = {
      ...existing,
      status,
      voidedAt: voidedAt ?? existing.voidedAt,
      updatedAt: new Date(),
    };
    this.db.state.transfers.set(transferId, updated);
    return updated;
  }

  public async list(
    _db: DbQueryClient,
    filter: ListTransfersFilter,
  ): Promise<{ items: TransferEntity[]; hasMore: boolean }> {
    let items = Array.from(this.db.state.transfers.values()).filter(
      (t) =>
        t.userId === filter.userId &&
        (!filter.accountId ||
          t.fromAccountId === filter.accountId ||
          t.toAccountId === filter.accountId) &&
        (!filter.status || t.status === filter.status) &&
        (!filter.fromDate || t.transferDate >= filter.fromDate) &&
        (!filter.toDate || t.transferDate <= filter.toDate),
    );

    items.sort((a, b) => {
      if (a.transferDate !== b.transferDate) {
        return b.transferDate.localeCompare(a.transferDate);
      }
      const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (createdDiff !== 0) return createdDiff;
      return b.id.localeCompare(a.id);
    });

    if (filter.cursor) {
      const c = filter.cursor;
      const cTime = Date.parse(c.createdAt);
      items = items.filter((item) => {
        if (item.transferDate !== c.transferDate) {
          return item.transferDate < c.transferDate;
        }
        const iTime = item.createdAt.getTime();
        if (iTime !== cTime) {
          return iTime < cTime;
        }
        return item.id < c.id;
      });
    }

    const hasMore = items.length > filter.limit;
    return {
      items: hasMore ? items.slice(0, filter.limit) : items,
      hasMore,
    };
  }

  public async listAllByUser(
    _db: DbQueryClient,
    userId: string,
    filter?: { accountId?: string; fromDate?: string; toDate?: string },
  ): Promise<TransferEntity[]> {
    return Array.from(this.db.state.transfers.values())
      .filter(
        (t) =>
          t.userId === userId &&
          (!filter?.accountId ||
            t.fromAccountId === filter.accountId ||
            t.toAccountId === filter.accountId) &&
          (!filter?.fromDate || t.transferDate >= filter.fromDate) &&
          (!filter?.toDate || t.transferDate <= filter.toDate),
      )
      .sort((a, b) => {
        if (a.transferDate !== b.transferDate) {
          return b.transferDate.localeCompare(a.transferDate);
        }
        const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
        if (createdDiff !== 0) return createdDiff;
        return b.id.localeCompare(a.id);
      });
  }
}

export class InMemoryReportingRepository implements ReportingRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async aggregatePostedCashFlow(
    _db: DbQueryClient,
    params: CashFlowQueryParams,
  ): Promise<CashFlowAggregateRow[]> {
    const grouped = new Map<string, CashFlowAggregateRow>();

    for (const tx of this.db.state.transactions.values()) {
      if (
        tx.userId !== params.userId ||
        tx.status !== TransactionStatus.POSTED ||
        (tx.entryType !== EntryType.INCOME &&
          tx.entryType !== EntryType.EXPENSE &&
          tx.entryType !== EntryType.EXPENSE_REFUND) ||
        tx.transactionDate < params.fromDate ||
        tx.transactionDate > params.toDate ||
        (params.currencyCode && tx.currencyCode !== params.currencyCode) ||
        (params.accountId && tx.accountId !== params.accountId)
      ) {
        continue;
      }

      if (!tx.categoryId) continue;
      const cat = this.db.state.categories.get(tx.categoryId);
      if (!cat || cat.userId !== params.userId) continue;

      const key = `${tx.currencyCode}|${tx.entryType}|${tx.categoryId}`;
      const existing = grouped.get(key);
      if (existing) {
        grouped.set(key, {
          ...existing,
          totalMinor: existing.totalMinor + tx.amountMinor,
          transactionCount: existing.transactionCount + 1,
        });
      } else {
        grouped.set(key, {
          currencyCode: tx.currencyCode,
          entryType: tx.entryType,
          categoryId: tx.categoryId,
          categoryName: cat.name,
          categoryKind: cat.kind,
          totalMinor: tx.amountMinor,
          transactionCount: 1,
        });
      }
    }

    return Array.from(grouped.values());
  }
}

export class InMemoryBudgetsRepository implements BudgetsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async findById(
    _db: DbQueryClient,
    userId: string,
    budgetId: string,
  ): Promise<BudgetEntity | null> {
    const b = this.db.state.budgets.get(budgetId);
    return b && b.userId === userId ? b : null;
  }

  public async findOverlappingActive(
    _tx: DbTransactionClient,
    params: {
      userId: string;
      categoryId: string;
      currencyCode: SupportedCurrencyCode;
      periodStart: string;
      periodEnd: string;
      excludeBudgetId?: string;
    },
  ): Promise<BudgetEntity | null> {
    for (const b of this.db.state.budgets.values()) {
      if (
        b.userId === params.userId &&
        b.categoryId === params.categoryId &&
        b.currencyCode === params.currencyCode &&
        b.archivedAt === null &&
        b.id !== params.excludeBudgetId &&
        b.periodStart <= params.periodEnd &&
        b.periodEnd >= params.periodStart
      ) {
        return b;
      }
    }
    return null;
  }

  public async list(
    _db: DbQueryClient,
    userId: string,
    filter?: ListBudgetsFilter,
  ): Promise<BudgetEntity[]> {
    return Array.from(this.db.state.budgets.values())
      .filter(
        (b) =>
          b.userId === userId &&
          (filter?.includeArchived || b.archivedAt === null) &&
          (!filter?.currencyCode || b.currencyCode === filter.currencyCode) &&
          (!filter?.categoryId || b.categoryId === filter.categoryId) &&
          (!filter?.fromDate || b.periodEnd >= filter.fromDate) &&
          (!filter?.toDate || b.periodStart <= filter.toDate),
      )
      .sort((a, b) => {
        if (a.periodStart !== b.periodStart) {
          return b.periodStart.localeCompare(a.periodStart);
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }

  public async create(_tx: DbTransactionClient, input: CreateBudgetInput): Promise<BudgetEntity> {
    const b: BudgetEntity = {
      id: randomUUID(),
      userId: input.userId,
      categoryId: input.categoryId,
      categoryKind: CategoryKind.EXPENSE,
      limitMinor: input.limitMinor,
      currencyCode: input.currencyCode,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      archivedAt: null,
      createdAt: new Date(),
    };
    this.db.state.budgets.set(b.id, b);
    return b;
  }

  public async update(
    _tx: DbTransactionClient,
    userId: string,
    budgetId: string,
    updates: UpdateBudgetInput,
  ): Promise<BudgetEntity> {
    const existing = this.db.state.budgets.get(budgetId)!;
    if (existing.userId !== userId) throw new Error('Forbidden');
    const updated: BudgetEntity = {
      ...existing,
      limitMinor: updates.limitMinor ?? existing.limitMinor,
      periodStart: updates.periodStart ?? existing.periodStart,
      periodEnd: updates.periodEnd ?? existing.periodEnd,
      archivedAt: updates.archivedAt !== undefined ? updates.archivedAt : existing.archivedAt,
    };
    this.db.state.budgets.set(budgetId, updated);
    return updated;
  }

  public async getPostedExpenseTotalsForRange(
    _db: DbQueryClient,
    params: {
      userId: string;
      minDate: string;
      maxDate: string;
      categoryIds?: ReadonlyArray<string>;
      currencyCodes?: ReadonlyArray<SupportedCurrencyCode>;
    },
  ): Promise<BudgetDailyExpenseEntry[]> {
    const grouped = new Map<string, BudgetDailyExpenseEntry>();
    for (const tx of this.db.state.transactions.values()) {
      if (
        tx.userId !== params.userId ||
        tx.status !== TransactionStatus.POSTED ||
        (tx.entryType !== EntryType.EXPENSE && tx.entryType !== EntryType.EXPENSE_REFUND) ||
        tx.transactionDate < params.minDate ||
        tx.transactionDate > params.maxDate ||
        !tx.categoryId ||
        (params.categoryIds && !params.categoryIds.includes(tx.categoryId)) ||
        (params.currencyCodes && !params.currencyCodes.includes(tx.currencyCode))
      ) {
        continue;
      }

      const key = `${tx.categoryId}|${tx.currencyCode}|${tx.transactionDate}|${tx.entryType}`;
      const existing = grouped.get(key);
      if (existing) {
        grouped.set(key, {
          ...existing,
          totalMinor: existing.totalMinor + tx.amountMinor,
        });
      } else {
        grouped.set(key, {
          categoryId: tx.categoryId,
          currencyCode: tx.currencyCode,
          transactionDate: tx.transactionDate,
          entryType: tx.entryType,
          totalMinor: tx.amountMinor,
        });
      }
    }
    return Array.from(grouped.values());
  }
}

export class InMemoryRecurringRepository implements RecurringRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async findById(
    _db: DbQueryClient,
    userId: string,
    ruleId: string,
  ): Promise<RecurringRuleEntity | null> {
    const r = this.db.state.recurringRules.get(ruleId);
    return r && r.userId === userId ? r : null;
  }

  public async list(
    _db: DbQueryClient,
    userId: string,
    filter?: ListRecurringRulesFilter,
  ): Promise<RecurringRuleEntity[]> {
    return Array.from(this.db.state.recurringRules.values())
      .filter(
        (r) =>
          r.userId === userId &&
          (filter?.ruleKind === undefined || r.ruleKind === filter.ruleKind) &&
          (filter?.isActive === undefined || r.isActive === filter.isActive),
      )
      .sort((a, b) => {
        if (a.isActive !== b.isActive) {
          return a.isActive ? -1 : 1;
        }
        if (a.nextRunDate !== b.nextRunDate) {
          return a.nextRunDate.localeCompare(b.nextRunDate);
        }
        const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
        if (createdDiff !== 0) return createdDiff;
        return b.id.localeCompare(a.id);
      });
  }

  public async findDueActiveForUpdate(
    _tx: DbTransactionClient,
    userId: string,
    asOfDate: string,
  ): Promise<RecurringRuleEntity[]> {
    return Array.from(this.db.state.recurringRules.values())
      .filter((r) => r.userId === userId && r.isActive && r.nextRunDate <= asOfDate)
      .sort((a, b) => {
        if (a.nextRunDate !== b.nextRunDate) {
          return a.nextRunDate.localeCompare(b.nextRunDate);
        }
        const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
        if (createdDiff !== 0) return createdDiff;
        return a.id.localeCompare(b.id);
      });
  }

  public async create(
    _tx: DbTransactionClient,
    input: CreateRecurringRuleInput,
  ): Promise<RecurringRuleEntity> {
    const now = new Date();
    const rule: RecurringRuleEntity = {
      id: randomUUID(),
      userId: input.userId,
      ruleKind: input.ruleKind,
      accountId: input.accountId,
      categoryId: input.categoryId,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      frequency: input.frequency,
      intervalCount: input.intervalCount,
      nextRunDate: input.nextRunDate,
      endDate: input.endDate,
      timezone: input.timezone,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    };
    this.db.state.recurringRules.set(rule.id, rule);
    return rule;
  }

  public async update(
    _tx: DbTransactionClient,
    userId: string,
    ruleId: string,
    updates: UpdateRecurringRuleInput,
  ): Promise<RecurringRuleEntity> {
    const existing = this.db.state.recurringRules.get(ruleId)!;
    if (existing.userId !== userId) {
      throw new Error('Forbidden');
    }
    const updated: RecurringRuleEntity = {
      ...existing,
      accountId: updates.accountId ?? existing.accountId,
      categoryId: updates.categoryId ?? existing.categoryId,
      amountMinor: updates.amountMinor ?? existing.amountMinor,
      frequency: updates.frequency ?? existing.frequency,
      intervalCount: updates.intervalCount ?? existing.intervalCount,
      nextRunDate: updates.nextRunDate ?? existing.nextRunDate,
      endDate: updates.endDate !== undefined ? updates.endDate : existing.endDate,
      timezone: updates.timezone ?? existing.timezone,
      isActive: updates.isActive !== undefined ? updates.isActive : existing.isActive,
      updatedAt: new Date(),
    };
    this.db.state.recurringRules.set(ruleId, updated);
    return updated;
  }
}

export class InMemoryMfaRepository implements MfaRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async findByUserId(_db: DbQueryClient, userId: string): Promise<UserMfaEntity | null> {
    return this.db.state.userMfa.get(userId) ?? null;
  }

  public async upsertPendingSecret(
    _tx: DbTransactionClient,
    userId: string,
    totpSecretEncrypted: string,
  ): Promise<UserMfaEntity> {
    const existing = this.db.state.userMfa.get(userId);
    const now = new Date();
    const record: UserMfaEntity = {
      userId,
      totpSecretEncrypted,
      enabledAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.db.state.userMfa.set(userId, record);
    return record;
  }

  public async markEnabled(
    _tx: DbTransactionClient,
    userId: string,
    enabledAt: Date,
  ): Promise<UserMfaEntity> {
    const existing = this.db.state.userMfa.get(userId)!;
    const updated: UserMfaEntity = {
      ...existing,
      enabledAt,
      updatedAt: new Date(),
    };
    this.db.state.userMfa.set(userId, updated);
    return updated;
  }

  public async replaceRecoveryCodes(
    _tx: DbTransactionClient,
    userId: string,
    codeHashes: ReadonlyArray<string>,
  ): Promise<void> {
    for (const [id, code] of this.db.state.userMfaRecoveryCodes.entries()) {
      if (code.userId === userId) {
        this.db.state.userMfaRecoveryCodes.delete(id);
      }
    }
    const now = new Date();
    for (const codeHash of codeHashes) {
      const entity: UserMfaRecoveryCodeEntity = {
        id: randomUUID(),
        userId,
        codeHash,
        usedAt: null,
        createdAt: now,
      };
      this.db.state.userMfaRecoveryCodes.set(entity.id, entity);
    }
  }

  public async countRemainingRecoveryCodes(_db: DbQueryClient, userId: string): Promise<number> {
    let count = 0;
    for (const code of this.db.state.userMfaRecoveryCodes.values()) {
      if (code.userId === userId && code.usedAt === null) {
        count += 1;
      }
    }
    return count;
  }

  public async consumeRecoveryCode(
    _tx: DbTransactionClient,
    userId: string,
    codeHash: string,
  ): Promise<boolean> {
    for (const [id, code] of this.db.state.userMfaRecoveryCodes.entries()) {
      if (code.userId === userId && code.codeHash === codeHash && code.usedAt === null) {
        this.db.state.userMfaRecoveryCodes.set(id, {
          ...code,
          usedAt: new Date(),
        });
        return true;
      }
    }
    return false;
  }

  public async deleteAllForUser(_tx: DbTransactionClient, userId: string): Promise<void> {
    for (const [id, code] of this.db.state.userMfaRecoveryCodes.entries()) {
      if (code.userId === userId) {
        this.db.state.userMfaRecoveryCodes.delete(id);
      }
    }
    this.db.state.userMfa.delete(userId);
  }
}

export class InMemoryAttachmentsRepository implements AttachmentsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  public async listByTransaction(
    _db: DbQueryClient,
    userId: string,
    transactionId: string,
  ): Promise<TransactionAttachmentEntity[]> {
    return Array.from(this.db.state.transactionAttachments.values())
      .filter((item) => item.userId === userId && item.transactionId === transactionId)
      .sort((a, b) => {
        const diff = a.createdAt.getTime() - b.createdAt.getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });
  }

  public async countByTransaction(
    _db: DbQueryClient,
    userId: string,
    transactionId: string,
  ): Promise<number> {
    let count = 0;
    for (const item of this.db.state.transactionAttachments.values()) {
      if (item.userId === userId && item.transactionId === transactionId) {
        count += 1;
      }
    }
    return count;
  }

  public async findById(
    _db: DbQueryClient,
    userId: string,
    attachmentId: string,
  ): Promise<TransactionAttachmentEntity | null> {
    const item = this.db.state.transactionAttachments.get(attachmentId);
    return item && item.userId === userId ? item : null;
  }

  public async insert(
    _tx: DbTransactionClient,
    input: CreateAttachmentInput,
  ): Promise<TransactionAttachmentEntity> {
    const entity: TransactionAttachmentEntity = {
      id: randomUUID(),
      userId: input.userId,
      transactionId: input.transactionId,
      originalFilename: input.originalFilename,
      storedFilename: input.storedFilename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256Hash: input.sha256Hash,
      createdAt: new Date(),
    };
    this.db.state.transactionAttachments.set(entity.id, entity);
    return entity;
  }

  public async deleteById(
    _tx: DbTransactionClient,
    userId: string,
    attachmentId: string,
  ): Promise<TransactionAttachmentEntity | null> {
    const item = this.db.state.transactionAttachments.get(attachmentId);
    if (!item || item.userId !== userId) {
      return null;
    }
    this.db.state.transactionAttachments.delete(attachmentId);
    return item;
  }
}
