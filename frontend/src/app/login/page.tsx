'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import {
  ReducedMotionConfig,
  blur,
  scale,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';
import { isApiError } from '@/lib/api-client';
import { usePreviewStore } from '@/lib/preview-store';
import { AuthShowcasePanel } from '@/components/AuthShowcasePanel';
import { MotionButton } from '@/components/ui/MotionPrimitives';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  return (
    <ReducedMotionConfig>
      <LoginPageContent />
    </ReducedMotionConfig>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const { loginWithCredentials } = usePreviewStore();

  const reduce = useShouldReduceMotion();
  const fade = useTempoTransition(motionTransition.fade);
  const swap = useTempoTransition(motionTransition.swap);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const mfaInputRef = useRef<HTMLInputElement>(null);

  const [touched, setTouched] = useState<{
    email?: boolean;
    password?: boolean;
    mfaCode?: boolean;
  }>({});
  const [serverError, setServerError] = useState<{ detail: string; code?: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    mfaCode?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);

  const validateEmail = (value: string): string | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return 'Vui lòng nhập địa chỉ email.';
    if (!EMAIL_REGEX.test(trimmed)) return 'Email chưa đúng định dạng (ví dụ: ten@domain.com).';
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) return 'Vui lòng nhập mật khẩu.';
    if (value.length > 128) return 'Mật khẩu không được vượt quá 128 ký tự.';
    return undefined;
  };

  const validateMfaCode = (value: string): string | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return 'Vui lòng nhập mã xác thực 6 chữ số hoặc mã khôi phục.';
    if (trimmed.length < 6) return 'Mã xác thực phải có tối thiểu 6 ký tự.';
    return undefined;
  };

  const emailError = fieldErrors.email ?? (touched.email ? validateEmail(email) : undefined);
  const passwordError =
    fieldErrors.password ?? (touched.password ? validatePassword(password) : undefined);
  const mfaError =
    fieldErrors.mfaCode ?? (mfaRequired && touched.mfaCode ? validateMfaCode(mfaCode) : undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true, mfaCode: mfaRequired });
    setServerError(null);

    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    const mErr = mfaRequired ? validateMfaCode(mfaCode) : undefined;
    if (eErr || pErr || mErr) {
      setFieldErrors({ email: eErr, password: pErr, mfaCode: mErr });
      return;
    }

    setSubmitting(true);
    try {
      await loginWithCredentials(
        email.trim(),
        password,
        mfaRequired ? mfaCode.trim() : undefined,
      );
      router.push('/dashboard');
    } catch (err) {
      if (isApiError(err)) {
        if (err.status === 401 && err.code === 'MFA_REQUIRED' && !mfaRequired) {
          setMfaRequired(true);
          setFieldErrors({});
          setTouched((prev) => ({ ...prev, mfaCode: false }));
          setTimeout(() => mfaInputRef.current?.focus(), 60);
          return;
        }
        setServerError({ detail: err.detail, code: err.code });
        const apiEmailErr = err.getFieldError('email');
        const apiPassErr = err.getFieldError('password');
        const apiMfaErr = err.getFieldError('mfaCode');
        if (apiEmailErr || apiPassErr || apiMfaErr) {
          setFieldErrors({ email: apiEmailErr, password: apiPassErr, mfaCode: apiMfaErr });
        }
      } else {
        setServerError({
          detail: 'Không thể đăng nhập lúc này. Vui lòng kiểm tra kết nối và thử lại.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl py-2 sm:py-6 space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center">
        {/* Left: Calm Product Preview */}
        <div className="order-2 lg:order-1 lg:col-span-6">
          <AuthShowcasePanel />
        </div>

        {/* Right: Focused Login Card */}
        <section className="order-1 lg:order-2 lg:col-span-6 rounded-xl border border-[#E2E8F0] bg-white p-6 space-y-6">
          <div className="space-y-1 border-b border-[#E2E8F0] pb-4">
            <h1 className="text-[22px] font-semibold leading-7 text-[#0F172A] text-balance">
              Đăng nhập vào Balance
            </h1>
            <p className="text-[14px] leading-5 text-[#475569] text-pretty">
              Nhập email và mật khẩu để truy cập sổ cái và đồng bộ các ví của bạn
            </p>
          </div>

          <AnimatePresence mode="popLayout">
            {serverError && (
              <motion.div
                key="login-server-error"
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
            <div className="flex flex-col gap-2">
              <label htmlFor="login-email" className="text-[12px] font-semibold text-[#475569]">
                Email
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
                  aria-hidden={true}
                />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEmail(val);
                    if (mfaRequired) {
                      setMfaRequired(false);
                      setMfaCode('');
                    }
                    if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                    if (serverError) setServerError(null);
                  }}
                  onBlur={() => setTouched((p) => ({ ...p, email: true }))}
                  placeholder="ten@domain.com"
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'login-email-error' : undefined}
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
                    id="login-email-error"
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

            <div className="flex flex-col gap-2">
              <label htmlFor="login-password" className="text-[12px] font-semibold text-[#475569]">
                Mật khẩu
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
                  aria-hidden={true}
                />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPassword(val);
                    if (mfaRequired) {
                      setMfaRequired(false);
                      setMfaCode('');
                    }
                    if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                    if (serverError) setServerError(null);
                  }}
                  onBlur={() => setTouched((p) => ({ ...p, password: true }))}
                  placeholder="Nhập mật khẩu"
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={passwordError ? 'login-password-error' : undefined}
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
                        key="eye-off"
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
                        key="eye"
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
                {passwordError && (
                  <motion.p
                    id="login-password-error"
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

            <AnimatePresence initial={false}>
              {mfaRequired && (
                <motion.div
                  key="login-mfa-step"
                  initial={{
                    opacity: 0,
                    filter: blur.icon,
                    transform: reduce ? 'translateY(0px)' : 'translateY(-6px)',
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
                  className="rounded-lg border border-[#C7D2FE] bg-[#EEF2FF]/60 p-4 space-y-3"
                >
                  <div className="flex items-start gap-2 text-[13px] text-[#312E81]">
                    <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-[#4338CA]" aria-hidden={true} />
                    <p className="leading-5">
                      Tài khoản đã bật bảo mật 2 lớp (2FA). Nhập mã 6 chữ số từ ứng dụng Authenticator hoặc 1 mã khôi phục dự phòng.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label htmlFor="login-mfa-code" className="text-[12px] font-semibold text-[#334155]">
                      Mã xác thực 2FA (6 chữ số hoặc mã khôi phục)
                    </label>
                    <div className="relative">
                      <KeyRound
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
                        aria-hidden={true}
                      />
                      <input
                        ref={mfaInputRef}
                        id="login-mfa-code"
                        type="text"
                        autoComplete="one-time-code"
                        maxLength={32}
                        value={mfaCode}
                        onChange={(e) => {
                          setMfaCode(e.target.value);
                          if (fieldErrors.mfaCode) setFieldErrors((p) => ({ ...p, mfaCode: undefined }));
                          if (serverError) setServerError(null);
                        }}
                        onBlur={() => setTouched((p) => ({ ...p, mfaCode: true }))}
                        placeholder="000000 hoặc STC2-9K4M"
                        aria-invalid={Boolean(mfaError)}
                        aria-describedby={mfaError ? 'login-mfa-error' : undefined}
                        className={[
                          'min-h-[44px] w-full rounded-lg border bg-white pl-9 pr-3 py-2 font-mono text-[14px] font-semibold text-[#0F172A] tabular-nums transition-colors focus:outline-none',
                          mfaError
                            ? 'border-[#B91C1C] focus:border-[#B91C1C]'
                            : 'border-[#E2E8F0] focus:border-[#4338CA]',
                        ].join(' ')}
                      />
                    </div>
                    <AnimatePresence>
                      {mfaError && (
                        <motion.p
                          id="login-mfa-error"
                          initial={{ opacity: 0, filter: blur.icon }}
                          animate={{ opacity: 1, filter: 'blur(0px)', transition: fade }}
                          exit={{ opacity: 0, filter: blur.icon, transition: fade }}
                          className="flex items-center gap-2 text-[12px] text-[#B91C1C]"
                        >
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                          <span>{mfaError}</span>
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="pt-2 space-y-3">
              <MotionButton type="submit" variant="primary" fullWidth disabled={submitting}>
                <LogIn className="h-4 w-4" aria-hidden={true} />
                <span>
                  {submitting
                    ? mfaRequired
                      ? 'Đang xác thực 2FA'
                      : 'Đang đăng nhập'
                    : mfaRequired
                      ? 'Xác thực & Đăng nhập'
                      : 'Đăng nhập'}
                </span>
              </MotionButton>

              {mfaRequired && (
                <MotionButton
                  type="button"
                  variant="ghost"
                  fullWidth
                  onClick={() => {
                    setMfaRequired(false);
                    setMfaCode('');
                    setFieldErrors({});
                    setServerError(null);
                  }}
                >
                  <span>Quay lại nhập tài khoản khác</span>
                </MotionButton>
              )}

              <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-4 text-[13px] text-[#475569]">
                <span>Chưa có tài khoản?</span>
                <Link
                  href="/register"
                  className="inline-flex min-h-[44px] items-center px-2 font-semibold text-[#4338CA] [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
                >
                  Tạo tài khoản mới
                </Link>
              </div>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
