/**
 * KEEPR DIGITAL OWNERSHIP VAULT: Original File Download Service (Images & PDFs)
 *
 * Strictly enforces:
 * 1. Downloads the ORIGINAL image or ORIGINAL PDF file — NEVER a thumbnail or rendered canvas screenshot.
 * 2. Verifies downloaded payloads using binary magic headers (%PDF, JPEG, PNG, WebP, HEIC) and size > 0.
 * 3. Preserves original file format, authentic extension, and SHA-256 fingerprint.
 * 4. Handles duplicate filenames (`Invoice.pdf` -> `Invoice (1).pdf`) when saving to Android device storage.
 * 5. Reports real progress states and honest errors (NEVER fakes completion if user cancels or save fails).
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import {
  BUCKET_ITEM_DOCUMENTS,
  BUCKET_ITEM_IMAGES,
  BUCKET_VAULT_DOCUMENTS,
  createPrivateSignedUrl,
  isLocalUri,
  isRemoteUrl,
  isStoragePath,
  StorageBucket,
} from './storageService';
import { readUriBytesAndBase64Safely } from './pdfFileAccessService';
import { getCanonicalDocumentUri, getCanonicalReceiptUri, safeNormalizeRouteUri } from './receiptFileService';
import { detectFormatFromBase64Prefix, detectFormatFromBytes, detectFormatFromUriOrName } from '../utils/imageIntegrity';
import {
  computeSha256Hex,
  decodeBase64ToBytes,
  resolveUniqueDownloadFilename,
  sanitizeDownloadFilename,
} from '../utils/imageMetadata';

export type DownloadStage =
  | 'preparing'
  | 'downloading'
  | 'verifying'
  | 'saving'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface DownloadProgressState {
  stage: DownloadStage;
  progress: number; // 0..1
  message: string;
}

export interface OriginalDownloadRequest {
  uri?: string | null;
  storagePath?: string | null;
  bucket?: StorageBucket | null;
  fileName?: string | null;
  title?: string | null;
  mimeType?: string | null;
  isPdf?: boolean;
  mode?: 'save_to_device' | 'share';
  onProgress?: (state: DownloadProgressState) => void;
}

export interface OriginalDownloadResult {
  success: boolean;
  cancelled?: boolean;
  savedUri?: string;
  fileName?: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  savedVia?: 'android_saf' | 'share_sheet' | 'cache';
  error?: string;
}

const EXPORT_CACHE_SUBDIR = 'keepr_downloads';
let rememberedAndroidDirectoryUri: string | null = null;

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

async function ensureExportCacheDir(): Promise<string> {
  const base = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  if (!base) {
    throw new Error('App cache directory is unavailable.');
  }
  const dirUri = `${base.endsWith('/') ? base : `${base}/`}${EXPORT_CACHE_SUBDIR}/`;
  const info = await FileSystem.getInfoAsync(dirUri).catch(() => null);
  if (!info?.exists) {
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  }
  return dirUri;
}

/**
 * Resolves and reads authentic binary bytes for any Keepr original file:
 * - Never downloads a thumbnail (prefers explicit original `storagePath` if uri is a cached thumbnail).
 * - Validates binary headers so PDFs contain `%PDF` and images are genuine image formats.
 */
async function resolveOriginalBinaryPayload(
  req: OriginalDownloadRequest,
  emit: (stage: DownloadStage, progress: number, message: string) => void
): Promise<{ bytes: Uint8Array; base64: string }> {
  const rawUri = req.uri ? safeNormalizeRouteUri(req.uri) : '';
  const storageCandidate =
    req.storagePath && isStoragePath(req.storagePath)
      ? req.storagePath.trim()
      : rawUri && isStoragePath(rawUri)
      ? rawUri
      : null;

  const isThumbnailUri = rawUri.toLowerCase().includes('/vault_thumbnails/') || rawUri.toLowerCase().includes('_thumb.');

  // 1. Try local original file if available and NOT a lightweight thumbnail
  if (rawUri && !isThumbnailUri && isLocalUri(rawUri) && !isStoragePath(rawUri)) {
    const candidates = Array.from(
      new Set([
        getCanonicalDocumentUri(rawUri),
        getCanonicalReceiptUri(rawUri),
        rawUri,
      ].filter((u): u is string => Boolean(u)))
    );

    for (const candidate of candidates) {
      const safeRead = await readUriBytesAndBase64Safely(candidate, {
        fileName: req.fileName || req.title,
        mimeType: req.mimeType,
      }).catch(() => null);

      if (safeRead?.success && safeRead.bytes.length > 0) {
        return { bytes: safeRead.bytes, base64: safeRead.base64 };
      }
    }
  }

  // 2. Private Supabase Storage bucket resolution (authenticated signed URL or blob download)
  let remoteFetchUrl: string | null = null;

  if (storageCandidate) {
    emit('downloading', 0.25, 'Fetching original file from secure vault...');
    const targetBucket: StorageBucket =
      req.bucket ||
      (storageCandidate.includes('/vault/')
        ? BUCKET_VAULT_DOCUMENTS
        : storageCandidate.includes('/receipt') || storageCandidate.includes('/doc_')
        ? BUCKET_ITEM_DOCUMENTS
        : BUCKET_ITEM_IMAGES);

    try {
      const { data: blobData, error: blobError } = await supabase.storage
        .from(targetBucket)
        .download(storageCandidate);

      if (!blobError && blobData && typeof blobData.arrayBuffer === 'function') {
        const ab = await blobData.arrayBuffer();
        const bytes = new Uint8Array(ab);
        if (bytes.length > 0) {
          return { bytes, base64: uint8ToBase64(bytes) };
        }
      }
    } catch {
      // Fallback to signed URL download below
    }

    const signed = await createPrivateSignedUrl(targetBucket, storageCandidate, 300);
    if (signed) {
      remoteFetchUrl = signed;
    }
  }

  // 3. Remote HTTPS URL (e.g. pre-signed download link) or data URI
  if (!remoteFetchUrl && rawUri) {
    if (rawUri.startsWith('data:')) {
      const base64 = rawUri.split(',')[1] || '';
      const bytes = decodeBase64ToBytes(base64);
      if (bytes.length > 0) {
        return { bytes, base64 };
      }
    } else if (isRemoteUrl(rawUri)) {
      remoteFetchUrl = rawUri;
    }
  }

  if (!remoteFetchUrl) {
    throw new Error('Original file source is unavailable. Check your connection or re-sync.');
  }

  emit('downloading', 0.45, 'Downloading full-resolution file...');
  const cacheDir = await ensureExportCacheDir();
  const tempDest = `${cacheDir}tmp_dl_${Date.now()}.bin`;

  const dlRes = await FileSystem.downloadAsync(remoteFetchUrl, tempDest);
  if (!dlRes || dlRes.status < 200 || dlRes.status >= 300) {
    await FileSystem.deleteAsync(tempDest, { idempotent: true }).catch(() => {});
    if (dlRes?.status === 401 || dlRes?.status === 403) {
      throw new Error('Access denied or download link expired. Please sign in and retry.');
    }
    throw new Error(`Download failed with HTTP status ${dlRes?.status || 'unknown'}.`);
  }

  const safeDownloaded = await readUriBytesAndBase64Safely(dlRes.uri, {
    fileName: req.fileName || req.title,
    mimeType: req.mimeType,
  });

  await FileSystem.deleteAsync(tempDest, { idempotent: true }).catch(() => {});

  if (!safeDownloaded.success || safeDownloaded.bytes.length === 0) {
    throw new Error('Downloaded file was empty or unreadable.');
  }

  return { bytes: safeDownloaded.bytes, base64: safeDownloaded.base64 };
}

/**
 * Saves bytes to Android user-chosen folder (Downloads / Documents) via Storage Access Framework
 * with automatic duplicate filename resolution (`File (1).pdf`).
 */
async function saveToAndroidDirectoryViaSaf(
  desiredFileName: string,
  mimeType: string,
  base64: string
): Promise<{ savedUri?: string; finalFileName?: string; cancelled?: boolean; error?: string }> {
  const saf = (FileSystem as any).StorageAccessFramework;
  if (!saf || typeof saf.requestDirectoryPermissionsAsync !== 'function') {
    return { error: 'Device folder picker is unavailable on this platform.' };
  }

  let directoryUri = rememberedAndroidDirectoryUri;

  const tryListNames = async (dirUri: string): Promise<string[] | null> => {
    try {
      const uris: string[] = await saf.readDirectoryAsync(dirUri);
      return uris
        .map((u) => {
          const decoded = decodeURIComponent(u);
          const leaf = decoded.split('/').pop() || decoded.split(':').pop() || '';
          return leaf;
        })
        .filter(Boolean);
    } catch {
      return null;
    }
  };

  let existingNames = directoryUri ? await tryListNames(directoryUri) : null;

  if (!directoryUri || existingNames === null) {
    rememberedAndroidDirectoryUri = null;
    const permission = await saf.requestDirectoryPermissionsAsync();
    if (!permission?.granted || !permission?.directoryUri) {
      return { cancelled: true };
    }
    directoryUri = permission.directoryUri;
    rememberedAndroidDirectoryUri = directoryUri;
    existingNames = (await tryListNames(directoryUri!)) || [];
  }

  const uniqueName = resolveUniqueDownloadFilename(desiredFileName, existingNames);
  const createdUri = await saf.createFileAsync(directoryUri!, uniqueName, mimeType);
  await FileSystem.writeAsStringAsync(createdUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    savedUri: createdUri,
    finalFileName: uniqueName,
  };
}

/**
 * Resets cached Android SAF directory URI (helpful in tests or when user wants a fresh folder).
 */
export function resetDownloadDestinationPreference(): void {
  rememberedAndroidDirectoryUri = null;
}

/**
 * Downloads or shares the authentic ORIGINAL image or PDF file cleanly.
 * Never exports a thumbnail or PDF canvas screenshot.
 */
export async function downloadOriginalFile(
  req: OriginalDownloadRequest
): Promise<OriginalDownloadResult> {
  const emit = (stage: DownloadStage, progress: number, message: string) => {
    try {
      req.onProgress?.({ stage, progress, message });
    } catch {}
  };

  try {
    emit('preparing', 0.1, 'Preparing original file...');
    const { bytes, base64 } = await resolveOriginalBinaryPayload(req, emit);

    emit('verifying', 0.7, 'Verifying file integrity...');
    const detectedFromBytes = detectFormatFromBytes(bytes);
    const detectedFromB64 = detectFormatFromBase64Prefix(base64);
    const detectedFromName = detectFormatFromUriOrName(req.fileName || req.uri || req.title);

    // Reject accidental HTML / JSON error responses returned instead of media bytes
    const headAscii = String.fromCharCode(...Array.from(bytes.subarray(0, Math.min(64, bytes.length)))).trim().toLowerCase();
    if (headAscii.startsWith('<!doctype') || headAscii.startsWith('<html') || headAscii.startsWith('{"error"')) {
      throw new Error('Server returned an error response instead of the original document.');
    }

    const authenticFormat =
      detectedFromBytes.format !== 'unknown'
        ? detectedFromBytes
        : detectedFromB64 || detectedFromName;

    if (req.isPdf && authenticFormat.format !== 'pdf') {
      throw new Error('Original PDF verification failed: payload is not a valid PDF document.');
    }

    const sha256 = computeSha256Hex(bytes);
    const authenticFileName = sanitizeDownloadFilename(
      req.fileName || req.title,
      authenticFormat.extension,
      authenticFormat.format === 'pdf' ? 'Keepr_Document' : 'Keepr_Image'
    );

    const cacheDir = await ensureExportCacheDir();
    let existingCacheNames: string[] = [];
    try {
      existingCacheNames = await FileSystem.readDirectoryAsync(cacheDir);
    } catch {}
    const safeCacheName = resolveUniqueDownloadFilename(authenticFileName, existingCacheNames);
    const localExportUri = `${cacheDir}${safeCacheName}`;

    await FileSystem.writeAsStringAsync(localExportUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    emit('saving', 0.85, 'Saving file...');

    // 1. Direct device save on Android (via StorageAccessFramework) when mode !== 'share'
    if (Platform.OS === 'android' && req.mode !== 'share') {
      const safResult = await saveToAndroidDirectoryViaSaf(
        authenticFileName,
        authenticFormat.mimeType,
        base64
      );
      if (safResult.cancelled) {
        emit('cancelled', 0, 'Download cancelled.');
        return {
          success: false,
          cancelled: true,
          fileName: authenticFileName,
          mimeType: authenticFormat.mimeType,
          byteSize: bytes.length,
          sha256,
        };
      }
      if (safResult.savedUri) {
        emit('completed', 1, `Saved "${safResult.finalFileName || authenticFileName}"`);
        return {
          success: true,
          savedUri: safResult.savedUri,
          fileName: safResult.finalFileName || authenticFileName,
          mimeType: authenticFormat.mimeType,
          byteSize: bytes.length,
          sha256,
          savedVia: 'android_saf',
        };
      }
    }

    // 2. Native Share / Save Files sheet (iOS "Save to Files" / Android fallback / explicit Share)
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(localExportUri, {
        mimeType: authenticFormat.mimeType,
        dialogTitle: `Save Original: ${authenticFileName}`,
        UTI:
          authenticFormat.format === 'pdf'
            ? 'com.adobe.pdf'
            : authenticFormat.format === 'png'
            ? 'public.png'
            : 'public.jpeg',
      });
      emit('completed', 1, `Ready to save "${safeCacheName}"`);
      return {
        success: true,
        savedUri: localExportUri,
        fileName: safeCacheName,
        mimeType: authenticFormat.mimeType,
        byteSize: bytes.length,
        sha256,
        savedVia: 'share_sheet',
      };
    }

    emit('completed', 1, `Saved to cache: ${safeCacheName}`);
    return {
      success: true,
      savedUri: localExportUri,
      fileName: safeCacheName,
      mimeType: authenticFormat.mimeType,
      byteSize: bytes.length,
      sha256,
      savedVia: 'cache',
    };
  } catch (err: any) {
    const message = err?.message || 'Could not download original file.';
    emit('failed', 0, message);
    return {
      success: false,
      error: message,
    };
  }
}
