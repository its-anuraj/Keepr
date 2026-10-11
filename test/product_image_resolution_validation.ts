import assert from 'node:assert';
import {
  isStoragePath,
  isLocalUri,
  isRemoteUrl,
  extractItemImageCandidates,
  extractDocumentImageCandidates,
  setCachedSignedUrl,
  getCachedSignedUrl,
  clearSignedUrlCache,
  invalidateSignedUrlCache,
  BUCKET_ITEM_IMAGES,
} from '../src/utils/storageUtils';
import {
  mapDbRowToItem,
  mapItemToDbRow,
} from '../src/services/vaultRowMappers';
import type { Item, VaultDocument, RecentlyAddedEntry } from '../src/types';

console.log('================================================================');
console.log(' KEEPR: PRODUCT IMAGE RESOLUTION & CROSS-DEVICE PIPELINE TEST');
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
// 1. Same item image appears in Recently Added and Item Details
// -----------------------------------------------------------------------------
console.log('--- 1. Canonical Image Candidates for Recently Added & Details ---');

test('Recently Added and Item Details extract identical durable storage path', () => {
  const item: Item = {
    id: 'item-lenovo-123',
    userId: 'user-abc',
    name: 'Lenovo IdeaPad Slim 3',
    purchasePrice: 42000,
    currency: 'INR',
    status: 'active',
    photoUri: 'file:///data/user/0/com.ajsingh.keepr/cache/lenovo.jpg',
    imageStoragePath: 'user-abc/items/item-lenovo-123/photo_0.jpg',
    imageUrl: 'user-abc/items/item-lenovo-123/photo_0.jpg',
    productPhotos: ['user-abc/items/item-lenovo-123/photo_0.jpg'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const detailsCandidate = extractItemImageCandidates(item);
  const entry: RecentlyAddedEntry = {
    id: item.id,
    entityType: 'PURCHASED_ITEM',
    title: item.name,
    category: 'electronics',
    createdAt: new Date().toISOString(),
    thumbnail: item.imageStoragePath || item.imageUrl,
    item,
  };
  const recentlyAddedCandidate = extractItemImageCandidates(entry.item || entry.thumbnail);

  assert.strictEqual(detailsCandidate.storagePath, 'user-abc/items/item-lenovo-123/photo_0.jpg');
  assert.strictEqual(recentlyAddedCandidate.storagePath, 'user-abc/items/item-lenovo-123/photo_0.jpg');
  assert.strictEqual(detailsCandidate.storagePath, recentlyAddedCandidate.storagePath);
});

// -----------------------------------------------------------------------------
// 2. A durable cloud image path resolves after fresh hydration
// -----------------------------------------------------------------------------
console.log('--- 2. Fresh Hydration and DB Mapping Resilience ---');

test('mapDbRowToItem hydrates imageStoragePath from image_storage_path', () => {
  const row = {
    id: 'item-lenovo-123',
    user_id: 'user-abc',
    name: 'Lenovo IdeaPad Slim 3',
    purchase_price: 42000,
    currency: 'INR',
    status: 'active',
    image_storage_path: 'user-abc/items/item-lenovo-123/photo_0.jpg',
    image_url: 'user-abc/items/item-lenovo-123/photo_0.jpg',
    product_photos: ['user-abc/items/item-lenovo-123/photo_0.jpg'],
  };

  const hydrated = mapDbRowToItem(row);
  assert.strictEqual(hydrated.imageStoragePath, 'user-abc/items/item-lenovo-123/photo_0.jpg');
  assert.strictEqual(hydrated.imageUrl, 'user-abc/items/item-lenovo-123/photo_0.jpg');
});

test('mapDbRowToItem inspects product_photos when image_storage_path is omitted', () => {
  const row = {
    id: 'item-lenovo-123',
    user_id: 'user-abc',
    name: 'Lenovo IdeaPad Slim 3',
    purchase_price: 42000,
    currency: 'INR',
    status: 'active',
    product_photos: ['user-abc/items/item-lenovo-123/photo_0.jpg'],
  };

  const hydrated = mapDbRowToItem(row);
  assert.strictEqual(hydrated.imageStoragePath, 'user-abc/items/item-lenovo-123/photo_0.jpg');
  assert.strictEqual(hydrated.imageUrl, 'user-abc/items/item-lenovo-123/photo_0.jpg');
});

test('mapItemToDbRow inspects product_photos to persist image_storage_path', () => {
  const item: Item = {
    id: 'item-lenovo-123',
    userId: 'user-abc',
    name: 'Lenovo IdeaPad Slim 3',
    purchasePrice: 42000,
    currency: 'INR',
    status: 'active',
    productPhotos: ['user-abc/items/item-lenovo-123/photo_0.jpg'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const row = mapItemToDbRow(item, 'user-abc');
  assert.strictEqual(row.image_storage_path, 'user-abc/items/item-lenovo-123/photo_0.jpg');
  assert.strictEqual(row.image_url, 'user-abc/items/item-lenovo-123/photo_0.jpg');
});

// -----------------------------------------------------------------------------
// 3. A missing local file does not hide an available cloud image
// -----------------------------------------------------------------------------
console.log('--- 3. Missing Local Sandbox File & Cloud Fallback ---');

test('item with APK sandbox URI on Expo Go still exposes durable storage path', () => {
  const item: Item = {
    id: 'item-lenovo-apk',
    userId: 'user-abc',
    name: 'Lenovo IdeaPad Slim 3',
    purchasePrice: 42000,
    currency: 'INR',
    status: 'active',
    // Local APK path that does not exist in Expo Go sandbox:
    photoUri: 'file:///data/user/0/com.ajsingh.keepr/cache/ImagePicker/d71cb9ec.jpeg',
    imageStoragePath: 'user-abc/items/item-lenovo-apk/photo_0.jpg',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const candidate = extractItemImageCandidates(item);
  assert.strictEqual(candidate.storagePath, 'user-abc/items/item-lenovo-apk/photo_0.jpg');
  assert.strictEqual(candidate.localUri, 'file:///data/user/0/com.ajsingh.keepr/cache/ImagePicker/d71cb9ec.jpeg');
});

// -----------------------------------------------------------------------------
// 4. An expired signed URL is refreshed
// -----------------------------------------------------------------------------
console.log('--- 4. Signed URL Cache TTL & Expiry Handling ---');

test('unexpired signed URL is returned from cache', () => {
  clearSignedUrlCache();
  const path = 'user-abc/items/item-123/photo_0.jpg';
  const signedUrl = 'https://xyz.supabase.co/storage/v1/object/sign/item-images/user-abc/items/item-123/photo_0.jpg?token=valid';

  setCachedSignedUrl(path, signedUrl, 3600); // 1 hour remaining
  assert.strictEqual(getCachedSignedUrl(path), signedUrl);
});

test('expired signed URL returns null so resolver fetches fresh signed URL', () => {
  clearSignedUrlCache();
  const path = 'user-abc/items/item-123/photo_0.jpg';
  const expiredUrl = 'https://xyz.supabase.co/storage/v1/object/sign/item-images/user-abc/items/item-123/photo_0.jpg?token=expired';

  // 10 seconds remaining is within the 60s buffer -> treated as expired
  setCachedSignedUrl(path, expiredUrl, 10);
  assert.strictEqual(getCachedSignedUrl(path), null);
});

// -----------------------------------------------------------------------------
// 5. A changed storage path invalidates stale cache state
// -----------------------------------------------------------------------------
console.log('--- 5. Cache Invalidation on Storage Path Change ---');

test('invalidateSignedUrlCache purges both raw and bucket-prefixed keys', () => {
  clearSignedUrlCache();
  const path = 'user-abc/items/item-123/photo_0.jpg';
  const cacheKey = `${BUCKET_ITEM_IMAGES}:${path}`;
  const testUrl = 'https://xyz.supabase.co/storage/v1/object/sign/test.jpg';

  setCachedSignedUrl(path, testUrl, 3600);
  setCachedSignedUrl(cacheKey, testUrl, 3600);
  assert.strictEqual(getCachedSignedUrl(path), testUrl);

  invalidateSignedUrlCache(path);
  assert.strictEqual(getCachedSignedUrl(path), null);
  assert.strictEqual(getCachedSignedUrl(cacheKey), null);
});

// -----------------------------------------------------------------------------
// 6. User/session switching cannot leak a previous user's image
// -----------------------------------------------------------------------------
console.log('--- 6. User Isolation and Session Purge ---');

test('clearSignedUrlCache purges all cached URLs on user logout', () => {
  const pathA = 'user-a/items/item-1/photo.jpg';
  const pathB = 'user-b/items/item-2/photo.jpg';

  setCachedSignedUrl(pathA, 'https://xyz.supabase.co/storage/user-a.jpg', 3600);
  setCachedSignedUrl(pathB, 'https://xyz.supabase.co/storage/user-b.jpg', 3600);
  assert.strictEqual(getCachedSignedUrl(pathA), 'https://xyz.supabase.co/storage/user-a.jpg');

  clearSignedUrlCache();
  assert.strictEqual(getCachedSignedUrl(pathA), null);
  assert.strictEqual(getCachedSignedUrl(pathB), null);
});

// -----------------------------------------------------------------------------
// 7. Missing images show a fallback without hiding the item
// -----------------------------------------------------------------------------
console.log('--- 7. Fallback Behavior for Items Without Images ---');

test('item without any image references safely returns null candidates without throwing', () => {
  const item: Item = {
    id: 'item-no-photo',
    userId: 'user-abc',
    name: 'Book',
    purchasePrice: 500,
    currency: 'INR',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const candidate = extractItemImageCandidates(item);
  assert.strictEqual(candidate.storagePath, null);
  assert.strictEqual(candidate.remoteUrl, null);
  assert.strictEqual(candidate.localUri, null);
});

test('null and undefined item safely return null candidates without throwing', () => {
  assert.deepStrictEqual(extractItemImageCandidates(null), {
    storagePath: null,
    remoteUrl: null,
    localUri: null,
  });
  assert.deepStrictEqual(extractItemImageCandidates(undefined), {
    storagePath: null,
    remoteUrl: null,
    localUri: null,
  });
});

test('document image candidates extracted accurately for Recently Added documents', () => {
  const doc: VaultDocument = {
    id: 'doc-123',
    userId: 'user-abc',
    title: 'Warranty Card',
    category: 'Warranty & Guarantee',
    documentType: 'Warranty Certificate',
    fileType: 'warranty_card',
    filePath: 'user-abc/documents/doc-123/card.pdf',
    fileUrl: 'user-abc/documents/doc-123/card.pdf',
    storagePath: 'user-abc/documents/doc-123/card.pdf',
    fileSizeBytes: 1024,
    mimeType: 'application/pdf',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const candidate = extractDocumentImageCandidates(doc);
  assert.strictEqual(candidate.storagePath, 'user-abc/documents/doc-123/card.pdf');
  assert.strictEqual(candidate.remoteUrl, null);
  assert.strictEqual(candidate.localUri, null);
});

console.log(`\n================================================================`);
console.log(` RESULT: ${passedTests}/${totalTests} image resolution tests passed!`);
console.log(`================================================================\n`);
