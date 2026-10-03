
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';

export type SortOption =
  | 'recent_added'
  | 'purchase_desc'
  | 'purchase_asc'
  | 'price_desc'
  | 'price_asc'
  | 'name_asc'
  | 'name_desc';

export interface SortModalProps {
  visible: boolean;
  selectedSort: SortOption;
  onSelectSort: (sort: SortOption) => void;
  onClose: () => void;
}

interface SortItemConfig {
  id: SortOption;
  label: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}

export const SORT_OPTIONS_CONFIG: SortItemConfig[] = [
  {
    id: 'recent_added',
    label: 'Recently Added',
    description: 'Newest vault additions first',
    icon: 'history',
  },
  {
    id: 'purchase_desc',
    label: 'Recent Purchase',
    description: 'Newest purchase date first',
    icon: 'calendar-today',
  },
  {
    id: 'purchase_asc',
    label: 'Oldest Purchase',
    description: 'Earliest purchase date first',
    icon: 'event-repeat',
  },
  {
    id: 'price_desc',
    label: 'Price: High to Low',
    description: 'Most valuable assets first',
    icon: 'trending-down',
  },
  {
    id: 'price_asc',
    label: 'Price: Low to High',
    description: 'Most affordable assets first',
    icon: 'trending-up',
  },
  {
    id: 'name_asc',
    label: 'Name: A to Z',
    description: 'Alphabetical ascending order',
    icon: 'sort-by-alpha',
  },
  {
    id: 'name_desc',
    label: 'Name: Z to A',
    description: 'Alphabetical descending order',
    icon: 'sort-by-alpha',
  },
];

export const SortModal: React.FC<SortModalProps> = ({
  visible,
  selectedSort,
  onSelectSort,
  onClose,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View className="flex-1 bg-[rgba(15,23,42,0.55)] justify-end">
          <TouchableWithoutFeedback>
            <View
              className={`bg-white rounded-t-[24px] px-5 pt-3 ${
                Platform.OS === 'ios' ? 'pb-9' : 'pb-6'
              } shadow-lg`}
            >
              <View className="w-9 h-1 rounded-sm bg-[#CBD5E1] self-center mb-3" />

              <View className="flex-row items-center justify-between pb-3 border-b border-serene-hairline-border mb-2">
                <View>
                  <Text className="text-[17px] font-bold text-serene-on-surface">
                    Sort By
                  </Text>
                  <Text className="text-xs text-serene-on-surface-variant">
                    Choose how your collection is ordered
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  className="w-8 h-8 rounded-full bg-serene-surface-container-high items-center justify-center"
                  accessibilityLabel="Close sort"
                >
                  <MaterialIcons
                    name="close"
                    size={18}
                    color={SereneColors.onSurfaceVariant}
                  />
                </TouchableOpacity>
              </View>

              <View className="gap-1 mt-1">
                {SORT_OPTIONS_CONFIG.map((opt) => {
                  const isSelected = selectedSort === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      className={`flex-row items-center justify-between px-3 py-2.5 rounded-serene-lg ${
                        isSelected
                          ? 'bg-serene-surface-container-highest border border-serene-primary/30'
                          : 'active:bg-serene-surface-container-low'
                      }`}
                      onPress={() => {
                        onSelectSort(opt.id);
                        onClose();
                      }}
                      activeOpacity={0.8}
                    >
                      <View className="flex-row items-center gap-3">
                        <View
                          className={`w-8 h-8 rounded-serene-md items-center justify-center ${
                            isSelected
                              ? 'bg-serene-primary'
                              : 'bg-serene-surface-container'
                          }`}
                        >
                          <MaterialIcons
                            name={opt.icon}
                            size={16}
                            color={isSelected ? '#FFFFFF' : SereneColors.onSurfaceVariant}
                          />
                        </View>
                        <View>
                          <Text
                            className={`text-[13px] ${
                              isSelected
                                ? 'font-bold text-serene-primary'
                                : 'font-medium text-serene-on-surface'
                            }`}
                          >
                            {opt.label}
                          </Text>
                          <Text className="text-[11px] text-serene-on-surface-variant">
                            {opt.description}
                          </Text>
                        </View>
                      </View>

                      <View
                        className={`w-5 h-5 rounded-full border items-center justify-center ${
                          isSelected
                            ? 'border-serene-primary bg-serene-primary'
                            : 'border-serene-outline bg-transparent'
                        }`}
                      >
                        {isSelected && (
                          <MaterialIcons name="check" size={13} color="#FFFFFF" />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};
