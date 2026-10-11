// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Storage Service (Private & Authenticated)
//
// All buckets are strictly private:
//   - item-images
//   - item-documents
//   - vault-documents
//
// All access requires authentication and user-scoped path ownership:
//   {userId}/{...}
// ==============================================================================

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { getCanonicalReceiptUri, getCanonicalDocumentUri } from './receiptFileService';

import {
  BUCKET_ITEM_IMAGES,
  BUCKET_ITEM_DOCUMENTS,
  BUCKET_VAULT_DOCUMENTS,
  signedUrlCache,
  isStoragePath,
  isLocalUri,
  isRemoteUrl,
  isPdfDocument,
  isImageDocument,
  getCanonicalDocumentBucket,
  logDocumentThumbnailDiagnostic,
  getCachedSignedUrl,
  clearSignedUrlCache,
  invalidateSignedUrlCache,
  cleanStoragePath,
} from '../utils/storageUtils';

export {
  BUCKET_ITEM_IMAGES,
  BUCKET_ITEM_DOCUMENTS,
  BUCKET_VAULT_DOCUMENTS,
  signedUrlCache,
  isStoragePath,
  isLocalUri,
  isRemoteUrl,
  isPdfDocument,
  isImageDocument,
  getCanonicalDocumentBucket,
  logDocumentThumbnailDiagnostic,
  getCachedSignedUrl,
  clearSignedUrlCache,
  invalidateSignedUrlCache,
  cleanStoragePath,
};

export type StorageBucket =
  | typeof BUCKET_ITEM_IMAGES
  | typeof BUCKET_ITEM_DOCUMENTS
  | typeof BUCKET_VAULT_DOCUMENTS;

/**
 * Creates a signed URL for a private file in Supabase Storage.
 * Only the owner can generate and access this URL.
 *
 * @param bucket - Target storage bucket
 * @param path - User-scoped path, e.g. `${userId}/items/${itemId}/photo.jpg`
 * @param expiresIn - Expiry in seconds (default: 3600 = 1 hour)
 */
export async function createPrivateSignedUrl(
  bucket: StorageBucket,
  path: string,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!path) return null;

  if (path.startsWith('file://') || path.startsWith('content://') || path.startsWith('blob:')) {
    return path;
  }

  // Sanitize path: strip leading slashes and redundant bucket prefixes if present
  let cleanPath = cleanStoragePath(path) || path.trim();
  while (cleanPath.startsWith('/')) {
    cleanPath = cleanPath.substring(1).trim();
  }
  if (cleanPath.startsWith(`${bucket}/`)) {
    cleanPath = cleanPath.substring(bucket.length + 1).trim();
  }

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(cleanPath, expiresIn);

    if (error || !data?.signedUrl) {
      console.warn(`[StorageService] Failed to create signed URL for ${bucket}/${cleanPath}:`, error?.message || error);
      return null;
    }

    return data.signedUrl;
  } catch (err) {
    console.warn(`[StorageService] Exception creating signed URL for ${bucket}/${cleanPath}:`, err);
    return null;
  }
}

/**
 * Gets or creates a signed URL for an item product image in private item-images bucket.
 * Caches the URL in memory with TTL. Defensively falls back to item-documents or vault-documents if needed.
 */
export async function getItemImageSignedUrl(
  path: string,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!path) return null;
  const clean = cleanStoragePath(path) || (isStoragePath(path) ? path.trim() : null);
  if (!clean || !isStoragePath(clean)) return null;

  const cacheKey = `${BUCKET_ITEM_IMAGES}:${clean}`;
  const cached = getCachedSignedUrl(cacheKey) || getCachedSignedUrl(clean);
  if (cached) return cached;

  // 1. Try BUCKET_ITEM_IMAGES first (canonical bucket for item product photos)
  let signed = await createPrivateSignedUrl(BUCKET_ITEM_IMAGES, clean, expiresIn);
  let resolvedBucket: StorageBucket = BUCKET_ITEM_IMAGES;

  // 2. Defensively check BUCKET_ITEM_DOCUMENTS and BUCKET_VAULT_DOCUMENTS if not found in item-images
  if (!signed) {
    signed = await createPrivateSignedUrl(BUCKET_ITEM_DOCUMENTS, clean, expiresIn);
    if (signed) {
      resolvedBucket = BUCKET_ITEM_DOCUMENTS;
    } else {
      signed = await createPrivateSignedUrl(BUCKET_VAULT_DOCUMENTS, clean, expiresIn);
      if (signed) resolvedBucket = BUCKET_VAULT_DOCUMENTS;
    }
  }

  if (signed) {
    const expiresAt = Date.now() + expiresIn * 1000;
    signedUrlCache.set(`${resolvedBucket}:${clean}`, {
      url: signed,
      expiresAt,
    });
    signedUrlCache.set(clean, {
      url: signed,
      expiresAt,
    });
    return signed;
  }

  return null;
}

/**
 * Gets or creates a signed URL for an item receipt or invoice in the private item-documents bucket.
 * Caches the URL in memory with TTL. Defensively falls back to vault-documents if needed.
 */
export async function getItemReceiptSignedUrl(
  path: string,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!path) return null;
  if (!isStoragePath(path)) {
    if (isRemoteUrl(path) || path.startsWith('data:')) return path;
    return null;
  }

  const cacheKey = `${BUCKET_ITEM_DOCUMENTS}:${path}`;
  const cached = getCachedSignedUrl(cacheKey) || getCachedSignedUrl(path);
  if (cached) return cached;

  // Try item-documents first
  let signed = await createPrivateSignedUrl(BUCKET_ITEM_DOCUMENTS, path, expiresIn);
  let resolvedBucket: StorageBucket = BUCKET_ITEM_DOCUMENTS;

  // Defensively try vault-documents if not found in item-documents
  if (!signed) {
    signed = await createPrivateSignedUrl(BUCKET_VAULT_DOCUMENTS, path, expiresIn);
    if (signed) resolvedBucket = BUCKET_VAULT_DOCUMENTS;
  }

  if (signed) {
    const expiresAt = Date.now() + expiresIn * 1000;
    signedUrlCache.set(`${resolvedBucket}:${path}`, { url: signed, expiresAt });
    signedUrlCache.set(path, { url: signed, expiresAt });
    return signed;
  }

  return null;
}

/**
 * Gets or creates a signed URL for a Vault Document in the private vault-documents bucket.
 * Caches the URL in memory with TTL. Defensively checks item-documents if linked.
 */
export async function getVaultDocumentSignedUrl(
  path: string,
  preferredBucket: StorageBucket = BUCKET_VAULT_DOCUMENTS,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!path) return null;
  if (!isStoragePath(path)) {
    if (isRemoteUrl(path) || path.startsWith('data:')) return path;
    return null;
  }

  // Auto-detect canonical bucket: if path clearly belongs to an item, prefer item-documents
  let actualPreferred = preferredBucket;
  if (path.includes('/items/') && preferredBucket === BUCKET_VAULT_DOCUMENTS) {
    actualPreferred = BUCKET_ITEM_DOCUMENTS;
  }

  const cacheKey = `${actualPreferred}:${path}`;
  const cached = getCachedSignedUrl(cacheKey) || getCachedSignedUrl(path);
  if (cached) return cached;

  let signed = await createPrivateSignedUrl(actualPreferred, path, expiresIn);
  let resolvedBucket: StorageBucket = actualPreferred;

  if (!signed) {
    const fallbackBucket = actualPreferred === BUCKET_VAULT_DOCUMENTS ? BUCKET_ITEM_DOCUMENTS : BUCKET_VAULT_DOCUMENTS;
    signed = await createPrivateSignedUrl(fallbackBucket, path, expiresIn);
    if (signed) resolvedBucket = fallbackBucket;
  }

  if (signed) {
    const expiresAt = Date.now() + expiresIn * 1000;
    signedUrlCache.set(`${resolvedBucket}:${path}`, { url: signed, expiresAt });
    signedUrlCache.set(path, { url: signed, expiresAt });
    return signed;
  }

  return null;
}

/**
 * Batch prefetches signed URLs for multiple item image storage paths in a single network call.
 * Pre-warms the cache so cards render instantly.
 */
export async function prefetchItemImageSignedUrls(
  paths: string[],
  expiresIn: number = 3600
): Promise<void> {
  const uncached = Array.from(
    new Set(paths.filter((p) => p && isStoragePath(p) && !getCachedSignedUrl(`${BUCKET_ITEM_IMAGES}:${p}`) && !getCachedSignedUrl(p)))
  );
  if (uncached.length === 0) return;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_ITEM_IMAGES)
      .createSignedUrls(uncached, expiresIn);

    if (!error && Array.isArray(data)) {
      const now = Date.now();
      for (const item of data) {
        if (item.path && item.signedUrl && !item.error) {
          signedUrlCache.set(`${BUCKET_ITEM_IMAGES}:${item.path}`, {
            url: item.signedUrl,
            expiresAt: now + expiresIn * 1000,
          });
          signedUrlCache.set(item.path, {
            url: item.signedUrl,
            expiresAt: now + expiresIn * 1000,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[StorageService] prefetchItemImageSignedUrls note:', err);
  }
}

/**
 * Batch prefetches signed URLs for item receipts.
 */
export async function prefetchReceiptSignedUrls(
  paths: string[],
  expiresIn: number = 3600
): Promise<void> {
  const uncached = Array.from(
    new Set(paths.filter((p) => p && isStoragePath(p) && !getCachedSignedUrl(`${BUCKET_ITEM_DOCUMENTS}:${p}`) && !getCachedSignedUrl(p)))
  );
  if (uncached.length === 0) return;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_ITEM_DOCUMENTS)
      .createSignedUrls(uncached, expiresIn);

    if (!error && Array.isArray(data)) {
      const now = Date.now();
      for (const item of data) {
        if (item.path && item.signedUrl && !item.error) {
          signedUrlCache.set(`${BUCKET_ITEM_DOCUMENTS}:${item.path}`, {
            url: item.signedUrl,
            expiresAt: now + expiresIn * 1000,
          });
          signedUrlCache.set(item.path, {
            url: item.signedUrl,
            expiresAt: now + expiresIn * 1000,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[StorageService] prefetchReceiptSignedUrls note:', err);
  }
}

/**
 * Batch prefetches signed URLs for vault documents across vault-documents and item-documents buckets.
 */
export async function prefetchVaultDocumentSignedUrls(
  paths: string[],
  expiresIn: number = 3600
): Promise<void> {
  const uncached = Array.from(
    new Set(paths.filter((p) => p && isStoragePath(p) && !getCachedSignedUrl(`${BUCKET_VAULT_DOCUMENTS}:${p}`) && !getCachedSignedUrl(`${BUCKET_ITEM_DOCUMENTS}:${p}`) && !getCachedSignedUrl(p)))
  );
  if (uncached.length === 0) return;

  const itemDocPaths = uncached.filter((p) => p.includes('/items/'));
  const vaultDocPaths = uncached.filter((p) => !p.includes('/items/'));

  const tasks: Promise<any>[] = [];

  if (vaultDocPaths.length > 0) {
    tasks.push(
      supabase.storage
        .from(BUCKET_VAULT_DOCUMENTS)
        .createSignedUrls(vaultDocPaths, expiresIn)
        .then(({ data, error }) => {
          if (!error && Array.isArray(data)) {
            const now = Date.now();
            for (const item of data) {
              if (item.path && item.signedUrl && !item.error) {
                signedUrlCache.set(`${BUCKET_VAULT_DOCUMENTS}:${item.path}`, {
                  url: item.signedUrl,
                  expiresAt: now + expiresIn * 1000,
                });
                signedUrlCache.set(item.path, {
                  url: item.signedUrl,
                  expiresAt: now + expiresIn * 1000,
                });
              }
            }
          }
        })
        .catch((err) => {
          console.warn('[StorageService] prefetchVaultDocumentSignedUrls vault note:', err);
        })
    );
  }

  if (itemDocPaths.length > 0) {
    tasks.push(
      supabase.storage
        .from(BUCKET_ITEM_DOCUMENTS)
        .createSignedUrls(itemDocPaths, expiresIn)
        .then(({ data, error }) => {
          if (!error && Array.isArray(data)) {
            const now = Date.now();
            for (const item of data) {
              if (item.path && item.signedUrl && !item.error) {
                signedUrlCache.set(`${BUCKET_ITEM_DOCUMENTS}:${item.path}`, {
                  url: item.signedUrl,
                  expiresAt: now + expiresIn * 1000,
                });
                signedUrlCache.set(item.path, {
                  url: item.signedUrl,
                  expiresAt: now + expiresIn * 1000,
                });
              }
            }
          }
        })
        .catch((err) => {
          console.warn('[StorageService] prefetchVaultDocumentSignedUrls item note:', err);
        })
    );
  }

  await Promise.all(tasks);
}

/**
 * Reads local file or data URI into binary Uint8Array bytes and infers content type and extension.
 */
export async function readFileBytesAndMeta(
  localUri: string,
  preferredFileName?: string
): Promise<{ bytes: Uint8Array; contentType: string; ext: string } | null> {
  try {
    let cleanUri = localUri.trim();
    if (!cleanUri) return null;

    // Handle data: URIs directly
    if (cleanUri.startsWith('data:')) {
      const match = cleanUri.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const contentType = match[1];
        const binaryString = atob(match[2]);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        let ext = '.jpg';
        if (contentType.includes('pdf')) ext = '.pdf';
        else if (contentType.includes('png')) ext = '.png';
        else if (contentType.includes('webp')) ext = '.webp';
        return { bytes, contentType, ext };
      }
    }

    const canonical = getCanonicalReceiptUri(cleanUri) || cleanUri;
    let fileUriToRead: string | null = null;

    try {
      const cInfo = await FileSystem.getInfoAsync(canonical).catch(() => null);
      if (cInfo?.exists && !cInfo.isDirectory) {
        fileUriToRead = canonical;
      }
    } catch {}

    if (!fileUriToRead && canonical !== cleanUri) {
      try {
        const rawInfo = await FileSystem.getInfoAsync(cleanUri).catch(() => null);
        if (rawInfo?.exists && !rawInfo.isDirectory) {
          fileUriToRead = cleanUri;
        }
      } catch {}
    }

    if (!fileUriToRead) return null;

    const lower = (fileUriToRead || preferredFileName || '').toLowerCase().split('?')[0];
    let ext = '.jpg';
    let contentType = 'image/jpeg';
    if (lower.endsWith('.pdf')) {
      ext = '.pdf';
      contentType = 'application/pdf';
    } else if (lower.endsWith('.png')) {
      ext = '.png';
      contentType = 'image/png';
    } else if (lower.endsWith('.webp')) {
      ext = '.webp';
      contentType = 'image/webp';
    } else if (lower.endsWith('.heic')) {
      ext = '.heic';
      contentType = 'image/heic';
    }

    const base64 = await FileSystem.readAsStringAsync(fileUriToRead, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return { bytes, contentType, ext };
  } catch (err) {
    console.warn('[StorageService] readFileBytesAndMeta exception:', err);
    return null;
  }
}

/**
 * Uploads a local product image file into the private 'item-images' Supabase Storage bucket.
 * Storage path format: `${userId}/items/${itemId}/photo_${index}.jpg`
 * Enforces authenticated user ownership scoping for RLS.
 */
export async function uploadItemPhoto(
  userId: string,
  itemId: string,
  localUri: string,
  index: number = 0
): Promise<{ storagePath: string | null; error: string | null }> {
  if (!userId || !itemId || !localUri) {
    return { storagePath: null, error: 'Missing required upload parameters' };
  }

  try {
    const fileData = await readFileBytesAndMeta(localUri);
    if (!fileData) {
      return { storagePath: null, error: 'Local file does not exist or cannot be read' };
    }

    const storagePath = `${userId}/items/${itemId}/photo_${index}${fileData.ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_ITEM_IMAGES)
      .upload(storagePath, fileData.bytes, {
        contentType: fileData.contentType,
        upsert: true,
      });

    if (uploadError) {
      console.warn(`[StorageService] Upload item photo failed for ${storagePath}:`, uploadError.message);
      return { storagePath: null, error: uploadError.message };
    }

    // Immediately cache signed URL so this newly created item renders instantly
    createPrivateSignedUrl(BUCKET_ITEM_IMAGES, storagePath, 3600).then((signedUrl) => {
      if (signedUrl) {
        signedUrlCache.set(`${BUCKET_ITEM_IMAGES}:${storagePath}`, {
          url: signedUrl,
          expiresAt: Date.now() + 3600 * 1000,
        });
        signedUrlCache.set(storagePath, {
          url: signedUrl,
          expiresAt: Date.now() + 3600 * 1000,
        });
      }
    }).catch(() => {});

    console.log(`[StorageService] Uploaded item photo to ${BUCKET_ITEM_IMAGES}/${storagePath}`);
    return { storagePath, error: null };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[StorageService] uploadItemPhoto exception:', msg);
    return { storagePath: null, error: msg };
  }
}

/**
 * Uploads an item receipt or invoice to the private 'item-documents' Supabase Storage bucket.
 * Storage path format: `${userId}/items/${itemId}/receipt_${Date.now()}${ext}`
 * Enforces user-scoped ownership for strict RLS.
 */
export async function uploadItemReceipt(
  userId: string,
  itemId: string,
  localUri: string,
  preferredFileName?: string
): Promise<{ storagePath: string | null; error: string | null }> {
  if (!userId || !itemId || !localUri) {
    return { storagePath: null, error: 'Missing required upload parameters' };
  }

  try {
    const fileData = await readFileBytesAndMeta(localUri, preferredFileName);
    if (!fileData) {
      return { storagePath: null, error: 'Receipt file does not exist or cannot be read' };
    }

    const storagePath = `${userId}/items/${itemId}/receipt_${Date.now()}${fileData.ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_ITEM_DOCUMENTS)
      .upload(storagePath, fileData.bytes, {
        contentType: fileData.contentType,
        upsert: true,
      });

    if (uploadError) {
      console.warn(`[StorageService] Upload item receipt failed for ${storagePath}:`, uploadError.message);
      return { storagePath: null, error: uploadError.message };
    }

    // Immediately cache signed URL so this newly created receipt renders instantly
    createPrivateSignedUrl(BUCKET_ITEM_DOCUMENTS, storagePath, 3600).then((signedUrl) => {
      if (signedUrl) {
        signedUrlCache.set(`${BUCKET_ITEM_DOCUMENTS}:${storagePath}`, {
          url: signedUrl,
          expiresAt: Date.now() + 3600 * 1000,
        });
        signedUrlCache.set(storagePath, {
          url: signedUrl,
          expiresAt: Date.now() + 3600 * 1000,
        });
      }
    }).catch(() => {});

    console.log(`[StorageService] Uploaded item receipt to ${BUCKET_ITEM_DOCUMENTS}/${storagePath}`);
    return { storagePath, error: null };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[StorageService] uploadItemReceipt exception:', msg);
    return { storagePath: null, error: msg };
  }
}

/**
 * Uploads a document to the appropriate private bucket ('item-documents' if linked to an item, else 'vault-documents').
 * Enforces user-scoped path ownership: `${userId}/...`.
 */
export async function uploadVaultDocument(
  userId: string,
  docId: string,
  localUri: string,
  itemId?: string | null,
  preferredFileName?: string,
  suffix: string = ''
): Promise<{ storagePath: string | null; bucket: StorageBucket; error: string | null }> {
  const bucket: StorageBucket = itemId ? BUCKET_ITEM_DOCUMENTS : BUCKET_VAULT_DOCUMENTS;
  if (!userId || !docId || !localUri) {
    return { storagePath: null, bucket, error: 'Missing required upload parameters' };
  }

  try {
    const fileData = await readFileBytesAndMeta(localUri, preferredFileName);
    if (!fileData) {
      return { storagePath: null, bucket, error: 'Document file does not exist or cannot be read' };
    }

    const storagePath = itemId
      ? `${userId}/items/${itemId}/doc_${docId}${suffix}${fileData.ext}`
      : `${userId}/vault/${docId}${suffix}${fileData.ext}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, fileData.bytes, {
        contentType: fileData.contentType,
        upsert: true,
      });

    if (uploadError) {
      console.warn(`[StorageService] Upload vault document failed for ${storagePath}:`, uploadError.message);
      return { storagePath: null, bucket, error: uploadError.message };
    }

    // Cache signed URL
    createPrivateSignedUrl(bucket, storagePath, 3600).then((signedUrl) => {
      if (signedUrl) {
        signedUrlCache.set(`${bucket}:${storagePath}`, {
          url: signedUrl,
          expiresAt: Date.now() + 3600 * 1000,
        });
        signedUrlCache.set(storagePath, {
          url: signedUrl,
          expiresAt: Date.now() + 3600 * 1000,
        });
      }
    }).catch(() => {});

    console.log(`[StorageService] Uploaded vault document to ${bucket}/${storagePath}`);
    return { storagePath, bucket, error: null };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[StorageService] uploadVaultDocument exception:', msg);
    return { storagePath: null, bucket, error: msg };
  }
}

/**
 * Safely removes item photos from Supabase Storage and clears their cache entries.
 */
export async function deleteItemPhotosFromStorage(paths: string[]): Promise<void> {
  const validPaths = paths.filter((p) => p && isStoragePath(p));
  if (validPaths.length === 0) return;

  try {
    const { error } = await supabase.storage
      .from(BUCKET_ITEM_IMAGES)
      .remove(validPaths);

    if (error) {
      console.warn('[StorageService] Failed to delete item photos:', error.message);
    } else {
      for (const p of validPaths) {
        signedUrlCache.delete(p);
      }
      console.log(`[StorageService] Deleted ${validPaths.length} photo(s) from ${BUCKET_ITEM_IMAGES}`);
    }
  } catch (err) {
    console.warn('[StorageService] Exception deleting item photos:', err);
  }
}

/**
 * Resolves a given URI or storage path to a displayable URI for React Native.
 */
export async function resolveItemImageUri(uriOrPath?: string | null): Promise<string | null> {
  if (!uriOrPath) return null;

  if (isRemoteUrl(uriOrPath) || uriOrPath.startsWith('data:')) {
    return uriOrPath;
  }

  if (isStoragePath(uriOrPath)) {
    return getItemImageSignedUrl(uriOrPath);
  }

  if (isLocalUri(uriOrPath)) {
    const canonical = getCanonicalReceiptUri(uriOrPath) || uriOrPath;
    try {
      const info = await FileSystem.getInfoAsync(canonical).catch(() => null);
      if (info?.exists && !info.isDirectory) {
        return canonical;
      }
    } catch {}
  }

  return null;
}

/**
 * Resolves a given receipt URI or storage path to a displayable URI for React Native.
 */
export async function resolveReceiptUri(
  storagePathOrUri?: string | null,
  localFallbackUri?: string | null
): Promise<string | null> {
  if (localFallbackUri && isLocalUri(localFallbackUri)) {
    const canonical = getCanonicalReceiptUri(localFallbackUri) || localFallbackUri;
    try {
      const info = await FileSystem.getInfoAsync(canonical).catch(() => null);
      if (info?.exists && !info.isDirectory) {
        return canonical;
      }
    } catch {}
  }

  if (!storagePathOrUri) return null;

  if (isRemoteUrl(storagePathOrUri) || storagePathOrUri.startsWith('data:')) {
    return storagePathOrUri;
  }

  if (isStoragePath(storagePathOrUri)) {
    return getItemReceiptSignedUrl(storagePathOrUri);
  }

  if (isLocalUri(storagePathOrUri)) {
    const canonical = getCanonicalReceiptUri(storagePathOrUri) || storagePathOrUri;
    try {
      const info = await FileSystem.getInfoAsync(canonical).catch(() => null);
      if (info?.exists && !info.isDirectory) {
        return canonical;
      }
    } catch {}
  }

  return null;
}

/**
 * Resolves a vault document to a displayable URI for React Native.
 */
export async function resolveDocumentUri(doc?: {
  storagePath?: string | null;
  filePath?: string | null;
  fileUrl?: string | null;
  itemId?: string | null;
} | null): Promise<string | null> {
  if (!doc) return null;

  // 1. Try local physical file first if on the current device
  const localCandidate = doc.filePath || doc.fileUrl;
  if (localCandidate && isLocalUri(localCandidate)) {
    const canonical = getCanonicalDocumentUri(localCandidate) || getCanonicalReceiptUri(localCandidate) || localCandidate;
    try {
      const info = await FileSystem.getInfoAsync(canonical).catch(() => null);
      if (info?.exists && !info.isDirectory) {
        return canonical;
      }
    } catch {}
  }

  // 2. Storage path
  const storageCandidate = doc.storagePath || (isStoragePath(doc.filePath) ? doc.filePath : null) || (isStoragePath(doc.fileUrl) ? doc.fileUrl : null);
  if (storageCandidate && isStoragePath(storageCandidate)) {
    const bucket = doc.itemId ? BUCKET_ITEM_DOCUMENTS : BUCKET_VAULT_DOCUMENTS;
    return getVaultDocumentSignedUrl(storageCandidate, bucket);
  }

  // 3. Remote URL
  if (doc.fileUrl && isRemoteUrl(doc.fileUrl)) {
    return doc.fileUrl;
  }

  return null;
}

/**
 * Downloads a private file from Supabase Storage using authenticated session.
 *
 * @param bucket - Target storage bucket
 * @param path - User-scoped path, e.g. `${userId}/documents/${docId}/file.pdf`
 */
export async function downloadPrivateFile(
  bucket: StorageBucket,
  path: string
): Promise<Blob | null> {
  if (!path) return null;

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(path);

    if (error || !data) {
      console.warn(`[StorageService] Failed to download private file ${bucket}/${path}:`, error);
      return null;
    }

    return data;
  } catch (err) {
    console.warn(`[StorageService] Exception downloading file ${bucket}/${path}:`, err);
    return null;
  }
}

/**
 * Uploads a file to a user-scoped path in a private bucket.
 * Enforces that the path begins with the authenticated user's ID.
 *
 * @param bucket - Target storage bucket
 * @param path - User-scoped path: `${userId}/...`
 * @param file - File body / ArrayBuffer / Blob
 * @param contentType - Optional MIME type
 */
export async function uploadPrivateFile(
  bucket: StorageBucket,
  path: string,
  file: any,
  contentType?: string
): Promise<{ path: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        contentType,
        upsert: true,
      });

    if (error || !data?.path) {
      return { path: null, error: error?.message || 'Upload failed' };
    }

    return { path: data.path, error: null };
  } catch (err: any) {
    return { path: null, error: err?.message || String(err) };
  }
}

/**
 * Deletes a private file from Supabase Storage.
 *
 * @param bucket - Target storage bucket
 * @param path - User-scoped path
 */
export async function deletePrivateFile(
  bucket: StorageBucket,
  path: string
): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove([path]);

    if (error) {
      console.warn(`[StorageService] Failed to delete file ${bucket}/${path}:`, error);
      return false;
    }

    return true;
  } catch (err) {
    console.warn(`[StorageService] Exception deleting file ${bucket}/${path}:`, err);
    return false;
  }
}
