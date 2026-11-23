import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  AccountType,
  CategoryKind,
  EntryType,
  TransactionStatus,
} from '@pfm/shared-types';
import { calculateNextRunDate } from '../src/modules/recurring/recurring.types';
import {
  CurrencyMismatchException,
  InvalidStateTransitionException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../src/shared-kernel/domain/domain-exceptions';
import { createFullHttpTestApp, createFullServiceHarness } from './helpers/test-app';

describe('Slice 7 — RecurringModule (Date Math, Draft Generation, Idempotency & Isolation)', () => {
  describe('calculateNextRunDate Pure Date Math', () => {
    it('handles DAILY and WEEKLY schedules across month, year, and leap-day boundaries', () => {
      expect(calculateNextRunDate('2026-01-31', 'DAILY', 1)).toBe('2026-02-01');
      expect(calculateNextRunDate('2028-02-28', 'DAILY', 1)).toBe('2028-02-29');
      expect(calculateNextRunDate('2028-02-29', 'DAILY', 1)).toBe('2028-03-01');
      expect(calculateNextRunDate('2026-12-30', 'DAILY', 3)).toBe('2027-01-02');

      expect(calculateNextRunDate('2026-01-29', 'WEEKLY', 1)).toBe('2026-02-05');
      expect(calculateNextRunDate('2028-02-25', 'WEEKLY', 1)).toBe('2028-03-03');
      expect(calculateNextRunDate('2026-01-01', 'WEEKLY', 2)).toBe('2026-01-15');
    });

    it('clamps MONTHLY dates at month-end including leap-year Feb 29 and supports anchorDay', () => {
      // Non-leap year: Jan 31 -> Feb 28
      expect(calculateNextRunDate('2026-01-31', 'MONTHLY', 1)).toBe('2026-02-28');
      // Leap year: 2028-01-31 -> 2028-02-29
      expect(calculateNextRunDate('2028-01-31', 'MONTHLY', 1)).toBe('2028-02-29');
      // 30-day month clamping
      expect(calculateNextRunDate('2026-03-31', 'MONTHLY', 1)).toBe('2026-04-30');
      // Multi-month crossing year boundary
      expect(calculateNextRunDate('2026-11-30', 'MONTHLY', 3)).toBe('2027-02-28');
      expect(calculateNextRunDate('2026-01-31', 'MONTHLY', 25)).toBe('2028-02-29');
      // Preserving anchorDay when returning to 31-day month
      expect(calculateNextRunDate('2026-02-28', 'MONTHLY', 1, 31)).toBe('2026-03-31');
      expect(calculateNextRunDate('2026-02-28', 'MONTHLY', 1)).toBe('2026-03-28');
    });

    it('clamps YEARLY leap-day Feb 29 -> Feb 28 and restores on leap years with anchorDay', () => {
      expect(calculateNextRunDate('2028-02-29', 'YEARLY', 1)).toBe('2029-02-28');
      expect(calculateNextRunDate('2028-02-29', 'YEARLY', 4)).toBe('2032-02-29');
      expect(calculateNextRunDate('2029-02-28', 'YEARLY', 3, 29)).toBe('2032-02-29');
      expect(calculateNextRunDate('2026-05-15', 'YEARLY', 1)).toBe('2027-05-15');
    });

    it('rejects invalid calendar dates, non-positive intervalCount, and out-of-range anchorDay', () => {
      expect(() => calculateNextRunDate('2026-02-29', 'MONTHLY', 1)).toThrow(
        ValidationDomainException,
      );
      expect(() => calculateNextRunDate('2026-01-15', 'DAILY', 0)).toThrow(
        ValidationDomainException,
      );
      expect(() => calculateNextRunDate('2026-01-15', 'MONTHLY', 1, 32)).toThrow(
        ValidationDomainException,
      );
    });
  });

  describe('RecurringService Lifecycle, Draft Generation & Financial Invariants (In-Memory)', () => {
    it('generates DRAFT transactions without altering Posted Balance until confirmed POST, and is idempotent on re-run', async () => {
      const {
        authService,
        accountsService,
        categoriesService,
        incomeService,
        expenseService,
        recurringService,
      } = createFullServiceHarness();

      const reg = await authService.register({
        email: 'rec-draft@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Recurring Draft User',
        baseCurrencyCode: 'VND',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      const userId = reg.response.user.id;
      const defaultAccountId = reg.response.defaultAccount!.id;

      // Give account an opening income so Posted Balance is 10,000,000 VND
      const incomeCat = (await categoriesService.list(userId, CategoryKind.INCOME))[0];
      const expenseCat = (await categoriesService.list(userId, CategoryKind.EXPENSE))[0];

      await incomeService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/incomes', {
        categoryId: incomeCat.id,
        amount: '10000000',
        transactionDate: '2026-01-01',
      });

      // Omit accountId -> resolves to Default Account ("Sổ chung")
      const rentRule = await recurringService.create(userId, 'Asia/Ho_Chi_Minh', {
        ruleKind: CategoryKind.EXPENSE,
        categoryId: expenseCat.id,
        amountMinor: '3500000',
        frequency: 'MONTHLY',
        intervalCount: 1,
        nextRunDate: '2026-01-31',
      });
      expect(rentRule.accountId).toBe(defaultAccountId);
      expect(rentRule.currencyCode).toBe('VND');
      expect(rentRule.amountMinor).toBe('3500000');
      expect(rentRule.isActive).toBe(true);

      const salaryRule = await recurringService.create(userId, 'Asia/Ho_Chi_Minh', {
        ruleKind: CategoryKind.INCOME,
        categoryId: incomeCat.id,
        amount: '25000000',
        currencyCode: 'VND',
        frequency: 'MONTHLY',
        intervalCount: 1,
        nextRunDate: '2026-01-31',
      });

      // Run due on 2026-01-31 -> creates 2 DRAFT transactions, advances nextRunDate to 2026-02-28
      const idempKey1 = randomUUID();
      const run1 = await recurringService.runDue(
        userId,
        'Asia/Ho_Chi_Minh',
        idempKey1,
        '/api/v1/recurring-rules/run-due',
        { asOfDate: '2026-01-31' },
      );
      expect(run1.status).toBe(200);
      expect(run1.body.processedRules).toBe(2);
      expect(run1.body.generatedCount).toBe(2);
      expect(run1.body.skippedDuplicateCount).toBe(0);
      expect(run1.body.generatedTransactions).toHaveLength(2);
      for (const tx of run1.body.generatedTransactions) {
        expect(tx.status).toBe(TransactionStatus.DRAFT);
        expect(tx.transactionDate).toBe('2026-01-31');
        expect(tx.occurrenceDate).toBe('2026-01-31');
      }

      const updatedRent = await recurringService.getOne(userId, rentRule.id);
      const updatedSalary = await recurringService.getOne(userId, salaryRule.id);
      expect(updatedRent.nextRunDate).toBe('2026-02-28');
      expect(updatedSalary.nextRunDate).toBe('2026-02-28');

      // Posted Balance MUST remain unchanged (10,000,000 VND) because generated txs are DRAFT!
      const accBeforePost = await accountsService.getAccount(userId, defaultAccountId);
      expect(accBeforePost.postedBalanceMinor).toBe('10000000');

      // Re-run with SAME Idempotency-Key -> replays cached response, 0 duplicates
      const replay = await recurringService.runDue(
        userId,
        'Asia/Ho_Chi_Minh',
        idempKey1,
        '/api/v1/recurring-rules/run-due',
        { asOfDate: '2026-01-31' },
      );
      expect(replay.body).toEqual(run1.body);

      // Re-run with NEW Idempotency-Key for same asOfDate -> 0 due rules, 0 duplicates
      const run2 = await recurringService.runDue(
        userId,
        'Asia/Ho_Chi_Minh',
        randomUUID(),
        '/api/v1/recurring-rules/run-due',
        { asOfDate: '2026-01-31' },
      );
      expect(run2.body.processedRules).toBe(0);
      expect(run2.body.generatedCount).toBe(0);

      // Force nextRunDate back to 2026-01-31 via PATCH and re-run -> (recurring_rule_id, occurrence_date)
      // idempotency guard skips duplicate generation!
      await recurringService.update(userId, rentRule.id, {
        nextRunDate: '2026-01-31',
        amountMinor: '9999999',
      });
      const runForcedReplay = await recurringService.runDue(
        userId,
        'Asia/Ho_Chi_Minh',
        randomUUID(),
        '/api/v1/recurring-rules/run-due',
        { asOfDate: '2026-01-31' },
      );
      expect(runForcedReplay.body.processedRules).toBe(1);
      expect(runForcedReplay.body.generatedCount).toBe(0);
      expect(runForcedReplay.body.skippedDuplicateCount).toBe(1);

      // Verify editing rentRule did NOT mutate the already-generated DRAFT transaction!
      const generatedRentDraft = run1.body.generatedTransactions.find(
        (t) => t.recurringRuleId === rentRule.id,
      )!;
      const fetchedDraft = await expenseService.getOne(userId, generatedRentDraft.id);
      expect(fetchedDraft.amountMinor).toBe('3500000');
      expect(fetchedDraft.status).toBe(TransactionStatus.DRAFT);

      // Confirming (POSTing) the generated EXPENSE draft updates Posted Balance: 10,000,000 - 3,500,000 = 6,500,000
      const postedExpense = await expenseService.post(
        userId,
        generatedRentDraft.id,
        randomUUID(),
        `/api/v1/expenses/${generatedRentDraft.id}/post`,
      );
      expect(postedExpense.body.status).toBe(TransactionStatus.POSTED);
      expect(postedExpense.body.accountPostedBalanceMinor).toBe('6500000');
    });

    it('auto-deactivates rule when new nextRunDate > endDate and skips paused rules', async () => {
      const { authService, categoriesService, recurringService } = createFullServiceHarness();

      const reg = await authService.register({
        email: 'rec-end@example.com',
        password: 'StrongPassword1234!',
        fullName: 'Recurring End Date User',
      });
      const userId = reg.response.user.id;
      const expCat = (await categoriesService.list(userId, CategoryKind.EXPENSE))[0];

      // Leap year rule ending 2028-02-28 -> Jan 31 runs, nextRunDate = 2028-02-29 > 2028-02-28 -> deactivates!
      const endingRule = await recurringService.create(userId, 'Asia/Ho_Chi_Minh', {
        ruleKind: CategoryKind.EXPENSE,
        categoryId: expCat.id,
        amountMinor: '100000',
        frequency: 'MONTHLY',
        intervalCount: 1,
        nextRunDate: '2028-01-31',
        endDate: '2028-02-28',
      });

      // Second rule that we pause before running
      const pausedRule = await recurringService.create(userId, 'Asia/Ho_Chi_Minh', {
        ruleKind: CategoryKind.EXPENSE,
        categoryId: expCat.id,
        amountMinor: '200000',
        frequency: 'DAILY',
        intervalCount: 1,
        nextRunDate: '2028-01-31',
      });
      const pausedState = await recurringService.pause(userId, pausedRule.id);
      expect(pausedState.isActive).toBe(false);

      const runRes = await recurringService.runDue(
        userId,
        'Asia/Ho_Chi_Minh',
        randomUUID(),
        '/api/v1/recurring-rules/run-due',
        { asOfDate: '2028-01-31' },
      );

      expect(runRes.body.processedRules).toBe(1);
      expect(runRes.body.generatedCount).toBe(1);
      expect(runRes.body.generatedTransactions[0].recurringRuleId).toBe(endingRule.id);
      expect(runRes.body.deactivatedRuleIds).toEqual([endingRule.id]);

      const fetchedEnded = await recurringService.getOne(userId, endingRule.id);
      expect(fetchedEnded.nextRunDate).toBe('2028-02-29');
      expect(fetchedEnded.isActive).toBe(false);

      // Cannot resume expired rule whose nextRunDate > endDate
      await expect(recurringService.resume(userId, endingRule.id)).rejects.toThrow(
        InvalidStateTransitionException,
      );

      // Resuming pausedRule works and makes it eligible on next run-due
      const resumed = await recurringService.resume(userId, pausedRule.id);
      expect(resumed.isActive).toBe(true);

      const runRes2 = await recurringService.runDue(
        userId,
        'Asia/Ho_Chi_Minh',
        randomUUID(),
        '/api/v1/recurring-rules/run-due',
        { asOfDate: '2028-02-29' },
      );
      expect(runRes2.body.processedRules).toBe(1);
      expect(runRes2.body.generatedTransactions[0].recurringRuleId).toBe(pausedRule.id);
    });

    it('enforces cross-user isolation (404), ruleKind/category.kind mismatch (422), currency match, and amount > 0', async () => {
      const { authService, accountsService, categoriesService, recurringService } =
        createFullServiceHarness();

      const userA = await authService.register({
        email: 'rec-a@example.com',
        password: 'StrongPassword1234!',
        fullName: 'User A',
        baseCurrencyCode: 'VND',
      });
      const userB = await authService.register({
        email: 'rec-b@example.com',
        password: 'StrongPassword1234!',
        fullName: 'User B',
        baseCurrencyCode: 'VND',
      });

      const userAId = userA.response.user.id;
      const userBId = userB.response.user.id;
      const incCatA = (await categoriesService.list(userAId, CategoryKind.INCOME))[0];
      const expCatA = (await categoriesService.list(userAId, CategoryKind.EXPENSE))[0];
      const expCatB = (await categoriesService.list(userBId, CategoryKind.EXPENSE))[0];

      // ruleKind vs category.kind mismatch -> 422
      await expect(
        recurringService.create(userAId, 'Asia/Ho_Chi_Minh', {
          ruleKind: CategoryKind.EXPENSE,
          categoryId: incCatA.id,
          amountMinor: '100000',
          frequency: 'MONTHLY',
        }),
      ).rejects.toThrow(ValidationDomainException);

      await expect(
        recurringService.create(userAId, 'Asia/Ho_Chi_Minh', {
          ruleKind: CategoryKind.INCOME,
          categoryId: expCatA.id,
          amountMinor: '100000',
          frequency: 'MONTHLY',
        }),
      ).rejects.toThrow(ValidationDomainException);

      // Cross-user categoryId or accountId -> 404
      await expect(
        recurringService.create(userAId, 'Asia/Ho_Chi_Minh', {
          ruleKind: CategoryKind.EXPENSE,
          categoryId: expCatB.id,
          amountMinor: '100000',
          frequency: 'MONTHLY',
        }),
      ).rejects.toThrow(ResourceNotFoundException);

      await expect(
        recurringService.create(userAId, 'Asia/Ho_Chi_Minh', {
          ruleKind: CategoryKind.EXPENSE,
          accountId: userB.response.defaultAccount!.id,
          categoryId: expCatA.id,
          amountMinor: '100000',
          frequency: 'MONTHLY',
        }),
      ).rejects.toThrow(ResourceNotFoundException);

      // Currency mismatch with account currency -> 422
      await expect(
        recurringService.create(userAId, 'Asia/Ho_Chi_Minh', {
          ruleKind: CategoryKind.EXPENSE,
          categoryId: expCatA.id,
          amountMinor: '1000',
          currencyCode: 'USD',
          frequency: 'MONTHLY',
        }),
      ).rejects.toThrow(CurrencyMismatchException);

      // Amount <= 0 -> 422
      await expect(
        recurringService.create(userAId, 'Asia/Ho_Chi_Minh', {
          ruleKind: CategoryKind.EXPENSE,
          categoryId: expCatA.id,
          amountMinor: '0',
          frequency: 'MONTHLY',
        }),
      ).rejects.toThrow(ValidationDomainException);

      // Create valid rule for A, verify B gets 404 on get/update/pause/resume
      const ruleA = await recurringService.create(userAId, 'Asia/Ho_Chi_Minh', {
        ruleKind: CategoryKind.EXPENSE,
        categoryId: expCatA.id,
        amountMinor: '250000',
        frequency: 'WEEKLY',
      });

      await expect(recurringService.getOne(userBId, ruleA.id)).rejects.toThrow(
        ResourceNotFoundException,
      );
      await expect(
        recurringService.update(userBId, ruleA.id, { amountMinor: '300000' }),
      ).rejects.toThrow(ResourceNotFoundException);
      await expect(recurringService.pause(userBId, ruleA.id)).rejects.toThrow(
        ResourceNotFoundException,
      );
      await expect(recurringService.resume(userBId, ruleA.id)).rejects.toThrow(
        ResourceNotFoundException,
      );

      // Switching account on PATCH to a different currency account -> 422
      const usdAcc = await accountsService.createAccount(userAId, 'Asia/Ho_Chi_Minh', {
        name: 'USD Wallet',
        accountType: AccountType.BANK,
        currencyCode: 'USD',
      });
      await expect(
        recurringService.update(userAId, ruleA.id, { accountId: usdAcc.id }),
      ).rejects.toThrow(CurrencyMismatchException);
    });
  });

  describe('HTTP Pipeline: /api/v1/recurring-rules (Auth, Strict DTO, Idempotency & Cross-User)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      ({ app } = await createFullHttpTestApp());
    });

    afterAll(async () => {
      await app.close();
    });

    it('enforces AuthGuard, full CRUD + pause/resume + run-due HTTP contracts, strict DTO allowlist, and cross-user 404', async () => {
      const server = app.getHttpServer();

      // Unauthenticated -> 401
      const unauth = await request(server).get('/api/v1/recurring-rules');
      expect(unauth.status).toBe(401);

      const regA = await request(server).post('/api/v1/auth/register').send({
        email: 'http-rec-a@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP Rec A',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      const regB = await request(server).post('/api/v1/auth/register').send({
        email: 'http-rec-b@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP Rec B',
      });
      const tokenA = regA.body.accessToken as string;
      const tokenB = regB.body.accessToken as string;

      const catsA = await request(server)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${tokenA}`);
      const expCatA = catsA.body.find((c: { kind: string }) => c.kind === CategoryKind.EXPENSE);
      const incCatA = catsA.body.find((c: { kind: string }) => c.kind === CategoryKind.INCOME);

      // Category kind mismatch -> 422
      const mismatchRes = await request(server)
        .post('/api/v1/recurring-rules')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          ruleKind: CategoryKind.EXPENSE,
          categoryId: incCatA.id,
          amountMinor: '500000',
          frequency: 'MONTHLY',
          nextRunDate: '2026-01-31',
        });
      expect(mismatchRes.status).toBe(422);
      expect(mismatchRes.body.code).toBe('CATEGORY_KIND_MISMATCH');

      // Create valid recurring rule -> 201
      const createRes = await request(server)
        .post('/api/v1/recurring-rules')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          ruleKind: CategoryKind.EXPENSE,
          categoryId: expCatA.id,
          amountMinor: '1200000',
          frequency: 'MONTHLY',
          intervalCount: 1,
          nextRunDate: '2026-01-31',
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.accountId).toBe(regA.body.defaultAccount.id);
      expect(createRes.body.currencyCode).toBe('VND');
      expect(createRes.body.amountMinor).toBe('1200000');
      expect(createRes.body.isActive).toBe(true);

      const ruleId = createRes.body.id as string;

      // List -> { items: RecurringRuleDto[] }
      const listRes = await request(server)
        .get('/api/v1/recurring-rules')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.items).toHaveLength(1);
      expect(listRes.body.items[0].id).toBe(ruleId);

      // Strict DTO allowlist on PATCH rejects non-allowlisted fields (userId, ruleKind, isActive, unknownField) -> 400
      for (const badBody of [
        { userId: regB.body.user.id },
        { ruleKind: CategoryKind.INCOME },
        { isActive: false },
        { currencyCode: 'USD' },
        { unexpectedProperty: 'evil' },
      ]) {
        const badPatch = await request(server)
          .patch(`/api/v1/recurring-rules/${ruleId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send(badBody);
        expect(badPatch.status).toBe(400);
      }

      // Cross-user PATCH / pause / resume -> 404
      expect(
        (
          await request(server)
            .patch(`/api/v1/recurring-rules/${ruleId}`)
            .set('Authorization', `Bearer ${tokenB}`)
            .send({ amountMinor: '500000' })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(server)
            .post(`/api/v1/recurring-rules/${ruleId}/pause`)
            .set('Authorization', `Bearer ${tokenB}`)
        ).status,
      ).toBe(404);
      expect(
        (
          await request(server)
            .post(`/api/v1/recurring-rules/${ruleId}/resume`)
            .set('Authorization', `Bearer ${tokenB}`)
        ).status,
      ).toBe(404);

      // Missing Idempotency-Key on run-due -> 400
      const missingKeyRes = await request(server)
        .post('/api/v1/recurring-rules/run-due')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ asOfDate: '2026-01-31' });
      expect(missingKeyRes.status).toBe(400);
      expect(missingKeyRes.body.code).toBe('MISSING_IDEMPOTENCY_KEY');

      // Run due -> 200 RunDueRecurringResultDto
      const runKey = randomUUID();
      const runRes = await request(server)
        .post('/api/v1/recurring-rules/run-due')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', runKey)
        .send({ asOfDate: '2026-01-31' });
      expect(runRes.status).toBe(200);
      expect(runRes.body.generatedCount).toBe(1);
      expect(runRes.body.generatedTransactions[0].status).toBe(TransactionStatus.DRAFT);
      expect(runRes.body.generatedTransactions[0].entryType).toBe(EntryType.EXPENSE);
      expect(runRes.body.generatedTransactions[0].amountMinor).toBe('1200000');
      expect(runRes.body.updatedRules[0].nextRunDate).toBe('2026-02-28');

      const generatedTxId = runRes.body.generatedTransactions[0].id as string;

      // Same Idempotency-Key with different payload -> 409
      const conflictRes = await request(server)
        .post('/api/v1/recurring-rules/run-due')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', runKey)
        .send({ asOfDate: '2026-02-28' });
      expect(conflictRes.status).toBe(409);

      // PATCH rule amount -> must NOT mutate historical generated DRAFT transaction
      const patchRes = await request(server)
        .patch(`/api/v1/recurring-rules/${ruleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountMinor: '1500000' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.amountMinor).toBe('1500000');

      const histTxRes = await request(server)
        .get(`/api/v1/expenses/${generatedTxId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(histTxRes.status).toBe(200);
      expect(histTxRes.body.amountMinor).toBe('1200000');

      // Pause -> 200 isActive=false; Resume -> 200 isActive=true
      const pauseRes = await request(server)
        .post(`/api/v1/recurring-rules/${ruleId}/pause`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(pauseRes.status).toBe(200);
      expect(pauseRes.body.isActive).toBe(false);

      const resumeRes = await request(server)
        .post(`/api/v1/recurring-rules/${ruleId}/resume`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.isActive).toBe(true);
    });
  });
});
