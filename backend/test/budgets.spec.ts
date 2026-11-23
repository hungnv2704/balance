import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  AccountType,
  BudgetStatus,
  CategoryKind,
  TransactionStatus,
} from '@pfm/shared-types';
import { getLocalDateInTimezone } from '../src/shared-kernel/domain/date-time';
import {
  DomainConflictException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../src/shared-kernel/domain/domain-exceptions';
import { createFullHttpTestApp, createFullServiceHarness } from './helpers/test-app';

describe('Slice 6A — BudgetsModule (Thresholds 80%/100%, Currency Isolation, Timezone Boundaries)', () => {
  it('computes OK (<80%), WARNING (80%-99%), EXCEEDED (>=100%) with exact BIGINT arithmetic and EXPENSE_REFUND reduction', async () => {
    const {
      authService,
      categoriesService,
      expenseService,
      budgetsService,
    } = createFullServiceHarness();

    const reg = await authService.register({
      email: 'bdg-thresh@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Budget Thresholds',
      baseCurrencyCode: 'VND',
    });
    const userId = reg.response.user.id;
    const foodCat = (await categoriesService.list(userId, CategoryKind.EXPENSE))[0];

    const budget = await budgetsService.create(userId, 'Asia/Ho_Chi_Minh', {
      categoryId: foodCat.id,
      currencyCode: 'VND',
      limit: '5000000',
      month: '2026-11',
    });

    expect(budget.periodStart).toBe('2026-11-01');
    expect(budget.periodEnd).toBe('2026-11-30');
    expect(budget.status).toBe(BudgetStatus.OK);

    // Record 3,999,999 VND (79.99998%) -> strictly OK (not prematurely WARNING!)
    const exp1 = await expenseService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/expenses',
      {
        categoryId: foodCat.id,
        amount: '3999999',
        transactionDate: '2026-11-05',
      },
    );
    let current = await budgetsService.getOne(userId, budget.id);
    expect(current.actualSpentMinor).toBe('3999999');
    expect(current.status).toBe(BudgetStatus.OK);
    expect(current.percentUsed).toBeLessThan(80);

    // + 1 VND -> exact 4,000,000 VND (80%) -> WARNING
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      categoryId: foodCat.id,
      amount: '1',
      transactionDate: '2026-11-06',
    });
    current = await budgetsService.getOne(userId, budget.id);
    expect(current.actualSpentMinor).toBe('4000000');
    expect(current.remainingMinor).toBe('1000000');
    expect(current.percentUsed).toBe(80);
    expect(current.status).toBe(BudgetStatus.WARNING);

    // + 999,999 VND -> 4,999,999 VND (99.99998%) -> still WARNING (not prematurely EXCEEDED!)
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      categoryId: foodCat.id,
      amount: '999999',
      transactionDate: '2026-11-07',
    });
    current = await budgetsService.getOne(userId, budget.id);
    expect(current.actualSpentMinor).toBe('4999999');
    expect(current.status).toBe(BudgetStatus.WARNING);
    expect(current.percentUsed).toBeLessThan(100);

    // + 1,000,001 VND -> 6,000,000 VND (120%) -> EXCEEDED
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      categoryId: foodCat.id,
      amount: '1000001',
      transactionDate: '2026-11-08',
    });
    current = await budgetsService.getOne(userId, budget.id);
    expect(current.actualSpentMinor).toBe('6000000');
    expect(current.remainingMinor).toBe('-1000000');
    expect(current.percentUsed).toBe(120);
    expect(current.status).toBe(BudgetStatus.EXCEEDED);

    // Refund 2,500,000 VND against exp1 -> actualSpent drops to 3,500,000 (70%) -> back to OK!
    await expenseService.createRefund(
      userId,
      'Asia/Ho_Chi_Minh',
      exp1.body.id,
      randomUUID(),
      `/api/v1/expenses/${exp1.body.id}/refunds`,
      { amount: '2500000', transactionDate: '2026-11-09' },
    );
    current = await budgetsService.getOne(userId, budget.id);
    expect(current.grossExpenseMinor).toBe('6000000');
    expect(current.refundMinor).toBe('2500000');
    expect(current.actualSpentMinor).toBe('3500000');
    expect(current.remainingMinor).toBe('1500000');
    expect(current.percentUsed).toBe(70);
    expect(current.status).toBe(BudgetStatus.OK);
  });

  it('enforces currency isolation, POSTED-only status, and Asia/Ho_Chi_Minh timezone date boundaries', async () => {
    const {
      authService,
      accountsService,
      categoriesService,
      expenseService,
      budgetsService,
    } = createFullServiceHarness();

    const reg = await authService.register({
      email: 'bdg-iso@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Budget Isolation',
      baseCurrencyCode: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    const userId = reg.response.user.id;
    const vndAccId = reg.response.defaultAccount!.id;
    const usdAcc = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'USD Card',
      accountType: AccountType.CREDIT_CARD,
      currencyCode: 'USD',
    });

    const foodCat = (await categoriesService.list(userId, CategoryKind.EXPENSE))[0];
    const incomeCat = (await categoriesService.list(userId, CategoryKind.INCOME))[0];

    // Reject INCOME category on budget
    await expect(
      budgetsService.create(userId, 'Asia/Ho_Chi_Minh', {
        categoryId: incomeCat.id,
        currencyCode: 'VND',
        limit: '1000000',
        month: '2026-11',
      }),
    ).rejects.toThrow(ValidationDomainException);

    const novBudget = await budgetsService.create(userId, 'Asia/Ho_Chi_Minh', {
      categoryId: foodCat.id,
      currencyCode: 'VND',
      limit: '2000000',
      month: '2026-11',
    });
    const decBudget = await budgetsService.create(userId, 'Asia/Ho_Chi_Minh', {
      categoryId: foodCat.id,
      currencyCode: 'VND',
      limit: '2000000',
      month: '2026-12',
    });

    // Reject overlapping VND budget for same category & period
    await expect(
      budgetsService.create(userId, 'Asia/Ho_Chi_Minh', {
        categoryId: foodCat.id,
        currencyCode: 'VND',
        limit: '3000000',
        month: '2026-11',
      }),
    ).rejects.toThrow(DomainConflictException);

    // USD expense on the SAME category must NOT count toward VND budget
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      accountId: usdAcc.id,
      categoryId: foodCat.id,
      amount: '150.00',
      transactionDate: '2026-11-20',
    });

    // DRAFT expense must NOT count toward budget
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      accountId: vndAccId,
      categoryId: foodCat.id,
      amount: '500000',
      transactionDate: '2026-11-20',
      status: TransactionStatus.DRAFT,
    });

    // Timezone boundary:
    // 2026-11-30 23:45+07:00 == 2026-11-30T16:45:00Z -> 2026-11-30 -> November budget!
    const novBoundaryDate = getLocalDateInTimezone(
      new Date('2026-11-30T16:45:00.000Z'),
      'Asia/Ho_Chi_Minh',
    );
    expect(novBoundaryDate).toBe('2026-11-30');
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      accountId: vndAccId,
      categoryId: foodCat.id,
      amount: '400000',
      transactionDate: novBoundaryDate,
    });

    // 2026-12-01 01:00+07:00 == 2026-11-30T18:00:00Z -> 2026-12-01 -> December budget!
    const decBoundaryDate = getLocalDateInTimezone(
      new Date('2026-11-30T18:00:00.000Z'),
      'Asia/Ho_Chi_Minh',
    );
    expect(decBoundaryDate).toBe('2026-12-01');
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      accountId: vndAccId,
      categoryId: foodCat.id,
      amount: '600000',
      transactionDate: decBoundaryDate,
    });

    const novResult = await budgetsService.getOne(userId, novBudget.id);
    const decResult = await budgetsService.getOne(userId, decBudget.id);
    expect(novResult.actualSpentMinor).toBe('400000');
    expect(decResult.actualSpentMinor).toBe('600000');

    // Cross-user isolation -> 404
    const user2 = await authService.register({
      email: 'bdg-other@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Other User',
    });
    await expect(budgetsService.getOne(user2.response.user.id, novBudget.id)).rejects.toThrow(
      ResourceNotFoundException,
    );
  });

  describe('HTTP Pipeline: GET/POST/PATCH /api/v1/budgets', () => {
    let app: INestApplication;

    beforeAll(async () => {
      ({ app } = await createFullHttpTestApp());
    });

    afterAll(async () => {
      await app.close();
    });

    it('creates, lists, and updates budgets over HTTP with threshold computation', async () => {
      const server = app.getHttpServer();
      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'http-bdg@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP Budget',
      });
      const token = reg.body.accessToken as string;

      const cats = await request(server)
        .get('/api/v1/categories?kind=EXPENSE')
        .set('Authorization', `Bearer ${token}`);
      const foodCatId = cats.body[0].id as string;

      await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          categoryId: foodCatId,
          amount: '850000',
          transactionDate: '2026-11-15',
        });

      const createRes = await request(server)
        .post('/api/v1/budgets')
        .set('Authorization', `Bearer ${token}`)
        .send({
          categoryId: foodCatId,
          currencyCode: 'VND',
          limitMinor: '1000000',
          month: '2026-11',
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.actualSpentMinor).toBe('850000');
      expect(createRes.body.percentUsed).toBe(85);
      expect(createRes.body.status).toBe(BudgetStatus.WARNING);

      const patchRes = await request(server)
        .patch(`/api/v1/budgets/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ limitMinor: '2000000' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.limitMinor).toBe('2000000');
      expect(patchRes.body.percentUsed).toBe(42.5);
      expect(patchRes.body.status).toBe(BudgetStatus.OK);

      const listRes = await request(server)
        .get('/api/v1/budgets?month=2026-11&currency=VND')
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
    });
  });
});
