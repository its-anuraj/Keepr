
import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { VaultDocument } from '../../types';
import { SereneColors } from '../../constants/theme';
import { formatDate } from '../../utils/currency';
import * as Sharing from 'expo-sharing';

interface DocumentTileProps {
  document: VaultDocument;
  onDelete?: () => void;
}

export const DocumentTile: React.FC<DocumentTileProps> = ({
  document,
  onDelete,
}) => {
  const handleOpenOrShare = async () => {
    if (document.fileUrl) {
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable && document.fileUrl.startsWith('file://')) {
        await Sharing.shareAsync(document.fileUrl);
      } else {
        Alert.alert(
          'Private Vault Document',
          `Document: ${document.name || document.title || 'Document'}\nSize: ${Math.round(
            document.fileSizeBytes / 1024
          )} KB\nArchived in your private vault.`
        );
      }
    } else {
      Alert.alert(
        'Private Vault Document',
        `Document: ${document.name || document.title || 'Document'}\nStatus: Stored in your private vault.`
      );
    }
  };

  const docName = document.name || document.title || 'Document';
  const isPdf = docName.toLowerCase().endsWith('.pdf') || (document.mimeType?.includes('pdf') ?? false);
  const sizeKb = Math.round(document.fileSizeBytes / 1024);

  return (
    <View className="flex-row items-center justify-between bg-[rgba(246,243,235,0.65)] p-3 rounded-serene-lg my-1">
      <TouchableOpacity
        className="flex-row items-center gap-3 flex-1 min-w-0"
        activeOpacity={0.8}
        onPress={handleOpenOrShare}
      >
        <View className="w-10 h-10 rounded-serene-md bg-serene-surface-container items-center justify-center">
          <MaterialIcons
            name={isPdf ? 'picture-as-pdf' : 'description'}
            size={22}
            color={SereneColors.primary}
          />
        </View>

        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-1">
            <Text className="text-[14px] font-semibold text-serene-on-surface shrink" numberOfLines={1}>
              {document.name}
            </Text>
            <MaterialIcons
              name="verified"
              size={14}
              color={SereneColors.tertiary}
            />
          </View>
          <Text className="text-[11px] text-serene-on-surface-variant mt-[2px]" numberOfLines={1}>
            {sizeKb > 0 ? `${sizeKb} KB · ` : ''}
            Uploaded {formatDate(document.createdAt, 'short')}
          </Text>
        </View>
      </TouchableOpacity>

      <View className="flex-row items-center gap-1 ml-2">
        <TouchableOpacity
          className="w-8 h-8 rounded-full bg-serene-surface-container-lowest items-center justify-center border border-serene-subtle-border"
          onPress={handleOpenOrShare}
          accessibilityLabel="Open document"
        >
          <MaterialIcons
            name="download"
            size={18}
            color={SereneColors.primary}
          />
        </TouchableOpacity>

        {onDelete ? (
          <TouchableOpacity
            className="w-8 h-8 rounded-full bg-serene-surface-container-lowest items-center justify-center border border-serene-subtle-border"
            onPress={onDelete}
            accessibilityLabel="Delete document"
          >
            <MaterialIcons
              name="delete-outline"
              size={18}
              color={SereneColors.error}
            />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};
