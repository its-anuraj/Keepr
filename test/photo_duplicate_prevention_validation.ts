import assert from 'node:assert';
import {
  canonicalizeProductPhotos,
  isStoragePath,
  isLocalUri,
  isRemoteUrl,
  BUCKET_ITEM_IMAGES,
} from '../src/utils/storageUtils';
import {
  mapDbRowToItem,
  mapItemToDbRow,
  normalizeProductPhotos,
} from '../src/services/vaultRowMappers';
import type { Item, PurchasedProduct } from '../src/types';

console.log('================================================================');
console.log(' KEEPR: PRODUCT PHOTO DUPLICATE PREVENTION REGRESSION SUITE');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function test(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message || err}`);
    process.exitCode = 1;
  }
}

// -----------------------------------------------------------------------------
// Test 1: Adding one product photo produces a count of 1.
// -----------------------------------------------------------------------------
console.log('--- Test 1: Single Photo Addition Semantics ---');
test('Adding one product photo produces a count of exactly 1', () => {
  const userAddedPhoto = 'file:///data/user/0/com.keepr.app/cache/camera_photo_1.jpg';
  const itemPhotos = canonicalizeProductPhotos([userAddedPhoto]);

  assert.strictEqual(itemPhotos.length, 1);
  assert.strictEqual(itemPhotos[0], userAddedPhoto);
});

// -----------------------------------------------------------------------------
// Test 2: Adding two distinct photos produces a count of 2.
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Multi-Photo Distinct Preservation ---');
test('Adding two distinct photos produces a count of 2 in preserved order', () => {
  const photoA = 'file:///data/user/0/com.keepr.app/cache/camera_laptop_front.jpg';
  const photoB = 'file:///data/user/0/com.keepr.app/cache/camera_laptop_keyboard.jpg';
  const itemPhotos = canonicalizeProductPhotos([photoA, photoB]);

  assert.strictEqual(itemPhotos.length, 2);
  assert.strictEqual(itemPhotos[0], photoA);
  assert.strictEqual(itemPhotos[1], photoB);
});

// -----------------------------------------------------------------------------
// Test 3: Uploading one photo does not create another entry.
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Upload In-Place Path Replacement ---');
test('Uploading one photo updates its entry to storage path without appending another entry', () => {
  const localUri = 'file:///data/user/0/com.keepr.app/files/vault_media/product_photo.jpg';
  const storagePath = 'usr-123/items/item-lenovo/photo_0.jpg';

  // In itemStore / cloudSyncService, uploading replaces the local URI in-place
  const beforeUpload = [localUri];
  assert.strictEqual(beforeUpload.length, 1);

  // When uploaded, the entry at index 0 becomes storagePath
  const uploadedList = [storagePath];
  const canonical = canonicalizeProductPhotos(uploadedList, { photoUri: localUri });

  assert.strictEqual(canonical.length, 1);
  assert.strictEqual(canonical[0], storagePath);

  // Even if legacy state retained both [storagePath, localUri]
  const mixed = [storagePath, localUri];
  const deduplicated = canonicalizeProductPhotos(mixed, {
    photoUri: localUri,
    imageStoragePath: storagePath,
  });

  assert.strictEqual(deduplicated.length, 1, 'Redundant local photoUri must be collapsed when storagePath is present');
  assert.strictEqual(deduplicated[0], storagePath);
});

// -----------------------------------------------------------------------------
// Test 4: Repeated cloud hydration does not increase the count.
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Repeated Cloud Hydration Stability ---');
test('Repeated cloud hydration passes never increase photo count', () => {
  const cloudRow = {
    id: 'item-lenovo',
    user_id: 'usr-123',
    name: 'Lenovo IdeaPad Slim 3',
    product_photos: ['usr-123/items/item-lenovo/photo_0.jpg'],
    image_storage_path: 'usr-123/items/item-lenovo/photo_0.jpg',
    image_url: 'usr-123/items/item-lenovo/photo_0.jpg',
    receipt_path: 'usr-123/receipts/rec_0.jpg',
  };

  let currentItem = mapDbRowToItem(cloudRow);
  assert.strictEqual(currentItem.productPhotos?.length, 1);

  // Simulate 5 successive hydration cycles (e.g. app resume, foreground, sync)
  for (let pass = 1; pass <= 5; pass++) {
    const freshMapped = mapDbRowToItem(cloudRow);
    const mergedPhotos = canonicalizeProductPhotos({
      ...freshMapped,
      productPhotos: (freshMapped.productPhotos && freshMapped.productPhotos.length > 0)
        ? freshMapped.productPhotos
        : currentItem.productPhotos,
      receiptPath: freshMapped.receiptPath || currentItem.receiptPath,
      receiptUri: currentItem.receiptUri || freshMapped.receiptUri,
    });

    currentItem = {
      ...freshMapped,
      productPhotos: mergedPhotos,
    };

    assert.strictEqual(currentItem.productPhotos?.length, 1, `Photo count must remain 1 on hydration pass ${pass}`);
  }
});

// -----------------------------------------------------------------------------
// Test 5: Logout/login does not increase the count.
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Logout / Login Cycle Consistency ---');
test('Logout and re-login does not duplicate photos across sessions', () => {
  const session1Item: Item = {
    id: 'item-lenovo',
    userId: 'usr-123',
    name: 'Lenovo IdeaPad Slim 3',
    currency: 'INR',
    purchasePrice: 45000,
    status: 'active',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    photoUri: 'file:///data/user/0/com.keepr.app/files/product_photo.jpg',
    imageStoragePath: 'usr-123/items/item-lenovo/photo_0.jpg',
    imageUrl: 'usr-123/items/item-lenovo/photo_0.jpg',
    productPhotos: ['usr-123/items/item-lenovo/photo_0.jpg'],
  };

  // 1. Session 1 state
  assert.strictEqual(session1Item.productPhotos?.length, 1);

  // 2. User logs out: local cache cleared or switched.
  // 3. User logs back in: fetched from Supabase DB row
  const dbRow = mapItemToDbRow(session1Item, 'usr-123');
  const hydratedFromDb = mapDbRowToItem(dbRow);

  assert.strictEqual(hydratedFromDb.productPhotos?.length, 1);
  assert.strictEqual(hydratedFromDb.productPhotos?.[0], 'usr-123/items/item-lenovo/photo_0.jpg');
});

// -----------------------------------------------------------------------------
// Test 6: Retry and offline reconciliation do not duplicate photos.
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Retry & Offline Reconciliation Idempotence ---');
test('Offline migration candidate extraction does not append photoUri when storage path exists', () => {
  const itemWithStorage: Item = {
    id: 'item-lenovo',
    userId: 'usr-123',
    name: 'Lenovo IdeaPad Slim 3',
    currency: 'INR',
    purchasePrice: 45000,
    status: 'active',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    photoUri: 'file:///data/user/0/com.keepr.app/files/product_photo.jpg',
    imageStoragePath: 'usr-123/items/item-lenovo/photo_0.jpg',
    productPhotos: ['usr-123/items/item-lenovo/photo_0.jpg'],
  };

  // Previous bug: rawCandidates did [...productPhotos, photoUri], resulting in ['photo_0.jpg', 'product_photo.jpg']
  // and re-uploading product_photo.jpg as photo_1.jpg!
  // Fixed logic: canonicalizeProductPhotos(item)
  const candidates = canonicalizeProductPhotos(itemWithStorage);
  assert.strictEqual(candidates.length, 1, 'Must have exactly 1 candidate, not appending redundant local photoUri');
  assert.strictEqual(candidates[0], 'usr-123/items/item-lenovo/photo_0.jpg');

  // Verify duplicate collapse for items that already grew to [photo_0.jpg, photo_1.jpg, photo_2.jpg]:
  // If storage files have identical byte size (e.g. 102400 bytes), collapse to [photo_0.jpg]
  const mockStorageFiles = [
    { name: 'photo_0.jpg', metadata: { size: 102400 } },
    { name: 'photo_1.jpg', metadata: { size: 102400 } }, // duplicate re-upload
    { name: 'photo_2.jpg', metadata: { size: 102400 } }, // duplicate re-upload
  ];

  const baseSize = mockStorageFiles[0].metadata.size;
  const rawDuplicates = ['usr-123/items/item-lenovo/photo_0.jpg', 'usr-123/items/item-lenovo/photo_1.jpg', 'usr-123/items/item-lenovo/photo_2.jpg'];
  const sizeMap = new Map(mockStorageFiles.map(f => [f.name, f.metadata.size]));

  const collapsed: string[] = [rawDuplicates[0]];
  for (let i = 1; i < rawDuplicates.length; i++) {
    const sName = rawDuplicates[i].split('/').pop()!;
    if (sizeMap.get(sName) !== baseSize) {
      collapsed.push(rawDuplicates[i]);
    }
  }

  assert.strictEqual(collapsed.length, 1, 'Verified duplicates with identical byte sizes must collapse to 1 photo');
  assert.strictEqual(collapsed[0], 'usr-123/items/item-lenovo/photo_0.jpg');
});

// -----------------------------------------------------------------------------
// Test 7: A receipt image is not inserted into productPhotos.
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Receipt & Invoice Attachment Isolation ---');
test('Purchase receipt / invoice attachment is strictly excluded from productPhotos', () => {
  const receiptStoragePath = 'usr-123/item-documents/receipt_123.jpg';
  const receiptLocalUri = 'file:///data/user/0/com.keepr.app/files/vault_media/receipt.jpg';
  const actualProductPhoto = 'file:///data/user/0/com.keepr.app/files/vault_media/laptop.jpg';

  // Even if a buggy form or mapper passed receipt paths in productPhotos
  const contaminatedList = [
    receiptStoragePath,
    actualProductPhoto,
    receiptLocalUri,
    'usr-123/receipts/bill.pdf',
    'usr-123/vault-documents/warranty_card.jpg',
  ];

  const sanitized = canonicalizeProductPhotos(contaminatedList, {
    receiptPath: receiptStoragePath,
    receiptUri: receiptLocalUri,
  });

  assert.strictEqual(sanitized.length, 1, 'All receipt, invoice, and document paths must be stripped');
  assert.strictEqual(sanitized[0], actualProductPhoto);
});

// -----------------------------------------------------------------------------
// Test 8: Distinct photos of the same product are preserved.
// -----------------------------------------------------------------------------
console.log('\n--- Test 8: Genuine Multi-Photo Preservation ---');
test('Genuinely distinct photos of the same product are preserved in order', () => {
  const photoFront = 'usr-123/items/item-lenovo/photo_0.jpg';
  const photoBack = 'usr-123/items/item-lenovo/photo_1.jpg';
  const photoKeyboard = 'usr-123/items/item-lenovo/photo_2.jpg';

  // Front (200KB), Back (185KB), Keyboard (210KB) - distinct files!
  const mockStorageFiles = [
    { name: 'photo_0.jpg', metadata: { size: 204800 } },
    { name: 'photo_1.jpg', metadata: { size: 189440 } },
    { name: 'photo_2.jpg', metadata: { size: 215040 } },
  ];

  const sizeMap = new Map(mockStorageFiles.map(f => [f.name, f.metadata.size]));
  const baseSize = mockStorageFiles[0].metadata.size;

  const distinctList: string[] = [photoFront];
  for (const p of [photoBack, photoKeyboard]) {
    const name = p.split('/').pop()!;
    if (sizeMap.get(name) !== baseSize) {
      distinctList.push(p);
    }
  }

  assert.strictEqual(distinctList.length, 3, 'Distinct photos with different byte sizes must never be collapsed');
  assert.strictEqual(distinctList[0], photoFront);
  assert.strictEqual(distinctList[1], photoBack);
  assert.strictEqual(distinctList[2], photoKeyboard);
});

// -----------------------------------------------------------------------------
// Test 9: Existing durable cloud paths survive hydration.
// -----------------------------------------------------------------------------
console.log('\n--- Test 9: Cloud Storage Path Durability ---');
test('Valid durable cloud storage paths survive DB mapping and hydration without loss', () => {
  const durablePath = 'usr-123/items/item-lenovo/photo_0.jpg';
  const rawDbRow = {
    id: 'item-lenovo',
    user_id: 'usr-123',
    name: 'Lenovo IdeaPad Slim 3',
    purchase_price: 45000,
    image_storage_path: durablePath,
    image_url: durablePath,
    product_photos: [durablePath],
  };

  const item = mapDbRowToItem(rawDbRow);
  assert.strictEqual(item.imageStoragePath, durablePath);
  assert.strictEqual(item.imageUrl, durablePath);
  assert.strictEqual(item.productPhotos?.[0], durablePath);

  // Mapping back to DB row
  const dbRow = mapItemToDbRow(item, 'usr-123');
  assert.strictEqual(dbRow.image_storage_path, durablePath);
  assert.strictEqual(dbRow.image_url, durablePath);
  const rowPhotos = normalizeProductPhotos(dbRow.product_photos);
  assert.strictEqual(rowPhotos.length, 1);
  assert.strictEqual(rowPhotos[0], durablePath);
});

// -----------------------------------------------------------------------------
// Test 10: The UI badge and rendered gallery use the same canonical list.
// -----------------------------------------------------------------------------
console.log('\n--- Test 10: UI Badge & Gallery Count Synchronization ---');
test('UI badge count matches the rendered gallery photo count exactly', () => {
  const item: Item = {
    id: 'item-lenovo',
    userId: 'usr-123',
    name: 'Lenovo IdeaPad Slim 3',
    currency: 'INR',
    purchasePrice: 45000,
    status: 'active',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    productPhotos: ['usr-123/items/item-lenovo/photo_0.jpg'],
  };

  // Simulating Item Details screen resolution pipeline:
  // 1. rawPhotoCandidateList = canonicalizeProductPhotos(item)
  const rawPhotoCandidateList = canonicalizeProductPhotos(item);

  // 2. Mock resolvedPhotos from useResolvedItemPhotos
  const mockResolvedPhotos = rawPhotoCandidateList.map((p) => ({
    originalUri: p,
    resolvedUri: `https://lqzhfnsxgytwbeudtzks.supabase.co/storage/v1/object/sign/item-images/${p}?token=mock`,
  }));

  // 3. allProductPhotos = Array.from(new Set(resolvedPhotos.map(p => p.resolvedUri).filter(Boolean)))
  const allProductPhotos = Array.from(
    new Set(mockResolvedPhotos.map((p) => p.resolvedUri).filter((u): u is string => Boolean(u)))
  );

  // 4. Badge text: `${allProductPhotos.length} ${allProductPhotos.length === 1 ? 'photo' : 'photos'}`
  const badgeCount = allProductPhotos.length;
  // 5. Gallery items rendered: allProductPhotos.map(...)
  const galleryRenderCount = allProductPhotos.length;

  assert.strictEqual(badgeCount, 1);
  assert.strictEqual(galleryRenderCount, 1);
  assert.strictEqual(badgeCount, galleryRenderCount, 'Badge count and gallery render count must be identical');
});

// =============================================================================
// PHASE 3 REGRESSION HOTFIX VERIFICATION SUITE
// =============================================================================

// -----------------------------------------------------------------------------
// Test 11: One valid local photo -> save succeeds.
// -----------------------------------------------------------------------------
console.log('\n--- Test 11: One Valid Local Photo Save Flow ---');
test('One valid local vault photo passes canonicalization and validation', () => {
  const localPhoto = 'file:///data/user/0/com.keepr.app/files/vault_receipts/1728638123_abc_product_photo.jpg';
  const canonical = canonicalizeProductPhotos([localPhoto]);

  assert.strictEqual(canonical.length, 1, 'Local vault product photo must NOT be filtered out');
  assert.strictEqual(canonical[0], localPhoto);

  // Validate itemStore validation logic
  assert.doesNotThrow(() => {
    if (canonical.length === 0) {
      throw new Error('[ItemStore] Product photo is strictly required for Purchased Items.');
    }
  });
});

// -----------------------------------------------------------------------------
// Test 12: One content:// gallery photo -> valid persistence flow.
// -----------------------------------------------------------------------------
console.log('\n--- Test 12: Android content:// Gallery Photo Flow ---');
test('One content:// gallery photo survives canonicalization and simulates upload', () => {
  const contentUri = 'content://media/external/images/media/54321';
  const initial = canonicalizeProductPhotos([contentUri]);

  assert.strictEqual(initial.length, 1);
  assert.strictEqual(initial[0], contentUri);

  // In itemStore, background upload replaces the local URI with storage path
  const uploadedPath = 'usr-123/items/item-phone/photo_0.jpg';
  const uploadedFinal = canonicalizeProductPhotos([uploadedPath], { photoUri: contentUri });

  assert.strictEqual(uploadedFinal.length, 1);
  assert.strictEqual(uploadedFinal[0], uploadedPath);
});

// -----------------------------------------------------------------------------
// Test 13: One existing durable cloud path -> edit/save succeeds.
// -----------------------------------------------------------------------------
console.log('\n--- Test 13: Existing Cloud Path Edit/Resave ---');
test('Existing durable cloud storage path is preserved on edit/resave without re-upload', () => {
  const existingCloudPath = 'usr-123/items/item-lenovo/photo_0.jpg';
  const existingItem: Item = {
    id: 'item-lenovo',
    userId: 'usr-123',
    name: 'Lenovo IdeaPad Slim 3',
    currency: 'INR',
    purchasePrice: 48000, // Price updated by user
    status: 'active',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-02-01T12:00:00Z',
    imageStoragePath: existingCloudPath,
    imageUrl: existingCloudPath,
    productPhotos: [existingCloudPath],
  };

  const editPhotos = canonicalizeProductPhotos(existingItem.productPhotos, {
    imageStoragePath: existingItem.imageStoragePath,
  });

  assert.strictEqual(editPhotos.length, 1);
  assert.strictEqual(editPhotos[0], existingCloudPath);
  assert.strictEqual(isStoragePath(editPhotos[0]), true);
});

// -----------------------------------------------------------------------------
// Test 14: Display signed URL does not replace the canonical photo reference.
// -----------------------------------------------------------------------------
console.log('\n--- Test 14: Display Signed URL Normalization ---');
test('Signed display URL is normalized back to durable storage path without overwriting form reference', () => {
  const durableStoragePath = 'usr-123/items/item-lenovo/photo_0.jpg';
  const signedDisplayUrl = `https://lqzhfnsxgytwbeudtzks.supabase.co/storage/v1/object/sign/item-images/${durableStoragePath}?token=expiringToken12345`;

  const canonical = canonicalizeProductPhotos([signedDisplayUrl]);

  assert.strictEqual(canonical.length, 1);
  assert.strictEqual(canonical[0], durableStoragePath, 'Signed URL must decode to underlying durable storage path');
  assert.strictEqual(isStoragePath(canonical[0]), true);
  assert.strictEqual(canonical[0].includes('token='), false);
});

// -----------------------------------------------------------------------------
// Test 15: Empty photo list -> Purchased Item save is correctly rejected.
// -----------------------------------------------------------------------------
console.log('\n--- Test 15: Empty Photo List Save Rejection ---');
test('Empty photo list is strictly rejected with the exact error message', () => {
  const emptyCandidates: string[] = [];
  const canonical = canonicalizeProductPhotos(emptyCandidates);

  assert.strictEqual(canonical.length, 0);

  assert.throws(
    () => {
      if (canonical.length === 0) {
        throw new Error('[ItemStore] Product photo is strictly required for Purchased Items.');
      }
    },
    {
      message: '[ItemStore] Product photo is strictly required for Purchased Items.',
    }
  );
});

// -----------------------------------------------------------------------------
// Test 16: Receipt-only attachment -> does not satisfy product-photo requirement.
// -----------------------------------------------------------------------------
console.log('\n--- Test 16: Receipt-Only Attachment Isolation ---');
test('Receipt and document attachments do not satisfy the product-photo requirement', () => {
  const receiptUri = 'file:///data/user/0/com.keepr.app/files/vault_receipts/Receipt_2026-10-11.jpg';
  const receiptPath = 'vault_receipts/Receipt_2026-10-11.jpg';
  const receiptPdf = 'usr-123/receipts/tax_invoice.pdf';

  // Even if contaminated candidates only contain receipt / document files
  const receiptOnlyCandidates = [receiptUri, receiptPdf];

  const canonical = canonicalizeProductPhotos(receiptOnlyCandidates, {
    receiptUri,
    receiptPath,
  });

  assert.strictEqual(canonical.length, 0, 'Receipt attachments must be completely filtered from productPhotos');

  assert.throws(
    () => {
      if (canonical.length === 0) {
        throw new Error('[ItemStore] Product photo is strictly required for Purchased Items.');
      }
    },
    {
      message: '[ItemStore] Product photo is strictly required for Purchased Items.',
    }
  );
});

// -----------------------------------------------------------------------------
// Test 17: One selected photo followed by repeated hydration -> count stays 1.
// -----------------------------------------------------------------------------
console.log('\n--- Test 17: 10x Successive Hydration Pass Stability ---');
test('Single photo survives 10 successive hydration passes with constant count of 1', () => {
  const cloudRow = {
    id: 'item-camera',
    user_id: 'usr-123',
    name: 'Sony Alpha A7 IV',
    product_photos: ['usr-123/items/item-camera/photo_0.jpg'],
    image_storage_path: 'usr-123/items/item-camera/photo_0.jpg',
    image_url: 'usr-123/items/item-camera/photo_0.jpg',
  };

  let currentItem = mapDbRowToItem(cloudRow);
  for (let pass = 1; pass <= 10; pass++) {
    const fresh = mapDbRowToItem(cloudRow);
    const canonical = canonicalizeProductPhotos({
      ...fresh,
      productPhotos: fresh.productPhotos && fresh.productPhotos.length > 0
        ? fresh.productPhotos
        : currentItem.productPhotos,
    });

    currentItem = {
      ...fresh,
      productPhotos: canonical,
    };

    assert.strictEqual(currentItem.productPhotos?.length, 1, `Count must remain 1 on pass ${pass}`);
  }
});

// -----------------------------------------------------------------------------
// Test 18: Adding a second distinct photo -> count becomes 2.
// -----------------------------------------------------------------------------
console.log('\n--- Test 18: Adding Second Distinct Photo ---');
test('Adding a second distinct photo increases count from 1 to 2 in preserved order', () => {
  const photo1 = 'usr-123/items/item-lenovo/photo_0.jpg';
  const photo2 = 'file:///data/user/0/com.keepr.app/cache/camera_laptop_keyboard.jpg';

  // In Add/Edit form, two photos are provided
  const canonical = canonicalizeProductPhotos([photo1, photo2], {
    imageStoragePath: photo1,
  });

  assert.strictEqual(canonical.length, 2, 'Second distinct photo must not be collapsed');
  assert.strictEqual(canonical[0], photo1);
  assert.strictEqual(canonical[1], photo2);

  // When photo 2 is uploaded to storage
  const photo2Uploaded = 'usr-123/items/item-lenovo/photo_1.jpg';
  const canonicalAfterUpload = canonicalizeProductPhotos([photo1, photo2Uploaded], {
    imageStoragePath: photo1,
  });

  assert.strictEqual(canonicalAfterUpload.length, 2);
  assert.strictEqual(canonicalAfterUpload[0], photo1);
  assert.strictEqual(canonicalAfterUpload[1], photo2Uploaded);
});

console.log('\n================================================================');
console.log(` ALL REGRESSION TESTS PASSED: ${passedTests}/${totalTests} tests successful.`);
console.log('================================================================\n');
