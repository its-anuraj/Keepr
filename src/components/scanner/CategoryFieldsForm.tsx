
import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CanonicalCategory, FieldValue } from '../../types/scanner';
import { CATEGORY_RULES } from '../../services/categoryRules';
import { ConfidenceBadge } from './ConfidenceBadge';

interface CategoryFieldsFormProps {
  category: CanonicalCategory;
  details: Record<string, FieldValue<any> | undefined>;
  onChangeField: (key: string, value: string | number) => void;
}

export const CategoryFieldsForm: React.FC<CategoryFieldsFormProps> = ({
  category,
  details,
  onChangeField,
}) => {
  const config = CATEGORY_RULES[category] || CATEGORY_RULES['Other'];

  return (
    <View className="bg-white rounded-[14px] border border-[#E2E8F0] p-4 mb-4 shadow-sm">
      <View className="flex-row items-center gap-3 mb-4 pb-3 border-b border-[#F1F5F9]">
        <View className="w-9 h-9 rounded-full bg-[#E0F2FE] items-center justify-center">
          <MaterialIcons name={config.icon as any} size={18} color="#115086" />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-[#0F172A]">{config.label} Details</Text>
          <Text className="text-[12px] text-[#64748B] mt-[2px]">{config.description}</Text>
        </View>
      </View>

      <View className="gap-3">
        {config.fields.map((fieldDef) => {
          const fieldVal = details[fieldDef.key];
          const rawValue = fieldVal?.value !== undefined && fieldVal?.value !== null ? String(fieldVal.value) : '';
          const needsVerification = fieldVal?.needsVerification || (fieldDef.sensitive && !rawValue);

          return (
            <View key={fieldDef.key} className="gap-[5px]">
              <View className="flex-row justify-between items-center">
                <Text className="text-[12px] font-semibold text-[#475569]">{fieldDef.label}</Text>
                <ConfidenceBadge
                  needsVerification={needsVerification}
                  labelOverride="Please verify"
                  compact
                />
              </View>

              <TextInput
                className={`border rounded-serene-md px-3 py-[9px] text-[13px] text-[#0F172A] ${
                  needsVerification
                    ? 'bg-[#FFFBEB] border-[#FCD34D]'
                    : 'bg-[#FAFAF9] border-[#E2E8F0]'
                }`}
                value={rawValue}
                onChangeText={(text) => {
                  if (fieldDef.type === 'number') {
                    const parsed = parseFloat(text.replace(/[^0-9.]/g, '')) || 0;
                    onChangeField(fieldDef.key, parsed);
                  } else {
                    onChangeField(fieldDef.key, text);
                  }
                }}
                placeholder={fieldDef.placeholder || `e.g. ${fieldDef.label}`}
                placeholderTextColor="#94A3B8"
                keyboardType={fieldDef.type === 'number' ? 'numeric' : 'default'}
                autoCapitalize={fieldDef.sensitive ? 'characters' : 'sentences'}
              />

              {fieldDef.hint && (
                <Text className="text-[11px] text-[#94A3B8] italic">{fieldDef.hint}</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};
