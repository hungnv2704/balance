'use client';

import React, { useId, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { CURRENCIES, formatMoney, parseMoneyInput } from '@/lib/money';
import type { CurrencyCode } from '@/lib/types';

export interface MoneyInputProps {
  label: string;
  currency: CurrencyCode;
  value: string;
  onChange: (raw: string) => void;
  allowZero?: boolean;
  externalError?: string | null;
  helperText?: string;
  disabled?: boolean;
  id?: string;
  resetKey?: string | number;
}

export function MoneyInput({
  label,
  currency,
  value,
  onChange,
  allowZero = false,
  externalError = null,
  helperText,
  disabled = false,
  id,
  resetKey,
}: MoneyInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [touched, setTouched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  const [prevValue, setPrevValue] = useState(value);

  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setPrevValue(value);
    setTouched(false);
  } else if (prevValue !== value) {
    setPrevValue(value);
    if (value.trim() === '' && !isFocused) {
      setTouched(false);
    }
  }

  const meta = CURRENCIES[currency];
  const parsed = value.trim() ? parseMoneyInput(value, currency, { allowZero }) : null;

  // For zero-decimal currencies (VND/JPY), immediately show decimal error even before blur if user types '.' or ','
  const hasDecimalAttempt = meta.minorUnit === 0 && /[.,]/.test(value) && parsed && !parsed.valid;
  const inlineError =
    externalError ||
    (hasDecimalAttempt ? parsed?.error : null) ||
    (touched && value.trim() === '' ? 'Vui lòng nhập số tiền.' : null) ||
    (touched && parsed && !parsed.valid ? parsed.error : null);

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-[12px] font-semibold leading-4 text-[#475569]"
      >
        {label}
      </label>

      <div className="relative flex items-center">
        <input
          id={inputId}
          type="text"
          inputMode={meta.minorUnit === 0 ? 'numeric' : 'decimal'}
          value={value}
          disabled={disabled}
          onFocus={() => setIsFocused(true)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            setIsFocused(false);
            setTouched(true);
          }}
          placeholder={meta.minorUnit === 0 ? '150000' : '125.50'}
          aria-invalid={Boolean(inlineError)}
          className={[
            'min-h-[44px] w-full rounded-lg border bg-white pl-3 pr-16 py-2 text-[14px] leading-5 tabular-nums text-[#0F172A] placeholder:text-[#64748B]',
            'transition-colors duration-150 focus:outline-none',
            inlineError
              ? 'border-[#B91C1C] focus:border-[#B91C1C]'
              : 'border-[#E2E8F0] focus:border-[#4338CA]',
            disabled ? 'bg-[#F1F5F9] text-[#64748B] cursor-not-allowed' : '',
          ].join(' ')}
        />
        <span className="pointer-events-none absolute right-3 rounded bg-[#F1F5F9] px-2 py-0.5 text-[12px] font-semibold text-[#334155]">
          {currency}
        </span>
      </div>

      {inlineError ? (
        <p className="flex items-start gap-1.5 text-[12px] leading-4 text-[#B91C1C]" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden={true} />
          <span>{inlineError}</span>
        </p>
      ) : parsed?.valid && parsed.minorValue !== null ? (
        <p className="text-[12px] leading-4 text-[#475569] tabular-nums">
          Giá trị ghi sổ: <span className="font-semibold text-[#0F172A]">{formatMoney(parsed.minorValue, currency)}</span>
        </p>
      ) : helperText ? (
        <p className="text-[12px] leading-4 text-[#64748B]">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
