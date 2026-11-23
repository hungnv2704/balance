'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
  UserPlus,
} from 'lucide-react';
import {
  ReducedMotionConfig,
  blur,
  scale,
  shift,
  spring,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';
import { isApiError } from '@/lib/api-client';
import { CURRENCY_LIST } from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type { CurrencyCode } from '@/lib/types';
import { AuthShowcasePanel } from '@/components/AuthShowcasePanel';
import { MotionButton } from '@/components/ui/MotionPrimitives';
import { SearchableCombobox } from '@/components/ui/SearchableCombobox';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 12;

type RegisterStep = 1 | 2;

const STEP_META: Record<RegisterStep, { label: string; title: string; percent: number }> = {
  1: { label: 'Bước 1 / 2', title: 'Thông tin tài khoản', percent: 50 },
  2: { label: 'Bước 2 / 2', title: 'Thiết lập tài chính', percent: 100 },
};

export default function RegisterPage() {
  return (
    <ReducedMotionConfig>
      <RegisterPageContent />
    </ReducedMotionConfig>
  );
}

function RegisterPageContent() {
  const router = useRouter();
  const { registerWithCredentials } = usePreviewStore();

  const reduce = useShouldReduceMotion();
  const fade = useTempoTransition(motionTransition.fade);
  const swap = useTempoTransition(motionTransition.swap);
  const progressSpring = useTempoTransition(spring.progress);
  const panelIn = useTempoTransition(motionTransition.panelIn);
  const panelOut = useTempoTransition(motionTransition.panelOut);

  const [{ step, direction }, setStepState] = useState<{
    step: RegisterStep;
    direction: 1 | -1;
  }>({ step: 1, direction: 1 });
  const stepContainerRef = useRef<HTMLDivElement>(null);

  // Step 1: Account info
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Step 2: Financial preferences
  const [baseCurrencyCode, setBaseCurrencyCode] = useState<CurrencyCode>('VND');

  const [touched, setTouched] = useState<{
    fullName?: boolean;
    email?: boolean;
    password?: boolean;
    confirmPassword?: boolean;
  }>({});
  const [fieldErrors, setFieldErrors] = useState<{
    fullName?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});
  const [serverError, setServerError] = useState<{ detail: string; code?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currencyOptions = useMemo(
    () =>
      CURRENCY_LIST.map((c) => ({
        value: c.code,
        label: `${c.code} — ${c.name}`,
        sublabel: `Ký hiệu ${c.symbol} · ${c.minorUnit === 0 ? 'Số nguyên' : '2 chữ số thập phân'}`,
        popular: c.code === 'VND' || c.code === 'USD',
      })),
    [],
  );

  const validateFullName = (value: string): string | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return 'Vui lòng nhập họ và tên.';
    if (trimmed.length > 120) return 'Họ tên không được vượt quá 120 ký tự.';
    return undefined;
  };

  const validateEmail = (value: string): string | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return 'Vui lòng nhập địa chỉ email.';
    if (!EMAIL_REGEX.test(trimmed)) return 'Email chưa đúng định dạng (ví dụ: ten@domain.com).';
    if (trimmed.length > 255) return 'Email không được vượt quá 255 ký tự.';
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) return 'Vui lòng nhập mật khẩu.';
    if (value.length < MIN_PASSWORD_LEN) {
      return `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LEN} ký tự (hiện tại ${value.length}/${MIN_PASSWORD_LEN}).`;
    }
    if (value.length > 128) return 'Mật khẩu không được vượt quá 128 ký tự.';
    return undefined;
  };

  const validateConfirm = (value: string, pwd: string): string | undefined => {
    if (!value) return 'Vui lòng xác nhận lại mật khẩu.';
    if (value !== pwd) return 'Mật khẩu xác nhận chưa khớp.';
    return undefined;
  };

  const fullNameError =
    fieldErrors.fullName ?? (touched.fullName ? validateFullName(fullName) : undefined);
  const emailError = fieldErrors.email ?? (touched.email ? validateEmail(email) : undefined);
  const passwordError =
    fieldErrors.password ?? (touched.password ? validatePassword(password) : undefined);
  const confirmError =
    fieldErrors.confirmPassword ??
    (touched.confirmPassword ? validateConfirm(confirmPassword, password) : undefined);

  const passwordLenOk = password.length >= MIN_PASSWORD_LEN && password.length <= 128;
  const passwordStrengthPct = Math.min(100, Math.round((password.length / MIN_PASSWORD_LEN) * 100));

  const goToStep = (nextStep: RegisterStep) => {
    setStepState((prev) => ({
      step: nextStep,
      direction: nextStep >= prev.step ? 1 : -1,
    }));
  };

  const validateStep1 = (): boolean => {
    setTouched({
      fullName: true,
      email: true,
      password: true,
      confirmPassword: true,
    });

    const nErr = validateFullName(fullName);
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    const cErr = validateConfirm(confirmPassword, password);

    if (nErr || eErr || pErr || cErr) {
      setFieldErrors({
        fullName: nErr,
        email: eErr,
        password: pErr,
        confirmPassword: cErr,
      });
      return false;
    }

    setFieldErrors({});
    return true;
  };

  const handleNextStep = () => {
    setServerError(null);
    if (validateStep1()) {
      goToStep(2);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      handleNextStep();
      return;
    }

    setServerError(null);
    if (!validateStep1()) {
      goToStep(1);
      return;
    }

    setSubmitting(true);
    try {
      const detectedTimezone =
        typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Ho_Chi_Minh'
          : 'Asia/Ho_Chi_Minh';

      await registerWithCredentials({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        baseCurrencyCode,
        timezone: detectedTimezone,
      });
      router.push('/dashboard');
    } catch (err) {
      if (isApiError(err)) {
        setServerError({ detail: err.detail, code: err.code });
        const apiNameErr = err.getFieldError('fullName');
        const apiEmailErr = err.getFieldError('email');
        const apiPassErr = err.getFieldError('password');
        if (apiNameErr || apiEmailErr || apiPassErr) {
          setFieldErrors({
            fullName: apiNameErr,
            email: apiEmailErr,
            password: apiPassErr,
          });
          goToStep(1);
        }
      } else {
        setServerError({
          detail: 'Không thể tạo tài khoản lúc này. Vui lòng kiểm tra kết nối và thử lại.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const stepMeta = STEP_META[step];

  const away = (sign: number) => ({
    opacity: 0,
    filter: blur.panel,
    transform: `translateX(${reduce ? 0 : sign * shift.step}px)`,
  });

  const stepVariants = {
    enter: (dir: number) => away(dir),
    center: {
      opacity: 1,
      filter: 'blur(0px)',
      transform: 'translateX(0px)',
      transition: panelIn,
    },
    exit: (dir: number) => ({ ...away(-dir), transition: panelOut }),
  };

  return (
    <div className="mx-auto w-full max-w-5xl py-2 sm:py-6 space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center">
        {/* Left: Calm Product Preview */}
        <div className="order-2 lg:order-1 lg:col-span-6">
          <AuthShowcasePanel />
        </div>

        {/* Right: 2-Step Registration Card */}
        <section className="order-1 lg:order-2 lg:col-span-6 rounded-xl border border-[#E2E8F0] bg-white p-6 space-y-5">
          <div className="space-y-1 border-b border-[#E2E8F0] pb-4">
            <h1 className="text-[22px] font-semibold leading-7 text-[#0F172A] text-balance">
              Tạo tài khoản mới
            </h1>
            <p className="text-[14px] leading-5 text-[#475569] text-pretty">
              Khởi tạo sổ mặc định và bộ danh mục Thu/Chi chuẩn trong 2 bước
            </p>
          </div>

          {/* Visible Step Progress Indicator (rules.md Section 2.1) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-md border border-[#C7D2FE] bg-[#EEF2FF] px-2 py-1 text-[12px] font-semibold text-[#4338CA] tabular-nums">
                  {stepMeta.label}
                </span>
                <span className="font-semibold text-[#0F172A]">{stepMeta.title}</span>
              </div>
              <span className="text-[12px] font-semibold text-[#475569] tabular-nums">
                {stepMeta.percent}%
              </span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
              <motion.div
                className="h-full rounded-full bg-[#4338CA]"
                initial={false}
                animate={{ width: `${stepMeta.percent}%` }}
                transition={reduce ? { duration: 0 } : progressSpring}
              />
            </div>
          </div>

          <AnimatePresence mode="popLayout">
            {serverError && (
              <motion.div
                key="register-server-error"
                role="alert"
                initial={{
                  opacity: 0,
                  filter: blur.icon,
                  transform: reduce ? 'translateY(0px)' : 'translateY(-4px)',
                }}
                animate={{
                  opacity: 1,
                  filter: 'blur(0px)',
                  transform: 'translateY(0px)',
                  transition: fade,
                }}
                exit={{
                  opacity: 0,
                  filter: blur.icon,
                  transform: reduce ? 'translateY(0px)' : 'translateY(-4px)',
                  transition: fade,
                }}
                className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden={true} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">{serverError.detail}</p>
                  {serverError.code && (
                    <p className="text-[12px] text-[#991B1B]">Mã lỗi: {serverError.code}</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              {step === 1 ? (
                <motion.div
                  key="register-step-1"
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  ref={stepContainerRef}
                  className="space-y-4"
                >
                  {/* Full Name */}
                  <div className="flex flex-col gap-2">
                    <label htmlFor="reg-fullname" className="text-[12px] font-semibold text-[#475569]">
                      Họ và tên
                    </label>
                    <div className="relative">
                      <User
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
                        aria-hidden={true}
                      />
                      <input
                        id="reg-fullname"
                        type="text"
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          if (fieldErrors.fullName) setFieldErrors((p) => ({ ...p, fullName: undefined }));
                          if (serverError) setServerError(null);
                        }}
                        onBlur={() => setTouched((p) => ({ ...p, fullName: true }))}
                        placeholder="Nguyễn Văn An"
                        aria-invalid={Boolean(fullNameError)}
                        aria-describedby={fullNameError ? 'reg-fullname-error' : undefined}
                        className={[
                          'min-h-[44px] w-full rounded-lg border bg-white pl-9 pr-3 py-2 text-[14px] text-[#0F172A] placeholder:text-[#64748B] transition-colors focus:outline-none',
                          fullNameError
                            ? 'border-[#B91C1C] focus:border-[#B91C1C]'
                            : 'border-[#E2E8F0] focus:border-[#4338CA]',
                        ].join(' ')}
                      />
                    </div>
                    <AnimatePresence>
                      {fullNameError && (
                        <motion.p
                          id="reg-fullname-error"
                          initial={{ opacity: 0, filter: blur.icon }}
                          animate={{ opacity: 1, filter: 'blur(0px)', transition: fade }}
                          exit={{ opacity: 0, filter: blur.icon, transition: fade }}
                          className="flex items-center gap-2 text-[12px] text-[#B91C1C]"
                        >
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                          <span>{fullNameError}</span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Email */}
                  <div className="flex flex-col gap-2">
                    <label htmlFor="reg-email" className="text-[12px] font-semibold text-[#475569]">
                      Email
                    </label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
                        aria-hidden={true}
                      />
                      <input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                          if (serverError) setServerError(null);
                        }}
                        onBlur={() => setTouched((p) => ({ ...p, email: true }))}
                        placeholder="ten@domain.com"
                        aria-invalid={Boolean(emailError)}
                        aria-describedby={emailError ? 'reg-email-error' : undefined}
                        className={[
                          'min-h-[44px] w-full rounded-lg border bg-white pl-9 pr-3 py-2 text-[14px] text-[#0F172A] placeholder:text-[#64748B] transition-colors focus:outline-none',
                          emailError
                            ? 'border-[#B91C1C] focus:border-[#B91C1C]'
                            : 'border-[#E2E8F0] focus:border-[#4338CA]',
                        ].join(' ')}
                      />
                    </div>
                    <AnimatePresence>
                      {emailError && (
                        <motion.p
                          id="reg-email-error"
                          initial={{ opacity: 0, filter: blur.icon }}
                          animate={{ opacity: 1, filter: 'blur(0px)', transition: fade }}
                          exit={{ opacity: 0, filter: blur.icon, transition: fade }}
                          className="flex items-center gap-2 text-[12px] text-[#B91C1C]"
                        >
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                          <span>{emailError}</span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Password (>= 12 chars) with inline length bar */}
                  <div className="flex flex-col gap-2">
                    <label htmlFor="reg-password" className="text-[12px] font-semibold text-[#475569]">
                      Mật khẩu (tối thiểu 12 ký tự)
                    </label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
                        aria-hidden={true}
                      />
                      <input
                        id="reg-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                          if (serverError) setServerError(null);
                        }}
                        onBlur={() => setTouched((p) => ({ ...p, password: true }))}
                        placeholder="Ít nhất 12 ký tự"
                        aria-invalid={Boolean(passwordError)}
                        aria-describedby="reg-password-hint"
                        className={[
                          'min-h-[44px] w-full rounded-lg border bg-white pl-9 pr-12 py-2 text-[14px] text-[#0F172A] placeholder:text-[#64748B] transition-colors focus:outline-none',
                          passwordError
                            ? 'border-[#B91C1C] focus:border-[#B91C1C]'
                            : 'border-[#E2E8F0] focus:border-[#4338CA]',
                        ].join(' ')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                        className="absolute right-0 top-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-r-lg text-[#64748B] transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A] cursor-pointer"
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {showPassword ? (
                            <motion.span
                              key="reg-eye-off"
                              initial={{
                                opacity: 0,
                                filter: blur.icon,
                                transform: reduce ? 'scale(1)' : `scale(${scale.icon})`,
                              }}
                              animate={{
                                opacity: 1,
                                filter: 'blur(0px)',
                                transform: 'scale(1)',
                                transition: swap,
                              }}
                              exit={{
                                opacity: 0,
                                filter: blur.icon,
                                transform: reduce ? 'scale(1)' : `scale(${scale.icon})`,
                                transition: swap,
                              }}
                            >
                              <EyeOff className="h-4 w-4" aria-hidden={true} />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="reg-eye"
                              initial={{
                                opacity: 0,
                                filter: blur.icon,
                                transform: reduce ? 'scale(1)' : `scale(${scale.icon})`,
                              }}
                              animate={{
                                opacity: 1,
                                filter: 'blur(0px)',
                                transform: 'scale(1)',
                                transition: swap,
                              }}
                              exit={{
                                opacity: 0,
                                filter: blur.icon,
                                transform: reduce ? 'scale(1)' : `scale(${scale.icon})`,
                                transition: swap,
                              }}
                            >
                              <Eye className="h-4 w-4" aria-hidden={true} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                    </div>

                    {/* Inline Password Length Progress */}
                    <div id="reg-password-hint" className="space-y-1">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                        <div
                          className={[
                            'h-full rounded-full transition-colors duration-150',
                            passwordLenOk ? 'bg-[#15803D]' : 'bg-[#4338CA]',
                          ].join(' ')}
                          style={{ width: `${passwordStrengthPct}%` }}
                        />
                      </div>
                      <div
                        className={[
                          'flex items-center gap-2 text-[12px] tabular-nums transition-colors',
                          passwordLenOk ? 'text-[#15803D]' : 'text-[#64748B]',
                        ].join(' ')}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                        <span>
                          Độ dài tối thiểu {MIN_PASSWORD_LEN} ký tự ({Math.min(password.length, MIN_PASSWORD_LEN)}/{MIN_PASSWORD_LEN})
                        </span>
                      </div>
                    </div>

                    <AnimatePresence>
                      {passwordError && (
                        <motion.p
                          initial={{ opacity: 0, filter: blur.icon }}
                          animate={{ opacity: 1, filter: 'blur(0px)', transition: fade }}
                          exit={{ opacity: 0, filter: blur.icon, transition: fade }}
                          className="flex items-center gap-2 text-[12px] text-[#B91C1C]"
                        >
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                          <span>{passwordError}</span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Confirm Password */}
                  <div className="flex flex-col gap-2">
                    <label htmlFor="reg-confirm" className="text-[12px] font-semibold text-[#475569]">
                      Xác nhận mật khẩu
                    </label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
                        aria-hidden={true}
                      />
                      <input
                        id="reg-confirm"
                        type={showConfirm ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (fieldErrors.confirmPassword) {
                            setFieldErrors((p) => ({ ...p, confirmPassword: undefined }));
                          }
                        }}
                        onBlur={() => setTouched((p) => ({ ...p, confirmPassword: true }))}
                        placeholder="Nhập lại mật khẩu"
                        aria-invalid={Boolean(confirmError)}
                        aria-describedby={confirmError ? 'reg-confirm-error' : undefined}
                        className={[
                          'min-h-[44px] w-full rounded-lg border bg-white pl-9 pr-12 py-2 text-[14px] text-[#0F172A] placeholder:text-[#64748B] transition-colors focus:outline-none',
                          confirmError
                            ? 'border-[#B91C1C] focus:border-[#B91C1C]'
                            : 'border-[#E2E8F0] focus:border-[#4338CA]',
                        ].join(' ')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((prev) => !prev)}
                        aria-label={showConfirm ? 'Ẩn mật khẩu xác nhận' : 'Hiện mật khẩu xác nhận'}
                        className="absolute right-0 top-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-r-lg text-[#64748B] transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A] cursor-pointer"
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          {showConfirm ? (
                            <motion.span
                              key="reg-confirm-eye-off"
                              initial={{
                                opacity: 0,
                                filter: blur.icon,
                                transform: reduce ? 'scale(1)' : `scale(${scale.icon})`,
                              }}
                              animate={{
                                opacity: 1,
                                filter: 'blur(0px)',
                                transform: 'scale(1)',
                                transition: swap,
                              }}
                              exit={{
                                opacity: 0,
                                filter: blur.icon,
                                transform: reduce ? 'scale(1)' : `scale(${scale.icon})`,
                                transition: swap,
                              }}
                            >
                              <EyeOff className="h-4 w-4" aria-hidden={true} />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="reg-confirm-eye"
                              initial={{
                                opacity: 0,
                                filter: blur.icon,
                                transform: reduce ? 'scale(1)' : `scale(${scale.icon})`,
                              }}
                              animate={{
                                opacity: 1,
                                filter: 'blur(0px)',
                                transform: 'scale(1)',
                                transition: swap,
                              }}
                              exit={{
                                opacity: 0,
                                filter: blur.icon,
                                transform: reduce ? 'scale(1)' : `scale(${scale.icon})`,
                                transition: swap,
                              }}
                            >
                              <Eye className="h-4 w-4" aria-hidden={true} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                    </div>
                    <AnimatePresence>
                      {confirmError && (
                        <motion.p
                          id="reg-confirm-error"
                          initial={{ opacity: 0, filter: blur.icon }}
                          animate={{ opacity: 1, filter: 'blur(0px)', transition: fade }}
                          exit={{ opacity: 0, filter: blur.icon, transition: fade }}
                          className="flex items-center gap-2 text-[12px] text-[#B91C1C]"
                        >
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                          <span>{confirmError}</span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="pt-2">
                    <MotionButton type="button" variant="primary" fullWidth onClick={handleNextStep}>
                      <span>Tiếp tục</span>
                      <ArrowRight className="h-4 w-4" aria-hidden={true} />
                    </MotionButton>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="register-step-2"
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  ref={stepContainerRef}
                  className="space-y-4"
                >
                  <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-[13px] text-[#475569]">
                    Tài khoản: <span className="font-semibold text-[#0F172A]">{fullName.trim()}</span> ·{' '}
                    <span className="text-[#0F172A]">{email.trim()}</span>
                  </div>

                  <SearchableCombobox
                    id="reg-currency"
                    label="Tiền tệ cơ sở"
                    options={currencyOptions}
                    value={baseCurrencyCode}
                    onChange={(val) => setBaseCurrencyCode(val as CurrencyCode)}
                    placeholder="Chọn tiền tệ cơ sở"
                    searchPlaceholder="Tìm mã hoặc tên tiền tệ"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <MotionButton
                      type="button"
                      variant="secondary"
                      disabled={submitting}
                      onClick={() => goToStep(1)}
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden={true} />
                      <span>Quay lại</span>
                    </MotionButton>

                    <MotionButton type="submit" variant="primary" disabled={submitting}>
                      <UserPlus className="h-4 w-4" aria-hidden={true} />
                      <span>{submitting ? 'Đang tạo tài khoản' : 'Tạo tài khoản'}</span>
                    </MotionButton>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-4 text-[13px] text-[#475569]">
              <span>Đã có tài khoản?</span>
              <Link
                href="/login"
                className="inline-flex min-h-[44px] items-center px-2 font-semibold text-[#4338CA] [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
              >
                Đăng nhập
              </Link>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
