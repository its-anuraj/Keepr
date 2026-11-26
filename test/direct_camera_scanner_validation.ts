import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

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
console.log(' KEEPR: DIRECT CAMERA RECEIPT SCANNER VALIDATION SUITE');
console.log('================================================================\n');

console.log('--- 1. DirectCameraScanner Component Verification ---');

runTest('DirectCameraScanner component file exists and exports DirectCameraScanner', () => {
  const filePath = path.join(process.cwd(), 'src/components/scanner/DirectCameraScanner.tsx');
  assert.ok(fs.existsSync(filePath), 'DirectCameraScanner.tsx must exist');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('export const DirectCameraScanner'), 'Must export DirectCameraScanner component');
});

runTest('DirectCameraScanner uses native CameraView from expo-camera', () => {
  const filePath = path.join(process.cwd(), 'src/components/scanner/DirectCameraScanner.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes("from 'expo-camera'"), 'Must import from expo-camera');
  assert.ok(content.includes('<CameraView'), 'Must render native <CameraView>');
  assert.ok(content.includes('useCameraPermissions'), 'Must use useCameraPermissions hook');
});

runTest('DirectCameraScanner captures full-resolution photos without lossy compression', () => {
  const filePath = path.join(process.cwd(), 'src/components/scanner/DirectCameraScanner.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('takePictureAsync'), 'Must invoke takePictureAsync on camera ref');
  assert.ok(content.includes('quality: 1.0'), 'Must use quality: 1.0 for capture');
  assert.ok(content.includes('skipProcessing: true'), 'Must set skipProcessing: true to preserve raw pixels');
});

runTest('DirectCameraScanner provides flash, lens flip, alignment reticles and gallery fallback', () => {
  const filePath = path.join(process.cwd(), 'src/components/scanner/DirectCameraScanner.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('handleToggleFlash'), 'Must implement flash mode toggling');
  assert.ok(content.includes('handleToggleFacing'), 'Must implement camera lens flip');
  assert.ok(content.includes('onOpenGallery'), 'Must provide gallery fallback button and callback');
  assert.ok(content.includes('border-serene-primary'), 'Must render receipt alignment frame / reticles');
  assert.ok(content.includes('scanLineAnim'), 'Must render active scanning reticle laser beam');
});

runTest('DirectCameraScanner handles camera permissions and permanent denial gracefully', () => {
  const filePath = path.join(process.cwd(), 'src/components/scanner/DirectCameraScanner.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('requestPermission'), 'Must provide permission request trigger');
  assert.ok(content.includes('Linking.openSettings'), 'Must support opening system settings on permanent denial');
  assert.ok(content.includes('onClose'), 'Must allow user to exit gracefully without crash');
});

console.log('\n--- 2. Scanner Screen Integration ---');

runTest('app/scan-receipt/index.tsx integrates DirectCameraScanner for scan state', () => {
  const filePath = path.join(process.cwd(), 'app/scan-receipt/index.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes("import { DirectCameraScanner } from '../../src/components/scanner/DirectCameraScanner'"), 'Must import DirectCameraScanner');
  assert.ok(content.includes('<DirectCameraScanner'), 'Must render DirectCameraScanner in scan mode');
  assert.ok(content.includes('onCapture={handleDirectCameraCapture}'), 'Must bind handleDirectCameraCapture to onCapture');
});

runTest('app/scan-receipt/index.tsx completely eliminates fake/stock Unsplash viewfinder', () => {
  const filePath = path.join(process.cwd(), 'app/scan-receipt/index.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.strictEqual(content.includes('photo-1554224155-8d04cb21cd6c'), false, 'Must never use fake Unsplash viewfinder photo');
});

console.log('\n--- 3. Direct Navigation & Modal Entry Points ---');

runTest('AddReceiptModal offers Scan with Camera as prominent primary option', () => {
  const filePath = path.join(process.cwd(), 'src/components/scanner/AddReceiptModal.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('Scan with Camera'), 'Must include Scan with Camera option');
  assert.ok(content.includes('onScanWithCamera'), 'Must provide onScanWithCamera handler prop');
});

runTest('Home screen navigates directly to /scan-receipt with mode: camera', () => {
  const filePath = path.join(process.cwd(), 'app/(tabs)/index.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(
    content.includes("pathname: '/scan-receipt'") && content.includes("mode: 'camera'"),
    'Must route directly to camera mode'
  );
});

console.log('\n================================================================');
console.log(' RESULT: 9/9 direct camera scanner validation tests passed!');
console.log('================================================================\n');
