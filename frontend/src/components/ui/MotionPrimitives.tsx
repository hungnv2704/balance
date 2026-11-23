'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  scale,
  spring,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface MotionButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[#4338CA] text-white border border-[#4338CA] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#3730A3] [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#3730A3]',
  secondary:
    'bg-white text-[#0F172A] border border-[#E2E8F0] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC] [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#CBD5E1]',
  ghost:
    'bg-transparent text-[#475569] border border-transparent [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F1F5F9] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A]',
  danger:
    'bg-[#B91C1C] text-white border border-[#B91C1C] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#991B1B] [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#991B1B]',
};

export const MotionButton = React.forwardRef<HTMLButtonElement, MotionButtonProps>(
  function MotionButton(
    {
      variant = 'secondary',
      size = 'md',
      fullWidth = false,
      className = '',
      disabled,
      children,
      type = 'button',
      ...props
    },
    ref,
  ) {
    const reduce = useShouldReduceMotion();
    const pressTransition = useTempoTransition(spring.press);

    const sizeClass = size === 'sm' ? 'min-h-[44px] px-3 text-[13px]' : 'min-h-[44px] px-4 text-[14px]';

    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled}
        initial={{ transform: 'scale(1)' }}
        whileTap={
          disabled
            ? undefined
            : {
                transform: reduce ? 'scale(1)' : `scale(${scale.press})`,
                transition: pressTransition,
              }
        }
        className={[
          'inline-flex items-center justify-center gap-2 rounded-lg font-semibold leading-none',
          'transition-colors duration-150 select-none cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          sizeClass,
          VARIANT_CLASSES[variant],
          fullWidth ? 'w-full' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...props}
      >
        {children}
      </motion.button>
    );
  },
);

export function AnimatedListRow({
  children,
  className = '',
  rowKey,
}: {
  children: React.ReactNode;
  className?: string;
  rowKey: string;
}) {
  const reduce = useShouldReduceMotion();
  const reflow = useTempoTransition(spring.reflow);
  const fade = useTempoTransition(motionTransition.fade);

  return (
    <motion.div
      layout={!reduce}
      key={rowKey}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: reduce ? fade : reflow }}
      exit={reduce ? { opacity: 0, transition: fade } : { opacity: 0, y: -4, transition: fade }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
