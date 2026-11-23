'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Search } from 'lucide-react';
import {
  ReducedMotionConfig,
  scale,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  rightText?: string;
  popular?: boolean;
}

export interface SearchableComboboxProps {
  label: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  error?: string | null;
  id?: string;
}

export function SearchableCombobox(props: SearchableComboboxProps) {
  return (
    <ReducedMotionConfig>
      <SearchableComboboxInner {...props} />
    </ReducedMotionConfig>
  );
}

function SearchableComboboxInner({
  label,
  options,
  value,
  onChange,
  placeholder = 'Chọn một mục...',
  searchPlaceholder = 'Gõ để tìm nhanh...',
  emptyText = 'Không tìm thấy kết quả phù hợp',
  disabled = false,
  error = null,
  id,
}: SearchableComboboxProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listboxId = `${controlId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const reduce = useShouldReduceMotion();
  const menuTransition = useTempoTransition(motionTransition.menu);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter(
          (opt) =>
            opt.label.toLowerCase().includes(q) ||
            (opt.sublabel && opt.sublabel.toLowerCase().includes(q)),
        )
      : [...options].sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)));
    return list;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const setMenuOpen = (next: boolean) => {
    if (next) {
      setActiveIndex(0);
    }
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const handleSelect = (val: string) => {
    onChange(val);
    setMenuOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!disabled) setMenuOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (filteredOptions.length ? (prev + 1) % filteredOptions.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        filteredOptions.length
          ? (prev - 1 + filteredOptions.length) % filteredOptions.length
          : 0,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = filteredOptions[activeIndex];
      if (chosen) handleSelect(chosen.value);
    }
  };

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      <label
        htmlFor={controlId}
        className="text-[12px] font-semibold leading-4 text-[#475569]"
      >
        {label}
      </label>

      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => !disabled && setMenuOpen(!open)}
        onKeyDown={handleKeyDown}
        className={[
          'min-h-[44px] w-full flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left text-[14px] leading-5',
          'transition-colors duration-150 cursor-pointer',
          error ? 'border-[#B91C1C]' : open ? 'border-[#4338CA]' : 'border-[#E2E8F0]',
          disabled ? 'bg-[#F1F5F9] text-[#64748B] cursor-not-allowed' : 'text-[#0F172A]',
        ].join(' ')}
      >
        <span className="truncate flex items-center gap-2">
          {selectedOption ? (
            <>
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.rightText && (
                <span className="text-[12px] text-[#64748B] tabular-nums shrink-0">
                  ({selectedOption.rightText})
                </span>
              )}
            </>
          ) : (
            <span className="text-[#64748B]">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#64748B] transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden={true}
        />
      </button>

      {error && (
        <p className="text-[12px] leading-4 text-[#B91C1C]">{error}</p>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{
              opacity: 0,
              transform: reduce ? 'scale(1)' : `scale(${scale.menu})`,
            }}
            animate={{
              opacity: 1,
              transform: 'scale(1)',
              transition: menuTransition,
            }}
            exit={{
              opacity: 0,
              transform: reduce ? 'scale(1)' : `scale(${scale.menu})`,
              transition: menuTransition,
            }}
            style={{
              transformOrigin: 'top center',
              boxShadow: 'var(--shadow-floating)',
            }}
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 rounded-lg border border-[#E2E8F0] bg-white overflow-hidden"
            onKeyDown={handleKeyDown}
          >
            <div className="border-b border-[#E2E8F0] p-2">
              <div className="relative flex items-center">
                <Search
                  className="pointer-events-none absolute left-2.5 h-4 w-4 text-[#64748B]"
                  aria-hidden={true}
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="min-h-[44px] w-full rounded-md border border-[#E2E8F0] bg-[#F8FAFC] pl-8 pr-3 text-[14px] text-[#0F172A] placeholder:text-[#64748B] focus:border-[#4338CA] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <ul
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="max-h-60 overflow-y-auto p-1"
            >
              {filteredOptions.length === 0 ? (
                <li className="px-3 py-4 text-center text-[13px] text-[#64748B]">
                  {emptyText}
                </li>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value;
                  const isHighlighted = idx === activeIndex;
                  return (
                    <li
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handleSelect(opt.value)}
                      className={[
                        'min-h-[44px] flex items-center justify-between gap-2 rounded-md px-3 py-2 text-[14px] cursor-pointer select-none',
                        'transition-colors duration-100',
                        isSelected
                          ? 'bg-[#EEF2FF] text-[#4338CA] font-semibold'
                          : isHighlighted
                            ? 'bg-[#F1F5F9] text-[#0F172A]'
                            : 'text-[#0F172A]',
                      ].join(' ')}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{opt.label}</div>
                        {opt.sublabel && (
                          <div className="truncate text-[12px] font-normal text-[#64748B]">
                            {opt.sublabel}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {opt.rightText && (
                          <span className="text-[12px] font-normal text-[#475569] tabular-nums">
                            {opt.rightText}
                          </span>
                        )}
                        {isSelected && (
                          <Check className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
                        )}
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
