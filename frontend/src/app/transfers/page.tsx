'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Ban,
  Plus,
  Wallet,
} from 'lucide-react';
import {
  bankersRound,
  CURRENCIES,
  formatDateVN,
  formatMinorForInput,
  formatMoney,
  newIdempotencyKey,
  parseMoneyInput,
} from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { DateInput } from '@/components/ui/DateInput';
import { SearchableCombobox } from '@/components/ui/SearchableCombobox';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { AnimatedListRow, MotionButton } from '@/components/ui/MotionPrimitives';
import { StatusBadge } from '@/components/ui/StatusBadge';

import type { AccountType } from '@/lib/types';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CASH: 'Tiền mặt',
  BANK: 'Ngân hàng',
  E_WALLET: 'Ví điện tử',
  CREDIT_CARD: 'Thẻ tín dụng',
  SAVINGS: 'Tiết kiệm',
};

export default function TransfersPage() {
  const {
    state,
    activeAccounts,
    isLoadingSkeleton,
    getAccountBalance,
    getAccountById,
    createTransfer,
    voidTransfer,
  } = usePreviewStore();

  const [fromId, setFromId] = useState(activeAccounts[0]?.id ?? '');
  const [toId, setToId] = useState(activeAccounts[1]?.id ?? '');
  const [fromAmountRaw, setFromAmountRaw] = useState('');
  const [toAmountRaw, setToAmountRaw] = useState('');
  const [exchangeRateRaw, setExchangeRateRaw] = useState('25000');
  const [feeAmountRaw, setFeeAmountRaw] = useState('');
  const [transferDate, setTransferDate] = useState('2026-11-23');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [moneyResetKey, setMoneyResetKey] = useState(0);

  // Keep valid source & distinct destination automatically
  const effectiveFromAcc =
    activeAccounts.find((a) => a.id === fromId) ?? activeAccounts[0];
  const destinationPool = activeAccounts.filter((a) => a.id !== effectiveFromAcc?.id);
  const effectiveToAcc =
    destinationPool.find((a) => a.id === toId) ?? destinationPool[0];

  const isCrossCurrency =
    Boolean(effectiveFromAcc && effectiveToAcc) &&
    effectiveFromAcc.currencyCode !== effectiveToAcc.currencyCode;

  const fromOptions = useMemo(
    () =>
      activeAccounts.map((a) => ({
        value: a.id,
        label: a.name,
        sublabel: `${ACCOUNT_TYPE_LABELS[a.accountType]} · ${a.currencyCode}`,
        rightText: formatMoney(getAccountBalance(a.id), a.currencyCode),
      })),
    [activeAccounts, getAccountBalance],
  );

  const toOptions = useMemo(
    () =>
      destinationPool.map((a) => ({
        value: a.id,
        label: a.name,
        sublabel: `${ACCOUNT_TYPE_LABELS[a.accountType]} · ${a.currencyCode}`,
        rightText: formatMoney(getAccountBalance(a.id), a.currencyCode),
      })),
    [destinationPool, getAccountBalance],
  );

  const handleFromAmountChange = (raw: string) => {
    setFromAmountRaw(raw);
    if (formError) setFormError(null);
    if (isCrossCurrency && effectiveFromAcc && effectiveToAcc) {
      const parsedFrom = parseMoneyInput(raw, effectiveFromAcc.currencyCode);
      const rate = Number.parseFloat(exchangeRateRaw);
      if (parsedFrom.valid && parsedFrom.minorValue !== null && Number.isFinite(rate) && rate > 0) {
        const fromMajor =
          parsedFrom.minorValue /
          Math.pow(10, CURRENCIES[effectiveFromAcc.currencyCode].minorUnit);
        const toMinorUnit = CURRENCIES[effectiveToAcc.currencyCode].minorUnit;
        const estimatedToMinor = bankersRound(fromMajor * rate * Math.pow(10, toMinorUnit));
        if (estimatedToMinor > 0) {
          setToAmountRaw(formatMinorForInput(estimatedToMinor, effectiveToAcc.currencyCode));
        }
      }
    }
  };

  const handleRateChange = (rawRate: string) => {
    setExchangeRateRaw(rawRate);
    if (isCrossCurrency && effectiveFromAcc && effectiveToAcc) {
      const parsedFrom = parseMoneyInput(fromAmountRaw, effectiveFromAcc.currencyCode);
      const rate = Number.parseFloat(rawRate);
      if (parsedFrom.valid && parsedFrom.minorValue !== null && Number.isFinite(rate) && rate > 0) {
        const fromMajor =
          parsedFrom.minorValue /
          Math.pow(10, CURRENCIES[effectiveFromAcc.currencyCode].minorUnit);
        const toMinorUnit = CURRENCIES[effectiveToAcc.currencyCode].minorUnit;
        const estimatedToMinor = bankersRound(fromMajor * rate * Math.pow(10, toMinorUnit));
        if (estimatedToMinor > 0) {
          setToAmountRaw(formatMinorForInput(estimatedToMinor, effectiveToAcc.currencyCode));
        }
      }
    }
  };

  const handleToAmountChange = (rawTo: string) => {
    setToAmountRaw(rawTo);
    if (formError) setFormError(null);
    if (isCrossCurrency && effectiveFromAcc && effectiveToAcc) {
      const parsedFrom = parseMoneyInput(fromAmountRaw, effectiveFromAcc.currencyCode);
      const parsedTo = parseMoneyInput(rawTo, effectiveToAcc.currencyCode);
      if (
        parsedFrom.valid &&
        parsedFrom.minorValue &&
        parsedTo.valid &&
        parsedTo.minorValue
      ) {
        const fromMajor =
          parsedFrom.minorValue /
          Math.pow(10, CURRENCIES[effectiveFromAcc.currencyCode].minorUnit);
        const toMajor =
          parsedTo.minorValue / Math.pow(10, CURRENCIES[effectiveToAcc.currencyCode].minorUnit);
        if (fromMajor > 0) {
          setExchangeRateRaw((toMajor / fromMajor).toFixed(4));
        }
      }
    }
  };

  const parsedFrom = effectiveFromAcc
    ? parseMoneyInput(fromAmountRaw, effectiveFromAcc.currencyCode)
    : null;
  const parsedFee =
    effectiveFromAcc && feeAmountRaw.trim()
      ? parseMoneyInput(feeAmountRaw, effectiveFromAcc.currencyCode, { allowZero: true })
      : null;

  const sourceBalance = effectiveFromAcc ? getAccountBalance(effectiveFromAcc.id) : 0;
  const totalOutMinor =
    (parsedFrom?.valid && parsedFrom.minorValue ? parsedFrom.minorValue : 0) +
    (parsedFee?.valid && parsedFee.minorValue ? parsedFee.minorValue : 0);
  const showNegativeWarning =
    effectiveFromAcc && totalOutMinor > 0 && sourceBalance - totalOutMinor < 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveFromAcc || !effectiveToAcc) return;
    if (effectiveFromAcc.id === effectiveToAcc.id) {
      setFormError('Tài khoản nguồn và đích phải khác nhau.');
      return;
    }

    const fromParsed = parseMoneyInput(fromAmountRaw, effectiveFromAcc.currencyCode);
    if (!fromParsed.valid || fromParsed.minorValue === null) {
      setFormError(fromParsed.error ?? 'Số tiền chuyển không hợp lệ.');
      return;
    }

    let toMinor = fromParsed.minorValue;
    let finalRate = '1.00000000';

    if (isCrossCurrency) {
      const toParsed = parseMoneyInput(toAmountRaw, effectiveToAcc.currencyCode);
      if (!toParsed.valid || toParsed.minorValue === null) {
        setFormError(toParsed.error ?? 'Số tiền thực nhận không hợp lệ.');
        return;
      }
      toMinor = toParsed.minorValue;
      const rateNum = Number.parseFloat(exchangeRateRaw);
      if (!Number.isFinite(rateNum) || rateNum <= 0) {
        setFormError('Tỷ giá quy đổi phải lớn hơn 0.');
        return;
      }
      finalRate = rateNum.toFixed(8);
    }

    let feeMinor = 0;
    if (feeAmountRaw.trim()) {
      const feeParsed = parseMoneyInput(feeAmountRaw, effectiveFromAcc.currencyCode, {
        allowZero: true,
      });
      if (!feeParsed.valid || feeParsed.minorValue === null) {
        setFormError(feeParsed.error ?? 'Phí chuyển khoản không hợp lệ.');
        return;
      }
      feeMinor = feeParsed.minorValue;
    }

    const requestKey = idempotencyKey ?? newIdempotencyKey();
    if (!idempotencyKey) setIdempotencyKey(requestKey);

    const res = createTransfer({
      fromAccountId: effectiveFromAcc.id,
      toAccountId: effectiveToAcc.id,
      fromAmountMinor: fromParsed.minorValue,
      toAmountMinor: toMinor,
      exchangeRate: finalRate,
      feeAmountMinor: feeMinor > 0 ? feeMinor : undefined,
      transferDate,
      note,
      idempotencyKey: requestKey,
    });

    if (!res.ok) {
      setFormError(res.error ?? 'Không thể thực hiện chuyển khoản.');
      return;
    }

    setFromAmountRaw('');
    setToAmountRaw('');
    setFeeAmountRaw('');
    setNote('');
    setFormError(null);
    setIdempotencyKey(null);
    setMoneyResetKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[24px] font-semibold leading-8 text-[#0F172A]">Chuyển khoản</h1>
        <p className="text-[14px] leading-5 text-[#475569]">
          Luân chuyển tiền giữa các tài khoản — không tính vào Thu nhập, Chi tiêu hay Dòng tiền ròng.
        </p>
      </div>

      {/* Empty State when fewer than 2 accounts exist */}
      {activeAccounts.length < 2 ? (
        <section className="rounded-xl border border-[#E2E8F0] bg-white p-8 space-y-5">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[#E2E8F0] bg-[#EEF2FF] text-[#4338CA]">
            <Wallet className="h-6 w-6" aria-hidden={true} />
          </div>

          <div className="space-y-2 max-w-2xl">
            <h2 className="text-[18px] font-semibold text-[#0F172A]">
              Cần ít nhất 2 tài khoản để thực hiện chuyển khoản nội bộ
            </h2>
            <p className="text-[14px] leading-6 text-[#475569]">
              Hiện bạn đang có 1 tài khoản là{' '}
              <strong className="font-semibold text-[#0F172A]">
                {activeAccounts[0]?.name ?? 'Sổ chung'}
              </strong>
              . Tạo thêm một tài khoản ngân hàng, tiền mặt hoặc ví khác để luân chuyển số dư nội bộ.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/accounts">
              <MotionButton variant="primary">
                <Plus className="h-4 w-4" aria-hidden={true} />
                <span>Tạo tài khoản mới</span>
              </MotionButton>
            </Link>
          </div>
        </section>
      ) : (
        <>
          {/* Unlocked Atomic Transfer Form */}
          <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
                <h2 className="text-[16px] font-semibold text-[#0F172A]">
                  Tạo lệnh Chuyển khoản Nội bộ
                </h2>
              </div>
              <span className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1 text-[12px] font-semibold text-[#334155]">
                {isCrossCurrency
                  ? `Khác tiền tệ: ${effectiveFromAcc?.currencyCode} → ${effectiveToAcc?.currencyCode}`
                  : `Cùng tiền tệ: ${effectiveFromAcc?.currencyCode}`}
              </span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SearchableCombobox
                  label="Từ tài khoản nguồn"
                  options={fromOptions}
                  value={effectiveFromAcc?.id ?? ''}
                  onChange={(val) => {
                    setFromId(val);
                    setFormError(null);
                  }}
                />

                <SearchableCombobox
                  label="Đến tài khoản đích (tự loại trừ nguồn)"
                  options={toOptions}
                  value={effectiveToAcc?.id ?? ''}
                  onChange={(val) => {
                    setToId(val);
                    setFormError(null);
                  }}
                />

                {effectiveFromAcc && (
                  <MoneyInput
                    label={`Số tiền chuyển (${effectiveFromAcc.currencyCode})`}
                    currency={effectiveFromAcc.currencyCode}
                    value={fromAmountRaw}
                    resetKey={moneyResetKey}
                    onChange={handleFromAmountChange}
                  />
                )}

                <DateInput
                  label="Ngày chuyển khoản"
                  isoValue={transferDate}
                  onChangeISO={setTransferDate}
                />

                {/* Cross-Currency Controls */}
                {isCrossCurrency && effectiveToAcc && (
                  <>
                    <MoneyInput
                      label={`Số tiền thực nhận (${effectiveToAcc.currencyCode})`}
                      currency={effectiveToAcc.currencyCode}
                      value={toAmountRaw}
                      resetKey={moneyResetKey}
                      onChange={handleToAmountChange}
                      helperText="Áp dụng làm tròn chuẩn khi quy đổi."
                    />

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="fx-rate" className="text-[12px] font-semibold text-[#475569]">
                        Tỷ giá quy đổi (1 {effectiveFromAcc?.currencyCode} = ? {effectiveToAcc.currencyCode})
                      </label>
                      <input
                        id="fx-rate"
                        type="text"
                        inputMode="decimal"
                        value={exchangeRateRaw}
                        onChange={(e) => handleRateChange(e.target.value)}
                        className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] tabular-nums text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
                      />
                      <p className="text-[12px] text-[#64748B]">
                        Lưu lịch sử tỷ giá cố định trên giao dịch (không tính lại khi tỷ giá đổi).
                      </p>
                    </div>
                  </>
                )}

                {effectiveFromAcc && (
                  <MoneyInput
                    label={`Phí chuyển khoản (tùy chọn — ${effectiveFromAcc.currencyCode})`}
                    currency={effectiveFromAcc.currencyCode}
                    value={feeAmountRaw}
                    resetKey={moneyResetKey}
                    onChange={setFeeAmountRaw}
                    allowZero
                    helperText="Phí sẽ tự động tách thành một khoản chi tiêu riêng biệt."
                  />
                )}

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="transfer-note" className="text-[12px] font-semibold text-[#475569]">
                    Ghi chú chuyển khoản
                  </label>
                  <input
                    id="transfer-note"
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ví dụ: Nạp tiền sang Vietcombank chi tiêu tuần"
                    className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
                  />
                </div>
              </div>

              {showNegativeWarning && effectiveFromAcc && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-[13px] text-[#B45309]"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden={true} />
                  <span className="tabular-nums">
                    Cảnh báo mềm: Số dư của <strong>{effectiveFromAcc.name}</strong> sẽ âm (
                    {formatMoney(sourceBalance - totalOutMinor, effectiveFromAcc.currencyCode)}) sau
                    chuyển khoản &amp; phí.
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
                <MotionButton type="submit" variant="primary">
                  <ArrowLeftRight className="h-4 w-4" aria-hidden={true} />
                  <span>Thực hiện chuyển khoản</span>
                </MotionButton>
                <span className="text-[12px] text-[#64748B]">
                  Tự động cập nhật đồng thời số dư cả hai tài khoản.
                </span>
              </div>
            </form>
          </section>

          {/* Transfer History */}
          {isLoadingSkeleton ? (
            <TableSkeleton rows={4} />
          ) : (
            <section className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
              <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-[#0F172A]">
                  Lịch sử Chuyển khoản Nội bộ
                </h2>
                <span className="text-[12px] text-[#64748B]">
                  Không tính vào Dòng tiền ròng
                </span>
              </div>

              {state.transfers.length === 0 ? (
                <div className="p-8 text-left space-y-1">
                  <p className="text-[14px] font-semibold text-[#0F172A]">
                    Chưa có giao dịch chuyển khoản nào
                  </p>
                  <p className="text-[13px] text-[#64748B]">
                    Thử chuyển tiền từ &ldquo;{effectiveFromAcc?.name}&rdquo; sang &ldquo;{effectiveToAcc?.name}&rdquo; ở biểu mẫu trên.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0]">
                  <AnimatePresence initial={false}>
                    {state.transfers.map((tr) => {
                      const fromAcc = getAccountById(tr.fromAccountId);
                      const toAcc = getAccountById(tr.toAccountId);
                      const isFx = tr.fromCurrencyCode !== tr.toCurrencyCode;

                      return (
                        <AnimatedListRow
                          key={tr.id}
                          rowKey={tr.id}
                          className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[#0F172A]">
                              <span>{fromAcc?.name ?? 'Nguồn'}</span>
                              <ArrowRight className="h-4 w-4 text-[#64748B]" aria-hidden={true} />
                              <span>{toAcc?.name ?? 'Đích'}</span>
                              <StatusBadge status={tr.status} />
                            </div>
                            <div className="text-[12px] text-[#64748B] tabular-nums">
                              {formatDateVN(tr.transferDate)}
                              {isFx ? ` · Tỷ giá: ${Number(tr.exchangeRate)}` : ''}
                              {tr.feeAmountMinor
                                ? ` · Phí tách riêng (Chi tiêu): ${formatMoney(tr.feeAmountMinor, tr.fromCurrencyCode)}`
                                : ''}
                              {tr.note ? ` · ${tr.note}` : ''}
                            </div>
                          </div>

                          <div className="flex items-center justify-between md:justify-end gap-4">
                            <div className="text-left md:text-right tabular-nums">
                              <div className="text-[14px] font-semibold text-[#0F172A]">
                                {formatMoney(tr.fromAmountMinor, tr.fromCurrencyCode)}
                                {isFx && (
                                  <span className="text-[#15803D]">
                                    {' '}
                                    → {formatMoney(tr.toAmountMinor, tr.toCurrencyCode)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {tr.status === 'POSTED' && (
                              <MotionButton
                                variant="ghost"
                                size="sm"
                                onClick={() => voidTransfer(tr.id)}
                                className="text-[#B91C1C]"
                              >
                                <Ban className="h-3.5 w-3.5" aria-hidden={true} />
                                <span>Hủy lệnh</span>
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
        </>
      )}
    </div>
  );
}
