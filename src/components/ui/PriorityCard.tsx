
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';

interface PriorityCardProps {
  type: 'warranty' | 'return' | 'maintenance';
  urgentLabel: string;
  title: string;
  subtitle: string;
  footerLabel?: string;
  actionText: string;
  actionIcon?: keyof typeof MaterialIcons.glyphMap;
  onActionPress?: () => void;
  onCardPress?: () => void;
}

export const PriorityCard: React.FC<PriorityCardProps> = ({
  type,
  urgentLabel,
  title,
  subtitle,
  footerLabel,
  actionText,
  actionIcon = 'chevron-right',
  onActionPress,
  onCardPress,
}) => {
  const isWarranty = type === 'warranty';
  const isReturn = type === 'return';
  const isWarrantyOrReturn = isWarranty || isReturn;

  const pillBgClass = isReturn
    ? 'bg-amber-100'
    : isWarranty
    ? 'bg-serene-error-container'
    : 'bg-serene-secondary-container';

  const pillTextClass = isReturn
    ? 'text-amber-800'
    : isWarranty
    ? 'text-serene-error'
    : 'text-serene-on-secondary-container';

  if (isWarrantyOrReturn) {
    return (
      <TouchableOpacity
        className="w-[260px] bg-serene-surface-container-lowest rounded-serene-xl border border-serene-subtle-border mr-3 p-3.5 justify-between shadow-sm"
        activeOpacity={0.9}
        onPress={onCardPress}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${urgentLabel}`}
      >
        <View className="gap-2.5">
          <View className="flex-row items-center">
            <View className={`px-2 py-[3px] rounded-full ${pillBgClass}`}>
              <Text className={`text-[11px] font-semibold ${pillTextClass}`}>
                {urgentLabel}
              </Text>
            </View>
          </View>

          <View className="gap-[2px]">
            <Text className="text-[15px] font-semibold text-serene-on-surface" numberOfLines={1}>
              {title}
            </Text>
            <Text className="text-[12px] text-serene-on-surface-variant" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          className={`w-full flex-row items-center justify-center gap-1.5 py-2 rounded-serene-lg mt-3 ${
            isWarranty ? 'bg-serene-primary' : 'bg-serene-secondary'
          }`}
          onPress={onActionPress || onCardPress}
          activeOpacity={0.85}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${actionText} ${title}`}
        >
          <Text className="text-[12px] font-semibold text-white">{actionText}</Text>
          <MaterialIcons name={actionIcon} size={15} color="#FFFFFF" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      className="w-[275px] bg-serene-surface-container-lowest rounded-serene-xl overflow-hidden border border-serene-subtle-border mr-3 justify-between shadow-sm"
      activeOpacity={0.9}
      onPress={onCardPress}
    >
      <View className="p-serene-md">
        <View className="flex-row items-center justify-between mb-[10px]">
          <View className={`px-2 py-[3px] rounded-full ${pillBgClass}`}>
            <Text className={`text-[11px] font-semibold ${pillTextClass}`}>
              {urgentLabel}
            </Text>
          </View>

          <MaterialIcons name="more-horiz" size={18} color={SereneColors.outline} />
        </View>

        <View className="gap-[2px]">
          <Text className="text-[15px] font-semibold text-serene-on-surface" numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-[12px] text-serene-on-surface-variant" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between bg-serene-surface-container-low px-serene-md py-2 border-t border-[rgba(51,104,160,0.05)]">
        <Text className="text-[11px] font-medium text-serene-on-surface-variant flex-1 min-w-0 mr-2" numberOfLines={1}>{footerLabel}</Text>
        <TouchableOpacity
          className="flex-row items-center gap-1 px-[10px] py-[5px] rounded-serene-md bg-serene-secondary shrink-0"
          onPress={onActionPress || onCardPress}
          activeOpacity={0.85}
        >
          <Text className="text-[11px] font-semibold text-white">{actionText}</Text>
          <MaterialIcons name={actionIcon} size={14} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};
