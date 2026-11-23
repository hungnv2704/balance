/**
 * Neutralizes CSV Formula Injection (OWASP CWE-1236 / docs/05 T-06):
 * Prefixes `'` on any cell starting with `=`, `+`, `-`, `@`, `\t`, or `\r`
 * (including after leading spaces/newlines) and applies RFC 4180 quoting.
 */
const DANGEROUS_CSV_START_REGEX = /^[ \n\v\f]*[=+\-@\t\r]/;

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let raw = typeof value === 'bigint' ? value.toString() : String(value);

  if (DANGEROUS_CSV_START_REGEX.test(raw)) {
    raw = `'${raw}`;
  }

  if (
    raw.includes(',') ||
    raw.includes('"') ||
    raw.includes('\n') ||
    raw.includes('\r')
  ) {
    return `"${raw.replace(/"/g, '""')}"`;
  }

  return raw;
}

export function serializeCsvRow(cells: ReadonlyArray<unknown>): string {
  return cells.map((cell) => sanitizeCsvCell(cell)).join(',');
}

export function buildCsvDocument(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  const lines = [serializeCsvRow(headers)];
  for (const row of rows) {
    lines.push(serializeCsvRow(row));
  }
  return `${lines.join('\r\n')}\r\n`;
}
