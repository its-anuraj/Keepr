
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface ConfidenceBadgeProps {
  needsVerification?: boolean;
  aiSuggested?: boolean;
  score?: number;
  labelOverride?: string;
  compact?: boolean;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({
  needsVerification,
  score,
  labelOverride,
  compact = false,
}) => {
  if (needsVerification) {
    return (
      <View
        className={`flex-row items-center gap-1 bg-[#FEF3C7] border-[0.5px] border-[#FDE68A] ${
          compact ? 'px-[5px] py-[2px] rounded' : 'px-[7px] py-[3px] rounded-[6px]'
        }`}
      >
        <MaterialIcons name="help-outline" size={compact ? 11 : 13} color="#B45309" />
        <Text
          className={`text-[#B45309] font-semibold tracking-[0.2px] ${
            compact ? 'text-[10px]' : 'text-[11px]'
          }`}
        >
          {labelOverride || 'Please verify'}
        </Text>
      </View>
    );
  }

  return null;
};
