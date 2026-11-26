/**
 * KEEPR DIGITAL OWNERSHIP VAULT: Image Quality Preservation, Thumbnail Separation & Integrity Pipeline
 *
 * Architectural Rules Enforced:
 * 1. Originals remain untouched (no lossy JPEG re-encoding when copying/persisting original bytes).
 * 2. List thumbnails live separately in `vault_thumbnails/` so fast lists NEVER downsample the original.
 * 3. Full-screen viewers and original downloads NEVER consume or export lightweight thumbnails.
 * 4. Optional enhancements always write to a separate `_enhanced` copy, preserving original invoice data.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { readUriBytesAndBase64Safely } from './pdfFileAccessService';
import { detectFormatFromBase64Prefix, detectFormatFromBytes, detectFormatFromUriOrName } from '../utils/imageIntegrity';
import {
  buildEnhancedFilename,
  buildMediaQualityMetadata,
  computeSha256Hex,
  decodeBase64ToBytes,
  ImageDimensions,
  MediaQualityMetadata,
} from '../utils/imageMetadata';

const THUMBNAIL_DIR_NAME = 'vault_thumbnails';
const ORIGINAL_DIR_NAME = 'vault_originals';
const ENHANCED_DIR_NAME = 'vault_enhanced';
const DEFAULT_THUMBNAIL_WIDTH = 360;

export interface PreservedMediaAssetResult {
  originalUri: string;
  thumbnailUri: string | null;
  metadata: MediaQualityMetadata;
  verifiedOriginalMatch: boolean;
}

export interface SeparateEnhancementResult {
  success: boolean;
  originalUri: string;
  enhancedUri: string;
  enhancedFileName: string;
  preset: 'readability' | 'high_contrast_doc' | 'rotate_90' | 'crop_tight' | 'custom';
  metadata?: MediaQualityMetadata;
  error?: string;
}

function getSubdirectoryUri(dirName: string): string {
  const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  if (!baseDir) return '';
  const withSlash = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  return `${withSlash}${dirName}/`;
}

async function ensureSubdirectory(dirName: string): Promise<string> {
  const dirUri = getSubdirectoryUri(dirName);
  if (!dirUri) {
    throw new Error(`Storage directory "${dirName}" is unavailable on this device.`);
  }
  const info = await FileSystem.getInfoAsync(dirUri).catch(() => null);
  if (!info?.exists) {
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  }
  return dirUri;
}

/**
 * Checks whether a path/URI points to a generated thumbnail asset rather than an original file.
 */
export function isGeneratedThumbnailUri(uri?: string | null): boolean {
  if (!uri || typeof uri !== 'string') return false;
  const lower = uri.toLowerCase();
  return lower.includes(`/${THUMBNAIL_DIR_NAME}/`) || lower.includes('_thumb.');
}

/**
 * Resolves visual pixel dimensions of an image URI using RN Image.getSize as fallback
 * when header parsing is unavailable (e.g. HEIC or remote URL).
 */
export async function getImageDimensionsFromUri(uri: string): Promise<ImageDimensions | null> {
  if (!uri) return null;
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => {
        if (width > 0 && height > 0) {
          resolve({ width, height });
        } else {
          resolve(null);
        }
      },
      () => resolve(null)
    );
  });
}

/**
 * Inspects any local media asset (image or PDF) and returns verified format, dimensions,
 * exact byte length, and cryptographic SHA-256 fingerprint.
 */
export async function inspectMediaAsset(
  uri: string,
  options?: { fileName?: string | null; mimeType?: string | null; base64?: string | null }
): Promise<MediaQualityMetadata | null> {
  if (!uri && !options?.base64) return null;

  let bytes: Uint8Array | null = null;
  if (uri && !uri.startsWith('http://') && !uri.startsWith('https://')) {
    const safeRead = await readUriBytesAndBase64Safely(uri, {
      fileName: options?.fileName,
      mimeType: options?.mimeType,
    }).catch(() => null);
    if (safeRead?.success && safeRead.bytes.length > 0) {
      bytes = safeRead.bytes;
    }
  }

  if ((!bytes || bytes.length === 0) && options?.base64) {
    bytes = decodeBase64ToBytes(options.base64);
  }

  if (!bytes || bytes.length === 0) {
    return null;
  }

  const prelim = buildMediaQualityMetadata(bytes);
  if (prelim.format !== 'pdf' && (prelim.width === 0 || prelim.height === 0) && uri) {
    const nativeDims = await getImageDimensionsFromUri(uri);
    if (nativeDims) {
      return buildMediaQualityMetadata(bytes, nativeDims);
    }
  }

  return prelim;
}

/**
 * Generates or retrieves a lightweight list thumbnail inside `vault_thumbnails/`
 * WITHOUT modifying, resizing, or re-encoding the original image.
 * Returns null cleanly for PDFs (which must never be forged into fake thumbnails).
 */
export async function getOrCreateLocalThumbnail(
  originalUri: string,
  stableKey?: string | null,
  maxWidth: number = DEFAULT_THUMBNAIL_WIDTH
): Promise<string | null> {
  if (!originalUri) return null;
  const clean = originalUri.trim().split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith('.pdf')) return null;

  try {
    const thumbDir = await ensureSubdirectory(THUMBNAIL_DIR_NAME);
    const leaf = originalUri.split('/').pop() || 'thumb';
    const rawKey = stableKey || leaf;
    const safeKey = rawKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const destUri = `${thumbDir}${safeKey}_thumb.jpg`;

    const existing = await FileSystem.getInfoAsync(destUri).catch(() => null);
    if (existing?.exists && !existing.isDirectory && (existing.size || 0) > 100) {
      return destUri;
    }

    // Only manipulate existing local image files (never remote URLs directly if un-cached)
    if (originalUri.startsWith('http://') || originalUri.startsWith('https://')) {
      return null;
    }

    const result = await manipulateAsync(
      originalUri,
      [{ resize: { width: maxWidth } }],
      { compress: 0.72, format: SaveFormat.JPEG }
    );

    if (result?.uri) {
      await FileSystem.copyAsync({ from: result.uri, to: destUri }).catch(async () => {
        const base64 = await FileSystem.readAsStringAsync(result.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await FileSystem.writeAsStringAsync(destUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      });
      return destUri;
    }
  } catch (err) {
    console.warn('[ImagePipeline] Thumbnail generation notice:', err);
  }

  return null;
}

/**
 * Preserves the exact original media asset bytes into durable app storage without lossy
 * re-encoding, generates a separate lightweight thumbnail (images only), and cryptographically
 * verifies that the stored original SHA-256 matches the source bytes.
 */
export async function preserveOriginalMediaAsset(
  sourceUri: string,
  options?: {
    preferredFileName?: string | null;
    base64Fallback?: string | null;
    generateThumbnail?: boolean;
    subfolder?: 'vault_originals' | 'vault_receipts' | 'vault_documents';
  }
): Promise<PreservedMediaAssetResult | null> {
  const safeRead = await readUriBytesAndBase64Safely(sourceUri, {
    fileName: options?.preferredFileName,
  }).catch(() => null);

  let sourceBytes: Uint8Array | null = safeRead?.success ? safeRead.bytes : null;
  let sourceBase64: string | null = safeRead?.success ? safeRead.base64 : null;

  if ((!sourceBytes || sourceBytes.length === 0) && options?.base64Fallback) {
    sourceBase64 = options.base64Fallback.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    sourceBytes = decodeBase64ToBytes(sourceBase64);
  }

  if (!sourceBytes || sourceBytes.length === 0 || !sourceBase64) {
    return null;
  }

  const detected = detectFormatFromBytes(sourceBytes);
  const metadata = buildMediaQualityMetadata(sourceBytes);
  const sourceHash = metadata.sha256;

  const targetDir = await ensureSubdirectory(options?.subfolder || ORIGINAL_DIR_NAME);
  const baseLeaf = (options?.preferredFileName || safeRead?.fileName || 'original_media')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 48);

  const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${baseLeaf}${detected.extension}`;
  const destUri = `${targetDir}${uniqueName}`;

  await FileSystem.writeAsStringAsync(destUri, sourceBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Verify stored copy matches source bytes bit-for-bit via SHA-256
  const storedRead = await readUriBytesAndBase64Safely(destUri, {
    mimeType: detected.mimeType,
  }).catch(() => null);
  const storedHash =
    storedRead?.success && storedRead.bytes.length > 0
      ? computeSha256Hex(storedRead.bytes)
      : '';
  const verifiedOriginalMatch = storedHash === sourceHash;

  // Optionally generate lightweight list thumbnail separately (original remains untouched)
  let thumbnailUri: string | null = null;
  if (options?.generateThumbnail !== false && detected.format !== 'pdf') {
    thumbnailUri = await getOrCreateLocalThumbnail(destUri, sourceHash.slice(0, 24));
  }

  // Enrich metadata dimensions if native header fallback needed
  if (metadata.format !== 'pdf' && (metadata.width === 0 || metadata.height === 0)) {
    const dims = await getImageDimensionsFromUri(destUri);
    if (dims) {
      metadata.width = dims.width;
      metadata.height = dims.height;
      metadata.megapixels = Math.round(((dims.width * dims.height) / 1_000_000) * 100) / 100;
    }
  }

  return {
    originalUri: destUri,
    thumbnailUri,
    metadata,
    verifiedOriginalMatch,
  };
}

/**
 * Persists an enhanced image payload (produced either via geometric rotate/crop or canvas pixel filter)
 * as a completely separate `_enhanced` file so the original image ALWAYS stays intact and unmodified.
 */
export async function saveSeparateEnhancedImage(options: {
  originalUri: string;
  originalFileName?: string | null;
  enhancedBase64?: string | null;
  actions?: Parameters<typeof manipulateAsync>[1];
  preset: SeparateEnhancementResult['preset'];
}): Promise<SeparateEnhancementResult> {
  const { originalUri, originalFileName, enhancedBase64, actions, preset } = options;

  try {
    const enhancedDir = await ensureSubdirectory(ENHANCED_DIR_NAME);
    const leafName = originalFileName || originalUri.split('/').pop() || 'document.jpg';
    const formatFromB64 = enhancedBase64 ? detectFormatFromBase64Prefix(enhancedBase64) : null;
    const formatFromName = detectFormatFromUriOrName(leafName);
    const targetExt =
      formatFromB64?.extension ||
      (formatFromName.extension === '.png' ? '.png' : '.jpg');

    const enhancedFileName = buildEnhancedFilename(leafName, targetExt);
    const uniqueEnhancedName = `${Date.now()}_${enhancedFileName}`;
    const destUri = `${enhancedDir}${uniqueEnhancedName}`;

    if (enhancedBase64 && enhancedBase64.length > 32) {
      const cleanB64 = enhancedBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
      await FileSystem.writeAsStringAsync(destUri, cleanB64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } else if (actions && actions.length > 0 && originalUri) {
      // Geometric transformations at high quality (0.95) saved to a separate destination
      const targetFormat = targetExt === '.png' ? SaveFormat.PNG : SaveFormat.JPEG;
      const result = await manipulateAsync(originalUri, actions, {
        compress: targetFormat === SaveFormat.JPEG ? 0.95 : 1,
        format: targetFormat,
        base64: true,
      });
      if (result.base64) {
        await FileSystem.writeAsStringAsync(destUri, result.base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        await FileSystem.copyAsync({ from: result.uri, to: destUri });
      }
    } else {
      return {
        success: false,
        originalUri,
        enhancedUri: '',
        enhancedFileName: '',
        preset,
        error: 'No enhanced image data or transform actions were supplied.',
      };
    }

    const meta = await inspectMediaAsset(destUri, { fileName: uniqueEnhancedName });
    return {
      success: true,
      originalUri,
      enhancedUri: destUri,
      enhancedFileName: uniqueEnhancedName,
      preset,
      metadata: meta || undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      originalUri,
      enhancedUri: '',
      enhancedFileName: '',
      preset,
      error: err?.message || 'Failed to save enhanced copy cleanly.',
    };
  }
}
