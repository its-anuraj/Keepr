import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { SereneColors } from '../../constants/theme';

export interface DetailRowProps {
  label: string;
  value?: React.ReactNode;
  icon?: keyof typeof MaterialIcons.glyphMap;
  stacked?: boolean;
  isMono?: boolean;
  valueColor?: string;
  showDivider?: boolean;
  copyable?: boolean | string;
  action?: React.ReactNode;
  helperText?: string;
  className?: string;
}

/**
 * DetailRow - Responsive, collision-free key-value pair display.
 * 
 * Automatically selects between horizontal side-by-side or vertical stacked layout
 * depending on label/value length, eliminating text collisions, clipping, and overflow.
 */
export const DetailRow: React.FC<DetailRowProps> = ({
  label,
  value,
  icon,
  stacked,
  isMono = false,
  valueColor,
  showDivider = false,
  copyable = false,
  action,
  helperText,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);

  if (value === undefined || value === null || value === '') {
    return null;
  }

  const isValueString = typeof value === 'string';
  const stringValue = isValueString ? (value as string) : '';

  // Determine if layout should stack vertically:
  // 1. Explicit stacked prop is true
  // 2. String value exceeds 24 characters
  // 3. Combined label + value exceeds 32 characters
  // 4. Value contains explicit newlines
  // 5. Copyable action is present and string value exceeds 18 characters
  const shouldStack =
    stacked !== undefined
      ? stacked
      : isValueString && (
          stringValue.length > 24 ||
          label.length + stringValue.length > 32 ||
          stringValue.includes('\n') ||
          (Boolean(copyable) && stringValue.length > 18)
        );

  const handleCopy = async () => {
    const textToCopy = typeof copyable === 'string' ? copyable : stringValue;
    if (textToCopy) {
      await Clipboard.setStringAsync(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const monoStyle = isMono
    ? { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }
    : {};

  return (
    <View className={`w-full ${className}`}>
      {shouldStack ? (
        // Stacked Layout: Label on top, value below with 100% horizontal space
        <View className="py-1.5 gap-1">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5 flex-1 min-w-0 pr-2">
              {icon ? (
                <MaterialIcons name={icon} size={13} color={SereneColors.onSurfaceVariant} />
              ) : null}
              <Text
                className="text-[12px] font-medium text-serene-on-surface-variant"
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>

            <View className="flex-row items-center gap-1.5 shrink-0">
              {copyable ? (
                <TouchableOpacity
                  onPress={handleCopy}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  className="flex-row items-center gap-0.5 px-2 py-0.5 rounded bg-serene-surface-container-high shrink-0"
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={copied ? 'check' : 'content-copy'}
                    size={11}
                    color={copied ? '#059669' : SereneColors.primary}
                  />
                  <Text
                    className={`text-[10px] font-semibold ${
                      copied ? 'text-emerald-700' : 'text-serene-primary'
                    }`}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {action}
            </View>
          </View>

          {isValueString ? (
            <Text
              className="text-[13.5px] font-semibold text-serene-on-surface leading-relaxed mt-0.5"
              style={[{ color: valueColor || SereneColors.onSurface }, monoStyle]}
              selectable
            >
              {stringValue}
            </Text>
          ) : (
            <View className="w-full mt-0.5">{value}</View>
          )}

          {helperText ? (
            <Text className="text-[11px] text-serene-on-surface-variant/80 mt-0.5">
              {helperText}
            </Text>
          ) : null}
        </View>
      ) : (
        // Side-by-Side Layout: Label on left (bounded), value on right (flex-1 min-w-0 wraps naturally)
        <View className="flex-row items-start justify-between py-1.5 gap-3">
          <View className="flex-row items-center gap-1.5 shrink-0" style={{ maxWidth: '48%' }}>
            {icon ? (
              <MaterialIcons name={icon} size={13} color={SereneColors.onSurfaceVariant} />
            ) : null}
            <Text
              className="text-[12px] text-serene-on-surface-variant font-medium"
              numberOfLines={2}
            >
              {label}
            </Text>
          </View>

          <View className="flex-1 min-w-0 items-end justify-center">
            <View className="flex-row items-center gap-1.5 flex-wrap justify-end">
              {isValueString ? (
                <Text
                  className="text-[13px] font-semibold text-serene-on-surface text-right"
                  style={[
                    { color: valueColor || SereneColors.onSurface, flexShrink: 1 },
                    monoStyle,
                  ]}
                  selectable
                >
                  {stringValue}
                </Text>
              ) : (
                value
              )}

              {copyable ? (
                <TouchableOpacity
                  onPress={handleCopy}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  className="p-1 rounded bg-serene-surface-container-high shrink-0"
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={copied ? 'check' : 'content-copy'}
                    size={11}
                    color={copied ? '#059669' : SereneColors.primary}
                  />
                </TouchableOpacity>
              ) : null}

              {action}
            </View>

            {helperText ? (
              <Text className="text-[11px] text-serene-on-surface-variant/80 text-right mt-0.5">
                {helperText}
              </Text>
            ) : null}
          </View>
        </View>
      )}

      {showDivider ? (
        <View className="h-[1px] bg-serene-subtle-border/60 my-1" />
      ) : null}
    </View>
  );
};
