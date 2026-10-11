import assert from 'node:assert';
import {
  isStoragePath,
  isLocalUri,
  isRemoteUrl,
  cleanStoragePath,
  extractItemImageCandidates,
  extractDocumentImageCandidates,
  canonicalizeProductPhotos,
  setCachedSignedUrl,
  getCachedSignedUrl,
  clearSignedUrlCache,
  invalidateSignedUrlCache,
  BUCKET_ITEM_IMAGES,
  BUCKET_ITEM_DOCUMENTS,
  BUCKET_VAULT_DOCUMENTS,
} from '../src/utils/storageUtils';
import {
  mapDbRowToItem,
  mapItemToDbRow,
  normalizeProductPhotos,
} from '../src/services/vaultRowMappers';
import type { Item, VaultDocument, RecentlyAddedEntry } from '../src/types';

console.log('================================================================');
console.log(' KEEPR: ITEM THUMBNAIL PIPELINE & ROOT-CAUSE REGRESSION SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        console.log(`  ✓ PASS: ${name}`);
        passedTests++;
      }).catch((err) => {
        console.error(`  ✗ FAIL: ${name}`);
        console.error(`    Error: ${err.message}`);
        throw err;
      });
    } else {
      console.log(`  ✓ PASS: ${name}`);
      passedTests++;
    }
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

async function runAllTests() {
  // ---------------------------------------------------------------------------
  // Case 1: Working cloud product photo
  // ---------------------------------------------------------------------------
  console.log('--- 1. Working Cloud Product Photo ---');
  test('Cloud product photo path is recognized and preserved', () => {
    const cloudPath = 'user_123/items/item_abc/photo_0.jpg';
    assert.strictEqual(isStoragePath(cloudPath), true);
    assert.strictEqual(cleanStoragePath(cloudPath), cloudPath);

    const item: Item = {
      id: 'item_abc',
      userId: 'user_123',
      name: 'Lenovo ThinkPad X1',
      purchasePrice: 120000,
      currency: 'INR',
      status: 'active',
      imageStoragePath: cloudPath,
      imageUrl: cloudPath,
      productPhotos: [cloudPath],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const candidates = extractItemImageCandidates(item);
    assert.strictEqual(candidates.storagePath, cloudPath);
    assert.strictEqual(candidates.remoteUrl, null);
  });

  // ---------------------------------------------------------------------------
  // Case 2: Valid storage path requiring a signed URL & Cache Flow
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Storage Path Signed URL & Cache Flow ---');
  test('Signed URL cache stores and returns unexpired URL for storage path', () => {
    clearSignedUrlCache();
    const path = 'user_123/items/item_abc/photo_0.jpg';
    const fakeSignedUrl = 'https://supabase.co/storage/v1/object/sign/item-images/' + path + '?token=xyz';

    setCachedSignedUrl(path, fakeSignedUrl, 3600);
    const cached = getCachedSignedUrl(path);
    assert.strictEqual(cached, fakeSignedUrl);
  });

  // ---------------------------------------------------------------------------
  // Case 3: Expired signed URL requiring refresh & cache invalidation
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Expired Signed URL & Cache Invalidation ---');
  test('Expired signed URL returns null and invalidation removes all keys', () => {
    clearSignedUrlCache();
    const path = 'user_123/items/item_abc/photo_0.jpg';
    const fakeSignedUrl = 'https://supabase.co/storage/v1/object/sign/item-images/' + path + '?token=expired';

    // Simulate expired by setting 0 second TTL
    setCachedSignedUrl(path, fakeSignedUrl, -10);
    assert.strictEqual(getCachedSignedUrl(path), null);

    // Invalidation check
    setCachedSignedUrl(path, fakeSignedUrl, 3600);
    setCachedSignedUrl(`${BUCKET_ITEM_IMAGES}:${path}`, fakeSignedUrl, 3600);
    invalidateSignedUrlCache(path);
    assert.strictEqual(getCachedSignedUrl(path), null);
    assert.strictEqual(getCachedSignedUrl(`${BUCKET_ITEM_IMAGES}:${path}`), null);
  });

  // ---------------------------------------------------------------------------
  // Case 4: Missing Storage object handling
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Missing Storage Object Handling ---');
  test('Null or non-existent storage candidates safely resolve to null candidates', () => {
    const emptyItem: Item = {
      id: 'item_missing',
      userId: 'user_123',
      name: 'Item without photo',
      purchasePrice: 1000,
      currency: 'INR',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const candidates = extractItemImageCandidates(emptyItem);
    assert.strictEqual(candidates.storagePath, null);
    assert.strictEqual(candidates.remoteUrl, null);
    assert.strictEqual(candidates.localUri, null);
  });

  // ---------------------------------------------------------------------------
  // Case 5: Local photo + cloud path priority
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Local Photo vs Cloud Path Priority ---');
  test('Durable cloud storage path is prioritized while local URI is dropped if redundant', () => {
    const cloudPath = 'user_123/items/item_abc/photo_0.jpg';
    const localUri = 'file:///data/user/0/com.keepr/cache/photo_0.jpg';

    const item: Item = {
      id: 'item_abc',
      userId: 'user_123',
      name: 'Lenovo IdeaPad',
      purchasePrice: 45000,
      currency: 'INR',
      status: 'active',
      photoUri: localUri,
      imageStoragePath: cloudPath,
      imageUrl: cloudPath,
      productPhotos: [cloudPath, localUri],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const candidates = extractItemImageCandidates(item);
    assert.strictEqual(candidates.storagePath, cloudPath);

    // Canonicalization drops redundant local photoUri when cloud storagePath is present
    const canonical = canonicalizeProductPhotos(item);
    assert.strictEqual(canonical.length, 1);
    assert.strictEqual(canonical[0], cloudPath);
  });

  // ---------------------------------------------------------------------------
  // Case 6: Multiple product photos without duplicates
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Multiple Product Photos Without Duplicates ---');
  test('Preserves multiple distinct photos in order without duplicating or dropping', () => {
    const photo1 = 'user_123/items/item_abc/photo_0.jpg';
    const photo2 = 'user_123/items/item_abc/photo_1.jpg';
    const photo3 = 'user_123/items/item_abc/photo_2.jpg';

    const input = [photo1, photo2, photo1, photo3, photo2];
    const canonical = canonicalizeProductPhotos(input);

    assert.deepStrictEqual(canonical, [photo1, photo2, photo3]);
  });

  // ---------------------------------------------------------------------------
  // Case 7: ROOT CAUSE A REGRESSION — Receipt named photo_0.jpg isolation
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. ROOT CAUSE A: Receipt Named photo_0.jpg Isolation ---');
  test('Receipt URI or path with generic name photo_0.jpg does NOT drop product photo photo_0.jpg', () => {
    const productPhoto = 'user_123/items/item_lenovo/photo_0.jpg';
    const receiptUri = 'file:///data/user/0/com.keepr/cache/photo_0.jpg'; // camera saved receipt as photo_0.jpg

    const canonical = canonicalizeProductPhotos([productPhoto], {
      receiptUri,
      receiptPath: receiptUri,
    });

    assert.strictEqual(canonical.length, 1, 'Product photo must NOT be dropped by generic receipt filename!');
    assert.strictEqual(canonical[0], productPhoto);
  });

  test('Genuine receipt pattern files ARE correctly excluded from product photos', () => {
    const validPhoto = 'user_123/items/item_lenovo/photo_0.jpg';
    const invoicePdf = 'user_123/items/item_lenovo/invoice.pdf';
    const receiptJpg = 'user_123/items/item_lenovo/receipt_scan.jpg';
    const itemDoc = 'user_123/item-documents/item_lenovo/doc.jpg';

    const canonical = canonicalizeProductPhotos([validPhoto, invoicePdf, receiptJpg, itemDoc]);
    assert.deepStrictEqual(canonical, [validPhoto]);
  });

  // ---------------------------------------------------------------------------
  // Case 8: ROOT CAUSE B & C — Storage path cleaning & URL normalization
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. ROOT CAUSE B & C: Storage Path Cleaning & Normalization ---');
  test('cleanStoragePath extracts canonical relative path from various formats', () => {
    const expected = 'user_123/items/item_abc/photo_0.jpg';

    // 1. Signed URL
    const signedUrl = `https://xxx.supabase.co/storage/v1/object/sign/item-images/${expected}?token=xyz`;
    assert.strictEqual(cleanStoragePath(signedUrl), expected);

    // 2. Public URL
    const publicUrl = `https://xxx.supabase.co/storage/v1/object/public/item-images/${expected}`;
    assert.strictEqual(cleanStoragePath(publicUrl), expected);

    // 3. Bucket-prefixed path
    const prefixed = `item-images/${expected}`;
    assert.strictEqual(cleanStoragePath(prefixed), expected);

    // 4. Leading slash
    const leadingSlash = `/${expected}`;
    assert.strictEqual(cleanStoragePath(leadingSlash), expected);

    // 5. Already clean
    assert.strictEqual(cleanStoragePath(expected), expected);
  });

  // ---------------------------------------------------------------------------
  // Case 9: Consistent rendering in Items card and Recently Added
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Items Card & Recently Added Consistency ---');
  test('Items card and Recently Added thumbnail extract identical storage candidate', () => {
    const item: Item = {
      id: 'item_lenovo_ideapad',
      userId: 'user_123',
      name: 'Lenovo IdeaPad Slim 3',
      purchasePrice: 48000,
      currency: 'INR',
      status: 'active',
      imageStoragePath: 'user_123/items/item_lenovo_ideapad/photo_0.jpg',
      imageUrl: 'user_123/items/item_lenovo_ideapad/photo_0.jpg',
      productPhotos: ['user_123/items/item_lenovo_ideapad/photo_0.jpg'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const entry: RecentlyAddedEntry = {
      id: item.id,
      entityType: 'PURCHASED_ITEM',
      title: item.name,
      category: 'electronics',
      createdAt: item.createdAt,
      thumbnail: item.imageStoragePath || item.imageUrl,
      item,
    };

    const itemCandidate = extractItemImageCandidates(item);
    const entryCandidate = extractItemImageCandidates(entry.item || entry.thumbnail);

    assert.strictEqual(itemCandidate.storagePath, entryCandidate.storagePath);
    assert.strictEqual(itemCandidate.storagePath, 'user_123/items/item_lenovo_ideapad/photo_0.jpg');
  });

  // ---------------------------------------------------------------------------
  // Case 10: DB Row Mappers & Hydration Consistency
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. DB Row Mappers & Hydration Consistency ---');
  test('vaultRowMappers hydrates and serializes storage paths cleanly even if raw row had URLs or prefixes', () => {
    const rawDbRow = {
      id: 'item_lenovo_ideapad',
      user_id: 'user_123',
      name: 'Lenovo IdeaPad Slim 3',
      purchase_price: 48000,
      currency: 'INR',
      image_storage_path: 'item-images/user_123/items/item_lenovo_ideapad/photo_0.jpg', // with prefix
      image_url: 'https://xxx.supabase.co/storage/v1/object/sign/item-images/user_123/items/item_lenovo_ideapad/photo_0.jpg?token=abc', // signed url
      product_photos: ['/user_123/items/item_lenovo_ideapad/photo_0.jpg'], // leading slash
    };

    const mappedItem = mapDbRowToItem(rawDbRow);
    assert.strictEqual(mappedItem.imageStoragePath, 'user_123/items/item_lenovo_ideapad/photo_0.jpg');
    assert.strictEqual(mappedItem.imageUrl, 'user_123/items/item_lenovo_ideapad/photo_0.jpg');
    assert.deepStrictEqual(mappedItem.productPhotos, ['user_123/items/item_lenovo_ideapad/photo_0.jpg']);

    const serializedDbRow = mapItemToDbRow(mappedItem, 'user_123');
    assert.strictEqual(serializedDbRow.image_storage_path, 'user_123/items/item_lenovo_ideapad/photo_0.jpg');
    assert.strictEqual(serializedDbRow.image_url, 'user_123/items/item_lenovo_ideapad/photo_0.jpg');
  });

  // ---------------------------------------------------------------------------
  // Case 11: Cross-Device Session & Logout Cache Purge
  // ---------------------------------------------------------------------------
  console.log('\n--- 11. Cross-Device Session & Logout Cache Purge ---');
  test('User logout purges signed URL cache completely', () => {
    setCachedSignedUrl('user_A/items/item_1/photo_0.jpg', 'https://signed.url/A', 3600);
    setCachedSignedUrl('user_B/items/item_2/photo_0.jpg', 'https://signed.url/B', 3600);

    assert.notStrictEqual(getCachedSignedUrl('user_A/items/item_1/photo_0.jpg'), null);
    assert.notStrictEqual(getCachedSignedUrl('user_B/items/item_2/photo_0.jpg'), null);

    clearSignedUrlCache();

    assert.strictEqual(getCachedSignedUrl('user_A/items/item_1/photo_0.jpg'), null);
    assert.strictEqual(getCachedSignedUrl('user_B/items/item_2/photo_0.jpg'), null);
  });

  console.log('\n================================================================');
  console.log(` RESULT: ${passedTests}/${totalTests} regression tests passed!`);
  console.log('================================================================\n');
}

runAllTests().catch((e) => {
  console.error('Test suite failed:', e);
  process.exit(1);
});
