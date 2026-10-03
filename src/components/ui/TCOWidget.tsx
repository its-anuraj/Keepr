
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';
import { formatCurrency } from '../../utils/currency';
import { Item, Expense, MaintenanceRecord } from '../../types';
import { calculateItemTCO } from '../../utils/ownershipCost';

interface TCOWidgetProps {
  item: Item;
  expenses: Expense[];
  maintenanceRecords: MaintenanceRecord[];
  currencySymbol?: string;
}

export const TCOWidget: React.FC<TCOWidgetProps> = ({
  item,
  expenses,
  maintenanceRecords,
  currencySymbol = '₹',
}) => {
  const {
    totalCost,
    hardwareCost,
    upkeepCost,
    hardwarePercent,
    upkeepPercent,
  } = calculateItemTCO(item, expenses, maintenanceRecords);

  return (
    <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border my-[10px] shadow-sm">
      <View className="flex-row items-baseline justify-between mb-3">
        <View className="flex-1 pr-2">
          <View className="flex-row items-center gap-[6px]">
            <MaterialIcons name="insights" size={18} color={SereneColors.primary} />
            <Text className="text-[15px] font-semibold text-serene-on-surface">Total Cost of Ownership</Text>
          </View>
          <Text className="text-[11px] text-serene-on-surface-variant mt-[2px]">All-time life-cycle capital deployed</Text>
        </View>

        <Text className="text-[20px] font-bold text-serene-primary">
          {formatCurrency(totalCost, currencySymbol)}
        </Text>
      </View>

      <View className="w-full h-[10px] rounded-full bg-serene-surface-container-high flex-row overflow-hidden mb-[10px]">
        <View
          className="h-full bg-serene-primary"
          style={{ width: `${Math.max(hardwarePercent, 1)}%` }}
        />
        {upkeepPercent > 0 ? (
          <View
            className="h-full bg-serene-secondary"
            style={{ width: `${Math.max(upkeepPercent, 1)}%` }}
          />
        ) : null}
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-[6px]">
          <View className="w-2 h-2 rounded-full bg-serene-primary" />
          <Text className="text-[12px] text-serene-on-surface-variant">
            Hardware:{' '}
            <Text className="font-bold text-serene-on-surface">
              {formatCurrency(hardwareCost, currencySymbol)}
            </Text>
          </Text>
        </View>

        <View className="flex-row items-center gap-[6px]">
          <View className="w-2 h-2 rounded-full bg-serene-secondary" />
          <Text className="text-[12px] text-serene-on-surface-variant">
            Upkeep:{' '}
            <Text className="font-bold text-serene-on-surface">
              {formatCurrency(upkeepCost, currencySymbol)}
            </Text>
          </Text>
        </View>
      </View>
    </View>
  );
};
