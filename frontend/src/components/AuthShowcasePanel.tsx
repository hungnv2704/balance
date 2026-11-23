'use client';

import React from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from 'lucide-react';

const SAMPLE_LEDGER_ROWS = [
  {
    id: 'sample-1',
    title: 'Lương tháng 11',
    meta: 'Vietcombank · Thu nhập',
    amount: '+25.000.000 ₫',
    amountClass: 'text-[#15803D]',
    Icon: ArrowDownLeft,
    iconClass: 'text-[#15803D]',
  },
  {
    id: 'sample-2',
    title: 'Rút tiền chi tiêu tuần',
    meta: 'Vietcombank → Ví tiền mặt',
    amount: '3.000.000 ₫',
    amountClass: 'text-[#475569]',
    Icon: ArrowLeftRight,
    iconClass: 'text-[#475569]',
  },
  {
    id: 'sample-3',
    title: 'Ăn uống & siêu thị',
    meta: 'Ví tiền mặt · Chi tiêu',
    amount: '-4.100.000 ₫',
    amountClass: 'text-[#0F172A]',
    Icon: ArrowUpRight,
    iconClass: 'text-[#B91C1C]',
  },
] as const;

export function AuthShowcasePanel() {
  return (
    <aside
      aria-label="Giới thiệu Balance"
      className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-6 sm:p-8 space-y-6"
    >
      {/* Brand Lockup */}
      <div className="flex items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/balance-logo.png"
          alt="Balance"
          className="h-9 w-auto object-contain"
        />
      </div>

      {/* Product Headline & Copy */}
      <div className="space-y-2">
        <h2 className="text-[22px] font-semibold leading-7 text-[#0F172A] text-balance">
          Quản lý thu chi và nhiều ví tách biệt theo từng loại tiền tệ
        </h2>
        <p className="text-[14px] leading-5 text-[#475569] text-pretty">
          Theo dõi số dư thực tế, chuyển khoản nội bộ và ngân sách tháng trên một sổ cái thống nhất.
        </p>
      </div>

      {/* One Real Product Moment: Multi-Currency Ledger Snapshot */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] pb-3">
          <span className="text-[13px] font-semibold text-[#0F172A]">
            Số dư theo tiền tệ
          </span>
          <span className="text-[12px] text-[#64748B] tabular-nums">11/2026</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 space-y-1">
            <div className="text-[12px] text-[#475569] tabular-nums">VND · 2 ví</div>
            <div className="text-[16px] font-semibold text-[#0F172A] tabular-nums">
              20.420.000 ₫
            </div>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 space-y-1">
            <div className="text-[12px] text-[#475569] tabular-nums">USD · 1 ví</div>
            <div className="text-[16px] font-semibold text-[#0F172A] tabular-nums">
              $1,205.50 USD
            </div>
          </div>
        </div>

        <div className="divide-y divide-[#E2E8F0] border-t border-[#E2E8F0]">
          {SAMPLE_LEDGER_ROWS.map((row) => {
            const Icon = row.Icon;
            return (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-3 last:pb-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
                    <Icon className={`h-4 w-4 ${row.iconClass}`} aria-hidden={true} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[#0F172A]">
                      {row.title}
                    </div>
                    <div className="truncate text-[12px] text-[#64748B]">{row.meta}</div>
                  </div>
                </div>
                <div
                  className={`shrink-0 text-right text-[13px] font-semibold tabular-nums ${row.amountClass}`}
                >
                  {row.amount}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
