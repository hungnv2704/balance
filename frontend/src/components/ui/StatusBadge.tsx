'use client';

import React from 'react';
import {
  Ban,
  CheckCircle2,
  Clock,
  FileEdit,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import type { TransactionEntryType, TransactionStatus } from '@/lib/types';

const STATUS_CONFIG: Record<
  TransactionStatus,
  {
    label: string;
    classes: string;
    Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  }
> = {
  POSTED: {
    label: 'Đã ghi sổ',
    classes: 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]',
    Icon: CheckCircle2,
  },
  PENDING: {
    label: 'Chờ xử lý',
    classes: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]',
    Icon: Clock,
  },
  DRAFT: {
    label: 'Nháp',
    classes: 'bg-[#F1F5F9] text-[#334155] border-[#CBD5E1]',
    Icon: FileEdit,
  },
  VOIDED: {
    label: 'Đã hủy',
    classes: 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]',
    Icon: Ban,
  },
  REVERSED: {
    label: 'Đã đảo sổ',
    classes: 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]',
    Icon: RotateCcw,
  },
};

export function StatusBadge({ status }: { status: TransactionStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.Icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-semibold leading-4 whitespace-nowrap ${cfg.classes}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
      <span>{cfg.label}</span>
    </span>
  );
}

export function EntryTypeBadge({ entryType }: { entryType: TransactionEntryType }) {
  if (entryType === 'EXPENSE_REFUND') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-2 py-0.5 text-[12px] font-semibold leading-4 text-[#15803D] whitespace-nowrap">
        <RotateCcw className="h-3 w-3 shrink-0" aria-hidden={true} />
        <span>Hoàn tiền</span>
      </span>
    );
  }
  if (entryType === 'ADJUSTMENT_CREDIT' || entryType === 'ADJUSTMENT_DEBIT') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-[#F1F5F9] px-2 py-0.5 text-[12px] font-semibold leading-4 text-[#334155] whitespace-nowrap">
        <SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden={true} />
        <span>Điều chỉnh</span>
      </span>
    );
  }
  return null;
}
