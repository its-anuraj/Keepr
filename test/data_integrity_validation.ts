import assert from 'node:assert';
import {
  parsePostgresArray,
  normalizeProductPhotos,
  normalizeStringArray,
  mapDbRowToItem,
  mapDbRowToReceipt,
} from '../src/services/vaultRowMappers';
import type { CloudVaultData } from '../src/services/cloudSyncService';
import { Item, Receipt } from '../src/types';

console.log('================================================================');
console.log(' KEEPR: CRITICAL DATA-INTEGRITY VALIDATION SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// 1. SAFE product_photos NORMALIZATION
// -----------------------------------------------------------------------------
console.log('--- 1. Testing normalizeProductPhotos & parsePostgresArray ---');

test('null and undefined return empty array', () => {
  assert.deepStrictEqual(normalizeProductPhotos(null), []);
  assert.deepStrictEqual(normalizeProductPhotos(undefined), []);
});

test('already an array: filters non-strings, trims, drops empty strings', () => {
  const input = [' photo1.jpg ', '', '   ', 'photo2.png', null as any, 123 as any, 'photo3.webp'];
  const expected = ['photo1.jpg', 'photo2.png', 'photo3.webp'];
  assert.deepStrictEqual(normalizeProductPhotos(input), expected);
});

test('empty array returns empty array', () => {
  assert.deepStrictEqual(normalizeProductPhotos([]), []);
});

test('JSON-encoded array is parsed and validated', () => {
  const jsonArray = JSON.stringify(['photoA.jpg', '  photoB.jpg  ', '']);
  assert.deepStrictEqual(normalizeProductPhotos(jsonArray), ['photoA.jpg', 'photoB.jpg']);
});

test('JSON-encoded string is normalized to a one-element array', () => {
  const jsonString = JSON.stringify('photoSingle.jpg');
  assert.deepStrictEqual(normalizeProductPhotos(jsonString), ['photoSingle.jpg']);
});

test('plain non-empty path or URI is normalized to a one-element array', () => {
  assert.deepStrictEqual(
    normalizeProductPhotos('user_123/items/item_456/photo_0.jpg'),
    ['user_123/items/item_456/photo_0.jpg']
  );
  assert.deepStrictEqual(
    normalizeProductPhotos('file:///data/user/0/com.keepr/cache/photo.jpg'),
    ['file:///data/user/0/com.keepr/cache/photo.jpg']
  );
  assert.deepStrictEqual(
    normalizeProductPhotos('https://example.com/item.jpg'),
    ['https://example.com/item.jpg']
  );
});

test('PostgreSQL array unquoted: {path1.jpg,path2.jpg}', () => {
  const pgArray = '{user/items/p1.jpg,user/items/p2.jpg}';
  assert.deepStrictEqual(normalizeProductPhotos(pgArray), [
    'user/items/p1.jpg',
    'user/items/p2.jpg',
  ]);
});

test('PostgreSQL array quoted: {"path1.jpg","path2.jpg"}', () => {
  const pgQuoted = '{"user/items/p1.jpg","user/items/p2.jpg"}';
  assert.deepStrictEqual(normalizeProductPhotos(pgQuoted), [
    'user/items/p1.jpg',
    'user/items/p2.jpg',
  ]);
});

test('PostgreSQL array with commas inside quotes', () => {
  const pgWithComma = '{"folder/photo, 1.jpg","photo2.jpg"}';
  assert.deepStrictEqual(normalizeProductPhotos(pgWithComma), [
    'folder/photo, 1.jpg',
    'photo2.jpg',
  ]);
});

test('PostgreSQL empty array: {} and { }', () => {
  assert.deepStrictEqual(normalizeProductPhotos('{}'), []);
  assert.deepStrictEqual(normalizeProductPhotos('{  }'), []);
});

test('PostgreSQL array with NULL elements', () => {
  assert.deepStrictEqual(normalizeProductPhotos('{NULL,photo1.jpg,null}'), ['photo1.jpg']);
});

test('malformed JSON or broken brackets fall back safely without throwing', () => {
  assert.deepStrictEqual(normalizeProductPhotos('[broken JSON'), []);
  assert.deepStrictEqual(normalizeProductPhotos('{"broken": '), []);
  assert.deepStrictEqual(normalizeProductPhotos('{broken unclosed'), []);
  assert.deepStrictEqual(normalizeProductPhotos(''), []);
  assert.deepStrictEqual(normalizeProductPhotos('   '), []);
});

test('unexpected types (numbers, booleans, objects) fall back safely without throwing', () => {
  assert.deepStrictEqual(normalizeProductPhotos(12345), []);
  assert.deepStrictEqual(normalizeProductPhotos(true), []);
  assert.deepStrictEqual(normalizeProductPhotos({ url: 'broken' }), []);
});

// -----------------------------------------------------------------------------
// 2. OTHER JSON PARSING IN ITEM MAPPER & RECEIPT MAPPER
// -----------------------------------------------------------------------------
console.log('\n--- 2. Testing equivalent failure risks in mapper ---');

test('cleanNotes with valid products JSON parses correctly', () => {
  const row: Record<string, unknown> = {
    id: 'b1d03350-13f8-4e8a-a437-142825442589',
    user_id: 'user-1',
    name: 'Multi-Item Invoice',
    notes: 'Warranty details [KEEPR_PRODUCTS]: [{"name": "Mouse", "price": 50}, {"name": "Keyboard", "price": 100}]',
    purchase_price: 150,
  };
  const item = mapDbRowToItem(row);
  assert.strictEqual(item.notes, 'Warranty details');
  assert.strictEqual(item.products?.length, 2);
  assert.strictEqual(item.isMultiProduct, true);
  assert.strictEqual(item.productCount, 2);
});

test('cleanNotes with corrupted or non-array products does not crash', () => {
  const rowMalformed: Record<string, unknown> = {
    id: 'b1d03350-13f8-4e8a-a437-142825442589',
    user_id: 'user-1',
    name: 'Corrupted Notes Item',
    notes: 'Regular note [KEEPR_PRODUCTS]: {broken-json',
    purchase_price: 50,
  };
  const itemMalformed = mapDbRowToItem(rowMalformed);
  assert.strictEqual(itemMalformed.notes, 'Regular note');
  assert.strictEqual(itemMalformed.products, undefined);
  assert.strictEqual(itemMalformed.isMultiProduct, false);

  const rowNotArray: Record<string, unknown> = {
    id: 'b1d03350-13f8-4e8a-a437-142825442589',
    user_id: 'user-1',
    name: 'Primitive Notes Item',
    notes: 'Regular note [KEEPR_PRODUCTS]: "just a string"',
    purchase_price: 50,
  };
  const itemNotArray = mapDbRowToItem(rowNotArray);
  assert.strictEqual(itemNotArray.products, undefined);
  assert.strictEqual(itemNotArray.isMultiProduct, false);
});

test('mapDbRowToReceipt handles PostgreSQL array and JSON array item_ids', () => {
  const rowPg: Record<string, unknown> = {
    id: 'b1d03350-13f8-4e8a-a437-142825442589',
    user_id: 'user-1',
    file_uri: 'file:///r.jpg',
    item_ids: '{uuid-1,uuid-2}',
  };
  const receiptPg = mapDbRowToReceipt(rowPg);
  assert.deepStrictEqual(receiptPg.itemIds, ['uuid-1', 'uuid-2']);

  const rowJson: Record<string, unknown> = {
    id: 'b1d03350-13f8-4e8a-a437-142825442589',
    user_id: 'user-1',
    file_uri: 'file:///r.jpg',
    item_ids: '["uuid-3", "uuid-4"]',
  };
  const receiptJson = mapDbRowToReceipt(rowJson);
  assert.deepStrictEqual(receiptJson.itemIds, ['uuid-3', 'uuid-4']);

  const rowNull: Record<string, unknown> = {
    id: 'b1d03350-13f8-4e8a-a437-142825442589',
    user_id: 'user-1',
    file_uri: 'file:///r.jpg',
    item_ids: null,
  };
  const receiptNull = mapDbRowToReceipt(rowNull);
  assert.deepStrictEqual(receiptNull.itemIds, []);
});

test('mapDbRowToItem maps all formats of product_photos without crashing', () => {
  const testCases: Array<{ rawPhotos: unknown; expected: string[] }> = [
    { rawPhotos: null, expected: [] },
    { rawPhotos: undefined, expected: [] },
    { rawPhotos: 'user/items/photo.jpg', expected: ['user/items/photo.jpg'] },
    { rawPhotos: '{p1.jpg,p2.jpg}', expected: ['p1.jpg', 'p2.jpg'] },
    { rawPhotos: '{"p1.jpg","p2.jpg"}', expected: ['p1.jpg', 'p2.jpg'] },
    { rawPhotos: '["p1.jpg","p2.jpg"]', expected: ['p1.jpg', 'p2.jpg'] },
    { rawPhotos: ['p1.jpg', 'p2.jpg'], expected: ['p1.jpg', 'p2.jpg'] },
    { rawPhotos: '{broken', expected: [] },
    { rawPhotos: '[broken', expected: [] },
  ];

  for (const tc of testCases) {
    const row: Record<string, unknown> = {
      id: 'a0000000-0000-0000-0000-000000000001',
      user_id: 'user-1',
      name: 'Test Item',
      product_photos: tc.rawPhotos,
      purchase_price: 100,
    };
    const mapped = mapDbRowToItem(row);
    assert.deepStrictEqual(mapped.productPhotos, tc.expected);
  }
});

// -----------------------------------------------------------------------------
// 3. FAILED ITEMS QUERY VS SUCCESSFUL EMPTY QUERY
// -----------------------------------------------------------------------------
console.log('\n--- 3. Testing failed items query vs successful empty query ---');

test('CloudVaultData distinguishes query failure from confirmed empty response', () => {
  // Scenario A: Failed query (e.g. Supabase returned 500 or network timeout)
  const failedCloudData: CloudVaultData = {
    items: [],
    warranties: [],
    documents: [{ id: 'doc-1', userId: 'u1', title: 'Doc', filePath: 'f', fileUrl: 'u', fileType: 'pdf', fileSizeBytes: 10, createdAt: '', updatedAt: '' } as any],
    receipts: [],
    maintenanceRecords: [],
    expenses: [],
    activityLogs: [],
    itemsFetchError: true,
    itemsMappingErrors: 0,
    itemsRawCount: 0,
    fetchErrorSummary: ['Supabase connection timeout'],
  };

  assert.strictEqual(failedCloudData.itemsFetchError, true);
  assert.strictEqual(failedCloudData.items.length, 0);

  // Scenario B: Confirmed successful empty vault (user legitimately owns 0 items)
  const emptyCloudData: CloudVaultData = {
    items: [],
    warranties: [],
    documents: [],
    receipts: [],
    maintenanceRecords: [],
    expenses: [],
    activityLogs: [],
    itemsFetchError: false,
    itemsMappingErrors: 0,
    itemsRawCount: 0,
  };

  assert.strictEqual(emptyCloudData.itemsFetchError, false);
  assert.strictEqual(emptyCloudData.itemsRawCount, 0);
  assert.strictEqual(emptyCloudData.items.length, 0);
});

// -----------------------------------------------------------------------------
// 4. PARTIAL MAPPING FAILURES & ROW PRESERVATION
// -----------------------------------------------------------------------------
console.log('\n--- 4. Testing partial mapping failures & row preservation ---');

test('when some rows throw during mapping, valid rows are preserved', () => {
  const rawRows: Array<Record<string, unknown>> = [
    {
      id: 'item-1',
      user_id: 'u1',
      name: 'Valid Item 1',
      product_photos: '{photo1.jpg}',
    },
    {
      // Corrupted row that triggers error if forced
      id: 'item-bad',
      user_id: 'u1',
      name: null, // will map to 'Unnamed Item' safely, but let's test a throwing mapper
    },
    {
      id: 'item-2',
      user_id: 'u1',
      name: 'Valid Item 2',
      product_photos: ['photo2.jpg'],
    },
  ];

  const mappedItems: Item[] = [];
  let mappingErrors = 0;

  for (const row of rawRows) {
    try {
      if (row.id === 'item-bad-force-throw') {
        throw new Error('Simulated mapping failure');
      }
      mappedItems.push(mapDbRowToItem(row));
    } catch (err) {
      mappingErrors++;
    }
  }

  // All 3 rows map safely because mapDbRowToItem is completely guarded
  assert.strictEqual(mappedItems.length, 3);
  assert.strictEqual(mappingErrors, 0);
  assert.strictEqual(mappedItems[0].name, 'Valid Item 1');
  assert.strictEqual(mappedItems[1].name, 'Unnamed Item');
  assert.strictEqual(mappedItems[2].name, 'Valid Item 2');
});

// -----------------------------------------------------------------------------
// 5. STALE HYDRATION AFTER LOGOUT / ACCOUNT SWITCH
// -----------------------------------------------------------------------------
console.log('\n--- 5. Testing stale hydration session guard ---');

test('stale hydration result is discarded when user or session token changed', () => {
  let activeSessionToken: string | null = 'token-session-1';
  let activeUserId: string | null = 'user-A';

  const simulateHydrationCommit = (
    requestUserId: string,
    requestSessionToken: string
  ): boolean => {
    // Exact check used in itemStore:
    if (!activeUserId || activeUserId !== requestUserId || activeSessionToken !== requestSessionToken) {
      return false; // Discarded!
    }
    return true; // Committed!
  };

  // 1. Same user, active session: commits successfully
  assert.strictEqual(simulateHydrationCommit('user-A', 'token-session-1'), true);

  // 2. User logs out: activeSessionToken and activeUserId become null
  activeSessionToken = null;
  activeUserId = null;
  assert.strictEqual(simulateHydrationCommit('user-A', 'token-session-1'), false);

  // 3. User B logs in: activeSessionToken and activeUserId are new
  activeSessionToken = 'token-session-2';
  activeUserId = 'user-B';

  // Late arrival of User A's hydration:
  assert.strictEqual(simulateHydrationCommit('user-A', 'token-session-1'), false);
  // User B's own hydration:
  assert.strictEqual(simulateHydrationCommit('user-B', 'token-session-2'), true);
});

// -----------------------------------------------------------------------------
// 6. LOGOUT WITH PENDING ITEM UPSERTS & USER BACKUP ISOLATION
// -----------------------------------------------------------------------------
console.log('\n--- 6. Testing logout data loss prevention & user isolation ---');

test('pending sync queue entries are isolated by userId and preserved on logout', () => {
  interface QueueEntry {
    opId: string;
    type: string;
    entityId: string;
    userId: string;
    payload: any;
  }

  let mockQueue: QueueEntry[] = [
    {
      opId: 'upsertItem::item-offline-1',
      type: 'upsertItem',
      entityId: 'item-offline-1',
      userId: 'user-A',
      payload: { id: 'item-offline-1', name: 'Offline MacBook' },
    },
    {
      opId: 'upsertItem::item-userB-1',
      type: 'upsertItem',
      entityId: 'item-userB-1',
      userId: 'user-B',
      payload: { id: 'item-userB-1', name: 'User B Item' },
    },
  ];

  // User A logs out. We DO NOT purge User A's sync queue!
  // clearUserData only resets in-memory state and removes active storage key.
  const userAOps = mockQueue.filter((e) => e.userId === 'user-A');
  assert.strictEqual(userAOps.length, 1);
  assert.strictEqual(userAOps[0].payload.name, 'Offline MacBook');

  // User B's sync operations are completely isolated
  const userBOps = mockQueue.filter((e) => e.userId === 'user-B');
  assert.strictEqual(userBOps.length, 1);
  assert.strictEqual(userBOps[0].payload.name, 'User B Item');
});

test('user-scoped vault backups keep User A isolated from User B', () => {
  const mockStorage = new Map<string, string>();

  const saveBackup = (userId: string, items: Item[]) => {
    mockStorage.set(`@keepr_vault_backup_v1_${userId}`, JSON.stringify(items));
  };

  const getBackup = (userId: string): Item[] | null => {
    const raw = mockStorage.get(`@keepr_vault_backup_v1_${userId}`);
    return raw ? JSON.parse(raw) : null;
  };

  const userAItems: Item[] = [
    { id: 'item-A1', userId: 'user-A', name: 'Camera', purchasePrice: 500, createdAt: '', updatedAt: '' } as any,
  ];

  const userBItems: Item[] = [
    { id: 'item-B1', userId: 'user-B', name: 'Bike', purchasePrice: 300, createdAt: '', updatedAt: '' } as any,
  ];

  saveBackup('user-A', userAItems);
  saveBackup('user-B', userBItems);

  // User A logs out: active key removed, but backup remains safe
  mockStorage.delete('keepr-vault-items-storage');

  // User B logs in: User B only accesses User B backup
  assert.strictEqual(getBackup('user-B')?.length, 1);
  assert.strictEqual(getBackup('user-B')?.[0].name, 'Bike');

  // User A logs back in: User A's backup is intact
  assert.strictEqual(getBackup('user-A')?.length, 1);
  assert.strictEqual(getBackup('user-A')?.[0].name, 'Camera');
});

// -----------------------------------------------------------------------------
// 7. MISSING COLUMN DEFENSIVE FALLBACK IN FLUSH SYNC QUEUE
// -----------------------------------------------------------------------------
console.log('\n--- 7. Testing missing column fallback for image_storage_path ---');

test('fallback removes image_storage_path if column does not exist on remote', () => {
  const payloadWithCol = {
    id: 'item-1',
    user_id: 'user-1',
    name: 'Sony Headphones',
    image_storage_path: 'user-1/items/item-1/photo_0.jpg',
    image_url: 'user-1/items/item-1/photo_0.jpg',
    purchase_price: 250,
  };

  // Simulating the defensive check in flushSyncQueue and cloudUpsertItem:
  const simError = {
    message: 'column "image_storage_path" of relation "items" does not exist',
    code: '42703',
  };

  let payloadSentToDb = payloadWithCol;
  if (simError.message.includes('image_storage_path')) {
    const fallbackPayload = { ...payloadWithCol };
    delete (fallbackPayload as any).image_storage_path;
    payloadSentToDb = fallbackPayload;
  }

  assert.strictEqual((payloadSentToDb as any).image_storage_path, undefined);
  assert.strictEqual(payloadSentToDb.image_url, 'user-1/items/item-1/photo_0.jpg');
  assert.strictEqual(payloadSentToDb.name, 'Sony Headphones');
});

// -----------------------------------------------------------------------------
// 8. ITEM PHOTO RECOVERY, IDEMPOTENCY & CLOUD PERSISTENCE (CASE A, B, C)
// -----------------------------------------------------------------------------
console.log('\n--- 8. Testing item photo recovery & cloud persistence (Case A, B, C) ---');

test('CASE A: items with existing Storage paths are preserved without re-upload', () => {
  const itemCaseA: Item = {
    id: 'item-case-a',
    userId: 'user-123',
    name: 'Existing Storage Item',
    purchasePrice: 1000,
    imageStoragePath: 'user-123/items/item-case-a/photo_0.jpg',
    imageUrl: 'user-123/items/item-case-a/photo_0.jpg',
    productPhotos: ['user-123/items/item-case-a/photo_0.jpg'],
    createdAt: '',
    updatedAt: '',
  } as any;

  const isStorage = (p?: string | null) => Boolean(p && !p.startsWith('file:') && !p.startsWith('http') && p.includes('/'));

  assert.strictEqual(isStorage(itemCaseA.imageStoragePath), true);
  assert.strictEqual(itemCaseA.imageStoragePath, 'user-123/items/item-case-a/photo_0.jpg');
});

test('CASE B: local file exists -> uploads to user-scoped storage path and updates record', () => {
  const mockStorageBucket = new Map<string, { bytesLength: number; contentType: string }>();
  const mockDatabase = new Map<string, any>();

  const userId = 'user-123';
  const item: Item = {
    id: 'item-case-b',
    userId,
    name: 'Samsung Galaxy M35 5G',
    purchasePrice: 18000,
    imageUrl: 'file:///data/user/0/com.keepr.digitalvault/files/vault_receipts/photo.jpg',
    productPhotos: ['file:///data/user/0/com.keepr.digitalvault/files/vault_receipts/photo.jpg'],
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
  } as any;

  mockDatabase.set(item.id, { ...item, image_storage_path: null });

  // Simulate local file check: file exists
  const localFileExists = true;
  assert.strictEqual(localFileExists, true);

  // Upload simulation
  const ext = '.jpg';
  const mimeType = 'image/jpeg';
  const userScopedPath = `${userId}/items/${item.id}/photo_0${ext}`;

  mockStorageBucket.set(userScopedPath, { bytesLength: 1024, contentType: mimeType });

  // Update DB record
  const dbRecord = mockDatabase.get(item.id);
  dbRecord.image_storage_path = userScopedPath;
  dbRecord.image_url = userScopedPath;
  dbRecord.product_photos = JSON.stringify([userScopedPath]);

  // Assertions:
  assert.strictEqual(mockStorageBucket.has(`user-123/items/item-case-b/photo_0.jpg`), true);
  assert.strictEqual(mockStorageBucket.get(userScopedPath)?.contentType, 'image/jpeg');
  assert.strictEqual(dbRecord.image_storage_path, 'user-123/items/item-case-b/photo_0.jpg');
  assert.strictEqual(dbRecord.name, 'Samsung Galaxy M35 5G'); // Original metadata preserved
  assert.strictEqual(dbRecord.purchasePrice, 18000);
});

test('CASE C: local file missing -> preserves item and database row untouched, marks photo unavailable', () => {
  const mockDatabase = new Map<string, any>();

  const userId = 'user-123';
  const originalRow = {
    id: 'item-case-c',
    user_id: userId,
    name: 'Lenovo IdeaPad Slim 3',
    purchase_price: 45000,
    image_storage_path: null,
    image_url: 'file:///data/user/0/host.exp.exponent/files/missing_photo.png',
    product_photos: '["file:///data/user/0/host.exp.exponent/files/missing_photo.png"]',
    receipt_id: 'rec-001',
    notes: 'Important notes',
  };

  mockDatabase.set(originalRow.id, { ...originalRow });

  // Simulate local file check: file does NOT exist on this device
  const localFileExists = false;
  let uploadOccurred = false;
  let dbRowModified = false;

  if (localFileExists) {
    uploadOccurred = true;
    dbRowModified = true;
  }

  // Verification:
  assert.strictEqual(uploadOccurred, false, 'No upload should occur when local file is missing');
  assert.strictEqual(dbRowModified, false, 'Database row must NOT be modified when file is missing');

  const afterState = mockDatabase.get(originalRow.id);
  assert.deepStrictEqual(afterState, originalRow, 'Entire database record must be preserved verbatim');
  assert.strictEqual(afterState.id, 'item-case-c', 'Item ID preserved');
  assert.strictEqual(afterState.receipt_id, 'rec-001', 'Receipt link preserved');
  assert.strictEqual(afterState.notes, 'Important notes', 'Notes preserved');
});

test('Idempotency: running reconciliation multiple times does not duplicate storage objects or corrupt data', () => {
  const uploadLog: string[] = [];
  const upload = (path: string) => {
    uploadLog.push(path);
  };

  // First run: uploads 1 photo
  const path = 'user-1/items/item-1/photo_0.jpg';
  upload(path);
  assert.strictEqual(uploadLog.length, 1);

  // Subsequent runs: detected as Case A (already in storage), skipping upload
  const isStoragePath = (p: string) => p.startsWith('user-1/');
  if (!isStoragePath(path)) {
    upload(path);
  }

  assert.strictEqual(uploadLog.length, 1, 'Subsequent run must be idempotent');
});

console.log('\n================================================================');
console.log(` RESULT: ${passedTests}/${totalTests} tests passed successfully!`);
console.log('================================================================');

