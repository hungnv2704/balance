'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import type { Transaction } from '@/lib/types';
import { Modal } from './ui/Modal';
import { MotionButton } from './ui/MotionPrimitives';

export function TransactionVoidModal({
  transaction,
  onClose,
  onConfirm,
}: {
  transaction: Transaction | null;
  onClose: () => void;
  onConfirm: (txId: string, mode: 'VOIDED' | 'REVERSED', reason: string) => void;
}) {
  const [mode, setMode] = useState<'VOIDED' | 'REVERSED'>('VOIDED');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!transaction) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('Vui lòng nhập lý do hủy/đảo tối thiểu 3 ký tự để lưu vết kiểm toán.');
      return;
    }
    onConfirm(transaction.id, mode, reason.trim());
    setReason('');
    setError(null);
    onClose();
  };

  return (
    <Modal
      open={Boolean(transaction)}
      onClose={onClose}
      title="Hủy hoặc Đảo bút toán đã ghi sổ"
      description="Giao dịch đã ghi sổ không thể xóa trực tiếp để bảo toàn lịch sử đối soát tài chính."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-1">
          <div className="text-[14px] font-semibold text-[#0F172A]">
            {transaction.description}
          </div>
          <div className="text-[13px] text-[#475569] tabular-nums">
            Giá trị: <span className="font-semibold text-[#0F172A]">{formatMoney(transaction.amountMinor, transaction.currencyCode)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-[12px] font-semibold text-[#475569]">
            Phương thức xử lý
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('VOIDED')}
              className={[
                'min-h-[44px] rounded-lg border p-3 text-left transition-colors cursor-pointer',
                mode === 'VOIDED'
                  ? 'border-[#4338CA] bg-[#EEF2FF]'
                  : 'border-[#E2E8F0] bg-white',
              ].join(' ')}
            >
              <div className="text-[13px] font-semibold text-[#0F172A]">Hủy sổ</div>
              <div className="text-[12px] text-[#475569]">Loại trực tiếp khỏi số dư & báo cáo</div>
            </button>

            <button
              type="button"
              onClick={() => setMode('REVERSED')}
              className={[
                'min-h-[44px] rounded-lg border p-3 text-left transition-colors cursor-pointer',
                mode === 'REVERSED'
                  ? 'border-[#4338CA] bg-[#EEF2FF]'
                  : 'border-[#E2E8F0] bg-white',
              ].join(' ')}
            >
              <div className="text-[13px] font-semibold text-[#0F172A]">Đảo ngược</div>
              <div className="text-[12px] text-[#475569]">Sinh bút toán bù trừ đối ứng</div>
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="void-reason" className="text-[12px] font-semibold text-[#475569]">
            Lý do thực hiện (bắt buộc)
          </label>
          <input
            id="void-reason"
            type="text"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Ví dụ: Nhập nhầm số tiền hoặc sai danh mục"
            className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
          />
          {error && (
            <p className="flex items-center gap-1.5 text-[12px] text-[#B91C1C]" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
              <span>{error}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
          <MotionButton variant="secondary" onClick={onClose}>
            Hủy
          </MotionButton>
          <MotionButton type="submit" variant="danger">
            {mode === 'VOIDED' ? 'Xác nhận Hủy sổ' : 'Xác nhận Đảo bút toán'}
          </MotionButton>
        </div>
      </form>
    </Modal>
  );
}
