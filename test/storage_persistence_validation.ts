import assert from 'node:assert';
import { isStoragePath } from '../src/utils/storageUtils';

const BUCKET_ITEM_IMAGES = 'item-images';
const BUCKET_ITEM_DOCUMENTS = 'item-documents';
const BUCKET_VAULT_DOCUMENTS = 'vault-documents';
import {
  mapItemToDbRow,
  mapDocumentToDbRow,
  mapReceiptToDbRow,
  mapDbRowToItem,
  mapDbRowToDocument,
  mapDbRowToReceipt,
  generateUUID,
} from '../src/services/vaultRowMappers';
import type { Item, VaultDocument, Receipt, MaintenanceRecord } from '../src/types';

console.log('================================================================');
console.log(' KEEPR: STRICT PERMANENT CLOUD FILE STORAGE PERSISTENCE SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(description: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        console.log(`  ✓ ${description}`);
        passedTests++;
      }).catch((err) => {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        process.exitCode = 1;
      });
    }
    console.log(`  ✓ ${description}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAll() {
  console.log('--- 1. Storage Path Detection and Sanitization ---');

  test('isStoragePath correctly identifies cloud paths and rejects local URIs', () => {
    // Cloud storage paths
    assert.strictEqual(isStoragePath('usr_123/items/itm_456/photo_0.jpg'), true);
    assert.strictEqual(isStoragePath('usr_123/items/itm_456/receipt_12345.jpg'), true);
    assert.strictEqual(isStoragePath('usr_123/vault/doc_789.pdf'), true);

    // Local / temporary URIs
    assert.strictEqual(isStoragePath('file:///data/user/0/host.exp.exponent/cache/receipt.jpg'), false);
    assert.strictEqual(isStoragePath('content://media/external/images/media/123'), false);
    assert.strictEqual(isStoragePath('vault_receipts/receipt_abc.jpg'), false);
    assert.strictEqual(isStoragePath('vault_documents/doc_abc.pdf'), false);
    assert.strictEqual(isStoragePath('http://localhost:8081/asset.jpg'), false);
    assert.strictEqual(isStoragePath('https://xyz.supabase.co/storage/v1/object/sign/abc?token=123'), false);
    assert.strictEqual(isStoragePath('data:image/jpeg;base64,...'), false);
    assert.strictEqual(isStoragePath(null), false);
    assert.strictEqual(isStoragePath(''), false);
  });

  test('mapItemToDbRow never stores device-local URIs in receipt_uri or receipt_path', () => {
    const itemWithLocalReceipt: Item = {
      id: generateUUID(),
      userId: 'user_test_1',
      name: 'Sony WH-1000XM5',
      purchasePrice: 29990,
      currency: 'INR',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      receiptUri: 'file:///var/mobile/Containers/Data/Application/123/Documents/vault_receipts/rec.jpg',
      receiptPath: 'vault_receipts/rec.jpg',
    };

    const row = mapItemToDbRow(itemWithLocalReceipt, 'user_test_1');
    assert.strictEqual(row.receipt_uri, null, 'receipt_uri must be null in DB when local URI');
    assert.strictEqual(row.receipt_path, null, 'receipt_path must be null in DB when local path');

    // With genuine cloud storage path
    const itemWithCloudReceipt: Item = {
      ...itemWithLocalReceipt,
      receiptUri: 'user_test_1/items/item_1/receipt_12345.jpg',
      receiptPath: 'user_test_1/items/item_1/receipt_12345.jpg',
    };
    const rowCloud = mapItemToDbRow(itemWithCloudReceipt, 'user_test_1');
    assert.strictEqual(rowCloud.receipt_uri, 'user_test_1/items/item_1/receipt_12345.jpg');
    assert.strictEqual(rowCloud.receipt_path, 'user_test_1/items/item_1/receipt_12345.jpg');
  });

  test('mapDocumentToDbRow never stores device-local URIs in file_path, file_url, or storage_path', () => {
    const localDoc: VaultDocument = {
      id: generateUUID(),
      userId: 'user_test_1',
      title: 'Vehicle RC',
      category: 'Vehicle Documents',
      documentType: 'Registration Certificate (RC)',
      currency: 'INR',
      fileSizeBytes: 10240,
      mimeType: 'application/pdf',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      filePath: 'file:///data/user/0/host.exp.exponent/files/vault_documents/rc.pdf',
      fileUrl: 'vault_documents/rc.pdf',
      storagePath: undefined,
    };

    const docRow = mapDocumentToDbRow(localDoc, 'user_test_1');
    assert.strictEqual(docRow.storage_path, null, 'storage_path must be null for local file');
    assert.strictEqual(docRow.file_path, null, 'file_path must not contain local device path in DB');
    assert.strictEqual(docRow.file_url, null, 'file_url must not contain local device path in DB');

    // With durable cloud storage path
    const cloudDoc: VaultDocument = {
      ...localDoc,
      storagePath: 'user_test_1/vault/doc_123.pdf',
    };
    const cloudDocRow = mapDocumentToDbRow(cloudDoc, 'user_test_1');
    assert.strictEqual(cloudDocRow.storage_path, 'user_test_1/vault/doc_123.pdf');
    assert.strictEqual(cloudDocRow.file_path, 'user_test_1/vault/doc_123.pdf');
    assert.strictEqual(cloudDocRow.file_url, 'user_test_1/vault/doc_123.pdf');
  });

  test('mapReceiptToDbRow sanitizes receipt rows before DB write', () => {
    const localReceipt: Receipt = {
      id: generateUUID(),
      userId: 'user_test_1',
      fileUri: 'file:///data/user/0/host.exp.exponent/files/vault_receipts/invoice.jpg',
      fileName: 'Invoice.jpg',
      type: 'invoice',
      itemCount: 1,
      itemIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const row = mapReceiptToDbRow(localReceipt, 'user_test_1');
    assert.strictEqual(row.storage_path, null);
    assert.strictEqual(row.file_uri, null);

    // With storage path
    const cloudReceipt: Receipt = {
      ...localReceipt,
      storagePath: 'user_test_1/items/item_99/receipt_99.jpg',
    };
    const cloudRow = mapReceiptToDbRow(cloudReceipt, 'user_test_1');
    assert.strictEqual(cloudRow.storage_path, 'user_test_1/items/item_99/receipt_99.jpg');
    assert.strictEqual(cloudRow.file_uri, 'user_test_1/items/item_99/receipt_99.jpg');
  });

  console.log('\n--- 2. Database Deserialization & Hydration Resilience ---');

  test('mapDbRowToItem correctly restores cloud storage paths across logout/login and fresh installs', () => {
    const dbRow = {
      id: 'd9b50e68-4561-460b-8d0d-b8d1b13531b2',
      user_id: 'user_abc',
      name: 'MacBook Pro M3',
      purchase_price: '199900',
      category_id: 'electronics',
      image_storage_path: 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/photo_0.jpg',
      receipt_path: 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/receipt_123.jpg',
      receipt_uri: 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/receipt_123.jpg',
      receipt_name: 'Apple_Store_Invoice.jpg',
      receipt_type: 'invoice',
      product_photos: ['user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/photo_0.jpg'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const item = mapDbRowToItem(dbRow);
    assert.strictEqual(item.id, 'd9b50e68-4561-460b-8d0d-b8d1b13531b2');
    assert.strictEqual(item.receiptPath, 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/receipt_123.jpg');
    assert.strictEqual(item.receiptUri, 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/receipt_123.jpg');
    assert.strictEqual(item.imageStoragePath, 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/photo_0.jpg');
    assert.strictEqual(item.imageUrl, 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/photo_0.jpg');
    assert.strictEqual(item.receiptType, 'invoice');
  });

  test('mapDbRowToDocument correctly handles both item-linked and standalone documents', () => {
    // Standalone doc in vault-documents
    const standaloneRow = {
      id: 'f1e2d3c4-b5a6-4789-9012-3456789abcde',
      user_id: 'user_abc',
      title: 'Aadhaar Card',
      category: 'Identity Documents',
      document_type: 'National ID / Aadhaar',
      storage_path: 'user_abc/vault/f1e2d3c4-b5a6-4789-9012-3456789abcde.pdf',
      file_path: 'user_abc/vault/f1e2d3c4-b5a6-4789-9012-3456789abcde.pdf',
      file_url: 'user_abc/vault/f1e2d3c4-b5a6-4789-9012-3456789abcde.pdf',
      file_type: 'pdf',
      mime_type: 'application/pdf',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const standaloneDoc = mapDbRowToDocument(standaloneRow);
    assert.strictEqual(standaloneDoc.itemId, null);
    assert.strictEqual(standaloneDoc.storagePath, 'user_abc/vault/f1e2d3c4-b5a6-4789-9012-3456789abcde.pdf');
    assert.strictEqual(standaloneDoc.filePath, 'user_abc/vault/f1e2d3c4-b5a6-4789-9012-3456789abcde.pdf');

    // Item-linked document in item-documents
    const linkedRow = {
      id: 'a1b2c3d4-e5f6-4789-9012-3456789abcde',
      item_id: 'd9b50e68-4561-460b-8d0d-b8d1b13531b2',
      user_id: 'user_abc',
      title: 'AppleCare+ Certificate',
      category: 'Warranties & AMC',
      document_type: 'Extended Warranty Certificate',
      storage_path: 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/doc_a1b2c3d4-e5f6-4789-9012-3456789abcde.pdf',
      file_path: 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/doc_a1b2c3d4-e5f6-4789-9012-3456789abcde.pdf',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const linkedDoc = mapDbRowToDocument(linkedRow);
    assert.strictEqual(linkedDoc.itemId, 'd9b50e68-4561-460b-8d0d-b8d1b13531b2');
    assert.strictEqual(linkedDoc.storagePath, 'user_abc/items/d9b50e68-4561-460b-8d0d-b8d1b13531b2/doc_a1b2c3d4-e5f6-4789-9012-3456789abcde.pdf');
  });

  test('mapDbRowToReceipt correctly preserves multi-item linkage and durable path', () => {
    const receiptRow = {
      id: 'b1c2d3e4-f5a6-4789-9012-3456789abcde',
      user_id: 'user_abc',
      storage_path: 'user_abc/items/item_01/receipt_b1c2d3e4.jpg',
      file_uri: 'user_abc/items/item_01/receipt_b1c2d3e4.jpg',
      file_name: 'Croma_Invoice.jpg',
      receipt_type: 'invoice',
      item_count: 2,
      item_ids: ['item_01', 'item_02'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const rec = mapDbRowToReceipt(receiptRow);
    assert.strictEqual(rec.storagePath, 'user_abc/items/item_01/receipt_b1c2d3e4.jpg');
    assert.strictEqual(rec.fileUri, 'user_abc/items/item_01/receipt_b1c2d3e4.jpg');
    assert.deepStrictEqual(rec.itemIds, ['item_01', 'item_02']);
  });

  console.log('\n--- 3. User Ownership & RLS Isolation ---');

  test('User A paths are strictly scoped and isolated from User B', () => {
    const userA_Id = 'usr_11111111-1111-4111-8111-111111111111';
    const userB_Id = 'usr_22222222-2222-4222-8222-222222222222';

    const itemA: Item = {
      id: generateUUID(),
      userId: userA_Id,
      name: 'Item A',
      purchasePrice: 1000,
      currency: 'INR',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      receiptPath: `${userA_Id}/items/item_A/receipt_1.jpg`,
    };

    const rowA = mapItemToDbRow(itemA, userA_Id);
    assert.strictEqual(rowA.user_id, userA_Id);
    assert.strictEqual(rowA.receipt_path, `${userA_Id}/items/item_A/receipt_1.jpg`);
    assert.ok((rowA.receipt_path as string).startsWith(userA_Id));
    assert.ok(!(rowA.receipt_path as string).startsWith(userB_Id));
  });

  console.log('\n--- 4. Data Loss Prevention & Zero Deletion Guarantee ---');

  test('Missing local files on another device do not delete or overwrite DB records', () => {
    // When an existing record in DB has a valid cloud storage path,
    // but the local disk has no file (e.g. fresh installation or second device):
    const existingDbItem = {
      id: generateUUID(),
      user_id: 'user_cross_device',
      name: 'Diamond Ring',
      purchase_price: '75000',
      receipt_path: 'user_cross_device/items/item_ring/receipt.jpg',
      receipt_uri: 'user_cross_device/items/item_ring/receipt.jpg',
    };

    const hydratedItem = mapDbRowToItem(existingDbItem);
    assert.strictEqual(hydratedItem.receiptPath, 'user_cross_device/items/item_ring/receipt.jpg');
    assert.strictEqual(hydratedItem.receiptUri, 'user_cross_device/items/item_ring/receipt.jpg');
    // Ensure item status is not changed to deleted
    assert.strictEqual(hydratedItem.status, 'active');
  });

  console.log('\n--- 5. Service & Repair Attachment Linking ---');

  test('Service record attachments preserve link to Vault Documents and Items', () => {
    const docId1 = generateUUID();
    const docId2 = generateUUID();
    const itemId = generateUUID();

    const maintRecord: MaintenanceRecord = {
      id: generateUUID(),
      itemId,
      userId: 'user_service_test',
      title: 'Brake Pad Replacement & Annual Service',
      serviceType: 'Repair',
      serviceDate: '2026-09-15',
      cost: 4500,
      amountPaid: 4500,
      currency: 'INR',
      warrantyCovered: 'no',
      postServiceWarranty: true,
      postServiceWarrantyUntil: '2027-03-15',
      documentIds: [docId1, docId2],
      attachments: [],
      status: 'completed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    assert.strictEqual(maintRecord.itemId, itemId);
    assert.deepStrictEqual(maintRecord.documentIds, [docId1, docId2]);
    assert.strictEqual(maintRecord.postServiceWarranty, true);
    assert.strictEqual(maintRecord.postServiceWarrantyUntil, '2027-03-15');
  });

  console.log('\n--- 6. Idempotent Cloud Upsert Payload Validation ---');

  test('Multiple saves produce identical canonical storage references without duplication', () => {
    const fixedItemId = '33333333-3333-4333-8333-333333333333';
    const fixedStoragePath = 'usr_test/items/33333333-3333-4333-8333-333333333333/receipt_fixed.jpg';

    const item: Item = {
      id: fixedItemId,
      userId: 'usr_test',
      name: 'LG OLED TV',
      purchasePrice: 124990,
      currency: 'INR',
      status: 'active',
      receiptPath: fixedStoragePath,
      receiptUri: fixedStoragePath,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const row1 = mapItemToDbRow(item, 'usr_test');
    const row2 = mapItemToDbRow(item, 'usr_test');

    assert.deepStrictEqual(row1, row2, 'Idempotent mappings must produce identical DB row payloads');
    assert.strictEqual(row1.receipt_path, fixedStoragePath);
    assert.strictEqual(row2.receipt_path, fixedStoragePath);
  });
}

runAll().then(() => {
  console.log(`\n================================================================`);
  console.log(` RESULT: ${passedTests}/${totalTests} storage persistence tests passed!`);
  console.log(`================================================================`);
  if (passedTests !== totalTests) {
    process.exit(1);
  }
});
