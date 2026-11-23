'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Plus,
} from 'lucide-react';
import {
  ReducedMotionConfig,
  spring,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';
import { formatMinorForInput, formatMoney, parseMoneyInput } from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type { CurrencyCode } from '@/lib/types';
import { SegmentedTabs } from '@/components/ui/CurrencyTabs';
import { MotionButton } from '@/components/ui/MotionPrimitives';
import { Modal } from '@/components/ui/Modal';
import { SearchableCombobox } from '@/components/ui/SearchableCombobox';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { DashboardSkeleton } from '@/components/ui/Skeleton';

export default function BudgetsPage() {
  const {
    state,
    isLoadingSkeleton,
    getCategoryById,
    upsertBudget,
  } = usePreviewStore();

  const [month, setMonth] = useState('2026-11');
  const [currency, setCurrency] = useState<CurrencyCode>('VND');
  const [modalOpen, setModalOpen] = useState(false);

  // Modal state
  const expenseCategories = useMemo(
    () => state.categories.filter((c) => c.kind === 'EXPENSE' && !c.archivedAt),
    [state.categories],
  );
  const [editCatId, setEditCatId] = useState(expenseCategories[0]?.id ?? '');
  const [editLimitRaw, setEditLimitRaw] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [moneyResetKey, setMoneyResetKey] = useState(0);

  const budgetRows = useMemo(() => {
    return state.budgets
      .filter((b) => b.month === month && b.currencyCode === currency)
      .map((b) => {
        // Thực chi = Tổng chi tiêu - Tổng hoàn tiền (chỉ tính giao dịch đã ghi sổ)
        const spent = state.transactions
          .filter(
            (tx) =>
              tx.status === 'POSTED' &&
              tx.currencyCode === currency &&
              tx.categoryId === b.categoryId &&
              tx.transactionDate.startsWith(month),
          )
          .reduce((sum, tx) => {
            if (tx.entryType === 'EXPENSE') return sum + tx.amountMinor;
            if (tx.entryType === 'EXPENSE_REFUND') return sum - tx.amountMinor;
            return sum;
          }, 0);

        const pct = b.limitMinor > 0 ? Math.round((spent / b.limitMinor) * 100) : 0;
        const remaining = b.limitMinor - spent;

        return {
          ...b,
          categoryName: getCategoryById(b.categoryId)?.name ?? 'Danh mục',
          spent,
          pct,
          remaining,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [currency, getCategoryById, month, state.budgets, state.transactions]);

  const totals = useMemo(() => {
    const limit = budgetRows.reduce((s, r) => s + r.limitMinor, 0);
    const spent = budgetRows.reduce((s, r) => s + r.spent, 0);
    return { limit, spent, remaining: limit - spent };
  }, [budgetRows]);

  const openBudgetModal = (categoryId?: string, currentLimitMinor?: number) => {
    const chosenCat = categoryId ?? expenseCategories[0]?.id ?? '';
    setEditCatId(chosenCat);
    setEditLimitRaw(
      currentLimitMinor ? formatMinorForInput(currentLimitMinor, currency) : '',
    );
    setModalError(null);
    setMoneyResetKey((k) => k + 1);
    setModalOpen(true);
  };

  const handleSaveBudget = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseMoneyInput(editLimitRaw, currency);
    if (!parsed.valid || parsed.minorValue === null) {
      setModalError(parsed.error ?? 'Hạn mức ngân sách không hợp lệ.');
      return;
    }
    upsertBudget(editCatId, currency, month, parsed.minorValue);
    setModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-[24px] font-semibold leading-8 text-[#0F172A]">Ngân sách</h1>
          <p className="text-[14px] leading-5 text-[#475569]">
            Giới hạn chi tiêu tháng theo danh mục &amp; tiền tệ. Cảnh báo ở ngưỡng 80% và 100%.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Chọn tháng ngân sách"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white px-3 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
          >
            <option value="2026-11">Tháng 11/2026</option>
            <option value="2026-10">Tháng 10/2026</option>
          </select>

          <SegmentedTabs
            layoutId="budgets-currency-tabs"
            ariaLabel="Chọn tiền tệ ngân sách"
            value={currency}
            onChange={setCurrency}
            options={[
              { value: 'VND', label: 'VND' },
              { value: 'USD', label: 'USD' },
            ]}
          />

          <MotionButton variant="primary" onClick={() => openBudgetModal()}>
            <Plus className="h-4 w-4" aria-hidden={true} />
            <span>Đặt ngân sách</span>
          </MotionButton>
        </div>
      </div>

      {isLoadingSkeleton ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* Summary Strip */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="text-[12px] font-semibold text-[#475569]">
                Tổng hạn mức ({month} · {currency})
              </div>
              <div className="mt-1.5 text-[22px] font-semibold text-[#0F172A] tabular-nums">
                {formatMoney(totals.limit, currency)}
              </div>
            </div>

            <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="text-[12px] font-semibold text-[#475569]">
                Đã chi ròng (đã trừ hoàn tiền)
              </div>
              <div className="mt-1.5 text-[22px] font-semibold text-[#0F172A] tabular-nums">
                {formatMoney(totals.spent, currency)}
              </div>
            </div>

            <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="text-[12px] font-semibold text-[#475569]">
                Còn lại toàn kỳ
              </div>
              <div
                className={`mt-1.5 text-[22px] font-semibold tabular-nums ${
                  totals.remaining >= 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'
                }`}
              >
                {formatMoney(totals.remaining, currency, { showSign: true })}
              </div>
            </div>
          </div>

          {/* Budget Category Cards */}
          {budgetRows.length === 0 ? (
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 space-y-3">
              <p className="text-[15px] font-semibold text-[#0F172A]">
                Chưa có ngân sách {currency} cho tháng {month}
              </p>
              <p className="text-[14px] text-[#475569]">
                Mỗi ngân sách chỉ áp dụng cho 1 danh mục chi tiêu và 1 tiền tệ duy nhất.
              </p>
              <MotionButton variant="primary" onClick={() => openBudgetModal()}>
                <Plus className="h-4 w-4" aria-hidden={true} />
                <span>Tạo ngân sách đầu tiên</span>
              </MotionButton>
            </div>
          ) : (
            <ReducedMotionConfig>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {budgetRows.map((row) => (
                  <BudgetProgressCard
                    key={row.id}
                    row={row}
                    currency={currency}
                    onEdit={() => openBudgetModal(row.categoryId, row.limitMinor)}
                  />
                ))}
              </div>
            </ReducedMotionConfig>
          )}
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Thiết lập Ngân sách (${month} · ${currency})`}
        description="Tính theo ngày giao dịch của các giao dịch đã ghi sổ."
      >
        <form onSubmit={handleSaveBudget} className="space-y-4">
          <SearchableCombobox
            label="Danh mục chi tiêu"
            options={expenseCategories.map((c) => ({ value: c.id, label: c.name }))}
            value={editCatId}
            onChange={setEditCatId}
          />

          <MoneyInput
            label={`Hạn mức tháng (${currency})`}
            currency={currency}
            value={editLimitRaw}
            resetKey={moneyResetKey}
            onChange={(val) => {
              setEditLimitRaw(val);
              if (modalError) setModalError(null);
            }}
            externalError={modalError}
          />

          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
            <MotionButton variant="secondary" onClick={() => setModalOpen(false)}>
              Hủy
            </MotionButton>
            <MotionButton type="submit" variant="primary">
              Lưu ngân sách
            </MotionButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function BudgetProgressCard({
  row,
  currency,
  onEdit,
}: {
  row: {
    id: string;
    categoryName: string;
    limitMinor: number;
    spent: number;
    pct: number;
    remaining: number;
  };
  currency: CurrencyCode;
  onEdit: () => void;
}) {
  const reduce = useShouldReduceMotion();
  const progressSpring = useTempoTransition(spring.progress);

  const isExceeded = row.pct >= 100;
  const isWarning = row.pct >= 80 && row.pct < 100;

  const barColor = isExceeded
    ? 'bg-[#B91C1C]'
    : isWarning
      ? 'bg-[#B45309]'
      : 'bg-[#4338CA]';

  const clampedPct = Math.min(100, Math.max(0, row.pct));

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <h2 className="text-[16px] font-semibold text-[#0F172A] truncate">
            {row.categoryName}
          </h2>
          {isExceeded ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2 py-0.5 text-[12px] font-semibold text-[#B91C1C]">
              <AlertOctagon className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
              <span>Vượt ngân sách ({row.pct}%)</span>
            </span>
          ) : isWarning ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-[12px] font-semibold text-[#B45309]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
              <span>Sắp đạt ngưỡng ({row.pct}%)</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-2 py-0.5 text-[12px] font-semibold text-[#15803D]">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
              <span>Trong hạn mức ({row.pct}%)</span>
            </span>
          )}
        </div>

        <MotionButton variant="secondary" size="sm" onClick={onEdit}>
          <span>Điều chỉnh</span>
        </MotionButton>
      </div>

      {/* Clipped Progress Track */}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
        <motion.div
          initial={reduce ? false : { width: '0%' }}
          animate={{ width: `${clampedPct}%` }}
          transition={reduce ? { duration: 0 } : progressSpring}
          className={`h-full rounded-full ${barColor}`}
        />
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1 text-[12px] tabular-nums">
        <div>
          <div className="text-[#64748B]">Đã chi ròng</div>
          <div className="font-semibold text-[#0F172A]">{formatMoney(row.spent, currency)}</div>
        </div>
        <div>
          <div className="text-[#64748B]">Hạn mức</div>
          <div className="font-semibold text-[#0F172A]">
            {formatMoney(row.limitMinor, currency)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[#64748B]">{row.remaining >= 0 ? 'Còn lại' : 'Vượt mức'}</div>
          <div
            className={`font-semibold ${
              row.remaining >= 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'
            }`}
          >
            {formatMoney(Math.abs(row.remaining), currency)}
          </div>
        </div>
      </div>
    </div>
  );
}
