'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type { AccountType } from '@/lib/types';
import { SearchableCombobox } from './ui/SearchableCombobox';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CASH: 'Tiền mặt',
  BANK: 'Ngân hàng',
  E_WALLET: 'Ví điện tử',
  CREDIT_CARD: 'Thẻ tín dụng',
  SAVINGS: 'Tiết kiệm',
};

export function ProgressiveAccountPicker({
  accountId,
  onChangeAccountId,
  label = 'Tài khoản',
}: {
  accountId: string;
  onChangeAccountId: (nextId: string) => void;
  label?: string;
}) {
  const { activeAccounts, getAccountBalance, getAccountById } = usePreviewStore();

  const defaultAccount = activeAccounts.find((a) => a.isDefault) ?? activeAccounts[0];
  const selected =
    (accountId ? getAccountById(accountId) : undefined) ?? defaultAccount;

  const options = useMemo(
    () =>
      activeAccounts.map((acc) => ({
        value: acc.id,
        label: acc.name,
        sublabel: `${ACCOUNT_TYPE_LABELS[acc.accountType]} · ${acc.currencyCode}`,
        rightText: formatMoney(getAccountBalance(acc.id), acc.currencyCode),
        popular: acc.isDefault,
      })),
    [activeAccounts, getAccountBalance],
  );

  return (
    <div className="space-y-1.5">
      <SearchableCombobox
        label={label}
        options={options}
        value={selected?.id ?? ''}
        onChange={onChangeAccountId}
        placeholder="Chọn tài khoản"
        searchPlaceholder="Tìm tên ví hoặc ngân hàng"
      />
      <div className="flex items-center justify-end">
        <Link
          href="/accounts"
          className="inline-flex items-center text-[12px] font-semibold text-[#4338CA] [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
        >
          + Quản lý ví
        </Link>
      </div>
    </div>
  );
}
