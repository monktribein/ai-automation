import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { neutralizeFormula } from '../../common/utils/text';
import type { RowError } from './import-export.models';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type CellPrimitive = string | number | boolean | Date | null;

export class SpreadsheetError extends Error {}

/** XLSX files are ZIP containers: they must start with the local file header "PK\x03\x04". */
export function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

function cellToPrimitive(value: ExcelJS.CellValue): CellPrimitive | { formula: true } {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return { formula: true };
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text; // hyperlink: keep text, drop link
    if ('error' in value) return null;
  }
  return null;
}

export interface ParsedSheet {
  headers: string[];
  rows: { rowNumber: number; values: Record<string, CellPrimitive> }[];
  errors: RowError[];
}

/**
 * Reads the first worksheet with exact header matching and formula-cell rejection.
 *
 * The workbook is loaded in memory (ExcelJS's streaming reader fails on some valid files).
 * Memory is bounded by the upload size limit (IMPORT_MAX_FILE_BYTES) and the row limit is
 * checked before any row is processed.
 */
export async function readSheet(
  buf: Buffer,
  columns: { key: string; required?: boolean }[],
  maxRows: number,
): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new SpreadsheetError('The file is not a readable .xlsx workbook');
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.actualRowCount === 0) throw new SpreadsheetError('Workbook has no header row');
  if (ws.actualRowCount - 1 > maxRows)
    throw new SpreadsheetError(`File exceeds the maximum of ${maxRows} data rows`);

  const expected = columns.map((c) => c.key.toLowerCase());
  const requiredKeys = columns.filter((c) => c.required).map((c) => c.key.toLowerCase());
  const headerValues = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1);
  const headers = headerValues.map((v) =>
    String(cellToPrimitive(v) ?? '')
      .trim()
      .toLowerCase(),
  );
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  if (headers.length === 0) throw new SpreadsheetError('Workbook has no header row');
  const unknown = headers.filter((h) => h && !expected.includes(h));
  if (unknown.length) throw new SpreadsheetError(`Unsupported column(s): ${unknown.join(', ')}`);
  const missing = requiredKeys.filter((h) => !headers.includes(h));
  if (missing.length) throw new SpreadsheetError(`Missing required column(s): ${missing.join(', ')}`);
  const named = headers.filter(Boolean);
  if (new Set(named).size !== named.length) throw new SpreadsheetError('Duplicate column headers');
  // Canonical (case-sensitive) keys by column position.
  const headerMap = headers.map((h) => (h ? columns[expected.indexOf(h)]!.key : undefined));

  const out: ParsedSheet = { headers, rows: [], errors: [] };
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (row.values as ExcelJS.CellValue[]).slice(1);
    const record: Record<string, CellPrimitive> = {};
    let empty = true;
    for (let i = 0; i < headerMap.length; i++) {
      const key = headerMap[i];
      if (!key) continue;
      const v = cellToPrimitive(values[i]);
      if (v && typeof v === 'object' && 'formula' in v) {
        out.errors.push({ row: rowNumber, column: key, message: 'Formulas are not allowed' });
        record[key] = null;
        empty = false;
        continue;
      }
      if (v !== null && v !== '') empty = false;
      record[key] = typeof v === 'string' ? v.trim() : (v as CellPrimitive);
    }
    if (!empty) out.rows.push({ rowNumber, values: record });
  });
  if (out.rows.length > maxRows)
    throw new SpreadsheetError(`File exceeds the maximum of ${maxRows} data rows`);
  return out;
}

/** Writes rows with a streaming writer; every string cell is neutralised against formula injection. */
export async function writeSheet(
  sheetName: string,
  columns: { header: string; key: string; width?: number }[],
  rows: AsyncIterable<Record<string, CellPrimitive>> | Iterable<Record<string, CellPrimitive>>,
): Promise<Buffer> {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((res, rej) => {
    sink.on('end', res);
    sink.on('error', rej);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: sink,
    useStyles: false,
    useSharedStrings: false,
  });
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  for await (const r of rows as AsyncIterable<Record<string, CellPrimitive>>) {
    const safe: Record<string, CellPrimitive> = {};
    for (const c of columns) {
      const v = r[c.key];
      safe[c.key] = typeof v === 'string' ? neutralizeFormula(v) : (v ?? null);
    }
    ws.addRow(safe).commit();
  }
  ws.commit();
  await wb.commit();
  await done;
  return Buffer.concat(chunks);
}
