// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: useResolvedImage Hook
// Canonical image-resolution pipeline for items, documents, and vault cards.
// Resolves private Supabase Storage paths, remote URLs, and local URIs
// into usable display URIs with memory caching, TTL refresh, and graceful fallback.
// ==============================================================================

import { useState, useEffect, useMemo } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import {
  isStoragePath,
  isRemoteUrl,
  isLocalUri,
  getItemImageSignedUrl,
  getVaultDocumentSignedUrl,
  getCachedSignedUrl,
} from '../services/storageService';
import {
  extractItemImageCandidates,
  extractDocumentImageCandidates,
} from '../utils/storageUtils';
import { getCanonicalReceiptUri } from '../services/receiptFileService';
import type { Item, VaultDocument, RecentlyAddedEntry } from '../types';

export interface ResolvedImageResult {
  resolvedUri: string | null;
  isLoading: boolean;
  isUnavailable: boolean;
  isLocal: boolean;
}

/**
 * Resolves a single item image (or Item object) for display across all screens.
 *
 * Evaluation order:
 * 1. Checks memory cache for signed URL (prevents flicker).
 * 2. If local URI exists on this physical device, returns it immediately (instant offline preview).
 * 3. If durable Supabase Storage path exists, resolves signed URL from private 'item-images' bucket.
 * 4. If remote HTTP URL exists, returns it directly.
 * 5. If file does not exist locally (e.g. cross-device Expo Go / APK sandbox), seamlessly falls back
 *    to cloud storage signed URL.
 * 6. If no valid image exists or fetch fails, marks isUnavailable: true.
 */
export function useResolvedItemImage(
  itemOrStoragePath?: Partial<Item> | string | null,
  localFallbackUri?: string | null
): ResolvedImageResult {
  const candidates = useMemo(() => {
    return extractItemImageCandidates(itemOrStoragePath, localFallbackUri);
  }, [
    typeof itemOrStoragePath === 'object' && itemOrStoragePath !== null
      ? `${itemOrStoragePath.id || ''}:${itemOrStoragePath.imageStoragePath || ''}:${itemOrStoragePath.imageUrl || ''}:${itemOrStoragePath.photoUri || ''}:${(itemOrStoragePath.productPhotos || []).join(',')}`
      : itemOrStoragePath,
    localFallbackUri,
  ]);

  const { storagePath, remoteUrl, localUri } = candidates;

  // Synchronous cache check to prevent render flicker
  const initialUri = useMemo(() => {
    if (storagePath) {
      const cached = getCachedSignedUrl(storagePath);
      if (cached) return cached;
    }
    if (remoteUrl) return remoteUrl;
    return null;
  }, [storagePath, remoteUrl]);

  const [resolvedUri, setResolvedUri] = useState<string | null>(initialUri);
  const [isLoading, setIsLoading] = useState<boolean>(
    !initialUri && Boolean(storagePath || remoteUrl || localUri)
  );
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [isLocal, setIsLocal] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    async function resolve() {
      // 1. Try local URI first if provided (fastest on device that captured it)
      if (localUri) {
        const canonicalLocal = getCanonicalReceiptUri(localUri) || localUri;
        try {
          const info = await FileSystem.getInfoAsync(canonicalLocal).catch(() => null);
          if (info?.exists && !info.isDirectory) {
            if (isMounted) {
              setResolvedUri(canonicalLocal);
              setIsLoading(false);
              setIsUnavailable(false);
              setIsLocal(true);
            }
            return;
          }
        } catch {}
        // If local file does not exist on this device (e.g. cross-device session),
        // proceed directly to durable cloud storage without failing!
      }

      // 2. Try durable Supabase Storage path from private bucket
      if (storagePath && isStoragePath(storagePath)) {
        const cached = getCachedSignedUrl(storagePath);
        if (cached) {
          if (isMounted) {
            setResolvedUri(cached);
            setIsLoading(false);
            setIsUnavailable(false);
            setIsLocal(false);
          }
          return;
        }

        if (isMounted) setIsLoading(true);
        const signed = await getItemImageSignedUrl(storagePath);
        if (isMounted) {
          if (signed) {
            setResolvedUri(signed);
            setIsUnavailable(false);
            setIsLoading(false);
            setIsLocal(false);
            return;
          }
        }
      }

      // 3. Try remote HTTP/HTTPS URL
      if (remoteUrl && (isRemoteUrl(remoteUrl) || remoteUrl.startsWith('data:'))) {
        if (isMounted) {
          setResolvedUri(remoteUrl);
          setIsLoading(false);
          setIsUnavailable(false);
          setIsLocal(false);
        }
        return;
      }

      // 4. No valid cloud or local image found
      if (isMounted) {
        setResolvedUri(null);
        setIsLoading(false);
        setIsUnavailable(Boolean(storagePath || remoteUrl || localUri));
        setIsLocal(false);
      }
    }

    resolve();

    return () => {
      isMounted = false;
    };
  }, [storagePath, remoteUrl, localUri]);

  return { resolvedUri, isLoading, isUnavailable, isLocal };
}

/**
 * Resolves a VaultDocument thumbnail or display image.
 */
export function useResolvedDocumentImage(
  docOrStoragePath?: Partial<VaultDocument> | string | null,
  localFallbackUri?: string | null
): ResolvedImageResult {
  const candidates = useMemo(() => {
    return extractDocumentImageCandidates(docOrStoragePath, localFallbackUri);
  }, [
    typeof docOrStoragePath === 'object' && docOrStoragePath !== null
      ? `${docOrStoragePath.id || ''}:${docOrStoragePath.storagePath || ''}:${docOrStoragePath.filePath || ''}:${docOrStoragePath.fileUrl || ''}`
      : docOrStoragePath,
    localFallbackUri,
  ]);

  const { storagePath, remoteUrl, localUri } = candidates;

  const initialUri = useMemo(() => {
    if (storagePath) {
      const cached = getCachedSignedUrl(storagePath);
      if (cached) return cached;
    }
    if (remoteUrl) return remoteUrl;
    return null;
  }, [storagePath, remoteUrl]);

  const [resolvedUri, setResolvedUri] = useState<string | null>(initialUri);
  const [isLoading, setIsLoading] = useState<boolean>(
    !initialUri && Boolean(storagePath || remoteUrl || localUri)
  );
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [isLocal, setIsLocal] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    async function resolve() {
      // 1. Check local file on this device
      if (localUri) {
        const canonicalLocal = getCanonicalReceiptUri(localUri) || localUri;
        try {
          const info = await FileSystem.getInfoAsync(canonicalLocal).catch(() => null);
          if (info?.exists && !info.isDirectory) {
            if (isMounted) {
              setResolvedUri(canonicalLocal);
              setIsLoading(false);
              setIsUnavailable(false);
              setIsLocal(true);
            }
            return;
          }
        } catch {}
      }

      // 2. Supabase Storage signed URL from private 'vault-documents'
      if (storagePath && isStoragePath(storagePath)) {
        const cached = getCachedSignedUrl(storagePath);
        if (cached) {
          if (isMounted) {
            setResolvedUri(cached);
            setIsLoading(false);
            setIsUnavailable(false);
            setIsLocal(false);
          }
          return;
        }

        if (isMounted) setIsLoading(true);
        const signed = await getVaultDocumentSignedUrl(storagePath);
        if (isMounted) {
          if (signed) {
            setResolvedUri(signed);
            setIsUnavailable(false);
            setIsLoading(false);
            setIsLocal(false);
            return;
          }
        }
      }

      // 3. Remote URL
      if (remoteUrl && (isRemoteUrl(remoteUrl) || remoteUrl.startsWith('data:'))) {
        if (isMounted) {
          setResolvedUri(remoteUrl);
          setIsLoading(false);
          setIsUnavailable(false);
          setIsLocal(false);
        }
        return;
      }

      // 4. Unavailable
      if (isMounted) {
        setResolvedUri(null);
        setIsLoading(false);
        setIsUnavailable(Boolean(storagePath || remoteUrl || localUri));
        setIsLocal(false);
      }
    }

    resolve();

    return () => {
      isMounted = false;
    };
  }, [storagePath, remoteUrl, localUri]);

  return { resolvedUri, isLoading, isUnavailable, isLocal };
}

/**
 * Resolves an entry from Recently Added list, automatically delegating to item or document resolver.
 */
export function useResolvedEntryImage(
  entry?: RecentlyAddedEntry | null
): ResolvedImageResult {
  const isItem = entry?.entityType === 'PURCHASED_ITEM';
  const itemCandidate = isItem ? entry?.item || entry?.thumbnail : null;
  const docCandidate = !isItem ? entry?.document || entry?.thumbnail : null;

  const itemResult = useResolvedItemImage(itemCandidate);
  const docResult = useResolvedDocumentImage(docCandidate);

  return isItem ? itemResult : docResult;
}

export interface ResolvedPhotoEntry {
  original: string;
  resolvedUri: string | null;
  isUnavailable: boolean;
}

/**
 * Resolves an array of product photo paths/URIs for detail view galleries.
 */
export function useResolvedItemPhotos(photos?: string[] | null): {
  resolvedPhotos: ResolvedPhotoEntry[];
  isLoading: boolean;
} {
  const [resolvedPhotos, setResolvedPhotos] = useState<ResolvedPhotoEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(photos && photos.length > 0));

  useEffect(() => {
    let isMounted = true;

    async function resolveAll() {
      if (!photos || photos.length === 0) {
        if (isMounted) {
          setResolvedPhotos([]);
          setIsLoading(false);
        }
        return;
      }

      if (isMounted) setIsLoading(true);

      const results: ResolvedPhotoEntry[] = [];
      for (const p of photos) {
        if (!p) continue;

        if (isRemoteUrl(p) || p.startsWith('data:')) {
          results.push({ original: p, resolvedUri: p, isUnavailable: false });
        } else if (isStoragePath(p)) {
          const signed = await getItemImageSignedUrl(p);
          results.push({
            original: p,
            resolvedUri: signed,
            isUnavailable: !signed,
          });
        } else {
          const canonical = getCanonicalReceiptUri(p) || p;
          try {
            const info = await FileSystem.getInfoAsync(canonical).catch(() => null);
            if (info?.exists && !info.isDirectory) {
              results.push({ original: p, resolvedUri: canonical, isUnavailable: false });
            } else {
              results.push({ original: p, resolvedUri: null, isUnavailable: true });
            }
          } catch {
            results.push({ original: p, resolvedUri: null, isUnavailable: true });
          }
        }
      }

      if (isMounted) {
        setResolvedPhotos(results);
        setIsLoading(false);
      }
    }

    resolveAll();

    return () => {
      isMounted = false;
    };
  }, [JSON.stringify(photos || [])]);

  return { resolvedPhotos, isLoading };
}
