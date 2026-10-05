// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Receipt File Stabilization & Lifecycle Service
// Ensures local file URIs survive Android lifecycle, permissions, and navigation
// Guarantees stable relative storage paths and dynamic documentDirectory re-anchoring
// ==============================================================================

import { Platform, Image } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export interface StabilizedReceiptResult {
  uri: string;
  storagePath?: string;
  exists: boolean;
  size?: number;
  isStable: boolean;
  base64?: string | null;
}

/**
 * Returns the app's persistent vault receipts directory URI with trailing slash.
 * Anchors into FileSystem.documentDirectory (immune to Android cache purges).
 */
export function getVaultDirectory(): string {
  const docDir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  if (!docDir) return '';
  return docDir.endsWith('/') ? `${docDir}vault_receipts/` : `${docDir}/vault_receipts/`;
}

/**
 * Returns the app's persistent vault documents directory URI with trailing slash.
 * Anchors into FileSystem.documentDirectory (immune to Android cache purges).
 */
export function getDocumentsDirectory(): string {
  const docDir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  if (!docDir) return '';
  return docDir.endsWith('/') ? `${docDir}vault_documents/` : `${docDir}/vault_documents/`;
}

/**
 * Dynamically converts any relative storage path, filename, or stale container path
 * into a live, canonical URI anchored to the current app's document directory.
 * Survives iOS container UUID changes and Android package path variations across restarts.
 */
export function getCanonicalStorageUri(
  rawUriOrPath?: string | null,
  folder: 'vault_receipts' | 'vault_documents' = 'vault_receipts'
): string {
  if (!rawUriOrPath || typeof rawUriOrPath !== 'string') return '';
  const trimmed = rawUriOrPath.trim();
  if (!trimmed) return '';

  // Remote URLs or data URIs
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  if (folder === 'vault_documents' && (trimmed.startsWith('vault_receipts/') || trimmed.includes('/vault_receipts/'))) {
    return getCanonicalStorageUri(trimmed, 'vault_receipts');
  }

  const baseDir = folder === 'vault_documents' ? getDocumentsDirectory() : getVaultDirectory();
  if (!baseDir) return trimmed;

  const folderPrefix = `${folder}/`;

  if (trimmed.startsWith(folderPrefix)) {
    const fileName = trimmed.substring(folderPrefix.length);
    return `${baseDir}${fileName}`;
  }

  const idx = trimmed.indexOf(folderPrefix);
  if (idx !== -1) {
    const relativePart = trimmed.substring(idx + folderPrefix.length);
    const cleanFileName = relativePart.split('?')[0].replace(/^\/+/, '');
    return `${baseDir}${cleanFileName}`;
  }

  if (trimmed.startsWith('/')) {
    return `file://${trimmed}`;
  }

  return trimmed;
}

export function getCanonicalReceiptUri(rawUriOrPath?: string | null): string {
  return getCanonicalStorageUri(rawUriOrPath, 'vault_receipts');
}

export function getCanonicalDocumentUri(rawUriOrPath?: string | null): string {
  return getCanonicalStorageUri(rawUriOrPath, 'vault_documents');
}

/**
 * Normalizes an image URI to ensure it renders correctly across Android, iOS, and Web.
 * Safely wraps safeNormalizeRouteUri.
 */
export function normalizeImageUri(uri?: string | null): string {
  if (!uri) return '';
  return safeNormalizeRouteUri(uri);
}

/**
 * Safely normalizes a route parameter or storage URI without corrupting encoded characters.
 * Prevents destruction of Expo file paths containing '%2540' or '%252F'.
 */
export function safeNormalizeRouteUri(rawParam?: string | null): string {
  if (!rawParam || typeof rawParam !== 'string') return '';
  let trimmed = rawParam.trim();
  if (!trimmed) return '';

  // 1. Clean remote or inline data URIs - keep as-is
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  if (
    trimmed.startsWith('file%3A') ||
    trimmed.startsWith('content%3A') ||
    trimmed.startsWith('http%3A') ||
    trimmed.startsWith('https%3A')
  ) {
    try {
      trimmed = decodeURIComponent(trimmed);
    } catch {}
  }

  // 3. If it references vault_receipts, return canonical re-anchored path
  if (
    trimmed.startsWith('vault_receipts/') ||
    trimmed.includes('/vault_receipts/') ||
    trimmed.includes('vault_receipts/')
  ) {
    return getCanonicalReceiptUri(trimmed);
  }

  if (trimmed.startsWith('/')) {
    return `file://${trimmed}`;
  }

  // 5. Existing valid file:// or content:// URI:
  // CRITICAL: NEVER call decodeURIComponent on a valid file:// URI!
  // On Android Expo Go, the experience directory contains '%2540' and '%252F'.
  // Calling decodeURIComponent converts '%252F' to '/', splitting the folder name into non-existent subdirectories!
  return trimmed;
}

/**
 * Verifies local file existence and ensures the URI is in a stable, readable location.
 * On Android, content:// URIs from photo pickers are copied into the app's cache directory
 * so that React Native's Image component (Fresco) can reliably read them without permission denial.
 */
export async function stabilizeReceiptImage(
  rawUri: string,
  base64?: string | null
): Promise<StabilizedReceiptResult> {
  if (!rawUri) {
    return { uri: '', exists: false, isStable: false };
  }

  // Web platform or remote URLs
  if (Platform.OS === 'web' || rawUri.startsWith('http://') || rawUri.startsWith('https://') || rawUri.startsWith('data:')) {
    return { uri: rawUri, exists: true, isStable: true, base64 };
  }

  try {
    // 1. Android content:// URIs - copy to app cache for permanent read access
    if (rawUri.startsWith('content://')) {
      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (cacheDir) {
        const receiptsDir = `${cacheDir}receipts/`;
        const dirInfo = await FileSystem.getInfoAsync(receiptsDir).catch(() => null);
        if (!dirInfo?.exists) {
          await FileSystem.makeDirectoryAsync(receiptsDir, { intermediates: true }).catch(() => {});
        }

        const stableTarget = `${receiptsDir}receipt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
        console.log('[ReceiptFileService] Copying content:// URI to stable path:', stableTarget);

        await FileSystem.copyAsync({
          from: rawUri,
          to: stableTarget,
        });

        const targetInfo = await FileSystem.getInfoAsync(stableTarget);
        if (targetInfo.exists) {
          console.log('[ReceiptFileService] Successfully stabilized content:// to file://', stableTarget, 'size:', targetInfo.size);
          return {
            uri: stableTarget,
            exists: true,
            size: targetInfo.size,
            isStable: true,
            base64,
          };
        }
      }
    }

    const fileInfo = await FileSystem.getInfoAsync(rawUri).catch(() => null);
    if (fileInfo && fileInfo.exists) {
      console.log('[ReceiptFileService] Verified file exists at URI:', rawUri, 'size:', fileInfo.size);
      return {
        uri: rawUri,
        exists: true,
        size: fileInfo.size,
        isStable: true,
        base64,
      };
    }

    if (base64 && base64.length > 50) {
      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (cacheDir) {
        const receiptsDir = `${cacheDir}receipts/`;
        const dirInfo = await FileSystem.getInfoAsync(receiptsDir).catch(() => null);
        if (!dirInfo?.exists) {
          await FileSystem.makeDirectoryAsync(receiptsDir, { intermediates: true }).catch(() => {});
        }
        const recoveredUri = `${receiptsDir}recovered_${Date.now()}.jpg`;
        console.log('[ReceiptFileService] Restoring file from base64 to:', recoveredUri);
        const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, '');
        await FileSystem.writeAsStringAsync(recoveredUri, cleanBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const recInfo = await FileSystem.getInfoAsync(recoveredUri);
        if (recInfo.exists) {
          return {
            uri: recoveredUri,
            exists: true,
            size: recInfo.size,
            isStable: true,
            base64,
          };
        }
      }
    }

    console.warn('[ReceiptFileService] File does not exist at URI and no base64 recovery possible:', rawUri);
    return {
      uri: rawUri,
      exists: false,
      isStable: false,
      base64,
    };
  } catch (err) {
    console.error('[ReceiptFileService] Error stabilizing receipt URI:', err);
    return {
      uri: rawUri,
      exists: false,
      isStable: false,
      base64,
    };
  }
}

export interface PersistedReceiptResult {
  uri: string;
  storagePath: string;
  fileName: string;
  persisted: boolean;
  fileSize?: number;
  error?: string;
}

/**
 * Generic vault file existence verifier.
 * Checks canonical re-anchored path in the specified folder and raw path.
 */
export async function verifyVaultFileExists(
  uriOrPath?: string | null,
  folder: 'vault_receipts' | 'vault_documents' = 'vault_receipts'
): Promise<boolean> {
  if (!uriOrPath) return false;
  const clean = safeNormalizeRouteUri(uriOrPath);
  if (!clean) return false;

  if (
    Platform.OS === 'web' ||
    clean.startsWith('http://') ||
    clean.startsWith('https://') ||
    clean.startsWith('data:')
  ) {
    return true;
  }

  // 1. Try canonical re-anchored path in specified folder
  const canonical = getCanonicalStorageUri(clean, folder);
  try {
    const info = await FileSystem.getInfoAsync(canonical).catch(() => null);
    if (info?.exists && !info.isDirectory) {
      if (info.size === undefined || info.size > 0) return true;
    }
  } catch {}

  // 2. If checking documents, also check canonical receipts as fallback
  if (folder === 'vault_documents') {
    const canonicalRec = getCanonicalReceiptUri(clean);
    try {
      const info = await FileSystem.getInfoAsync(canonicalRec).catch(() => null);
      if (info?.exists && !info.isDirectory) {
        if (info.size === undefined || info.size > 0) return true;
      }
    } catch {}
  }

  // 3. Try raw clean path
  try {
    const info = await FileSystem.getInfoAsync(clean).catch(() => null);
    if (info?.exists && !info.isDirectory) {
      if (info.size === undefined || info.size > 0 || clean.startsWith('content://')) {
        return true;
      }
    }
  } catch {}

  return false;
}

/**
 * Safely verifies if a receipt file exists at the given URI or storage path.
 */
export async function verifyReceiptFileExists(uriOrPath?: string | null): Promise<boolean> {
  return verifyVaultFileExists(uriOrPath, 'vault_receipts');
}

/**
 * Safely verifies if a document file exists at the given URI or storage path.
 */
export async function verifyDocumentFileExists(uriOrPath?: string | null): Promise<boolean> {
  return verifyVaultFileExists(uriOrPath, 'vault_documents');
}

/**
 * Unified file persistence logic for both receipts and documents into permanent vault storage.
 * Handles directory creation, extension detection, duplicate-in-vault check, copyAsync, and base64 fallback.
 */
export async function persistFileToVault(
  sourceUri?: string | null,
  folder: 'vault_receipts' | 'vault_documents' = 'vault_receipts',
  preferredFileName?: string,
  base64Fallback?: string | null
): Promise<PersistedReceiptResult> {
  if (!sourceUri && !base64Fallback) {
    return { uri: '', storagePath: '', fileName: '', persisted: false, error: 'No source URI or base64 data provided' };
  }

  const cleanSource = sourceUri ? safeNormalizeRouteUri(sourceUri) : '';
  const fallbackDefaultName = folder === 'vault_documents' ? 'remote_document.pdf' : 'remote_receipt.jpg';

  if (
    Platform.OS === 'web' ||
    cleanSource.startsWith('http://') ||
    cleanSource.startsWith('https://') ||
    cleanSource.startsWith('data:')
  ) {
    return {
      uri: cleanSource,
      storagePath: cleanSource,
      fileName: preferredFileName || fallbackDefaultName,
      persisted: true,
    };
  }

  try {
    const targetDir = folder === 'vault_documents' ? getDocumentsDirectory() : getVaultDirectory();
    if (!targetDir) {
      return {
        uri: cleanSource,
        storagePath: '',
        fileName: '',
        persisted: false,
        error: 'Cannot access app document directory',
      };
    }

    const dirInfo = await FileSystem.getInfoAsync(targetDir).catch(() => null);
    if (!dirInfo?.exists) {
      await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true }).catch(() => {});
    }

    const lowerClean = cleanSource.toLowerCase();
    const lowerName = (preferredFileName || '').toLowerCase();
    let ext = '.jpg';
    if (lowerClean.endsWith('.pdf') || lowerName.endsWith('.pdf')) ext = '.pdf';
    else if (lowerClean.endsWith('.png') || lowerName.endsWith('.png')) ext = '.png';
    else if (lowerClean.endsWith('.webp') || lowerName.endsWith('.webp')) ext = '.webp';

    const defaultBase = folder === 'vault_documents' ? 'document' : 'receipt';
    const rawBaseName = (preferredFileName || defaultBase).replace(/[^a-zA-Z0-9._-]/g, '_');
    const cleanBaseName = rawBaseName.toLowerCase().endsWith(ext)
      ? rawBaseName.slice(0, -ext.length)
      : rawBaseName;

    const folderPrefix = `${folder}/`;

    // 1. If source is already in the persistent vault directory and exists with content, avoid duplicate copying
    if (cleanSource.includes(folderPrefix)) {
      const canonicalExisting = getCanonicalStorageUri(cleanSource, folder);
      const existingInfo = await FileSystem.getInfoAsync(canonicalExisting).catch(() => null);
      if (existingInfo?.exists && !existingInfo.isDirectory && (existingInfo.size === undefined || existingInfo.size > 0)) {
        const existingName = canonicalExisting.split(folderPrefix)[1] || `${cleanBaseName}${ext}`;
        const result: PersistedReceiptResult = {
          uri: canonicalExisting,
          storagePath: `${folderPrefix}${existingName}`,
          fileName: existingName,
          persisted: true,
          fileSize: existingInfo.size,
        };
        return result;
      }
    }

    const safeName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${cleanBaseName}${ext}`;
    const destinationUri = `${targetDir}${safeName}`;
    const storagePath = `${folderPrefix}${safeName}`;

    if (cleanSource) {
      try {
        const sourceInfo = await FileSystem.getInfoAsync(cleanSource).catch(() => null);
        if (sourceInfo?.exists && !sourceInfo.isDirectory) {
          await FileSystem.copyAsync({
            from: cleanSource,
            to: destinationUri,
          });
          const destInfo = await FileSystem.getInfoAsync(destinationUri).catch(() => null);
          if (destInfo?.exists && (destInfo.size === undefined || destInfo.size > 0)) {
            const result: PersistedReceiptResult = {
              uri: destinationUri,
              storagePath,
              fileName: safeName,
              persisted: true,
              fileSize: destInfo.size,
            };
            if (folder === 'vault_receipts') {
              logReceiptDebug('AFTER_PERSIST', {
                storedUri: destinationUri,
                storagePath,
                fileName: safeName,
                exists: true,
                fileSize: destInfo.size,
              });
            }
            return result;
          }
        }
      } catch (copyErr) {
        console.warn(`[ReceiptFileService] ${folder} copyAsync failed, checking base64 fallback:`, copyErr);
      }
    }

    // 3. Fallback: Write directly from base64 if source file was missing or copy failed
    if (base64Fallback && base64Fallback.length > 50) {
      const cleanBase64 = base64Fallback.replace(/^data:[a-zA-Z0-9/]+;base64,/, '');
      await FileSystem.writeAsStringAsync(destinationUri, cleanBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const destInfo = await FileSystem.getInfoAsync(destinationUri).catch(() => null);
      if (destInfo?.exists && (destInfo.size === undefined || destInfo.size > 0)) {
        const result: PersistedReceiptResult = {
          uri: destinationUri,
          storagePath,
          fileName: safeName,
          persisted: true,
          fileSize: destInfo.size,
        };
        if (folder === 'vault_receipts') {
          logReceiptDebug('AFTER_PERSIST', {
            storedUri: destinationUri,
            storagePath,
            fileName: safeName,
            exists: true,
            fileSize: destInfo.size,
          });
        }
        return result;
      }
    }

    return {
      uri: cleanSource,
      storagePath: '',
      fileName: safeName,
      persisted: false,
      error: `Source ${folder === 'vault_documents' ? 'document' : 'receipt'} file could not be read and no base64 recovery was available.`,
    };
  } catch (err: any) {
    console.error(`[ReceiptFileService] Error persisting ${folder} to vault storage:`, err);
    return {
      uri: cleanSource,
      storagePath: '',
      fileName: '',
      persisted: false,
      error: err?.message || `${folder} storage persistence failed`,
    };
  }
}

/**
 * Persists an uploaded or scanned document (JPEG, PNG, WEBP, or PDF) into permanent vault storage.
 */
export async function persistDocumentToVault(
  sourceUri?: string | null,
  preferredFileName?: string,
  base64Fallback?: string | null
): Promise<PersistedReceiptResult> {
  return persistFileToVault(sourceUri, 'vault_documents', preferredFileName, base64Fallback);
}

/**
 * Persists a temporary receipt image into permanent vault storage.
 */
export async function persistReceiptToVault(
  sourceUri?: string | null,
  preferredFileName?: string,
  base64Fallback?: string | null
): Promise<PersistedReceiptResult> {
  return persistFileToVault(sourceUri, 'vault_receipts', preferredFileName, base64Fallback);
}

/**
 * Persists an item product photo into permanent vault storage.
 */
export async function persistProductPhotoToVault(
  sourceUri?: string | null,
  preferredFileName?: string,
  base64Fallback?: string | null
): Promise<PersistedReceiptResult> {
  return persistFileToVault(sourceUri, 'vault_receipts', preferredFileName || 'product_photo.jpg', base64Fallback);
}

/**
 * Safely deletes a file from persistent vault storage (vault_receipts/ or vault_documents/).
 * Never deletes files outside the vault directory.
 */
export async function deleteLocalVaultFile(
  uriOrPath?: string | null,
  folder: 'vault_receipts' | 'vault_documents' = 'vault_receipts'
): Promise<boolean> {
  if (!uriOrPath || typeof uriOrPath !== 'string') return false;
  const folderPrefix = `${folder}/`;
  if (!uriOrPath.includes(folderPrefix)) {
    return false;
  }
  const canonical = getCanonicalStorageUri(uriOrPath, folder);
  if (!canonical || !canonical.includes(folderPrefix)) {
    return false;
  }
  try {
    const info = await FileSystem.getInfoAsync(canonical).catch(() => null);
    if (info?.exists) {
      await FileSystem.deleteAsync(canonical, { idempotent: true });
      console.log('[ReceiptFileService] Deleted unreferenced vault file:', canonical);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[ReceiptFileService] Failed to delete vault file:', err);
    return false;
  }
}

export interface ResolvedReceiptAttachment {
  uri: string;
  storagePath?: string;
  fileName?: string;
  name?: string;
  type: 'receipt' | 'invoice';
  isInvoice: boolean;
  source: 'direct' | 'shared_receipt' | 'document' | 'none';
}

/**
 * Resolves the canonical receipt or invoice attachment for an item from:
 * 1. item.receiptPath or item.receiptUri (re-anchored to active documentDirectory)
 * 2. Shared receipt entity matching item.receiptId
 * 3. Associated VaultDocument array with fileType 'receipt' | 'invoice'
 */
export function resolveItemReceipt(
  item: {
    receiptUri?: string;
    receiptPath?: string;
    receiptName?: string;
    receiptId?: string;
    receiptType?: 'receipt' | 'invoice';
    invoiceNumber?: string;
    documents?: Array<{ filePath?: string; fileUrl: string; name?: string; fileType?: string }>;
  },
  receipts?: Array<{ id: string; fileUri: string; storagePath?: string; fileName?: string; type?: 'receipt' | 'invoice' }>,
  documents?: Array<{ itemId?: string; filePath?: string; fileUrl: string; name?: string; fileType?: string }>
): ResolvedReceiptAttachment {
  const isInvoice = Boolean(
    item.receiptType === 'invoice' ||
    Boolean(item.invoiceNumber && item.invoiceNumber.trim())
  );
  const defaultType: 'receipt' | 'invoice' = isInvoice ? 'invoice' : 'receipt';

  // 1. Direct item.receiptPath or item.receiptUri
  const candidateDirect = item.receiptPath || item.receiptUri;
  if (candidateDirect && candidateDirect.trim()) {
    const canonical = getCanonicalReceiptUri(candidateDirect);
    const storagePath = item.receiptPath || (candidateDirect.includes('vault_receipts/')
      ? `vault_receipts/${candidateDirect.split('vault_receipts/')[1]}`
      : undefined);
    return {
      uri: canonical,
      storagePath,
      fileName: item.receiptName,
      name: item.receiptName || (isInvoice ? 'Invoice' : 'Receipt'),
      type: item.receiptType || defaultType,
      isInvoice,
      source: 'direct',
    };
  }

  // 2. Shared receipt record by receiptId
  if (item.receiptId && receipts && receipts.length > 0) {
    const shared = receipts.find((r) => r.id === item.receiptId);
    const candidateShared = shared?.storagePath || shared?.fileUri;
    if (candidateShared && candidateShared.trim()) {
      const canonical = getCanonicalReceiptUri(candidateShared);
      const storagePath = shared?.storagePath || (candidateShared.includes('vault_receipts/')
        ? `vault_receipts/${candidateShared.split('vault_receipts/')[1]}`
        : undefined);
      return {
        uri: canonical,
        storagePath,
        fileName: shared?.fileName || item.receiptName,
        name: shared?.fileName || item.receiptName || (isInvoice ? 'Invoice' : 'Receipt'),
        type: shared?.type || item.receiptType || defaultType,
        isInvoice: isInvoice || shared?.type === 'invoice',
        source: 'shared_receipt',
      };
    }
  }

  // 3. VaultDocument from item.documents or external documents array
  const allDocs = [...(item.documents || []), ...(documents || [])];
  const docMatch = allDocs.find(
    (d) => d.fileType === 'receipt' || d.fileType === 'invoice'
  );
  if (docMatch) {
    const candidateDoc = docMatch.filePath || docMatch.fileUrl;
    if (candidateDoc && candidateDoc.trim()) {
      const canonical = getCanonicalReceiptUri(candidateDoc);
      const storagePath = docMatch.filePath || (candidateDoc.includes('vault_receipts/')
        ? `vault_receipts/${candidateDoc.split('vault_receipts/')[1]}`
        : undefined);
      const docIsInvoice = docMatch.fileType === 'invoice' || isInvoice;
      return {
        uri: canonical,
        storagePath,
        fileName: docMatch.name || item.receiptName,
        name: docMatch.name || item.receiptName || (docIsInvoice ? 'Invoice' : 'Receipt'),
        type: docMatch.fileType === 'invoice' ? 'invoice' : defaultType,
        isInvoice: docIsInvoice,
        source: 'document',
      };
    }
  }

  return {
    uri: '',
    name: item.receiptName,
    type: defaultType,
    isInvoice,
    source: 'none',
  };
}

/**
 * Diagnostic logger for development and troubleshooting.
 * Does NOT log sensitive receipt data.
 */
export function logReceiptDiagnostics(params: {
  itemId?: string;
  receiptId?: string;
  storagePath?: string;
  resolvedUri?: string;
  fileExists: boolean;
  fileSize?: number;
  mimeType?: string;
}) {
  if (__DEV__) {
    console.log('[ReceiptDiagnostics]', {
      itemId: params.itemId || null,
      receiptId: params.receiptId || null,
      storagePath: params.storagePath || null,
      resolvedUri: params.resolvedUri ? params.resolvedUri.substring(0, 60) + '...' : null,
      fileExists: params.fileExists,
      fileSize: params.fileSize !== undefined ? `${params.fileSize} bytes` : 'unknown',
      mimeType: params.mimeType || 'unknown',
    });
  }
}

/**
 * Phase 2 runtime diagnostic logger. Logs safe metadata objects at key pipeline stages.
 * NEVER logs base64 data or raw image binary content.
 */
export function logReceiptDebug(
  stage:
    | 'SELECTED'
    | 'BEFORE_SAVE'
    | 'AFTER_PERSIST'
    | 'ITEM_HYDRATED'
    | 'ITEM_DETAILS'
    | 'IMAGE_RENDER'
    | 'FORM',
  data: {
    receiptId?: string;
    itemId?: string;
    originalUri?: string;
    storedUri?: string;
    resolvedUri?: string;
    storagePath?: string;
    documentId?: string;
    mimeType?: string;
    fileName?: string;
    exists?: boolean;
    fileSize?: number;
    sourceType?: string;
  }
) {
  if (typeof __DEV__ !== 'undefined' ? __DEV__ : true) {
    console.log(`[ReceiptDebug][${stage}]`, JSON.stringify(data, null, 2));
  }
}

/**
 * Prepares an image specifically for AI multimodal analysis (OCR/classification).
 * - Downsamples large photos to a max dimension of 1600px, which preserves razor-sharp text
 *   and invoice legibility while cutting file payload size by 85–90%.
 * - Re-encodes as JPEG at 0.82 quality.
 * - Leaves the user's original, high-resolution photo in documentDirectory completely untouched.
 * - Returns a temporary optimized base64 payload and MIME type for rapid, timeout-free transmission.
 */
export async function prepareImageForAnalysis(
  imageUri: string,
  existingBase64?: string | null
): Promise<{ base64: string; mimeType: string }> {
  try {
    if (!imageUri && existingBase64) {
      const clean = existingBase64.includes(',') ? existingBase64.split(',')[1] : existingBase64;
      return { base64: clean, mimeType: 'image/jpeg' };
    }

    if (imageUri.startsWith('data:')) {
      const parts = imageUri.split(',');
      const meta = parts[0];
      const data = parts[1] || '';
      const mime = meta.includes('image/png') ? 'image/png' : 'image/jpeg';
      return { base64: data, mimeType: mime };
    }

    // Inspect image size to determine downsampling
    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      Image.getSize(
        imageUri,
        (w, h) => resolve({ width: w, height: h }),
        () => resolve({ width: 0, height: 0 })
      );
    });

    const maxDim = Math.max(dims.width, dims.height);
    const actions: any[] = [];

    if (maxDim > 1600) {
      if (dims.width >= dims.height) {
        actions.push({ resize: { width: 1600 } });
      } else {
        actions.push({ resize: { height: 1600 } });
      }
    }

    const manipResult = await manipulateAsync(
      imageUri,
      actions,
      {
        compress: 0.82,
        format: SaveFormat.JPEG,
        base64: true,
      }
    );

    if (manipResult.base64) {
      return { base64: manipResult.base64, mimeType: 'image/jpeg' };
    }

    // Fallback: read directly if manipulator didn't return base64
    const directBase64 = await FileSystem.readAsStringAsync(manipResult.uri || imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { base64: directBase64, mimeType: 'image/jpeg' };
  } catch (err) {
    console.warn('[ReceiptFileService] prepareImageForAnalysis fallback:', err);
    if (existingBase64) {
      const clean = existingBase64.includes(',') ? existingBase64.split(',')[1] : existingBase64;
      return { base64: clean, mimeType: 'image/jpeg' };
    }
    const raw = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { base64: raw, mimeType: 'image/jpeg' };
  }
}

