'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  FileSpreadsheet,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  PieChart,
  RefreshCw,
  Repeat,
  Settings,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import {
  ReducedMotionConfig,
  spring,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';
import { usePreviewStore } from '@/lib/preview-store';
import { MotionButton } from './ui/MotionPrimitives';
import { SkeletonBlock } from './ui/Skeleton';

const PRIMARY_NAV = [
  { href: '/dashboard', label: 'Tổng quan', Icon: LayoutDashboard },
  { href: '/incomes', label: 'Thu nhập', Icon: ArrowDownLeft },
  { href: '/expenses', label: 'Chi tiêu', Icon: ArrowUpRight },
  { href: '/transfers', label: 'Chuyển khoản', Icon: ArrowLeftRight },
  { href: '/recurring', label: 'Định kỳ', Icon: Repeat },
  { href: '/budgets', label: 'Ngân sách', Icon: PieChart },
  { href: '/accounts', label: 'Tài khoản', Icon: Wallet },
  { href: '/imports', label: 'Nhập CSV', Icon: FileSpreadsheet },
] as const;

const MOBILE_BAR_NAV = [
  { href: '/dashboard', label: 'Tổng quan', Icon: LayoutDashboard },
  { href: '/incomes', label: 'Thu nhập', Icon: ArrowDownLeft },
  { href: '/expenses', label: 'Chi tiêu', Icon: ArrowUpRight },
  { href: '/budgets', label: 'Ngân sách', Icon: PieChart },
] as const;

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center min-w-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/balance-logo.png"
        alt="Balance"
        className={compact ? 'h-7 w-auto object-contain' : 'h-8 w-auto object-contain'}
      />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const {
    authUser,
    authChecked,
    isLiveSyncing,
    logoutSession,
    refreshLiveData,
    activeAccounts,
  } = usePreviewStore();

  const reduce = useShouldReduceMotion();
  const highlightSpring = useTempoTransition(spring.highlight);
  const instant = useTempoTransition(motionTransition.instant);

  const isAuthRoute = pathname === '/login' || pathname === '/register';

  useEffect(() => {
    if (!authChecked) return;
    if (!authUser && !isAuthRoute) {
      router.replace('/login');
    } else if (authUser && isAuthRoute) {
      router.replace('/dashboard');
    }
  }, [authChecked, authUser, isAuthRoute, router]);

  if ((!isAuthRoute && (!authChecked || !authUser)) || (isAuthRoute && authChecked && authUser)) {
    return (
      <div
        role="status"
        aria-label="Đang kiểm tra phiên đăng nhập"
        className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]"
      >
        <header className="border-b border-[#E2E8F0] bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2 sm:px-6 min-h-[56px]">
            <BrandMark />
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-sm rounded-xl border border-[#E2E8F0] bg-white p-6 space-y-4">
            <SkeletonBlock className="h-5 w-40" />
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        </main>
      </div>
    );
  }

  if (isAuthRoute) {
    return (
      <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
        <header className="border-b border-[#E2E8F0] bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2 sm:px-6 min-h-[56px]">
            <Link href="/login" className="inline-flex min-h-[44px] items-center">
              <BrandMark />
            </Link>

            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className={[
                  'inline-flex min-h-[44px] items-center px-3 rounded-lg text-[13px] font-semibold transition-colors',
                  pathname === '/login'
                    ? 'bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]'
                    : 'text-[#475569] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A]',
                ].join(' ')}
              >
                Đăng nhập
              </Link>
              <Link
                href="/register"
                className={[
                  'inline-flex min-h-[44px] items-center px-3 rounded-lg text-[13px] font-semibold transition-colors',
                  pathname === '/register'
                    ? 'bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]'
                    : 'border border-[#E2E8F0] bg-white text-[#4338CA] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC]',
                ].join(' ')}
              >
                Tạo tài khoản
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-[#0F172A]">
      {/* Desktop Left Sidebar (>= 1024px) */}
      <aside
        aria-label="Điều hướng chính"
        className="hidden lg:flex lg:w-[240px] lg:shrink-0 lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 border-r border-[#E2E8F0] bg-white z-30"
      >
        <div className="flex items-center px-5 py-4 border-b border-[#E2E8F0] min-h-[60px]">
          <Link href="/dashboard" className="flex items-center min-w-0">
            <BrandMark />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {PRIMARY_NAV.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.Icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'relative flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-lg text-[14px] leading-5',
                  'transition-colors duration-150 select-none',
                  isActive
                    ? 'text-[#4338CA] font-semibold'
                    : 'text-[#475569] font-normal [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A]',
                ].join(' ')}
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-highlight"
                    transition={reduce ? instant : highlightSpring}
                    className="absolute inset-0 rounded-lg bg-[#EEF2FF] border border-[#C7D2FE]"
                    style={{ zIndex: 0 }}
                  />
                )}
                <Icon className="relative z-10 h-4 w-4 shrink-0" aria-hidden={true} />
                <span className="relative z-10 truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#E2E8F0] p-3 space-y-2">
          <Link
            href="/settings"
            aria-current={pathname === '/settings' ? 'page' : undefined}
            className={[
              'relative flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-lg text-[14px] leading-5',
              'transition-colors duration-150',
              pathname === '/settings'
                ? 'bg-[#EEF2FF] text-[#4338CA] font-semibold border border-[#C7D2FE]'
                : 'text-[#475569] font-normal [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A]',
            ].join(' ')}
          >
            <Settings className="h-4 w-4 shrink-0" aria-hidden={true} />
            <span>Cài đặt</span>
          </Link>

          {authUser ? (
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <UserCheck className="h-4 w-4 shrink-0 text-[#15803D]" aria-hidden={true} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-[#0F172A]">
                    {authUser.fullName}
                  </p>
                  <p className="truncate text-[11px] text-[#64748B]">{authUser.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void logoutSession();
                }}
                className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-3 text-[13px] font-semibold text-[#475569] transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F1F5F9] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A] cursor-pointer"
              >
                <LogOut className="h-4 w-4" aria-hidden={true} />
                <span>Đăng xuất</span>
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-lg text-[14px] font-semibold text-[#4338CA] border border-[#C7D2FE] bg-[#EEF2FF]/60 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#EEF2FF]"
            >
              <LogIn className="h-4 w-4 shrink-0" aria-hidden={true} />
              <span>Đăng nhập</span>
            </Link>
          )}
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-[240px]">
        {/* Quiet Top Bar */}
        <header className="sticky top-0 z-20 border-b border-[#E2E8F0] bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6 min-h-[60px]">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/dashboard" className="inline-flex min-h-[44px] items-center lg:hidden">
                <BrandMark compact />
              </Link>
              <span className="hidden lg:inline-flex items-center gap-2 text-[13px] text-[#475569] tabular-nums">
                <Wallet className="h-4 w-4 text-[#64748B]" aria-hidden={true} />
                <span>{activeAccounts.length} ví đang hoạt động</span>
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {authUser ? (
                <>
                  <span className="hidden sm:inline text-[13px] font-semibold text-[#0F172A] truncate max-w-[180px]">
                    {authUser.fullName}
                  </span>
                  <MotionButton
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void refreshLiveData();
                    }}
                    disabled={isLiveSyncing}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden={true} />
                    <span>{isLiveSyncing ? 'Đang đồng bộ' : 'Đồng bộ'}</span>
                  </MotionButton>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-[13px] font-semibold text-[#475569] transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A]"
                  >
                    Đăng nhập
                  </Link>
                  <Link
                    href="/register"
                    className="inline-flex min-h-[44px] items-center rounded-lg border border-[#E2E8F0] bg-white px-3 text-[13px] font-semibold text-[#4338CA] transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC] [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#CBD5E1]"
                  >
                    Tạo tài khoản
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 pb-24 lg:pb-10">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</div>
        </main>
      </div>

      {/* Mobile Bottom Nav Bar (< 1024px) */}
      <nav
        aria-label="Điều hướng di động"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E2E8F0] bg-white lg:hidden"
      >
        <div className="grid grid-cols-5">
          {MOBILE_BAR_NAV.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.Icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'flex flex-col items-center justify-center gap-1 min-h-[56px] px-1 py-2 text-[11px] leading-4',
                  isActive ? 'text-[#4338CA] font-semibold' : 'text-[#475569] font-normal',
                ].join(' ')}
              >
                <Icon className="h-5 w-5" aria-hidden={true} />
                <span className="truncate max-w-full">{item.label}</span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            aria-expanded={mobileDrawerOpen}
            className={[
              'flex flex-col items-center justify-center gap-1 min-h-[56px] px-1 py-2 text-[11px] leading-4 cursor-pointer',
              ['/transfers', '/recurring', '/accounts', '/imports', '/settings', '/login', '/register'].includes(pathname)
                ? 'text-[#4338CA] font-semibold'
                : 'text-[#475569] font-normal',
            ].join(' ')}
          >
            <Menu className="h-5 w-5" aria-hidden={true} />
            <span>Thêm</span>
          </button>
        </div>
      </nav>

      {/* Mobile "Thêm" Sheet Drawer */}
      <ReducedMotionConfig>
        <AnimatePresence>
          {mobileDrawerOpen && (
            <MobileMoreSheet
              pathname={pathname}
              isSignedIn={Boolean(authUser)}
              onLogout={() => {
                setMobileDrawerOpen(false);
                void logoutSession();
              }}
              onClose={() => setMobileDrawerOpen(false)}
            />
          )}
        </AnimatePresence>
      </ReducedMotionConfig>
    </div>
  );
}

function MobileMoreSheet({
  pathname,
  isSignedIn,
  onLogout,
  onClose,
}: {
  pathname: string;
  isSignedIn: boolean;
  onLogout: () => void;
  onClose: () => void;
}) {
  const reduce = useShouldReduceMotion();
  const overlayTransition = useTempoTransition(motionTransition.overlay);
  const sheetEnter = useTempoTransition(motionTransition.sheet);
  const dismiss = useTempoTransition(motionTransition.dismiss);

  const items = [
    { href: '/transfers', label: 'Chuyển khoản', Icon: ArrowLeftRight },
    { href: '/recurring', label: 'Định kỳ', Icon: Repeat },
    { href: '/accounts', label: 'Tài khoản', Icon: Wallet },
    { href: '/imports', label: 'Nhập CSV', Icon: FileSpreadsheet },
    { href: '/settings', label: 'Cài đặt', Icon: Settings },
    ...(!isSignedIn ? [{ href: '/login', label: 'Đăng nhập', Icon: LogIn }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 lg:hidden flex items-end">
      <motion.div
        aria-hidden="true"
        onClick={onClose}
        initial={{ backgroundColor: 'rgb(15 23 42 / 0)' }}
        animate={{ backgroundColor: 'rgb(15 23 42 / 0.42)', transition: overlayTransition }}
        exit={{ backgroundColor: 'rgb(15 23 42 / 0)', transition: overlayTransition }}
        className="fixed inset-0"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Menu mở rộng"
        initial={{
          opacity: 0,
          transform: reduce ? 'translateY(0%)' : 'translateY(100%)',
        }}
        animate={{
          opacity: 1,
          transform: 'translateY(0%)',
          transition: sheetEnter,
        }}
        exit={{
          opacity: 0,
          transform: reduce ? 'translateY(0%)' : 'translateY(100%)',
          transition: dismiss,
        }}
        className="relative z-10 w-full rounded-t-2xl border-t border-[#E2E8F0] bg-white p-4 pb-8"
      >
        <div className="flex items-center justify-between pb-3 mb-2 border-b border-[#E2E8F0]">
          <span className="text-[15px] font-semibold text-[#0F172A]">Chức năng khác</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng menu"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[#475569] cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden={true} />
          </button>
        </div>

        <div className="space-y-1">
          {items.map((item) => {
            const Icon = item.Icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={[
                  'flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-lg text-[14px]',
                  isActive
                    ? 'bg-[#EEF2FF] text-[#4338CA] font-semibold'
                    : 'text-[#0F172A]',
                ].join(' ')}
              >
                <Icon className="h-4 w-4" aria-hidden={true} />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {isSignedIn && (
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center gap-3 min-h-[44px] px-3 py-2 rounded-lg text-[14px] text-[#B91C1C] cursor-pointer"
            >
              <LogOut className="h-4 w-4" aria-hidden={true} />
              <span>Đăng xuất</span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
