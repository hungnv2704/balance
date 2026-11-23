'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  Download,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react';
import { attachmentsApi, isApiError, type ApiAttachment } from '@/lib/api-client';
import { formatDateVN, formatMoney } from '@/lib/money';
import { usePreviewStore } from '@/lib/preview-store';
import type { Transaction, TransactionAttachment } from '@/lib/types';
import { Modal } from './ui/Modal';
import { AnimatedListRow, MotionButton } from './ui/MotionPrimitives';
import { SkeletonBlock } from './ui/Skeleton';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|pdf)$/i;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf']);

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function inferMimeType(filename: string, rawType?: string): string {
  if (rawType && ALLOWED_MIME_TYPES.has(rawType)) return rawType;
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Không thể đọc nội dung tệp.'));
    reader.readAsDataURL(file);
  });
}

type AttachmentItem = ApiAttachment | TransactionAttachment;

export function TransactionAttachmentsModal({
  transaction,
  onClose,
}: {
  transaction: Transaction | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(transaction)}
      onClose={onClose}
      title="Chứng từ & Hóa đơn đính kèm"
      description="Hỗ trợ tệp PNG, JPG, PDF (tối đa 5 MB). Hệ thống kiểm tra định dạng tệp thực tế trước khi lưu trữ."
      maxWidthClass="max-w-xl"
    >
      {transaction && (
        <TransactionAttachmentsBody
          key={transaction.id}
          transaction={transaction}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function TransactionAttachmentsBody({
  transaction,
  onClose,
}: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const {
    dataMode,
    authUser,
    getDemoAttachments,
    addDemoAttachment,
    removeDemoAttachment,
    pushToast,
  } = usePreviewStore();

  const isLive = dataMode === 'live' && Boolean(authUser);

  const [liveAttachments, setLiveAttachments] = useState<ApiAttachment[]>([]);
  const [showLoadingSkeleton, setShowLoadingSkeleton] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchLiveAttachments = useCallback((txId: string, onDone?: () => boolean) => {
    let settled = false;
    const skeletonTimer = setTimeout(() => {
      if (!settled && (!onDone || onDone())) {
        setShowLoadingSkeleton(true);
      }
    }, 300);

    attachmentsApi
      .list(txId)
      .then((items) => {
        settled = true;
        if (onDone && !onDone()) return;
        setLiveAttachments(items);
        setLoadError(null);
      })
      .catch((err) => {
        settled = true;
        if (onDone && !onDone()) return;
        setLoadError(
          isApiError(err) ? err.detail : 'Không thể tải danh sách chứng từ từ máy chủ.',
        );
      })
      .finally(() => {
        clearTimeout(skeletonTimer);
        if (!onDone || onDone()) {
          setShowLoadingSkeleton(false);
        }
      });

    return () => {
      settled = true;
      clearTimeout(skeletonTimer);
    };
  }, []);

  useEffect(() => {
    if (!isLive) return;
    let active = true;
    const cleanup = fetchLiveAttachments(transaction.id, () => active);
    return () => {
      active = false;
      cleanup();
    };
  }, [fetchLiveAttachments, isLive, transaction.id]);

  const attachments: AttachmentItem[] = isLive
    ? liveAttachments
    : getDemoAttachments(transaction.id);

  const processSelectedFile = async (file: File) => {
    setUploadError(null);

    if (!ALLOWED_EXTENSIONS.test(file.name)) {
      setUploadError('Định dạng không hợp lệ. Chỉ hỗ trợ tệp PNG, JPG hoặc PDF.');
      return;
    }
    if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
      setUploadError('Loại tệp không hợp lệ. Chỉ hỗ trợ PNG, JPG hoặc PDF.');
      return;
    }
    if (file.size <= 0) {
      setUploadError('Tệp rỗng, vui lòng chọn tệp hợp lệ.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setUploadError(
        `Dung lượng tệp (${formatFileSize(file.size)}) vượt quá giới hạn tối đa 5 MB.`,
      );
      return;
    }

    setUploading(true);
    try {
      const contentBase64 = await readFileAsBase64(file);

      if (isLive) {
        const created = await attachmentsApi.upload(transaction.id, {
          filename: file.name,
          contentBase64,
        });
        setLiveAttachments((prev) => [created, ...prev]);
      } else {
        const demoItem: TransactionAttachment = {
          id: `att-demo-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          transactionId: transaction.id,
          filename: file.name,
          mimeType: inferMimeType(file.name, file.type),
          sizeBytes: file.size,
          contentBase64,
          createdAt: new Date().toISOString(),
        };
        addDemoAttachment(transaction.id, demoItem);
      }

      pushToast({
        tone: 'success',
        title: 'Đã đính kèm chứng từ',
        description: file.name,
      });
    } catch (err) {
      const msg = isApiError(err)
        ? err.detail
        : 'Không thể tải lên chứng từ. Vui lòng kiểm tra định dạng tệp.';
      setUploadError(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  const handleDeleteAttachment = (att: AttachmentItem) => {
    if (!isLive) {
      removeDemoAttachment(transaction.id, att.id);
      pushToast({
        tone: 'info',
        title: 'Đã xóa chứng từ',
        description: att.filename,
      });
      return;
    }

    const attemptRemove = () => {
      const snapshot = liveAttachments;
      setLiveAttachments((prev) => prev.filter((item) => item.id !== att.id));

      void attachmentsApi
        .remove(att.id)
        .then(() => {
          pushToast({
            tone: 'info',
            title: 'Đã xóa chứng từ',
            description: att.filename,
          });
        })
        .catch((err) => {
          setLiveAttachments(snapshot);
          pushToast({
            tone: 'danger',
            title: 'Xóa chứng từ thất bại — đã hoàn tác',
            description: isApiError(err) ? err.detail : 'Không thể kết nối máy chủ.',
            retryLabel: 'Thử lại',
            onRetry: () => attemptRemove(),
          });
        });
    };

    attemptRemove();
  };

  const getDownloadHref = (att: AttachmentItem): string => {
    if (isLive) {
      return attachmentsApi.downloadUrl(att.id);
    }
    const demoAtt = att as TransactionAttachment;
    if (demoAtt.contentBase64) {
      return `data:${demoAtt.mimeType};base64,${demoAtt.contentBase64}`;
    }
    return '#';
  };

  return (
    <div className="space-y-5">
      {/* Transaction Summary */}
      <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="text-[14px] font-semibold text-[#0F172A] truncate">
            {transaction.description}
          </div>
          <div className="text-[12px] text-[#64748B] tabular-nums">
            Ngày {formatDateVN(transaction.transactionDate)}
          </div>
        </div>
        <div className="text-[14px] font-semibold text-[#0F172A] tabular-nums">
          {formatMoney(transaction.amountMinor, transaction.currencyCode)}
        </div>
      </div>

      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={[
          'rounded-xl border border-dashed p-4 transition-colors space-y-3',
          dragActive
            ? 'border-[#4338CA] bg-[#EEF2FF]/50'
            : 'border-[#CBD5E1] bg-[#F8FAFC]',
        ].join(' ')}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
          onChange={handleFileInputChange}
          disabled={uploading}
          aria-label="Chọn tệp chứng từ PNG, JPG hoặc PDF"
          className="sr-only"
        />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Paperclip className="h-4 w-4 shrink-0 mt-0.5 text-[#4338CA]" aria-hidden={true} />
            <div className="space-y-0.5">
              <p className="text-[13px] font-semibold text-[#0F172A]">
                Tải lên hóa đơn hoặc biên lai
              </p>
              <p className="text-[12px] text-[#64748B]">
                Kéo thả tệp vào đây hoặc chọn từ thiết bị (PNG, JPG, PDF · tối đa 5 MB).
              </p>
            </div>
          </div>

          <MotionButton
            type="button"
            variant="primary"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0"
          >
            <Upload className="h-4 w-4" aria-hidden={true} />
            <span>{uploading ? 'Đang tải lên...' : 'Chọn tệp tải lên'}</span>
          </MotionButton>
        </div>

        {uploadError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden={true} />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* Attachments List */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-[#334155]">
            Danh sách chứng từ ({attachments.length})
          </h3>
        </div>

        {loadError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-[13px] text-[#B91C1C]"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden={true} />
              <span>{loadError}</span>
            </div>
            <MotionButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setLoadError(null);
                fetchLiveAttachments(transaction.id);
              }}
            >
              <span>Thử lại</span>
            </MotionButton>
          </div>
        )}

        {showLoadingSkeleton ? (
          <div
            className="rounded-xl border border-[#E2E8F0] divide-y divide-[#E2E8F0]"
            role="status"
            aria-label="Đang tải danh sách chứng từ"
          >
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 p-3.5">
                <div className="space-y-1.5 flex-1">
                  <SkeletonBlock className="h-4 w-48" />
                  <SkeletonBlock className="h-3 w-28" />
                </div>
                <SkeletonBlock className="h-9 w-24" />
              </div>
            ))}
          </div>
        ) : attachments.length === 0 ? (
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 text-left space-y-1">
            <p className="text-[13px] font-semibold text-[#0F172A]">
              Chưa có chứng từ nào được đính kèm
            </p>
            <p className="text-[12px] text-[#64748B]">
              Tải lên ảnh chụp hóa đơn (PNG/JPG) hoặc chứng từ PDF để lưu trữ đối chiếu sau này.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#E2E8F0] bg-white divide-y divide-[#E2E8F0] overflow-hidden">
            <AnimatePresence initial={false}>
              {attachments.map((att) => {
                const isPdf =
                  att.mimeType === 'application/pdf' ||
                  att.filename.toLowerCase().endsWith('.pdf');
                const downloadHref = getDownloadHref(att);

                return (
                  <AnimatedListRow
                    key={att.id}
                    rowKey={att.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div className="h-9 w-9 shrink-0 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-center text-[#4338CA]">
                        {isPdf ? (
                          <FileText className="h-4 w-4" aria-hidden={true} />
                        ) : (
                          <ImageIcon className="h-4 w-4" aria-hidden={true} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="text-[13px] font-semibold text-[#0F172A] truncate">
                          {att.filename}
                        </div>
                        <div className="text-[12px] text-[#64748B] tabular-nums">
                          {formatFileSize(att.sizeBytes)} · {formatDateVN(att.createdAt.slice(0, 10))}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={downloadHref}
                        download={att.filename}
                        target={isLive ? '_blank' : undefined}
                        rel={isLive ? 'noopener noreferrer' : undefined}
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 text-[13px] font-semibold text-[#4338CA] transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#F8FAFC] [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#CBD5E1]"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden={true} />
                        <span>Tải xuống</span>
                      </a>

                      <MotionButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteAttachment(att)}
                        aria-label={`Xóa chứng từ ${att.filename}`}
                        className="text-[#B91C1C]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden={true} />
                        <span>Xóa</span>
                      </MotionButton>
                    </div>
                  </AnimatedListRow>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-[#E2E8F0] pt-3">
        <MotionButton variant="secondary" onClick={onClose}>
          <span>Đóng</span>
        </MotionButton>
      </div>
    </div>
  );
}
