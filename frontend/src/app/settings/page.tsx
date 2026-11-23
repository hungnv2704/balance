'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import {
  blur,
  scale,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';
import { isApiError, mfaApi, type ApiMfaSetupResponse } from '@/lib/api-client';
import { CURRENCY_LIST } from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type { CurrencyCode } from '@/lib/types';
import { MotionButton } from '@/components/ui/MotionPrimitives';
import { Modal } from '@/components/ui/Modal';

const DEMO_RECOVERY_CODES = [
  'STC2-9K4M',
  'STC2-7P8Q',
  'STC2-3W5X',
  'STC2-6R2T',
  'STC2-8N9V',
  'STC2-4H7J',
  'STC2-5L3Z',
  'STC2-2D6F',
];

export default function SettingsPage() {
  const {
    state,
    dataMode,
    authUser,
    activeAccounts,
    setBaseCurrency,
    pushToast,
    resetDemoData,
  } = usePreviewStore();

  // Long Export Operation (>10s rule: progress bar by step + ETA)
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportStep, setExportStep] = useState('');
  const [exportEtaSec, setExportEtaSec] = useState(0);

  // Step-up Delete Confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');

  useEffect(() => {
    if (exportProgress === null) return;
    if (exportProgress >= 100) return;

    const timer = setTimeout(() => {
      const next = Math.min(100, exportProgress + 25);
      setExportProgress(next);
      if (next === 25) {
        setExportStep('Bước 1/4: Truy vấn sổ cái giao dịch...');
        setExportEtaSec(9);
      } else if (next === 50) {
        setExportStep('Bước 2/4: Chuẩn hóa đơn vị tiền tệ & định dạng dữ liệu...');
        setExportEtaSec(6);
      } else if (next === 75) {
        setExportStep('Bước 3/4: Đóng gói danh mục & ngân sách...');
        setExportEtaSec(3);
      } else if (next >= 100) {
        setExportStep('Bước 4/4: Hoàn tất tệp xuất dữ liệu');
        setExportEtaSec(0);
        const blob = new Blob([JSON.stringify(state, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `so-tai-chinh-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        pushToast({
          tone: 'success',
          title: 'Đã xuất dữ liệu JSON thành công',
        });
      }
    }, 650);

    return () => clearTimeout(timer);
  }, [exportProgress, pushToast, state]);

  const startExport = () => {
    setExportProgress(10);
    setExportStep('Bước 1/4: Khởi tạo phiên xuất dữ liệu...');
    setExportEtaSec(11);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-[24px] font-semibold leading-8 text-[#0F172A]">Cài đặt</h1>

      {/* Preferences */}
      <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#E2E8F0] pb-3">
          <Globe className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
          <h2 className="text-[16px] font-semibold text-[#0F172A]">Tùy chọn hiển thị</h2>
        </div>

        <div className="max-w-md flex flex-col gap-1.5">
          <label htmlFor="base-currency" className="text-[12px] font-semibold text-[#475569]">
            Tiền tệ cơ sở
          </label>
          <select
            id="base-currency"
            value={state.baseCurrency}
            onChange={(e) => setBaseCurrency(e.target.value as CurrencyCode)}
            className="min-h-[44px] rounded-lg border border-[#E2E8F0] bg-white px-3 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
          >
            {CURRENCY_LIST.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <p className="text-[12px] text-[#64748B]">
            {activeAccounts.length === 1
              ? 'Nếu Sổ chung chưa có giao dịch, đổi tiền tệ cơ sở sẽ tự cập nhật tiền tệ Sổ chung.'
              : 'Ưu tiên hiển thị trên báo cáo (không tự động cộng gộp khác tiền tệ).'}
          </p>
        </div>
      </section>

      {/* Export with Progress Bar + ETA */}
      <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-[16px] font-semibold text-[#0F172A]">
            Xuất dữ liệu cá nhân (JSON)
          </h2>
          <p className="text-[13px] text-[#475569]">
            Thao tác chạy nền hiển thị tiến độ theo từng bước và thời gian ước lượng còn lại.
          </p>
        </div>

        {exportProgress !== null && (
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-2">
            <div className="flex items-center justify-between text-[13px] tabular-nums">
              <span className="font-semibold text-[#0F172A]">{exportStep}</span>
              <span className="text-[#475569]">
                {exportEtaSec > 0 ? `Còn khoảng ${exportEtaSec} giây` : 'Hoàn tất 100%'}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
              <div
                className="h-full rounded-full bg-[#4338CA] transition-all duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
          </div>
        )}

        <MotionButton
          variant="secondary"
          disabled={exportProgress !== null && exportProgress < 100}
          onClick={startExport}
        >
          <Download className="h-4 w-4" aria-hidden={true} />
          <span>Xuất bản sao lưu JSON</span>
        </MotionButton>
      </section>

      {/* MFA / 2FA Security Card */}
      <MfaSecurityCard key={dataMode === 'live' ? `live-${authUser?.id ?? 'anon'}` : 'demo'} />

      {/* Danger Zone */}
      <section className="rounded-xl border border-[#FECACA] bg-[#FEF2F2]/40 p-5 space-y-3">
        <div className="flex items-center gap-2 text-[#B91C1C]">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden={true} />
          <h2 className="text-[16px] font-semibold">Vùng nguy hiểm — Xóa toàn bộ dữ liệu</h2>
        </div>
        <p className="text-[13px] text-[#475569]">
          Yêu cầu xác nhận cụm từ bảo mật trước khi xóa và đặt lại toàn bộ dữ liệu tài khoản.
        </p>
        <MotionButton variant="danger" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-4 w-4" aria-hidden={true} />
          <span>Xóa dữ liệu tài khoản</span>
        </MotionButton>
      </section>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Xác nhận xóa dữ liệu vĩnh viễn"
        description="Nhập cụm từ XOA DU LIEU để xác nhận xóa toàn bộ dữ liệu."
      >
        <div className="space-y-4">
          <input
            type="text"
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder="Nhập: XOA DU LIEU"
            className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] text-[#0F172A] focus:border-[#B91C1C] focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <MotionButton variant="secondary" onClick={() => setDeleteOpen(false)}>
              Hủy
            </MotionButton>
            <MotionButton
              variant="danger"
              disabled={confirmPhrase.trim() !== 'XOA DU LIEU'}
              onClick={() => {
                resetDemoData();
                setConfirmPhrase('');
                setDeleteOpen(false);
              }}
            >
              Xác nhận xóa dữ liệu
            </MotionButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MfaSecurityCard() {
  const {
    dataMode,
    authUser,
    updateAuthUserMfaEnabled,
    demoMfaEnabled,
    setDemoMfaEnabled,
    pushToast,
  } = usePreviewStore();

  const reduce = useShouldReduceMotion();
  const fade = useTempoTransition(motionTransition.fade);
  const swap = useTempoTransition(motionTransition.swap);

  const isLive = dataMode === 'live' && Boolean(authUser);

  const [liveMfaOverride, setLiveMfaOverride] = useState<boolean | null>(null);
  const [recoveryRemaining, setRecoveryRemaining] = useState<number | null>(null);

  const mfaEnabled = isLive ? (liveMfaOverride ?? authUser?.mfaEnabled ?? false) : demoMfaEnabled;

  // Setup flow state
  const [setupData, setSetupData] = useState<ApiMfaSetupResponse | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [copiedField, setCopiedField] = useState<'secret' | 'uri' | 'recovery' | null>(null);

  // One-time recovery codes after enabling
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Disable flow state
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disableBusy, setDisableBusy] = useState(false);

  useEffect(() => {
    if (!isLive) return;

    let active = true;

    mfaApi
      .status()
      .then((res) => {
        if (!active) return;
        setLiveMfaOverride(res.mfaEnabled);
        updateAuthUserMfaEnabled(res.mfaEnabled);
        if (typeof res.recoveryCodesRemaining === 'number') {
          setRecoveryRemaining(res.recoveryCodesRemaining);
        }
      })
      .catch(() => {
        // Fallback to authUser.mfaEnabled if status endpoint unavailable
      });

    return () => {
      active = false;
    };
  }, [isLive, updateAuthUserMfaEnabled]);

  const handleCopy = async (text: string, field: 'secret' | 'uri' | 'recovery') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => {
        setCopiedField((prev) => (prev === field ? null : prev));
      }, 2000);
      pushToast({
        tone: 'success',
        title:
          field === 'secret'
            ? 'Đã sao chép khóa thiết lập thủ công'
            : field === 'uri'
              ? 'Đã sao chép liên kết thiết lập nhanh'
              : 'Đã sao chép toàn bộ mã khôi phục',
      });
    } catch {
      pushToast({
        tone: 'warning',
        title: 'Không thể tự động sao chép',
        description: 'Vui lòng bôi đen và sao chép thủ công.',
      });
    }
  };

  const handleStartSetup = async () => {
    setSetupError(null);
    setRecoveryCodes(null);
    setVerifyCode('');
    setSetupBusy(true);

    try {
      if (isLive) {
        const res = await mfaApi.setup();
        setSetupData(res);
      } else {
        const secret = 'JBSWY3DPEHPK3PXP2A4B6C8D';
        setSetupData({
          secret,
          otpauthUri: `otpauth://totp/SoTaiChinh:demo@sotaichinh.local?secret=${secret}&issuer=SoTaiChinh`,
        });
      }
    } catch (err) {
      const msg = isApiError(err) ? err.detail : 'Không thể khởi tạo thiết lập 2FA.';
      setSetupError(msg);
      pushToast({ tone: 'danger', title: 'Khởi tạo 2FA thất bại', description: msg });
    } finally {
      setSetupBusy(false);
    }
  };

  const handleVerifyEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = verifyCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleaned)) {
      setSetupError('Vui lòng nhập đúng mã xác thực gồm 6 chữ số.');
      return;
    }

    setSetupBusy(true);
    setSetupError(null);

    try {
      if (isLive) {
        const res = await mfaApi.verify(cleaned);
        setLiveMfaOverride(res.mfaEnabled);
        updateAuthUserMfaEnabled(res.mfaEnabled);
        setRecoveryCodes(res.recoveryCodes);
        setRecoveryRemaining(res.recoveryCodes.length);
      } else {
        setDemoMfaEnabled(true);
        setRecoveryCodes(DEMO_RECOVERY_CODES);
        setRecoveryRemaining(DEMO_RECOVERY_CODES.length);
      }
      setSetupData(null);
      setVerifyCode('');
      pushToast({
        tone: 'success',
        title: 'Đã bật bảo mật 2 lớp (2FA)',
        description: 'Hãy lưu lại 8 mã khôi phục dự phòng ngay bây giờ.',
      });
    } catch (err) {
      const msg = isApiError(err) ? err.detail : 'Mã xác thực 6 chữ số không đúng hoặc đã hết hạn.';
      setSetupError(msg);
    } finally {
      setSetupBusy(false);
    }
  };

  const handleDisableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablePassword) {
      setDisableError('Vui lòng nhập mật khẩu hiện tại để xác minh.');
      return;
    }
    const cleanedCode = disableCode.trim();
    if (cleanedCode.length < 6) {
      setDisableError('Vui lòng nhập mã xác thực 6 chữ số hoặc mã khôi phục hợp lệ.');
      return;
    }

    setDisableBusy(true);
    setDisableError(null);

    try {
      if (isLive) {
        const res = await mfaApi.disable(disablePassword, cleanedCode);
        setLiveMfaOverride(res.mfaEnabled);
        updateAuthUserMfaEnabled(res.mfaEnabled);
      } else {
        setDemoMfaEnabled(false);
      }
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      setRecoveryCodes(null);
      setRecoveryRemaining(null);
      pushToast({
        tone: 'info',
        title: 'Đã tắt bảo mật 2 lớp (2FA)',
      });
    } catch (err) {
      const msg = isApiError(err) ? err.detail : 'Mật khẩu hoặc mã xác thực 2FA không chính xác.';
      setDisableError(msg);
    } finally {
      setDisableBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
          <h2 className="text-[16px] font-semibold text-[#0F172A]">
            Bảo mật 2 lớp (2FA)
          </h2>
        </div>

        {mfaEnabled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-1 text-[12px] font-semibold text-[#15803D]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden={true} />
            <span>Đã bật</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1 text-[12px] font-semibold text-[#475569]">
            <ShieldOff className="h-3.5 w-3.5" aria-hidden={true} />
            <span>Chưa bật</span>
          </span>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-[13px] leading-5 text-[#475569]">
          Bảo vệ tài khoản bằng mã xác thực một lần từ ứng dụng như Google Authenticator, Authy hoặc 1Password khi đăng nhập.
        </p>
      </div>

      {/* Recovery Codes Banner (shown once right after enabling) */}
      <AnimatePresence initial={false}>
        {recoveryCodes && (
          <motion.div
            key="mfa-recovery-codes"
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
            className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-4 space-y-3"
          >
            <div className="flex items-start gap-2.5 text-[#B45309]">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden={true} />
              <div className="space-y-1">
                <p className="text-[14px] font-semibold">
                  Lưu mã này ngay — chỉ hiển thị một lần
                </p>
                <p className="text-[12px] leading-5">
                  Dùng 1 trong 8 mã khôi phục bên dưới để đăng nhập nếu bạn mất quyền truy cập ứng dụng Authenticator. Mỗi mã chỉ có hiệu lực một lần.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {recoveryCodes.map((code) => (
                <div
                  key={code}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-center font-mono text-[13px] font-semibold tracking-wider text-[#0F172A] tabular-nums select-all"
                >
                  {code}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <MotionButton
                variant="secondary"
                size="sm"
                onClick={() => handleCopy(recoveryCodes.join('\n'), 'recovery')}
              >
                {copiedField === 'recovery' ? (
                  <Check className="h-4 w-4 text-[#15803D]" aria-hidden={true} />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden={true} />
                )}
                <span>{copiedField === 'recovery' ? 'Đã sao chép tất cả' : 'Sao chép tất cả mã'}</span>
              </MotionButton>

              <MotionButton
                variant="ghost"
                size="sm"
                onClick={() => setRecoveryCodes(null)}
              >
                <span>Đã lưu, ẩn danh sách mã</span>
              </MotionButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Setup Error (outside setup form) */}
      {!setupData && setupError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-[13px] text-[#B91C1C]"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden={true} />
          <span>{setupError}</span>
        </div>
      )}

      {/* State 1: Disabled & not setting up */}
      {!mfaEnabled && !setupData && (
        <div>
          <MotionButton
            variant="primary"
            disabled={setupBusy}
            onClick={handleStartSetup}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden={true} />
            <span>{setupBusy ? 'Đang khởi tạo...' : 'Thiết lập 2FA'}</span>
          </MotionButton>
        </div>
      )}

      {/* State 2: Setup Secret + URI + Verify 6-digit code */}
      <AnimatePresence initial={false}>
        {!mfaEnabled && setupData && (
          <motion.form
            key="mfa-setup-panel"
            onSubmit={handleVerifyEnable}
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
            className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-4"
          >
            <div className="space-y-1">
              <h3 className="text-[14px] font-semibold text-[#0F172A]">
                Bước 1: Thêm khóa vào ứng dụng Authenticator
              </h3>
              <p className="text-[12px] text-[#475569]">
                Sao chép khóa thiết lập thủ công hoặc mở liên kết thiết lập nhanh trong ứng dụng xác thực của bạn.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold text-[#475569]">
                  Khóa thiết lập thủ công
                </span>
                <div className="flex items-center gap-2">
                  <code className="min-h-[44px] flex-1 flex items-center rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 font-mono text-[13px] font-semibold text-[#0F172A] break-all select-all">
                    {setupData.secret}
                  </code>
                  <MotionButton
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleCopy(setupData.secret, 'secret')}
                    aria-label="Sao chép khóa thiết lập thủ công"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {copiedField === 'secret' ? (
                        <motion.span
                          key="copied-secret"
                          initial={{ opacity: 0, filter: blur.icon, transform: reduce ? 'scale(1)' : `scale(${scale.icon})` }}
                          animate={{ opacity: 1, filter: 'blur(0px)', transform: 'scale(1)', transition: swap }}
                          exit={{ opacity: 0, filter: blur.icon, transition: swap }}
                          className="inline-flex items-center gap-1.5 text-[#15803D]"
                        >
                          <Check className="h-4 w-4" aria-hidden={true} />
                          <span>Đã chép</span>
                        </motion.span>
                      ) : (
                        <motion.span
                          key="copy-secret"
                          initial={{ opacity: 0, filter: blur.icon }}
                          animate={{ opacity: 1, filter: 'blur(0px)', transition: swap }}
                          exit={{ opacity: 0, filter: blur.icon, transition: swap }}
                          className="inline-flex items-center gap-1.5"
                        >
                          <Copy className="h-4 w-4" aria-hidden={true} />
                          <span>Sao chép</span>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </MotionButton>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold text-[#475569]">
                  Liên kết thiết lập nhanh
                </span>
                <div className="flex items-center gap-2">
                  <code className="min-h-[44px] flex-1 flex items-center rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 font-mono text-[12px] text-[#334155] truncate select-all">
                    {setupData.otpauthUri}
                  </code>
                  <MotionButton
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleCopy(setupData.otpauthUri, 'uri')}
                    aria-label="Sao chép liên kết thiết lập nhanh"
                  >
                    {copiedField === 'uri' ? (
                      <>
                        <Check className="h-4 w-4 text-[#15803D]" aria-hidden={true} />
                        <span className="text-[#15803D]">Đã chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" aria-hidden={true} />
                        <span>Sao chép liên kết</span>
                      </>
                    )}
                  </MotionButton>
                </div>
              </div>
            </div>

            <div className="border-t border-[#E2E8F0] pt-4 space-y-3">
              <div className="space-y-1">
                <label htmlFor="mfa-verify-code" className="block text-[13px] font-semibold text-[#0F172A]">
                  Bước 2: Nhập mã xác thực 6 chữ số từ ứng dụng
                </label>
                <p className="text-[12px] text-[#475569]">
                  Nhập 6 chữ số hiển thị trên ứng dụng xác thực để kích hoạt bảo mật 2 lớp.
                </p>
              </div>

              <div className="max-w-xs">
                <input
                  id="mfa-verify-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => {
                    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setVerifyCode(digitsOnly);
                    if (setupError) setSetupError(null);
                  }}
                  placeholder="000000"
                  className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 font-mono text-[16px] font-semibold tracking-[0.25em] text-[#0F172A] tabular-nums focus:border-[#4338CA] focus:outline-none"
                />
              </div>

              {setupError && (
                <p role="alert" className="flex items-center gap-1.5 text-[12px] text-[#B91C1C]">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                  <span>{setupError}</span>
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <MotionButton type="submit" variant="primary" disabled={setupBusy}>
                  <ShieldCheck className="h-4 w-4" aria-hidden={true} />
                  <span>{setupBusy ? 'Đang xác nhận...' : 'Xác nhận bật 2FA'}</span>
                </MotionButton>

                <MotionButton
                  type="button"
                  variant="ghost"
                  disabled={setupBusy}
                  onClick={() => {
                    setSetupData(null);
                    setVerifyCode('');
                    setSetupError(null);
                  }}
                >
                  <span>Hủy</span>
                </MotionButton>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* State 3: Enabled -> Show remaining recovery info & Disable 2FA flow */}
      {mfaEnabled && (
        <div className="space-y-3">
          {typeof recoveryRemaining === 'number' && (
            <p className="text-[13px] text-[#475569] tabular-nums">
              Số mã khôi phục dự phòng còn lại: <span className="font-semibold text-[#0F172A]">{recoveryRemaining}</span>
            </p>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {!disableOpen ? (
              <motion.div
                key="mfa-disable-trigger"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: fade }}
                exit={{ opacity: 0, transition: fade }}
              >
                <MotionButton
                  variant="secondary"
                  onClick={() => {
                    setDisableOpen(true);
                    setDisableError(null);
                    setDisablePassword('');
                    setDisableCode('');
                  }}
                  className="text-[#B91C1C] border-[#FECACA] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#FEF2F2]"
                >
                  <ShieldOff className="h-4 w-4" aria-hidden={true} />
                  <span>Tắt 2FA</span>
                </MotionButton>
              </motion.div>
            ) : (
              <motion.form
                key="mfa-disable-form"
                onSubmit={handleDisableSubmit}
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
                className="rounded-lg border border-[#FECACA] bg-[#FEF2F2]/50 p-4 space-y-4"
              >
                <div className="space-y-1">
                  <h3 className="text-[14px] font-semibold text-[#B91C1C]">
                    Xác nhận tắt bảo mật 2 lớp (2FA)
                  </h3>
                  <p className="text-[12px] text-[#475569]">
                    Yêu cầu nhập lại mật khẩu hiện tại và mã xác thực 6 chữ số (hoặc mã khôi phục) để đảm bảo an toàn.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="mfa-disable-password" className="text-[12px] font-semibold text-[#475569]">
                      Mật khẩu hiện tại
                    </label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]"
                        aria-hidden={true}
                      />
                      <input
                        id="mfa-disable-password"
                        type={showDisablePassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={disablePassword}
                        onChange={(e) => {
                          setDisablePassword(e.target.value);
                          if (disableError) setDisableError(null);
                        }}
                        placeholder="Nhập mật khẩu của bạn"
                        className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-12 py-2 text-[14px] text-[#0F172A] focus:border-[#4338CA] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDisablePassword((p) => !p)}
                        aria-label={showDisablePassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                        className="absolute right-0 top-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-r-lg text-[#64748B] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A] cursor-pointer"
                      >
                        {showDisablePassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden={true} />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden={true} />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="mfa-disable-code" className="text-[12px] font-semibold text-[#475569]">
                      Mã xác thực 2FA (6 chữ số hoặc mã khôi phục)
                    </label>
                    <input
                      id="mfa-disable-code"
                      type="text"
                      autoComplete="one-time-code"
                      maxLength={32}
                      value={disableCode}
                      onChange={(e) => {
                        setDisableCode(e.target.value);
                        if (disableError) setDisableError(null);
                      }}
                      placeholder="123456 hoặc STC2-9K4M"
                      className="min-h-[44px] w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-[14px] font-semibold tracking-wider text-[#0F172A] tabular-nums focus:border-[#4338CA] focus:outline-none"
                    />
                  </div>
                </div>

                {disableError && (
                  <p role="alert" className="flex items-center gap-1.5 text-[12px] text-[#B91C1C]">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                    <span>{disableError}</span>
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <MotionButton type="submit" variant="danger" disabled={disableBusy}>
                    <ShieldOff className="h-4 w-4" aria-hidden={true} />
                    <span>{disableBusy ? 'Đang tắt 2FA...' : 'Xác nhận tắt 2FA'}</span>
                  </MotionButton>

                  <MotionButton
                    type="button"
                    variant="secondary"
                    disabled={disableBusy}
                    onClick={() => {
                      setDisableOpen(false);
                      setDisableError(null);
                      setDisablePassword('');
                      setDisableCode('');
                    }}
                  >
                    <span>Hủy</span>
                  </MotionButton>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
