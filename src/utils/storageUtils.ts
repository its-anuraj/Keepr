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
 * Cleans a Supabase Storage path or URL into a canonical relative storage path.
 * - Extracts clean path from signed or public URLs: https://.../item-images/user/items/item/photo_0.jpg -> user/items/item/photo_0.jpg
 * - Strips leading slashes: /user/items/... -> user/items/...
 * - Strips redundant bucket prefix: item-images/user/items/... -> user/items/...
 */
export function cleanStoragePath(pathOrUrl?: string | null): string | null {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return null;
  let trimmed = pathOrUrl.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith('file:') ||
    trimmed.startsWith('content:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return null;
  }

  // 1. If it's a Supabase storage URL, extract the path segment after the bucket
  if (trimmed.includes('/storage/v1/object/')) {
    const match = trimmed.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/?#]+)\/([^?#]+)/);
    if (match && match[2]) {
      try {
        trimmed = decodeURIComponent(match[2]);
      } catch {
        trimmed = match[2];
      }
    }
  } else if (
    trimmed.includes('/item-images/') ||
    trimmed.includes('/item-documents/') ||
    trimmed.includes('/vault-documents/')
  ) {
    const match = trimmed.match(/(?:item-images|item-documents|vault-documents)\/([^?#]+)/);
    if (match && match[1]) {
      try {
        trimmed = decodeURIComponent(match[1]);
      } catch {
        trimmed = match[1];
      }
    }
  }

  // 2. Strip leading slashes
  while (trimmed.startsWith('/')) {
    trimmed = trimmed.substring(1).trim();
  }

  // 3. Strip known bucket prefixes if at the root of the path
  for (const bucket of ['item-images', 'item-documents', 'vault-documents']) {
    if (trimmed.startsWith(`${bucket}/`)) {
      trimmed = trimmed.substring(bucket.length + 1).trim();
      break;
    }
  }

  return trimmed || null;
}

export const BUCKET_ITEM_IMAGES = 'item-images';
export const BUCKET_ITEM_DOCUMENTS = 'item-documents';
export const BUCKET_VAULT_DOCUMENTS = 'vault-documents';

// In-memory cache for signed URLs (maps storagePath or bucket:path -> { url, expiresAt })
export const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Stores a signed URL in the in-memory cache with an expiry timestamp.
 */
export function setCachedSignedUrl(pathOrKey: string, url: string, expiresIn: number = 3600): void {
  if (!pathOrKey || !url) return;
  signedUrlCache.set(pathOrKey, {
    url,
    expiresAt: Date.now() + expiresIn * 1000,
  });
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
 * Completely clears the in-memory signed URL cache.
 * Called on user logout / session switch to prevent leakage across users.
 */
export function clearSignedUrlCache(): void {
  signedUrlCache.clear();
}

/**
 * Invalidates cache entries for a specific path across all buckets.
 */
export function invalidateSignedUrlCache(path: string): void {
  if (!path) return;
  const trimmed = path.trim();
  signedUrlCache.delete(trimmed);
  signedUrlCache.delete(`${BUCKET_ITEM_IMAGES}:${trimmed}`);
  signedUrlCache.delete(`${BUCKET_ITEM_DOCUMENTS}:${trimmed}`);
  signedUrlCache.delete(`${BUCKET_VAULT_DOCUMENTS}:${trimmed}`);
}

/**
 * Checks if a URI is a local device URI.
 * Matches file://, content://, raw filesystem paths (/...), or local app cache relative paths.
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

export interface ItemImageCandidates {
  storagePath: string | null;
  remoteUrl: string | null;
  localUri: string | null;
}

export interface DocumentImageCandidates {
  storagePath: string | null;
  remoteUrl: string | null;
  localUri: string | null;
}

/**
 * Safely extracts the canonical storage path, remote URL, and local URI candidates
 * from an Item object or raw image string reference.
 */
export function extractItemImageCandidates(
  itemOrPath?: any,
  fallbackLocalUri?: string | null
): ItemImageCandidates {
  if (!itemOrPath) {
    const isFallbackRemote = fallbackLocalUri ? isRemoteUrl(fallbackLocalUri) : false;
    const cleanFallback = cleanStoragePath(fallbackLocalUri);
    const isFallbackStorage = cleanFallback ? isStoragePath(cleanFallback) : (fallbackLocalUri ? isStoragePath(fallbackLocalUri) : false);
    const isFallbackLocal = fallbackLocalUri ? isLocalUri(fallbackLocalUri) : false;

    return {
      storagePath: isFallbackStorage ? (cleanFallback || fallbackLocalUri!.trim()) : null,
      remoteUrl: isFallbackRemote ? fallbackLocalUri!.trim() : null,
      localUri: isFallbackLocal ? fallbackLocalUri!.trim() : (!isFallbackRemote && !isFallbackStorage && fallbackLocalUri ? fallbackLocalUri.trim() : null),
    };
  }

  if (typeof itemOrPath === 'string') {
    const clean = cleanStoragePath(itemOrPath);
    if (clean && isStoragePath(clean)) {
      return {
        storagePath: clean,
        remoteUrl: fallbackLocalUri && isRemoteUrl(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
        localUri: fallbackLocalUri && isLocalUri(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
      };
    }
    const trimmed = itemOrPath.trim();
    if (isStoragePath(trimmed)) {
      return {
        storagePath: trimmed,
        remoteUrl: fallbackLocalUri && isRemoteUrl(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
        localUri: fallbackLocalUri && isLocalUri(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
      };
    }
    if (isRemoteUrl(trimmed)) {
      return {
        storagePath: null,
        remoteUrl: trimmed,
        localUri: fallbackLocalUri && isLocalUri(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
      };
    }
    return {
      storagePath: null,
      remoteUrl: fallbackLocalUri && isRemoteUrl(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
      localUri: trimmed,
    };
  }

  // itemOrPath is an Item object
  const item = itemOrPath;

  // 1. Durable storage path
  let storagePath: string | null = null;
  const rawStorageCandidate =
    item.imageStoragePath ||
    item.imageUrl ||
    (Array.isArray(item.productPhotos) ? item.productPhotos[0] : null);

  const cleanedCandidate = cleanStoragePath(rawStorageCandidate);
  if (cleanedCandidate && isStoragePath(cleanedCandidate)) {
    storagePath = cleanedCandidate;
  } else if (item.imageStoragePath && isStoragePath(item.imageStoragePath)) {
    storagePath = cleanStoragePath(item.imageStoragePath) || item.imageStoragePath.trim();
  } else if (item.imageUrl && isStoragePath(item.imageUrl)) {
    storagePath = cleanStoragePath(item.imageUrl) || item.imageUrl.trim();
  } else if (Array.isArray(item.productPhotos)) {
    for (const p of item.productPhotos) {
      const c = cleanStoragePath(p);
      if (c && isStoragePath(c)) {
        storagePath = c;
        break;
      }
      if (typeof p === 'string' && isStoragePath(p)) {
        storagePath = p.trim();
        break;
      }
    }
  }

  // 2. Remote URL
  let remoteUrl: string | null = null;
  if (item.imageUrl && isRemoteUrl(item.imageUrl)) {
    remoteUrl = item.imageUrl.trim();
  } else if (item.photoUri && isRemoteUrl(item.photoUri)) {
    remoteUrl = item.photoUri.trim();
  } else if (Array.isArray(item.productPhotos)) {
    const found = item.productPhotos.find((p: any) => typeof p === 'string' && isRemoteUrl(p));
    if (found) remoteUrl = found.trim();
  } else if (fallbackLocalUri && isRemoteUrl(fallbackLocalUri)) {
    remoteUrl = fallbackLocalUri.trim();
  }

  // 3. Local URI (for device-local offline preview only)
  let localUri: string | null = null;
  if (fallbackLocalUri && isLocalUri(fallbackLocalUri)) {
    localUri = fallbackLocalUri.trim();
  } else if (item.photoUri && isLocalUri(item.photoUri)) {
    localUri = item.photoUri.trim();
  } else if (item.imageUrl && isLocalUri(item.imageUrl)) {
    localUri = item.imageUrl.trim();
  } else if (Array.isArray(item.productPhotos)) {
    const found = item.productPhotos.find((p: any) => typeof p === 'string' && isLocalUri(p));
    if (found) localUri = found.trim();
  }

  return { storagePath, remoteUrl, localUri };
}

/**
 * Checks whether a document or candidate reference represents a PDF file.
 */
export function isPdfDocument(docOrCandidate?: any): boolean {
  if (!docOrCandidate) return false;

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.bmp', '.gif'];

  if (typeof docOrCandidate === 'string') {
    const clean = docOrCandidate.trim().split(/[?#]/)[0].toLowerCase();
    if (imageExtensions.some((ext) => clean.endsWith(ext)) || clean.includes('image/')) {
      return false;
    }
    return clean.endsWith('.pdf') || clean.includes('application/pdf');
  }

  const doc = docOrCandidate;

  const cleanExt = (val?: string | null): string => {
    if (!val || typeof val !== 'string') return '';
    return val.trim().split(/[?#]/)[0].toLowerCase();
  };

  const pStorage = cleanExt(doc.storagePath);
  const pFile = cleanExt(doc.filePath);
  const pUrl = cleanExt(doc.fileUrl);

  // 1. Primary file path has explicit image extension -> definitely NOT a PDF
  if (
    imageExtensions.some((ext) => pStorage.endsWith(ext) || pFile.endsWith(ext) || pUrl.endsWith(ext))
  ) {
    return false;
  }

  // 2. MIME type starts with image/ and primary file does not end with .pdf -> definitely NOT a PDF
  if (
    doc.mimeType &&
    typeof doc.mimeType === 'string' &&
    doc.mimeType.toLowerCase().startsWith('image/') &&
    !pStorage.endsWith('.pdf') &&
    !pFile.endsWith('.pdf') &&
    !pUrl.endsWith('.pdf')
  ) {
    return false;
  }

  // 3. Primary file path ends with .pdf
  if (pStorage.endsWith('.pdf') || pFile.endsWith('.pdf') || pUrl.endsWith('.pdf')) {
    return true;
  }

  // 4. MIME type is application/pdf
  if (doc.mimeType && typeof doc.mimeType === 'string' && doc.mimeType.toLowerCase().includes('pdf')) {
    return true;
  }

  // 5. Title or name ends with .pdf
  const pTitle = cleanExt(doc.title);
  const pName = cleanExt(doc.name);
  if (pTitle.endsWith('.pdf') || pName.endsWith('.pdf')) {
    return true;
  }

  // 6. doc.fileType === 'pdf', but only if not an image document
  if (doc.fileType && typeof doc.fileType === 'string' && doc.fileType.toLowerCase() === 'pdf') {
    if (!isImageDocument(doc)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a document or candidate reference is explicitly an image file.
 */
export function isImageDocument(docOrCandidate?: any): boolean {
  if (!docOrCandidate) return false;

  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.bmp', '.gif'];

  if (typeof docOrCandidate === 'string') {
    const clean = docOrCandidate.trim().split(/[?#]/)[0].toLowerCase();
    return imageExtensions.some((ext) => clean.endsWith(ext)) || clean.includes('image/');
  }

  const doc = docOrCandidate;

  const cleanExt = (val?: string | null): string => {
    if (!val || typeof val !== 'string') return '';
    return val.trim().split(/[?#]/)[0].toLowerCase();
  };

  const pStorage = cleanExt(doc.storagePath);
  const pFile = cleanExt(doc.filePath);
  const pUrl = cleanExt(doc.fileUrl);

  // If primary document file explicitly ends with .pdf, the document itself is a PDF (even if it has a thumbnail image)
  if (pStorage.endsWith('.pdf') || pFile.endsWith('.pdf') || pUrl.endsWith('.pdf')) {
    return false;
  }

  if (doc.mimeType && typeof doc.mimeType === 'string' && doc.mimeType.toLowerCase().startsWith('image/')) {
    return true;
  }

  for (const field of [
    doc.storagePath,
    doc.filePath,
    doc.fileUrl,
    doc.storagePathBack,
    doc.filePathBack,
    doc.fileUrlBack,
    doc.title,
    doc.name,
  ]) {
    const clean = cleanExt(field);
    if (imageExtensions.some((ext) => clean.endsWith(ext))) {
      return true;
    }
  }

  if (
    doc.fileType &&
    typeof doc.fileType === 'string' &&
    (doc.fileType.toLowerCase() === 'image' ||
      imageExtensions.some((ext) => doc.fileType.toLowerCase() === ext.replace('.', '')))
  ) {
    if (!pStorage.endsWith('.pdf') && !pFile.endsWith('.pdf') && !pUrl.endsWith('.pdf')) {
      return true;
    }
  }

  return false;
}

/**
 * Determines the canonical Supabase Storage bucket for a document.
 * Item-linked documents reside in 'item-documents'.
 * Standalone vault documents reside in 'vault-documents'.
 */
export function getCanonicalDocumentBucket(docOrPath?: any): typeof BUCKET_ITEM_DOCUMENTS | typeof BUCKET_VAULT_DOCUMENTS {
  if (!docOrPath) return BUCKET_VAULT_DOCUMENTS;

  if (typeof docOrPath === 'object' && docOrPath !== null) {
    if (docOrPath.itemId) return BUCKET_ITEM_DOCUMENTS;
    const pathStr = docOrPath.storagePath || docOrPath.filePath || docOrPath.fileUrl;
    if (typeof pathStr === 'string' && (pathStr.includes('/items/') || pathStr.includes('item-documents'))) {
      return BUCKET_ITEM_DOCUMENTS;
    }
    return BUCKET_VAULT_DOCUMENTS;
  }

  if (typeof docOrPath === 'string') {
    if (docOrPath.includes('/items/') || docOrPath.includes('item-documents')) {
      return BUCKET_ITEM_DOCUMENTS;
    }
  }

  return BUCKET_VAULT_DOCUMENTS;
}

export interface DocumentThumbnailDiagnostic {
  documentId?: string;
  mimeType?: string;
  fileType?: string;
  bucket?: string;
  hasObjectPath: boolean;
  signedUrlSuccess?: boolean;
  signedUrlError?: string;
  imageLoadSuccess?: boolean;
  caseType: 'A' | 'B' | 'C' | 'D' | 'E' | 'OK';
  details?: string;
}

/**
 * Development-only safe diagnostic logger for document thumbnails.
 * Never logs authentication tokens, signed URL queries, or sensitive document content.
 */
export function logDocumentThumbnailDiagnostic(diag: DocumentThumbnailDiagnostic): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[DocumentThumbnailDiag][Case ${diag.caseType}]`, {
      docId: diag.documentId,
      mimeType: diag.mimeType,
      fileType: diag.fileType,
      bucket: diag.bucket,
      hasObjectPath: diag.hasObjectPath,
      signedUrlSuccess: diag.signedUrlSuccess,
      signedUrlError: diag.signedUrlError,
      imageLoadSuccess: diag.imageLoadSuccess,
      details: diag.details,
    });
  }
}

/**
 * Safely extracts the canonical storage path, remote URL, and local URI candidates
 * from a VaultDocument object or raw document string reference.
 *
 * Dedicated thumbnailPath takes absolute priority over the raw document payload.
 * PDFs without a genuine thumbnail return null candidates so that UI components
 * can cleanly render the PDF badge rather than passing unrenderable .pdf files to <Image>.
 */
export function extractDocumentImageCandidates(
  docOrPath?: any,
  fallbackLocalUri?: string | null
): DocumentImageCandidates {
  if (!docOrPath) {
    const cleanFallback = cleanStoragePath(fallbackLocalUri);
    const isFallbackStorage = cleanFallback ? isStoragePath(cleanFallback) : (fallbackLocalUri ? isStoragePath(fallbackLocalUri) : false);
    const isFallbackRemote = fallbackLocalUri ? isRemoteUrl(fallbackLocalUri) : false;
    const isFallbackLocal = fallbackLocalUri ? isLocalUri(fallbackLocalUri) : false;

    return {
      storagePath: isFallbackStorage ? (cleanFallback || fallbackLocalUri!.trim()) : null,
      remoteUrl: isFallbackRemote ? fallbackLocalUri!.trim() : null,
      localUri: isFallbackLocal ? fallbackLocalUri!.trim() : null,
    };
  }

  if (typeof docOrPath === 'string') {
    const cleanStr = docOrPath.trim().split(/[?#]/)[0].toLowerCase();
    if (cleanStr.endsWith('.pdf') || cleanStr.includes('application/pdf')) {
      return { storagePath: null, remoteUrl: null, localUri: null };
    }

    const clean = cleanStoragePath(docOrPath);
    if (clean && isStoragePath(clean)) {
      return {
        storagePath: clean,
        remoteUrl: fallbackLocalUri && isRemoteUrl(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
        localUri: fallbackLocalUri && isLocalUri(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
      };
    }
    const trimmed = docOrPath.trim();
    if (isStoragePath(trimmed)) {
      return {
        storagePath: trimmed,
        remoteUrl: fallbackLocalUri && isRemoteUrl(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
        localUri: fallbackLocalUri && isLocalUri(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
      };
    }
    if (isRemoteUrl(trimmed)) {
      return {
        storagePath: null,
        remoteUrl: trimmed,
        localUri: fallbackLocalUri && isLocalUri(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
      };
    }
    return {
      storagePath: null,
      remoteUrl: fallbackLocalUri && isRemoteUrl(fallbackLocalUri) ? fallbackLocalUri.trim() : null,
      localUri: trimmed,
    };
  }

  // docOrPath is a VaultDocument
  const doc = docOrPath;

  // PRIORITY 1: Explicit thumbnail path (if generated, e.g. for PDFs or high-res documents)
  const thumbnailCandidate = doc.thumbnailPath ? String(doc.thumbnailPath).trim() : null;
  if (thumbnailCandidate) {
    const cleanThumb = cleanStoragePath(thumbnailCandidate);
    if (cleanThumb && isStoragePath(cleanThumb)) {
      return {
        storagePath: cleanThumb,
        remoteUrl: null,
        localUri: null,
      };
    }
    if (isStoragePath(thumbnailCandidate)) {
      return {
        storagePath: thumbnailCandidate,
        remoteUrl: null,
        localUri: null,
      };
    }
    if (isRemoteUrl(thumbnailCandidate)) {
      return {
        storagePath: null,
        remoteUrl: thumbnailCandidate,
        localUri: null,
      };
    }
    if (isLocalUri(thumbnailCandidate)) {
      return {
        storagePath: null,
        remoteUrl: null,
        localUri: thumbnailCandidate,
      };
    }
  }

  // PRIORITY 2: If the document itself is a PDF without a thumbnail, it has NO image candidates
  if (isPdfDocument(doc)) {
    return { storagePath: null, remoteUrl: null, localUri: null };
  }

  // PRIORITY 3: The document file itself is an image
  let storagePath: string | null = null;
  const rawStorageCandidate =
    doc.storagePath ||
    doc.filePath ||
    doc.fileUrl ||
    doc.storagePathBack ||
    doc.filePathBack ||
    doc.fileUrlBack;

  const cleanedStorage = cleanStoragePath(rawStorageCandidate);
  if (cleanedStorage && isStoragePath(cleanedStorage)) {
    storagePath = cleanedStorage;
  } else if (rawStorageCandidate && isStoragePath(rawStorageCandidate)) {
    storagePath = rawStorageCandidate.trim();
  }

  let remoteUrl: string | null = null;
  if (doc.fileUrl && isRemoteUrl(doc.fileUrl)) {
    remoteUrl = doc.fileUrl.trim();
  } else if (doc.filePath && isRemoteUrl(doc.filePath)) {
    remoteUrl = doc.filePath.trim();
  } else if (doc.fileUrlBack && isRemoteUrl(doc.fileUrlBack)) {
    remoteUrl = doc.fileUrlBack.trim();
  } else if (fallbackLocalUri && isRemoteUrl(fallbackLocalUri)) {
    remoteUrl = fallbackLocalUri.trim();
  }

  let localUri: string | null = null;
  if (fallbackLocalUri && isLocalUri(fallbackLocalUri)) {
    localUri = fallbackLocalUri.trim();
  } else if (doc.filePath && isLocalUri(doc.filePath)) {
    localUri = doc.filePath.trim();
  } else if (doc.fileUrl && isLocalUri(doc.fileUrl)) {
    localUri = doc.fileUrl.trim();
  } else if (doc.filePathBack && isLocalUri(doc.filePathBack)) {
    localUri = doc.filePathBack.trim();
  } else if (doc.fileUrlBack && isLocalUri(doc.fileUrlBack)) {
    localUri = doc.fileUrlBack.trim();
  }

  // Sanity check: Ensure raw .pdf paths are never returned as image candidates
  if (storagePath && storagePath.trim().split(/[?#]/)[0].toLowerCase().endsWith('.pdf')) {
    storagePath = null;
  }
  if (remoteUrl && remoteUrl.trim().split(/[?#]/)[0].toLowerCase().endsWith('.pdf')) {
    remoteUrl = null;
  }
  if (localUri && localUri.trim().split(/[?#]/)[0].toLowerCase().endsWith('.pdf')) {
    localUri = null;
  }

  return { storagePath, remoteUrl, localUri };
}

export interface CanonicalizeOptions {
  receiptPath?: string | null;
  receiptUri?: string | null;
  imageStoragePath?: string | null;
  photoUri?: string | null;
}

/**
 * Normalizes, sanitizes, and canonicalizes an item's product photos list.
 *
 * Enforces strict product photo semantics:
 * 1. Product photos must NEVER include receipt, invoice, or document attachments.
 * 2. Deduplicates identical paths/URIs while strictly preserving user-specified order.
 * 3. Drops redundant local URIs when a durable cloud storage path is already present for that photo.
 * 4. Deduplicates temporary signed URLs pointing to the same storage path.
 * 5. Returns a clean, stable array of distinct photos.
 */
export function canonicalizeProductPhotos(
  itemOrPhotos?: any,
  options?: CanonicalizeOptions
): string[] {
  if (!itemOrPhotos) return [];

  let rawList: unknown[] = [];
  let receiptPath = options?.receiptPath;
  let receiptUri = options?.receiptUri;
  let imageStoragePath = options?.imageStoragePath;
  let photoUri = options?.photoUri;

  if (Array.isArray(itemOrPhotos)) {
    rawList = itemOrPhotos;
  } else if (typeof itemOrPhotos === 'object' && itemOrPhotos !== null) {
    const item = itemOrPhotos;
    receiptPath = receiptPath || item.receiptPath;
    receiptUri = receiptUri || item.receiptUri;
    imageStoragePath = imageStoragePath || item.imageStoragePath;
    photoUri = photoUri || item.photoUri;

    if (Array.isArray(item.productPhotos) && item.productPhotos.length > 0) {
      rawList = item.productPhotos;
    } else if (item.imageStoragePath && isStoragePath(item.imageStoragePath)) {
      rawList = [item.imageStoragePath];
    } else if (item.photoUri && isLocalUri(item.photoUri)) {
      rawList = [item.photoUri];
    } else if (item.imageUrl) {
      rawList = [item.imageUrl];
    }
  } else if (typeof itemOrPhotos === 'string') {
    rawList = [itemOrPhotos];
  }

  // Set of known receipt / document references to exclude from product photos
  const excludedRefs = new Set<string>();
  const addRef = (ref?: string | null) => {
    if (!ref || typeof ref !== 'string') return;
    const trimmed = ref.trim();
    if (!trimmed) return;
    excludedRefs.add(trimmed);
    excludedRefs.add(trimmed.toLowerCase());
    const clean = trimmed.split(/[?#]/)[0];
    excludedRefs.add(clean);
    excludedRefs.add(clean.toLowerCase());
    // Only exclude bare filename if it is uniquely identifiable as a receipt/invoice or PDF.
    // Generic camera/storage names like photo_0.jpg or image.jpg must NEVER be added as bare filenames
    // to avoid falsely rejecting valid product photos across separate directories!
    const filename = clean.split('/').pop();
    if (filename) {
      const lowerFile = filename.toLowerCase();
      if (
        lowerFile.includes('receipt') ||
        lowerFile.includes('invoice') ||
        lowerFile.includes('bill') ||
        lowerFile.endsWith('.pdf')
      ) {
        excludedRefs.add(filename);
        excludedRefs.add(lowerFile);
      }
    }
  };
  addRef(receiptPath);
  addRef(receiptUri);

  const isReceiptOrDoc = (p: string): { isReceipt: boolean; reason?: string } => {
    if (!p) return { isReceipt: true, reason: 'empty' };
    const trimmed = p.trim();
    const clean = trimmed.split(/[?#]/)[0];
    const filename = clean.split('/').pop() || '';
    const lower = clean.toLowerCase();
    const lowerFilename = filename.toLowerCase();

    // 1. Matches exact known receipt references or attached receipt filename
    if (
      excludedRefs.has(trimmed) ||
      excludedRefs.has(lower) ||
      excludedRefs.has(clean) ||
      (filename && excludedRefs.has(filename)) ||
      (lowerFilename && excludedRefs.has(lowerFilename))
    ) {
      return { isReceipt: true, reason: 'matches-receipt-reference' };
    }

    // 2. Document attachments (PDFs are strictly documents/receipts, never product photos)
    if (lower.endsWith('.pdf')) {
      return { isReceipt: true, reason: 'pdf-document' };
    }

    // 3. Document buckets / folders (item-documents, vault-documents, vault_documents)
    if (
      lower.includes('/item-documents/') ||
      lower.includes('/vault-documents/') ||
      lower.includes('vault_documents')
    ) {
      return { isReceipt: true, reason: 'document-directory' };
    }

    // 4. Remote receipt folders in cloud storage
    if (lower.includes('/receipts/')) {
      return { isReceipt: true, reason: 'remote-receipt-directory' };
    }

    // 5. Explicit receipt/invoice file naming patterns
    if (
      lowerFilename.startsWith('receipt_') ||
      lowerFilename.startsWith('receipt.') ||
      lowerFilename.includes('_receipt.') ||
      lowerFilename.startsWith('invoice_') ||
      lowerFilename.startsWith('invoice.') ||
      lowerFilename.includes('_invoice.') ||
      lowerFilename.startsWith('bill_') ||
      lowerFilename.startsWith('bill.')
    ) {
      return { isReceipt: true, reason: 'receipt-filename-pattern' };
    }

    return { isReceipt: false };
  };

  // 1. Filter out non-strings, empties, and receipt/document files
  const validStrings: string[] = [];
  const rejectionReasons: string[] = [];

  for (const item of rawList) {
    if (typeof item !== 'string') {
      rejectionReasons.push('non-string');
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      rejectionReasons.push('empty-string');
      continue;
    }
    const check = isReceiptOrDoc(trimmed);
    if (check.isReceipt) {
      rejectionReasons.push(check.reason || 'receipt-or-document');
      continue;
    }
    validStrings.push(trimmed);
  }

  if (validStrings.length === 0) {
    if (typeof __DEV__ !== 'undefined' ? __DEV__ : false) {
      console.log('[CanonicalizePhotos:Diagnostic] All candidates filtered out:', {
        rawCandidateCount: rawList.length,
        canonicalCount: 0,
        rejectionReasons,
      });
    }
    return [];
  }

  // 2. Identify if any durable cloud storage path is present
  const hasStoragePath = validStrings.some((p) => isStoragePath(p) || Boolean(cleanStoragePath(p)));
  const canonicalPhotoUri = photoUri ? photoUri.trim() : null;

  // 3. Normalize paths and deduplicate representations
  const canonicalEntries: string[] = [];
  const seenCanonical = new Set<string>();

  for (const entry of validStrings) {
    // If a signed URL, public URL, or bucket-prefixed path was passed, normalize to canonical storage path
    const normalized = cleanStoragePath(entry) || entry;

    // If an entry is a local file URI but a corresponding durable storage path is already present
    // (e.g. photoUri was uploaded to photo_0.jpg, and both are in the array), drop ONLY that redundant local URI.
    if (isLocalUri(normalized) && hasStoragePath) {
      if (canonicalPhotoUri && normalized === canonicalPhotoUri) {
        rejectionReasons.push('redundant-local-uri-for-uploaded-storage-path');
        continue;
      }
    }

    if (!seenCanonical.has(normalized)) {
      seenCanonical.add(normalized);
      canonicalEntries.push(normalized);
    } else {
      rejectionReasons.push('duplicate-entry');
    }
  }

  // If filtering local URIs accidentally emptied the list, fall back safely
  const result = canonicalEntries.length > 0 ? canonicalEntries : Array.from(new Set(validStrings));

  if (typeof __DEV__ !== 'undefined' ? __DEV__ : false) {
    console.log('[CanonicalizePhotos:Diagnostic]', {
      rawCandidateCount: rawList.length,
      canonicalCount: result.length,
      candidateTypes: result.map((c) =>
        isStoragePath(c) ? 'storagePath' : isLocalUri(c) ? 'localUri' : isRemoteUrl(c) ? 'remoteUrl' : 'other'
      ),
      rejectionsCount: rejectionReasons.length,
    });
  }

  return result;
}

