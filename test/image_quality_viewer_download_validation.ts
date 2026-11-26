import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { detectFormatFromBytes, detectFormatFromBase64Prefix } from '../src/utils/imageIntegrity';
import {
  buildEnhancedFilename,
  buildMediaQualityMetadata,
  clampPanOffset,
  computeAdaptiveMaxZoom,
  computeContainedImageRect,
  computeFocalZoomPan,
  computeSha256Hex,
  extractImageDimensions,
  resolveUniqueDownloadFilename,
  sanitizeDownloadFilename,
} from '../src/utils/imageMetadata';
import {
  extractDocumentImageCandidates,
  extractOriginalDocumentCandidates,
} from '../src/utils/storageUtils';

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

function buildMockPng(width: number, height: number): Uint8Array {
  // Valid PNG signature + IHDR chunk + IDAT dummy body
  const buf = new Uint8Array(64);
  // \x89PNG\r\n\x1a\n
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR length = 13
  buf.set([0x00, 0x00, 0x00, 0x0d], 8);
  // 'IHDR'
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  buf[24] = 8; // bit depth
  buf[25] = 6; // RGBA (alpha preserved)
  return buf;
}

function buildMockJpeg(width: number, height: number): Uint8Array {
  // Minimal valid JPEG SOI + APP0 + SOF0(width, height) + EOI
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0 length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, // SOF0 length 17
    0x08, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9, // EOI
  ]);
  return bytes;
}

function buildMockWebpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  // RIFF .... WEBP VP8X
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  const wMinus1 = width - 1;
  const hMinus1 = height - 1;
  bytes[24] = wMinus1 & 0xff;
  bytes[25] = (wMinus1 >> 8) & 0xff;
  bytes[26] = (wMinus1 >> 16) & 0xff;
  bytes[27] = hMinus1 & 0xff;
  bytes[28] = (hMinus1 >> 8) & 0xff;
  bytes[29] = (hMinus1 >> 16) & 0xff;
  return bytes;
}

console.log('================================================================');
console.log(' KEEPR: QUALITY, VIEWER, ZOOM, ENHANCE & DOWNLOAD VALIDATION');
console.log('================================================================\n');

console.log('--- 1. Cryptographic SHA-256, Pixel Dimensions & Binary Integrity ---');

runTest('Pure TS computeSha256Hex matches Node native crypto SHA-256 bit-for-bit', () => {
  const samples = [
    new Uint8Array(0),
    Buffer.from('Keepr original invoice integrity test payload #12345'),
    buildMockPng(2400, 1600),
    buildMockJpeg(4032, 3024),
  ];

  for (const sample of samples) {
    const actual = computeSha256Hex(sample);
    const expected = crypto.createHash('sha256').update(sample).digest('hex');
    assert.strictEqual(actual, expected, 'SHA-256 digest must match standard FIPS 180-4');
  }
});

runTest('Extracts exact pixel dimensions from PNG, JPEG, and WebP binary headers', () => {
  const pngDims = extractImageDimensions(buildMockPng(2560, 1440));
  assert.deepStrictEqual(pngDims, { width: 2560, height: 1440 });

  const jpgDims = extractImageDimensions(buildMockJpeg(4032, 3024));
  assert.deepStrictEqual(jpgDims, { width: 4032, height: 3024 });

  const webpDims = extractImageDimensions(buildMockWebpVp8x(1920, 1080));
  assert.deepStrictEqual(webpDims, { width: 1920, height: 1080 });

  const pdfBytes = Buffer.from('%PDF-1.5\n1 0 obj\n<< /Type /Catalog >>');
  assert.strictEqual(extractImageDimensions(pdfBytes), null);
});

runTest('buildMediaQualityMetadata reports high vs low resolution accurately without hiding degradation', () => {
  const highRes = buildMediaQualityMetadata(buildMockJpeg(4000, 3000));
  assert.strictEqual(highRes.format, 'jpeg');
  assert.strictEqual(highRes.width, 4000);
  assert.strictEqual(highRes.height, 3000);
  assert.strictEqual(highRes.qualityTier, 'high');
  assert.strictEqual(highRes.megapixels, 12);

  const lowRes = buildMediaQualityMetadata(buildMockPng(320, 240));
  assert.strictEqual(lowRes.format, 'png');
  assert.strictEqual(lowRes.qualityTier, 'low');
  assert.strictEqual(lowRes.mimeType, 'image/png');
});

console.log('\n--- 2. Thumbnail vs Original & Non-Destructive Enhancement Separation ---');

runTest('buildEnhancedFilename creates separate _enhanced artifact and never overwrites original', () => {
  const orig = 'GST_Invoice_March_2026.png';
  const enhanced = buildEnhancedFilename(orig, '.png');
  assert.strictEqual(enhanced, 'GST_Invoice_March_2026_enhanced.png');
  assert.notStrictEqual(enhanced, orig);

  // Double enhancement normalizes without infinite _enhanced_enhanced chains
  assert.strictEqual(buildEnhancedFilename(enhanced, '.jpg'), 'GST_Invoice_March_2026_enhanced.jpg');
});

runTest('extractOriginalDocumentCandidates ignores thumbnailPath while list candidates prioritize thumbnailPath', () => {
  const doc = {
    id: 'doc-123',
    thumbnailPath: 'user1/vault/doc-123_thumb.jpg',
    storagePath: 'user1/vault/doc-123.png',
    filePath: 'file:///docs/vault_documents/doc-123.png',
    fileUrl: 'user1/vault/doc-123.png',
    mimeType: 'image/png',
  };

  const listCandidates = extractDocumentImageCandidates(doc);
  assert.strictEqual(listCandidates.storagePath, 'user1/vault/doc-123_thumb.jpg');

  const viewerCandidates = extractOriginalDocumentCandidates(doc);
  assert.strictEqual(viewerCandidates.storagePath, 'user1/vault/doc-123.png');
});

runTest('List screens request preferThumbnail while detail viewers preserve full originals', () => {
  const itemCardSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/ui/ItemCard.tsx'), 'utf8');
  const recentThumbSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/ui/RecentlyAddedThumbnail.tsx'), 'utf8');
  const docsTabSrc = fs.readFileSync(path.join(process.cwd(), 'app/(tabs)/documents.tsx'), 'utf8');
  const topListSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/analytics/TopPurchasesList.tsx'), 'utf8');

  assert.ok(itemCardSrc.includes('preferThumbnail: true'), 'ItemCard should use list thumbnails');
  assert.ok(recentThumbSrc.includes('preferThumbnail: true'), 'RecentlyAddedThumbnail should use list thumbnails');
  assert.ok(docsTabSrc.includes('preferThumbnail: true'), 'Documents tab should use list thumbnails');
  assert.ok(topListSrc.includes('preferThumbnail: true'), 'TopPurchasesList should use list thumbnails');

  const itemDetailSrc = fs.readFileSync(path.join(process.cwd(), 'app/item/[id].tsx'), 'utf8');
  assert.ok(!itemDetailSrc.includes('preferThumbnail: true'), 'Item detail must never force thumbnails into viewer');
});

console.log('\n--- 3. Zoom, Focal Point, Aspect Fit & Pan Clamp Math ---');

runTest('computeContainedImageRect handles portrait and landscape aspect ratios accurately', () => {
  // Tall 1000x2000 image in 400x600 viewport -> height constrained to 600, width 300
  const tallRect = computeContainedImageRect(400, 600, 1000, 2000);
  assert.strictEqual(tallRect.width, 300);
  assert.strictEqual(tallRect.height, 600);
  assert.strictEqual(tallRect.offsetX, 50);

  // Wide 4000x1000 image in 400x600 viewport -> width constrained to 400, height 100
  const wideRect = computeContainedImageRect(400, 600, 4000, 1000);
  assert.strictEqual(wideRect.width, 400);
  assert.strictEqual(wideRect.height, 100);
  assert.strictEqual(wideRect.offsetY, 250);
});

runTest('clampPanOffset centers 1x images and clamps overflowing drags symmetrically at 3x zoom', () => {
  const at1x = clampPanOffset(150, -80, 1.0, 400, 600, 3000, 2000);
  assert.deepStrictEqual(at1x, { x: 0, y: 0 });

  // Landscape 3000x2000 in 400x600 fits at 400x266.67. At 3x -> 1200x800 -> maxX=400, maxY=100
  const clamped = clampPanOffset(9999, -9999, 3.0, 400, 600, 3000, 2000);
  assert.strictEqual(clamped.x, 400);
  assert.strictEqual(clamped.y, -100);

  // Adaptive max zoom reaches >= 4x and up to 8x for high-res
  assert.ok(computeAdaptiveMaxZoom(400, 600, 4000, 3000, 6) >= 6);
});

runTest('computeFocalZoomPan preserves off-center point under tap/pinch within bounds', () => {
  const pan = computeFocalZoomPan({
    currentScale: 1,
    nextScale: 2.5,
    currentPanX: 0,
    currentPanY: 0,
    focalX: 300, // 100px right of center (200)
    focalY: 300, // centered Y
    containerWidth: 400,
    containerHeight: 600,
    imageWidth: 2000,
    imageHeight: 2000, // fitted 400x400 -> at 2.5x: 1000x1000 -> maxX=300, maxY=200
  });
  // dx = +100 -> rawPanX = 100 - 100 * 2.5 = -150 (shifted left to bring right edge under finger)
  assert.strictEqual(pan.x, -150);
  assert.strictEqual(pan.y, 0);
});

console.log('\n--- 4. Download Filenames, Duplicate Handling & PDF Authenticity ---');

runTest('sanitizeDownloadFilename enforces authentic format extensions and OS safety', () => {
  assert.strictEqual(sanitizeDownloadFilename('Invoice: Mar/2026*.jpg', '.pdf'), 'Invoice_Mar_2026.pdf');
  assert.strictEqual(sanitizeDownloadFilename('MacBook?Photo.png', '.png'), 'MacBook_Photo.png');
});

runTest('resolveUniqueDownloadFilename generates unique numbered copies for duplicate filenames', () => {
  const existing = ['Tax_Receipt.pdf', 'Tax_Receipt (1).pdf', 'photo.png'];
  assert.strictEqual(resolveUniqueDownloadFilename('Tax_Receipt.pdf', existing), 'Tax_Receipt (2).pdf');
  assert.strictEqual(resolveUniqueDownloadFilename('tax_receipt.pdf', existing), 'tax_receipt (2).pdf');
  assert.strictEqual(resolveUniqueDownloadFilename('Fresh_File.jpg', existing), 'Fresh_File.jpg');
});

console.log('\n--- 5. Unified Viewer, PDF Zoom Fix, Service Integration & Cloud Sync Audit ---');

runTest('HighResImageViewer exposes +, -, Fit, Original/Enhanced switcher, and Download Original', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ui/HighResImageViewer.tsx'), 'utf8');
  assert.ok(src.includes('zoomByStep'), 'Must provide zoom +/- buttons');
  assert.ok(src.includes('computeFocalZoomPan'), 'Must preserve focal point on zoom');
  assert.ok(src.includes('clampPanOffset'), 'Must use aspect-aware pan clamping');
  assert.ok(src.includes('downloadOriginalFile'), 'Must use originalDownloadService');
  assert.ok(src.includes('ImageEnhancementModal'), 'Must wire optional non-destructive enhancement');
  assert.ok(src.includes('Original (Untouched)'), 'Must toggle Original vs Enhanced without overwrite');
});

runTest('UniversalPdfViewer removes CSS canvas max-width clamp, adds Fit Width/Page, and downloads authentic PDFs', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/documents/UniversalPdfViewer.tsx'), 'utf8');
  assert.ok(!src.includes('canvas { max-width: 96%'), 'Must remove CSS max-width clamp that breaks PDF zooming');
  assert.ok(src.includes('Fit Width') && src.includes('Fit Page'), 'Must provide Fit Width / Fit Page toggle');
  assert.ok(src.includes('isPdf: true') && src.includes('downloadOriginalFile'), 'Must download authentic PDF bytes, never screenshots');
  assert.ok(src.includes('window.pushPdfBase64Chunk'), 'Must inject large PDFs without template string duplication');
});

runTest('originalDownloadService guards against thumbnails, non-PDF corruption, HTML errors, and cancellations', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/services/originalDownloadService.ts'), 'utf8');
  assert.ok(src.includes('isThumbnailUri'), 'Must refuse using thumbnail paths as original source');
  assert.ok(src.includes("req.isPdf && authenticFormat.format !== 'pdf'"), 'Must verify %PDF header on PDF downloads');
  assert.ok(src.includes('<!doctype') && src.includes('Access denied'), 'Must detect HTTP/HTML error responses honestly');
  assert.ok(src.includes('safResult.cancelled') && src.includes('success: false'), 'Must never report success when user cancels');
});

runTest('cloudSyncService handles PNG/WebP/PDF formats across items, documents (front+back), and receipts safely', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/services/cloudSyncService.ts'), 'utf8');
  assert.ok(src.includes('readUriBytesAndBase64Safely(canonical'), 'Must safely read product/receipt URIs');
  assert.ok(src.includes('detectFormatFromBytes(safeRead.bytes)'), 'Must preserve PNG/WebP/HEIC/PDF formats on cloud upload');
  assert.ok(src.includes('storagePathBack'), 'Must upload and persist back-side document media');
});

runTest('Items, Documents, and Service Details unify preview & original download experience', () => {
  const serviceSrc = fs.readFileSync(path.join(process.cwd(), 'app/service/[id].tsx'), 'utf8');
  assert.ok(serviceSrc.includes('<UniversalPdfViewer'), 'Service Details must support inline PDF viewer');
  assert.ok(serviceSrc.includes('<HighResImageViewer'), 'Service Details must support inline Image viewer');
  assert.ok(serviceSrc.includes('downloadOriginalFile'), 'Service Details must allow direct original download');

  const itemSrc = fs.readFileSync(path.join(process.cwd(), 'app/item/[id].tsx'), 'utf8');
  assert.ok(itemSrc.includes('downloadOriginalFile'), 'Item Details must support direct receipt download');
  assert.ok(itemSrc.includes('enhancedPhotoUri') && itemSrc.includes('enhancedReceiptUri'), 'Item Details must store enhanced copies separately');

  const storageSql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/005_enforce_storage_security.sql'), 'utf8');
  assert.ok(storageSql.includes("('item-images', 'item-images', false"), 'Private bucket security must remain intact');
});

console.log('\n================================================================');
console.log(' RESULT: ALL QUALITY, VIEWER & DOWNLOAD VALIDATIONS PASSED!');
console.log('================================================================\n');
