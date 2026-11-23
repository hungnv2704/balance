import type {
  ApiImportCommitRow,
  ApiImportPreviewResponse,
  ImportRowStatus,
} from './api-client';
import { formatDateVN, formatMoney, parseMoneyInput } from './money';
import type { Account, Category, CurrencyCode, Transaction } from './types';

export const MAX_CSV_FILE_BYTES = 1024 * 1024; // 1 MB
export const MAX_CSV_PREVIEW_ROWS = 500;

export interface NormalizedImportRow {
  rowIndex: number;
  status: ImportRowStatus;
  entryType: 'INCOME' | 'EXPENSE' | null;
  transactionDate: string | null;
  amountMinor: number | null;
  currencyCode: CurrencyCode;
  categoryId: string | null;
  categoryName: string | null;
  description: string;
  note: string | null;
  duplicateReason: string | null;
  matchedTransactionId: string | null;
  errors: string[];
}

export interface NormalizedImportPreview {
  accountId: string;
  currencyCode: CurrencyCode;
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  rows: NormalizedImportRow[];
}

export function buildSampleCsv(currency: CurrencyCode): string {
  if (currency === 'USD' || currency === 'EUR') {
    return [
      'date,type,amount,category,description,note',
      '2026-11-15,EXPENSE,64.50,Mua sắm,Cloud Hosting & SaaS Tools,Khớp giao dịch mẫu để kiểm tra cảnh báo trùng lặp',
      '2026-11-23,EXPENSE,18.25,Ăn uống,Lunch team meeting,Thanh toán thẻ',
      '2026-11-23,INCOME,420.00,Freelance,UI Audit Milestone,Chuyển khoản nhanh',
      '2026-11-23,EXPENSE,18.25,Ăn uống,Lunch team meeting,Dòng trùng lặp trong cùng tệp CSV',
      '2026-11-23,EXPENSE,0,Mua sắm,Giao dịch lỗi số tiền bằng 0,Kiểm tra báo lỗi từng dòng',
    ].join('\n');
  }

  return [
    'date,type,amount,category,description,note',
    '2026-11-10,EXPENSE,4100000,Ăn uống,Ăn uống & đi chợ tháng 11,Khớp giao dịch mẫu để kiểm tra cảnh báo trùng lặp',
    '2026-11-23,EXPENSE,85000,Ăn uống,Cà phê sáng Highlands,Thanh toán QR',
    '2026-11-23,INCOME,3500000,Freelance,Thù lao tư vấn giao diện,Chuyển khoản nhanh',
    '2026-11-23,EXPENSE,85000,Ăn uống,Cà phê sáng Highlands,Dòng trùng lặp trong cùng tệp CSV',
    '2026-11-23,EXPENSE,-50000,Mua sắm,Giao dịch lỗi số tiền âm,Kiểm tra báo lỗi từng dòng',
  ].join('\n');
}

function parseCsvLines(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
      continue;
    }

    if (ch === '\r' && next === '\n') {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
      i += 1;
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
      continue;
    }

    currentField += ch;
  }

  currentRow.push(currentField.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

type ColumnMap = {
  date: number;
  type: number;
  amount: number;
  category: number;
  description: number;
  note: number;
};

function detectColumns(firstRow: string[]): { hasHeader: boolean; map: ColumnMap } {
  const keys = firstRow.map(normalizeHeaderKey);
  const findCol = (aliases: string[]): number =>
    keys.findIndex((k) => aliases.includes(k));

  const date = findCol(['date', 'transactiondate', 'ngay', 'ngaygiaodich']);
  const type = findCol(['type', 'entrytype', 'kind', 'loai', 'loaigiaodich']);
  const amount = findCol(['amount', 'amountminor', 'sotien', 'tien']);
  const category = findCol(['category', 'categoryname', 'categoryid', 'danhmuc']);
  const description = findCol(['description', 'desc', 'mota', 'noidung']);
  const note = findCol(['note', 'ghichu', 'memo']);

  const matchedHeaderCount = [date, type, amount].filter((idx) => idx >= 0).length;
  if (matchedHeaderCount >= 2) {
    return {
      hasHeader: true,
      map: {
        date: date >= 0 ? date : 0,
        type: type >= 0 ? type : 1,
        amount: amount >= 0 ? amount : 2,
        category: category >= 0 ? category : 3,
        description: description >= 0 ? description : 4,
        note: note >= 0 ? note : 5,
      },
    };
  }

  return {
    hasHeader: false,
    map: { date: 0, type: 1, amount: 2, category: 3, description: 4, note: 5 },
  };
}

function normalizeDateString(raw: string): { valid: boolean; iso: string | null; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, iso: null, error: 'Thiếu ngày giao dịch (YYYY-MM-DD).' };
  }

  let year: number;
  let month: number;
  let day: number;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const vnMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);

  if (isoMatch) {
    year = Number.parseInt(isoMatch[1], 10);
    month = Number.parseInt(isoMatch[2], 10);
    day = Number.parseInt(isoMatch[3], 10);
  } else if (vnMatch) {
    day = Number.parseInt(vnMatch[1], 10);
    month = Number.parseInt(vnMatch[2], 10);
    year = Number.parseInt(vnMatch[3], 10);
  } else {
    return {
      valid: false,
      iso: null,
      error: `Ngày "${trimmed}" không đúng định dạng YYYY-MM-DD hoặc DD/MM/YYYY.`,
    };
  }

  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return { valid: false, iso: null, error: `Ngày "${trimmed}" không tồn tại trên lịch.` };
  }

  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { valid: true, iso };
}

function normalizeEntryType(raw: string): 'INCOME' | 'EXPENSE' | null {
  const upper = raw.trim().toUpperCase();
  if (upper === 'INCOME' || upper === 'THU' || upper === 'IN') return 'INCOME';
  if (upper === 'EXPENSE' || upper === 'CHI' || upper === 'OUT') return 'EXPENSE';
  return null;
}

export function previewCsvDemo(params: {
  csvContent: string;
  account: Account;
  categories: Category[];
  existingTransactions: Transaction[];
}): NormalizedImportPreview {
  const { csvContent, account, categories, existingTransactions } = params;
  const parsedLines = parseCsvLines(csvContent);

  if (parsedLines.length === 0) {
    return {
      accountId: account.id,
      currencyCode: account.currencyCode,
      totalRows: 0,
      validCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      rows: [],
    };
  }

  const { hasHeader, map } = detectColumns(parsedLines[0]);
  const dataRows = (hasHeader ? parsedLines.slice(1) : parsedLines).slice(0, MAX_CSV_PREVIEW_ROWS);

  const activeExisting = existingTransactions.filter(
    (tx) =>
      tx.accountId === account.id &&
      tx.status !== 'VOIDED' &&
      tx.status !== 'REVERSED' &&
      (tx.entryType === 'INCOME' || tx.entryType === 'EXPENSE'),
  );

  const seenInCsv = new Map<string, number>();
  const rows: NormalizedImportRow[] = [];

  dataRows.forEach((cols, idx) => {
    const rowIndex = idx + 1;
    const errors: string[] = [];

    const rawDate = cols[map.date] ?? '';
    const rawType = cols[map.type] ?? '';
    const rawAmount = cols[map.amount] ?? '';
    const rawCategory = cols[map.category] ?? '';
    const rawDescription = cols[map.description] ?? '';
    const rawNote = cols[map.note] ?? '';

    if (cols.length < 3) {
      errors.push('Dòng CSV thiếu cột tối thiểu (cần ngày, loại, số tiền).');
    }

    const dateRes = normalizeDateString(rawDate);
    if (!dateRes.valid && dateRes.error) {
      errors.push(dateRes.error);
    }

    const entryType = normalizeEntryType(rawType);
    if (!entryType) {
      errors.push(`Loại "${rawType || 'trống'}" không hợp lệ (dùng Thu nhập hoặc Chi tiêu).`);
    }

    const amountRes = parseMoneyInput(rawAmount, account.currencyCode);
    if (!amountRes.valid || amountRes.minorValue === null) {
      errors.push(amountRes.error ?? 'Số tiền không hợp lệ.');
    }

    let matchedCategory: Category | undefined;
    if (entryType) {
      const pool = categories.filter((c) => c.kind === entryType && !c.archivedAt);
      if (rawCategory.trim()) {
        const needle = rawCategory.trim().toLowerCase();
        matchedCategory = pool.find(
          (c) => c.id.toLowerCase() === needle || c.name.toLowerCase() === needle,
        );
        if (!matchedCategory) {
          errors.push(
            `Không tìm thấy danh mục "${rawCategory.trim()}" cho loại ${entryType === 'INCOME' ? 'Thu nhập' : 'Chi tiêu'}.`,
          );
        }
      } else {
        matchedCategory = pool[0];
      }
    }

    const description = rawDescription.trim() || matchedCategory?.name || '';
    if (description.length > 255) {
      errors.push('Mô tả vượt quá 255 ký tự.');
    }

    if (errors.length > 0 || !dateRes.iso || !entryType || amountRes.minorValue === null) {
      rows.push({
        rowIndex,
        status: 'INVALID',
        entryType,
        transactionDate: dateRes.iso ?? (rawDate.trim() || null),
        amountMinor: amountRes.minorValue,
        currencyCode: account.currencyCode,
        categoryId: matchedCategory?.id ?? null,
        categoryName: matchedCategory?.name ?? (rawCategory.trim() || null),
        description: description || '—',
        note: rawNote.trim() || null,
        duplicateReason: null,
        matchedTransactionId: null,
        errors,
      });
      return;
    }

    // Duplicate check 1: Existing ledger transactions on target account
    const matchedExisting = activeExisting.find(
      (tx) =>
        tx.transactionDate === dateRes.iso &&
        tx.entryType === entryType &&
        tx.amountMinor === amountRes.minorValue,
    );

    const csvFingerprint = `${dateRes.iso}|${entryType}|${amountRes.minorValue}|${description.toLowerCase()}`;
    const firstCsvRow = seenInCsv.get(csvFingerprint);

    let status: ImportRowStatus = 'VALID';
    let duplicateReason: string | null = null;
    let matchedTransactionId: string | null = null;

    if (matchedExisting) {
      status = 'DUPLICATE_SUSPECTED';
      matchedTransactionId = matchedExisting.id;
      duplicateReason = `Trùng ngày ${formatDateVN(dateRes.iso)}, loại ${entryType === 'INCOME' ? 'Thu nhập' : 'Chi tiêu'} và số tiền ${formatMoney(amountRes.minorValue, account.currencyCode)} với giao dịch "${matchedExisting.description}".`;
    } else if (firstCsvRow !== undefined) {
      status = 'DUPLICATE_SUSPECTED';
      duplicateReason = `Trùng lặp nội dung với dòng #${firstCsvRow} trong cùng tệp CSV.`;
    } else {
      seenInCsv.set(csvFingerprint, rowIndex);
    }

    rows.push({
      rowIndex,
      status,
      entryType,
      transactionDate: dateRes.iso,
      amountMinor: amountRes.minorValue,
      currencyCode: account.currencyCode,
      categoryId: matchedCategory?.id ?? null,
      categoryName: matchedCategory?.name ?? null,
      description: description || (entryType === 'INCOME' ? 'Thu nhập nhập CSV' : 'Chi tiêu nhập CSV'),
      note: rawNote.trim() || null,
      duplicateReason,
      matchedTransactionId,
      errors: [],
    });
  });

  const validCount = rows.filter((r) => r.status === 'VALID').length;
  const duplicateCount = rows.filter((r) => r.status === 'DUPLICATE_SUSPECTED').length;
  const invalidCount = rows.filter((r) => r.status === 'INVALID').length;

  return {
    accountId: account.id,
    currencyCode: account.currencyCode,
    totalRows: rows.length,
    validCount,
    duplicateCount,
    invalidCount,
    rows,
  };
}

function normalizeCurrencyCode(code: string | null | undefined, fallback: CurrencyCode): CurrencyCode {
  if (code === 'VND' || code === 'USD' || code === 'EUR' || code === 'JPY') {
    return code;
  }
  return fallback;
}

export function normalizeApiPreviewResponse(
  res: ApiImportPreviewResponse,
  fallbackAccountId: string,
  fallbackCurrency: CurrencyCode,
  categories: Category[],
): NormalizedImportPreview {
  const currencyCode = normalizeCurrencyCode(res.currencyCode, fallbackCurrency);
  const rows: NormalizedImportRow[] = (res.rows ?? []).map((row, idx) => {
    const rowErrors: string[] = Array.isArray(row.errors)
      ? row.errors.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
      : row.error
        ? [row.error]
        : [];

    const parsedAmount =
      row.amountMinor !== null && row.amountMinor !== undefined && row.amountMinor !== ''
        ? Number(row.amountMinor)
        : null;

    const cat = row.categoryId
      ? categories.find((c) => c.id === row.categoryId)
      : undefined;

    return {
      rowIndex: typeof row.rowIndex === 'number' ? row.rowIndex : idx + 1,
      status: row.status,
      entryType: row.entryType ?? null,
      transactionDate: row.transactionDate ?? null,
      amountMinor: parsedAmount !== null && Number.isFinite(parsedAmount) ? parsedAmount : null,
      currencyCode: normalizeCurrencyCode(row.currencyCode, currencyCode),
      categoryId: row.categoryId ?? null,
      categoryName: row.categoryName ?? cat?.name ?? null,
      description: row.description ?? '—',
      note: row.note ?? null,
      duplicateReason: row.duplicateReason ?? null,
      matchedTransactionId: row.matchedTransactionId ?? null,
      errors: rowErrors,
    };
  });

  const validCount =
    res.validCount ?? res.summary?.validCount ?? rows.filter((r) => r.status === 'VALID').length;
  const duplicateCount =
    res.duplicateCount ??
    res.summary?.duplicateCount ??
    rows.filter((r) => r.status === 'DUPLICATE_SUSPECTED').length;
  const invalidCount =
    res.invalidCount ?? res.summary?.invalidCount ?? rows.filter((r) => r.status === 'INVALID').length;

  return {
    accountId: res.accountId || fallbackAccountId,
    currencyCode,
    totalRows: res.totalRows ?? res.summary?.totalRows ?? rows.length,
    validCount,
    duplicateCount,
    invalidCount,
    rows,
  };
}

export function toApiCommitRows(rows: NormalizedImportRow[]): ApiImportCommitRow[] {
  return rows
    .filter(
      (r): r is NormalizedImportRow & {
        entryType: 'INCOME' | 'EXPENSE';
        transactionDate: string;
        amountMinor: number;
      } =>
        r.status !== 'INVALID' &&
        (r.entryType === 'INCOME' || r.entryType === 'EXPENSE') &&
        Boolean(r.transactionDate) &&
        r.amountMinor !== null &&
        r.amountMinor > 0,
    )
    .map((r) => ({
      entryType: r.entryType,
      transactionDate: r.transactionDate,
      amountMinor: String(r.amountMinor),
      ...(r.categoryId ? { categoryId: r.categoryId } : {}),
      ...(r.description && r.description !== '—' ? { description: r.description } : {}),
    }));
}
