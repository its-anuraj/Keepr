// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: useResolvedImage Hook
// Resolves private Supabase Storage paths, remote URLs, and local URIs
// into usable display URIs with memory caching and error handling.
// ==============================================================================

import { useState, useEffect } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import {
  isStoragePath,
  isRemoteUrl,
  getItemImageSignedUrl,
  getCachedSignedUrl,
} from '../services/storageService';
import { getCanonicalReceiptUri } from '../services/receiptFileService';

export interface ResolvedImageResult {
  resolvedUri: string | null;
  isLoading: boolean;
  isUnavailable: boolean;
  isLocal: boolean;
}

/**
 * Resolves a single item image URI or storage path for display in React Native.
 *
 * Evaluation order:
 * 1. If localFallbackUri is valid and file exists on this device, returns it immediately (instant offline preview).
 * 2. If storagePathOrUri is a remote HTTP URL, returns it directly.
 * 3. If storagePathOrUri is a Supabase Storage path, returns cached or freshly generated signed URL from private bucket.
 * 4. If storagePathOrUri is a local URI, checks if file exists on this device.
 * 5. If none exist (e.g. old Expo Go item on new device), marks isUnavailable: true.
 */
export function useResolvedItemImage(
  storagePathOrUri?: string | null,
  localFallbackUri?: string | null
): ResolvedImageResult {
  // Synchronous cache check to prevent render flicker if already cached
  const initialUri = (() => {
    if (localFallbackUri && (localFallbackUri.startsWith('http://') || localFallbackUri.startsWith('https://'))) {
      return localFallbackUri;
    }
    if (storagePathOrUri) {
      if (storagePathOrUri.startsWith('http://') || storagePathOrUri.startsWith('https://')) {
        return storagePathOrUri;
      }
      if (isStoragePath(storagePathOrUri)) {
        return getCachedSignedUrl(storagePathOrUri);
      }
    }
    return null;
  })();

  const [resolvedUri, setResolvedUri] = useState<string | null>(initialUri);
  const [isLoading, setIsLoading] = useState<boolean>(!initialUri && Boolean(storagePathOrUri || localFallbackUri));
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [isLocal, setIsLocal] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    async function resolve() {
      // 1. Try local fallback URI first if provided (fastest on device that captured it)
      if (localFallbackUri) {
        if (isRemoteUrl(localFallbackUri)) {
          if (isMounted) {
            setResolvedUri(localFallbackUri);
            setIsLoading(false);
            setIsUnavailable(false);
            setIsLocal(false);
          }
          return;
        }

        const canonicalLocal = getCanonicalReceiptUri(localFallbackUri) || localFallbackUri;
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

      // 2. No primary target
      if (!storagePathOrUri) {
        if (isMounted) {
          setResolvedUri(null);
          setIsLoading(false);
          setIsUnavailable(false);
          setIsLocal(false);
        }
        return;
      }

      // 3. Remote URL
      if (isRemoteUrl(storagePathOrUri) || storagePathOrUri.startsWith('data:')) {
        if (isMounted) {
          setResolvedUri(storagePathOrUri);
          setIsLoading(false);
          setIsUnavailable(false);
          setIsLocal(false);
        }
        return;
      }

      // 4. Supabase Storage Path (e.g. userId/items/itemId/photo_0.jpg)
      if (isStoragePath(storagePathOrUri)) {
        const cached = getCachedSignedUrl(storagePathOrUri);
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
        const signed = await getItemImageSignedUrl(storagePathOrUri);
        if (isMounted) {
          if (signed) {
            setResolvedUri(signed);
            setIsUnavailable(false);
          } else {
            setResolvedUri(null);
            setIsUnavailable(true);
          }
          setIsLoading(false);
          setIsLocal(false);
        }
        return;
      }

      // 5. Local URI from storagePathOrUri itself
      const canonical = getCanonicalReceiptUri(storagePathOrUri) || storagePathOrUri;
      try {
        const info = await FileSystem.getInfoAsync(canonical).catch(() => null);
        if (isMounted) {
          if (info?.exists && !info.isDirectory) {
            setResolvedUri(canonical);
            setIsUnavailable(false);
            setIsLocal(true);
          } else {
            // Local file does not exist on this device (e.g. Case C: Expo Go legacy path)
            setResolvedUri(null);
            setIsUnavailable(true);
            setIsLocal(false);
          }
          setIsLoading(false);
        }
      } catch {
        if (isMounted) {
          setResolvedUri(null);
          setIsUnavailable(true);
          setIsLoading(false);
          setIsLocal(false);
        }
      }
    }

    resolve();

    return () => {
      isMounted = false;
    };
  }, [storagePathOrUri, localFallbackUri]);

  return { resolvedUri, isLoading, isUnavailable, isLocal };
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
