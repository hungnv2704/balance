import { AccountType, CategoryKind, EntryType, TransactionStatus } from '@pfm/shared-types';
import { AccountsService } from '../src/modules/accounts/accounts.service';
import { DefaultAccountResolver } from '../src/modules/accounts/default-account.resolver';
import { AuthService, DEFAULT_ACCOUNT_NAME } from '../src/modules/auth/auth.service';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service';
import { TokenService } from '../src/modules/auth/token.service';
import { CategoriesService } from '../src/modules/categories/categories.service';
import {
  AuthenticationException,
  InvalidStateTransitionException,
  LastActiveAccountException,
  ResourceNotFoundException,
} from '../src/shared-kernel/domain/domain-exceptions';
import { IdempotencyService } from '../src/shared-kernel/idempotency/idempotency.service';
import {
  InMemoryAccountsRepository,
  InMemoryAuditRepository,
  InMemoryAuthRepository,
  InMemoryCategoriesRepository,
  InMemoryDatabase,
  InMemoryIdempotencyRepository,
  InMemoryLedgerRepository,
  TEST_APP_CONFIG,
} from './helpers/in-memory-backend';

function createAuthAndAccountHarness() {
  const db = new InMemoryDatabase();
  const authRepo = new InMemoryAuthRepository(db);
  const accountsRepo = new InMemoryAccountsRepository(db);
  const categoriesRepo = new InMemoryCategoriesRepository(db);
  const ledgerRepo = new InMemoryLedgerRepository(db);
  const auditRepo = new InMemoryAuditRepository(db);
  const idempotencyRepo = new InMemoryIdempotencyRepository(db);
  const idempotencyService = new IdempotencyService(idempotencyRepo);
  const passwordHasher = new PasswordHasherService(TEST_APP_CONFIG);
  const tokenService = new TokenService(TEST_APP_CONFIG);

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
  const categoriesService = new CategoriesService(db, categoriesRepo, auditRepo);
  const defaultAccountResolver = new DefaultAccountResolver(accountsRepo);

  return {
    db,
    authService,
    accountsService,
    categoriesService,
    defaultAccountResolver,
    passwordHasher,
    ledgerRepo,
  };
}

describe('AuthModule, Sổ chung Provisioning, & AccountsModule Guards (In-Memory)', () => {
  it('registers user with Argon2id hash and atomically provisions default "Sổ chung" account + starter categories', async () => {
    const { db, authService, accountsService, categoriesService } = createAuthAndAccountHarness();

    const result = await authService.register(
      {
        email: 'Alice@Example.com ',
        password: 'StrongPassword1234!',
        fullName: 'Alice Nguyen',
        baseCurrencyCode: 'VND',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      'Jest-Agent/1.0',
    );

    expect(result.response.user.email).toBe('alice@example.com');
    expect(result.response.defaultAccount).toBeDefined();
    expect(result.response.defaultAccount!.name).toBe(DEFAULT_ACCOUNT_NAME);
    expect(result.response.defaultAccount!.isDefault).toBe(true);
    expect(result.response.defaultAccount!.openingBalanceMinor).toBe('0');
    expect(result.response.defaultAccount!.postedBalanceMinor).toBe('0');
    expect(result.response.defaultAccount!.currencyCode).toBe('VND');

    const storedUser = db.state.users.get(result.response.user.id)!;
    expect(storedUser.passwordHash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(storedUser.passwordHash).not.toContain('StrongPassword1234!');

    const accounts = await accountsService.listAccounts(result.response.user.id);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Sổ chung');

    const incomeCats = await categoriesService.list(result.response.user.id, CategoryKind.INCOME);
    const expenseCats = await categoriesService.list(result.response.user.id, CategoryKind.EXPENSE);
    expect(incomeCats.length).toBeGreaterThanOrEqual(2);
    expect(expenseCats.length).toBeGreaterThanOrEqual(2);
  });

  it('rotates refresh tokens and revokes entire token family on reuse detection (T-01)', async () => {
    const { db, authService } = createAuthAndAccountHarness();

    const reg = await authService.register({
      email: 'bob@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Bob Tran',
    });

    const token1 = reg.rawRefreshToken;
    const rotated = await authService.refresh(token1, 'Jest-Agent/1.0');
    const token2 = rotated.rawRefreshToken;
    expect(token2).not.toBe(token1);

    // Attacker replays revoked token1 -> reuse detected!
    await expect(authService.refresh(token1, 'Attacker-UA')).rejects.toThrow(
      AuthenticationException,
    );

    // Entire token family must now be revoked, so legitimate token2 is also rejected
    await expect(authService.refresh(token2, 'Jest-Agent/1.0')).rejects.toThrow(
      AuthenticationException,
    );

    const reuseAudit = db.state.auditLogs.find(
      (a) => a.input.action === 'REFRESH_TOKEN_REUSE_DETECTED',
    );
    expect(reuseAudit).toBeDefined();
  });

  it('enforces last-active-account and default-account archive guards (BR-ACC-05)', async () => {
    const { authService, accountsService } = createAuthAndAccountHarness();
    const reg = await authService.register({
      email: 'carol@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Carol Le',
    });

    const userId = reg.response.user.id;
    const defaultAccountId = reg.response.defaultAccount!.id;

    // Cannot archive "Sổ chung" when it is the last active account
    await expect(accountsService.archiveAccount(userId, defaultAccountId)).rejects.toThrow(
      LastActiveAccountException,
    );

    // Create a second account
    const vcb = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'VCB',
      accountType: AccountType.BANK,
      currencyCode: 'VND',
      openingBalance: '5000000',
    });

    // Cannot archive default account without reassigning default
    await expect(accountsService.archiveAccount(userId, defaultAccountId)).rejects.toThrow(
      LastActiveAccountException,
    );

    // Can archive non-default second account
    const archivedVcb = await accountsService.archiveAccount(userId, vcb.id);
    expect(archivedVcb.archivedAt).not.toBeNull();

    // Now defaultAccount is last active again -> archive blocked
    await expect(accountsService.archiveAccount(userId, defaultAccountId)).rejects.toThrow(
      LastActiveAccountException,
    );

    // Create another account and archive old default while reassigning default atomically
    const savings = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'Savings',
      accountType: AccountType.SAVINGS,
      currencyCode: 'VND',
    });
    await accountsService.archiveAccount(userId, defaultAccountId, {
      replacementDefaultAccountId: savings.id,
    });

    const refreshedSavings = await accountsService.getAccount(userId, savings.id);
    expect(refreshedSavings.isDefault).toBe(true);
  });

  it('locks account currency after transactions exist and updates empty default account on base currency preference change (BR-ACC-04)', async () => {
    const { db, authService, accountsService, categoriesService, ledgerRepo } =
      createAuthAndAccountHarness();

    const reg = await authService.register({
      email: 'dave@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Dave Pham',
      baseCurrencyCode: 'VND',
    });
    const userId = reg.response.user.id;
    const defaultAccId = reg.response.defaultAccount!.id;

    // 0 transactions -> changing baseCurrencyCode updates empty "Sổ chung"
    await authService.updatePreferences(userId, { baseCurrencyCode: 'USD' });
    const afterPrefChange = await accountsService.getAccount(userId, defaultAccId);
    expect(afterPrefChange.currencyCode).toBe('USD');

    // Insert 1 transaction on the account
    const cats = await categoriesService.list(userId, CategoryKind.INCOME);
    await db.withTransaction((tx) =>
      ledgerRepo.insert(tx, {
        userId,
        accountId: defaultAccId,
        entryType: EntryType.INCOME,
        status: TransactionStatus.POSTED,
        amountMinor: 1000n,
        currencyCode: 'USD',
        transactionDate: '2026-11-23',
        categoryId: cats[0].id,
      }),
    );

    // Currency change on account must now be rejected
    await expect(
      accountsService.updateAccount(userId, defaultAccId, { currencyCode: 'EUR' }),
    ).rejects.toThrow(InvalidStateTransitionException);

    // Changing user baseCurrencyCode must NOT mutate account currency once transactions exist
    await authService.updatePreferences(userId, { baseCurrencyCode: 'EUR' });
    const afterTxPrefChange = await accountsService.getAccount(userId, defaultAccId);
    expect(afterTxPrefChange.currencyCode).toBe('USD');
  });

  it('enforces cross-user isolation (returns 404 ResourceNotFoundException for User B accessing User A account)', async () => {
    const { authService, accountsService } = createAuthAndAccountHarness();

    const userA = await authService.register({
      email: 'usera@example.com',
      password: 'StrongPassword1234!',
      fullName: 'User A',
    });
    const userB = await authService.register({
      email: 'userb@example.com',
      password: 'StrongPassword1234!',
      fullName: 'User B',
    });

    const userAAccountId = userA.response.defaultAccount!.id;

    await expect(accountsService.getAccount(userB.response.user.id, userAAccountId)).rejects.toThrow(
      ResourceNotFoundException,
    );
    await expect(
      accountsService.updateAccount(userB.response.user.id, userAAccountId, { name: 'Hacked' }),
    ).rejects.toThrow(ResourceNotFoundException);
    await expect(
      accountsService.archiveAccount(userB.response.user.id, userAAccountId),
    ).rejects.toThrow(ResourceNotFoundException);
  });
});
