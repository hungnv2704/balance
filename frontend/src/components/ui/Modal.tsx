'use client';

import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import {
  ReducedMotionConfig,
  blur,
  scale,
  spring,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}

export function Modal(props: ModalProps) {
  return (
    <ReducedMotionConfig>
      <AnimatePresence>
        {props.open && <ModalContent key="modal" {...props} />}
      </AnimatePresence>
    </ReducedMotionConfig>
  );
}

const TIPPED = `perspective(500px) rotateX(-20deg) scale(${scale.dialog})`;
const UPRIGHT = 'perspective(500px) rotateX(0deg) scale(1)';

function ModalContent({
  onClose,
  title,
  description,
  children,
  maxWidthClass = 'max-w-lg',
}: ModalProps) {
  const reduce = useShouldReduceMotion();
  const overlayTransition = useTempoTransition(motionTransition.overlay);
  const dialogSpring = useTempoTransition(spring.dialog);
  const dialogFade = useTempoTransition(motionTransition.dialogFade);
  const dismiss = useTempoTransition(motionTransition.dismiss);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      prevActive?.focus?.();
    };
  }, [onClose]);

  const hidden = {
    opacity: 0,
    filter: blur.surface,
    transform: reduce ? UPRIGHT : TIPPED,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop animates backgroundColor directly (no opacity fade over blur) */}
      <motion.div
        aria-hidden="true"
        onClick={onClose}
        initial={{ backgroundColor: 'rgb(15 23 42 / 0)' }}
        animate={{
          backgroundColor: 'rgb(15 23 42 / 0.42)',
          transition: overlayTransition,
        }}
        exit={{
          backgroundColor: 'rgb(15 23 42 / 0)',
          transition: overlayTransition,
        }}
        className="fixed inset-0"
      />

      <motion.div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={hidden}
        animate={{
          opacity: 1,
          filter: 'blur(0px)',
          transform: UPRIGHT,
          transition: { ...dialogSpring, opacity: dialogFade },
        }}
        exit={{
          ...hidden,
          transition: dismiss,
        }}
        style={{ boxShadow: 'var(--shadow-floating)' }}
        className={`relative z-10 w-full ${maxWidthClass} rounded-xl border border-[#E2E8F0] bg-white p-6 focus:outline-none max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4 mb-4">
          <div className="space-y-1">
            <h2 className="text-[16px] font-semibold leading-6 text-[#0F172A]">
              {title}
            </h2>
            {description && (
              <p className="text-[13px] leading-5 text-[#475569]">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 inline-flex items-center justify-center rounded-lg text-[#475569] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F1F5F9] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A] transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden={true} />
          </button>
        </div>

        {children}
      </motion.div>
    </div>
  );
}
