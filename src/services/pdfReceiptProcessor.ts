import {
  ValidatedLineItem,
  ValidatedReceiptExtraction,
  validateExtractedReceiptPayload,
} from '../schemas/receiptExtractionSchema';

export const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB ceiling
export const DEFAULT_MAX_PDF_PAGES = 10;
export const TEXT_DENSE_MIN_CHARS_PER_PAGE = 45;

export type PdfDocumentType = 'text' | 'scanned' | 'mixed' | 'empty';

export type PdfValidationErrorCode =
  | 'NOT_A_PDF'
  | 'EMPTY_PDF'
  | 'CORRUPTED_PDF'
  | 'PASSWORD_PROTECTED_PDF'
  | 'PDF_TOO_LARGE'
  | 'UNREADABLE_PDF';

export interface PdfValidationResult {
  valid: boolean;
  errorCode?: PdfValidationErrorCode;
  errorMessage?: string;
  sizeBytes: number;
  pdfVersion?: string | null;
  isEncrypted: boolean;
  estimatedPageCount: number;
  hasTextLayer: boolean;
  hasImageObjects: boolean;
  pdfType: PdfDocumentType;
}

export interface PdfPageTextInfo {
  pageNumber: number;
  text: string;
  charCount: number;
  hasImages: boolean;
  isScannedCandidate: boolean;
}

export interface ConsolidatedMultiPageResult {
  consolidated: ValidatedReceiptExtraction;
  processedPages: number;
  deduplicatedItemCount: number;
  warnings: string[];
}

/**
 * Decode a base64 string (or data URI) into a raw Uint8Array in both browser/RN and Node runtimes.
 */
export function base64ToUint8Array(base64Input: string): Uint8Array {
  const clean = (base64Input || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!clean) return new Uint8Array(0);

  if (typeof globalThis.Buffer !== 'undefined') {
    return new Uint8Array(globalThis.Buffer.from(clean, 'base64'));
  }

  const binaryStr = globalThis.atob(clean);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert a byte array slice to ISO-8859-1 / Latin-1 string without UTF-8 replacement distortion.
 */
export function bytesToLatin1String(bytes: Uint8Array, maxBytes?: number): string {
  const limit = maxBytes ? Math.min(bytes.length, maxBytes) : bytes.length;
  const chunkSize = 0x8000;
  let result = '';
  for (let i = 0; i < limit; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, limit));
    result += String.fromCharCode(...slice);
  }
  return result;
}

/**
 * Check if raw bytes contain a valid %PDF- magic header within the first 1024 bytes.
 */
export function hasPdfMagicHeader(bytes: Uint8Array): { found: boolean; version: string | null } {
  if (!bytes || bytes.length < 5) {
    return { found: false, version: null };
  }
  const head = bytesToLatin1String(bytes, 1024);
  const idx = head.indexOf('%PDF-');
  if (idx === -1) {
    return { found: false, version: null };
  }
  const versionMatch = head.slice(idx).match(/^%PDF-(\d\.\d)/);
  return {
    found: true,
    version: versionMatch ? versionMatch[1] : null,
  };
}

/**
 * Validate raw PDF bytes for magic header, size, encryption, truncation, and structural integrity.
 */
export function validatePdfBytes(
  bytes: Uint8Array,
  options?: {
    declaredSizeBytes?: number;
    maxSizeBytes?: number;
  }
): PdfValidationResult {
  const sizeBytes = options?.declaredSizeBytes ?? bytes.length;
  const maxSize = options?.maxSizeBytes ?? MAX_PDF_SIZE_BYTES;

  if (!bytes || bytes.length === 0 || sizeBytes === 0) {
    return {
      valid: false,
      errorCode: 'EMPTY_PDF',
      errorMessage: 'The selected PDF file is empty (0 bytes). Please choose a valid PDF invoice.',
      sizeBytes: 0,
      pdfVersion: null,
      isEncrypted: false,
      estimatedPageCount: 0,
      hasTextLayer: false,
      hasImageObjects: false,
      pdfType: 'empty',
    };
  }

  if (bytes.length > maxSize || sizeBytes > maxSize) {
    return {
      valid: false,
      errorCode: 'PDF_TOO_LARGE',
      errorMessage: `This PDF exceeds the ${Math.round(maxSize / (1024 * 1024))} MB size limit. Please upload a smaller PDF.`,
      sizeBytes,
      pdfVersion: null,
      isEncrypted: false,
      estimatedPageCount: 0,
      hasTextLayer: false,
      hasImageObjects: false,
      pdfType: 'empty',
    };
  }

  const header = hasPdfMagicHeader(bytes);
  if (!header.found) {
    return {
      valid: false,
      errorCode: 'NOT_A_PDF',
      errorMessage: 'The selected file does not have a valid PDF signature (%PDF-). Please select a real PDF file.',
      sizeBytes,
      pdfVersion: null,
      isEncrypted: false,
      estimatedPageCount: 0,
      hasTextLayer: false,
      hasImageObjects: false,
      pdfType: 'empty',
    };
  }

  const rawText = bytesToLatin1String(bytes);

  // Structural integrity: a valid PDF requires objects or cross-reference / trailer / %%EOF markers
  const hasObjects = /\d+\s+\d+\s+obj\b/.test(rawText);
  const hasStructuralEnd =
    rawText.includes('%%EOF') || rawText.includes('trailer') || rawText.includes('/Root');
  if (bytes.length < 64 || !hasObjects || !hasStructuralEnd) {
    return {
      valid: false,
      errorCode: 'CORRUPTED_PDF',
      errorMessage: 'This PDF file appears corrupted or incomplete and cannot be processed.',
      sizeBytes,
      pdfVersion: header.version,
      isEncrypted: false,
      estimatedPageCount: 0,
      hasTextLayer: false,
      hasImageObjects: false,
      pdfType: 'empty',
    };
  }

  // Detect dictionary /Encrypt reference outside parenthesized text strings
  const isEncrypted =
    /\/Encrypt\s+(\d+\s+\d+\s+R|<<)/.test(rawText) ||
    /\/Filter\s*\/Standard\b/.test(rawText);
  if (isEncrypted) {
    return {
      valid: false,
      errorCode: 'PASSWORD_PROTECTED_PDF',
      errorMessage:
        'This PDF is password-protected or encrypted. Please remove the password or upload an unlocked PDF.',
      sizeBytes,
      pdfVersion: header.version,
      isEncrypted: true,
      estimatedPageCount: 0,
      hasTextLayer: false,
      hasImageObjects: false,
      pdfType: 'empty',
    };
  }

  const inspection = inspectPdfBinaryStructure(bytes, rawText);

  return {
    valid: true,
    sizeBytes,
    pdfVersion: header.version,
    isEncrypted: false,
    estimatedPageCount: inspection.estimatedPageCount,
    hasTextLayer: inspection.hasTextLayer,
    hasImageObjects: inspection.hasImageObjects,
    pdfType: inspection.pdfType,
  };
}

/**
 * Inspect PDF binary structure to estimate page count, text-layer richness, image XObjects, and type.
 */
export function inspectPdfBinaryStructure(
  bytes: Uint8Array,
  preDecodedLatin1?: string
): {
  estimatedPageCount: number;
  hasTextLayer: boolean;
  hasImageObjects: boolean;
  hasFlateStreams: boolean;
  extractedText: string;
  pdfType: PdfDocumentType;
} {
  const raw = preDecodedLatin1 ?? bytesToLatin1String(bytes);

  // Count page leaf objects (/Type /Page but NOT /Type /Pages)
  const pageMatches = raw.match(/\/Type\s*\/Page(?![sA-Za-z0-9_])/g);
  const countHints = raw.match(/\/Count\s+(\d+)/g) || [];
  let maxCatalogCount = 0;
  for (const hint of countHints) {
    const n = Number(hint.replace(/\/Count\s+/, ''));
    if (Number.isFinite(n) && n > maxCatalogCount && n < 2000) {
      maxCatalogCount = n;
    }
  }
  const estimatedPageCount = Math.max(pageMatches ? pageMatches.length : 0, maxCatalogCount, 1);

  const hasImageObjects =
    /\/Subtype\s*\/Image\b/.test(raw) || /\/XObject\b/.test(raw);
  const hasFlateStreams = /\/Filter\s*\/FlateDecode\b/.test(raw) || /\/FlateDecode\b/.test(raw);

  const extractedText = extractSearchablePdfTextFromBytes(bytes, raw);
  const meaningfulChars = extractedText.replace(/\s+/g, '').length;
  const hasTextLayer = meaningfulChars >= TEXT_DENSE_MIN_CHARS_PER_PAGE;

  let pdfType: PdfDocumentType = 'empty';
  if (hasTextLayer && !hasImageObjects) {
    pdfType = 'text';
  } else if (hasTextLayer && hasImageObjects) {
    // Text layer might cover all pages or only some pages (mixed), so classify mixed if images exist alongside text,
    // unless very few images relative to dense text (e.g. a small merchant logo)
    const imageCount = (raw.match(/\/Subtype\s*\/Image\b/g) || []).length;
    pdfType = imageCount > estimatedPageCount && meaningfulChars < estimatedPageCount * 220 ? 'mixed' : 'text';
  } else if (hasImageObjects || hasFlateStreams) {
    pdfType = 'scanned';
  } else {
    pdfType = 'empty';
  }

  return {
    estimatedPageCount,
    hasTextLayer,
    hasImageObjects,
    hasFlateStreams,
    extractedText,
    pdfType,
  };
}

/**
 * Decode PDF literal string escape sequences and UTF-16BE BOM when present.
 */
function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === 'n') {
        out += '\n';
        i++;
      } else if (next === 'r') {
        out += '\r';
        i++;
      } else if (next === 't') {
        out += '\t';
        i++;
      } else if (next === 'b' || next === 'f') {
        i++;
      } else if (next === '(' || next === ')' || next === '\\') {
        out += next;
        i++;
      } else if (/[0-7]/.test(next)) {
        const oct = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] || '';
        out += String.fromCharCode(parseInt(oct, 8));
        i += oct.length;
      } else {
        out += next;
        i++;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Decode PDF hex string <FEFF...> (UTF-16BE) or standard single-byte hex string.
 */
function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (!clean) return '';
  const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
  if (padded.toUpperCase().startsWith('FEFF') && padded.length >= 8) {
    let out = '';
    for (let i = 4; i + 3 < padded.length; i += 4) {
      const code = parseInt(padded.slice(i, i + 4), 16);
      if (code >= 32 || code === 10 || code === 9) {
        out += String.fromCharCode(code);
      }
    }
    return out;
  }
  let out = '';
  for (let i = 0; i + 1 < padded.length; i += 2) {
    const code = parseInt(padded.slice(i, i + 2), 16);
    if (code >= 32 && code <= 126) {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

/**
 * Parse PDF BT..ET content operators from one or more decoded PDF content streams while preserving reading order & newlines.
 */
export function extractTextOperatorsFromStreamContent(streamContent: string): string {
  const lines: string[] = [];
  const btBlocks = streamContent.match(/BT[\s\S]*?ET/g) || [];
  const sources = btBlocks.length > 0 ? btBlocks : [streamContent];

  for (const block of sources) {
    let currentLine = '';
    // Match TJ arrays, literal Tj/', and newline positioning ops Td/TD/T*
    const tokenRegex =
      /\[([^\]]+)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*(?:Tj|')|<([0-9A-Fa-f\s]+)>\s*Tj|\b(?:Td|TD|T\*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(block)) !== null) {
      const full = match[0];
      if (match[1] !== undefined) {
        const inner = match[1];
        const partRegex = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>/g;
        let part: RegExpExecArray | null;
        while ((part = partRegex.exec(inner)) !== null) {
          if (part[1] !== undefined) currentLine += decodePdfLiteralString(part[1]);
          else if (part[2] !== undefined) currentLine += decodePdfHexString(part[2]);
        }
      } else if (match[2] !== undefined) {
        currentLine += decodePdfLiteralString(match[2]);
      } else if (match[3] !== undefined) {
        currentLine += decodePdfHexString(match[3]);
      } else if (full === 'Td' || full === 'TD' || full === 'T*') {
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
          currentLine = '';
        }
      }
    }
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Attempt optional zlib decompression for FlateDecode PDF streams when Node's built-in zlib module is available
 * (never statically bundled for React Native so Metro bundles cleanly).
 */
function tryInflateFlateStreamsInNode(rawLatin1: string): string[] {
  const inflated: string[] = [];
  // Detect Node runtime dynamically without giving Metro bundler a static require target
  const isNode =
    typeof process !== 'undefined' &&
    Boolean(process.versions && process.versions.node);
  if (!isNode) return inflated;

  let zlibModule: { inflateSync?: (buf: Uint8Array) => Uint8Array } | null = null;
  try {
    const req = (0, eval)('require') as (id: string) => { inflateSync?: (buf: Uint8Array) => Uint8Array };
    zlibModule = req('node:zlib');
  } catch {
    return inflated;
  }
  if (!zlibModule?.inflateSync) return inflated;

  const streamRegex = /<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(rawLatin1)) !== null) {
    const dict = match[1] || '';
    const body = match[2] || '';
    if (!body) continue;
    if (/\/Subtype\s*\/Image\b/.test(dict)) continue;

    if (/\/FlateDecode\b/.test(dict)) {
      try {
        const compressed = new Uint8Array(body.length);
        for (let i = 0; i < body.length; i++) {
          compressed[i] = body.charCodeAt(i) & 0xff;
        }
        const decompressed = zlibModule.inflateSync(compressed);
        const decoded = bytesToLatin1String(decompressed);
        if (decoded.includes('BT') || decoded.includes('Tj') || decoded.includes('TJ')) {
          inflated.push(decoded);
        }
      } catch {
        // Ignore streams with non-standard predictors or trailing bytes
      }
    } else if (body.includes('BT') || body.includes('Tj') || body.includes('TJ')) {
      inflated.push(body);
    }
  }

  return inflated;
}

/**
 * Extract searchable text from PDF bytes (uncompressed streams universally + FlateDecode streams in Node).
 * On mobile devices, the PDF.js WebView processor handles complex CMaps and compressed fonts; this helper
 * provides fast pre-inspection, fallback extraction, and full Node-based unit verification.
 */
export function extractSearchablePdfTextFromBytes(
  bytes: Uint8Array,
  preDecodedLatin1?: string
): string {
  const raw = preDecodedLatin1 ?? bytesToLatin1String(bytes);
  const inflatedStreams = tryInflateFlateStreamsInNode(raw);

  const chunks: string[] = [];
  for (const streamText of inflatedStreams) {
    const parsed = extractTextOperatorsFromStreamContent(streamText);
    if (parsed) chunks.push(parsed);
  }

  if (chunks.length === 0) {
    const uncompressed = extractTextOperatorsFromStreamContent(raw);
    if (uncompressed) chunks.push(uncompressed);
  }

  const combined = chunks.join('\n\n').trim();
  // Filter out pure binary noise
  return combined.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F\u20B9]/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * Classify a PDF from per-page PDF.js extraction statistics.
 */
export function classifyPdfPages(pages: PdfPageTextInfo[]): PdfDocumentType {
  if (!pages || pages.length === 0) return 'empty';
  let textRichPages = 0;
  let scannedCandidatePages = 0;

  for (const p of pages) {
    const meaningfulChars = (p.text || '').replace(/\s+/g, '').length;
    if (meaningfulChars >= TEXT_DENSE_MIN_CHARS_PER_PAGE) {
      textRichPages++;
    } else if (p.hasImages || p.isScannedCandidate || meaningfulChars < TEXT_DENSE_MIN_CHARS_PER_PAGE) {
      scannedCandidatePages++;
    }
  }

  if (textRichPages === pages.length) return 'text';
  if (textRichPages === 0 && scannedCandidatePages > 0) return 'scanned';
  if (textRichPages > 0 && scannedCandidatePages > 0) return 'mixed';
  return 'empty';
}

/**
 * Deduplicate and consolidate line items and financial totals across multiple pages of a single PDF invoice.
 * Ensures carry-forward subtotals or repeated headers on Page 1..N never double-count the grand total.
 */
export function consolidateMultiPageExtractions(
  pageExtractions: Array<{
    pageNumber: number;
    extraction: Record<string, unknown>;
  }>
): ConsolidatedMultiPageResult {
  const sorted = [...pageExtractions].sort((a, b) => a.pageNumber - b.pageNumber);
  const warnings: string[] = [];

  if (sorted.length === 0) {
    const empty = validateExtractedReceiptPayload({});
    return {
      consolidated: empty.data,
      processedPages: 0,
      deduplicatedItemCount: 0,
      warnings: ['No page extractions available to consolidate.'],
    };
  }

  if (sorted.length === 1) {
    const single = validateExtractedReceiptPayload(sorted[0].extraction);
    return {
      consolidated: single.data,
      processedPages: 1,
      deduplicatedItemCount: single.data.items.length,
      warnings: single.warnings,
    };
  }

  const validatedPages = sorted.map((entry) => ({
    pageNumber: entry.pageNumber,
    ...validateExtractedReceiptPayload(entry.extraction).data,
  }));

  // 1. Consolidate header fields (prefer first clear non-null occurrence)
  const pickFirst = <T>(getter: (p: ValidatedReceiptExtraction) => T | null | undefined): T | null => {
    for (const p of validatedPages) {
      const v = getter(p);
      if (v !== null && v !== undefined && String(v).trim() !== '') return v;
    }
    return null;
  };

  // 2. Consolidate summary fields (prefer explicit summary page or last page with non-null grand summary)
  const pickSummaryLast = <T>(
    getter: (p: ValidatedReceiptExtraction) => T | null | undefined
  ): T | null => {
    for (let i = validatedPages.length - 1; i >= 0; i--) {
      const v = getter(validatedPages[i]);
      if (v !== null && v !== undefined && String(v).trim() !== '') return v;
    }
    return null;
  };

  // 3. Deduplicate line items across pages while preserving original order
  const seenItemKeys = new Set<string>();
  const consolidatedItems: ValidatedLineItem[] = [];

  for (const page of validatedPages) {
    const pageItems = page.items || [];
    for (const item of pageItems) {
      const normName = (item.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!normName) continue;
      // Exclude synthetic subtotal/total rows accidentally parsed as line items
      if (/^(sub\s*total|total|grand\s*total|tax|gst|cgst|sgst|igst|discount|amount\s*paid)$/i.test(normName)) {
        continue;
      }
      const key = `${normName}::${item.quantity ?? ''}::${item.unitPrice ?? ''}::${item.lineTotal ?? ''}`;
      if (seenItemKeys.has(key)) {
        continue;
      }
      seenItemKeys.add(key);
      consolidatedItems.push({
        ...item,
        pageNumber: item.pageNumber ?? page.pageNumber,
      });
    }
  }

  // Fallback: if no `items` arrays were populated across pages, promote unique primary itemName entries
  if (consolidatedItems.length === 0) {
    for (const page of validatedPages) {
      if (page.itemName) {
        const norm = page.itemName.trim().toLowerCase();
        const key = `${norm}::${page.quantity ?? ''}::${page.unitPrice ?? ''}`;
        if (!seenItemKeys.has(key)) {
          seenItemKeys.add(key);
          consolidatedItems.push({
            name: page.itemName,
            description: page.itemDescription ?? null,
            brand: page.brand ?? null,
            model: page.model ?? null,
            quantity: page.quantity ?? null,
            unitPrice: page.unitPrice ?? null,
            lineTotal:
              page.quantity != null && page.unitPrice != null
                ? Number((page.quantity * page.unitPrice).toFixed(2))
                : page.subtotal ?? null,
            category: page.suggestedCategory ?? null,
            serialNumber: page.serialNumber ?? null,
            warrantyPeriodMonths: page.warrantyPeriodMonths ?? null,
            pageNumber: page.pageNumber,
          });
        }
      }
    }
  }

  // Never sum finalAmountPaid across pages — invoices carry totals forward onto the final summary page.
  const finalAmountPaid = pickSummaryLast((p) => p.finalAmountPaid);
  const subtotalFromSummary = pickSummaryLast((p) => p.subtotal);
  const discountFromSummary = pickSummaryLast((p) => p.discount);
  const taxableFromSummary = pickSummaryLast((p) => p.taxableAmount);
  const gstPercentage = pickSummaryLast((p) => p.gstPercentage);
  const cgst = pickSummaryLast((p) => p.cgst);
  const sgst = pickSummaryLast((p) => p.sgst);
  const igst = pickSummaryLast((p) => p.igst);
  const totalGst = pickSummaryLast((p) => p.totalGst);

  const distinctPageTotals = new Set(
    validatedPages
      .map((p) => p.finalAmountPaid)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
  );
  if (distinctPageTotals.size > 1) {
    warnings.push(
      `Multiple page totals detected across ${validatedPages.length} pages; selected summary page total (${finalAmountPaid}) to avoid double counting.`
    );
  }

  const mergedRaw: Record<string, unknown> = {
    storeName: pickFirst((p) => p.storeName),
    merchantName: pickFirst((p) => p.merchantName),
    storeAddress: pickFirst((p) => p.storeAddress),
    storePhone: pickFirst((p) => p.storePhone),
    gstin: pickFirst((p) => p.gstin),
    invoiceNumber: pickFirst((p) => p.invoiceNumber),
    invoiceDate: pickFirst((p) => p.invoiceDate),
    purchaseDate: pickFirst((p) => p.purchaseDate),
    itemName: consolidatedItems[0]?.name ?? pickFirst((p) => p.itemName),
    itemDescription:
      consolidatedItems[0]?.description ?? pickFirst((p) => p.itemDescription),
    brand: consolidatedItems[0]?.brand ?? pickFirst((p) => p.brand),
    model: consolidatedItems[0]?.model ?? pickFirst((p) => p.model),
    serialNumber: consolidatedItems[0]?.serialNumber ?? pickFirst((p) => p.serialNumber),
    quantity: consolidatedItems[0]?.quantity ?? pickFirst((p) => p.quantity),
    unitPrice: consolidatedItems[0]?.unitPrice ?? pickFirst((p) => p.unitPrice),
    suggestedCategory: pickFirst((p) => p.suggestedCategory),
    category: pickFirst((p) => p.category),
    warrantyPeriodMonths: pickFirst((p) => p.warrantyPeriodMonths),
    items: consolidatedItems,
    subtotal: subtotalFromSummary,
    discount: discountFromSummary,
    taxableAmount: taxableFromSummary,
    gstPercentage,
    cgst,
    sgst,
    igst,
    totalGst,
    shippingCost: pickSummaryLast((p) => p.shippingCost),
    finalAmountPaid,
    paymentMethod: pickSummaryLast((p) => p.paymentMethod),
    currency: pickFirst((p) => p.currency),
    documentType: pickFirst((p) => p.documentType),
    confidence: Math.min(
      ...validatedPages
        .map((p) => p.confidence)
        .filter((c): c is number => typeof c === 'number' && Number.isFinite(c)),
      0.9
    ),
    notes: validatedPages
      .map((p) => p.notes)
      .filter((n): n is string => Boolean(n))
      .join(' | ') || null,
    warnings,
  };

  const finalValidated = validateExtractedReceiptPayload(mergedRaw);
  return {
    consolidated: finalValidated.data,
    processedPages: validatedPages.length,
    deduplicatedItemCount: consolidatedItems.length,
    warnings: finalValidated.warnings,
  };
}
