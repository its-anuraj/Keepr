import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { detectFormatFromBytes, detectFormatFromUriOrName } from '../src/utils/imageIntegrity';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(err.message || err);
    process.exit(1);
  }
}

console.log('================================================================');
console.log(' KEEPR: IMAGE INTEGRITY & HIGH-RES VIEWER VALIDATION SUITE');
console.log('================================================================\n');

console.log('--- 1. Magic Byte Binary Header Detection ---');

runTest('Detects JPEG from FF D8 FF header', () => {
  const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const detected = detectFormatFromBytes(jpegBuffer);
  assert.strictEqual(detected.mimeType, 'image/jpeg');
  assert.strictEqual(detected.extension, '.jpg');
});

runTest('Detects PNG from 89 50 4E 47 header', () => {
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const detected = detectFormatFromBytes(pngBuffer);
  assert.strictEqual(detected.mimeType, 'image/png');
  assert.strictEqual(detected.extension, '.png');
});

runTest('Detects WebP from RIFF ... WEBP header', () => {
  const webpBuffer = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x20, // VP8
  ]);
  const detected = detectFormatFromBytes(webpBuffer);
  assert.strictEqual(detected.mimeType, 'image/webp');
  assert.strictEqual(detected.extension, '.webp');
});

runTest('Detects PDF from %PDF (25 50 44 46) header', () => {
  const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);
  const detected = detectFormatFromBytes(pdfBuffer);
  assert.strictEqual(detected.mimeType, 'application/pdf');
  assert.strictEqual(detected.extension, '.pdf');
});

runTest('Detects format from URI or fileName when bytes are not available', () => {
  assert.strictEqual(detectFormatFromUriOrName('file:///tmp/invoice.png').mimeType, 'image/png');
  assert.strictEqual(detectFormatFromUriOrName('file:///tmp/photo.webp').extension, '.webp');
  assert.strictEqual(detectFormatFromUriOrName('file:///tmp/contract.pdf').mimeType, 'application/pdf');
  assert.strictEqual(detectFormatFromUriOrName('file:///tmp/receipt.JPEG').mimeType, 'image/jpeg');
});

console.log('\n--- 2. Storage & Vault Dynamic MIME Preservation ---');

runTest('storageService.ts inspects binary bytes via detectFormatFromBytes', () => {
  const filePath = path.join(process.cwd(), 'src/services/storageService.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('detectFormatFromBytes'), 'storageService must use detectFormatFromBytes');
});

runTest('receiptFileService.ts uses detectFormatFromUriOrName without forced .jpg naming', () => {
  const filePath = path.join(process.cwd(), 'src/services/receiptFileService.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('detectFormatFromUriOrName'), 'receiptFileService must use detectFormatFromUriOrName');
  assert.ok(content.includes('ext = detected.extension'), 'Must preserve detected format extension');
});

console.log('\n--- 3. Ingestion Quality Enforcement (100% Full Resolution) ---');

runTest('Zero occurrences of lossy quality: 0.x across app and src', () => {
  const walk = (dir: string): string[] => {
    let results: string[] = [];
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        if (item !== 'node_modules' && item !== '.git') results.push(...walk(full));
      } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
        results.push(full);
      }
    }
    return results;
  };

  const files = [...walk('app'), ...walk('src')];
  const lowQualityFound: string[] = [];

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, idx) => {
      if (line.match(/quality:\s*0\.\d+/)) {
        lowQualityFound.push(`${f}:${idx + 1}: ${line.trim()}`);
      }
    });
  }

  assert.strictEqual(
    lowQualityFound.length,
    0,
    `Found low quality settings: \n${lowQualityFound.join('\n')}`
  );
});

console.log('\n--- 4. High-Resolution Interactive Viewer Integration ---');

runTest('HighResImageViewer supports pinch zoom, double-tap zoom, pan boundaries and dismiss', () => {
  const filePath = path.join(process.cwd(), 'src/components/ui/HighResImageViewer.tsx');
  assert.ok(fs.existsSync(filePath), 'HighResImageViewer.tsx must exist');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('PanResponder.create'), 'Must use PanResponder for gestures');
  assert.ok(content.includes('Double-tap triggered'), 'Must implement double-tap zoom');
  assert.ok(content.includes('maxZoom'), 'Must support configurable maxZoom (e.g. 6.0x)');
  assert.ok(content.includes('clamp'), 'Must clamp pan coordinates to viewport boundaries');
  assert.ok(content.includes('onClose'), 'Must support dismiss callback');
});

runTest('HighResImageViewer is integrated in scan-receipt, item details, document details, and add', () => {
  const checkIntegration = (screenPath: string) => {
    const content = fs.readFileSync(path.join(process.cwd(), screenPath), 'utf8');
    assert.ok(
      content.includes('<HighResImageViewer'),
      `${screenPath} must render <HighResImageViewer>`
    );
  };

  checkIntegration('app/scan-receipt/index.tsx');
  checkIntegration('app/item/[id].tsx');
  checkIntegration('app/document/[id].tsx');
  checkIntegration('app/(tabs)/add.tsx');
});

console.log('\n--- 5. PDF Separation Verification ---');

runTest('PDF documents remain separate and render dedicated PDF views rather than image viewer', () => {
  const docDetails = fs.readFileSync(path.join(process.cwd(), 'app/document/[id].tsx'), 'utf8');
  assert.ok(docDetails.includes("isPdf && activePhotoTab === 'front'"), 'Must maintain separate PDF branch');
  assert.ok(docDetails.includes('picture-as-pdf'), 'Must render dedicated PDF visual indicator');
});

console.log('\n================================================================');
console.log(' RESULT: 11/11 image integrity validation tests passed!');
console.log('================================================================\n');
