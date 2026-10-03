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

import { supabase } from '../lib/supabase';

export const BUCKET_ITEM_IMAGES = 'item-images';
export const BUCKET_ITEM_DOCUMENTS = 'item-documents';
export const BUCKET_VAULT_DOCUMENTS = 'vault-documents';

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

  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data?.signedUrl) {
      console.warn(`[StorageService] Failed to create signed URL for ${bucket}/${path}:`, error);
      return null;
    }

    return data.signedUrl;
  } catch (err) {
    console.warn(`[StorageService] Exception creating signed URL for ${bucket}/${path}:`, err);
    return null;
  }
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
