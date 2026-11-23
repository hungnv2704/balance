'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Pause,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  Repeat,
  Search,
} from 'lucide-react';
import { ReducedMotionConfig } from '@animate-ui/react/utils/motion';
import {
  formatDateVN,
  formatMinorForInput,
  formatMoney,
  newIdempotencyKey,
  parseMoneyInput,
} from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type {
  RecurringFrequency,
  RecurringRule,
  RecurringRuleKind,
} from '@/lib/types';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { DateInput } from '@/components/ui/DateInput';
import { SearchableCombobox } from '@/components/ui/SearchableCombobox';
import { ProgressiveAccountPicker } from '@/components/ProgressiveAccountPicker';
import { SegmentedTabs } from '@/components/ui/CurrencyTabs';
import { Modal } from '@/components/ui/Modal';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { AnimatedListRow, MotionButton } from '@/components/ui/MotionPrimitives';

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  DAILY: 'Hằng ngày',
  WEEKLY: 'Hằng tuần',
  MONTHLY: 'Hằng tháng',
  YEARLY: 'Hằng năm',
};

const FREQUENCY_UNITS: Record<RecurringFrequency, string> = {
  DAILY: 'ngày',
  WEEKLY: 'tuần',
  MONTHLY: 'tháng',
  YEARLY: 'năm',
};

const FREQUENCY_OPTIONS = [
  { value: 'DAILY', label: 'Hằng ngày', sublabel: 'Lặp theo ngày', popular: false },
  { value: 'WEEKLY', label: 'Hằng tuần', sublabel: 'Lặp theo tuần', popular: true },
  { value: 'MONTHLY', label: 'Hằng tháng', sublabel: 'Lặp theo tháng', popular: true },
  { value: 'YEARLY', label: 'Hằng năm', sublabel: 'Lặp theo năm', popular: false },
];

function formatFrequencyText(frequency: RecurringFrequency, intervalCount: number): string {
  if (intervalCount <= 1) {
    return FREQUENCY_LABELS[frequency];
  }
  return `Mỗi ${intervalCount} ${FREQUENCY_UNITS[frequency]}`;
}

export default function RecurringPage() {
  const {
    state,
    dataMode,
    activeAccounts,
    isLoadingSkeleton,
    getAccountById,
    getCategoryById,
    createRecurringRule,
    updateRecurringRule,
    pauseRecurringRule,
    resumeRecurringRule,
    runDueRecurringRules,
  } = usePreviewStore();

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [runningDue, setRunningDue] = useState(false);

  // Modal state (Create / Edit)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [ruleKind, setRuleKind] = useState<RecurringRuleKind>('EXPENSE');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amountRaw, setAmountRaw] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('MONTHLY');
  const [intervalRaw, setIntervalRaw] = useState('1');
  const [nextRunDate, setNextRunDate] = useState('2026-11-23');
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState('2026-12-31');
  const [titleRaw, setTitleRaw] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [moneyResetKey, setMoneyResetKey] = useState(0);
  const [formIdempotencyKey, setFormIdempotencyKey] = useState<string | null>(null);

  const defaultAccount = activeAccounts.find((a) => a.isDefault) ?? activeAccounts[0];
  const [realToday, setRealToday] = useState<string | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setRealToday(new Date().toLocaleDateString('en-CA'));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const effectiveToday = useMemo(() => {
    const base = realToday ?? '2026-11-23';
    if (dataMode === 'live') return base;
    return base > '2026-11-23' ? base : '2026-11-23';
  }, [dataMode, realToday]);

  const selectedAccount = useMemo(
    () => activeAccounts.find((a) => a.id === accountId) ?? defaultAccount,
    [accountId, activeAccounts, defaultAccount],
  );
  const activeCurrency = selectedAccount?.currencyCode ?? state.baseCurrency;

  const filteredCategories = useMemo(
    () => state.categories.filter((c) => c.kind === ruleKind && !c.archivedAt),
    [ruleKind, state.categories],
  );

  const categoryOptions = useMemo(
    () =>
      filteredCategories.map((c, idx) => ({
        value: c.id,
        label: c.name,
        popular: idx < 2,
      })),
    [filteredCategories],
  );

  const summary = useMemo(() => {
    const active = state.recurringRules.filter((r) => r.isActive);
    const paused = state.recurringRules.filter((r) => !r.isActive);
    const dueNow = active.filter(
      (r) => r.nextRunDate <= effectiveToday && (!r.endDate || r.nextRunDate <= r.endDate),
    );
    return {
      activeCount: active.length,
      dueCount: dueNow.length,
      pausedCount: paused.length,
    };
  }, [effectiveToday, state.recurringRules]);

  const visibleRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.recurringRules.filter((rule) => {
      if (statusFilter === 'ACTIVE' && !rule.isActive) return false;
      if (statusFilter === 'PAUSED' && rule.isActive) return false;
      if (!q) return true;

      const catName = getCategoryById(rule.categoryId)?.name.toLowerCase() ?? '';
      const accName = getAccountById(rule.accountId)?.name.toLowerCase() ?? '';
      const title = (rule.title ?? '').toLowerCase();
      const freqLabel = formatFrequencyText(rule.frequency, rule.intervalCount).toLowerCase();

      return (
        title.includes(q) ||
        catName.includes(q) ||
        accName.includes(q) ||
        freqLabel.includes(q)
      );
    });
  }, [getAccountById, getCategoryById, searchQuery, state.recurringRules, statusFilter]);

  const openCreateModal = () => {
    const defaultKind: RecurringRuleKind = 'EXPENSE';
    const firstCat = state.categories.find((c) => c.kind === defaultKind && !c.archivedAt);
    setEditingRule(null);
    setRuleKind(defaultKind);
    setAccountId(defaultAccount?.id ?? '');
    setCategoryId(firstCat?.id ?? '');
    setAmountRaw('');
    setFrequency('MONTHLY');
    setIntervalRaw('1');
    setNextRunDate(effectiveToday);
    setHasEndDate(false);
    setEndDate('2026-12-31');
    setTitleRaw('');
    setModalError(null);
    setFormIdempotencyKey(null);
    setMoneyResetKey((k) => k + 1);
    setModalOpen(true);
  };

  const openEditModal = (rule: RecurringRule) => {
    setEditingRule(rule);
    setRuleKind(rule.ruleKind);
    setAccountId(rule.accountId);
    setCategoryId(rule.categoryId);
    setAmountRaw(formatMinorForInput(rule.amountMinor, rule.currencyCode));
    setFrequency(rule.frequency);
    setIntervalRaw(String(rule.intervalCount));
    setNextRunDate(rule.nextRunDate);
    setHasEndDate(Boolean(rule.endDate));
    setEndDate(rule.endDate ?? rule.nextRunDate);
    setTitleRaw(rule.title ?? '');
    setModalError(null);
    setFormIdempotencyKey(null);
    setMoneyResetKey((k) => k + 1);
    setModalOpen(true);
  };

  const handleRuleKindChange = (nextKind: RecurringRuleKind) => {
    if (editingRule) return;
    setRuleKind(nextKind);
    const firstMatching = state.categories.find((c) => c.kind === nextKind && !c.archivedAt);
    setCategoryId(firstMatching?.id ?? '');
    if (modalError) setModalError(null);
  };

  const handleRunDue = async () => {
    if (runningDue) return;
    setRunningDue(true);
    try {
      const reqKey = newIdempotencyKey();
      await runDueRecurringRules(reqKey);
    } finally {
      setRunningDue(false);
    }
  };

  const handleSubmitModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) {
      setModalError('Vui lòng chọn tài khoản hợp lệ.');
      return;
    }

    const parsedAmount = parseMoneyInput(amountRaw, activeCurrency);
    if (!parsedAmount.valid || parsedAmount.minorValue === null) {
      setModalError(parsedAmount.error ?? 'Số tiền không hợp lệ.');
      return;
    }

    if (!categoryId) {
      setModalError('Vui lòng chọn danh mục.');
      return;
    }

    const parsedInterval = Number.parseInt(intervalRaw.trim(), 10);
    if (!Number.isInteger(parsedInterval) || parsedInterval < 1 || parsedInterval > 365) {
      setModalError('Chu kỳ lặp phải là số nguyên từ 1 đến 365.');
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextRunDate)) {
      setModalError('Ngày chạy kế tiếp không hợp lệ.');
      return;
    }

    if (hasEndDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        setModalError('Ngày kết thúc không hợp lệ.');
        return;
      }
      if (endDate < nextRunDate) {
        setModalError('Ngày kết thúc phải lớn hơn hoặc bằng ngày chạy kế tiếp.');
        return;
      }
    }

    if (editingRule) {
      const res = updateRecurringRule(editingRule.id, {
        title: titleRaw,
        accountId: selectedAccount.id,
        categoryId,
        amountMinor: parsedAmount.minorValue,
        frequency,
        intervalCount: parsedInterval,
        nextRunDate,
        endDate: hasEndDate ? endDate : null,
      });
      if (!res.ok) {
        setModalError(res.error ?? 'Không thể cập nhật lịch định kỳ.');
        return;
      }
      setModalOpen(false);
      return;
    }

    const reqKey = formIdempotencyKey ?? newIdempotencyKey();
    if (!formIdempotencyKey) setFormIdempotencyKey(reqKey);

    const res = createRecurringRule({
      title: titleRaw,
      ruleKind,
      accountId: selectedAccount.id,
      categoryId,
      amountMinor: parsedAmount.minorValue,
      frequency,
      intervalCount: parsedInterval,
      nextRunDate,
      endDate: hasEndDate ? endDate : null,
      idempotencyKey: reqKey,
    });

    if (!res.ok) {
      setModalError(res.error ?? 'Không thể tạo lịch định kỳ.');
      return;
    }

    setFormIdempotencyKey(null);
    setModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-[24px] font-semibold leading-8 text-[#0F172A]">Định kỳ</h1>

        <div className="flex flex-wrap items-center gap-3">
          <MotionButton
            variant="secondary"
            disabled={runningDue}
            onClick={() => {
              void handleRunDue();
            }}
          >
            <CalendarClock className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
            <span>{runningDue ? 'Đang tạo nháp...' : 'Tạo nháp đến hạn'}</span>
            {summary.dueCount > 0 && !runningDue && (
              <span className="rounded bg-[#FFFBEB] border border-[#FDE68A] px-1.5 py-0.5 text-[11px] font-semibold text-[#B45309] tabular-nums">
                {summary.dueCount}
              </span>
            )}
          </MotionButton>

          <MotionButton variant="primary" onClick={openCreateModal}>
            <Plus className="h-4 w-4" aria-hidden={true} />
            <span>Tạo lịch định kỳ</span>
          </MotionButton>
        </div>
      </div>

      {isLoadingSkeleton ? (
        <TableSkeleton rows={4} />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[#475569]">
                <CheckCircle2 className="h-4 w-4 text-[#15803D]" aria-hidden={true} />
                <span>Lịch đang chạy</span>
              </div>
              <div className="mt-1.5 text-[24px] font-semibold leading-8 text-[#0F172A] tabular-nums">
                {summary.activeCount}
              </div>
            </div>

            <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[#475569]">
                <Clock className="h-4 w-4 text-[#B45309]" aria-hidden={true} />
                <span>Đến hạn tạo nháp</span>
              </div>
              <div className="mt-1.5 text-[24px] font-semibold leading-8 text-[#0F172A] tabular-nums">
                {summary.dueCount}
              </div>
            </div>

            <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[#475569]">
                <PauseCircle className="h-4 w-4 text-[#64748B]" aria-hidden={true} />
                <span>Đang tạm dừng</span>
              </div>
              <div className="mt-1.5 text-[24px] font-semibold leading-8 text-[#0F172A] tabular-nums">
                {summary.pausedCount}
              </div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedTabs
              layoutId="recurring-status-tabs"
              ariaLabel="Lọc trạng thái lịch định kỳ"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                {
                  value: 'ALL',
                  label: 'Tất cả',
                  badge: String(state.recurringRules.length),
                },
                {
                  value: 'ACTIVE',
                  label: 'Đang chạy',
                  badge: String(summary.activeCount),
                },
                {
                  value: 'PAUSED',
                  label: 'Tạm dừng',
                  badge: String(summary.pausedCount),
                },
              ]}
            />

            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
                aria-hidden={true}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên lịch, danh mục, ví..."
                aria-label="Tìm kiếm lịch định kỳ"
                className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-3 text-[14px] text-[#0F172A] placeholder:text-[#64748B] focus:border-[#4338CA] focus:outline-none"
              />
            </div>
          </div>

          {/* Recurring Rules List */}
          <section className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
            <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Repeat className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
                <h2 className="text-[14px] font-semibold text-[#0F172A]">
                  Danh sách lịch định kỳ
                </h2>
              </div>
              <span className="text-[12px] text-[#475569] tabular-nums">
                {visibleRules.length} mục
              </span>
            </div>

            {visibleRules.length === 0 ? (
              <div className="p-8 space-y-3">
                <p className="text-[15px] font-semibold text-[#0F172A]">
                  {state.recurringRules.length === 0
                    ? 'Chưa có lịch định kỳ nào'
                    : 'Không có lịch định kỳ khớp bộ lọc'}
                </p>
                <p className="text-[14px] text-[#475569]">
                  Thiết lập lịch nhận lương, tiền thuê nhà hoặc hóa đơn cố định để tạo nhanh bản
                  nháp khi đến hạn.
                </p>
                {state.recurringRules.length === 0 && (
                  <MotionButton variant="primary" onClick={openCreateModal}>
                    <Plus className="h-4 w-4" aria-hidden={true} />
                    <span>Tạo lịch định kỳ đầu tiên</span>
                  </MotionButton>
                )}
              </div>
            ) : (
              <ReducedMotionConfig>
                <div className="divide-y divide-[#E2E8F0]">
                  <AnimatePresence mode="popLayout">
                    {visibleRules.map((rule) => {
                      const categoryName =
                        getCategoryById(rule.categoryId)?.name ?? 'Danh mục';
                      const accountName =
                        getAccountById(rule.accountId)?.name ?? 'Tài khoản';
                      const displayTitle = rule.title?.trim() || categoryName;
                      const isIncome = rule.ruleKind === 'INCOME';
                      const isDue =
                        rule.isActive &&
                        rule.nextRunDate <= effectiveToday &&
                        (!rule.endDate || rule.nextRunDate <= rule.endDate);

                      return (
                        <AnimatedListRow
                          key={rule.id}
                          rowKey={rule.id}
                          className="p-5 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC]/60"
                        >
                          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            {/* Left: Title, Badges, Metadata */}
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-[16px] font-semibold leading-6 text-[#0F172A]">
                                  {displayTitle}
                                </h3>

                                {/* Rule Kind Badge (semantic color + icon + text) */}
                                {isIncome ? (
                                  <span className="inline-flex items-center gap-1 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-2 py-0.5 text-[12px] font-semibold leading-4 text-[#15803D]">
                                    <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden={true} />
                                    <span>Thu nhập</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2 py-0.5 text-[12px] font-semibold leading-4 text-[#B91C1C]">
                                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden={true} />
                                    <span>Chi tiêu</span>
                                  </span>
                                )}

                                {/* Active / Paused Badge */}
                                {rule.isActive ? (
                                  <span className="inline-flex items-center gap-1 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-2 py-0.5 text-[12px] font-semibold leading-4 text-[#15803D]">
                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden={true} />
                                    <span>Đang chạy</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-[12px] font-semibold leading-4 text-[#B45309]">
                                    <PauseCircle className="h-3.5 w-3.5" aria-hidden={true} />
                                    <span>Tạm dừng</span>
                                  </span>
                                )}

                                {/* Due Indicator */}
                                {isDue && (
                                  <span className="inline-flex items-center gap-1 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-[12px] font-semibold leading-4 text-[#B45309]">
                                    <Clock className="h-3.5 w-3.5" aria-hidden={true} />
                                    <span>Đến hạn</span>
                                  </span>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-5 text-[#475569]">
                                <span>
                                  Danh mục:{' '}
                                  <span className="font-semibold text-[#0F172A]">
                                    {categoryName}
                                  </span>
                                </span>
                                <span>
                                  Tài khoản:{' '}
                                  <span className="font-semibold text-[#0F172A]">
                                    {accountName}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Repeat className="h-3.5 w-3.5 text-[#64748B]" aria-hidden={true} />
                                  <span>
                                    {formatFrequencyText(rule.frequency, rule.intervalCount)}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <CalendarClock
                                    className="h-3.5 w-3.5 text-[#64748B]"
                                    aria-hidden={true}
                                  />
                                  <span>
                                    Chạy kế tiếp:{' '}
                                    <span className="font-semibold text-[#0F172A]">
                                      {formatDateVN(rule.nextRunDate)}
                                    </span>
                                  </span>
                                </span>
                                {rule.endDate && (
                                  <span className="tabular-nums text-[#64748B]">
                                    Kết thúc: {formatDateVN(rule.endDate)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Right: Amount + Controls (>= 44px touch targets) */}
                            <div className="flex flex-wrap items-center justify-between gap-3 md:justify-end">
                              <div className="md:text-right">
                                <div
                                  className={`text-[18px] font-semibold leading-6 tabular-nums ${
                                    isIncome ? 'text-[#15803D]' : 'text-[#0F172A]'
                                  }`}
                                >
                                  {isIncome ? '+' : '-'}
                                  {formatMoney(rule.amountMinor, rule.currencyCode)}
                                </div>
                                <div className="text-[12px] text-[#64748B]">
                                  Tạo nháp tự động
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <MotionButton
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditModal(rule)}
                                  aria-label={`Chỉnh sửa ${displayTitle}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden={true} />
                                  <span>Sửa</span>
                                </MotionButton>

                                {rule.isActive ? (
                                  <MotionButton
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => pauseRecurringRule(rule.id)}
                                  >
                                    <Pause className="h-3.5 w-3.5 text-[#B45309]" aria-hidden={true} />
                                    <span>Tạm dừng</span>
                                  </MotionButton>
                                ) : (
                                  <MotionButton
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => resumeRecurringRule(rule.id)}
                                  >
                                    <Play className="h-3.5 w-3.5 text-[#15803D]" aria-hidden={true} />
                                    <span>Tiếp tục</span>
                                  </MotionButton>
                                )}
                              </div>
                            </div>
                          </div>
                        </AnimatedListRow>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </ReducedMotionConfig>
            )}
          </section>
        </>
      )}

      {/* Create / Edit Recurring Rule Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRule ? 'Chỉnh sửa lịch định kỳ' : 'Tạo lịch định kỳ mới'}
        description="Khi đến ngày chạy kế tiếp, hệ thống tạo bản nháp chờ bạn xác nhận ghi sổ."
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleSubmitModal} className="space-y-4">
          {/* Kind Toggle */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold leading-4 text-[#475569]">
              Loại giao dịch định kỳ
            </span>
            {editingRule ? (
              <div className="min-h-[44px] inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[14px] text-[#0F172A]">
                {ruleKind === 'INCOME' ? (
                  <>
                    <ArrowDownLeft className="h-4 w-4 text-[#15803D]" aria-hidden={true} />
                    <span className="font-semibold">Thu nhập</span>
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="h-4 w-4 text-[#B91C1C]" aria-hidden={true} />
                    <span className="font-semibold">Chi tiêu</span>
                  </>
                )}
                <span className="text-[12px] text-[#64748B]">
                  (Không thể đổi loại khi chỉnh sửa)
                </span>
              </div>
            ) : (
              <div>
                <SegmentedTabs
                  layoutId="recurring-kind-tabs"
                  ariaLabel="Chọn loại giao dịch định kỳ"
                  value={ruleKind}
                  onChange={handleRuleKindChange}
                  options={[
                    { value: 'EXPENSE', label: 'Chi tiêu' },
                    { value: 'INCOME', label: 'Thu nhập' },
                  ]}
                />
              </div>
            )}
          </div>

          <ProgressiveAccountPicker
            accountId={selectedAccount?.id ?? ''}
            onChangeAccountId={(nextId) => {
              setAccountId(nextId);
              if (modalError) setModalError(null);
            }}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MoneyInput
              label="Số tiền định kỳ"
              currency={activeCurrency}
              value={amountRaw}
              resetKey={moneyResetKey}
              onChange={(val) => {
                setAmountRaw(val);
                if (modalError) setModalError(null);
              }}
            />

            <SearchableCombobox
              label={ruleKind === 'INCOME' ? 'Danh mục thu nhập' : 'Danh mục chi tiêu'}
              options={categoryOptions}
              value={categoryId}
              onChange={(val) => {
                setCategoryId(val);
                if (modalError) setModalError(null);
              }}
              placeholder="Chọn danh mục..."
              searchPlaceholder="Tìm tên danh mục..."
              emptyText="Không có danh mục phù hợp"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="recurring-title-input"
              className="text-[12px] font-semibold leading-4 text-[#475569]"
            >
              Tên gợi nhớ (tùy chọn)
            </label>
            <input
              id="recurring-title-input"
              type="text"
              value={titleRaw}
              onChange={(e) => setTitleRaw(e.target.value)}
              placeholder={
                ruleKind === 'INCOME' ? 'Ví dụ: Lương tháng' : 'Ví dụ: Tiền thuê nhà'
              }
              className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] placeholder:text-[#64748B] focus:border-[#4338CA] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SearchableCombobox
              label="Tần suất lặp"
              options={FREQUENCY_OPTIONS}
              value={frequency}
              onChange={(val) => setFrequency(val as RecurringFrequency)}
              placeholder="Chọn tần suất..."
              searchPlaceholder="Tìm tần suất..."
            />

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="recurring-interval-input"
                className="text-[12px] font-semibold leading-4 text-[#475569]"
              >
                Mỗi bao nhiêu {FREQUENCY_UNITS[frequency]}
              </label>
              <input
                id="recurring-interval-input"
                type="number"
                min={1}
                max={365}
                step={1}
                value={intervalRaw}
                onChange={(e) => {
                  setIntervalRaw(e.target.value);
                  if (modalError) setModalError(null);
                }}
                className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] tabular-nums text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DateInput
              label="Ngày chạy kế tiếp"
              isoValue={nextRunDate}
              onChangeISO={(iso) => {
                setNextRunDate(iso);
                if (modalError) setModalError(null);
              }}
            />

            <div className="flex flex-col gap-1.5">
              <label className="min-h-[44px] inline-flex items-center gap-2.5 pt-4 text-[14px] text-[#0F172A] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasEndDate}
                  onChange={(e) => {
                    setHasEndDate(e.target.checked);
                    if (e.target.checked && endDate < nextRunDate) {
                      setEndDate(nextRunDate);
                    }
                    if (modalError) setModalError(null);
                  }}
                  className="h-4 w-4 rounded border-[#CBD5E1] accent-[#4338CA]"
                />
                <span>Đặt ngày kết thúc (tùy chọn)</span>
              </label>
            </div>
          </div>

          {hasEndDate && (
            <DateInput
              label="Ngày kết thúc"
              isoValue={endDate}
              onChangeISO={(iso) => {
                setEndDate(iso);
                if (modalError) setModalError(null);
              }}
            />
          )}

          {modalError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-[13px] text-[#B91C1C]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden={true} />
              <span>{modalError}</span>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-[#E2E8F0]">
            <MotionButton variant="secondary" onClick={() => setModalOpen(false)}>
              Hủy
            </MotionButton>
            <MotionButton variant="primary" type="submit">
              {editingRule ? 'Lưu thay đổi' : 'Tạo lịch định kỳ'}
            </MotionButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
