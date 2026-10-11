import assert from 'node:assert';
import { isStoragePath } from '../src/utils/storageUtils';
import { mapItemToDbRow, mapDbRowToItem } from '../src/services/vaultRowMappers';
import { evaluateRoutingDecision } from '../src/services/documentClassifier';
import { Item } from '../src/types';

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
console.log(' KEEPR: CHOOSE FROM GALLERY & AUTO-SCAN VERIFICATION SUITE');
console.log('================================================================\n');

console.log('--- 1. Verification of Choose Category Card Structure ---');

runTest('Add screen contains CHOOSE FROM GALLERY at the top below introductory text', () => {
  const fs = require('fs');
  const addScreenContent = fs.readFileSync('app/(tabs)/add.tsx', 'utf8');

  // Verify SCAN RECEIPT card is completely removed
  assert.strictEqual(
    addScreenContent.includes('<Text className="text-xs font-bold text-serene-primary">SCAN RECEIPT</Text>'),
    false,
    'SCAN RECEIPT card must be completely removed from add.tsx'
  );
  assert.strictEqual(
    addScreenContent.includes("router.push('/scan-receipt?mode=camera'"),
    false,
    'Scan receipt camera navigation card must be removed from Choose Category screen'
  );

  // Verify CHOOSE FROM GALLERY is present directly below introductory text
  assert.strictEqual(
    addScreenContent.includes('CHOOSE FROM GALLERY'),
    true,
    'CHOOSE FROM GALLERY card must be present'
  );
  assert.strictEqual(
    addScreenContent.includes('handleChooseFromGalleryEntry'),
    true,
    'handleChooseFromGalleryEntry handler must be attached'
  );

  // Verify autoProcess param is forwarded
  assert.strictEqual(
    addScreenContent.includes("autoProcess: 'true'"),
    true,
    "add.tsx must forward autoProcess: 'true' to /scan-receipt"
  );
});

console.log('\n--- 2. Scanner Pipeline Auto-Process Execution & Screen State ---');

runTest('Scan-receipt initializes directly in processing state when autoProcess is true', () => {
  const fs = require('fs');
  const scannerContent = fs.readFileSync('app/scan-receipt/index.tsx', 'utf8');

  // Verify instant processing state transition without preview flicker
  assert.ok(
    scannerContent.includes("isAutoProcess && initialUri ? 'processing' : (initialUri ? 'preview' : 'scan')"),
    'Scanner must initialize directly into processing state when isAutoProcess and initialUri are present'
  );

  // Verify autoProcess effect calls handleConfirmAndProcessReceipt with target image
  assert.ok(
    scannerContent.includes('params.autoProcess === \'true\''),
    'Scanner must check params.autoProcess'
  );
  assert.ok(
    scannerContent.includes('handleConfirmAndProcessReceipt(targetUri, targetBase64, targetName)'),
    'Scanner must immediately trigger handleConfirmAndProcessReceipt with target image'
  );

  // Verify processing state has cancel/back navigation
  assert.ok(
    scannerContent.includes('accessibilityLabel="Cancel Scan"'),
    'Processing screen must offer cancel/back navigation'
  );
});

console.log('\n--- 3. Autonomous Routing & Classifier Decision Matrix ---');

runTest('Purchased-item receipt auto-routes to Add Item form prefilled', () => {
  const mockPurchaseClassification = {
    topLevelClassification: 'PURCHASE_ITEM' as const,
    documentSubtype: 'TAX_INVOICE',
    confidence: 0.96,
    reason: 'Clear retail invoice with product purchase details.',
    isPhysicalItemPurchase: true,
    shouldCreateItem: true,
  };

  const decision = evaluateRoutingDecision(mockPurchaseClassification);
  assert.strictEqual(decision.action, 'AUTO_ROUTE_ITEM');
  assert.strictEqual(decision.allowAutoRoute, true);
  assert.ok(decision.userFacingHeader.includes('Purchased Item'));
});

runTest('Standalone document auto-routes to Document Vault (/document/add)', () => {
  const mockDocClassification = {
    topLevelClassification: 'GENERAL_DOCUMENT' as const,
    documentSubtype: 'VEHICLE_RC',
    confidence: 0.94,
    reason: 'Vehicle registration certificate issued by Transport Department.',
    isPhysicalItemPurchase: false,
    shouldCreateItem: false,
  };

  const decision = evaluateRoutingDecision(mockDocClassification);
  assert.strictEqual(decision.action, 'AUTO_ROUTE_DOCUMENT');
  assert.strictEqual(decision.allowAutoRoute, true);
  assert.ok(decision.userFacingHeader.includes('Important Document'));
});

runTest('Service / repair record auto-routes to Service & Repair (/service/add)', () => {
  const mockServiceClassification = {
    topLevelClassification: 'SERVICE_REPAIR' as const,
    documentSubtype: 'REPAIR_ESTIMATE',
    confidence: 0.92,
    reason: 'Vehicle brake service invoice and maintenance report.',
    isPhysicalItemPurchase: false,
    shouldCreateItem: false,
  };

  const decision = evaluateRoutingDecision(mockServiceClassification);
  assert.strictEqual(decision.action, 'AUTO_ROUTE_SERVICE');
  assert.strictEqual(decision.allowAutoRoute, true);
  assert.ok(decision.userFacingHeader.includes('Service & Repair'));
});

runTest('Uncertain or ambiguous document prompts User Review step', () => {
  const mockAmbiguousClassification = {
    topLevelClassification: 'AMBIGUOUS' as const,
    documentSubtype: null,
    confidence: 0.55,
    reason: 'Uncertain document layout.',
    isPhysicalItemPurchase: null,
    shouldCreateItem: false,
  };

  const decision = evaluateRoutingDecision(mockAmbiguousClassification);
  assert.strictEqual(decision.action, 'USER_REVIEW');
  assert.strictEqual(decision.allowAutoRoute, false);
});

console.log('\n--- 4. Gallery Receipt -> Auto-Scan -> Save Item -> Proof of Purchase Lifecycle ---');

runTest('End-to-end receipt extraction preserves durable storage path across save and cloud sync', () => {
  const userId = 'usr_gallery_test_uuid';
  const itemId = 'itm_gallery_test_uuid';
  const canonicalCloudPath = `${userId}/items/${itemId}/receipt_1728639200000.jpg`;

  // 1. User picks receipt from gallery and auto-scans
  const itemFromScan: Item = {
    id: itemId,
    userId,
    name: 'Sony Bravia 55" OLED TV',
    purchasePrice: 119990,
    currency: 'INR',
    purchaseDate: '2026-10-11',
    merchant: 'Reliance Digital',
    status: 'active',
    receiptUri: canonicalCloudPath,
    receiptPath: canonicalCloudPath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 2. Save Item maps to database row
  const dbRow = mapItemToDbRow(itemFromScan, userId);
  assert.strictEqual(dbRow.user_id, userId);
  assert.strictEqual(dbRow.receipt_path, canonicalCloudPath);
  assert.strictEqual(dbRow.receipt_uri, canonicalCloudPath);
  assert.ok(isStoragePath(dbRow.receipt_path as string));

  // 3. Cloud hydration on another device / fresh login
  const hydrated = mapDbRowToItem(dbRow);
  assert.strictEqual(hydrated.receiptPath, canonicalCloudPath);
  assert.strictEqual(hydrated.receiptUri, canonicalCloudPath);
  assert.ok(isStoragePath(hydrated.receiptPath as string));
  assert.strictEqual(hydrated.name, 'Sony Bravia 55" OLED TV');
});

console.log('\n================================================================');
console.log(' RESULT: All gallery auto-scan verification checks passed (100%)!');
console.log('================================================================\n');
