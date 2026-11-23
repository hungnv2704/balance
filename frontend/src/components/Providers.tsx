'use client';

import React from 'react';
import { AnimateUIProvider } from '@animate-ui/react/provider';
import { ReducedMotionConfig } from '@animate-ui/react/utils/motion';
import { PreviewStoreProvider } from '@/lib/preview-store';
import { AppShell } from './AppShell';
import { ToastViewport } from './ui/ToastViewport';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AnimateUIProvider tempo={1}>
      <ReducedMotionConfig>
        <PreviewStoreProvider>
          <AppShell>{children}</AppShell>
          <ToastViewport />
        </PreviewStoreProvider>
      </ReducedMotionConfig>
    </AnimateUIProvider>
  );
}
