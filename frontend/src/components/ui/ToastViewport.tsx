'use client';

import React from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Info, RotateCw, X } from 'lucide-react';
import {
  ReducedMotionConfig,
  blur,
  scale,
  spring,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';
import { usePreviewStore } from '@/lib/preview-store';
import type { ToastMessage } from '@/lib/types';

const TONE_MAP: Record<
  ToastMessage['tone'],
  {
    bg: string;
    border: string;
    text: string;
    Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  }
> = {
  success: {
    bg: 'bg-[#F0FDF4]',
    border: 'border-[#BBF7D0]',
    text: 'text-[#15803D]',
    Icon: CheckCircle2,
  },
  warning: {
    bg: 'bg-[#FFFBEB]',
    border: 'border-[#FDE68A]',
    text: 'text-[#B45309]',
    Icon: AlertTriangle,
  },
  danger: {
    bg: 'bg-[#FEF2F2]',
    border: 'border-[#FECACA]',
    text: 'text-[#B91C1C]',
    Icon: AlertCircle,
  },
  info: {
    bg: 'bg-white',
    border: 'border-[#E2E8F0]',
    text: 'text-[#334155]',
    Icon: Info,
  },
};

export function ToastViewport() {
  const { toasts, dismissToast } = usePreviewStore();

  return (
    <ReducedMotionConfig>
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-20 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 lg:bottom-6 lg:right-6"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </AnimatePresence>
      </div>
    </ReducedMotionConfig>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const reduce = useShouldReduceMotion();
  const enter = useTempoTransition(spring.toast);
  const leave = useTempoTransition(motionTransition.dismiss);

  const tone = TONE_MAP[toast.tone];
  const Icon = tone.Icon;

  return (
    <motion.div
      layout={!reduce}
      initial={{
        opacity: 0,
        filter: blur.surface,
        transform: reduce ? 'translateY(0px) scale(1)' : `translateY(12px) scale(${scale.toast})`,
      }}
      animate={{
        opacity: 1,
        filter: 'blur(0px)',
        transform: 'translateY(0px) scale(1)',
        transition: enter,
      }}
      exit={{
        opacity: 0,
        filter: blur.surface,
        transform: reduce ? 'translateY(0px) scale(1)' : `translateY(8px) scale(${scale.toast})`,
        transition: leave,
      }}
      style={{ boxShadow: 'var(--shadow-floating)' }}
      className={`pointer-events-auto rounded-xl border ${tone.border} ${tone.bg} p-3.5`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${tone.text}`} aria-hidden={true} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={`text-[14px] font-semibold leading-5 ${tone.text}`}>{toast.title}</p>
          {toast.description && (
            <p className="text-[12px] leading-4 text-[#475569]">{toast.description}</p>
          )}
          {toast.links && toast.links.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1.5">
              {toast.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => onDismiss(toast.id)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#C7D2FE] bg-[#EEF2FF] px-3 py-1.5 text-[13px] font-semibold text-[#4338CA] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#E0E7FF]"
                >
                  <span>{link.label}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden={true} />
                </Link>
              ))}
            </div>
          )}
          {toast.onRetry && (
            <div className="pt-1.5">
              <button
                type="button"
                onClick={() => {
                  onDismiss(toast.id);
                  toast.onRetry?.();
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#B91C1C] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#B91C1C] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#FEF2F2] cursor-pointer"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden={true} />
                <span>{toast.retryLabel ?? 'Thử lại'}</span>
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Đóng thông báo"
          className="min-h-[44px] min-w-[44px] -mr-1.5 -mt-1.5 inline-flex items-center justify-center rounded-lg text-[#64748B] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A] cursor-pointer"
        >
          <X className="h-4 w-4" aria-hidden={true} />
        </button>
      </div>
    </motion.div>
  );
}
