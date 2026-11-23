'use client';

import React, { useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  formatDateVN,
  formatMinorForInput,
  formatMoney,
  newIdempotencyKey,
  parseMoneyInput,
} from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type { Transaction, TransactionStatus } from '@/lib/types';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { DateInput } from '@/components/ui/DateInput';
import { SearchableCombobox } from '@/components/ui/SearchableCombobox';
import { ProgressiveAccountPicker } from '@/components/ProgressiveAccountPicker';
import { EntryTypeBadge, StatusBadge } from '@/components/ui/StatusBadge';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { AnimatedListRow, MotionButton } from '@/components/ui/MotionPrimitives';
import { Modal } from '@/components/ui/Modal';
import { TransactionAttachmentsModal } from '@/components/TransactionAttachmentsModal';
import { TransactionVoidModal } from '@/components/TransactionVoidModal';

export default function ExpensesPage() {
  const {
    state,
    dataMode,
    activeAccounts,
    isLoadingSkeleton,
    getAccountBalance,
    getAccountById,
    getCategoryById,
    getDemoAttachments,
    getRefundableRemaining,
    createTransaction,
    postTransaction,
    cancelDraftOptimistic,
    voidOrReverseTransaction,
    createExpenseRefund,
  } = usePreviewStore();

  const expenseCategories = useMemo(
    () => state.categories.filter((c) => c.kind === 'EXPENSE' && !c.archivedAt),
    [state.categories],
  );

  const defaultAccount = activeAccounts.find((a) => a.isDefault) ?? activeAccounts[0];

  // Quick-Log Form State
  const [accountId, setAccountId] = useState(defaultAccount?.id ?? '');
  const [amountRaw, setAmountRaw] = useState('');
  const [categoryId, setCategoryId] = useState(expenseCategories[0]?.id ?? '');
  const [merchantId, setMerchantId] = useState(state.merchants[0]?.id ?? '');
  const [txDate, setTxDate] = useState('2026-11-23');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [moneyResetKey, setMoneyResetKey] = useState(0);

  // Filters & Modals
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TransactionStatus>('ALL');
  const [refundTargetTx, setRefundTargetTx] = useState<Transaction | null>(null);
  const [voidModalTx, setVoidModalTx] = useState<Transaction | null>(null);
  const [attachmentsTx, setAttachmentsTx] = useState<Transaction | null>(null);

  const selectedAccount =
    activeAccounts.find((a) => a.id === accountId) ?? defaultAccount;
  const activeCurrency = selectedAccount?.currencyCode ?? 'VND';

  const parsedCurrentAmount = amountRaw.trim()
    ? parseMoneyInput(amountRaw, activeCurrency)
    : null;

  // Soft Negative Balance Warning for selected wallet
  const currentBalance = selectedAccount ? getAccountBalance(selectedAccount.id) : 0;
  const showNegativeSoftWarning =
    parsedCurrentAmount?.valid &&
    parsedCurrentAmount.minorValue !== null &&
    currentBalance - parsedCurrentAmount.minorValue < 0;

  const categoryOptions = useMemo(
    () =>
      expenseCategories.map((c, idx) => ({
        value: c.id,
        label: c.name,
        popular: idx < 3,
      })),
    [expenseCategories],
  );

  const merchantOptions = useMemo(
    () =>
      state.merchants.map((m) => ({
        value: m.id,
        label: m.name,
      })),
    [state.merchants],
  );

  const expenseList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.transactions.filter((tx) => {
      if (tx.entryType !== 'EXPENSE' && tx.entryType !== 'EXPENSE_REFUND') return false;
      if (statusFilter !== 'ALL' && tx.status !== statusFilter) return false;
      if (q) {
        const catName = getCategoryById(tx.categoryId)?.name.toLowerCase() ?? '';
        return tx.description.toLowerCase().includes(q) || catName.includes(q);
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
      setFormError('Vui lòng chọn danh mục chi tiêu.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const requestKey = idempotencyKey ?? newIdempotencyKey();
    if (!idempotencyKey) setIdempotencyKey(requestKey);

    const catName = getCategoryById(categoryId)?.name ?? 'Chi tiêu';
    const res = createTransaction({
      accountId: selectedAccount.id,
      entryType: 'EXPENSE',
      status: targetStatus,
      amountMinor: parsed.minorValue,
      transactionDate: txDate,
      description: description.trim() || `${catName} (${formatDateVN(txDate)})`,
      note,
      categoryId,
      merchantId: merchantId || undefined,
      idempotencyKey: requestKey,
    });

    setSubmitting(false);

    if (!res.ok) {
      setFormError(res.error ?? 'Không thể lưu giao dịch.');
      return;
    }

    setAmountRaw('');
    setDescription('');
    setNote('');
    setIdempotencyKey(null);
    setMoneyResetKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-[24px] font-semibold leading-8 text-[#0F172A]">Chi tiêu</h1>

      {/* Quick-Log Expense Card */}
      <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
            <h2 className="text-[16px] font-semibold text-[#0F172A]">
              Ghi nhanh Chi tiêu (2 chạm)
            </h2>
          </div>
          <span className="text-[12px] text-[#64748B]">
            Tự động chống ghi trùng khi gửi
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MoneyInput
            label="Số tiền chi tiêu"
            currency={activeCurrency}
            value={amountRaw}
            resetKey={moneyResetKey}
            onChange={(val) => {
              setAmountRaw(val);
              if (formError) setFormError(null);
            }}
          />

          <SearchableCombobox
            label="Danh mục chi tiêu (gõ tìm & cuộn)"
            options={categoryOptions}
            value={categoryId}
            onChange={setCategoryId}
            searchPlaceholder="Tìm danh mục chi tiêu..."
          />

          <ProgressiveAccountPicker
            label="Tài khoản chi"
            accountId={selectedAccount?.id ?? ''}
            onChangeAccountId={setAccountId}
          />

          <DateInput
            label="Ngày chi tiêu"
            isoValue={txDate}
            onChangeISO={setTxDate}
          />

          <SearchableCombobox
            label="Cửa hàng / Người nhận (tùy chọn)"
            options={merchantOptions}
            value={merchantId}
            onChange={setMerchantId}
            searchPlaceholder="Tìm cửa hàng..."
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="expense-desc" className="text-[12px] font-semibold text-[#475569]">
              Mô tả ngắn (tùy chọn)
            </label>
            <input
              id="expense-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ví dụ: Ăn trưa, đi siêu thị WinMart"
              className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] placeholder:text-[#64748B] focus:border-[#4338CA] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="expense-note" className="text-[12px] font-semibold text-[#475569]">
            Ghi chú chi tiết
          </label>
          <input
            id="expense-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ghi chú thêm (nếu có)"
            className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] placeholder:text-[#64748B] focus:border-[#4338CA] focus:outline-none"
          />
        </div>

        {/* Soft Warning only shown in Multi-Account Mode */}
        {showNegativeSoftWarning && selectedAccount && parsedCurrentAmount?.minorValue && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-[13px] text-[#B45309]"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden={true} />
            <span className="tabular-nums">
              Cảnh báo mềm: Số dư của <strong>{selectedAccount.name}</strong> sẽ âm (
              {formatMoney(currentBalance - parsedCurrentAmount.minorValue, activeCurrency)}) sau giao
              dịch này. Bạn vẫn có thể tiếp tục lưu.
            </span>
          </div>
        )}

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

          <MotionButton
            variant="ghost"
            onClick={() => {
              setAmountRaw('');
              setDescription('');
              setNote('');
              setFormError(null);
              setMoneyResetKey((k) => k + 1);
            }}
          >
            <span>Hủy</span>
          </MotionButton>
        </div>
      </section>

      {/* Filters */}
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
              aria-label="Tìm chi tiêu"
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

      {/* Expense & Refund Ledger */}
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

          {expenseList.length === 0 ? (
            <div className="p-8 text-left space-y-1">
              <p className="text-[14px] font-semibold text-[#0F172A]">
                Chưa có giao dịch chi tiêu phù hợp
              </p>
              <p className="text-[13px] text-[#64748B]">
                Nhập số tiền và chọn danh mục ở biểu mẫu trên để ghi chi tiêu đầu tiên.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              <AnimatePresence initial={false}>
                {expenseList.map((tx) => {
                  const cat = getCategoryById(tx.categoryId);
                  const acc = getAccountById(tx.accountId);
                  const isRefund = tx.entryType === 'EXPENSE_REFUND';
                  const refundable = !isRefund && tx.status === 'POSTED' ? getRefundableRemaining(tx.id) : 0;
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
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold text-[#0F172A] truncate">
                            {tx.description}
                          </span>
                          <EntryTypeBadge entryType={tx.entryType} />
                        </div>
                        <div className="text-[12px] text-[#64748B] tabular-nums">
                          {formatDateVN(tx.transactionDate)} · {cat?.name ?? 'Danh mục'}
                          {!isRefund && tx.status === 'POSTED' && refundable < tx.amountMinor
                            ? ` · Còn hoàn được: ${formatMoney(refundable, tx.currencyCode)}`
                            : ''}
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
                            : isRefund
                              ? 'text-[#15803D]'
                              : 'text-[#0F172A]'
                        }`}
                      >
                        {isRefund ? '+' : '-'}
                        {formatMoney(tx.amountMinor, tx.currencyCode)}
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

                        {!isRefund && tx.status === 'POSTED' && refundable > 0 && (
                          <MotionButton
                            variant="secondary"
                            size="sm"
                            onClick={() => setRefundTargetTx(tx)}
                          >
                            <RotateCcw className="h-3.5 w-3.5 text-[#15803D]" aria-hidden={true} />
                            <span>Hoàn tiền</span>
                          </MotionButton>
                        )}

                        {canVoidPosted && (
                          <MotionButton
                            variant="ghost"
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

      <ExpenseRefundModal
        originalTx={refundTargetTx}
        onClose={() => setRefundTargetTx(null)}
        onSubmitRefund={createExpenseRefund}
      />

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

function ExpenseRefundModal({
  originalTx,
  onClose,
  onSubmitRefund,
}: {
  originalTx: Transaction | null;
  onClose: () => void;
  onSubmitRefund: (input: {
    originalTransactionId: string;
    accountId: string;
    amountMinor: number;
    transactionDate: string;
    note?: string;
    idempotencyKey?: string;
  }) => { ok: boolean; error?: string };
}) {
  const { activeAccounts, getAccountBalance, getCategoryById, getRefundableRemaining } =
    usePreviewStore();

  const remaining = originalTx ? getRefundableRemaining(originalTx.id) : 0;

  const [refundAmountRaw, setRefundAmountRaw] = useState('');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [refundDate, setRefundDate] = useState('2026-11-23');
  const [note, setNote] = useState('');
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (originalTx && originalTx.id !== lastTxId) {
    setLastTxId(originalTx.id);
    const rem = getRefundableRemaining(originalTx.id);
    setRefundAmountRaw(formatMinorForInput(rem, originalTx.currencyCode));
    setTargetAccountId(originalTx.accountId);
    setNote('');
    setError(null);
  }

  if (!originalTx) return null;

  const sameCurrencyAccounts = activeAccounts.filter(
    (a) => a.currencyCode === originalTx.currencyCode,
  );
  const effectiveAccId =
    sameCurrencyAccounts.find((a) => a.id === targetAccountId)?.id ??
    sameCurrencyAccounts[0]?.id ??
    originalTx.accountId;

  const parsedRefund = parseMoneyInput(refundAmountRaw, originalTx.currencyCode);
  const exceedsRemaining =
    parsedRefund.valid &&
    parsedRefund.minorValue !== null &&
    parsedRefund.minorValue > remaining;

  const inlineRefundError = exceedsRemaining
    ? `Số tiền hoàn (${formatMoney(parsedRefund.minorValue!, originalTx.currencyCode)}) vượt quá phần còn lại (${formatMoney(remaining, originalTx.currencyCode)}).`
    : error;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsedRefund.valid || parsedRefund.minorValue === null) {
      setError(parsedRefund.error ?? 'Số tiền hoàn không hợp lệ.');
      return;
    }
    if (parsedRefund.minorValue > remaining) {
      setError('Không được hoàn vượt quá giá trị giao dịch gốc.');
      return;
    }

    const res = onSubmitRefund({
      originalTransactionId: originalTx.id,
      accountId: effectiveAccId,
      amountMinor: parsedRefund.minorValue,
      transactionDate: refundDate,
      note,
      idempotencyKey: newIdempotencyKey(),
    });

    if (!res.ok) {
      setError(res.error ?? 'Không thể tạo hoàn tiền.');
      return;
    }
    onClose();
  };

  const categoryName = getCategoryById(originalTx.categoryId)?.name ?? 'Danh mục';

  return (
    <Modal
      open={Boolean(originalTx)}
      onClose={onClose}
      title="Ghi nhận hoàn tiền"
      description="Hoàn tiền giảm chi tiêu ròng & tăng lại hạn mức ngân sách gốc, không cộng vào Thu nhập."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-[#0F172A]">
              {originalTx.description}
            </span>
            <span className="rounded bg-white border border-[#E2E8F0] px-2 py-0.5 text-[11px] font-semibold text-[#334155]">
              Khóa danh mục: {categoryName}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 text-[12px] text-[#475569] tabular-nums">
            <span>Gốc: {formatMoney(originalTx.amountMinor, originalTx.currencyCode)}</span>
            <span className="font-semibold text-[#15803D]">
              Còn có thể hoàn tối đa: {formatMoney(remaining, originalTx.currencyCode)}
            </span>
          </div>
        </div>

        <MoneyInput
          label={`Số tiền hoàn (<= ${formatMoney(remaining, originalTx.currencyCode)})`}
          currency={originalTx.currencyCode}
          value={refundAmountRaw}
          resetKey={originalTx.id}
          onChange={(val) => {
            setRefundAmountRaw(val);
            if (error) setError(null);
          }}
          externalError={inlineRefundError}
        />

        <SearchableCombobox
          label={`Tài khoản nhận hoàn (chỉ ${originalTx.currencyCode})`}
          options={sameCurrencyAccounts.map((a) => ({
            value: a.id,
            label: a.name,
            rightText: formatMoney(getAccountBalance(a.id), a.currencyCode),
          }))}
          value={effectiveAccId}
          onChange={setTargetAccountId}
        />

        <DateInput
          label="Ngày nhận hoàn"
          isoValue={refundDate}
          onChangeISO={setRefundDate}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="refund-note" className="text-[12px] font-semibold text-[#475569]">
            Ghi chú hoàn tiền
          </label>
          <input
            id="refund-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: Hoàn trả hàng lỗi hoặc hoàn tiền cọc"
            className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
          <MotionButton variant="secondary" onClick={onClose}>
            Hủy
          </MotionButton>
          <MotionButton
            type="submit"
            variant="primary"
            disabled={exceedsRemaining}
          >
            Xác nhận Hoàn tiền
          </MotionButton>
        </div>
      </form>
    </Modal>
  );
}
