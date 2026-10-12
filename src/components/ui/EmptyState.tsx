
import React from 'react';
import { View, Text, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';

interface EmptyStateProps {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  actionText?: string;
  actionIcon?: keyof typeof MaterialIcons.glyphMap | null;
  actionVariant?: 'primary' | 'secondary';
  onActionPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'inventory-2',
  title = 'Your collection starts here.',
  description = 'Add the things you own and keep their important details in one place.',
  actionText,
  actionIcon = 'add',
  actionVariant = 'primary',
  onActionPress,
  style,
  testID,
}) => {
  const isSecondary = actionVariant === 'secondary';

  return (
    <View
      style={[
        {
          backgroundColor: SereneColors.surfaceContainerLowest,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: SereneColors.subtleBorder,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 36,
          paddingHorizontal: 24,
          marginVertical: 12,
        },
        style,
      ]}
      className="items-center justify-center py-9 px-6 bg-serene-surface-container-lowest rounded-serene-xl border border-serene-subtle-border my-3"
      testID={testID}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: 'rgba(17,80,134,0.08)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
        className="w-[60px] h-[60px] rounded-full bg-[rgba(17,80,134,0.08)] items-center justify-center mb-4"
      >
        <MaterialIcons name={icon} size={32} color={SereneColors.primary} />
      </View>

      <Text
        style={{
          fontSize: 17,
          fontWeight: '700',
          color: SereneColors.onSurface,
          textAlign: 'center',
          marginBottom: 6,
        }}
        className="text-[17px] font-bold text-serene-on-surface text-center mb-[6px]"
      >
        {title}
      </Text>
      <Text
        style={{
          fontSize: 13,
          color: SereneColors.onSurfaceVariant,
          textAlign: 'center',
          lineHeight: 19,
          maxWidth: 280,
          marginBottom: 18,
        }}
        className="text-[13px] text-serene-on-surface-variant text-center leading-[19px] max-w-[280px] mb-[18px]"
      >
        {description}
      </Text>

      {actionText && onActionPress ? (
        <TouchableOpacity
          style={
            isSecondary
              ? {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: SereneColors.surfaceContainerLow,
                  paddingHorizontal: 18,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: SereneColors.subtleBorder,
                }
              : {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: SereneColors.primary,
                  paddingHorizontal: 18,
                  paddingVertical: 10,
                  borderRadius: 12,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.05,
                  shadowRadius: 2,
                  elevation: 1,
                }
          }
          className={
            isSecondary
              ? 'flex-row items-center gap-[6px] bg-serene-surface-container-low px-[18px] py-[10px] rounded-serene-lg border border-serene-subtle-border'
              : 'flex-row items-center gap-[6px] bg-serene-primary px-[18px] py-[10px] rounded-serene-lg shadow-sm'
          }
          activeOpacity={0.85}
          onPress={onActionPress}
          testID={testID ? `${testID}-action` : undefined}
          accessibilityRole="button"
          accessibilityLabel={actionText}
        >
          {actionIcon ? (
            <MaterialIcons
              name={actionIcon}
              size={18}
              color={isSecondary ? SereneColors.primary : '#FFFFFF'}
            />
          ) : null}
          <Text
            style={{
              fontSize: 13,
              fontWeight: '600',
              color: isSecondary ? SereneColors.primary : '#FFFFFF',
            }}
            className={
              isSecondary
                ? 'text-[13px] font-semibold text-serene-primary'
                : 'text-[13px] font-semibold text-white'
            }
          >
            {actionText}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};
