import { ValidationDomainException } from '../../shared-kernel/domain/domain-exceptions';

export const MAX_CSV_PAYLOAD_BYTES = 1_048_576; // 1 MB (T-10)
export const MAX_IMPORT_ROWS = 500;
export const MAX_CSV_COLUMNS = 64;

export interface ParsedImportCsvRow {
  readonly rowNumber: number;
  readonly rawDate: string;
  readonly rawType: string;
  readonly rawAmount: string;
  readonly rawCategory: string;
  readonly rawDescription: string;
  readonly rawCounterparty: string;
  readonly extraColumnsError?: string;
}

type CanonicalColumnKey =
  | 'date'
  | 'type'
  | 'amount'
  | 'category'
  | 'description'
  | 'counterparty'
  | 'merchant'
  | 'source';

const HEADER_ALIAS_MAP: Readonly<Record<string, CanonicalColumnKey>> = {
  date: 'date',
  transaction_date: 'date',
  type: 'type',
  entry_type: 'type',
  amount: 'amount',
  category: 'category',
  description: 'description',
  counterparty: 'counterparty',
  merchant: 'merchant',
  source: 'source',
};

const REQUIRED_COLUMNS: ReadonlyArray<CanonicalColumnKey> = [
  'date',
  'type',
  'amount',
  'category',
];

function isBlankRow(row: ReadonlyArray<string>): boolean {
  return row.length === 1 && row[0].trim().length === 0;
}

/**
 * RFC 4180 compliant streaming CSV parser with bounded payload (1 MB),
 * bounded column count (64), and bounded data row count (500) to mitigate
 * CSV bomb DoS attacks (T-10).
 */
export function parseImportCsv(csvContent: string): ParsedImportCsvRow[] {
  if (typeof csvContent !== 'string') {
    throw new ValidationDomainException('CSV content must be a string.', 'INVALID_CSV');
  }

  if (Buffer.byteLength(csvContent, 'utf8') > MAX_CSV_PAYLOAD_BYTES) {
    throw new ValidationDomainException(
      'CSV payload exceeds the maximum allowed size of 1 MB.',
      'CSV_PAYLOAD_TOO_LARGE',
    );
  }

  const normalized =
    csvContent.charCodeAt(0) === 0xfeff ? csvContent.slice(1) : csvContent;

  if (normalized.trim().length === 0) {
    throw new ValidationDomainException('CSV content cannot be empty.', 'EMPTY_CSV');
  }

  let headerRow: string[] | null = null;
  const dataRows: string[][] = [];

  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let fieldStart = true;
  let justClosedQuote = false;

  const pushRecord = (record: string[]): void => {
    if (isBlankRow(record)) {
      return;
    }
    if (headerRow === null) {
      headerRow = record;
      return;
    }
    if (dataRows.length >= MAX_IMPORT_ROWS) {
      throw new ValidationDomainException(
        `CSV import cannot exceed ${MAX_IMPORT_ROWS} data rows.`,
        'IMPORT_ROW_LIMIT_EXCEEDED',
      );
    }
    dataRows.push(record);
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];

    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (justClosedQuote) {
      if (ch === ',') {
        currentRow.push(currentField);
        if (currentRow.length >= MAX_CSV_COLUMNS) {
          throw new ValidationDomainException(
            `CSV row exceeds maximum allowed column count (${MAX_CSV_COLUMNS}).`,
            'CSV_TOO_MANY_COLUMNS',
          );
        }
        currentField = '';
        fieldStart = true;
        justClosedQuote = false;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && normalized[i + 1] === '\n') {
          i += 1;
        }
        currentRow.push(currentField);
        if (currentRow.length > MAX_CSV_COLUMNS) {
          throw new ValidationDomainException(
            `CSV row exceeds maximum allowed column count (${MAX_CSV_COLUMNS}).`,
            'CSV_TOO_MANY_COLUMNS',
          );
        }
        pushRecord(currentRow);
        currentRow = [];
        currentField = '';
        fieldStart = true;
        justClosedQuote = false;
        continue;
      }
      if (ch === ' ' || ch === '\t') {
        continue;
      }
      throw new ValidationDomainException(
        'Malformed CSV: unexpected character after closing quote.',
        'MALFORMED_CSV',
      );
    }

    if (ch === '"') {
      if (fieldStart || currentField.trim().length === 0) {
        currentField = '';
        inQuotes = true;
        fieldStart = false;
      } else {
        throw new ValidationDomainException(
          'Malformed CSV: unescaped quote inside unquoted field.',
          'MALFORMED_CSV',
        );
      }
      continue;
    }

    if (ch === ',') {
      currentRow.push(currentField);
      if (currentRow.length >= MAX_CSV_COLUMNS) {
        throw new ValidationDomainException(
          `CSV row exceeds maximum allowed column count (${MAX_CSV_COLUMNS}).`,
          'CSV_TOO_MANY_COLUMNS',
        );
      }
      currentField = '';
      fieldStart = true;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && normalized[i + 1] === '\n') {
        i += 1;
      }
      currentRow.push(currentField);
      if (currentRow.length > MAX_CSV_COLUMNS) {
        throw new ValidationDomainException(
          `CSV row exceeds maximum allowed column count (${MAX_CSV_COLUMNS}).`,
          'CSV_TOO_MANY_COLUMNS',
        );
      }
      pushRecord(currentRow);
      currentRow = [];
      currentField = '';
      fieldStart = true;
      continue;
    }

    currentField += ch;
    fieldStart = false;
  }

  if (inQuotes) {
    throw new ValidationDomainException(
      'Malformed CSV: unterminated quoted field.',
      'MALFORMED_CSV',
    );
  }

  if (currentRow.length > 0 || currentField.length > 0 || justClosedQuote) {
    currentRow.push(currentField);
    if (currentRow.length > MAX_CSV_COLUMNS) {
      throw new ValidationDomainException(
        `CSV row exceeds maximum allowed column count (${MAX_CSV_COLUMNS}).`,
        'CSV_TOO_MANY_COLUMNS',
      );
    }
    pushRecord(currentRow);
  }

  const resolvedHeader: string[] = headerRow ?? [];
  if (resolvedHeader.length === 0) {
    throw new ValidationDomainException('CSV content must include a header row.', 'EMPTY_CSV');
  }

  const colIndex: Partial<Record<CanonicalColumnKey, number>> = {};
  for (let i = 0; i < resolvedHeader.length; i += 1) {
    const normalizedHeader = resolvedHeader[i].trim().toLowerCase();
    const canonical = HEADER_ALIAS_MAP[normalizedHeader];
    if (!canonical) {
      continue;
    }
    if (colIndex[canonical] !== undefined) {
      throw new ValidationDomainException(
        `Duplicate CSV column mapped to '${canonical}'.`,
        'DUPLICATE_CSV_HEADER',
      );
    }
    colIndex[canonical] = i;
  }

  const missingHeaders = REQUIRED_COLUMNS.filter((col) => colIndex[col] === undefined);
  if (missingHeaders.length > 0) {
    throw new ValidationDomainException(
      `Missing required CSV header(s): ${missingHeaders.join(', ')}.`,
      'MISSING_REQUIRED_CSV_HEADERS',
    );
  }

  const expectedColumnCount = resolvedHeader.length;

  return dataRows.map((row, idx) => {
    const rawDate = (row[colIndex.date!] ?? '').trim();
    const rawType = (row[colIndex.type!] ?? '').trim();
    const rawAmount = (row[colIndex.amount!] ?? '').trim();
    const rawCategory = (row[colIndex.category!] ?? '').trim();
    const rawDescription =
      colIndex.description !== undefined ? (row[colIndex.description] ?? '').trim() : '';

    const cp =
      colIndex.counterparty !== undefined ? (row[colIndex.counterparty] ?? '').trim() : '';
    const merch = colIndex.merchant !== undefined ? (row[colIndex.merchant] ?? '').trim() : '';
    const src = colIndex.source !== undefined ? (row[colIndex.source] ?? '').trim() : '';

    const upperType = rawType.toUpperCase();
    const rawCounterparty =
      upperType === 'INCOME' ? cp || src || merch : cp || merch || src;

    return {
      rowNumber: idx + 1,
      rawDate,
      rawType,
      rawAmount,
      rawCategory,
      rawDescription,
      rawCounterparty,
      ...(row.length > expectedColumnCount
        ? {
            extraColumnsError: `Row has ${row.length} column(s), expected ${expectedColumnCount}; check for unquoted commas.`,
          }
        : {}),
    };
  });
}
