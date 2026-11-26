import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  validateExtractedReceiptPayload,
  normalizeDateString,
} from '../src/schemas/receiptExtractionSchema';
import {
  base64ToUint8Array,
  classifyPdfPages,
  consolidateMultiPageExtractions,
  extractSearchablePdfTextFromBytes,
  MAX_PDF_SIZE_BYTES,
  validatePdfBytes,
} from '../src/services/pdfReceiptProcessor';
import {
  detectFormatFromBase64Prefix,
  detectFormatFromBytes,
  detectFormatFromUriOrName,
} from '../src/utils/imageIntegrity';

const ROOT = path.resolve(__dirname, '..');

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function runTest(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error('   ', err?.stack || err?.message || err);
    process.exitCode = 1;
  }
}

/**
 * Helper to construct minimal valid binary PDF buffers for Node tests.
 */
function buildMockPdfBytes(opts: {
  streams?: string[];
  compress?: boolean;
  includeEncrypt?: boolean;
  includeImageObject?: boolean;
  pageCount?: number;
}): Uint8Array {
  const pageCount = opts.pageCount ?? 1;
  const parts: string[] = ['%PDF-1.4\n'];
  parts.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  parts.push(`2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [3 0 R] >>\nendobj\n`);
  if (opts.includeEncrypt) {
    parts.push('9 0 obj\n<< /Filter /Standard /V 2 /R 3 /O (abc) /U (def) >>\nendobj\n');
    parts.push('10 0 obj\n<< /Encrypt 9 0 R >>\nendobj\n');
  }
  if (opts.includeImageObject) {
    parts.push('4 0 obj\n<< /Type /XObject /Subtype /Image /Width 1200 /Height 1600 >>\nstream\nFAKEIMAGEDATA\nendstream\nendobj\n');
  }
  const pageRefs: string[] = [];
  for (let p = 0; p < pageCount; p++) {
    parts.push(`${20 + p} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`);
    pageRefs.push(`${20 + p} 0 R`);
  }

  let binary = Buffer.from(parts.join(''), 'latin1');
  const streamBuffers: Buffer[] = [];
  for (const s of opts.streams || []) {
    if (opts.compress) {
      const compressed = zlib.deflateSync(Buffer.from(s, 'latin1'));
      const header = Buffer.from(
        `30 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
        'latin1'
      );
      const footer = Buffer.from('\nendstream\nendobj\n', 'latin1');
      streamBuffers.push(header, compressed, footer);
    } else {
      streamBuffers.push(
        Buffer.from(
          `30 0 obj\n<< /Length ${s.length} >>\nstream\n${s}\nendstream\nendobj\n`,
          'latin1'
        )
      );
    }
  }

  const trailer = Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
  return new Uint8Array(Buffer.concat([binary, ...streamBuffers, trailer]));
}

console.log('================================================================');
console.log(' KEEPR: CRITICAL PDF RECEIPT UPLOAD & EXTRACTION TEST SUITE');
console.log('================================================================\n');

console.log('1. Picker Separation & UI Flow Contracts (Issue 2)');

runTest('AddReceiptModal separates Gallery Upload Image and Upload PDF handlers', () => {
  const src = readProjectFile('src/components/scanner/AddReceiptModal.tsx');
  assert(src.includes('onChooseFromGallery'), 'Missing onChooseFromGallery prop');
  assert(src.includes('onUploadPdf'), 'Missing onUploadPdf prop');
  assert(src.includes('Choose from Gallery'), 'Preserve Choose from Gallery option');
  assert(src.includes('Upload PDF'), 'Missing dedicated Upload PDF option');
});

runTest('Home screen wires Upload PDF exclusively to DocumentPicker with application/pdf', () => {
  const src = readProjectFile('app/(tabs)/index.tsx');
  assert(src.includes('handleModalUploadPdf'), 'Missing handleModalUploadPdf');
  assert(src.includes("type: 'application/pdf'"), 'Must filter DocumentPicker strictly to application/pdf');
  assert(!src.includes("type: ['application/pdf', 'image/*']"), 'Must NOT mix image/* into PDF DocumentPicker');
  assert(src.includes("mode: 'pdf'"), 'Must navigate to /scan-receipt with mode=pdf');
});

runTest('Add Purchase screen keeps Gallery card, adds Upload PDF CTA, and fixes PDF DocumentPicker', () => {
  const src = readProjectFile('app/(tabs)/add.tsx');
  assert(src.includes('CHOOSE FROM GALLERY'), 'Must preserve CHOOSE FROM GALLERY regression hook');
  assert(src.includes('handleChooseFromGalleryEntry'), 'Must preserve handleChooseFromGalleryEntry');
  assert(src.includes('handleUploadPdfEntry'), 'Must provide separate handleUploadPdfEntry');
  assert(src.includes('UPLOAD PDF'), 'Must show UPLOAD PDF button');
  assert(src.includes("type: 'application/pdf'"), 'handlePickReceiptDocument must request application/pdf only');
  assert(!src.includes("type: ['application/pdf', 'image/*']"), 'Mixed PDF+image picker filter must be removed');
  assert(src.includes('UniversalPdfViewer'), 'Add screen must preview PDFs with UniversalPdfViewer');
});

runTest('Document Add and Service Add enforce strict application/pdf DocumentPicker filter', () => {
  const docAdd = readProjectFile('app/document/add.tsx');
  const srvAdd = readProjectFile('app/service/add.tsx');
  assert(!docAdd.includes("type: ['application/pdf', 'image/*']"), 'document/add must not mix image/*');
  assert(docAdd.includes("type: 'application/pdf'"), 'document/add must use strict application/pdf');
  assert(!srvAdd.includes("type: ['application/pdf', 'image/*']"), 'service/add must not mix image/*');
  assert(srvAdd.includes("type: 'application/pdf'"), 'service/add must use strict application/pdf');
});

runTest('Scan Receipt & Item Detail screens support PDF preview/viewer cleanly without HighResImageViewer crash', () => {
  const scanSrc = readProjectFile('app/scan-receipt/index.tsx');
  const itemSrc = readProjectFile('app/item/[id].tsx');
  const camSrc = readProjectFile('src/components/scanner/DirectCameraScanner.tsx');
  assert(scanSrc.includes('handleChoosePdf'), 'scan-receipt must define handleChoosePdf');
  assert(scanSrc.includes('<PdfProcessorWebView'), 'scan-receipt must mount PdfProcessorWebView');
  assert(scanSrc.includes('<UniversalPdfViewer'), 'scan-receipt must render UniversalPdfViewer for PDFs');
  assert(scanSrc.includes('isReceiptPdfAsset'), 'scan-receipt must conditionally render PDF cards instead of <Image>');
  assert(camSrc.includes('onOpenPdf'), 'DirectCameraScanner must expose optional PDF trigger');
  assert(itemSrc.includes('<UniversalPdfViewer'), 'Item detail screen must open PDFs in UniversalPdfViewer');
});

console.log('\n2. Magic Byte Detection & Stabilization Service Safeguards');

runTest('Binary magic bytes & base64 signatures identify PDF even when named .jpg', () => {
  const pdfMagic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  assert.strictEqual(detectFormatFromBytes(pdfMagic).mimeType, 'application/pdf');
  assert.strictEqual(detectFormatFromBytes(pdfMagic).extension, '.pdf');

  const pdfB64 = Buffer.from('%PDF-1.4\n1 0 obj').toString('base64');
  assert.strictEqual(detectFormatFromBase64Prefix(pdfB64)?.mimeType, 'application/pdf');
  assert.strictEqual(detectFormatFromUriOrName('content://media/invoice.pdf').mimeType, 'application/pdf');

  const fileServiceSrc = readProjectFile('src/services/receiptFileService.ts');
  assert(fileServiceSrc.includes('sniffLocalFileFormat'), 'stabilizeReceiptImage must inspect actual magic bytes');
  assert(fileServiceSrc.includes('resolveLikelyPdf'), 'prepareImageForAnalysis must detect PDFs before Image.getSize');
});

console.log('\n3. PDF Validation, Type Detection & Edge Cases (Issue 1)');

runTest('Rejects 0-byte empty PDF, non-PDF bytes, truncated corrupted PDF, oversized PDF, and encrypted PDF', () => {
  const emptyRes = validatePdfBytes(new Uint8Array(0));
  assert.strictEqual(emptyRes.valid, false);
  assert.strictEqual(emptyRes.errorCode, 'EMPTY_PDF');

  const notPdf = validatePdfBytes(new Uint8Array(Buffer.from('<html>not a pdf</html>', 'utf8')));
  assert.strictEqual(notPdf.valid, false);
  assert.strictEqual(notPdf.errorCode, 'NOT_A_PDF');

  const corrupted = validatePdfBytes(new Uint8Array(Buffer.from('%PDF-1.4\nbroken_truncated', 'utf8')));
  assert.strictEqual(corrupted.valid, false);
  assert.strictEqual(corrupted.errorCode, 'CORRUPTED_PDF');

  const encryptedBytes = buildMockPdfBytes({
    streams: ['BT (Secret) Tj ET'],
    includeEncrypt: true,
  });
  const encRes = validatePdfBytes(encryptedBytes);
  assert.strictEqual(encRes.valid, false);
  assert.strictEqual(encRes.errorCode, 'PASSWORD_PROTECTED_PDF');

  const tooLarge = validatePdfBytes(new Uint8Array(64), { declaredSizeBytes: MAX_PDF_SIZE_BYTES + 1024 });
  assert.strictEqual(tooLarge.valid, false);
  assert.strictEqual(tooLarge.errorCode, 'PDF_TOO_LARGE');
});

runTest('Extracts searchable text layer from uncompressed Type A PDF preserving lines', () => {
  const stream =
    'BT (Croma Electronics Store) Tj 0 -14 Td (GSTIN: 27AABCI1234F1Z5) Tj 0 -14 Td ' +
    '(Invoice No: INV-2026-8812) Tj 0 -14 Td (Sony WH-1000XM5 Headphones) Tj 0 -14 Td ' +
    '(Taxable Value: 25423.73 CGST 9%: 2288.14 SGST 9%: 2288.14 Grand Total: 30000.00) Tj ET';
  const bytes = buildMockPdfBytes({ streams: [stream] });
  const val = validatePdfBytes(bytes);
  assert.strictEqual(val.valid, true);
  assert.strictEqual(val.pdfType, 'text');
  assert.strictEqual(val.hasTextLayer, true);

  const extracted = extractSearchablePdfTextFromBytes(bytes);
  assert(extracted.includes('Croma Electronics Store'), 'Should extract merchant name');
  assert(extracted.includes('INV-2026-8812'), 'Should extract invoice number');
  assert(extracted.includes('Sony WH-1000XM5'), 'Should extract item name');
  assert(extracted.includes('30000.00'), 'Should extract grand total');
});

runTest('Inflates FlateDecode compressed PDF content stream cleanly in Node runtime', () => {
  const compressedStream =
    'BT (Amazon Seller Services Pvt Ltd) Tj 0 -12 Td (Invoice Date: 15-04-2026) Tj 0 -12 Td ' +
    '(Order Date: 14-04-2026) Tj 0 -12 Td (Apple MacBook Air M4) Tj 0 -12 Td ' +
    '(Paid via HDFC Credit Card Total 114900) Tj ET';
  const bytes = buildMockPdfBytes({ streams: [compressedStream], compress: true });
  const val = validatePdfBytes(bytes);
  assert.strictEqual(val.valid, true);
  assert.strictEqual(val.pdfType, 'text');

  const extracted = extractSearchablePdfTextFromBytes(bytes);
  assert(extracted.includes('Amazon Seller Services'), 'Should decompress FlateDecode merchant');
  assert(extracted.includes('Apple MacBook Air M4'), 'Should decompress FlateDecode item');
});

runTest('Detects scanned/image-based PDF vs mixed PDF accurately', () => {
  const scannedPdf = buildMockPdfBytes({ streams: [], includeImageObject: true, pageCount: 2 });
  const scannedVal = validatePdfBytes(scannedPdf);
  assert.strictEqual(scannedVal.valid, true);
  assert.strictEqual(scannedVal.pdfType, 'scanned');
  assert.strictEqual(scannedVal.hasTextLayer, false);
  assert.strictEqual(scannedVal.hasImageObjects, true);
  assert.strictEqual(scannedVal.estimatedPageCount, 2);

  const mixedClassification = classifyPdfPages([
    {
      pageNumber: 1,
      text: 'Amazon Tax Invoice No AMZ-9901 Sold By Appario Retail Private Limited Date 2026-04-12',
      charCount: 82,
      hasImages: true,
      isScannedCandidate: false,
    },
    {
      pageNumber: 2,
      text: '',
      charCount: 0,
      hasImages: true,
      isScannedCandidate: true,
    },
  ]);
  assert.strictEqual(mixedClassification, 'mixed');
});

console.log('\n4. Multi-Page Consolidation, Schema Validation & Null Preservation');

runTest('Consolidates multi-page invoice without duplicate line items or double-counted grand totals', () => {
  const page1 = {
    pageNumber: 1,
    extraction: {
      storeName: 'Reliance Digital',
      storeAddress: 'MG Road, Bengaluru',
      gstin: '29AABCR1234D1Z9',
      invoiceNumber: 'RD-2026-4451',
      invoiceDate: '2026-04-18',
      purchaseDate: '2026-04-17',
      items: [
        { name: 'LG OLED 55" TV', quantity: 1, unitPrice: 100000, lineTotal: 118000 },
        { name: 'HDMI 2.1 Cable', quantity: 2, unitPrice: 1000, lineTotal: 2360 },
        { name: 'Subtotal', quantity: 1, unitPrice: 120360, lineTotal: 120360 },
      ],
      subtotal: 120360,
      finalAmountPaid: 120360, // Carry-forward subtotal on page 1 — MUST NOT be added to page 2!
    },
  };

  const page2 = {
    pageNumber: 2,
    extraction: {
      storeName: 'Reliance Digital',
      invoiceNumber: 'RD-2026-4451',
      items: [
        // Duplicate item repeated at top of page 2 carry-over:
        { name: 'HDMI 2.1 Cable', quantity: 2, unitPrice: 1000, lineTotal: 2360 },
        { name: 'Wall Mount Bracket', quantity: 1, unitPrice: 2000, lineTotal: 2360 },
        { name: 'Grand Total', quantity: 1, unitPrice: 122720, lineTotal: 122720 },
      ],
      taxableAmount: 104000,
      gstPercentage: 18,
      cgst: 9360,
      sgst: 9360,
      totalGst: 18720,
      finalAmountPaid: 122720,
      paymentMethod: 'Credit Card',
      currency: 'INR',
    },
  };

  const merged = consolidateMultiPageExtractions([page2, page1]); // Intentionally unsorted input
  assert.strictEqual(merged.processedPages, 2);
  assert.strictEqual(merged.deduplicatedItemCount, 3, 'Should keep 3 distinct products and filter synthetic Subtotal/Grand Total rows');
  assert.strictEqual(merged.consolidated.finalAmountPaid, 122720, 'Must use final summary total (122720), NOT 120360 + 122720!');
  assert.strictEqual(merged.consolidated.taxableAmount, 104000);
  assert.strictEqual(merged.consolidated.cgst, 9360);
  assert.strictEqual(merged.consolidated.sgst, 9360);
  assert.strictEqual(merged.consolidated.totalGst, 18720);
  assert.strictEqual(merged.consolidated.invoiceDate, '2026-04-18');
  assert.strictEqual(merged.consolidated.purchaseDate, '2026-04-17', 'Must keep purchaseDate distinct from invoiceDate');
  assert.strictEqual(merged.consolidated.paymentMethod, 'Credit Card');
});

runTest('Zod schema sanitizes string currencies, percentages, N/A placeholders, and preserves nulls', () => {
  const res = validateExtractedReceiptPayload({
    storeName: 'Flipkart India Pvt Ltd',
    gstin: 'N/A',
    invoiceNumber: 'FLPK-99881',
    invoiceDate: '12/04/2026',
    purchaseDate: '10/04/2026',
    subtotal: '₹1,500.00',
    discount: 'null',
    taxableAmount: '1,271.19',
    gstPercentage: '18%',
    cgst: '114.41',
    sgst: '114.41',
    igst: null,
    finalAmountPaid: '₹1,500.01',
    warrantyPeriodMonths: 'N/A',
    paymentMethod: '',
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.data.gstin, null, 'N/A string must become null');
  assert.strictEqual(res.data.discount, null, '"null" string must become null');
  assert.strictEqual(res.data.warrantyPeriodMonths, null, 'Missing warranty must stay null');
  assert.strictEqual(res.data.paymentMethod, null, 'Empty string must become null');
  assert.strictEqual(res.data.invoiceDate, '2026-04-12');
  assert.strictEqual(res.data.purchaseDate, '2026-04-10');
  assert.strictEqual(res.data.taxableAmount, 1271.19);
  assert.strictEqual(res.data.gstPercentage, 18);
  assert.strictEqual(res.data.totalGst, 228.82);
  assert.strictEqual(res.data.finalAmountPaid, 1500.01);
});

runTest('Date normalizer handles ISO, DD/MM/YYYY, and null safely without fabricating today date', () => {
  assert.strictEqual(normalizeDateString('2026-03-21'), '2026-03-21');
  assert.strictEqual(normalizeDateString('21/03/2026'), '2026-03-21');
  assert.strictEqual(normalizeDateString('2026-03-21T14:22:00Z'), '2026-03-21');
  assert.strictEqual(normalizeDateString(null), null);
  assert.strictEqual(normalizeDateString(''), null);
});

console.log('\n5. Backend & Proxy Contracts');

runTest('Supabase Edge Function and Dev Proxy support PDF MIME/magic bytes, extractedText, pageImages, and password rejection', () => {
  const edge = readProjectFile('supabase/functions/scan-receipt/index.ts');
  const proxy = readProjectFile('server/receipt-server.js');

  for (const [label, src] of [
    ['Edge Function', edge],
    ['Dev Proxy', proxy],
  ] as const) {
    assert(src.includes('JVBERi0'), `${label} must detect %PDF- magic prefix in base64`);
    assert(src.includes('application/pdf'), `${label} must pass application/pdf MIME type`);
    assert(src.includes('PASSWORD_PROTECTED_PDF'), `${label} must reject encrypted PDFs cleanly`);
    assert(src.includes('extractedText'), `${label} must accept text-layer PDF extractions`);
    assert(src.includes('pageImages'), `${label} must accept rendered multi-page PDF images`);
    assert(src.includes('taxableAmount'), `${label} prompt must request taxableAmount`);
  }

  assert(!proxy.includes('if (candidateResp.status === 404) break;'), 'Dev Proxy must continue loop on 404 model');
  assert(
    Buffer.from(base64ToUint8Array(Buffer.from('%PDF-1.7').toString('base64'))).toString('latin1') === '%PDF-1.7',
    'base64ToUint8Array roundtrip check'
  );
});

console.log('\nAll checks completed.\n');
