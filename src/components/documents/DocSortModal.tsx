import React from 'react';
import { Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback, Platform, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';

export type DocSortOption = 'recent_added' | 'oldest_added' | 'doc_date_desc' | 'doc_date_asc' | 'expiry_asc' | 'expiry_desc' | 'name_asc' | 'name_desc';

export const DOC_SORT_LABELS: Record<DocSortOption, string> = {
  recent_added: 'Recently Added',
  oldest_added: 'Oldest Added',
  doc_date_desc: 'Document Date — Newest',
  doc_date_asc: 'Document Date — Oldest',
  expiry_asc: 'Expiry Date — Soonest',
  expiry_desc: 'Expiry Date — Latest',
  name_asc: 'Name — A to Z',
  name_desc: 'Name — Z to A',
};

const CONFIG: Array<{ id: DocSortOption; label: string; description: string; icon: keyof typeof MaterialIcons.glyphMap }> = [
  { id: 'recent_added', label: 'Recently Added', description: 'Newest vault additions first', icon: 'history' },
  { id: 'oldest_added', label: 'Oldest Added', description: 'Earliest vault additions first', icon: 'event-repeat' },
  { id: 'doc_date_desc', label: 'Document Date — Newest', description: 'Most recent document dates first', icon: 'calendar-today' },
  { id: 'doc_date_asc', label: 'Document Date — Oldest', description: 'Oldest document dates first', icon: 'calendar-month' },
  { id: 'expiry_asc', label: 'Expiry Date — Soonest', description: 'Expiring soonest first (docs without expiry last)', icon: 'timer' },
  { id: 'expiry_desc', label: 'Expiry Date — Latest', description: 'Latest expiry dates first (docs without expiry last)', icon: 'timer-off' },
  { id: 'name_asc', label: 'Name — A to Z', description: 'Alphabetical ascending order', icon: 'sort-by-alpha' },
  { id: 'name_desc', label: 'Name — Z to A', description: 'Alphabetical descending order', icon: 'sort-by-alpha' },
];

export interface DocSortModalProps {
  visible: boolean;
  selectedSort: DocSortOption;
  onSelectSort: (sort: DocSortOption) => void;
  onClose: () => void;
}

export const DocSortModal: React.FC<DocSortModalProps> = ({ visible, selectedSort, onSelectSort, onClose }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableWithoutFeedback onPress={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' }}>
        <TouchableWithoutFeedback>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 36 : 24 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginBottom: 12 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(17,80,134,0.08)', marginBottom: 8 }}>
              <View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: SereneColors.onSurface }}>Sort By</Text>
                <Text style={{ fontSize: 12, color: SereneColors.onSurfaceVariant }}>Choose how your documents are ordered</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: SereneColors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="close" size={18} color={SereneColors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>
            <View style={{ gap: 4, marginTop: 4 }}>
              {CONFIG.map((opt) => {
                const isSel = selectedSort === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: isSel ? SereneColors.surfaceContainerHighest : 'transparent' }}
                    onPress={() => { onSelectSort(opt.id); onClose(); }}
                    activeOpacity={0.8}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: isSel ? SereneColors.primary : SereneColors.surfaceContainer }}>
                        <MaterialIcons name={opt.icon} size={16} color={isSel ? '#FFFFFF' : SereneColors.onSurfaceVariant} />
                      </View>
                      <View>
                        <Text style={{ fontSize: 13, fontWeight: isSel ? '700' : '500', color: isSel ? SereneColors.primary : SereneColors.onSurface }}>{opt.label}</Text>
                        <Text style={{ fontSize: 11, color: SereneColors.onSurfaceVariant }}>{opt.description}</Text>
                      </View>
                    </View>
                    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: isSel ? SereneColors.primary : SereneColors.outline, backgroundColor: isSel ? SereneColors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
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
