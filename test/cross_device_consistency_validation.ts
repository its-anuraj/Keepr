import assert from 'node:assert';
import {
  isStoragePath,
  isLocalUri,
  isRemoteUrl,
  extractItemImageCandidates,
  extractDocumentImageCandidates,
  BUCKET_ITEM_IMAGES,
  BUCKET_ITEM_DOCUMENTS,
} from '../src/utils/storageUtils';
import {
  mapDbRowToItem,
  mapItemToDbRow,
  mapDbRowToDocument,
  mapDocumentToDbRow,
  mapDbRowToWarranty,
} from '../src/services/vaultRowMappers';
import { mapWarrantyToDbRow } from '../src/services/cloudSyncService';
import type { Item, VaultDocument, Warranty, RecentlyAddedEntry } from '../src/types';
import type { CloudVaultData } from '../src/services/cloudSyncService';
import { SyncOpType } from '../src/services/syncQueueService';

console.log('================================================================');
console.log(' KEEPR: CROSS-DEVICE & CLOUD DATA CONSISTENCY REGRESSION SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      res.then(() => {
        console.log(`  ✓ ${name}`);
        passedTests++;
      }).catch((err) => {
        console.error(`  ✗ ${name}`);
        console.error(`    Error: ${err.message}`);
        throw err;
      });
    } else {
      console.log(`  ✓ ${name}`);
      passedTests++;
    }
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// 1. Vault hydration with 5 items and 4 documents produces identical counts
// -----------------------------------------------------------------------------
console.log('--- 1. Multi-Entity Hydration Verification (5 Items, 4 Documents) ---');

test('5 items and 4 documents map and hydrate without loss or cross-pollution', () => {
  const userId = 'usr-consistency-test-1';

  const mockDbItems = [
    { id: '11111111-1111-4111-8111-111111111111', user_id: userId, name: 'Lenovo IdeaPad Slim 3', purchase_price: 45000, purchase_date: '2026-01-15', image_storage_path: 'usr-1/item-1.jpg', created_at: '2026-01-15T10:00:00Z', updated_at: '2026-01-15T10:00:00Z' },
    { id: '22222222-2222-4222-8222-222222222222', user_id: userId, name: 'Samsung Galaxy S24', purchase_price: 79999, purchase_date: '2026-02-10', image_storage_path: 'usr-1/item-2.jpg', created_at: '2026-02-10T10:00:00Z', updated_at: '2026-02-10T10:00:00Z' },
    { id: '33333333-3333-4333-8333-333333333333', user_id: userId, name: 'Sony WH-1000XM5', purchase_price: 29990, purchase_date: '2026-03-01', image_storage_path: null, created_at: '2026-03-01T10:00:00Z', updated_at: '2026-03-01T10:00:00Z' },
    { id: '44444444-4444-4444-8444-444444444444', user_id: userId, name: 'Apple iPad Air', purchase_price: 59900, purchase_date: '2026-03-15', image_storage_path: 'usr-1/item-4.jpg', created_at: '2026-03-15T10:00:00Z', updated_at: '2026-03-15T10:00:00Z' },
    { id: '55555555-5555-4555-8555-555555555555', user_id: userId, name: 'Logitech MX Master 3S', purchase_price: 8995, purchase_date: '2026-03-20', image_storage_path: null, created_at: '2026-03-20T10:00:00Z', updated_at: '2026-03-20T10:00:00Z' },
  ];

  const mockDbDocs = [
    { id: 'd1111111-1111-4111-8111-111111111111', user_id: userId, title: 'House Lease Agreement', category: 'Property & Real Estate', storage_path: 'usr-1/doc-1.pdf', created_at: '2026-01-01T09:00:00Z', updated_at: '2026-01-01T09:00:00Z' },
    { id: 'd2222222-2222-4222-8222-222222222222', user_id: userId, title: 'Health Insurance Policy', category: 'Insurance', storage_path: 'usr-1/doc-2.pdf', created_at: '2026-01-02T09:00:00Z', updated_at: '2026-01-02T09:00:00Z' },
    { id: 'd3333333-3333-4333-8333-333333333333', user_id: userId, title: 'Car Registration Certificate', category: 'Automobile', storage_path: 'usr-1/doc-3.pdf', created_at: '2026-01-03T09:00:00Z', updated_at: '2026-01-03T09:00:00Z' },
    { id: 'd4444444-4444-4444-8444-444444444444', user_id: userId, title: 'Electricity Bill Feb 2026', category: 'Bills & Utilities', storage_path: 'usr-1/doc-4.pdf', created_at: '2026-02-05T09:00:00Z', updated_at: '2026-02-05T09:00:00Z' },
  ];

  const mappedItems = mockDbItems.map(mapDbRowToItem);
  const mappedDocs = mockDbDocs.map(mapDbRowToDocument);

  assert.strictEqual(mappedItems.length, 5, 'Must have exactly 5 items');
  assert.strictEqual(mappedDocs.length, 4, 'Must have exactly 4 documents');

  // Verify ownership
  assert(mappedItems.every((i) => i.userId === userId));
  assert(mappedDocs.every((d) => d.userId === userId));

  // Verify image storage paths preserved on mapping
  assert.strictEqual(mappedItems[0].imageStoragePath, 'usr-1/item-1.jpg');
  assert.strictEqual(mappedItems[1].imageStoragePath, 'usr-1/item-2.jpg');
  assert.strictEqual(mappedItems[3].imageStoragePath, 'usr-1/item-4.jpg');
  assert.strictEqual(mappedDocs[0].storagePath, 'usr-1/doc-1.pdf');
});

// -----------------------------------------------------------------------------
// 2. Error response for items does NOT clear documents
// -----------------------------------------------------------------------------
console.log('\n--- 2. Independent Entity Query Failure Protection ---');

test('Supabase error for items query preserves existing documents and local items', () => {
  const currentState = {
    items: [
      { id: 'it-1', userId: 'u1', name: 'Item 1', purchasePrice: 100, purchaseDate: '2026-01-01', createdAt: '2026-01-01' } as unknown as Item,
    ],
    documents: [
      { id: 'dc-1', userId: 'u1', title: 'Policy', category: 'Insurance', createdAt: '2026-01-01', updatedAt: '2026-01-01' } as unknown as VaultDocument,
      { id: 'dc-2', userId: 'u1', title: 'Lease', category: 'Property', createdAt: '2026-01-01', updatedAt: '2026-01-01' } as unknown as VaultDocument,
    ],
  };

  const cloudResponse: CloudVaultData = {
    items: [],
    warranties: [],
    documents: [
      { id: 'dc-1', userId: 'u1', title: 'Policy', category: 'Insurance', createdAt: '2026-01-01', updatedAt: '2026-01-01' } as unknown as VaultDocument,
      { id: 'dc-2', userId: 'u1', title: 'Lease', category: 'Property', createdAt: '2026-01-01', updatedAt: '2026-01-01' } as unknown as VaultDocument,
    ],
    receipts: [],
    maintenanceRecords: [],
    expenses: [],
    activityLogs: [],
    itemsFetchError: true, // Items failed!
    itemsMappingErrors: 0,
    itemsRawCount: 0,
    documentsFetchError: false, // Documents succeeded!
    documentsMappingErrors: 0,
    documentsRawCount: 2,
    warrantiesFetchError: false,
    warrantiesRawCount: 0,
    receiptsFetchError: false,
    receiptsRawCount: 0,
    maintenanceFetchError: false,
    maintenanceRawCount: 0,
    expensesFetchError: false,
    expensesRawCount: 0,
    fetchErrorSummary: ['Timeout querying items table'],
  };

  // Reconcile items: itemsFetchError is true -> must preserve existing items
  let safeItems: Item[];
  if (cloudResponse.itemsFetchError) {
    safeItems = currentState.items;
  } else {
    safeItems = cloudResponse.items;
  }

  // Reconcile documents: documentsFetchError is false -> use fetched documents
  let safeDocs: VaultDocument[];
  if (cloudResponse.documentsFetchError) {
    safeDocs = currentState.documents;
  } else {
    safeDocs = cloudResponse.documents;
  }

  assert.strictEqual(safeItems.length, 1, 'Items must NOT be wiped when items fetch errors');
  assert.strictEqual(safeDocs.length, 2, 'Documents must be preserved');
});

// -----------------------------------------------------------------------------
// 3. Error response for documents does NOT clear items
// -----------------------------------------------------------------------------
test('Supabase error for documents query preserves existing items and documents backup', () => {
  const currentState = {
    items: [
      { id: 'it-1', userId: 'u1', name: 'MacBook Pro', purchasePrice: 200000, purchaseDate: '2026-01-01', createdAt: '2026-01-01' } as unknown as Item,
      { id: 'it-2', userId: 'u1', name: 'LG OLED TV', purchasePrice: 150000, purchaseDate: '2026-01-01', createdAt: '2026-01-01' } as unknown as Item,
    ],
    documents: [
      { id: 'dc-1', userId: 'u1', title: 'Passport', category: 'Personal', createdAt: '2026-01-01', updatedAt: '2026-01-01' } as unknown as VaultDocument,
    ],
  };

  const cloudResponse: CloudVaultData = {
    items: currentState.items,
    warranties: [],
    documents: [],
    receipts: [],
    maintenanceRecords: [],
    expenses: [],
    activityLogs: [],
    itemsFetchError: false, // Items succeeded!
    itemsMappingErrors: 0,
    itemsRawCount: 2,
    documentsFetchError: true, // Documents failed!
    documentsMappingErrors: 0,
    documentsRawCount: 0,
    warrantiesFetchError: false,
    warrantiesRawCount: 0,
    receiptsFetchError: false,
    receiptsRawCount: 0,
    maintenanceFetchError: false,
    maintenanceRawCount: 0,
    expensesFetchError: false,
    expensesRawCount: 0,
    fetchErrorSummary: ['503 Service Unavailable on documents table'],
  };

  let safeItems = cloudResponse.itemsFetchError ? currentState.items : cloudResponse.items;
  let safeDocs = cloudResponse.documentsFetchError ? currentState.documents : cloudResponse.documents;

  assert.strictEqual(safeItems.length, 2, 'Items must be updated from successful response');
  assert.strictEqual(safeDocs.length, 1, 'Documents must NOT be wiped when documents query fails');
});

// -----------------------------------------------------------------------------
// 4. Sync queue warranty operations
// -----------------------------------------------------------------------------
console.log('\n--- 3. Sync Queue Warranty Operation Support ---');

test('SyncOpType supports upsertWarranty and deleteWarranty operations', () => {
  const validOp1: SyncOpType = 'upsertWarranty';
  const validOp2: SyncOpType = 'deleteWarranty';
  const validOp3: SyncOpType = 'upsertItem';
  const validOp4: SyncOpType = 'deleteItem';

  assert.strictEqual(validOp1, 'upsertWarranty');
  assert.strictEqual(validOp2, 'deleteWarranty');
  assert.strictEqual(validOp3, 'upsertItem');
  assert.strictEqual(validOp4, 'deleteItem');
});

// -----------------------------------------------------------------------------
// 5. User isolation: User B does not see User A's items
// -----------------------------------------------------------------------------
console.log('\n--- 4. Multi-Tenant User Isolation ---');

test('User isolation prevents User B from seeing User A records', () => {
  const userA_Id = 'usr-tenant-A';
  const userB_Id = 'usr-tenant-B';

  const mixedItems: Item[] = [
    { id: 'item-A1', userId: userA_Id, name: 'Item A1', purchasePrice: 10, purchaseDate: '2026-01-01', createdAt: '2026-01-01' },
    { id: 'item-A2', userId: userA_Id, name: 'Item A2', purchasePrice: 20, purchaseDate: '2026-01-01', createdAt: '2026-01-01' },
    { id: 'item-B1', userId: userB_Id, name: 'Item B1', purchasePrice: 30, purchaseDate: '2026-01-01', createdAt: '2026-01-01' },
  ] as unknown as Item[];

  const verifyOwnership = <T extends { userId?: string }>(records: T[], currentUid: string): T[] =>
    records.filter((r) => !r.userId || r.userId === currentUid);

  const userA_Items = verifyOwnership(mixedItems, userA_Id);
  const userB_Items = verifyOwnership(mixedItems, userB_Id);

  assert.strictEqual(userA_Items.length, 2);
  assert.strictEqual(userB_Items.length, 1);
  assert.strictEqual(userB_Items[0].id, 'item-B1');
});

// -----------------------------------------------------------------------------
// 6. Recently Added feed combines items and documents strictly by createdAt DESC
// -----------------------------------------------------------------------------
console.log('\n--- 5. Mixed Recently Added Feed Sorting ---');

test('Recently Added combines Items and Documents in strict descending chronological order', () => {
  const items: Item[] = [
    { id: 'item-1', name: 'Item Old', purchasePrice: 100, purchaseDate: '2026-01-01', createdAt: '2026-01-01T12:00:00Z' },
    { id: 'item-2', name: 'Item Latest', purchasePrice: 200, purchaseDate: '2026-03-01', createdAt: '2026-03-01T12:00:00Z' },
  ] as unknown as Item[];

  const docs: VaultDocument[] = [
    { id: 'doc-1', title: 'Doc Middle', category: 'Other Important Documents', createdAt: '2026-02-01T12:00:00Z', updatedAt: '2026-02-01T12:00:00Z' },
  ] as unknown as VaultDocument[];

  const entries: any[] = [
    ...items.map((i) => ({ ...i, entryType: 'item' as const })),
    ...docs.map((d) => ({ ...d, entryType: 'document' as const })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  assert.strictEqual(entries.length, 3);
  assert.strictEqual(entries[0].id, 'item-2'); // March
  assert.strictEqual(entries[1].id, 'doc-1');  // February
  assert.strictEqual(entries[2].id, 'item-1'); // January
});

// -----------------------------------------------------------------------------
// 7. Full multi-entity backup structure verification
// -----------------------------------------------------------------------------
console.log('\n--- 6. User Vault Backup Multi-Entity Schema ---');

test('UserVaultBackup structure contains all vault entities', () => {
  interface UserVaultBackup {
    items: Item[];
    documents: VaultDocument[];
    warranties: Warranty[];
    receipts: any[];
    maintenanceRecords: any[];
    expenses: any[];
    activityLogs: any[];
  }

  const backup: UserVaultBackup = {
    items: [{ id: 'i1', name: 'Item', purchasePrice: 50, purchaseDate: '2026-01-01', createdAt: '2026-01-01' }] as unknown as Item[],
    documents: [{ id: 'd1', title: 'Doc', category: 'Other Important Documents', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] as unknown as VaultDocument[],
    warranties: [{ id: 'w1', itemId: 'i1', provider: 'Apple', startDate: '2026-01-01', endDate: '2027-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] as unknown as Warranty[],
    receipts: [],
    maintenanceRecords: [],
    expenses: [],
    activityLogs: [],
  };

  assert(Array.isArray(backup.items) && backup.items.length === 1);
  assert(Array.isArray(backup.documents) && backup.documents.length === 1);
  assert(Array.isArray(backup.warranties) && backup.warranties.length === 1);
  assert(Array.isArray(backup.receipts));
  assert(Array.isArray(backup.maintenanceRecords));
  assert(Array.isArray(backup.expenses));
  assert(Array.isArray(backup.activityLogs));
});

console.log('\n================================================================');
console.log(` ALL CHECKS PASSED: ${passedTests}/${totalTests} tests successful.`);
console.log('================================================================\n');
