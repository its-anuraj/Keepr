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
import type { RecentlyAddedEntry } from '../../types';

export interface RecentlyAddedThumbnailProps {
  entry: RecentlyAddedEntry;
}

export const RecentlyAddedThumbnail: React.FC<RecentlyAddedThumbnailProps> = ({ entry }) => {
  const [imageError, setImageError] = useState(false);
  const isItem = entry.entityType === 'PURCHASED_ITEM';

  const { resolvedUri } = useResolvedEntryImage(entry);

  useEffect(() => {
    setImageError(false);
  }, [resolvedUri, entry.id]);

  return (
    <View className="relative shrink-0">
      {!imageError && resolvedUri ? (
        <Image
          source={{ uri: resolvedUri }}
          className="w-12 h-12 rounded-serene-md bg-serene-surface-container-high"
          resizeMode="cover"
          onError={() => setImageError(true)}
        />
      ) : (
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
      )}
    </View>
  );
};
