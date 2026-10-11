// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: RecentlyAddedThumbnail Component
// Consistent, durable image-resolution thumbnail for Vault -> Recently Added cards.
// Uses canonical useResolvedEntryImage pipeline to resolve private Supabase Storage
// paths, remote URLs, and local URIs across APK and Expo Go sessions.
// ==============================================================================

import React, { useState, useEffect } from 'react';
import { View, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useResolvedEntryImage } from '../../hooks/useResolvedImage';
import { isPdfDocument } from '../../utils/storageUtils';
import type { RecentlyAddedEntry } from '../../types';

export interface RecentlyAddedThumbnailProps {
  entry: RecentlyAddedEntry;
}

export const RecentlyAddedThumbnail: React.FC<RecentlyAddedThumbnailProps> = ({ entry }) => {
  const [imageError, setImageError] = useState(false);
  const isItem = entry.entityType === 'PURCHASED_ITEM';

  // Always invoke resolution with entry. extractDocumentImageCandidates handles
  // prioritizing thumbnailPath and returning null for PDFs without thumbnails.
  const { resolvedUri, retry } = useResolvedEntryImage(entry);

  useEffect(() => {
    setImageError(false);
  }, [resolvedUri, entry.id]);

  const handleImageError = () => {
    if (retry) {
      retry();
    } else {
      setImageError(true);
    }
  };

  // 1. Resolvable image (item product photo, scanned document image, or PDF with thumbnail preview)
  if (!imageError && resolvedUri) {
    return (
      <View className="relative shrink-0">
        <Image
          source={{ uri: resolvedUri }}
          className="w-12 h-12 rounded-serene-md bg-serene-surface-container-high"
          resizeMode="cover"
          onError={handleImageError}
        />
      </View>
    );
  }

  // 2. Genuine PDF document without an image preview
  const isPdf = !isItem && isPdfDocument(entry.document);
  if (isPdf) {
    return (
      <View className="relative shrink-0">
        <View className="w-12 h-12 rounded-serene-md items-center justify-center bg-red-50">
          <MaterialIcons name="picture-as-pdf" size={22} color="#DC2626" />
        </View>
      </View>
    );
  }

  // 3. Fallback category icon for items and image documents without available images
  return (
    <View className="relative shrink-0">
      <View
        className={`w-12 h-12 rounded-serene-md items-center justify-center ${
          isItem ? 'bg-indigo-50' : 'bg-emerald-50'
        }`}
      >
        <MaterialIcons
          name={isItem ? 'inventory-2' : 'description'}
          size={22}
          color={isItem ? '#4F46E5' : '#059669'}
        />
      </View>
    </View>
  );
};
