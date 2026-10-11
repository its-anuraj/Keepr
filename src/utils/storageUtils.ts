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
    const isFallbackStorage = fallbackLocalUri ? isStoragePath(fallbackLocalUri) : false;
    const isFallbackLocal = fallbackLocalUri ? isLocalUri(fallbackLocalUri) : false;

    return {
      storagePath: isFallbackStorage ? fallbackLocalUri!.trim() : null,
      remoteUrl: isFallbackRemote ? fallbackLocalUri!.trim() : null,
      localUri: isFallbackLocal ? fallbackLocalUri!.trim() : (!isFallbackRemote && !isFallbackStorage && fallbackLocalUri ? fallbackLocalUri.trim() : null),
    };
  }

  if (typeof itemOrPath === 'string') {
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
  if (item.imageStoragePath && isStoragePath(item.imageStoragePath)) {
    storagePath = item.imageStoragePath.trim();
  } else if (item.imageUrl && isStoragePath(item.imageUrl)) {
    storagePath = item.imageUrl.trim();
  } else if (Array.isArray(item.productPhotos)) {
    const found = item.productPhotos.find((p: any) => typeof p === 'string' && isStoragePath(p));
    if (found) storagePath = found.trim();
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
 * Safely extracts the canonical storage path, remote URL, and local URI candidates
 * from a VaultDocument object or raw document string reference.
 */
export function extractDocumentImageCandidates(
  docOrPath?: any,
  fallbackLocalUri?: string | null
): DocumentImageCandidates {
  if (!docOrPath) {
    const isFallbackRemote = fallbackLocalUri ? isRemoteUrl(fallbackLocalUri) : false;
    const isFallbackStorage = fallbackLocalUri ? isStoragePath(fallbackLocalUri) : false;
    const isFallbackLocal = fallbackLocalUri ? isLocalUri(fallbackLocalUri) : false;

    return {
      storagePath: isFallbackStorage ? fallbackLocalUri!.trim() : null,
      remoteUrl: isFallbackRemote ? fallbackLocalUri!.trim() : null,
      localUri: isFallbackLocal ? fallbackLocalUri!.trim() : null,
    };
  }

  if (typeof docOrPath === 'string') {
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

  let storagePath: string | null = null;
  if (doc.storagePath && isStoragePath(doc.storagePath)) {
    storagePath = doc.storagePath.trim();
  } else if (doc.filePath && isStoragePath(doc.filePath)) {
    storagePath = doc.filePath.trim();
  } else if (doc.fileUrl && isStoragePath(doc.fileUrl)) {
    storagePath = doc.fileUrl.trim();
  }

  let remoteUrl: string | null = null;
  if (doc.fileUrl && isRemoteUrl(doc.fileUrl)) {
    remoteUrl = doc.fileUrl.trim();
  } else if (doc.filePath && isRemoteUrl(doc.filePath)) {
    remoteUrl = doc.filePath.trim();
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
  }

  return { storagePath, remoteUrl, localUri };
}
