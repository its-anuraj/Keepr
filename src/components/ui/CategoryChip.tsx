
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';

interface CategoryChipProps {
  label: string;
  count?: number;
  isSelected: boolean;
  onPress: () => void;
}

export const CategoryChip: React.FC<CategoryChipProps> = ({
  label,
  count,
  isSelected,
  onPress,
}) => {
  return (
    <TouchableOpacity
      className={`px-[14px] py-[7px] rounded-full mr-2 border ${
        isSelected
          ? 'bg-serene-primary-container border-serene-primary-container'
          : 'bg-serene-surface-container-lowest border-serene-subtle-border'
      }`}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <Text
        className={`text-[12px] font-semibold ${
          isSelected ? 'text-white' : 'text-serene-on-surface-variant'
        }`}
      >
        {label} {count !== undefined ? `(${count})` : ''}
      </Text>
    </TouchableOpacity>
  );
};
