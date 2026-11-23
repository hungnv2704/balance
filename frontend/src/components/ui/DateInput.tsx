'use client';

import React, { useId, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { formatDateVN, parseDateVNToISO } from '@/lib/money';

export interface DateInputProps {
  label: string;
  isoValue: string; // YYYY-MM-DD
  onChangeISO: (iso: string) => void;
  id?: string;
}

export function DateInput({ label, isoValue, onChangeISO, id }: DateInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [textValue, setTextValue] = useState(() => formatDateVN(isoValue));
  const [error, setError] = useState<string | null>(null);
  const [lastPropIso, setLastPropIso] = useState(isoValue);

  if (isoValue !== lastPropIso) {
    setLastPropIso(isoValue);
    setTextValue(formatDateVN(isoValue));
    setError(null);
  }

  const handleMaskedChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length > 2 && digits.length <= 4) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    } else if (digits.length > 4) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    }
    setTextValue(formatted);

    if (formatted.length === 10) {
      const iso = parseDateVNToISO(formatted);
      if (iso) {
        setError(null);
        onChangeISO(iso);
      } else {
        setError('Ngày không hợp lệ. Định dạng đúng: DD/MM/YYYY');
      }
    } else if (error) {
      setError(null);
    }
  };

  const handleBlur = () => {
    const iso = parseDateVNToISO(textValue);
    if (!iso) {
      setError('Vui lòng nhập đúng định dạng DD/MM/YYYY (VD: 23/11/2026)');
    } else {
      setError(null);
      onChangeISO(iso);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-[12px] font-semibold leading-4 text-[#475569]"
      >
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        value={textValue}
        onChange={(e) => handleMaskedChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="DD/MM/YYYY"
        aria-invalid={Boolean(error)}
        className={[
          'min-h-[44px] w-full rounded-lg border bg-white px-3 py-2 text-[14px] leading-5 tabular-nums text-[#0F172A] placeholder:text-[#64748B]',
          'transition-colors duration-150 focus:outline-none',
          error ? 'border-[#B91C1C]' : 'border-[#E2E8F0] focus:border-[#4338CA]',
        ].join(' ')}
      />
      {error ? (
        <p className="flex items-start gap-1.5 text-[12px] leading-4 text-[#B91C1C]" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden={true} />
          <span>{error}</span>
        </p>
      ) : (
        <p className="text-[12px] leading-4 text-[#64748B]">Định dạng: DD/MM/YYYY (theo múi giờ địa phương)</p>
      )}
    </div>
  );
}
