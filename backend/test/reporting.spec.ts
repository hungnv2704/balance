import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AccountType, CategoryKind, TransactionStatus } from '@pfm/shared-types';
import { ResourceNotFoundException } from '../src/shared-kernel/domain/domain-exceptions';
import { createFullHttpTestApp, createFullServiceHarness } from './helpers/test-app';

describe('Slice 5 — ReportingModule (Currency-Isolated Balances & Net Cash Flow)', () => {
  it('reconciles Net Cash Flow per docs/08 worked example: excludes transfers, adjustments, opening balances, and non-POSTED records', async () => {
    const {
      authService,
      accountsService,
      categoriesService,
      incomeService,
      expenseService,
      transfersService,
      reportingService,
    } = createFullServiceHarness();

    const reg = await authService.register({
      email: 'rpt@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Report User',
      baseCurrencyCode: 'VND',
    });
    const userId = reg.response.user.id;
    const cashAccId = reg.response.defaultAccount!.id;

    // Opening balance 10,000,000 VND (must be excluded from cash-flow, included in balances)
    const bankVnd = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'VCB VND',
      accountType: AccountType.BANK,
      currencyCode: 'VND',
      openingBalance: '10000000',
    });

    // Multi-currency USD account (must never be mixed into VND totals)
    const bankUsd = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'USD Savings',
      accountType: AccountType.SAVINGS,
      currencyCode: 'USD',
      openingBalance: '1000.00',
    });

    const incCat = (await categoriesService.list(userId, CategoryKind.INCOME))[0];
    const expCats = await categoriesService.list(userId, CategoryKind.EXPENSE);
    const foodCat = expCats[0];
    const shopCat = expCats[1];

    // POSTED Income 30,000,000 VND + DRAFT Income 5,000,000 VND (excluded)
    await incomeService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/incomes', {
      accountId: bankVnd.id,
      categoryId: incCat.id,
      amount: '30000000',
      transactionDate: '2026-11-05',
      status: TransactionStatus.POSTED,
    });
    await incomeService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/incomes', {
      accountId: bankVnd.id,
      categoryId: incCat.id,
      amount: '5000000',
      transactionDate: '2026-11-06',
      status: TransactionStatus.DRAFT,
    });

    // POSTED Expenses: 7,000,000 (Food) + 5,000,000 (Shopping) = 12,000,000 VND
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      accountId: bankVnd.id,
      categoryId: foodCat.id,
      amount: '7000000',
      transactionDate: '2026-11-10',
    });
    const shopExp = await expenseService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/expenses',
      {
        accountId: bankVnd.id,
        categoryId: shopCat.id,
        amount: '5000000',
        transactionDate: '2026-11-11',
      },
    );

    // PENDING Expense 900,000 VND (excluded from cash flow and posted balance)
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      accountId: bankVnd.id,
      categoryId: foodCat.id,
      amount: '900000',
      transactionDate: '2026-11-12',
      status: TransactionStatus.PENDING,
    });

    // POSTED Expense Refund 1,000,000 VND against Shopping expense
    await expenseService.createRefund(
      userId,
      'Asia/Ho_Chi_Minh',
      shopExp.body.id,
      randomUUID(),
      `/api/v1/expenses/${shopExp.body.id}/refunds`,
      { amount: '1000000', transactionDate: '2026-11-13' },
    );

    // Internal Transfer 5,000,000 VND (must be excluded from Net Cash Flow)
    await transfersService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/transfers', {
      fromAccountId: bankVnd.id,
      toAccountId: cashAccId,
      fromAmount: '5000000',
      transferDate: '2026-11-15',
    });

    // Balance Adjustment CREDIT 2,000,000 VND (must be excluded from Net Cash Flow)
    await accountsService.createBalanceAdjustment(
      userId,
      'Asia/Ho_Chi_Minh',
      cashAccId,
      randomUUID(),
      `/api/v1/accounts/${cashAccId}/adjustments`,
      {
        direction: 'CREDIT',
        amount: '2000000',
        transactionDate: '2026-11-16',
      },
    );

    // USD activity (separate currency bucket)
    await incomeService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/incomes', {
      accountId: bankUsd.id,
      categoryId: incCat.id,
      amount: '250.00',
      transactionDate: '2026-11-18',
    });
    await expenseService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/expenses', {
      accountId: bankUsd.id,
      categoryId: foodCat.id,
      amount: '40.50',
      transactionDate: '2026-11-19',
    });

    // 1. Verify Balances Report (strictly grouped by currency)
    const balances = await reportingService.getBalancesReport(userId, 'VND', {});
    expect(balances.currencies).toHaveLength(2);
    const vndBal = balances.currencies.find((c) => c.currencyCode === 'VND')!;
    const usdBal = balances.currencies.find((c) => c.currencyCode === 'USD')!;

    // VND total posted = 10M opening + 30M inc - 12M exp + 1M refund + 2M adj = 31,000,000 (transfer cancels out across wallets!)
    expect(vndBal.totalOpeningBalanceMinor).toBe('10000000');
    expect(vndBal.totalPostedBalanceMinor).toBe('31000000');
    expect(vndBal.totalPendingOutMinor).toBe('900000');
    expect(vndBal.accounts).toHaveLength(2);

    // USD total posted = 1000.00 + 250.00 - 40.50 = 1209.50 USD (120950 minor)
    expect(usdBal.totalPostedBalanceMinor).toBe('120950');

    // 2. Verify Cash Flow Report (VND & USD separated)
    const cashFlow = await reportingService.getCashFlowReport(userId, 'Asia/Ho_Chi_Minh', 'VND', {
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(cashFlow.currencies).toHaveLength(2);

    const vndCf = cashFlow.currencies.find((c) => c.currencyCode === 'VND')!;
    expect(vndCf.totalIncomeMinor).toBe('30000000');
    expect(vndCf.grossExpenseMinor).toBe('12000000');
    expect(vndCf.totalRefundMinor).toBe('1000000');
    expect(vndCf.netExpenseMinor).toBe('11000000');
    // 30,000,000 - (12,000,000 - 1,000,000) = +19,000,000
    expect(vndCf.netCashFlowMinor).toBe('19000000');

    // Drill-down byCategory breakdown
    const shopBreakdown = vndCf.byCategory.find((b) => b.categoryId === shopCat.id)!;
    expect(shopBreakdown.grossMinor).toBe('5000000');
    expect(shopBreakdown.refundMinor).toBe('1000000');
    expect(shopBreakdown.netMinor).toBe('4000000');
    expect(shopBreakdown.transactionCount).toBe(2);

    const usdCf = cashFlow.currencies.find((c) => c.currencyCode === 'USD')!;
    expect(usdCf.totalIncomeMinor).toBe('25000');
    expect(usdCf.grossExpenseMinor).toBe('4050');
    expect(usdCf.netCashFlowMinor).toBe('20950');

    // Empty range with currency filter returns zeroed VND bucket
    const emptyCf = await reportingService.getCashFlowReport(userId, 'Asia/Ho_Chi_Minh', 'VND', {
      from: '2026-01-01',
      to: '2026-01-31',
      currency: 'VND',
    });
    expect(emptyCf.currencies).toHaveLength(1);
    expect(emptyCf.currencies[0].netCashFlowMinor).toBe('0');
    expect(emptyCf.currencies[0].byCategory).toEqual([]);
  });

  it('rejects cross-user accountId filter with 404 on cash-flow report', async () => {
    const { authService, reportingService } = createFullServiceHarness();

    const userA = await authService.register({
      email: 'rpt-a@example.com',
      password: 'StrongPassword1234!',
      fullName: 'User A',
    });
    const userB = await authService.register({
      email: 'rpt-b@example.com',
      password: 'StrongPassword1234!',
      fullName: 'User B',
    });

    await expect(
      reportingService.getCashFlowReport(
        userA.response.user.id,
        'Asia/Ho_Chi_Minh',
        'VND',
        {
          from: '2026-11-01',
          to: '2026-11-30',
          accountId: userB.response.defaultAccount!.id,
        },
      ),
    ).rejects.toThrow(ResourceNotFoundException);
  });

  describe('HTTP Pipeline: Reporting Endpoints', () => {
    let app: INestApplication;

    beforeAll(async () => {
      ({ app } = await createFullHttpTestApp());
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves GET /api/v1/reports/balances and GET /api/v1/reports/cash-flow', async () => {
      const server = app.getHttpServer();
      const reg = await request(server).post('/api/v1/auth/register').send({
        email: 'http-rpt@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP Report',
      });
      const token = reg.body.accessToken as string;

      const expCats = await request(server)
        .get('/api/v1/categories?kind=EXPENSE')
        .set('Authorization', `Bearer ${token}`);
      const catId = expCats.body[0].id as string;

      await request(server)
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ categoryId: catId, amount: '250000', transactionDate: '2026-11-22' });

      const balRes = await request(server)
        .get('/api/v1/reports/balances')
        .set('Authorization', `Bearer ${token}`);
      expect(balRes.status).toBe(200);
      expect(balRes.body.currencies[0].currencyCode).toBe('VND');
      expect(balRes.body.currencies[0].totalPostedBalanceMinor).toBe('-250000');

      const cfRes = await request(server)
        .get('/api/v1/reports/cash-flow?from=2026-11-01&to=2026-11-30&currency=VND')
        .set('Authorization', `Bearer ${token}`);
      expect(cfRes.status).toBe(200);
      expect(cfRes.body.currencies[0].grossExpenseMinor).toBe('250000');
      expect(cfRes.body.currencies[0].netCashFlowMinor).toBe('-250000');
      expect(cfRes.body.currencies[0].byCategory).toHaveLength(1);
    });
  });
});
