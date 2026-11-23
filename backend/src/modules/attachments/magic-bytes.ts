import * as path from 'node:path';
import { AttachmentMimeType } from '@pfm/shared-types';
import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';

export const MAX_ATTACHMENT_BYTES = 5_242_880; // 5 MiB
export const MAX_ATTACHMENTS_PER_TRANSACTION = 5;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // %PDF-

export interface DetectedAttachmentType {
  readonly mimeType: AttachmentMimeType;
  readonly extension: 'png' | 'jpg' | 'pdf';
}

function startsWithBytes(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

export function detectAllowedAttachmentType(buffer: Buffer): DetectedAttachmentType | null {
  if (startsWithBytes(buffer, PNG_MAGIC)) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (startsWithBytes(buffer, JPEG_MAGIC)) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWithBytes(buffer, PDF_MAGIC)) {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
  return null;
}

export function decodeAndValidateAttachmentBase64(contentBase64: string): Buffer {
  const cleaned = contentBase64.replace(/\s+/g, '');
  if (cleaned.length === 0) {
    throw new ValidationDomainException(
      'Attachment file content cannot be empty.',
      'INVALID_FILE_SIZE',
    );
  }

  if (cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    throw new ValidationDomainException(
      'Attachment contentBase64 is not valid Base64.',
      'INVALID_FILE_CONTENT',
    );
  }

  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length < 1 || buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new ValidationDomainException(
      `Attachment size must be between 1 byte and ${MAX_ATTACHMENT_BYTES} bytes (5 MiB).`,
      'INVALID_FILE_SIZE',
    );
  }

  return buffer;
}

export function sanitizeAttachmentFilename(rawFilename: string): string {
  const winBase = path.win32.basename(rawFilename);
  const posixBase = path.posix.basename(winBase);
  const stripped = posixBase.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (stripped.length === 0) {
    throw new ValidationDomainException('Attachment filename cannot be empty.');
  }
  return stripped.slice(0, 255);
}

export function formatContentDispositionFilename(filename: string): string {
  const safe = filename.replace(/["\\;\r\n\x00-\x1f\x7f]/g, '_').trim();
  return safe.length > 0 ? safe : 'attachment';
}
