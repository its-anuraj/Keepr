import React from 'react';
import { Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';

export type ServiceSortOption =
  | 'newest_service'
  | 'oldest_service'
  | 'recently_added'
  | 'oldest_added'
  | 'amount_desc'
  | 'amount_asc'
  | 'item_asc'
  | 'item_desc';

export const SERVICE_SORT_LABELS: Record<ServiceSortOption, string> = {
  newest_service: 'Newest Service',
  oldest_service: 'Oldest Service',
  recently_added: 'Recently Added',
  oldest_added: 'Oldest Added',
  amount_desc: 'Amount: High to Low',
  amount_asc: 'Amount: Low to High',
  item_asc: 'Item: A to Z',
  item_desc: 'Item: Z to A',
};

const CONFIG: Array<{
  id: ServiceSortOption;
  label: string;
  description: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}> = [
  { id: 'newest_service', label: 'Newest Service', description: 'Most recent service dates first', icon: 'event' },
  { id: 'oldest_service', label: 'Oldest Service', description: 'Earliest service dates first', icon: 'history' },
  { id: 'recently_added', label: 'Recently Added', description: 'Newest records entered into Keepr first', icon: 'add-circle-outline' },
  { id: 'oldest_added', label: 'Oldest Added', description: 'Earliest records entered into Keepr first', icon: 'schedule' },
  { id: 'amount_desc', label: 'Amount: High to Low', description: 'Highest repair cost first', icon: 'trending-down' },
  { id: 'amount_asc', label: 'Amount: Low to High', description: 'Lowest repair cost first', icon: 'trending-up' },
  { id: 'item_asc', label: 'Item: A to Z', description: 'Alphabetical order by item name', icon: 'sort-by-alpha' },
  { id: 'item_desc', label: 'Item: Z to A', description: 'Reverse alphabetical order by item name', icon: 'sort-by-alpha' },
];

export interface ServiceSortModalProps {
  visible: boolean;
  selectedSort: ServiceSortOption;
  onSelectSort: (sort: ServiceSortOption) => void;
  onClose: () => void;
}

export const ServiceSortModal: React.FC<ServiceSortModalProps> = ({
  visible,
  selectedSort,
  onSelectSort,
  onClose,
}) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableWithoutFeedback onPress={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' }}>
        <TouchableWithoutFeedback>
          <View
            style={{
              backgroundColor: '#fff',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: Platform.OS === 'ios' ? 36 : 24,
            }}
          >
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginBottom: 12 }} />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: 'rgba(17,80,134,0.08)',
                marginBottom: 8,
              }}
            >
              <View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: SereneColors.onSurface }}>Sort By</Text>
                <Text style={{ fontSize: 12, color: SereneColors.onSurfaceVariant }}>Choose how service records are ordered</Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: SereneColors.surfaceContainerHigh,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialIcons name="close" size={18} color={SereneColors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>
            <View style={{ gap: 4, marginTop: 4 }}>
              {CONFIG.map((opt) => {
                const isSel = selectedSort === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderRadius: 10,
                      backgroundColor: isSel ? SereneColors.surfaceContainerHighest : 'transparent',
                    }}
                    onPress={() => {
                      onSelectSort(opt.id);
                      onClose();
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isSel ? SereneColors.primary : SereneColors.surfaceContainer,
                        }}
                      >
                        <MaterialIcons name={opt.icon} size={16} color={isSel ? '#FFFFFF' : SereneColors.onSurfaceVariant} />
                      </View>
                      <View>
                        <Text style={{ fontSize: 13, fontWeight: isSel ? '700' : '500', color: isSel ? SereneColors.primary : SereneColors.onSurface }}>
                          {opt.label}
                        </Text>
                        <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant }}>{opt.description}</Text>
                      </View>
                    </View>
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        borderWidth: 2,
                        borderColor: isSel ? SereneColors.primary : SereneColors.outline,
                        backgroundColor: isSel ? SereneColors.primary : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isSel && <MaterialIcons name="check" size={13} color="#FFFFFF" />}
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
