// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Report Generator (PDF & CSV Rebuild)
// Pure TypeScript — no native binaries, 100% Expo Go and Android compatible.
// ==============================================================================

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Item } from '../types';
import { DEFAULT_CATEGORIES } from '../constants/categories';


import { parseFlexibleDate, formatDate } from '../utils/currency';

export { parseFlexibleDate };

/**
 * Format a date string or Date object into human-readable format.
 * Example: 2026-09-20 -> "20 Sep 2026"
 */
export function formatDisplayDate(dateInput?: string | Date | null): string {
  if (!dateInput) return '—';
  return formatDate(dateInput, 'medium') || String(dateInput);
}

/**
 * Filters canonical items by inclusive purchase date boundaries.
 * Boundary dates:
 * - fromStr: start of day (00:00:00.000)
 * - toStr: end of day (23:59:59.999)
 */
export function filterByDateRange(
  items: Item[],
  fromStr?: string | null,
  toStr?: string | null
): Item[] {
  if (!fromStr && !toStr) return items;

  const fromDate = fromStr ? parseFlexibleDate(fromStr) : null;
  const toDate = toStr ? parseFlexibleDate(toStr) : null;

  const fromMs = fromDate
    ? new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0, 0).getTime()
    : -Infinity;
  const toMs = toDate
    ? new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999).getTime()
    : Infinity;

  return items.filter((item) => {
    if (!item.purchaseDate) return false;
    const pDate = parseFlexibleDate(item.purchaseDate);
    if (!pDate) return false;
    const pMs = pDate.getTime();
    return pMs >= fromMs && pMs <= toMs;
  });
}


export function resolveCategoryName(item: Item): string {
  if (typeof item.category === 'object' && item.category?.name) {
    return item.category.name;
  }
  if (typeof item.category === 'string' && item.category.trim()) {
    return item.category.trim();
  }
  if (item.categoryId) {
    const found = DEFAULT_CATEGORIES.find((c) => c.id === item.categoryId);
    if (found) return found.name;
    return item.categoryId;
  }
  return '';
}

export function formatCurrencyAmount(amount?: number | null, currency = 'INR'): string {
  if (amount === undefined || amount === null || isNaN(Number(amount))) return '0.00';
  const num = Number(amount);
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ==============================================================================
// 3. CSV GENERATION (RFC 4180 + UTF-8 BOM)
// ==============================================================================

export const CSV_COLUMNS = [
  'ID',
  'Item Name',
  'Category',
  'Product Type',
  'Brand',
  'Model',
  'Quantity',
  'Purchase Price',
  'Currency',
  'Purchase Date',
  'Merchant',
  'Merchant Address',
  'Return Until',
  'Warranty Until',
  'Receipt Number',
  'GSTIN',
  'Tax Amount',
  'Discount',
  'Notes',
  'Created At',
  'Updated At',
] as const;

export function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  if (s === 'undefined' || s === 'null' || s === 'NaN') return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(';')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function generateCSV(
  items: Item[],
  dateFrom?: string | null,
  dateTo?: string | null
): string {
  const filtered = filterByDateRange(items, dateFrom, dateTo);
  const rows: string[] = [CSV_COLUMNS.map(csvEscape).join(',')];

  for (const item of filtered) {
    const categoryName = resolveCategoryName(item);
    const receiptNumber = item.invoiceNumber || item.receiptName || '';
    const taxAmount = item.gstTax || (item.cgst && item.sgst ? `${item.cgst} + ${item.sgst}` : '');

    const row = [
      csvEscape(item.id),
      csvEscape(item.name),
      csvEscape(categoryName),
      csvEscape(item.productType),
      csvEscape(item.brand),
      csvEscape(item.model),
      csvEscape(item.quantity ?? 1),
      csvEscape(item.purchasePrice !== undefined ? Number(item.purchasePrice) : ''),
      csvEscape(item.currency || 'INR'),
      csvEscape(item.purchaseDate),
      csvEscape(item.merchant),
      csvEscape(item.sellerAddress),
      csvEscape(item.returnUntil),
      csvEscape(item.warrantyUntil),
      csvEscape(receiptNumber),
      csvEscape(item.gstin),
      csvEscape(taxAmount),
      csvEscape(item.discount),
      csvEscape(item.notes),
      csvEscape(item.createdAt),
      csvEscape(item.updatedAt),
    ];
    rows.push(row.join(','));
  }

  // Prepend UTF-8 BOM (\uFEFF) for Excel & Google Sheets compatibility
  return '\uFEFF' + rows.join('\r\n');
}

// ==============================================================================
// 4. GENUINE MULTI-PAGE PDF GENERATOR (Pure JS, PDF 1.4 Compliant)
// ==============================================================================

const PAGE_W = 595.28; // Standard A4 width in points
const PAGE_H = 841.89; // Standard A4 height in points
const MARGIN_X = 36;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 40;
const CONTENT_W = PAGE_W - MARGIN_X * 2; // 523.28 pt

function sanitizePdfText(str: string): string {
  if (!str) return '';
  return str
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, (char) => {
      // Map common typographic characters into safe ASCII equivalents
      if (char === '\u2018' || char === '\u2019') return "'";
      if (char === '\u201C' || char === '\u201D' || char === '\u2033') return '"';
      if (char === '\u2013' || char === '\u2014') return '-';
      if (char === '\u2026') return '...';
      if (char === '\u20B9') return 'Rs.';
      return ' ';
    })
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function truncateString(str: string, maxLen: number): string {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result +=
      chars[b0 >> 2] +
      chars[((b0 & 3) << 4) | (b1 >> 4)] +
      (i + 1 < bytes.length ? chars[((b1 & 0xf) << 2) | (b2 >> 6)] : '=') +
      (i + 2 < bytes.length ? chars[b2 & 0x3f] : '=');
  }
  return result;
}

function stringToBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    b[i] = s.charCodeAt(i) & 0xff;
  }
  return b;
}

interface ItemRenderRecord {
  item: Item;
  index: number;
  category: string;
  priceFormatted: string;
  dateFormatted: string;
  hasNotes: boolean;
  notesTruncated: string;
  height: number;
}

export function generatePDFBytes(
  items: Item[],
  dateFrom?: string | null,
  dateTo?: string | null
): Uint8Array {
  const filtered = filterByDateRange(items, dateFrom, dateTo);

  const periodText =
    dateFrom || dateTo
      ? `${formatDisplayDate(dateFrom)} — ${formatDisplayDate(dateTo)}`
      : 'Entire Vault';

  let totalAmount = 0;
  for (const item of filtered) {
    totalAmount += Number(item.purchasePrice) || 0;
  }
  const totalAmountFormatted = `Rs. ${formatCurrencyAmount(totalAmount)}`;
  const generatedOn = formatDisplayDate(new Date());

  const records: ItemRenderRecord[] = filtered.map((item, idx) => {
    const category = resolveCategoryName(item) || '—';
    const priceFormatted = `${item.currency || 'INR'} ${formatCurrencyAmount(item.purchasePrice)}`;
    const dateFormatted = item.purchaseDate ? formatDisplayDate(item.purchaseDate) : '—';
    const notesRaw = (item.notes || '').replace(/[\r\n]+/g, ' ').trim();
    const hasNotes = Boolean(notesRaw);
    const notesTruncated = truncateString(notesRaw, 110);
    // Baseline card height: 74pt (3 rows + title + margins) + 16pt if notes exist
    const height = hasNotes ? 94 : 76;

    return {
      item,
      index: idx + 1,
      category,
      priceFormatted,
      dateFormatted,
      hasNotes,
      notesTruncated,
      height,
    };
  });

  // Calculate pages and paginate atomically
  const HEADER_H_PAGE_1 = 138;
  const HEADER_H_PAGE_N = 38;
  const FOOTER_RESERVE = 30;

  const pages: ItemRenderRecord[][] = [];
  let currentPageItems: ItemRenderRecord[] = [];
  let currentY = PAGE_H - MARGIN_TOP - HEADER_H_PAGE_1;

  if (records.length === 0) {
    pages.push([]);
  } else {
    for (const record of records) {
      if (currentY - record.height < MARGIN_BOTTOM + FOOTER_RESERVE && currentPageItems.length > 0) {
        pages.push(currentPageItems);
        currentPageItems = [];
        currentY = PAGE_H - MARGIN_TOP - HEADER_H_PAGE_N;
      }
      currentPageItems.push(record);
      currentY -= record.height;
    }
    if (currentPageItems.length > 0) {
      pages.push(currentPageItems);
    }
  }

  const totalPages = Math.max(1, pages.length);

  const pageStreams: string[] = [];

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const isFirstPage = pageIdx === 0;
    const pageItems = pages[pageIdx] || [];
    let stream = '';

    const drawText = (
      x: number,
      y: number,
      text: string,
      font: '/F1' | '/F2',
      size: number,
      r = 0,
      g = 0,
      b = 0
    ) => {
      const clean = sanitizePdfText(text);
      if (!clean) return;
      stream += `BT\n${font} ${size} Tf\n${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg\n1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${clean}) Tj\nET\n`;
    };

    const drawLine = (x1: number, y1: number, x2: number, y2: number, r = 0.85, g = 0.85, b = 0.85, w = 0.75) => {
      stream += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG\n${w} w\n${x1.toFixed(2)} ${y1.toFixed(2)} m\n${x2.toFixed(2)} ${y2.toFixed(2)} l\nS\n`;
    };

    const drawRect = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
      stream += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg\n${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re\nf\n`;
    };

    let yCursor = PAGE_H - MARGIN_TOP;

    if (isFirstPage) {
      drawRect(MARGIN_X, yCursor - 3, CONTENT_W, 3, 0.067, 0.314, 0.525); // #115086
      yCursor -= 14;

      drawText(MARGIN_X, yCursor - 14, 'KEEPR', '/F2', 20, 0.067, 0.314, 0.525);
      drawText(MARGIN_X + 90, yCursor - 12, 'Vault Purchase Report', '/F1', 12, 0.259, 0.278, 0.310);
      yCursor -= 28;

      drawLine(MARGIN_X, yCursor, MARGIN_X + CONTENT_W, yCursor, 0.88, 0.88, 0.86);
      yCursor -= 12;

      drawRect(MARGIN_X, yCursor - 62, CONTENT_W, 62, 0.965, 0.957, 0.941); // #F6F4F0

      const boxLeft = MARGIN_X + 14;
      const boxMid = MARGIN_X + 260;

      drawText(boxLeft, yCursor - 18, 'Report Period:', '/F2', 9.5, 0.259, 0.278, 0.310);
      drawText(boxLeft + 80, yCursor - 18, periodText, '/F1', 9.5, 0.110, 0.110, 0.090);

      drawText(boxLeft, yCursor - 36, 'Total Items:', '/F2', 9.5, 0.259, 0.278, 0.310);
      drawText(boxLeft + 80, yCursor - 36, `${filtered.length} purchases`, '/F1', 9.5, 0.110, 0.110, 0.090);

      drawText(boxLeft, yCursor - 52, 'Generated On:', '/F2', 9.5, 0.259, 0.278, 0.310);
      drawText(boxLeft + 80, yCursor - 52, generatedOn, '/F1', 9.5, 0.110, 0.110, 0.090);

      drawText(boxMid, yCursor - 24, 'Total Amount:', '/F2', 11, 0.067, 0.314, 0.525);
      drawText(boxMid, yCursor - 46, totalAmountFormatted, '/F2', 14, 0.067, 0.314, 0.525);

      yCursor -= 72;
    } else {
      drawRect(MARGIN_X, yCursor - 2, CONTENT_W, 2, 0.067, 0.314, 0.525);
      yCursor -= 12;

      drawText(MARGIN_X, yCursor - 10, 'KEEPR — Vault Purchase Report (continued)', '/F2', 10, 0.067, 0.314, 0.525);
      yCursor -= 18;
      drawLine(MARGIN_X, yCursor, MARGIN_X + CONTENT_W, yCursor, 0.88, 0.88, 0.86);
      yCursor -= 10;
    }

    if (pageItems.length === 0 && isFirstPage) {
      drawText(MARGIN_X + 20, yCursor - 40, 'No purchases found for this report period.', '/F1', 11, 0.447, 0.467, 0.506);
    } else {
      for (const record of pageItems) {
        const item = record.item;
        const itemTop = yCursor;

        drawRect(MARGIN_X, itemTop - record.height + 6, CONTENT_W, record.height - 6, 0.988, 0.984, 0.976);
        drawLine(MARGIN_X, itemTop - record.height + 6, MARGIN_X + CONTENT_W, itemTop - record.height + 6, 0.89, 0.87, 0.83, 0.5);

        const titleText = `${record.index}. ${truncateString(item.name || 'Untitled Item', 48)}`;
        drawText(MARGIN_X + 10, itemTop - 12, titleText, '/F2', 10.5, 0.110, 0.110, 0.090);
        drawText(MARGIN_X + CONTENT_W - 140, itemTop - 12, record.priceFormatted, '/F2', 10.5, 0.067, 0.314, 0.525);

        const col1 = MARGIN_X + 10;
        const col2 = MARGIN_X + 160;
        const col3 = MARGIN_X + 320;

        drawText(col1, itemTop - 27, `Category: ${record.category}`, '/F1', 8.5, 0.259, 0.278, 0.310);
        drawText(col2, itemTop - 27, `Product Type: ${item.productType || '—'}`, '/F1', 8.5, 0.259, 0.278, 0.310);
        const brandModel = [item.brand, item.model].filter(Boolean).join(' ') || '—';
        drawText(col3, itemTop - 27, `Brand / Model: ${truncateString(brandModel, 26)}`, '/F1', 8.5, 0.259, 0.278, 0.310);

        drawText(col1, itemTop - 40, `Purchased: ${record.dateFormatted}`, '/F1', 8.5, 0.259, 0.278, 0.310);
        drawText(col2, itemTop - 40, `Merchant: ${truncateString(item.merchant || '—', 25)}`, '/F1', 8.5, 0.259, 0.278, 0.310);
        drawText(col3, itemTop - 40, `Qty: ${item.quantity ?? 1}`, '/F1', 8.5, 0.259, 0.278, 0.310);

        const receiptNo = item.invoiceNumber || item.receiptName || '—';
        drawText(col1, itemTop - 53, `Receipt #: ${truncateString(receiptNo, 22)}`, '/F1', 8.5, 0.259, 0.278, 0.310);
        drawText(col2, itemTop - 53, `Warranty: ${item.warrantyUntil ? formatDisplayDate(item.warrantyUntil) : '—'}`, '/F1', 8.5, 0.259, 0.278, 0.310);
        drawText(col3, itemTop - 53, `Return: ${item.returnUntil ? formatDisplayDate(item.returnUntil) : '—'}`, '/F1', 8.5, 0.259, 0.278, 0.310);

        if (record.hasNotes) {
          drawText(col1, itemTop - 67, `Notes: ${record.notesTruncated}`, '/F1', 8, 0.447, 0.467, 0.506);
        }

        yCursor -= record.height;
      }
    }

    const footerY = MARGIN_BOTTOM - 18;
    drawLine(MARGIN_X, footerY + 12, MARGIN_X + CONTENT_W, footerY + 12, 0.88, 0.88, 0.86, 0.5);
    drawText(MARGIN_X, footerY, 'Keepr Vault Purchase Report · Confidential', '/F1', 8, 0.447, 0.467, 0.506);
    drawText(
      MARGIN_X + CONTENT_W - 60,
      footerY,
      `Page ${pageIdx + 1} of ${totalPages}`,
      '/F1',
      8,
      0.447,
      0.467,
      0.506
    );

    pageStreams.push(stream);
  }

  let finalPdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const finalOffsets: Record<number, number> = {};

  function addObj(id: number, content: string): void {
    finalOffsets[id] = finalPdf.length;
    finalPdf += `${id} 0 obj\n${content}\nendobj\n`;
  }

  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');

  const pageObjectIds = Array.from({ length: totalPages }, (_, i) => `${6 + i * 2} 0 R`).join(' ');
  addObj(2, `<< /Type /Pages /Kids [${pageObjectIds}] /Count ${totalPages} >>`);

  addObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  addObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  for (let pi = 0; pi < totalPages; pi++) {
    const streamContent = pageStreams[pi] || '';
    const streamObjId = 5 + pi * 2;
    const pageObjId = 6 + pi * 2;

    addObj(streamObjId, `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`);
    addObj(
      pageObjId,
      `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] ` +
        `/Contents ${streamObjId} 0 R ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
    );
  }

  // Cross-reference Table (xref)
  const xrefOffset = finalPdf.length;
  const totalObjCount = 4 + totalPages * 2;

  finalPdf += `xref\n0 ${totalObjCount + 1}\n`;
  finalPdf += '0000000000 65535 f \n';
  for (let i = 1; i <= totalObjCount; i++) {
    finalPdf += String(finalOffsets[i] ?? 0).padStart(10, '0') + ' 00000 n \n';
  }

  finalPdf += `trailer\n<< /Size ${totalObjCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return stringToBytes(finalPdf);
}


export async function writeAndShareFile(
  content: string | Uint8Array,
  filename: string,
  mimeType: 'application/pdf' | 'text/csv'
): Promise<{ uri: string; size: number }> {
  const targetDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
  if (!targetDir) {
    throw new Error('Local file storage directory is not accessible.');
  }

  const normalizedDir = targetDir.endsWith('/') ? targetDir : `${targetDir}/`;
  const uri = normalizedDir + filename;

  if (content instanceof Uint8Array) {
    const base64 = uint8ToBase64(content);
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else {
    await FileSystem.writeAsStringAsync(uri, content, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  }

  // 2. Read back & verify file existence and size
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || (info.size ?? 0) <= 0) {
    throw new Error(`File creation verification failed for ${filename}`);
  }

  // 3. Content-specific validation
  if (mimeType === 'text/csv') {
    const readBack = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (!readBack.startsWith('\uFEFF') || !readBack.includes('Item Name')) {
      throw new Error('CSV verification failed: missing header or UTF-8 BOM.');
    }
  } else if (mimeType === 'application/pdf') {
    const readBack = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // In base64, '%PDF-' encodes to 'JVBERi0'
    if (!readBack.startsWith('JVBERi0')) {
      throw new Error('PDF verification failed: missing %PDF- header.');
    }
  }

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('Sharing is not available on this device.');
  }

  await Sharing.shareAsync(uri, {
    mimeType,
    dialogTitle: 'Share Keepr Vault Report',
    UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.comma-separated-values-text',
  });

  return { uri, size: info.size ?? 0 };
}
