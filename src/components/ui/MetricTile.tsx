
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';
import { formatCurrency } from '../../utils/currency';

interface MetricTileProps {
  totalReplacementValue: number;
  itemsTrackedCount: number;
  activeWarrantiesCount: number;
  currencySymbol?: string;
}

export const MetricTile: React.FC<MetricTileProps> = ({
  totalReplacementValue,
  itemsTrackedCount,
  activeWarrantiesCount,
  currencySymbol = '₹',
}) => {
  return (
    <View className="bg-serene-surface-container-lowest rounded-serene-xl overflow-hidden border border-serene-subtle-border shadow-sm">
      <View className="h-1 bg-serene-secondary w-full" />

      <View className="p-serene-md">
        <View className="flex-row items-center justify-between mb-[10px]">
          <View className="flex-row items-center gap-[6px]">
            <MaterialIcons
              name="account-balance"
              size={18}
              color={SereneColors.onSurfaceVariant}
            />
            <Text className="text-[11px] font-semibold text-serene-on-surface-variant tracking-[0.8px]">
              VAULT CAPITAL & CUSTODY
            </Text>
          </View>
          <View className="flex-row items-center gap-[2px] bg-serene-tertiary-fixed px-2 py-[3px] rounded-full">
            <MaterialIcons name="arrow-upward" size={13} color={SereneColors.primary} />
            <Text className="text-[11px] font-semibold text-serene-primary">+4.2% indexed</Text>
          </View>
        </View>

        <View className="mb-4">
          <Text className="text-[12px] text-serene-on-surface-variant mb-[2px]">
            Estimated Replacement Value
          </Text>
          <Text className="text-[32px] font-bold text-serene-primary tracking-[-1px]">
            {formatCurrency(totalReplacementValue, currencySymbol)}
          </Text>
        </View>

        <View className="flex-row gap-[10px]">
          <View className="flex-1 flex-row items-center bg-serene-surface-container-low p-[10px] rounded-serene-lg gap-[10px]">
            <View className="w-9 h-9 rounded-serene-md bg-serene-surface-container-highest items-center justify-center">
              <MaterialIcons name="category" size={20} color={SereneColors.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-[15px] font-bold text-serene-on-surface">{itemsTrackedCount}</Text>
              <Text className="text-[11px] text-serene-on-surface-variant" numberOfLines={1}>
                Items Tracked
              </Text>
            </View>
          </View>

          <View className="flex-1 flex-row items-center bg-serene-surface-container-low p-[10px] rounded-serene-lg gap-[10px]">
            <View className="w-9 h-9 rounded-serene-md bg-serene-tertiary-fixed items-center justify-center">
              <MaterialIcons name="verified-user" size={20} color={SereneColors.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-[15px] font-bold text-serene-primary">
                {activeWarrantiesCount} Active
              </Text>
              <Text className="text-[11px] text-serene-on-surface-variant" numberOfLines={1}>
                Warranties Protected
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};
