'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { formatDateVN, formatMoney } from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type { CurrencyCode } from '@/lib/types';
import { SegmentedTabs } from '@/components/ui/CurrencyTabs';
import { SearchableCombobox } from '@/components/ui/SearchableCombobox';
import { StatusBadge, EntryTypeBadge } from '@/components/ui/StatusBadge';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { MotionButton } from '@/components/ui/MotionPrimitives';

type PeriodFilter = '2026-11' | '2026-10' | 'ALL';

export default function DashboardPage() {
  const {
    state,
    activeAccounts,
    isLoadingSkeleton,
    getAccountBalance,
    getCategoryById,
    getAccountById,
  } = usePreviewStore();

  const [currency, setCurrency] = useState<CurrencyCode>('VND');
  const [period, setPeriod] = useState<PeriodFilter>('2026-11');
  const [accountFilter, setAccountFilter] = useState<string>('ALL');

  const currencyAccounts = useMemo(
    () => activeAccounts.filter((a) => a.currencyCode === currency),
    [activeAccounts, currency],
  );

  const accountOptions = useMemo(
    () => [
      { value: 'ALL', label: `Tất cả tài khoản (${currency})`, popular: true },
      ...currencyAccounts.map((a) => ({
        value: a.id,
        label: a.name,
        rightText: formatMoney(getAccountBalance(a.id), a.currencyCode),
      })),
    ],
    [currency, currencyAccounts, getAccountBalance],
  );

  const effectiveAccountFilter =
    accountFilter === 'ALL' || currencyAccounts.some((a) => a.id === accountFilter)
      ? accountFilter
      : 'ALL';

  const metrics = useMemo(() => {
    const filteredAccounts =
      effectiveAccountFilter === 'ALL'
        ? currencyAccounts
        : currencyAccounts.filter((a) => a.id === effectiveAccountFilter);

    const totalPostedBalance = filteredAccounts.reduce(
      (sum, acc) => sum + getAccountBalance(acc.id),
      0,
    );

    const postedTx = state.transactions.filter((tx) => {
      if (tx.status !== 'POSTED') return false;
      if (tx.currencyCode !== currency) return false;
      if (effectiveAccountFilter !== 'ALL' && tx.accountId !== effectiveAccountFilter) {
        return false;
      }
      if (period !== 'ALL' && !tx.transactionDate.startsWith(period)) return false;
      return true;
    });

    let totalIncome = 0;
    let grossExpense = 0;
    let totalRefund = 0;

    for (const tx of postedTx) {
      if (tx.entryType === 'INCOME') totalIncome += tx.amountMinor;
      else if (tx.entryType === 'EXPENSE') grossExpense += tx.amountMinor;
      else if (tx.entryType === 'EXPENSE_REFUND') totalRefund += tx.amountMinor;
    }

    // Chi tiêu ròng & Dòng tiền ròng loại trừ Chuyển khoản & Điều chỉnh
    const netExpense = grossExpense - totalRefund;
    const netCashFlow = totalIncome - netExpense;

    return {
      totalPostedBalance,
      totalIncome,
      grossExpense,
      totalRefund,
      netExpense,
      netCashFlow,
    };
  }, [currency, currencyAccounts, effectiveAccountFilter, getAccountBalance, period, state.transactions]);

  const budgetMonth = period === 'ALL' ? '2026-11' : period;
  const topBudgets = useMemo(() => {
    return state.budgets
      .filter((b) => b.currencyCode === currency && b.month === budgetMonth)
      .map((b) => {
        const spent = state.transactions
          .filter(
            (tx) =>
              tx.status === 'POSTED' &&
              tx.currencyCode === currency &&
              tx.categoryId === b.categoryId &&
              tx.transactionDate.startsWith(budgetMonth),
          )
          .reduce((sum, tx) => {
            if (tx.entryType === 'EXPENSE') return sum + tx.amountMinor;
            if (tx.entryType === 'EXPENSE_REFUND') return sum - tx.amountMinor;
            return sum;
          }, 0);

        const pct = b.limitMinor > 0 ? Math.round((spent / b.limitMinor) * 100) : 0;
        return {
          ...b,
          categoryName: getCategoryById(b.categoryId)?.name ?? 'Danh mục',
          spent,
          pct,
        };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
  }, [budgetMonth, currency, getCategoryById, state.budgets, state.transactions]);

  const recentTransactions = useMemo(() => {
    return state.transactions
      .filter((tx) => {
        if (tx.currencyCode !== currency) return false;
        if (effectiveAccountFilter !== 'ALL' && tx.accountId !== effectiveAccountFilter) {
          return false;
        }
        if (period !== 'ALL' && !tx.transactionDate.startsWith(period)) return false;
        return true;
      })
      .slice(0, 6);
  }, [currency, effectiveAccountFilter, period, state.transactions]);

  const hasCurrencyData = currencyAccounts.length > 0 || recentTransactions.length > 0;

  return (
    <div className="space-y-6">
      {/* Page Header + Controls */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-[24px] font-semibold leading-8 text-[#0F172A]">Tổng quan</h1>

        <div className="flex flex-wrap items-end gap-3">
          <SegmentedTabs
            layoutId="dashboard-currency-tabs"
            ariaLabel="Chọn tiền tệ báo cáo"
            value={currency}
            onChange={setCurrency}
            options={[
              { value: 'VND', label: 'VND' },
              {
                value: 'USD',
                label: 'USD',
                badge: activeAccounts.some((a) => a.currencyCode === 'USD') ? undefined : 'Trống',
              },
            ]}
          />
        </div>
      </div>

      {/* Filters & Quick-Log Shortcuts */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[460px]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="period-select" className="text-[12px] font-semibold text-[#475569]">
                Kỳ báo cáo
              </label>
              <select
                id="period-select"
                value={period}
                onChange={(e) => setPeriod(e.target.value as PeriodFilter)}
                className="min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white px-3 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
              >
                <option value="2026-11">Tháng 11/2026</option>
                <option value="2026-10">Tháng 10/2026</option>
                <option value="ALL">Tất cả thời gian</option>
              </select>
            </div>

            <SearchableCombobox
              label="Lọc tài khoản"
              options={accountOptions}
              value={effectiveAccountFilter}
              onChange={setAccountFilter}
              searchPlaceholder="Tìm tài khoản..."
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/incomes">
              <MotionButton variant="primary">
                <ArrowDownLeft className="h-4 w-4" aria-hidden={true} />
                <span>Ghi Thu nhập</span>
              </MotionButton>
            </Link>
            <Link href="/expenses">
              <MotionButton variant="secondary">
                <ArrowUpRight className="h-4 w-4 text-[#B91C1C]" aria-hidden={true} />
                <span>Ghi Chi tiêu</span>
              </MotionButton>
            </Link>
            <Link href="/transfers">
              <MotionButton variant="secondary">
                <ArrowLeftRight className="h-4 w-4 text-[#475569]" aria-hidden={true} />
                <span>Chuyển khoản</span>
              </MotionButton>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Data / Skeleton */}
      {isLoadingSkeleton ? (
        <DashboardSkeleton />
      ) : !hasCurrencyData ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-left space-y-4">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-[#4338CA]">
            <Wallet className="h-5 w-5" aria-hidden={true} />
          </div>
          <div className="space-y-1 max-w-xl">
            <h2 className="text-[16px] font-semibold text-[#0F172A]">
              Chưa có tài khoản hoặc giao dịch {currency}
            </h2>
            <p className="text-[14px] text-[#475569]">
              Hiện tại báo cáo {currency} ghi nhận{' '}
              <span className="font-semibold text-[#0F172A] tabular-nums">
                {formatMoney(0, currency)}
              </span>
              . Hệ thống tách biệt hoàn toàn theo từng mã tiền tệ để tránh sai lệch quy đổi.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/accounts">
              <MotionButton variant="primary">
                <span>Tạo tài khoản {currency} mới</span>
              </MotionButton>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* 4 KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Link
              href="/accounts"
              className="group rounded-xl border border-[#E2E8F0] bg-white p-5 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#CBD5E1]"
            >
              <div className="flex items-center justify-between text-[12px] font-semibold text-[#475569]">
                <span>Tổng số dư</span>
                <Wallet className="h-4 w-4 text-[#64748B]" aria-hidden={true} />
              </div>
              <div className="mt-2 text-[24px] font-semibold leading-8 text-[#0F172A] tabular-nums">
                {formatMoney(metrics.totalPostedBalance, currency)}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[12px] text-[#4338CA] font-semibold">
                <span>{currencyAccounts.length} tài khoản {currency}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden={true} />
              </div>
            </Link>

            <Link
              href="/incomes"
              className="group rounded-xl border border-[#E2E8F0] bg-white p-5 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#CBD5E1]"
            >
              <div className="flex items-center justify-between text-[12px] font-semibold text-[#475569]">
                <span>Tổng Thu nhập</span>
                <ArrowDownLeft className="h-4 w-4 text-[#15803D]" aria-hidden={true} />
              </div>
              <div className="mt-2 text-[24px] font-semibold leading-8 text-[#15803D] tabular-nums">
                {formatMoney(metrics.totalIncome, currency, { showSign: true })}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[12px] text-[#475569]">
                <span>Chỉ tính giao dịch đã ghi sổ</span>
                <ArrowRight className="h-3.5 w-3.5 text-[#4338CA]" aria-hidden={true} />
              </div>
            </Link>

            <Link
              href="/expenses"
              className="group rounded-xl border border-[#E2E8F0] bg-white p-5 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#CBD5E1]"
            >
              <div className="flex items-center justify-between text-[12px] font-semibold text-[#475569]">
                <span>Chi tiêu ròng</span>
                <ArrowUpRight className="h-4 w-4 text-[#B91C1C]" aria-hidden={true} />
              </div>
              <div className="mt-2 text-[24px] font-semibold leading-8 text-[#0F172A] tabular-nums">
                {formatMoney(metrics.netExpense, currency)}
              </div>
              <div className="mt-2 text-[12px] text-[#475569] tabular-nums">
                {metrics.totalRefund > 0
                  ? `Đã trừ hoàn tiền ${formatMoney(metrics.totalRefund, currency)}`
                  : 'Chi tiêu đã ghi sổ trong kỳ'}
              </div>
            </Link>

            <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="flex items-center justify-between text-[12px] font-semibold text-[#475569]">
                <span>Dòng tiền ròng</span>
                {metrics.netCashFlow >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-[#15803D]" aria-hidden={true} />
                ) : (
                  <TrendingDown className="h-4 w-4 text-[#B91C1C]" aria-hidden={true} />
                )}
              </div>
              <div
                className={`mt-2 text-[24px] font-semibold leading-8 tabular-nums flex items-center gap-2 ${
                  metrics.netCashFlow >= 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'
                }`}
              >
                <span>{formatMoney(metrics.netCashFlow, currency, { showSign: true })}</span>
              </div>
              <div className="mt-2 text-[12px] text-[#64748B]">
                Loại trừ Chuyển khoản nội bộ & Điều chỉnh số dư
              </div>
            </div>
          </div>

          {/* Budgets + Recent Transactions */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Top Budgets */}
            <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-[16px] font-semibold text-[#0F172A]">
                    Ngân sách nổi bật ({budgetMonth})
                  </h2>
                  <p className="text-[12px] text-[#64748B]">
                    Tính theo Chi tiêu ròng (đã trừ Hoàn tiền)
                  </p>
                </div>
                <Link
                  href="/budgets"
                  className="min-h-[44px] inline-flex items-center gap-1 px-2 text-[13px] font-semibold text-[#4338CA] hover:underline"
                >
                  <span>Chi tiết</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden={true} />
                </Link>
              </div>

              {topBudgets.length === 0 ? (
                <p className="text-[14px] text-[#64748B] py-4">
                  Chưa thiết lập ngân sách {currency} cho tháng {budgetMonth}.
                </p>
              ) : (
                <div className="space-y-4">
                  {topBudgets.map((b) => {
                    const isExceeded = b.pct >= 100;
                    const isWarning = b.pct >= 80 && b.pct < 100;
                    const barColor = isExceeded
                      ? 'bg-[#B91C1C]'
                      : isWarning
                        ? 'bg-[#B45309]'
                        : 'bg-[#4338CA]';

                    return (
                      <div key={b.id} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-[14px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-semibold text-[#0F172A] truncate">
                              {b.categoryName}
                            </span>
                            {isExceeded ? (
                              <span className="inline-flex items-center gap-1 rounded bg-[#FEF2F2] border border-[#FECACA] px-1.5 py-0.5 text-[11px] font-semibold text-[#B91C1C]">
                                <AlertOctagon className="h-3 w-3" aria-hidden={true} />
                                <span>Vượt ngân sách</span>
                              </span>
                            ) : isWarning ? (
                              <span className="inline-flex items-center gap-1 rounded bg-[#FFFBEB] border border-[#FDE68A] px-1.5 py-0.5 text-[11px] font-semibold text-[#B45309]">
                                <AlertTriangle className="h-3 w-3" aria-hidden={true} />
                                <span>Sắp đạt ngưỡng</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-[#F0FDF4] border border-[#BBF7D0] px-1.5 py-0.5 text-[11px] font-semibold text-[#15803D]">
                                <CheckCircle2 className="h-3 w-3" aria-hidden={true} />
                                <span>Trong hạn mức</span>
                              </span>
                            )}
                          </div>

                          <span className="text-[13px] font-semibold text-[#0F172A] tabular-nums shrink-0">
                            {b.pct}%
                          </span>
                        </div>

                        <div className="h-2 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
                          <div
                            className={`h-full rounded-full ${barColor} transition-all duration-300`}
                            style={{ width: `${Math.min(100, Math.max(0, b.pct))}%` }}
                          />
                        </div>

                        <div className="flex justify-between text-[12px] text-[#475569] tabular-nums">
                          <span>Đã chi: {formatMoney(b.spent, currency)}</span>
                          <span>Hạn mức: {formatMoney(b.limitMinor, currency)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Recent Transactions */}
            <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-[16px] font-semibold text-[#0F172A]">
                    Giao dịch gần đây ({currency})
                  </h2>
                  <p className="text-[12px] text-[#64748B]">
                    Bấm vào dòng để đi tới phân hệ Thu nhập hoặc Chi tiêu
                  </p>
                </div>
              </div>

              {recentTransactions.length === 0 ? (
                <p className="text-[14px] text-[#64748B] py-4">
                  Chưa có giao dịch {currency} trong kỳ đã chọn.
                </p>
              ) : (
                <div className="divide-y divide-[#E2E8F0]">
                  {recentTransactions.map((tx) => {
                    const cat = getCategoryById(tx.categoryId);
                    const acc = getAccountById(tx.accountId);
                    const isPositive =
                      tx.entryType === 'INCOME' ||
                      tx.entryType === 'EXPENSE_REFUND' ||
                      tx.entryType === 'TRANSFER_IN' ||
                      tx.entryType === 'ADJUSTMENT_CREDIT';

                    const href =
                      tx.entryType === 'INCOME'
                        ? '/incomes'
                        : tx.entryType === 'TRANSFER_IN' || tx.entryType === 'TRANSFER_OUT'
                          ? '/transfers'
                          : '/expenses';

                    return (
                      <Link
                        key={tx.id}
                        href={href}
                        className="flex min-h-[56px] items-center justify-between gap-3 py-3 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC] -mx-2 px-2 rounded-lg"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-[14px] font-semibold text-[#0F172A]">
                              {tx.description}
                            </span>
                            <StatusBadge status={tx.status} />
                            <EntryTypeBadge entryType={tx.entryType} />
                          </div>
                          <div className="text-[12px] text-[#64748B] tabular-nums">
                            {formatDateVN(tx.transactionDate)} · {acc?.name ?? 'Tài khoản'}
                            {cat ? ` · ${cat.name}` : ''}
                          </div>
                        </div>

                        <div
                          className={`text-[14px] font-semibold tabular-nums shrink-0 text-right ${
                            tx.status === 'VOIDED' || tx.status === 'REVERSED'
                              ? 'line-through text-[#64748B]'
                              : isPositive
                                ? 'text-[#15803D]'
                                : 'text-[#0F172A]'
                          }`}
                        >
                          {isPositive ? '+' : '-'}
                          {formatMoney(tx.amountMinor, tx.currencyCode)}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
