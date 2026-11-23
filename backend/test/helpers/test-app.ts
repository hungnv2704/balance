import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { APP_CONFIG, AppConfig } from '../../src/config/app-config';
import { DATABASE_EXECUTOR } from '../../src/database/database.types';
import { configureHttpApp } from '../../src/main';
import { ACCOUNTS_REPOSITORY } from '../../src/modules/accounts/accounts.repository';
import { AccountsService } from '../../src/modules/accounts/accounts.service';
import { DefaultAccountResolver } from '../../src/modules/accounts/default-account.resolver';
import { ATTACHMENTS_REPOSITORY } from '../../src/modules/attachments/attachments.repository';
import { AttachmentsService } from '../../src/modules/attachments/attachments.service';
import {
  ATTACHMENT_STORAGE_DIR,
  LocalAttachmentStorage,
} from '../../src/modules/attachments/local-attachment.storage';
import { AUDIT_REPOSITORY } from '../../src/modules/audit/audit.repository';
import { AUTH_REPOSITORY } from '../../src/modules/auth/auth.repository';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PasswordHasherService } from '../../src/modules/auth/password-hasher.service';
import { TokenService } from '../../src/modules/auth/token.service';
import { BUDGETS_REPOSITORY } from '../../src/modules/budgets/budgets.repository';
import { BudgetsService } from '../../src/modules/budgets/budgets.service';
import { CATEGORIES_REPOSITORY } from '../../src/modules/categories/categories.repository';
import { CategoriesService } from '../../src/modules/categories/categories.service';
import { DataOpsService } from '../../src/modules/data-ops/data-ops.service';
import { ExpenseService } from '../../src/modules/expense/expense.service';
import { MERCHANTS_REPOSITORY } from '../../src/modules/expense/merchants.repository';
import { ImportsService } from '../../src/modules/imports/imports.service';
import { INCOME_SOURCES_REPOSITORY } from '../../src/modules/income/income-sources.repository';
import { IncomeService } from '../../src/modules/income/income.service';
import { LEDGER_REPOSITORY } from '../../src/modules/ledger/ledger.repository';
import { MFA_REPOSITORY } from '../../src/modules/mfa/mfa.repository';
import { MfaService } from '../../src/modules/mfa/mfa.service';
import { RECURRING_REPOSITORY } from '../../src/modules/recurring/recurring.repository';
import { RecurringService } from '../../src/modules/recurring/recurring.service';
import { REPORTING_REPOSITORY } from '../../src/modules/reporting/reporting.repository';
import { ReportingService } from '../../src/modules/reporting/reporting.service';
import { TRANSFERS_REPOSITORY } from '../../src/modules/transfers/transfers.repository';
import { TransfersService } from '../../src/modules/transfers/transfers.service';
import { IdempotencyService } from '../../src/shared-kernel/idempotency/idempotency.service';
import { IDEMPOTENCY_REPOSITORY } from '../../src/shared-kernel/idempotency/idempotency.types';
import {
  InMemoryAccountsRepository,
  InMemoryAttachmentsRepository,
  InMemoryAuditRepository,
  InMemoryAuthRepository,
  InMemoryBudgetsRepository,
  InMemoryCategoriesRepository,
  InMemoryDatabase,
  InMemoryIdempotencyRepository,
  InMemoryIncomeSourcesRepository,
  InMemoryLedgerRepository,
  InMemoryMerchantsRepository,
  InMemoryMfaRepository,
  InMemoryRecurringRepository,
  InMemoryReportingRepository,
  InMemoryTransfersRepository,
  TEST_APP_CONFIG,
} from './in-memory-backend';

export function createFullServiceHarness() {
  const db = new InMemoryDatabase();
  const authRepo = new InMemoryAuthRepository(db);
  const accountsRepo = new InMemoryAccountsRepository(db);
  const categoriesRepo = new InMemoryCategoriesRepository(db);
  const ledgerRepo = new InMemoryLedgerRepository(db);
  const incomeSourcesRepo = new InMemoryIncomeSourcesRepository(db);
  const merchantsRepo = new InMemoryMerchantsRepository(db);
  const transfersRepo = new InMemoryTransfersRepository(db);
  const reportingRepo = new InMemoryReportingRepository(db);
  const budgetsRepo = new InMemoryBudgetsRepository(db);
  const recurringRepo = new InMemoryRecurringRepository(db);
  const idempotencyRepo = new InMemoryIdempotencyRepository(db);
  const auditRepo = new InMemoryAuditRepository(db);
  const mfaRepo = new InMemoryMfaRepository(db);
  const attachmentsRepo = new InMemoryAttachmentsRepository(db);
  const attachmentStorageDir = path.join(os.tmpdir(), `pfm-test-attachments-${randomUUID()}`);
  const attachmentStorage = new LocalAttachmentStorage(attachmentStorageDir);

  const idempotencyService = new IdempotencyService(idempotencyRepo);
  const passwordHasher = new PasswordHasherService(TEST_APP_CONFIG);
  const tokenService = new TokenService(TEST_APP_CONFIG);
  const categoriesService = new CategoriesService(db, categoriesRepo, auditRepo);
  const defaultAccountResolver = new DefaultAccountResolver(accountsRepo);
  const mfaService = new MfaService(
    db,
    authRepo,
    mfaRepo,
    auditRepo,
    passwordHasher,
    TEST_APP_CONFIG,
  );
  const attachmentsService = new AttachmentsService(
    db,
    ledgerRepo,
    attachmentsRepo,
    auditRepo,
    attachmentStorage,
  );

  const authService = new AuthService(
    db,
    authRepo,
    accountsRepo,
    categoriesRepo,
    ledgerRepo,
    auditRepo,
    passwordHasher,
    tokenService,
    mfaService,
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
  const transfersService = new TransfersService(
    db,
    transfersRepo,
    accountsRepo,
    ledgerRepo,
    categoriesRepo,
    auditRepo,
    idempotencyService,
  );
  const reportingService = new ReportingService(
    db,
    accountsRepo,
    ledgerRepo,
    reportingRepo,
  );
  const budgetsService = new BudgetsService(
    db,
    budgetsRepo,
    categoriesRepo,
    auditRepo,
    categoriesService,
  );
  const recurringService = new RecurringService(
    db,
    recurringRepo,
    ledgerRepo,
    auditRepo,
    defaultAccountResolver,
    categoriesService,
    idempotencyService,
  );
  const dataOpsService = new DataOpsService(
    db,
    authRepo,
    accountsRepo,
    categoriesRepo,
    incomeSourcesRepo,
    merchantsRepo,
    transfersRepo,
    ledgerRepo,
    budgetsRepo,
    auditRepo,
    passwordHasher,
  );
  const importsService = new ImportsService(
    db,
    categoriesRepo,
    ledgerRepo,
    incomeSourcesRepo,
    merchantsRepo,
    auditRepo,
    defaultAccountResolver,
    categoriesService,
    idempotencyService,
  );

  return {
    db,
    authRepo,
    accountsRepo,
    categoriesRepo,
    ledgerRepo,
    incomeSourcesRepo,
    merchantsRepo,
    transfersRepo,
    reportingRepo,
    budgetsRepo,
    recurringRepo,
    idempotencyRepo,
    auditRepo,
    mfaRepo,
    attachmentsRepo,
    attachmentStorage,
    attachmentStorageDir,
    idempotencyService,
    passwordHasher,
    tokenService,
    categoriesService,
    defaultAccountResolver,
    mfaService,
    attachmentsService,
    authService,
    accountsService,
    incomeService,
    expenseService,
    transfersService,
    reportingService,
    budgetsService,
    recurringService,
    dataOpsService,
    importsService,
  };
}

export async function createFullHttpTestApp(
  configOverrides: Partial<AppConfig> = {},
): Promise<{
  app: INestApplication;
  db: InMemoryDatabase;
  accountsRepo: InMemoryAccountsRepository;
  attachmentStorageDir: string;
}> {
  const db = new InMemoryDatabase();
  const accountsRepo = new InMemoryAccountsRepository(db);
  const attachmentStorageDir =
    configOverrides.attachmentStorageDir ??
    path.join(os.tmpdir(), `pfm-http-attachments-${randomUUID()}`);
  const config: AppConfig = {
    ...TEST_APP_CONFIG,
    ...configOverrides,
    attachmentStorageDir,
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(DATABASE_EXECUTOR)
    .useValue(db)
    .overrideProvider(AUTH_REPOSITORY)
    .useValue(new InMemoryAuthRepository(db))
    .overrideProvider(MFA_REPOSITORY)
    .useValue(new InMemoryMfaRepository(db))
    .overrideProvider(ACCOUNTS_REPOSITORY)
    .useValue(accountsRepo)
    .overrideProvider(CATEGORIES_REPOSITORY)
    .useValue(new InMemoryCategoriesRepository(db))
    .overrideProvider(LEDGER_REPOSITORY)
    .useValue(new InMemoryLedgerRepository(db))
    .overrideProvider(INCOME_SOURCES_REPOSITORY)
    .useValue(new InMemoryIncomeSourcesRepository(db))
    .overrideProvider(MERCHANTS_REPOSITORY)
    .useValue(new InMemoryMerchantsRepository(db))
    .overrideProvider(TRANSFERS_REPOSITORY)
    .useValue(new InMemoryTransfersRepository(db))
    .overrideProvider(REPORTING_REPOSITORY)
    .useValue(new InMemoryReportingRepository(db))
    .overrideProvider(BUDGETS_REPOSITORY)
    .useValue(new InMemoryBudgetsRepository(db))
    .overrideProvider(RECURRING_REPOSITORY)
    .useValue(new InMemoryRecurringRepository(db))
    .overrideProvider(IDEMPOTENCY_REPOSITORY)
    .useValue(new InMemoryIdempotencyRepository(db))
    .overrideProvider(AUDIT_REPOSITORY)
    .useValue(new InMemoryAuditRepository(db))
    .overrideProvider(ATTACHMENTS_REPOSITORY)
    .useValue(new InMemoryAttachmentsRepository(db))
    .overrideProvider(ATTACHMENT_STORAGE_DIR)
    .useValue(attachmentStorageDir)
    .compile();

  const app = moduleRef.createNestApplication();
  configureHttpApp(app, config);
  await app.init();

  return { app, db, accountsRepo, attachmentStorageDir };
}
