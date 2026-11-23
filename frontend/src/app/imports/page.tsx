'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardPaste,
  FileSpreadsheet,
  LayoutDashboard,
  RefreshCw,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  blur,
  ReducedMotionConfig,
  shift,
  spring,
  transition as motionTransition,
  useShouldReduceMotion,
  useTempoTransition,
} from '@animate-ui/react/utils/motion';
import {
  importsApi,
  isApiError,
  type ImportRowStatus,
} from '@/lib/api-client';
import {
  buildSampleCsv,
  MAX_CSV_FILE_BYTES,
  normalizeApiPreviewResponse,
  previewCsvDemo,
  toApiCommitRows,
  type NormalizedImportPreview,
  type NormalizedImportRow,
} from '@/lib/csv-import';
import { formatDateVN, formatMoney, newIdempotencyKey } from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import { ProgressiveAccountPicker } from '@/components/ProgressiveAccountPicker';
import { MotionButton } from '@/components/ui/MotionPrimitives';
import { TableSkeleton } from '@/components/ui/Skeleton';

type WizardStep = 1 | 2 | 3;
type PreviewFilter = 'ALL' | ImportRowStatus;

const STEP_META: Record<WizardStep, { label: string; title: string; percent: number }> = {
  1: { label: 'Bước 1 / 3', title: 'Tải CSV', percent: 33 },
  2: { label: 'Bước 2 / 3', title: 'Xem trước & Trùng lặp', percent: 67 },
  3: { label: 'Bước 3 / 3', title: 'Xác nhận nhập', percent: 100 },
};

const ROW_STATUS_BADGE: Record<
  ImportRowStatus,
  {
    label: string;
    classes: string;
    Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  }
> = {
  VALID: {
    label: 'Hợp lệ',
    classes: 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]',
    Icon: CheckCircle2,
  },
  DUPLICATE_SUSPECTED: {
    label: 'Nghi trùng lặp',
    classes: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]',
    Icon: AlertTriangle,
  },
  INVALID: {
    label: 'Lỗi',
    classes: 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]',
    Icon: XCircle,
  },
};

function FormSteps({
  step,
  direction,
  children,
}: {
  step: WizardStep;
  direction: 1 | -1;
  children: React.ReactNode;
}) {
  return (
    <ReducedMotionConfig>
      <StepsBody step={step} direction={direction}>
        {children}
      </StepsBody>
    </ReducedMotionConfig>
  );
}

function StepsBody({
  step,
  direction,
  children,
}: {
  step: WizardStep;
  direction: 1 | -1;
  children: React.ReactNode;
}) {
  const reduce = useShouldReduceMotion();
  const leave = useTempoTransition(motionTransition.panelOut);
  const enter = useTempoTransition(motionTransition.panelIn);
  const containerRef = useRef<HTMLDivElement>(null);

  const away = (sign: number) => ({
    opacity: 0,
    filter: blur.panel,
    transform: `translateX(${reduce ? 0 : sign * shift.step}px)`,
  });

  const variants = {
    enter: (dir: number) => away(dir),
    center: {
      opacity: 1,
      filter: 'blur(0px)',
      transform: 'translateX(0px)',
      transition: enter,
    },
    exit: (dir: number) => ({ ...away(-dir), transition: leave }),
  };

  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={step}
        custom={direction}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        ref={containerRef}
        onAnimationComplete={(name) => {
          if (name !== 'center') return;
          containerRef.current
            ?.querySelector<HTMLElement>('[data-step-heading]')
            ?.focus();
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export default function ImportsPage() {
  const {
    state,
    dataMode,
    activeAccounts,
    isLoadingSkeleton,
    getAccountBalance,
    getAccountById,
    refreshLiveData,
    commitBulkImportDemo,
    pushToast,
  } = usePreviewStore();

  const reduce = useShouldReduceMotion();
  const progressSpring = useTempoTransition(spring.progress);

  // Wizard step state (kept together so direction never disagrees)
  const [{ step, direction }, setStepState] = useState<{
    step: WizardStep;
    direction: 1 | -1;
  }>({ step: 1, direction: 1 });

  // Step 1 state
  const defaultAccount = activeAccounts.find((a) => a.isDefault) ?? activeAccounts[0];
  const [accountId, setAccountId] = useState('');
  const effectiveAccountId = useMemo(() => {
    if (accountId && activeAccounts.some((a) => a.id === accountId)) {
      return accountId;
    }
    return defaultAccount?.id ?? '';
  }, [accountId, activeAccounts, defaultAccount]);

  const selectedAccount = useMemo(
    () => getAccountById(effectiveAccountId) ?? defaultAccount,
    [defaultAccount, effectiveAccountId, getAccountById],
  );
  const activeCurrency = selectedAccount?.currencyCode ?? state.baseCurrency;

  const [csvContent, setCsvContent] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedFileSizeBytes, setUploadedFileSizeBytes] = useState<number | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [showPreviewSkeleton, setShowPreviewSkeleton] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2 state (preserved when navigating back)
  const [previewData, setPreviewData] = useState<NormalizedImportPreview | null>(null);
  const [lastPreviewSignature, setLastPreviewSignature] = useState<string | null>(null);
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<PreviewFilter>('ALL');

  // Step 3 state
  const [commitIdempotencyKey, setCommitIdempotencyKey] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState(0);
  const [commitStageText, setCommitStageText] = useState('');
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<{
    importedCount: number;
    skippedCount: number;
    accountName: string;
    currencyCode: typeof activeCurrency;
  } | null>(null);

  const goToStep = (nextStep: WizardStep) => {
    setStepState((prev) => ({
      step: nextStep,
      direction: nextStep >= prev.step ? 1 : -1,
    }));
  };

  const handleCsvFileSelected = async (file: File | null | undefined) => {
    if (!file) return;
    setStep1Error(null);

    const lowerName = file.name.toLowerCase();
    const isCsvMime =
      file.type === 'text/csv' ||
      file.type === 'application/vnd.ms-excel' ||
      file.type === 'text/plain' ||
      file.type === '';

    if (!lowerName.endsWith('.csv') && !isCsvMime) {
      setStep1Error('Vui lòng chọn tệp định dạng .csv.');
      return;
    }

    if (file.size > MAX_CSV_FILE_BYTES) {
      setStep1Error(
        `Tệp "${file.name}" có dung lượng ${(file.size / 1024 / 1024).toFixed(2)} MB, vượt quá giới hạn tối đa 1 MB.`,
      );
      return;
    }

    try {
      const text = await file.text();
      setCsvContent(text);
      setUploadedFileName(file.name);
      setUploadedFileSizeBytes(file.size);
      setCommitResult(null);
    } catch {
      setStep1Error('Không thể đọc nội dung tệp CSV. Vui lòng thử lại hoặc dán trực tiếp.');
    }
  };

  const handlePasteSample = () => {
    const sample = buildSampleCsv(activeCurrency);
    setCsvContent(sample);
    setUploadedFileName(null);
    setUploadedFileSizeBytes(null);
    setStep1Error(null);
    setCommitResult(null);
    pushToast({
      tone: 'info',
      title: 'Đã dán dữ liệu CSV mẫu',
      description: 'Bao gồm dòng hợp lệ, dòng nghi trùng lặp và 1 dòng lỗi để kiểm thử ngay.',
    });
  };

  const handlePreviewCsv = async () => {
    setStep1Error(null);

    if (!selectedAccount) {
      setStep1Error('Vui lòng chọn tài khoản đích trước khi xem trước CSV.');
      return;
    }

    const trimmed = csvContent.trim();
    if (!trimmed) {
      setStep1Error('Vui lòng tải lên tệp .csv hoặc dán nội dung CSV trước khi tiếp tục.');
      return;
    }

    const byteSize = new Blob([csvContent]).size;
    if (byteSize > MAX_CSV_FILE_BYTES) {
      setStep1Error('Nội dung CSV vượt quá giới hạn 1 MB.');
      return;
    }

    const signature = `${dataMode}::${selectedAccount.id}::${trimmed}`;
    if (previewData && lastPreviewSignature === signature && !commitResult) {
      // Preserve existing user selections if input & mode have not changed
      goToStep(2);
      return;
    }

    setIsPreviewing(true);
    setShowPreviewSkeleton(false);

    // UI Rule 1.4: Do not flash skeleton under 300ms
    const skeletonTimer = setTimeout(() => {
      setShowPreviewSkeleton(true);
    }, 300);

    try {
      let normalized: NormalizedImportPreview;

      if (dataMode === 'live') {
        const apiRes = await importsApi.preview({
          accountId: selectedAccount.id,
          csvContent,
        });
        normalized = normalizeApiPreviewResponse(
          apiRes,
          selectedAccount.id,
          selectedAccount.currencyCode,
          state.categories,
        );
      } else {
        normalized = previewCsvDemo({
          csvContent,
          account: selectedAccount,
          categories: state.categories,
          existingTransactions: state.transactions,
        });
      }

      if (normalized.rows.length === 0) {
        setStep1Error('Không tìm thấy dòng giao dịch nào trong CSV. Kiểm tra lại tiêu đề và dữ liệu.');
        return;
      }

      // Default selection: VALID checked, DUPLICATE_SUSPECTED unchecked, INVALID disabled
      const defaultSelected = new Set<number>();
      for (const row of normalized.rows) {
        if (row.status === 'VALID') {
          defaultSelected.add(row.rowIndex);
        }
      }

      setPreviewData(normalized);
      setLastPreviewSignature(signature);
      setSelectedRowIndices(defaultSelected);
      setStatusFilter('ALL');
      setCommitIdempotencyKey(null);
      setCommitError(null);
      setCommitResult(null);
      goToStep(2);
    } catch (err) {
      const msg = isApiError(err)
        ? err.detail
        : 'Không thể phân tích CSV. Vui lòng kiểm tra định dạng tệp.';
      setStep1Error(msg);
    } finally {
      clearTimeout(skeletonTimer);
      setIsPreviewing(false);
      setShowPreviewSkeleton(false);
    }
  };

  const toggleRowSelection = (row: NormalizedImportRow) => {
    if (row.status === 'INVALID') return;
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(row.rowIndex)) {
        next.delete(row.rowIndex);
      } else {
        next.add(row.rowIndex);
      }
      return next;
    });
    // Invalidate previous step-3 key when selection changes
    setCommitIdempotencyKey(null);
    setCommitError(null);
  };

  const selectAllValid = () => {
    if (!previewData) return;
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      for (const row of previewData.rows) {
        if (row.status === 'VALID') next.add(row.rowIndex);
      }
      return next;
    });
    setCommitIdempotencyKey(null);
    setCommitError(null);
  };

  const uncheckAllDuplicates = () => {
    if (!previewData) return;
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      for (const row of previewData.rows) {
        if (row.status === 'DUPLICATE_SUSPECTED') next.delete(row.rowIndex);
      }
      return next;
    });
    setCommitIdempotencyKey(null);
    setCommitError(null);
  };

  const filteredPreviewRows = useMemo(() => {
    if (!previewData) return [];
    if (statusFilter === 'ALL') return previewData.rows;
    return previewData.rows.filter((r) => r.status === statusFilter);
  }, [previewData, statusFilter]);

  const selectedRows = useMemo(() => {
    if (!previewData) return [];
    return previewData.rows.filter(
      (r) => r.status !== 'INVALID' && selectedRowIndices.has(r.rowIndex),
    );
  }, [previewData, selectedRowIndices]);

  const selectionSummary = useMemo(() => {
    let validSelected = 0;
    let duplicateSelected = 0;
    let totalIncomeMinor = 0;
    let totalExpenseMinor = 0;

    for (const row of selectedRows) {
      if (row.status === 'VALID') validSelected += 1;
      if (row.status === 'DUPLICATE_SUSPECTED') duplicateSelected += 1;
      if (row.amountMinor !== null) {
        if (row.entryType === 'INCOME') totalIncomeMinor += row.amountMinor;
        if (row.entryType === 'EXPENSE') totalExpenseMinor += row.amountMinor;
      }
    }

    return {
      totalSelected: selectedRows.length,
      validSelected,
      duplicateSelected,
      totalIncomeMinor,
      totalExpenseMinor,
    };
  }, [selectedRows]);

  const handleProceedToStep3 = () => {
    if (selectedRows.length === 0) return;
    if (!commitIdempotencyKey) {
      setCommitIdempotencyKey(newIdempotencyKey());
    }
    setCommitError(null);
    goToStep(3);
  };

  const handleCommitImport = async () => {
    if (isCommitting || selectedRows.length === 0 || !selectedAccount) return;

    // Reuse existing key on retry; only generate if missing
    const reqKey = commitIdempotencyKey ?? newIdempotencyKey();
    if (!commitIdempotencyKey) {
      setCommitIdempotencyKey(reqKey);
    }

    setIsCommitting(true);
    setCommitError(null);
    setCommitProgress(20);
    setCommitStageText(`Đang chuẩn bị ${selectedRows.length} giao dịch với khóa chống trùng lặp...`);

    const stepTimer1 = setTimeout(() => {
      setCommitProgress(60);
      setCommitStageText('Đang ghi sổ giao dịch và cập nhật số dư tài khoản...');
    }, 220);

    try {
      let importedCount = selectedRows.length;
      let skippedCount = 0;

      if (dataMode === 'live') {
        const commitRows = toApiCommitRows(selectedRows);
        const res = await importsApi.commit(
          {
            accountId: selectedAccount.id,
            rows: commitRows,
          },
          reqKey,
        );
        importedCount = res.importedCount ?? res.createdCount ?? commitRows.length;
        skippedCount = res.skippedCount ?? 0;

        setCommitProgress(88);
        setCommitStageText('Đang đồng bộ lại sổ cái và ngân sách...');
        await refreshLiveData();
      } else {
        const demoRows = selectedRows
          .filter(
            (r): r is NormalizedImportRow & {
              entryType: 'INCOME' | 'EXPENSE';
              transactionDate: string;
              amountMinor: number;
            } =>
              (r.entryType === 'INCOME' || r.entryType === 'EXPENSE') &&
              Boolean(r.transactionDate) &&
              r.amountMinor !== null &&
              r.amountMinor > 0,
          )
          .map((r) => ({
            entryType: r.entryType,
            transactionDate: r.transactionDate,
            amountMinor: r.amountMinor,
            categoryId: r.categoryId,
            description: r.description,
            note: r.note,
          }));

        const res = commitBulkImportDemo({
          accountId: selectedAccount.id,
          rows: demoRows,
          idempotencyKey: reqKey,
        });

        if (!res.ok) {
          throw new Error(res.error ?? 'Không thể nhập giao dịch lúc này.');
        }
        importedCount = res.importedCount;
      }

      setCommitProgress(100);
      setCommitStageText('Hoàn tất nhập giao dịch');
      setCommitResult({
        importedCount,
        skippedCount,
        accountName: selectedAccount.name,
        currencyCode: selectedAccount.currencyCode,
      });

      if (dataMode === 'live') {
        pushToast({
          tone: 'success',
          title: `Đã nhập thành công ${importedCount} giao dịch từ CSV`,
          description: `Tài khoản ${selectedAccount.name} đã được đồng bộ.`,
        });
      }
    } catch (err) {
      const detail = isApiError(err)
        ? err.detail
        : err instanceof Error
          ? err.message
          : 'Lỗi kết nối khi xác nhận nhập CSV. Vui lòng bấm "Thử lại".';
      setCommitError(detail);
      setCommitProgress(0);
      setCommitStageText('');
      pushToast({
        tone: 'danger',
        title: 'Nhập CSV chưa hoàn tất',
        description: detail,
      });
    } finally {
      clearTimeout(stepTimer1);
      setIsCommitting(false);
    }
  };

  const handleResetWizard = () => {
    setCsvContent('');
    setUploadedFileName(null);
    setUploadedFileSizeBytes(null);
    setStep1Error(null);
    setPreviewData(null);
    setLastPreviewSignature(null);
    setSelectedRowIndices(new Set());
    setStatusFilter('ALL');
    setCommitIdempotencyKey(null);
    setCommitError(null);
    setCommitProgress(0);
    setCommitStageText('');
    setCommitResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    goToStep(1);
  };

  const currentStepMeta = STEP_META[step];

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-[#4338CA]" aria-hidden={true} />
          <h1 className="text-[24px] font-semibold leading-8 text-[#0F172A]">
            Nhập giao dịch từ CSV
          </h1>
        </div>
        <p className="text-[14px] leading-5 text-[#475569]">
          Kiểm tra dữ liệu trước khi ghi sổ, phát hiện giao dịch nghi trùng lặp và xác nhận an toàn theo từng bước.
        </p>
      </div>

      {/* Visible Step Progress Indicator (UI/UX Rule 2.1) */}
      <section
        aria-label="Tiến trình nhập CSV"
        className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[14px]">
            <span className="inline-flex items-center rounded-md bg-[#EEF2FF] border border-[#C7D2FE] px-2.5 py-1 text-[12px] font-semibold text-[#4338CA] tabular-nums">
              {currentStepMeta.label}
            </span>
            <span className="font-semibold text-[#0F172A]">{currentStepMeta.title}</span>
          </div>
          <span className="text-[12px] font-semibold text-[#475569] tabular-nums">
            {currentStepMeta.percent}% hoàn thành
          </span>
        </div>

        {/* Animated Progress Bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
          <motion.div
            className="h-full rounded-full bg-[#4338CA]"
            initial={false}
            animate={{ width: `${currentStepMeta.percent}%` }}
            transition={reduce ? { duration: 0 } : progressSpring}
          />
        </div>

        {/* 3 Step Indicators */}
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([1, 2, 3] as WizardStep[]).map((stepNum) => {
            const meta = STEP_META[stepNum];
            const isCurrent = step === stepNum;
            const isDone = step > stepNum || (stepNum === 3 && Boolean(commitResult));
            const canClickStep =
              !isCommitting &&
              !isPreviewing &&
              !commitResult &&
              (stepNum === 1 || (stepNum === 2 && Boolean(previewData)));

            return (
              <li key={stepNum}>
                <button
                  type="button"
                  disabled={!canClickStep || isCurrent}
                  onClick={() => {
                    if (canClickStep && !isCurrent) {
                      goToStep(stepNum);
                    }
                  }}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={[
                    'w-full min-h-[44px] flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                    isCurrent
                      ? 'border-[#4338CA] bg-[#EEF2FF]/70 text-[#4338CA]'
                      : isDone
                        ? 'border-[#BBF7D0] bg-[#F0FDF4]/60 text-[#15803D]'
                        : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]',
                    canClickStep && !isCurrent ? 'cursor-pointer [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#CBD5E1]' : 'cursor-default',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums',
                      isCurrent
                        ? 'bg-[#4338CA] text-white'
                        : isDone
                          ? 'bg-[#15803D] text-white'
                          : 'bg-[#E2E8F0] text-[#475569]',
                    ].join(' ')}
                  >
                    {stepNum}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold opacity-80 tabular-nums">
                      {meta.label}
                    </div>
                    <div className="truncate text-[13px] font-semibold">{meta.title}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Main Wizard Content */}
      {isLoadingSkeleton || showPreviewSkeleton ? (
        <TableSkeleton rows={5} />
      ) : (
        <FormSteps step={step} direction={direction}>
          {/* STEP 1: Upload / Paste CSV */}
          {step === 1 && (
            <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-4">
                <div>
                  <h2
                    data-step-heading
                    tabIndex={-1}
                    className="text-[16px] font-semibold text-[#0F172A] focus:outline-none"
                  >
                    Bước 1 / 3: Chọn tài khoản & tải dữ liệu CSV
                  </h2>
                  <p className="text-[13px] text-[#475569]">
                    Hỗ trợ tệp .csv tối đa 1 MB hoặc dán trực tiếp nội dung từ sao kê ngân hàng.
                  </p>
                </div>

                <MotionButton variant="secondary" size="sm" onClick={handlePasteSample}>
                  <ClipboardPaste className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
                  <span>Dán CSV mẫu</span>
                </MotionButton>
              </div>

              <div className="max-w-md">
                <ProgressiveAccountPicker
                  accountId={effectiveAccountId}
                  onChangeAccountId={(nextId) => {
                    setAccountId(nextId);
                    setStep1Error(null);
                  }}
                  label="Tài khoản đích"
                />
              </div>

              {/* File Upload Zone */}
              <div className="space-y-2">
                <span className="block text-[12px] font-semibold text-[#475569]">
                  Tải lên tệp CSV (tối đa 1 MB)
                </span>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    const file = e.dataTransfer.files?.[0];
                    void handleCsvFileSelected(file);
                  }}
                  className={[
                    'rounded-xl border border-dashed p-5 transition-colors flex flex-wrap items-center justify-between gap-4',
                    isDraggingFile
                      ? 'border-[#4338CA] bg-[#EEF2FF]/60'
                      : 'border-[#CBD5E1] bg-[#F8FAFC]',
                  ].join(' ')}
                >
                  <div className="space-y-1">
                    <div className="text-[14px] font-semibold text-[#0F172A]">
                      {uploadedFileName
                        ? `Đã chọn: ${uploadedFileName}`
                        : 'Kéo thả tệp .csv vào đây hoặc chọn từ máy'}
                    </div>
                    <div className="text-[12px] text-[#64748B] tabular-nums">
                      {uploadedFileSizeBytes !== null
                        ? `Dung lượng: ${(uploadedFileSizeBytes / 1024).toFixed(1)} KB (giới hạn 1.024 KB)`
                        : 'Định dạng hỗ trợ: UTF-8 CSV (<= 1 MB)'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      aria-label="Chọn tệp CSV"
                      onChange={(e) => {
                        void handleCsvFileSelected(e.target.files?.[0]);
                      }}
                      className="sr-only"
                    />
                    <MotionButton
                      variant="secondary"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 text-[#4338CA]" aria-hidden={true} />
                      <span>Chọn tệp .csv</span>
                    </MotionButton>
                  </div>
                </div>
              </div>

              {/* Paste CSV Textarea */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="csv-content-input"
                    className="text-[12px] font-semibold text-[#475569]"
                  >
                    Nội dung CSV (có thể chỉnh sửa hoặc dán trực tiếp)
                  </label>
                  <span className="text-[12px] text-[#64748B] tabular-nums">
                    {csvContent.trim()
                      ? `${csvContent.trim().split(/\r?\n/).length} dòng`
                      : 'Chưa có dữ liệu'}
                  </span>
                </div>
                <textarea
                  id="csv-content-input"
                  rows={8}
                  value={csvContent}
                  onChange={(e) => {
                    setCsvContent(e.target.value);
                    if (step1Error) setStep1Error(null);
                  }}
                  placeholder={`date,type,amount,category,description,note\n2026-11-23,EXPENSE,85000,Ăn uống,Cà phê sáng,Thanh toán QR`}
                  className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-[13px] leading-5 text-[#0F172A] tabular-nums placeholder:text-[#94A3B8] focus:border-[#4338CA] focus:outline-none"
                />
                <p className="text-[12px] text-[#64748B]">
                  Cột chuẩn: <span className="font-semibold text-[#334155]">date</span> (YYYY-MM-DD),{' '}
                  <span className="font-semibold text-[#334155]">type</span> (INCOME / EXPENSE),{' '}
                  <span className="font-semibold text-[#334155]">amount</span> (theo tiền tệ {activeCurrency}),{' '}
                  <span className="font-semibold text-[#334155]">category</span>,{' '}
                  <span className="font-semibold text-[#334155]">description</span>,{' '}
                  <span className="font-semibold text-[#334155]">note</span>.
                </p>
              </div>

              {step1Error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-[13px] text-[#B91C1C]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden={true} />
                  <span>{step1Error}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#E2E8F0] pt-4">
                <MotionButton
                  variant="primary"
                  disabled={isPreviewing || !csvContent.trim() || !selectedAccount}
                  onClick={() => {
                    void handlePreviewCsv();
                  }}
                >
                  <span>{isPreviewing ? 'Đang kiểm tra CSV...' : 'Xem trước & kiểm tra trùng lặp'}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden={true} />
                </MotionButton>
              </div>
            </section>
          )}

          {/* STEP 2: Preview & Duplicate Detection */}
          {step === 2 && previewData && (
            <section className="space-y-5">
              {/* Summary Counters */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 space-y-1">
                  <div className="text-[12px] font-semibold text-[#64748B]">Tổng số dòng</div>
                  <div className="text-[22px] font-semibold text-[#0F172A] tabular-nums">
                    {previewData.totalRows}
                  </div>
                </div>

                <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4]/50 p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#15803D]">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden={true} />
                    <span>Hợp lệ</span>
                  </div>
                  <div className="text-[22px] font-semibold text-[#15803D] tabular-nums">
                    {previewData.validCount}
                  </div>
                </div>

                <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB]/60 p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#B45309]">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden={true} />
                    <span>Nghi trùng lặp</span>
                  </div>
                  <div className="text-[22px] font-semibold text-[#B45309] tabular-nums">
                    {previewData.duplicateCount}
                  </div>
                </div>

                <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2]/60 p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#B91C1C]">
                    <XCircle className="h-3.5 w-3.5" aria-hidden={true} />
                    <span>Lỗi</span>
                  </div>
                  <div className="text-[22px] font-semibold text-[#B91C1C] tabular-nums">
                    {previewData.invalidCount}
                  </div>
                </div>
              </div>

              {/* Filter & Selection Toolbar */}
              <div className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-5 py-4">
                  <div className="space-y-0.5">
                    <h2
                      data-step-heading
                      tabIndex={-1}
                      className="text-[16px] font-semibold text-[#0F172A] focus:outline-none"
                    >
                      Bước 2 / 3: Xem trước dữ liệu & xử lý trùng lặp
                    </h2>
                    <p className="text-[13px] text-[#475569]">
                      Mặc định chỉ chọn các dòng <span className="font-semibold text-[#15803D]">Hợp lệ</span>. Các dòng{' '}
                      <span className="font-semibold text-[#B45309]">Nghi trùng lặp</span> được bỏ chọn để bạn chủ động quyết định.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <MotionButton variant="secondary" size="sm" onClick={selectAllValid}>
                      <span>Chọn tất cả hợp lệ</span>
                    </MotionButton>
                    {previewData.duplicateCount > 0 && (
                      <MotionButton variant="ghost" size="sm" onClick={uncheckAllDuplicates}>
                        <span>Bỏ chọn trùng lặp</span>
                      </MotionButton>
                    )}
                  </div>
                </div>

                {/* Status Filter Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-2.5">
                  <div role="tablist" aria-label="Lọc dòng CSV theo trạng thái" className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { key: 'ALL', label: `Tất cả (${previewData.totalRows})` },
                        { key: 'VALID', label: `Hợp lệ (${previewData.validCount})` },
                        {
                          key: 'DUPLICATE_SUSPECTED',
                          label: `Nghi trùng lặp (${previewData.duplicateCount})`,
                        },
                        { key: 'INVALID', label: `Lỗi (${previewData.invalidCount})` },
                      ] as Array<{ key: PreviewFilter; label: string }>
                    ).map((tab) => {
                      const active = statusFilter === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setStatusFilter(tab.key)}
                          className={[
                            'min-h-[36px] rounded-lg px-3 text-[12px] font-semibold tabular-nums transition-colors cursor-pointer',
                            active
                              ? 'bg-[#4338CA] text-white'
                              : 'bg-white border border-[#E2E8F0] text-[#475569] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#0F172A]',
                          ].join(' ')}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  <span className="text-[12px] font-semibold text-[#4338CA] tabular-nums">
                    Đang chọn nhập: {selectedRows.length} dòng
                  </span>
                </div>

                {/* Preview Table */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[12px] font-semibold text-[#475569]">
                        <th scope="col" className="w-12 px-3 py-3 text-center">
                          Chọn
                        </th>
                        <th scope="col" className="w-12 px-3 py-3 tabular-nums">
                          Dòng
                        </th>
                        <th scope="col" className="px-3 py-3">
                          Trạng thái
                        </th>
                        <th scope="col" className="px-3 py-3">
                          Ngày
                        </th>
                        <th scope="col" className="px-3 py-3">
                          Loại
                        </th>
                        <th scope="col" className="px-3 py-3">
                          Mô tả & Chi tiết kiểm tra
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Số tiền
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] text-[13px]">
                      {filteredPreviewRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-8 text-center text-[#64748B]">
                            Không có dòng nào thuộc bộ lọc này.
                          </td>
                        </tr>
                      ) : (
                        filteredPreviewRows.map((row) => {
                          const badge = ROW_STATUS_BADGE[row.status];
                          const BadgeIcon = badge.Icon;
                          const isDisabled = row.status === 'INVALID';
                          const isChecked = !isDisabled && selectedRowIndices.has(row.rowIndex);

                          return (
                            <tr
                              key={row.rowIndex}
                              className={
                                isDisabled
                                  ? 'bg-[#FEF2F2]/30 text-[#64748B]'
                                  : isChecked
                                    ? 'bg-white'
                                    : 'bg-[#F8FAFC]/50'
                              }
                            >
                              <td className="px-2 py-2.5 text-center align-top">
                                <label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={isDisabled}
                                    aria-label={`Chọn dòng ${row.rowIndex}: ${row.description}`}
                                    onChange={() => toggleRowSelection(row)}
                                    className="h-4 w-4 rounded border-[#CBD5E1] accent-[#4338CA] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                  />
                                </label>
                              </td>
                              <td className="px-3 py-3.5 align-top font-semibold text-[#475569] tabular-nums">
                                #{row.rowIndex}
                              </td>
                              <td className="px-3 py-3.5 align-top">
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap ${badge.classes}`}
                                >
                                  <BadgeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden={true} />
                                  <span>{badge.label}</span>
                                </span>
                              </td>
                              <td className="px-3 py-3.5 align-top whitespace-nowrap text-[#0F172A] tabular-nums">
                                {row.transactionDate ? formatDateVN(row.transactionDate) : '—'}
                              </td>
                              <td className="px-3 py-3.5 align-top whitespace-nowrap">
                                {row.entryType === 'INCOME' ? (
                                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#15803D]">
                                    <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden={true} />
                                    Thu nhập
                                  </span>
                                ) : row.entryType === 'EXPENSE' ? (
                                  <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#B91C1C]">
                                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden={true} />
                                    Chi tiêu
                                  </span>
                                ) : (
                                  <span className="text-[#64748B]">Không rõ</span>
                                )}
                              </td>
                              <td className="px-3 py-3.5 align-top space-y-1.5 min-w-[240px]">
                                <div className="font-semibold text-[#0F172A]">{row.description}</div>
                                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#64748B]">
                                  {row.categoryName && (
                                    <span className="rounded bg-[#F1F5F9] px-2 py-0.5 text-[#334155]">
                                      {row.categoryName}
                                    </span>
                                  )}
                                  {row.note && <span>{row.note}</span>}
                                </div>

                                {row.status === 'DUPLICATE_SUSPECTED' && row.duplicateReason && (
                                  <div className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1.5 text-[12px] text-[#B45309]">
                                    {row.duplicateReason}
                                  </div>
                                )}

                                {row.status === 'INVALID' && row.errors.length > 0 && (
                                  <ul className="space-y-0.5 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1.5 text-[12px] text-[#B91C1C]">
                                    {row.errors.map((errText, idx) => (
                                      <li key={idx}>• {errText}</li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                              <td className="px-4 py-3.5 align-top text-right whitespace-nowrap font-semibold tabular-nums">
                                {row.amountMinor !== null ? (
                                  <span
                                    className={
                                      row.entryType === 'INCOME'
                                        ? 'text-[#15803D]'
                                        : 'text-[#0F172A]'
                                    }
                                  >
                                    {row.entryType === 'INCOME' ? '+' : '-'}
                                    {formatMoney(row.amountMinor, row.currencyCode)}
                                  </span>
                                ) : (
                                  <span className="text-[#B91C1C]">Lỗi số tiền</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Step 2 Footer */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] bg-white px-5 py-4">
                  <MotionButton variant="secondary" onClick={() => goToStep(1)}>
                    <ArrowLeft className="h-4 w-4" aria-hidden={true} />
                    <span>Quay lại</span>
                  </MotionButton>

                  <div className="flex flex-wrap items-center gap-3">
                    {selectedRows.length === 0 && (
                      <span className="text-[12px] font-semibold text-[#B45309]">
                        Hãy chọn ít nhất 1 dòng hợp lệ hoặc nghi trùng lặp để tiếp tục.
                      </span>
                    )}
                    <MotionButton
                      variant="primary"
                      disabled={selectedRows.length === 0}
                      onClick={handleProceedToStep3}
                    >
                      <span>Tiếp tục xác nhận ({selectedRows.length} dòng)</span>
                      <ArrowRight className="h-4 w-4" aria-hidden={true} />
                    </MotionButton>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* STEP 3: Confirm & Commit */}
          {step === 3 && (
            <section className="space-y-5">
              {commitResult ? (
                /* Completion Card */
                <div className="rounded-xl border border-[#BBF7D0] bg-white p-6 space-y-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0FDF4] border border-[#BBF7D0] text-[#15803D]">
                      <CheckCircle2 className="h-5 w-5" aria-hidden={true} />
                    </div>
                    <div className="space-y-1">
                      <h2
                        data-step-heading
                        tabIndex={-1}
                        className="text-[18px] font-semibold text-[#0F172A] focus:outline-none"
                      >
                        Đã nhập thành công {commitResult.importedCount} giao dịch
                      </h2>
                      <p className="text-[14px] text-[#475569]">
                        Dữ liệu đã được ghi sổ vào tài khoản{' '}
                        <span className="font-semibold text-[#0F172A]">
                          {commitResult.accountName}
                        </span>{' '}
                        ({commitResult.currencyCode})
                        {commitResult.skippedCount > 0
                          ? ` · Bỏ qua ${commitResult.skippedCount} dòng trùng lặp`
                          : ''}
                        .
                      </p>
                    </div>
                  </div>

                  {selectedAccount && (
                    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px] text-[#475569]">
                        Số dư đã ghi sổ hiện tại của {selectedAccount.name}:
                      </span>
                      <span className="text-[16px] font-semibold text-[#0F172A] tabular-nums">
                        {formatMoney(getAccountBalance(selectedAccount.id), selectedAccount.currencyCode)}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Link
                      href="/incomes"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-4 text-[14px] font-semibold text-[#0F172A] transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC]"
                    >
                      <ArrowDownLeft className="h-4 w-4 text-[#15803D]" aria-hidden={true} />
                      <span>Xem Thu nhập</span>
                    </Link>

                    <Link
                      href="/expenses"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-4 text-[14px] font-semibold text-[#0F172A] transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC]"
                    >
                      <ArrowUpRight className="h-4 w-4 text-[#B91C1C]" aria-hidden={true} />
                      <span>Xem Chi tiêu</span>
                    </Link>

                    <Link
                      href="/dashboard"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#4338CA] bg-[#4338CA] px-4 text-[14px] font-semibold text-white transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#3730A3]"
                    >
                      <LayoutDashboard className="h-4 w-4" aria-hidden={true} />
                      <span>Về Tổng quan</span>
                    </Link>

                    <MotionButton variant="ghost" onClick={handleResetWizard}>
                      <span>Nhập tệp CSV khác</span>
                    </MotionButton>
                  </div>
                </div>
              ) : (
                /* Confirmation Summary Card */
                <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 space-y-5">
                  <div className="border-b border-[#E2E8F0] pb-4 space-y-1">
                    <h2
                      data-step-heading
                      tabIndex={-1}
                      className="text-[16px] font-semibold text-[#0F172A] focus:outline-none"
                    >
                      Bước 3 / 3: Xác nhận nhập giao dịch vào sổ cái
                    </h2>
                    <p className="text-[13px] text-[#475569]">
                      Kiểm tra lại tổng hợp trước khi ghi sổ. Hệ thống tự động gắn mã chống ghi trùng khi bạn thử lại.
                    </p>
                  </div>

                  {/* Summary Metrics */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-1">
                      <div className="text-[12px] font-semibold text-[#64748B]">Tài khoản đích</div>
                      <div className="text-[15px] font-semibold text-[#0F172A]">
                        {selectedAccount?.name ?? '—'}
                      </div>
                      <div className="text-[12px] text-[#475569] tabular-nums">
                        Tiền tệ: {activeCurrency}
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-1">
                      <div className="text-[12px] font-semibold text-[#64748B]">Số lượng sẽ nhập</div>
                      <div className="text-[18px] font-semibold text-[#0F172A] tabular-nums">
                        {selectionSummary.totalSelected} giao dịch
                      </div>
                      <div className="text-[12px] text-[#475569] tabular-nums">
                        {selectionSummary.validSelected} hợp lệ · {selectionSummary.duplicateSelected} nghi trùng lặp được chọn
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-1">
                      <div className="text-[12px] font-semibold text-[#64748B]">Tổng giá trị ước tính</div>
                      <div className="text-[14px] font-semibold text-[#15803D] tabular-nums">
                        Thu: +{formatMoney(selectionSummary.totalIncomeMinor, activeCurrency)}
                      </div>
                      <div className="text-[14px] font-semibold text-[#B91C1C] tabular-nums">
                        Chi: -{formatMoney(selectionSummary.totalExpenseMinor, activeCurrency)}
                      </div>
                    </div>
                  </div>

                  {/* Commit Progress Bar (NO Spinner) */}
                  {(isCommitting || commitProgress > 0) && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="rounded-lg border border-[#C7D2FE] bg-[#EEF2FF]/60 p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[13px] tabular-nums">
                        <span className="font-semibold text-[#0F172A]">{commitStageText}</span>
                        <span className="font-semibold text-[#4338CA]">{commitProgress}%</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                        <motion.div
                          className="h-full rounded-full bg-[#4338CA]"
                          initial={false}
                          animate={{ width: `${commitProgress}%` }}
                          transition={reduce ? { duration: 0 } : progressSpring}
                        />
                      </div>
                    </div>
                  )}

                  {/* Error with Retry (reuses request key) */}
                  {commitError && (
                    <div
                      role="alert"
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]"
                    >
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden={true} />
                        <div>
                          <div className="font-semibold">Không thể hoàn tất nhập CSV</div>
                          <div>{commitError}</div>
                        </div>
                      </div>
                      <MotionButton
                        variant="secondary"
                        size="sm"
                        disabled={isCommitting}
                        onClick={() => {
                          void handleCommitImport();
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden={true} />
                        <span>Thử lại an toàn</span>
                      </MotionButton>
                    </div>
                  )}

                  {/* Step 3 Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-4">
                    <MotionButton
                      variant="secondary"
                      disabled={isCommitting}
                      onClick={() => goToStep(2)}
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden={true} />
                      <span>Quay lại</span>
                    </MotionButton>

                    <MotionButton
                      variant="primary"
                      disabled={isCommitting || selectionSummary.totalSelected === 0}
                      onClick={() => {
                        void handleCommitImport();
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden={true} />
                      <span>
                        {isCommitting
                          ? `Đang nhập ${selectionSummary.totalSelected} giao dịch...`
                          : `Xác nhận nhập ${selectionSummary.totalSelected} giao dịch`}
                      </span>
                    </MotionButton>
                  </div>
                </div>
              )}
            </section>
          )}
        </FormSteps>
      )}
    </div>
  );
}
