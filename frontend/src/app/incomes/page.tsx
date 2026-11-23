'use client';

import React, { useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  Check,
  Paperclip,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { formatDateVN, formatMoney, newIdempotencyKey, parseMoneyInput } from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type { Transaction, TransactionStatus } from '@/lib/types';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { DateInput } from '@/components/ui/DateInput';
import { SearchableCombobox } from '@/components/ui/SearchableCombobox';
import { ProgressiveAccountPicker } from '@/components/ProgressiveAccountPicker';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { AnimatedListRow, MotionButton } from '@/components/ui/MotionPrimitives';
import { TransactionAttachmentsModal } from '@/components/TransactionAttachmentsModal';
import { TransactionVoidModal } from '@/components/TransactionVoidModal';

export default function IncomesPage() {
  const {
    state,
    dataMode,
    activeAccounts,
    isLoadingSkeleton,
    getAccountById,
    getCategoryById,
    getDemoAttachments,
    createTransaction,
    postTransaction,
    cancelDraftOptimistic,
    voidOrReverseTransaction,
  } = usePreviewStore();

  const incomeCategories = useMemo(
    () => state.categories.filter((c) => c.kind === 'INCOME' && !c.archivedAt),
    [state.categories],
  );

  const defaultAccount = activeAccounts.find((a) => a.isDefault) ?? activeAccounts[0];

  // Quick-Log 2-tap Form State
  const [accountId, setAccountId] = useState(defaultAccount?.id ?? '');
  const [amountRaw, setAmountRaw] = useState('');
  const [categoryId, setCategoryId] = useState(incomeCategories[0]?.id ?? '');
  const [sourceId, setSourceId] = useState(state.incomeSources[0]?.id ?? '');
  const [txDate, setTxDate] = useState('2026-11-23');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [moneyResetKey, setMoneyResetKey] = useState(0);

  // Filters & Modal
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TransactionStatus>('ALL');
  const [voidModalTx, setVoidModalTx] = useState<Transaction | null>(null);
  const [attachmentsTx, setAttachmentsTx] = useState<Transaction | null>(null);

  const selectedAccount =
    activeAccounts.find((a) => a.id === accountId) ?? defaultAccount;
  const activeCurrency = selectedAccount?.currencyCode ?? 'VND';

  const categoryOptions = useMemo(
    () =>
      incomeCategories.map((c, idx) => ({
        value: c.id,
        label: c.name,
        popular: idx < 2,
      })),
    [incomeCategories],
  );

  const sourceOptions = useMemo(
    () =>
      state.incomeSources.map((s) => ({
        value: s.id,
        label: s.name,
      })),
    [state.incomeSources],
  );

  const incomeList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.transactions.filter((tx) => {
      if (tx.entryType !== 'INCOME') return false;
      if (statusFilter !== 'ALL' && tx.status !== statusFilter) return false;
      if (q) {
        const catName = getCategoryById(tx.categoryId)?.name.toLowerCase() ?? '';
        return (
          tx.description.toLowerCase().includes(q) ||
          catName.includes(q)
        );
      }
      return true;
    });
  }, [getCategoryById, searchQuery, state.transactions, statusFilter]);

  const handleSave = (targetStatus: 'POSTED' | 'PENDING' | 'DRAFT') => {
    if (!selectedAccount) {
      setFormError('Không tìm thấy tài khoản hợp lệ.');
      return;
    }
    const parsed = parseMoneyInput(amountRaw, activeCurrency);
    if (!parsed.valid || parsed.minorValue === null) {
      setFormError(parsed.error ?? 'Số tiền không hợp lệ.');
      return;
    }
    if (!categoryId) {
      setFormError('Vui lòng chọn danh mục thu nhập.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const requestKey = idempotencyKey ?? newIdempotencyKey();
    if (!idempotencyKey) setIdempotencyKey(requestKey);

    const catName = getCategoryById(categoryId)?.name ?? 'Thu nhập';
    const res = createTransaction({
      accountId: selectedAccount.id,
      entryType: 'INCOME',
      status: targetStatus,
      amountMinor: parsed.minorValue,
      transactionDate: txDate,
      description: description.trim() || `${catName} (${formatDateVN(txDate)})`,
      note,
      categoryId,
      incomeSourceId: sourceId || undefined,
      idempotencyKey: requestKey,
    });

    setSubmitting(false);

    if (!res.ok) {
      setFormError(res.error ?? 'Không thể lưu giao dịch.');
      return;
    }

    // Reset form & clear request key so next entry gets a fresh UUID
    setAmountRaw('');
    setDescription('');
    setNote('');
    setIdempotencyKey(null);
    setMoneyResetKey((k) => k + 1);
  };

  const handleResetForm = () => {
    setAmountRaw('');
    setDescription('');
    setNote('');
    setFormError(null);
    setMoneyResetKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-[24px] font-semibold leading-8 text-[#0F172A]">Thu nhập</h1>
        <p className="text-[14px] leading-5 text-[#475569]">
          Ghi nhận dòng tiền đi vào tách biệt hoàn toàn khỏi Chi tiêu &amp; Hoàn tiền.
        </p>
      </div>

      {/* Quick-Log Form Card (1px border, flat) */}
      <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
            <h2 className="text-[16px] font-semibold text-[#0F172A]">
              Ghi nhanh Thu nhập (2 chạm)
            </h2>
          </div>
          <span className="text-[12px] text-[#64748B]">
            Tự động chống ghi trùng khi gửi
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MoneyInput
            label="Số tiền thu nhập"
            currency={activeCurrency}
            value={amountRaw}
            resetKey={moneyResetKey}
            onChange={(val) => {
              setAmountRaw(val);
              if (formError) setFormError(null);
            }}
          />

          <SearchableCombobox
            label="Danh mục thu nhập"
            options={categoryOptions}
            value={categoryId}
            onChange={setCategoryId}
            searchPlaceholder="Tìm danh mục thu nhập..."
          />

          <ProgressiveAccountPicker
            label="Tài khoản nhận"
            accountId={selectedAccount?.id ?? ''}
            onChangeAccountId={setAccountId}
          />

          <DateInput
            label="Ngày phát sinh"
            isoValue={txDate}
            onChangeISO={setTxDate}
          />

          <SearchableCombobox
            label="Nguồn thu (tùy chọn)"
            options={sourceOptions}
            value={sourceId}
            onChange={setSourceId}
            searchPlaceholder="Tìm nguồn thu..."
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="income-desc" className="text-[12px] font-semibold text-[#475569]">
              Mô tả ngắn (tùy chọn)
            </label>
            <input
              id="income-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ví dụ: Lương tháng 11 hoặc Freelance"
              className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] placeholder:text-[#64748B] focus:border-[#4338CA] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="income-note" className="text-[12px] font-semibold text-[#475569]">
            Ghi chú chi tiết
          </label>
          <input
            id="income-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú thêm (nếu có)"
            className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] placeholder:text-[#64748B] focus:border-[#4338CA] focus:outline-none"
          />
        </div>

        {formError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-[13px] text-[#B91C1C]"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden={true} />
            <span>{formError}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-[#E2E8F0]">
          <MotionButton
            variant="primary"
            disabled={submitting}
            onClick={() => handleSave('POSTED')}
          >
            <Check className="h-4 w-4" aria-hidden={true} />
            <span>Lưu & Ghi sổ</span>
          </MotionButton>

          <MotionButton
            variant="secondary"
            disabled={submitting}
            onClick={() => handleSave('PENDING')}
          >
            <span>Lưu chờ xử lý</span>
          </MotionButton>

          <MotionButton
            variant="secondary"
            disabled={submitting}
            onClick={() => handleSave('DRAFT')}
          >
            <span>Lưu nháp</span>
          </MotionButton>

          <MotionButton variant="ghost" onClick={handleResetForm}>
            <span>Hủy</span>
          </MotionButton>
        </div>
      </section>

      {/* Filter Bar */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
              aria-hidden={true}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm mô tả hoặc danh mục"
              aria-label="Tìm thu nhập"
              className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-3 text-[14px] text-[#0F172A] placeholder:text-[#64748B] focus:border-[#4338CA] focus:outline-none"
            />
          </div>

          <select
            aria-label="Lọc theo trạng thái"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | TransactionStatus)}
            className="min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white px-3 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
          >
            <option value="ALL">Tất cả trạng thái</option>
            <option value="POSTED">Đã ghi sổ</option>
            <option value="PENDING">Chờ xử lý</option>
            <option value="DRAFT">Bản nháp</option>
            <option value="VOIDED">Đã hủy</option>
          </select>
        </div>
      </div>

      {/* Income List */}
      {isLoadingSkeleton ? (
        <TableSkeleton rows={5} />
      ) : (
        <section className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
          <div className="hidden md:grid md:grid-cols-12 gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-[12px] font-semibold text-[#475569]">
            <div className="col-span-3">Giao dịch / Danh mục</div>
            <div className="col-span-2">Tài khoản</div>
            <div className="col-span-2">Trạng thái</div>
            <div className="col-span-2 text-right">Số tiền</div>
            <div className="col-span-3 text-right">Hành động</div>
          </div>

          {incomeList.length === 0 ? (
            <div className="p-8 text-left space-y-1">
              <p className="text-[14px] font-semibold text-[#0F172A]">
                Chưa có bản ghi thu nhập phù hợp
              </p>
              <p className="text-[13px] text-[#64748B]">
                Hãy nhập số tiền và danh mục ở biểu mẫu phía trên để ghi nhận khoản thu đầu tiên.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              <AnimatePresence initial={false}>
                {incomeList.map((tx) => {
                  const cat = getCategoryById(tx.categoryId);
                  const acc = getAccountById(tx.accountId);
                  const canDraftAct = tx.status === 'DRAFT' || tx.status === 'PENDING';
                  const canVoidPosted = tx.status === 'POSTED';
                  const demoAttCount =
                    dataMode === 'demo' ? getDemoAttachments(tx.id).length : 0;

                  return (
                    <AnimatedListRow
                      key={tx.id}
                      rowKey={tx.id}
                      className="grid grid-cols-1 md:grid-cols-12 items-center gap-3 px-4 py-3.5"
                    >
                      <div className="md:col-span-3 min-w-0 space-y-1">
                        <div className="text-[14px] font-semibold text-[#0F172A] truncate">
                          {tx.description}
                        </div>
                        <div className="text-[12px] text-[#64748B] tabular-nums">
                          {formatDateVN(tx.transactionDate)} · {cat?.name ?? 'Danh mục'}
                          {tx.voidReason ? ` · Lý do: ${tx.voidReason}` : ''}
                        </div>
                      </div>

                      <div className="md:col-span-2 text-[13px] text-[#475569] truncate">
                        {acc?.name ?? 'Tài khoản'}
                      </div>

                      <div className="md:col-span-2">
                        <StatusBadge status={tx.status} />
                      </div>

                      <div
                        className={`md:col-span-2 text-left md:text-right text-[14px] font-semibold tabular-nums ${
                          tx.status === 'VOIDED' || tx.status === 'REVERSED'
                            ? 'line-through text-[#64748B]'
                            : 'text-[#15803D]'
                        }`}
                      >
                        +{formatMoney(tx.amountMinor, tx.currencyCode)}
                      </div>

                      <div className="md:col-span-3 flex flex-wrap items-center justify-start md:justify-end gap-1.5">
                        <MotionButton
                          variant="secondary"
                          size="sm"
                          onClick={() => setAttachmentsTx(tx)}
                          aria-label={`Chứng từ giao dịch ${tx.description}`}
                        >
                          <Paperclip className="h-3.5 w-3.5 text-[#4338CA]" aria-hidden={true} />
                          <span>{demoAttCount > 0 ? `Chứng từ (${demoAttCount})` : 'Chứng từ'}</span>
                        </MotionButton>

                        {canDraftAct && (
                          <>
                            <MotionButton
                              variant="secondary"
                              size="sm"
                              onClick={() => postTransaction(tx.id)}
                            >
                              <span>Ghi sổ</span>
                            </MotionButton>
                            <MotionButton
                              variant="ghost"
                              size="sm"
                              onClick={() => cancelDraftOptimistic(tx.id)}
                              className="text-[#B91C1C]"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden={true} />
                              <span>Hủy nháp</span>
                            </MotionButton>
                          </>
                        )}

                        {canVoidPosted && (
                          <MotionButton
                            variant="secondary"
                            size="sm"
                            onClick={() => setVoidModalTx(tx)}
                          >
                            <span>Hủy / Đảo</span>
                          </MotionButton>
                        )}
                      </div>
                    </AnimatedListRow>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </section>
      )}

      <TransactionVoidModal
        transaction={voidModalTx}
        onClose={() => setVoidModalTx(null)}
        onConfirm={voidOrReverseTransaction}
      />

      <TransactionAttachmentsModal
        transaction={attachmentsTx}
        onClose={() => setAttachmentsTx(null)}
      />
    </div>
  );
}
