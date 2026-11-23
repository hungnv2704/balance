import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  AccountType,
  CategoryKind,
  EntryType,
  TransactionStatus,
  TransferStatus,
} from '@pfm/shared-types';
import {
  InvalidStateTransitionException,
  ResourceNotFoundException,
  ValidationDomainException,
} from '../src/shared-kernel/domain/domain-exceptions';
import { createFullHttpTestApp, createFullServiceHarness } from './helpers/test-app';

describe('Slice 4 — TransfersModule (Atomic Transfers, Banker Rounding, Fees, Rollback)', () => {
  it('executes same-currency transfer atomically without counting as income or expense', async () => {
    const {
      authService,
      accountsService,
      categoriesService,
      incomeService,
      transfersService,
      reportingService,
    } = createFullServiceHarness();

    const reg = await authService.register({
      email: 'trf-same@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Transfer Same',
      baseCurrencyCode: 'VND',
    });
    const userId = reg.response.user.id;
    const acc1Id = reg.response.defaultAccount!.id;
    const acc2 = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'VCB',
      accountType: AccountType.BANK,
      currencyCode: 'VND',
      openingBalance: '500000',
    });

    const incCat = (await categoriesService.list(userId, CategoryKind.INCOME))[0];
    await incomeService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/incomes', {
      accountId: acc1Id,
      categoryId: incCat.id,
      amount: '10000000',
      transactionDate: '2026-11-10',
    });

    const res = await transfersService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/transfers',
      {
        fromAccountId: acc1Id,
        toAccountId: acc2.id,
        fromAmount: '2000000',
        transferDate: '2026-11-12',
        note: 'Move to bank',
      },
    );

    expect(res.status).toBe(201);
    expect(res.body.status).toBe(TransferStatus.POSTED);
    expect(res.body.fromAmountMinor).toBe('2000000');
    expect(res.body.toAmountMinor).toBe('2000000');
    expect(res.body.fromAccountPostedBalanceMinor).toBe('8000000');
    expect(res.body.toAccountPostedBalanceMinor).toBe('2500000');
    expect(res.body.fromTransaction?.entryType).toBe(EntryType.TRANSFER_OUT);
    expect(res.body.fromTransaction?.categoryId).toBeNull();
    expect(res.body.toTransaction?.entryType).toBe(EntryType.TRANSFER_IN);
    expect(res.body.toTransaction?.categoryId).toBeNull();
    expect(res.body.feeTransactionId).toBeNull();

    const cashFlow = await reportingService.getCashFlowReport(
      userId,
      'Asia/Ho_Chi_Minh',
      'VND',
      { from: '2026-11-01', to: '2026-11-30' },
    );
    expect(cashFlow.currencies).toHaveLength(1);
    expect(cashFlow.currencies[0].totalIncomeMinor).toBe('10000000');
    expect(cashFlow.currencies[0].grossExpenseMinor).toBe('0');
    expect(cashFlow.currencies[0].netCashFlowMinor).toBe('10000000');
  });

  it('applies Banker Rounding (Half-Even) on cross-currency transfers and stores exchange_rate + rate_source', async () => {
    const { authService, accountsService, transfersService } = createFullServiceHarness();

    const reg = await authService.register({
      email: 'trf-fx@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Transfer FX',
      baseCurrencyCode: 'VND',
    });
    const userId = reg.response.user.id;
    const vndAccId = reg.response.defaultAccount!.id;
    const usdAcc = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'USD Wallet',
      accountType: AccountType.BANK,
      currencyCode: 'USD',
      openingBalance: '500.00',
    });
    const eurAcc = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'EUR Wallet',
      accountType: AccountType.BANK,
      currencyCode: 'EUR',
      openingBalance: '0.00',
    });

    // 10.01 USD * 25450 = 254,754.5 -> Half-Even rounds to 254,754 VND
    const fx1 = await transfersService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/transfers',
      {
        fromAccountId: usdAcc.id,
        toAccountId: vndAccId,
        fromAmount: '10.01',
        exchangeRate: '25450',
        rateSource: 'VCB_FX_DESK',
        transferDate: '2026-11-15',
      },
    );
    expect(fx1.body.fromAmountMinor).toBe('1001');
    expect(fx1.body.fromCurrencyCode).toBe('USD');
    expect(fx1.body.toAmountMinor).toBe('254754');
    expect(fx1.body.toCurrencyCode).toBe('VND');
    expect(fx1.body.rateSource).toBe('VCB_FX_DESK');
    expect(fx1.body.exchangeRate).toBe('25450.00000000');

    // 0.05 USD * 0.5 = 2.5 minor -> 2 minor (even); 0.07 USD * 0.5 = 3.5 minor -> 4 minor (even)
    const fxEven = await transfersService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/transfers',
      {
        fromAccountId: usdAcc.id,
        toAccountId: eurAcc.id,
        fromAmount: '0.05',
        exchangeRate: '0.5',
      },
    );
    expect(fxEven.body.toAmountMinor).toBe('2');

    const fxOdd = await transfersService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/transfers',
      {
        fromAccountId: usdAcc.id,
        toAccountId: eurAcc.id,
        fromAmount: '0.07',
        exchangeRate: '0.5',
      },
    );
    expect(fxOdd.body.toAmountMinor).toBe('4');

    // Conflicting explicit toAmount and exchangeRate must be rejected
    await expect(
      transfersService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/transfers', {
        fromAccountId: usdAcc.id,
        toAccountId: vndAccId,
        fromAmount: '10.00',
        toAmount: '260000',
        exchangeRate: '25000',
      }),
    ).rejects.toThrow(ValidationDomainException);
  });

  it('models transfer fee (> 0) as separate EXPENSE under "Phí ngân hàng / Chuyển khoản" and atomically voids/reverses everything', async () => {
    const {
      db,
      authService,
      accountsService,
      categoriesService,
      transfersService,
      reportingService,
    } = createFullServiceHarness();

    const reg = await authService.register({
      email: 'trf-fee@example.com',
      password: 'StrongPassword1234!',
      fullName: 'Transfer Fee',
      baseCurrencyCode: 'VND',
    });
    const userId = reg.response.user.id;
    const vndAccId = reg.response.defaultAccount!.id;
    const usdAcc = await accountsService.createAccount(userId, 'Asia/Ho_Chi_Minh', {
      name: 'USD Bank',
      accountType: AccountType.BANK,
      currencyCode: 'USD',
      openingBalance: '500.00',
    });

    // Reject feeMinor <= 0
    await expect(
      transfersService.create(userId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/transfers', {
        fromAccountId: usdAcc.id,
        toAccountId: vndAccId,
        fromAmount: '100.00',
        exchangeRate: '25000',
        feeMinor: '0',
      }),
    ).rejects.toThrow(ValidationDomainException);

    // docs/08 worked example: 100.00 USD -> 2,500,000 VND + 2.00 USD fee
    const created = await transfersService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/transfers',
      {
        fromAccountId: usdAcc.id,
        toAccountId: vndAccId,
        fromAmount: '100.00',
        exchangeRate: '25000',
        feeMinor: '200',
        transferDate: '2026-11-20',
      },
    );

    expect(created.body.feeTransactionId).toBeTruthy();
    expect(created.body.feeTransaction?.entryType).toBe(EntryType.EXPENSE);
    expect(created.body.feeTransaction?.amountMinor).toBe('200');
    expect(created.body.feeTransaction?.currencyCode).toBe('USD');
    expect(created.body.feeTransaction?.transferId).toBeNull();
    expect(created.body.fromAccountPostedBalanceMinor).toBe('39800'); // 500.00 - 100.00 - 2.00
    expect(created.body.toAccountPostedBalanceMinor).toBe('2500000');

    const feeCat = (await categoriesService.list(userId, CategoryKind.EXPENSE)).find(
      (c) => c.name === 'Phí ngân hàng / Chuyển khoản',
    );
    expect(feeCat).toBeDefined();
    expect(created.body.feeTransaction?.categoryId).toBe(feeCat!.id);

    // Cash flow counts 2.00 USD fee expense, excludes 100.00 USD & 2,500,000 VND principal
    const cf = await reportingService.getCashFlowReport(userId, 'Asia/Ho_Chi_Minh', 'VND', {
      from: '2026-11-01',
      to: '2026-11-30',
    });
    const usdSummary = cf.currencies.find((c) => c.currencyCode === 'USD')!;
    expect(usdSummary.grossExpenseMinor).toBe('200');
    expect(usdSummary.netCashFlowMinor).toBe('-200');
    expect(cf.currencies.find((c) => c.currencyCode === 'VND')).toBeUndefined();

    // Voiding transfer atomically voids TRANSFER_OUT, TRANSFER_IN, and linked fee EXPENSE
    const voided = await transfersService.void(
      userId,
      created.body.id,
      randomUUID(),
      `/api/v1/transfers/${created.body.id}/void`,
      'USER_CANCELLED',
    );
    expect(voided.body.status).toBe(TransferStatus.VOIDED);
    expect(voided.body.fromTransaction?.status).toBe(TransactionStatus.VOIDED);
    expect(voided.body.toTransaction?.status).toBe(TransactionStatus.VOIDED);
    expect(voided.body.feeTransaction?.status).toBe(TransactionStatus.VOIDED);
    expect(voided.body.fromAccountPostedBalanceMinor).toBe('50000');
    expect(voided.body.toAccountPostedBalanceMinor).toBe('0');

    // Cannot reverse an already voided transfer
    await expect(
      transfersService.reverse(
        userId,
        created.body.id,
        randomUUID(),
        `/api/v1/transfers/${created.body.id}/reverse`,
      ),
    ).rejects.toThrow(InvalidStateTransitionException);

    // Reversal test on second transfer
    const created2 = await transfersService.create(
      userId,
      'Asia/Ho_Chi_Minh',
      randomUUID(),
      '/api/v1/transfers',
      {
        fromAccountId: usdAcc.id,
        toAccountId: vndAccId,
        fromAmount: '50.00',
        toAmount: '1250000',
        feeMinor: '100',
      },
    );
    const reversed = await transfersService.reverse(
      userId,
      created2.body.id,
      randomUUID(),
      `/api/v1/transfers/${created2.body.id}/reverse`,
    );
    expect(reversed.body.status).toBe(TransferStatus.REVERSED);
    expect(reversed.body.fromTransaction?.status).toBe(TransactionStatus.REVERSED);
    expect(reversed.body.toTransaction?.status).toBe(TransactionStatus.REVERSED);
    expect(reversed.body.feeTransaction?.status).toBe(TransactionStatus.REVERSED);
    expect(reversed.body.fromAccountPostedBalanceMinor).toBe('50000');
    expect(reversed.body.toAccountPostedBalanceMinor).toBe('0');
    expect(db.state.auditLogs.some((a) => a.input.action === 'TRANSFER_REVERSED')).toBe(true);
  });

  it('rejects same-account transfers, cross-user accounts (404), locks accounts in id ASC order, and rolls back completely on mid-tx DB failure', async () => {
    const {
      db,
      accountsRepo,
      transfersRepo,
      authService,
      accountsService,
      transfersService,
    } = createFullServiceHarness();

    const userA = await authService.register({
      email: 'trf-a@example.com',
      password: 'StrongPassword1234!',
      fullName: 'User A',
    });
    const userB = await authService.register({
      email: 'trf-b@example.com',
      password: 'StrongPassword1234!',
      fullName: 'User B',
    });

    const userAId = userA.response.user.id;
    const accA1 = userA.response.defaultAccount!.id;
    const accA2 = (
      await accountsService.createAccount(userAId, 'Asia/Ho_Chi_Minh', {
        name: 'Bank A',
        accountType: AccountType.BANK,
        currencyCode: 'VND',
        openingBalance: '1000000',
      })
    ).id;
    const accB1 = userB.response.defaultAccount!.id;

    // from === to -> 422
    await expect(
      transfersService.create(userAId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/transfers', {
        fromAccountId: accA1,
        toAccountId: accA1,
        fromAmount: '100000',
      }),
    ).rejects.toThrow(ValidationDomainException);

    // Cross-user target account -> 404
    await expect(
      transfersService.create(userAId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/transfers', {
        fromAccountId: accA1,
        toAccountId: accB1,
        fromAmount: '100000',
      }),
    ).rejects.toThrow(ResourceNotFoundException);

    // Verify deterministic id ASC lock order regardless of A->B vs B->A
    accountsRepo.lockedIdBatches = [];
    await transfersService.create(userAId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/transfers', {
      fromAccountId: accA1,
      toAccountId: accA2,
      fromAmount: '100000',
    });
    await transfersService.create(userAId, 'Asia/Ho_Chi_Minh', randomUUID(), '/api/v1/transfers', {
      fromAccountId: accA2,
      toAccountId: accA1,
      fromAmount: '50000',
    });
    const expectedSorted = [accA1, accA2].sort((a, b) => a.localeCompare(b));
    expect(accountsRepo.lockedIdBatches[0]).toEqual(expectedSorted);
    expect(accountsRepo.lockedIdBatches[1]).toEqual(expectedSorted);

    // Fault injection mid-transaction (after transfer + TRANSFER_OUT + TRANSFER_IN + fee EXPENSE inserted!)
    const txCountBefore = db.state.transactions.size;
    const trfCountBefore = db.state.transfers.size;
    const auditCountBefore = db.state.auditLogs.length;
    const failKey = randomUUID();

    const originalSetFee = transfersRepo.setFeeTransactionId.bind(transfersRepo);
    transfersRepo.setFeeTransactionId = async () => {
      throw new Error('Simulated mid-transaction DB failure');
    };

    await expect(
      transfersService.create(userAId, 'Asia/Ho_Chi_Minh', failKey, '/api/v1/transfers', {
        fromAccountId: accA2,
        toAccountId: accA1,
        fromAmount: '200000',
        feeMinor: '10000',
      }),
    ).rejects.toThrow('Simulated mid-transaction DB failure');

    transfersRepo.setFeeTransactionId = originalSetFee;

    // Entire DB state must be rolled back atomically
    expect(db.state.transactions.size).toBe(txCountBefore);
    expect(db.state.transfers.size).toBe(trfCountBefore);
    expect(db.state.auditLogs.length).toBe(auditCountBefore);
    expect(db.state.idempotencyKeys.has(`${userAId}:${failKey}`)).toBe(false);
    expect((await accountsService.getAccount(userAId, accA1)).postedBalanceMinor).toBe('-50000');
    expect((await accountsService.getAccount(userAId, accA2)).postedBalanceMinor).toBe('1050000');
  });

  describe('HTTP Pipeline: Transfers API, Idempotency, IDOR (T-02), Mass Assignment (T-04)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      ({ app } = await createFullHttpTestApp());
    });

    afterAll(async () => {
      await app.close();
    });

    it('handles POST/GET/void/reverse over HTTP with RFC 9457 errors', async () => {
      const server = app.getHttpServer();

      const regA = await request(server).post('/api/v1/auth/register').send({
        email: 'http-trf-a@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP Trf A',
      });
      const regB = await request(server).post('/api/v1/auth/register').send({
        email: 'http-trf-b@example.com',
        password: 'StrongPassword1234!',
        fullName: 'HTTP Trf B',
      });

      const tokenA = regA.body.accessToken as string;
      const tokenB = regB.body.accessToken as string;
      const accA1 = regA.body.defaultAccount.id as string;

      const bankA = await request(server)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'TPBank',
          accountType: AccountType.BANK,
          currencyCode: 'VND',
          openingBalance: '5000000',
        });
      const accA2 = bankA.body.id as string;

      // Mass assignment blocked (400)
      const massRes = await request(server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          fromAccountId: accA2,
          toAccountId: accA1,
          fromAmountMinor: '1000000',
          userId: regB.body.user.id,
        });
      expect(massRes.status).toBe(400);

      const idemKey = randomUUID();
      const createRes = await request(server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', idemKey)
        .send({
          fromAccountId: accA2,
          toAccountId: accA1,
          fromAmountMinor: '1000000',
          feeMinor: '11000',
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.fromAccountPostedBalanceMinor).toBe('3989000');
      expect(createRes.body.toAccountPostedBalanceMinor).toBe('1000000');

      // Replay with same Idempotency-Key
      const replayRes = await request(server)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', idemKey)
        .send({
          fromAccountId: accA2,
          toAccountId: accA1,
          fromAmountMinor: '1000000',
          feeMinor: '11000',
        });
      expect(replayRes.status).toBe(201);
      expect(replayRes.body.id).toBe(createRes.body.id);

      // User B cannot read or void User A's transfer -> 404
      const idorGet = await request(server)
        .get(`/api/v1/transfers/${createRes.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(idorGet.status).toBe(404);

      const idorVoid = await request(server)
        .post(`/api/v1/transfers/${createRes.body.id}/void`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('Idempotency-Key', randomUUID())
        .send({});
      expect(idorVoid.status).toBe(404);

      // List transfers
      const listRes = await request(server)
        .get('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.items).toHaveLength(1);

      // Void transfer -> restores both accounts
      const voidRes = await request(server)
        .post(`/api/v1/transfers/${createRes.body.id}/void`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({ reasonCode: 'MISTAKE' });
      expect(voidRes.status).toBe(200);
      expect(voidRes.body.status).toBe(TransferStatus.VOIDED);
      expect(voidRes.body.fromAccountPostedBalanceMinor).toBe('5000000');
      expect(voidRes.body.toAccountPostedBalanceMinor).toBe('0');
    });
  });
});
