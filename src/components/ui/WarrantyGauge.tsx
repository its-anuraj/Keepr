
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';
import { formatDate } from '../../utils/currency';
import { formatWarrantyBadge } from '../../utils/warranty';
import { Warranty } from '../../types';

interface WarrantyGaugeProps {
  warranty?: Warranty;
}

export const WarrantyGauge: React.FC<WarrantyGaugeProps> = ({ warranty }) => {
  if (!warranty) {
    return (
      <View className="my-3">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center gap-[6px] flex-1 min-w-0">
            <MaterialIcons
              name="verified"
              size={18}
              color={SereneColors.outline}
            />
            <Text className="text-[14px] font-semibold text-serene-on-surface">No Warranty Linked</Text>
          </View>
        </View>
        <Text className="text-[12px] text-serene-on-surface-variant italic">
          Add a protection plan or receipt to begin tracking warranty validity.
        </Text>
      </View>
    );
  }

  const badge = formatWarrantyBadge(warranty.endDate);
  const now = new Date().getTime();
  const start = new Date(warranty.startDate).getTime();
  const end = new Date(warranty.endDate).getTime();

  let percent = 0;
  if (!isNaN(start) && !isNaN(end) && end > start) {
    percent = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  }

  const isExpired = badge.status === 'expired';
  const isExpiring = badge.status === 'expiring_soon';

  return (
    <View className="my-3">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-[6px] flex-1 min-w-0">
          <MaterialIcons
            name="verified"
            size={18}
            color={
              isExpired
                ? SereneColors.error
                : isExpiring
                ? SereneColors.warning
                : SereneColors.primary
            }
          />
          <Text className="text-[14px] font-semibold text-serene-on-surface">
            {isExpired ? 'Warranty Expired' : 'Warranty Active'}
          </Text>
          {warranty.provider ? (
            <View className="bg-[rgba(162,224,254,0.4)] px-[7px] py-[2px] rounded-full max-w-[120px]">
              <Text className="text-[11px] font-semibold text-serene-secondary" numberOfLines={1}>
                {warranty.provider}
              </Text>
            </View>
          ) : null}
        </View>

        <Text
          className={`text-[13px] font-bold ${
            isExpired
              ? 'text-serene-error'
              : isExpiring
              ? 'text-serene-warning'
              : 'text-serene-primary'
          }`}
        >
          {badge.label}
        </Text>
      </View>

      <View className="w-full h-[9px] bg-serene-tertiary-fixed rounded-full overflow-hidden p-[1.5px]">
        <View
          className={`h-full rounded-full ${
            isExpired
              ? 'bg-serene-error'
              : isExpiring
              ? 'bg-serene-warning'
              : 'bg-serene-primary'
          }`}
          style={{ width: `${isExpired ? 100 : Math.max(percent, 5)}%` }}
        />
      </View>

      <View className="flex-row items-center justify-between mt-[5px]">
        <Text className="text-[11px] text-serene-on-surface-variant">
          Start: {formatDate(warranty.startDate, 'short')}
        </Text>
        <Text className="text-[11px] text-serene-on-surface-variant">
          Expires: {formatDate(warranty.endDate, 'medium')}
        </Text>
      </View>
    </View>
  );
};
