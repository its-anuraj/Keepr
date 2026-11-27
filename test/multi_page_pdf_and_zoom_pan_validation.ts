import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  clampPanOffset,
  computeFocalZoomPan,
  computePanBounds,
} from '../src/utils/imageMetadata';
import {
  DEFAULT_MAX_PDF_PAGES,
  consolidatePdfReceiptGroups,
  detectPageTextBoundaryHints,
  shouldMergeAdjacentReceiptExtractions,
} from '../src/services/pdfReceiptProcessor';
import { parseGeminiResponseToExtractedData } from '../src/services/receiptParser';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(err?.stack || err?.message || err);
    process.exit(1);
  }
}

console.log('================================================================');
console.log(' KEEPR: ZOOM/PAN + MULTI-PAGE & MULTI-IMAGE PDF VALIDATION');
console.log('================================================================\n');

console.log('--- 1. Image Viewer Zoom, Focal Point & 4-Corner Reachability ---');

runTest('Focal zoom + 2D pan bounds let users inspect all 4 corners on portrait & landscape images', () => {
  const cases = [
    { vw: 400, vh: 700, iw: 3000, ih: 4000, scale: 3.5 },
    { vw: 400, vh: 700, iw: 4000, ih: 2000, scale: 4.0 },
  ];

  for (const c of cases) {
    const bounds = computePanBounds(c.scale, c.vw, c.vh, c.iw, c.ih);
    assert.ok(bounds.maxX > 0, `Expected horizontal pan room > 0 for ${c.iw}x${c.ih} at ${c.scale}x`);
    assert.ok(bounds.maxY > 0, `Expected vertical pan room > 0 for ${c.iw}x${c.ih} at ${c.scale}x`);

    const corners = [
      { x: 0, y: 0 },
      { x: c.vw, y: 0 },
      { x: 0, y: c.vh },
      { x: c.vw, y: c.vh },
    ];
    for (const corner of corners) {
      const focalPan = computeFocalZoomPan({
        currentScale: 1,
        nextScale: c.scale,
        currentPanX: 0,
        currentPanY: 0,
        focalX: corner.x,
        focalY: corner.y,
        containerWidth: c.vw,
        containerHeight: c.vh,
        imageWidth: c.iw,
        imageHeight: c.ih,
      });
      const clamped = clampPanOffset(
        focalPan.x,
        focalPan.y,
        c.scale,
        c.vw,
        c.vh,
        c.iw,
        c.ih
      );
      assert.strictEqual(focalPan.x, clamped.x);
      assert.strictEqual(focalPan.y, clamped.y);
      const expectedSignX = corner.x < c.vw / 2 ? 1 : -1;
      const expectedSignY = corner.y < c.vh / 2 ? 1 : -1;
      assert.strictEqual(Math.sign(focalPan.x), expectedSignX, 'Horizontal pan sign must move corner into viewport');
      assert.strictEqual(Math.sign(focalPan.y), expectedSignY, 'Vertical pan sign must move corner into viewport');
    }
  }
});

runTest('HighResImageViewer uses Reanimated UI-thread transforms, tap-2 release focal zoom, and 2->1 finger pan handoff', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ui/HighResImageViewer.tsx'), 'utf8');
  assert.ok(src.includes('useSharedValue') && src.includes('useAnimatedStyle'), 'Must drive transforms via Reanimated');
  assert.ok(src.includes('cancelAnimation'), 'Must cancel active animations before gesture frames');
  assert.ok(src.includes('PanResponder.create'), 'Must keep PanResponder contract');
  assert.ok(src.includes('onPanResponderTerminationRequest: () => false'), 'Must hold gesture responder against parent views');
  assert.ok(src.includes('Double-tap triggered'), 'Must preserve diagnostic log on double-tap');
  assert.ok(src.includes('measureStageWindow'), 'Must measure exact stage window coordinates for Android Modal');
});

console.log('\n--- 2. PDF Viewer Zoom/Pan, Left-Edge Unclipping & Crisp Re-Render ---');

runTest('UniversalPdfViewer avoids flexbox center clipping and preserves focal scroll on zoom/pinch', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/documents/UniversalPdfViewer.tsx'), 'utf8');
  assert.ok(
    src.includes('width: max-content') && !src.includes('display: flex;\n      flex-direction: column;\n      align-items: center'),
    'Must use block max-content layout instead of flex align-items center so left edge never clips negative'
  );
  assert.ok(src.includes('{ passive: false }'), 'Must intercept 2-finger pinch touchmove with passive: false');
  assert.ok(src.includes('applyZoomInstant'), 'Must zoom around focal midpoint smoothly');
  assert.ok(src.includes('renderVisiblePagesCrisp'), 'Must re-render visible pages lazily instead of blank innerHTML wipe');
  assert.ok(src.includes('nestedScrollEnabled'), 'Must enable nested scrolling inside Android modals');
});

console.log('\n--- 3. Multi-Page & Multi-Image PDF Extraction Logic ---');

runTest('DEFAULT_MAX_PDF_PAGES supports large multi-page PDFs (>= 20 pages)', () => {
  assert.ok(DEFAULT_MAX_PDF_PAGES >= 20);
});

runTest('Single multi-page invoice consolidates items cleanly without duplicating GST or grand total', () => {
  const units = [
    {
      pageNumber: 1,
      extraction: {
        isReceipt: true,
        merchantName: 'Amazon Retail India',
        invoiceNumber: 'INV-9901',
        purchaseDate: '2025-04-12',
        subtotal: 21186.02,
        taxAmount: 3813.48,
        cgst: 1906.74,
        sgst: 1906.74,
        grandTotal: 24999.5,
        items: [
          { name: 'Sony WH-1000XM5 Headphones', quantity: 1, lineTotal: 19999.5 },
        ],
      },
    },
    {
      pageNumber: 2,
      extraction: {
        isReceipt: true,
        merchantName: 'Amazon Retail India',
        invoiceNumber: 'INV-9901',
        purchaseDate: '2025-04-12',
        subtotal: 21186.02,
        taxAmount: 3813.48,
        cgst: 1906.74,
        sgst: 1906.74,
        grandTotal: 24999.5,
        items: [
          { name: 'Sony WH-1000XM5 Headphones', quantity: 1, lineTotal: 19999.5 },
          { name: 'USB-C Braided Cable', quantity: 1, lineTotal: 1186.52 },
        ],
      },
    },
  ];

  assert.strictEqual(shouldMergeAdjacentReceiptExtractions(units[0], units[1]), true);
  const res = consolidatePdfReceiptGroups(units);
  assert.strictEqual(res.isMultipleReceipts, false);
  assert.strictEqual(res.receipts.length, 1);
  assert.deepStrictEqual(res.receipts[0].sourcePageNumbers, [1, 2]);
  assert.strictEqual(res.receipts[0].consolidated.items?.length, 2);
  assert.strictEqual(res.receipts[0].consolidated.totalAmount, 24999.5);
  assert.strictEqual(res.receipts[0].consolidated.taxAmount, 3813.48);
});

runTest('Multiple separate receipts across different PDF pages stay separate with exact amounts', () => {
  const units = [
    {
      pageNumber: 1,
      extraction: {
        isReceipt: true,
        merchantName: 'Apple Saket',
        invoiceNumber: 'APL-2025-101',
        purchaseDate: '2025-05-01',
        grandTotal: 99900,
        taxAmount: 15238.98,
        items: [{ name: 'iPhone 16 Pro', quantity: 1, lineTotal: 99900 }],
      },
    },
    {
      pageNumber: 2,
      extraction: {
        isReceipt: true,
        merchantName: 'IKEA Nagasandra',
        invoiceNumber: 'IK-8842',
        purchaseDate: '2025-05-03',
        grandTotal: 12450.5,
        taxAmount: 1899.23,
        items: [{ name: 'Markus Office Chair', quantity: 1, lineTotal: 12450.5 }],
      },
    },
  ];

  assert.strictEqual(shouldMergeAdjacentReceiptExtractions(units[0], units[1]), false);
  const res = consolidatePdfReceiptGroups(units);
  assert.strictEqual(res.isMultipleReceipts, true);
  assert.strictEqual(res.receipts.length, 2);
  assert.deepStrictEqual(res.receipts[0].sourcePageNumbers, [1]);
  assert.deepStrictEqual(res.receipts[1].sourcePageNumbers, [2]);
  assert.strictEqual(res.receipts[0].consolidated.totalAmount, 99900);
  assert.strictEqual(res.receipts[1].consolidated.totalAmount, 12450.5);
});

runTest('Multiple cropped receipt images on the same PDF page remain separate receipts via regionIndex', () => {
  const units = [
    {
      pageNumber: 1,
      regionIndex: 1,
      extraction: {
        isReceipt: true,
        merchantName: 'Starbucks',
        invoiceNumber: 'SB-001',
        purchaseDate: '2025-06-01',
        grandTotal: 420.0,
        items: [{ name: 'Flat White', quantity: 1, lineTotal: 420 }],
      },
    },
    {
      pageNumber: 1,
      regionIndex: 2,
      extraction: {
        isReceipt: true,
        merchantName: 'Apollo Pharmacy',
        invoiceNumber: 'AP-992',
        purchaseDate: '2025-06-01',
        grandTotal: 865.25,
        items: [{ name: 'Sunscreen SPF 50', quantity: 1, lineTotal: 865.25 }],
      },
    },
  ];

  assert.strictEqual(shouldMergeAdjacentReceiptExtractions(units[0], units[1]), false);
  const res = consolidatePdfReceiptGroups(units);
  assert.strictEqual(res.isMultipleReceipts, true);
  assert.strictEqual(res.receipts.length, 2);
  assert.strictEqual(res.receipts[0].sourceRegionIndex, 1);
  assert.strictEqual(res.receipts[1].sourceRegionIndex, 2);
  assert.strictEqual(res.receipts[0].consolidated.merchantName, 'Starbucks');
  assert.strictEqual(res.receipts[1].consolidated.merchantName, 'Apollo Pharmacy');
});

runTest('detectPageTextBoundaryHints detects distinct invoice boundaries vs continuation markers', () => {
  const multi = detectPageTextBoundaryHints([
    { pageNumber: 1, text: 'TAX INVOICE\nInvoice No: INV-1001\nGrand Total: 500', charCount: 42, hasImages: false, isScannedCandidate: false },
    { pageNumber: 2, text: 'TAX INVOICE\nInvoice No: INV-2002\nGrand Total: 900', charCount: 42, hasImages: false, isScannedCandidate: false },
  ]);
  assert.strictEqual(multi.likelyMultipleReceipts, true);
  assert.strictEqual(multi.detectedInvoiceNumbers.length, 2);

  const cont = detectPageTextBoundaryHints([
    { pageNumber: 1, text: 'Invoice No: INV-555\nPage 1 of 2\nSubtotal: 100', charCount: 45, hasImages: false, isScannedCandidate: false },
    { pageNumber: 2, text: 'Continued from page 1\nPage 2 of 2\nTotal: 118', charCount: 43, hasImages: false, isScannedCandidate: false },
  ]);
  assert.strictEqual(cont.hasContinuationMarkers, true);
});

runTest('parseGeminiResponseToExtractedData maps multi-receipt payloads & pageProcessingSummary cleanly', () => {
  const parsed = parseGeminiResponseToExtractedData(
    {
      multipleReceiptsDetected: true,
      pageProcessingSummary: {
        totalPages: 3,
        processedPages: 2,
        failedPages: [{ pageNumber: 3, error: 'Blank or corrupted raster' }],
        detectedReceiptsCount: 2,
      },
      receipts: [
        {
          isReceipt: true,
          merchantName: 'Croma Electronics',
          invoiceNumber: 'CR-11',
          purchaseDate: '2025-07-10',
          grandTotal: 45990,
          taxAmount: 7015.42,
          sourcePageNumbers: [1],
          items: [{ name: 'LG 4K Monitor', quantity: 1, lineTotal: 45990 }],
        },
        {
          isReceipt: true,
          merchantName: 'Decathlon',
          invoiceNumber: 'DC-77',
          purchaseDate: '2025-07-11',
          grandTotal: 2999,
          taxAmount: 321.32,
          sourcePageNumbers: [2],
          items: [{ name: 'Running Shoes', quantity: 1, lineTotal: 2999 }],
        },
      ],
    },
    'file:///vault/multi-receipts.pdf',
    'multi-receipts.pdf'
  );

  assert.ok(parsed.extractedReceipts && parsed.extractedReceipts.length === 2);
  assert.strictEqual(parsed.extractedReceipts[0].common.merchant.value, 'Croma Electronics');
  assert.strictEqual(parsed.extractedReceipts[0].common.finalAmount.value, 45990);
  assert.deepStrictEqual(parsed.extractedReceipts[0].sourcePageNumbers, [1]);
  assert.strictEqual(parsed.extractedReceipts[1].common.merchant.value, 'Decathlon');
  assert.strictEqual(parsed.extractedReceipts[1].common.finalAmount.value, 2999);
  assert.deepStrictEqual(parsed.extractedReceipts[1].sourcePageNumbers, [2]);
  assert.strictEqual(parsed.pageProcessingSummary?.failedPages.length, 1);
  assert.strictEqual(parsed.pageProcessingSummary?.failedPages[0].pageNumber, 3);
});

runTest('PdfProcessorWebView & scan-receipt wire CTM multi-region cropping, watermarks, and multi_receipt_review saving', () => {
  const processorSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/scanner/PdfProcessorWebView.tsx'), 'utf8');
  assert.ok(processorSrc.includes('inspectPageImageRegions'), 'Must extract embedded image bounding boxes');
  assert.ok(processorSrc.includes('cropCanvasRegionToBase64'), 'Must crop multiple receipt regions per page');
  assert.ok(processorSrc.includes('meaningfulChars < 450'), 'Must render pages with watermark/footer text + images');
  assert.ok(processorSrc.includes("status: 'failed'"), 'Must isolate per-page errors without crashing whole PDF');

  const scanSrc = fs.readFileSync(path.join(process.cwd(), 'app/scan-receipt/index.tsx'), 'utf8');
  assert.ok(scanSrc.includes("screenState === 'multi_receipt_review'"), 'Must render multi_receipt_review UI');
  assert.ok(scanSrc.includes('handleSaveMultiReceipts'), 'Must save selected receipts separately while linking complete PDF');
  assert.ok(scanSrc.includes('Partial Page Extraction'), 'Must surface partial failed pages visibly for user retry');
});

console.log('\n================================================================');
console.log(' RESULT: ALL ZOOM/PAN & MULTI-PAGE PDF VALIDATIONS PASSED!');
console.log('================================================================\n');
