
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';

interface EmptyStateProps {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  actionText?: string;
  onActionPress?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'inventory-2',
  title = 'Your collection starts here.',
  description = 'Add the things you own and keep their important details in one place.',
  actionText,
  onActionPress,
}) => {
  return (
    <View className="items-center justify-center py-9 px-6 bg-serene-surface-container-lowest rounded-serene-xl border border-serene-subtle-border my-3">
      <View className="w-[60px] h-[60px] rounded-full bg-[rgba(17,80,134,0.08)] items-center justify-center mb-4">
        <MaterialIcons name={icon} size={32} color={SereneColors.primary} />
      </View>

      <Text className="text-[17px] font-bold text-serene-on-surface text-center mb-[6px]">
        {title}
      </Text>
      <Text className="text-[13px] text-serene-on-surface-variant text-center leading-[19px] max-w-[280px] mb-[18px]">
        {description}
      </Text>

      {actionText && onActionPress ? (
        <TouchableOpacity
          className="flex-row items-center gap-[6px] bg-serene-primary px-[18px] py-[10px] rounded-serene-lg shadow-sm"
          activeOpacity={0.85}
          onPress={onActionPress}
        >
          <MaterialIcons name="add" size={18} color="#FFFFFF" />
          <Text className="text-[13px] font-semibold text-white">{actionText}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};
