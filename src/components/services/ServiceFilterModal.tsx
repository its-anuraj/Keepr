import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../constants/theme';
import { ServiceType } from '../../types';

export interface ServiceFilterState {
  serviceType: string; // 'all' or ServiceType
  coverage: 'all' | 'covered' | 'not_covered' | 'unknown';
  postCoverage: 'all' | 'has_warranty' | 'has_guarantee' | 'none';
  linkedItem: 'all' | 'linked' | 'unlinked';
  dateRange: 'all' | '30d' | '3m' | '6m' | '12m' | 'older_1y';
}

export const DEFAULT_SERVICE_FILTERS: ServiceFilterState = {
  serviceType: 'all',
  coverage: 'all',
  postCoverage: 'all',
  linkedItem: 'all',
  dateRange: 'all',
};

export function countActiveServiceFilters(f: ServiceFilterState): number {
  let n = 0;
  if (f.serviceType !== 'all') n++;
  if (f.coverage !== 'all') n++;
  if (f.postCoverage !== 'all') n++;
  if (f.linkedItem !== 'all') n++;
  if (f.dateRange !== 'all') n++;
  return n;
}

export interface ServiceFilterModalProps {
  visible: boolean;
  filters: ServiceFilterState;
  onApplyFilters: (newFilters: ServiceFilterState) => void;
  onClose: () => void;
}

function PillRow<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  selected: T;
  onSelect: (id: T) => void;
}) {
  return (
    <View style={ps.section}>
      <Text style={ps.sectionLabel}>{label}</Text>
      <View style={ps.pillWrap}>
        {options.map((opt) => {
          const isSel = opt.id === selected;
          return (
            <TouchableOpacity
              key={opt.id}
              onPress={() => onSelect(opt.id)}
              activeOpacity={0.7}
              style={[ps.pill, isSel ? ps.pillSelected : ps.pillDefault]}
            >
              <Text style={[ps.pillText, isSel ? ps.pillTextSel : ps.pillTextDef]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const ps = StyleSheet.create({
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#1E293B', letterSpacing: 0.8, textTransform: 'uppercase' },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillSelected: { backgroundColor: SereneColors.primary, borderColor: SereneColors.primary },
  pillDefault: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  pillText: { fontSize: 12, fontWeight: '600' },
  pillTextSel: { color: '#FFFFFF' },
  pillTextDef: { color: '#475569' },
});

const SERVICE_TYPE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All Services' },
  { id: 'Repair', label: 'Repair' },
  { id: 'Maintenance', label: 'Maintenance' },
  { id: 'Servicing', label: 'Servicing' },
  { id: 'Inspection', label: 'Inspection' },
  { id: 'Part Replacement', label: 'Part Replacement' },
  { id: 'Software / Technical', label: 'Software / Tech' },
  { id: 'Cleaning', label: 'Cleaning' },
  { id: 'Other', label: 'Other' },
];

const COVERAGE_OPTIONS: Array<{ id: ServiceFilterState['coverage']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'covered', label: 'Warranty Covered' },
  { id: 'not_covered', label: 'Not Covered' },
  { id: 'unknown', label: 'Unknown' },
];

const POST_COVERAGE_OPTIONS: Array<{ id: ServiceFilterState['postCoverage']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'has_warranty', label: 'Has Warranty' },
  { id: 'has_guarantee', label: 'Has Guarantee' },
  { id: 'none', label: 'No Post Coverage' },
];

const LINKED_OPTIONS: Array<{ id: ServiceFilterState['linkedItem']; label: string }> = [
  { id: 'all', label: 'All Records' },
  { id: 'linked', label: 'Linked to Item' },
  { id: 'unlinked', label: 'Unlinked / Standalone' },
];

const DATE_RANGE_OPTIONS: Array<{ id: ServiceFilterState['dateRange']; label: string }> = [
  { id: 'all', label: 'All Time' },
  { id: '30d', label: 'Last 30 Days' },
  { id: '3m', label: 'Last 3 Months' },
  { id: '6m', label: 'Last 6 Months' },
  { id: '12m', label: 'Last 1 Year' },
  { id: 'older_1y', label: 'Older than 1 Year' },
];

export const ServiceFilterModal: React.FC<ServiceFilterModalProps> = ({
  visible,
  filters,
  onApplyFilters,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const SHEET_MAX_HEIGHT = Math.round(Dimensions.get('window').height * 0.88);
  const [draft, setDraft] = useState<ServiceFilterState>(filters);
  const prevVisRef = useRef(visible);

  useEffect(() => {
    if (visible && !prevVisRef.current) setDraft(filters);
    prevVisRef.current = visible;
  }, [visible, filters]);

  const activeCount = useMemo(() => countActiveServiceFilters(draft), [draft]);
  const handleClear = useCallback(() => setDraft(DEFAULT_SERVICE_FILTERS), []);
  const handleApply = useCallback(() => {
    onApplyFilters(draft);
    onClose();
  }, [draft, onApplyFilters, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable
          style={[
            s.sheet,
            {
              maxHeight: SHEET_MAX_HEIGHT,
              paddingBottom: Math.max(insets.bottom, 16) + 12,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View>
              <Text style={s.title}>Filter Services</Text>
              <Text style={s.subtitle}>
                {activeCount === 0
                  ? 'Showing all service & repair records'
                  : `${activeCount} filter${activeCount === 1 ? '' : 's'} active`}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.7}>
              <MaterialIcons name="close" size={20} color={SereneColors.onSurfaceVariant} />
            </TouchableOpacity>
          </View>

          {/* Body */}
          <ScrollView
            style={s.body}
            contentContainerStyle={s.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Service Type */}
            <PillRow
              label="Service Type"
              options={SERVICE_TYPE_OPTIONS}
              selected={draft.serviceType}
              onSelect={(st) => setDraft((p) => ({ ...p, serviceType: st }))}
            />

            {/* Coverage */}
            <PillRow
              label="Coverage During Service"
              options={COVERAGE_OPTIONS}
              selected={draft.coverage}
              onSelect={(cov) => setDraft((p) => ({ ...p, coverage: cov }))}
            />

            {/* Post-Service Coverage */}
            <PillRow
              label="Post-Service Warranty / Guarantee"
              options={POST_COVERAGE_OPTIONS}
              selected={draft.postCoverage}
              onSelect={(pc) => setDraft((p) => ({ ...p, postCoverage: pc }))}
            />

            {/* Linked Item */}
            <PillRow
              label="Linked Item"
              options={LINKED_OPTIONS}
              selected={draft.linkedItem}
              onSelect={(li) => setDraft((p) => ({ ...p, linkedItem: li }))}
            />

            {/* Date Range */}
            <PillRow
              label="Service Date"
              options={DATE_RANGE_OPTIONS}
              selected={draft.dateRange}
              onSelect={(dr) => setDraft((p) => ({ ...p, dateRange: dr }))}
            />
          </ScrollView>

          {/* Footer */}
          <View style={s.footer}>
            <TouchableOpacity
              onPress={handleClear}
              disabled={activeCount === 0}
              style={[s.clearBtn, activeCount === 0 && s.clearBtnDisabled]}
              activeOpacity={0.7}
            >
              <Text style={[s.clearText, activeCount === 0 && s.clearTextDisabled]}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleApply} style={s.applyBtn} activeOpacity={0.85}>
              <Text style={s.applyText}>Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,80,134,0.08)',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  subtitle: {
    fontSize: 12,
    color: SereneColors.onSurfaceVariant,
    marginTop: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: SereneColors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 1,
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,80,134,0.08)',
  },
  clearBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  clearBtnDisabled: {
    opacity: 0.45,
  },
  clearText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  clearTextDisabled: {
    color: '#94A3B8',
  },
  applyBtn: {
    flex: 2,
    height: 44,
    borderRadius: 12,
    backgroundColor: SereneColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
