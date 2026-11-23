'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  ReducedMotionConfig,
  spring,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';

export interface TabOption<T extends string> {
  value: T;
  label: string;
  badge?: string;
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  ariaLabel = 'Chuyển chế độ xem',
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  layoutId: string;
  ariaLabel?: string;
}) {
  return (
    <ReducedMotionConfig>
      <SegmentedTabsInner
        options={options}
        value={value}
        onChange={onChange}
        layoutId={layoutId}
        ariaLabel={ariaLabel}
      />
    </ReducedMotionConfig>
  );
}

function SegmentedTabsInner<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  ariaLabel,
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  layoutId: string;
  ariaLabel: string;
}) {
  const reduce = useShouldReduceMotion();
  const slide = useTempoTransition(spring.selection);
  const instant = useTempoTransition(motionTransition.instant);

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] p-1"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.value)}
            className={[
              'relative min-h-[44px] px-4 py-2 text-[14px] rounded-md cursor-pointer select-none',
              'transition-colors duration-200 flex items-center gap-1.5',
              isActive ? 'text-[#4338CA] font-semibold' : 'text-[#475569] font-normal [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A]',
            ].join(' ')}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                transition={reduce ? instant : slide}
                className="absolute inset-0 rounded-md bg-white border border-[#E2E8F0]"
                style={{ zIndex: 0 }}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
            {opt.badge && (
              <span className="relative z-10 rounded bg-[#EEF2FF] px-1.5 py-0.5 text-[11px] font-semibold text-[#4338CA] tabular-nums">
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
