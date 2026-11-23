import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccountType, CategoryKind, EntryType, TransactionStatus } from '@pfm/shared-types';
import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/config/app-config';
import { DATABASE_EXECUTOR } from '../src/database/database.types';
import { configureHttpApp } from '../src/main';
import { ACCOUNTS_REPOSITORY } from '../src/modules/accounts/accounts.repository';
import { AccountsService } from '../src/modules/accounts/accounts.service';
import { DefaultAccountResolver } from '../src/modules/accounts/default-account.resolver';
import { AUDIT_REPOSITORY } from '../src/modules/audit/audit.repository';
import { AUTH_REPOSITORY } from '../src/modules/auth/auth.repository';
import { AuthService } from '../src/modules/auth/auth.service';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service';
import { TokenService } from '../src/modules/auth/token.service';
import { CATEGORIES_REPOSITORY } from '../src/modules/categories/categories.repository';
import { CategoriesService } from '../src/modules/categories/categories.service';
import { ExpenseService } from '../src/modules/expense/expense.service';
import { MERCHANTS_REPOSITORY } from '../src/modules/expense/merchants.repository';
import { INCOME_SOURCES_REPOSITORY } from '../src/modules/income/income-sources.repository';
import { IncomeService } from '../src/modules/income/income.service';
import { LEDGER_REPOSITORY } from '../src/modules/ledger/ledger.repository';
import {
  CurrencyMismatchException,
  IdempotencyConflictException,
  InvalidIdempotencyKeyException,
  InvalidStateTransitionException,
  MissingIdempotencyKeyException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../src/shared-kernel/domain/domain-exceptions';
import { IdempotencyService } from '../src/shared-kernel/idempotency/idempotency.service';
import { IDEMPOTENCY_REPOSITORY } from '../src/shared-kernel/idempotency/idempotency.types';
import {
  InMemoryAccountsRepository,
  InMemoryAuditRepository,
  InMemoryAuthRepository,
  InMemoryCategoriesRepository,
  InMemoryDatabase,
  InMemoryIdempotencyRepository,
  InMemoryIncomeSourcesRepository,
  InMemoryLedgerRepository,
  InMemoryMerchantsRepository,
  TEST_APP_CONFIG,
} from './helpers/in-memory-backend';

function createServiceHarness() {
  const db = new InMemoryDatabase();
  const authRepo = new InMemoryAuthRepository(db);
  const accountsRepo = new InMemoryAccountsRepository(db);
  const categoriesRepo = new InMemoryCategoriesRepository(db);
  const ledgerRepo = new InMemoryLedgerRepository(db);
  const incomeSourcesRepo = new InMemoryIncomeSourcesRepository(db);
  const merchantsRepo = new InMemoryMerchantsRepository(db);
  const idempotencyRepo = new InMemoryIdempotencyRepository(db);
  const auditRepo = new InMemoryAuditRepository(db);

  const idempotencyService = new IdempotencyService(idempotencyRepo);
  const passwordHasher = new PasswordHasherService(TEST_APP_CONFIG);
  const tokenService = new TokenService(TEST_APP_CONFIG);
  const categoriesService = new CategoriesService(db, categoriesRepo, auditRepo);
  const defaultAccountResolver = new DefaultAccountResolver(accountsRepo);

  const authService = new AuthService(
    db,
    authRepo,
    accountsRepo,
    categoriesRepo,
    ledgerRepo,
    auditRepo,
    passwordHasher,
    tokenService,
  );
  const accountsService = new AccountsService(
    db,
    accountsRepo,
    ledgerRepo,
    auditRepo,
    idempotencyService,
  );
  const incomeService = new IncomeService(
    db,
    ledgerRepo,
    incomeSourcesRepo,
    auditRepo,
    defaultAccountResolver,
    categoriesService,
    idempotencyService,
  );
  const expenseService = new ExpenseService(
    db,
    ledgerRepo,
    merchantsRepo,
    auditRepo,
    defaultAccountResolver,
    categoriesService,
    idempotencyService,
  );

  return {
    db,
    authService,
    accountsService,
    categoriesService,
    incomeService,
    expenseService,
  };
}

describe('IncomeModule, ExpenseModule, Default Account Resolution & Idempotency-Key (In-Memory)', () => {
  it('resolves omitted accountId to Default Account ("Sổ chung") and tracks Posted Balance accurately', async () => {
    const { authService, accountsService, categoriesService, incomeService, expenseService } =
      createServiceHarness();

    const reg = await authService.register({
      email: 'eve@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Eve Vo',
      baseCurrencyCode: 'VND',
    });
    const userId = reg.response.user.id;
    const defaultAccId = reg.response.defaultAccount!.id;

    const incomeCat = (await categoriesService.list(userId, CategoryKind.INCOME))[0];
    const expenseCat = (await categoriesService.list(userId, CategoryKind.EXPENSE))[0];

    // Omit accountId on income -> resolves to "Sổ chung"
    const incRes = await incomeService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/incomes',
      {
        categoryId: incomeCat.id,
        amount: '2000000',
        description: 'Salary',
      },
    );
    expect(incRes.status).toBe(201);
    expect(incRes.body.accountId).toBe(defaultAccId);
    expect(incRes.body.accountPostedBalanceMinor).toBe('2000000');

    // Omit accountId on expense -> resolves to "Sổ chung"
    const expRes = await expenseService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/expenses',
      {
        categoryId: expenseCat.id,
        amount: '500000',
        description: 'Groceries',
      },
    );
    expect(expRes.status).toBe(201);
    expect(expRes.body.accountId).toBe(defaultAccId);
    expect(expRes.body.accountPostedBalanceMinor).toBe('1500000');
    expect(expRes.body.warnings).toBeUndefined();

    // Verify Simple Mode omits negative warning when 1 active account goes negative (BR-ACC-06)
    const expOver = await expenseService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/expenses',
      {
        categoryId: expenseCat.id,
        amount: '2000000',
      },
    );
    expect(expOver.body.accountPostedBalanceMinor).toBe('-500000');
    expect(expOver.body.warnings).toBeUndefined();

    // Add 2nd active account (Multi-Account Mode) -> negative balance produces soft warning
    await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'Bank USD',
      accountType: AccountType.BANK,
      currencyCode: 'USD',
      isDefault: false,
    });

    const expMulti = await expenseService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/expenses',
      {
        categoryId: expenseCat.id,
        amount: '100000',
      },
    );
    expect(expMulti.body.accountPostedBalanceMinor).toBe('-600000');
    expect(expMulti.body.warnings).toEqual(['ACCOUNT_BALANCE_NEGATIVE']);
  });

  it('enforces Idempotency-Key validation, replay, conflict (409), user isolation, and rollback recovery', async () => {
    const { db, authService, accountsService, categoriesService, incomeService } =
      createServiceHarness();

    const user1 = await authService.register({
      email: 'u1@example.com',
      password: 'StrongPassword1234!',
      fullName: 'User One',
    });
    const user2 = await authService.register({
      email: 'u2@example.com',
      password: 'StrongPassword1234!',
      fullName: 'User Two',
    });

    const u1Id = user1.response.user.id;
    const u2Id = user2.response.user.id;
    const u1Cat = (await categoriesService.list(u1Id, CategoryKind.INCOME))[0];
    const u2Cat = (await categoriesService.list(u2Id, CategoryKind.INCOME))[0];

    // Missing or malformed Idempotency-Key -> 400
    await expect(
      incomeService.create(u1Id, 'Asia/Ho_Chi_Minh', undefined, '/api/v1/incomes', {
        categoryId: u1Cat.id,
        amount: '100000',
      }),
    ).rejects.toThrow(MissingIdempotencyKeyException);

    await expect(
      incomeService.create(u1Id, 'Asia/Ho_Chi_Minh', 'not-a-uuid-v4', '/api/v1/incomes', {
        categoryId: u1Cat.id,
        amount: '100000',
      }),
    ).rejects.toThrow(InvalidIdempotencyKeyException);

    // Valid UUIDv4 key -> first call creates, second call with same payload replays without duplicate
    const sharedKey = randomUUID();
    const payload = { categoryId: u1Cat.id, amount: '350000', description: 'Freelance' };

    const first = await incomeService.create(
      u1Id,
      'Asia/Ho_Chi_Minh',
      sharedKey,
      '/api/v1/incomes',
      payload,
    );
    const second = await incomeService.create(
      u1Id,
      'Asia/Ho_Chi_Minh',
      sharedKey,
      '/api/v1/incomes',
      { description: 'Freelance', amount: '350000', categoryId: u1Cat.id }, // different key order, same canonical hash!
    );

    expect(second.body.id).toBe(first.body.id);
    const u1DefaultAcc = await accountsService.getAccount(u1Id, user1.response.defaultAccount!.id);
    expect(u1DefaultAcc.postedBalanceMinor).toBe('350000');
    expect(u1DefaultAcc.transactionCount).toBe(1);

    // Same key + different payload -> 409 Conflict
    await expect(
      incomeService.create(u1Id, 'Asia/Ho_Chi_Minh', sharedKey, '/api/v1/incomes', {
        categoryId: u1Cat.id,
        amount: '400000',
      }),
    ).rejects.toThrow(IdempotencyConflictException);

    // Same UUIDv4 key used by User 2 -> isolated per user!
    const u2Res = await incomeService.create(
      u2Id,
      'Asia/Ho_Chi_Minh',
      sharedKey,
      '/api/v1/incomes',
      { categoryId: u2Cat.id, amount: '500000' },
    );
    expect(u2Res.body.id).not.toBe(first.body.id);

    // Failed transaction rolls back idempotency key so subsequent retry is not poisoned
    const retryKey = randomUUID();
    await expect(
      incomeService.create(u1Id, 'Asia/Ho_Chi_Minh', retryKey, '/api/v1/incomes', {
        categoryId: u1Cat.id,
        amount: '100000',
        currencyCode: 'USD', // mismatches VND account -> rolls back!
      }),
    ).rejects.toThrow(CurrencyMismatchException);

    expect(db.state.idempotencyKeys.has(`${u1Id}:${retryKey}`)).toBe(false);
  });

  it('enforces INCOME vs EXPENSE category separation and EXPENSE_REFUND bounds (BR-EXP-03/04)', async () => {
    const { authService, accountsService, categoriesService, incomeService, expenseService } =
      createServiceHarness();

    const reg = await authService.register({
      email: 'frank@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Frank Hoang',
    });
    const userId = reg.response.user.id;
    const defaultAccId = reg.response.defaultAccount!.id;
    const incomeCat = (await categoriesService.list(userId, CategoryKind.INCOME))[0];
    const expenseCat = (await categoriesService.list(userId, CategoryKind.EXPENSE))[0];

    // Cross-kind category usage must fail
    await expect(
      incomeService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/incomes', {
        categoryId: expenseCat.id,
        amount: '100000',
      }),
    ).rejects.toThrow(ValidationDomainException);

    await expect(
      expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
        categoryId: incomeCat.id,
        amount: '100000',
      }),
    ).rejects.toThrow(ValidationDomainException);

    // Record 1,000,000 VND expense
    const exp = await expenseService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/expenses',
      {
        categoryId: expenseCat.id,
        amount: '1000000',
      },
    );

    // Partial refund 300,000 VND succeeds -> postedBalance = -1,000,000 + 300,000 = -700,000
    const refund1 = await expenseService.createRefund(
      userId,
      'Asia/Ho_Chi_Minh',
      exp.body.id,
      randomUUID(),
      `/api/v1/expenses/${exp.body.id}/refunds`,
      { amount: '300000' },
    );
    expect(refund1.body.entryType).toBe(EntryType.EXPENSE_REFUND);
    expect(refund1.body.accountPostedBalanceMinor).toBe('-700000');

    // Refund 800,000 VND (total 1.1M > 1M) -> rejected
    await expect(
      expenseService.createRefund(
        userId,
        'Asia/Ho_Chi_Minh',
        exp.body.id,
        randomUUID(),
        `/api/v1/expenses/${exp.body.id}/refunds`,
        { amount: '800000' },
      ),
    ).rejects.toThrow(ValidationDomainException);

    // Remaining 700,000 VND refund (total == 1M) succeeds -> balance back to 0
    const refund2 = await expenseService.createRefund(
      userId,
      'Asia/Ho_Chi_Minh',
      exp.body.id,
      randomUUID(),
      `/api/v1/expenses/${exp.body.id}/refunds`,
      { amount: '700000' },
    );
    expect(refund2.body.accountPostedBalanceMinor).toBe('0');

    // Voiding/reversing lifecycle checks
    const draftIncome = await incomeService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/incomes',
      { categoryId: incomeCat.id, amount: '500000', status: TransactionStatus.DRAFT },
    );
    expect((await accountsService.getAccount(userId, defaultAccId)).postedBalanceMinor).toBe('0');

    await incomeService.post(
      userId,
      draftIncome.body.id,
      randomUUID(),
      `/api/v1/incomes/${draftIncome.body.id}/post`,
    );
    expect((await accountsService.getAccount(userId, defaultAccId)).postedBalanceMinor).toBe(
      '500000',
    );

    await expect(
      incomeService.update(userId, draftIncome.body.id, { amount: '999999' }),
    ).rejects.toThrow(InvalidStateTransitionException);

    await incomeService.reverse(
      userId,
      draftIncome.body.id,
      randomUUID(),
      `/api/v1/incomes/${draftIncome.body.id}/reverse`,
    );
    expect((await accountsService.getAccount(userId, defaultAccId)).postedBalanceMinor).toBe('0');
  });

  describe('NestJS HTTP Pipeline: Auth, Mass Assignment (T-04), IDOR (T-02), and RFC 9457', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const memDb = new InMemoryDatabase();
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(APP_CONFIG)
        .useValue(TEST_APP_CONFIG)
        .overrideProvider(DATABASE_EXECUTOR)
        .useValue(memDb)
        .overrideProvider(AUTH_REPOSITORY)
        .useValue(new InMemoryAuthRepository(memDb))
        .overrideProvider(ACCOUNTS_REPOSITORY)
        .useValue(new InMemoryAccountsRepository(memDb))
        .overrideProvider(CATEGORIES_REPOSITORY)
        .useValue(new InMemoryCategoriesRepository(memDb))
        .overrideProvider(LEDGER_REPOSITORY)
        .useValue(new InMemoryLedgerRepository(memDb))
        .overrideProvider(INCOME_SOURCES_REPOSITORY)
        .useValue(new InMemoryIncomeSourcesRepository(memDb))
        .overrideProvider(MERCHANTS_REPOSITORY)
        .useValue(new InMemoryMerchantsRepository(memDb))
        .overrideProvider(IDEMPOTENCY_REPOSITORY)
        .useValue(new InMemoryIdempotencyRepository(memDb))
        .overrideProvider(AUDIT_REPOSITORY)
        .useValue(new InMemoryAuditRepository(memDb))
        .compile();

      app = moduleRef.createNestApplication();
      configureHttpApp(app, TEST_APP_CONFIG);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('enforces end-to-end HTTP contracts with mocked in-memory repositories', async () => {
      const server = app.getHttpServer();

      // Unauthenticated access -> 401 RFC 9457
      const unauthRes = await request(server).get('/api/v1/accounts');
      expect(unauthRes.status).toBe(401);
      expect(unauthRes.headers['content-type']).toContain('application/problem+json');

      // Register User A & User B
      const regA = await request(server).post('/api/v1/auth/register').send({
        email: 'http-a@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP User A',
      });
      expect(regA.status).toBe(201);
      expect(regA.body.defaultAccount.name).toBe('Sổ chung');
      expect(regA.headers['set-cookie']).toBeDefined();

      const regB = await request(server).post('/api/v1/auth/register').send({
        email: 'http-b@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP User B',
      });
      expect(regB.status).toBe(201);

      const tokenA = regA.body.accessToken as string;
      const tokenB = regB.body.accessToken as string;

      const catsA = await request(server)
        .get('/api/v1/categories?kind=INCOME')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(catsA.status).toBe(200);
      const incomeCatId = catsA.body[0].id as string;

      // Mass assignment attempt (T-04): extra userId / entryType rejected with 400
      const massAssignRes = await request(server)
        .post('/api/v1/incomes')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          categoryId: incomeCatId,
          amount: '100000',
          userId: regB.body.user.id,
        });
      expect(massAssignRes.status).toBe(400);
      expect(massAssignRes.headers['content-type']).toContain('application/problem+json');

      // Valid Quick-Log income omitting accountId
      const idemKey = randomUUID();
      const createRes = await request(server)
        .post('/api/v1/incomes')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', idemKey)
        .send({
          categoryId: incomeCatId,
          amount: '250000',
          description: 'Bonus',
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.accountId).toBe(regA.body.defaultAccount.id);
      expect(createRes.body.accountPostedBalanceMinor).toBe('250000');

      // Duplicate retry returns same record
      const replayRes = await request(server)
        .post('/api/v1/incomes')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', idemKey)
        .send({
          categoryId: incomeCatId,
          amount: '250000',
          description: 'Bonus',
        });
      expect(replayRes.status).toBe(201);
      expect(replayRes.body.id).toBe(createRes.body.id);

      // Cross-user IDOR (T-02): User B cannot read User A's income -> 404
      const idorRes = await request(server)
        .get(`/api/v1/incomes/${createRes.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(idorRes.status).toBe(404);

      // Same Idempotency-Key with modified amount -> 409 Conflict
      const conflictRes = await request(server)
        .post('/api/v1/incomes')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', idemKey)
        .send({
          categoryId: incomeCatId,
          amount: '300000',
          description: 'Bonus',
        });
      expect(conflictRes.status).toBe(409);

      // VND account rejects decimal precision "100.50" -> 422 RFC 9457
      const expCatsA = await request(server)
        .get('/api/v1/categories?kind=EXPENSE')
        .set('Authorization', `Bearer ${tokenA}`);
      const expenseCatId = expCatsA.body[0].id as string;

      const decimalVndRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          categoryId: expenseCatId,
          amount: '100.50',
        });
      expect(decimalVndRes.status).toBe(422);
      expect(decimalVndRes.body.code).toBe('INVALID_CURRENCY_PRECISION');

      // Quick-Log expense omitting accountId -> resolves to "Sổ chung" and updates balance
      const expCreateRes = await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          categoryId: expenseCatId,
          amount: '50000',
        });
      expect(expCreateRes.status).toBe(201);
      expect(expCreateRes.body.accountId).toBe(regA.body.defaultAccount.id);
      expect(expCreateRes.body.accountPostedBalanceMinor).toBe('200000');

      // Last active account cannot be archived -> 422
      const archiveGuardRes = await request(server)
        .post(`/api/v1/accounts/${regA.body.defaultAccount.id}/archive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(archiveGuardRes.status).toBe(422);
      expect(archiveGuardRes.body.code).toBe('LAST_ACTIVE_ACCOUNT_CANNOT_BE_ARCHIVED');

      // Cursor pagination across account ledger
      const page1 = await request(server)
        .get(`/api/v1/accounts/${regA.body.defaultAccount.id}/ledger?limit=1`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.hasMore).toBe(true);
      expect(typeof page1.body.nextCursor).toBe('string');

      const page2 = await request(server)
        .get(
          `/api/v1/accounts/${regA.body.defaultAccount.id}/ledger?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
        )
        .set('Authorization', `Bearer ${tokenA}`);
      expect(page2.status).toBe(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
      expect(page2.body.hasMore).toBe(false);
    });
  });
});
