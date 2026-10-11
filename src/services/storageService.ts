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
import { getCanonicalReceiptUri } from './receiptFileService';

export const BUCKET_ITEM_IMAGES = 'item-images';
export const BUCKET_ITEM_DOCUMENTS = 'item-documents';
export const BUCKET_VAULT_DOCUMENTS = 'vault-documents';

export type StorageBucket =
  | typeof BUCKET_ITEM_IMAGES
  | typeof BUCKET_ITEM_DOCUMENTS
  | typeof BUCKET_VAULT_DOCUMENTS;

// In-memory cache for signed URLs (maps storagePath -> { url, expiresAt })
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Checks whether a given string is a Supabase Storage path.
 * True for paths like: `${userId}/items/${itemId}/photo_0.jpg` or `user-id/items/item-id/photo.jpg`
 * False for: `file://...`, `content://...`, `http://...`, `data:...`, `/data/...`, `vault_receipts/...`
 */
export function isStoragePath(path?: string | null): boolean {
  if (!path || typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (!trimmed) return false;

  if (
    trimmed.startsWith('file:') ||
    trimmed.startsWith('content:') ||
    trimmed.startsWith('http:') ||
    trimmed.startsWith('https:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('vault_receipts/') ||
    trimmed.startsWith('vault_documents/')
  ) {
    return false;
  }

  // Must contain at least one '/' separating owner segment and file hierarchy
  return trimmed.includes('/');
}

/**
 * Checks if a URI is a local device URI.
 */
export function isLocalUri(uri?: string | null): boolean {
  if (!uri || typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  return (
    trimmed.startsWith('file:') ||
    trimmed.startsWith('content:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('vault_receipts/') ||
    trimmed.startsWith('vault_documents/')
  );
}

/**
 * Checks if a URI is a remote HTTP or HTTPS URL.
 */
export function isRemoteUrl(uri?: string | null): boolean {
  if (!uri || typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/**
 * Returns an unexpired cached signed URL if available, or null.
 */
export function getCachedSignedUrl(path: string): string | null {
  if (!path) return null;
  const entry = signedUrlCache.get(path);
  if (entry && entry.expiresAt > Date.now() + 60_000) {
    return entry.url;
  }
  return null;
}

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

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data?.signedUrl) {
      console.warn(`[StorageService] Failed to create signed URL for ${bucket}/${path}:`, error?.message || error);
      return null;
    }

    return data.signedUrl;
  } catch (err) {
    console.warn(`[StorageService] Exception creating signed URL for ${bucket}/${path}:`, err);
    return null;
  }
}

/**
 * Gets or creates a signed URL for an item product image in private item-images bucket.
 * Caches the URL in memory with TTL.
 */
export async function getItemImageSignedUrl(
  path: string,
  expiresIn: number = 3600
): Promise<string | null> {
  if (!path || !isStoragePath(path)) return null;

  const cached = getCachedSignedUrl(path);
  if (cached) return cached;

  const signed = await createPrivateSignedUrl(BUCKET_ITEM_IMAGES, path, expiresIn);
  if (signed) {
    signedUrlCache.set(path, {
      url: signed,
      expiresAt: Date.now() + expiresIn * 1000,
    });
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
    new Set(paths.filter((p) => p && isStoragePath(p) && !getCachedSignedUrl(p)))
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
    const canonical = getCanonicalReceiptUri(localUri) || localUri;
    let fileUriToRead: string | null = null;

    try {
      const cInfo = await FileSystem.getInfoAsync(canonical).catch(() => null);
      if (cInfo?.exists && !cInfo.isDirectory) {
        fileUriToRead = canonical;
      }
    } catch {}

    if (!fileUriToRead && canonical !== localUri) {
      try {
        const rawInfo = await FileSystem.getInfoAsync(localUri).catch(() => null);
        if (rawInfo?.exists && !rawInfo.isDirectory) {
          fileUriToRead = localUri;
        }
      } catch {}
    }

    if (!fileUriToRead) {
      return { storagePath: null, error: 'Local file does not exist' };
    }

    const lower = fileUriToRead.toLowerCase().split('?')[0];
    let ext = '.jpg';
    let contentType = 'image/jpeg';
    if (lower.endsWith('.png')) {
      ext = '.png';
      contentType = 'image/png';
    } else if (lower.endsWith('.webp')) {
      ext = '.webp';
      contentType = 'image/webp';
    } else if (lower.endsWith('.heic')) {
      ext = '.heic';
      contentType = 'image/heic';
    }

    const storagePath = `${userId}/items/${itemId}/photo_${index}${ext}`;

    const base64 = await FileSystem.readAsStringAsync(fileUriToRead, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_ITEM_IMAGES)
      .upload(storagePath, bytes, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.warn(`[StorageService] Upload item photo failed for ${storagePath}:`, uploadError.message);
      return { storagePath: null, error: uploadError.message };
    }

    // Immediately cache signed URL so this newly created item renders instantly
    createPrivateSignedUrl(BUCKET_ITEM_IMAGES, storagePath, 3600).then((signedUrl) => {
      if (signedUrl) {
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
