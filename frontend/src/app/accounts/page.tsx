'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Archive,
  Edit3,
  Lock,
  Plus,
  ShieldAlert,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react';
import {
  CURRENCY_LIST,
  formatDateVN,
  formatMinorForInput,
  formatMoney,
  parseMoneyInput,
} from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type { Account, AccountType, CurrencyCode } from '@/lib/types';
import { MotionButton } from '@/components/ui/MotionPrimitives';
import { Modal } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { DateInput } from '@/components/ui/DateInput';
import { TableSkeleton } from '@/components/ui/Skeleton';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CASH: 'Tiền mặt',
  BANK: 'Ngân hàng',
  E_WALLET: 'Ví điện tử',
  CREDIT_CARD: 'Thẻ tín dụng',
  SAVINGS: 'Tiết kiệm',
};

function AccountsNewQueryTrigger({ onOpenCreate }: { onOpenCreate: () => void }) {
  const searchParams = useSearchParams();
  const wantsNew = searchParams.get('new') === '1';
  const [handled, setHandled] = useState(false);

  if (wantsNew && !handled) {
    setHandled(true);
    onOpenCreate();
  }

  return null;
}

export default function AccountsPage() {
  const {
    activeAccounts,
    archivedAccounts,
    isLoadingSkeleton,
    getAccountBalance,
    getAccountTxCount,
    createAccount,
    updateAccount,
    archiveAccount,
    adjustAccountBalance,
  } = usePreviewStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Account | null>(null);

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <AccountsNewQueryTrigger onOpenCreate={() => setCreateOpen(true)} />
      </Suspense>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-[24px] font-semibold leading-8 text-[#0F172A]">Tài khoản</h1>
          <p className="text-[14px] leading-5 text-[#475569]">
            Mỗi tài khoản gắn cố định 1 loại tiền tệ. Quản lý nhiều ví và thực hiện chuyển khoản nội bộ.
          </p>
        </div>

        <MotionButton variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden={true} />
          <span>Tạo tài khoản</span>
        </MotionButton>
      </div>

      {isLoadingSkeleton ? (
        <TableSkeleton rows={4} />
      ) : (
        <>
          {/* Active Accounts */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-[#0F172A]">
                Đang hoạt động ({activeAccounts.length})
              </h2>
              {activeAccounts.length === 1 && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[#475569]">
                  <ShieldAlert className="h-3.5 w-3.5 text-[#B45309]" aria-hidden={true} />
                  <span>Không thể lưu trữ tài khoản hoạt động cuối cùng</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {activeAccounts.map((acc) => {
                const balance = getAccountBalance(acc.id);
                const txCount = getAccountTxCount(acc.id);
                const isLastActive = activeAccounts.length <= 1;

                return (
                  <div
                    key={acc.id}
                    className="rounded-xl border border-[#E2E8F0] bg-white p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Wallet className="h-4 w-4 text-[#4338CA] shrink-0" aria-hidden={true} />
                          <h3 className="text-[16px] font-semibold text-[#0F172A] truncate">
                            {acc.name}
                          </h3>
                          {acc.isDefault && (
                            <span className="rounded bg-[#EEF2FF] border border-[#C7D2FE] px-2 py-0.5 text-[11px] font-semibold text-[#4338CA]">
                              Mặc định
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] text-[#64748B] tabular-nums">
                          {ACCOUNT_TYPE_LABELS[acc.accountType]} · {acc.currencyCode} · {txCount}{' '}
                          giao dịch
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[12px] text-[#64748B]">Số dư hiện tại</div>
                        <div
                          className={`text-[18px] font-semibold tabular-nums ${
                            balance < 0 ? 'text-[#B45309]' : 'text-[#0F172A]'
                          }`}
                        >
                          {formatMoney(balance, acc.currencyCode)}
                        </div>
                      </div>
                    </div>

                    <div className="text-[12px] text-[#64748B] tabular-nums border-t border-[#F1F5F9] pt-3">
                      Số dư đầu kỳ ({formatDateVN(acc.openingBalanceDate)}):{' '}
                      <span className="font-semibold text-[#334155]">
                        {formatMoney(acc.openingBalanceMinor, acc.currencyCode)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <MotionButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setAdjustTarget(acc)}
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden={true} />
                        <span>Điều chỉnh số dư</span>
                      </MotionButton>

                      <MotionButton
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditTarget(acc)}
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden={true} />
                        <span>Sửa</span>
                      </MotionButton>

                      <MotionButton
                        variant="ghost"
                        size="sm"
                        disabled={isLastActive}
                        title={
                          isLastActive
                            ? 'Không thể lưu trữ tài khoản đang hoạt động duy nhất cuối cùng'
                            : 'Lưu trữ tài khoản'
                        }
                        onClick={() => archiveAccount(acc.id)}
                        className="text-[#B91C1C]"
                      >
                        <Archive className="h-3.5 w-3.5" aria-hidden={true} />
                        <span>Lưu trữ</span>
                      </MotionButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Archived Accounts */}
          <section className="space-y-3">
            <h2 className="text-[16px] font-semibold text-[#0F172A]">
              Đã lưu trữ ({archivedAccounts.length})
            </h2>

            {archivedAccounts.length === 0 ? (
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 text-[13px] text-[#64748B]">
                Chưa có tài khoản nào được lưu trữ. Khi lưu trữ, tài khoản được ẩn khỏi danh sách tạo mới nhưng toàn bộ lịch sử giao dịch cũ vẫn được giữ nguyên.
              </div>
            ) : (
              <div className="rounded-xl border border-[#E2E8F0] bg-white divide-y divide-[#E2E8F0]">
                {archivedAccounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                  >
                    <div>
                      <div className="text-[14px] font-semibold text-[#475569]">{acc.name}</div>
                      <div className="text-[12px] text-[#64748B]">
                        {ACCOUNT_TYPE_LABELS[acc.accountType]} · {acc.currencyCode} · Đã lưu trữ
                      </div>
                    </div>
                    <div className="text-[14px] font-semibold text-[#475569] tabular-nums">
                      {formatMoney(getAccountBalance(acc.id), acc.currencyCode)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <CreateAccountModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createAccount}
      />

      <EditAccountModal
        account={editTarget}
        txCount={editTarget ? getAccountTxCount(editTarget.id) : 0}
        onClose={() => setEditTarget(null)}
        onUpdate={updateAccount}
      />

      <BalanceAdjustmentModal
        account={adjustTarget}
        currentBalance={adjustTarget ? getAccountBalance(adjustTarget.id) : 0}
        onClose={() => setAdjustTarget(null)}
        onAdjust={adjustAccountBalance}
      />
    </div>
  );
}

function CreateAccountModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    accountType: AccountType;
    currencyCode: CurrencyCode;
    openingBalanceMinor: number;
    openingBalanceDate: string;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('BANK');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('VND');
  const [openingRaw, setOpeningRaw] = useState('0');
  const [openingDate, setOpeningDate] = useState('2026-11-23');
  const [error, setError] = useState<string | null>(null);
  const [moneyResetKey, setMoneyResetKey] = useState(0);

  const applyPreset = (presetName: string, type: AccountType, cur: CurrencyCode, bal: string) => {
    setName(presetName);
    setAccountType(type);
    setCurrencyCode(cur);
    setOpeningRaw(bal);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Tên tài khoản không được để trống.');
      return;
    }
    const parsed = parseMoneyInput(openingRaw, currencyCode, { allowZero: true });
    if (!parsed.valid || parsed.minorValue === null) {
      setError(parsed.error ?? 'Số dư đầu kỳ không hợp lệ.');
      return;
    }

    onCreate({
      name: name.trim(),
      accountType,
      currencyCode,
      openingBalanceMinor: parsed.minorValue,
      openingBalanceDate: openingDate,
    });
    setName('');
    setOpeningRaw('0');
    setError(null);
    setMoneyResetKey((k) => k + 1);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tạo tài khoản mới"
      description="Số dư đầu kỳ không được tính vào Thu nhập hay Chi tiêu trong báo cáo dòng tiền."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-[#475569]">Gợi ý nhanh:</span>
          <button
            type="button"
            onClick={() => applyPreset('Vietcombank', 'BANK', 'VND', '12000000')}
            className="min-h-[36px] rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-[12px] font-semibold text-[#4338CA] cursor-pointer"
          >
            + Vietcombank (VND)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('Ví Ngoại tệ USD', 'E_WALLET', 'USD', '500.00')}
            className="min-h-[36px] rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-[12px] font-semibold text-[#4338CA] cursor-pointer"
          >
            + Ví USD
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="acc-name" className="text-[12px] font-semibold text-[#475569]">
            Tên tài khoản
          </label>
          <input
            id="acc-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Ví dụ: Vietcombank, MoMo, Tiền mặt"
            className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="acc-type" className="text-[12px] font-semibold text-[#475569]">
              Loại tài khoản
            </label>
            <select
              id="acc-type"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as AccountType)}
              className="min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white px-3 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
            >
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([val, lbl]) => (
                <option key={val} value={val}>
                  {lbl}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="acc-currency" className="text-[12px] font-semibold text-[#475569]">
              Tiền tệ
            </label>
            <select
              id="acc-currency"
              value={currencyCode}
              onChange={(e) => {
                setCurrencyCode(e.target.value as CurrencyCode);
                setError(null);
              }}
              className="min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white px-3 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
            >
              {CURRENCY_LIST.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <MoneyInput
          label={`Số dư đầu kỳ (${currencyCode})`}
          currency={currencyCode}
          value={openingRaw}
          resetKey={moneyResetKey}
          onChange={(val) => {
            setOpeningRaw(val);
            if (error) setError(null);
          }}
          allowZero
          externalError={error}
        />

        <DateInput
          label="Ngày mở sổ dư đầu kỳ"
          isoValue={openingDate}
          onChangeISO={setOpeningDate}
        />

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
          <MotionButton variant="secondary" onClick={onClose}>
            Hủy
          </MotionButton>
          <MotionButton type="submit" variant="primary">
            Tạo tài khoản
          </MotionButton>
        </div>
      </form>
    </Modal>
  );
}

function EditAccountModal({
  account,
  txCount,
  onClose,
  onUpdate,
}: {
  account: Account | null;
  txCount: number;
  onClose: () => void;
  onUpdate: (
    accountId: string,
    patch: { name: string; accountType: AccountType; currencyCode: CurrencyCode },
  ) => { ok: boolean; error?: string };
}) {
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('CASH');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('VND');
  const [lastId, setLastId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (account && account.id !== lastId) {
    setLastId(account.id);
    setName(account.name);
    setAccountType(account.accountType);
    setCurrencyCode(account.currencyCode);
    setError(null);
  }

  if (!account) return null;
  const currencyLocked = txCount > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Tên tài khoản không được để trống.');
      return;
    }
    const res = onUpdate(account.id, {
      name: name.trim(),
      accountType,
      currencyCode,
    });
    if (!res.ok) {
      setError(res.error ?? 'Không thể cập nhật.');
      return;
    }
    onClose();
  };

  return (
    <Modal open={Boolean(account)} onClose={onClose} title="Sửa thông tin tài khoản">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-acc-name" className="text-[12px] font-semibold text-[#475569]">
            Tên tài khoản
          </label>
          <input
            id="edit-acc-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-acc-type" className="text-[12px] font-semibold text-[#475569]">
            Loại tài khoản
          </label>
          <select
            id="edit-acc-type"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as AccountType)}
            className="min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white px-3 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
          >
            {Object.entries(ACCOUNT_TYPE_LABELS).map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-acc-cur" className="text-[12px] font-semibold text-[#475569]">
            Tiền tệ
          </label>
          <select
            id="edit-acc-cur"
            value={currencyCode}
            disabled={currencyLocked}
            onChange={(e) => setCurrencyCode(e.target.value as CurrencyCode)}
            className="min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white px-3 text-[14px] text-[#0F172A] disabled:bg-[#F1F5F9] disabled:text-[#64748B] focus:border-[#4338CA] focus:outline-none"
          >
            {CURRENCY_LIST.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          {currencyLocked && (
            <p className="flex items-center gap-1.5 text-[12px] text-[#64748B]">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
              <span>Đã khóa tiền tệ vì tài khoản đã có {txCount} giao dịch.</span>
            </p>
          )}
        </div>

        {error && <p className="text-[12px] text-[#B91C1C]">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
          <MotionButton variant="secondary" onClick={onClose}>
            Hủy
          </MotionButton>
          <MotionButton type="submit" variant="primary">
            Lưu thay đổi
          </MotionButton>
        </div>
      </form>
    </Modal>
  );
}

function BalanceAdjustmentModal({
  account,
  currentBalance,
  onClose,
  onAdjust,
}: {
  account: Account | null;
  currentBalance: number;
  onClose: () => void;
  onAdjust: (accountId: string, actualBalanceMinor: number, reason: string) => void;
}) {
  const [actualRaw, setActualRaw] = useState('');
  const [reason, setReason] = useState('');
  const [lastId, setLastId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (account && account.id !== lastId) {
    setLastId(account.id);
    setActualRaw(formatMinorForInput(Math.max(0, currentBalance), account.currencyCode));
    setReason('');
    setError(null);
  }

  if (!account) return null;

  const parsed = parseMoneyInput(actualRaw, account.currencyCode, { allowZero: true });
  const diff = parsed.valid && parsed.minorValue !== null ? parsed.minorValue - currentBalance : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.valid || parsed.minorValue === null) {
      setError(parsed.error ?? 'Số dư thực tế không hợp lệ.');
      return;
    }
    onAdjust(account.id, parsed.minorValue, reason);
    onClose();
  };

  return (
    <Modal
      open={Boolean(account)}
      onClose={onClose}
      title={`Điều chỉnh số dư: ${account.name}`}
      description="Tạo bút toán điều chỉnh độc lập, không làm sai lệch báo cáo Thu nhập & Chi tiêu."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-[13px] tabular-nums">
          Số dư hiện tại trên sổ:{' '}
          <strong className="font-semibold text-[#0F172A]">
            {formatMoney(currentBalance, account.currencyCode)}
          </strong>
        </div>

        <MoneyInput
          label={`Số dư thực tế kiểm đếm (${account.currencyCode})`}
          currency={account.currencyCode}
          value={actualRaw}
          resetKey={account.id}
          onChange={(val) => {
            setActualRaw(val);
            if (error) setError(null);
          }}
          allowZero
          externalError={error}
        />

        {parsed.valid && diff !== 0 && (
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-2.5 text-[13px] tabular-nums">
            Chênh lệch sẽ sinh:{' '}
            <strong
              className={`font-semibold ${diff > 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'}`}
            >
              {diff > 0 ? 'Điều chỉnh tăng' : 'Điều chỉnh giảm'} (
              {formatMoney(diff, account.currencyCode, { showSign: true })})
            </strong>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="adj-reason" className="text-[12px] font-semibold text-[#475569]">
            Lý do đối soát
          </label>
          <input
            id="adj-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ví dụ: Đối soát sao kê cuối tháng"
            className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
          <MotionButton variant="secondary" onClick={onClose}>
            Hủy
          </MotionButton>
          <MotionButton type="submit" variant="primary">
            Xác nhận điều chỉnh
          </MotionButton>
        </div>
      </form>
    </Modal>
  );
}
