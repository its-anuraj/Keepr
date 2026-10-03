
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import {
  DEFAULT_CATEGORIES,
  getProductTypesForCategory,
} from '../../constants/categories';
import {
  SortOption,
} from './SortModal';

export interface FilterState {
  categoryId: string; // 'all' or category id
  productType: string; // 'all' or product type name
  priceRange: 'all' | 'under_5k' | '5k_25k' | '25k_100k' | 'above_100k';
  purchaseDateRange: 'all' | '30d' | '3m' | '6m' | '12m' | 'older_1y';
  warrantyStatus: 'all' | 'active' | 'expiring' | 'expired' | 'none';
  returnStatus: 'all' | 'available' | 'ending_soon' | 'expired' | 'none';
  sortBy: SortOption;
}

export const DEFAULT_FILTERS: FilterState = {
  categoryId: 'all',
  productType: 'all',
  priceRange: 'all',
  purchaseDateRange: 'all',
  warrantyStatus: 'all',
  returnStatus: 'all',
  sortBy: 'recent_added',
};

export function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.categoryId !== 'all') count++;
  if (filters.productType && filters.productType !== 'all') count++;
  if (filters.priceRange !== 'all') count++;
  if (filters.purchaseDateRange !== 'all') count++;
  if (filters.warrantyStatus !== 'all') count++;
  if (filters.returnStatus !== 'all') count++;
  return count;
}

export interface FilterModalProps {
  visible: boolean;
  filters: FilterState;
  availableProductTypes?: string[];
  onApplyFilters: (newFilters: FilterState) => void;
  onClose: () => void;
}

interface PillRowProps<T extends string> {
  label: string;
  options: Array<{ id: T; label: string }>;
  selected: T;
  onSelect: (id: T) => void;
}

function PillRow<T extends string>({ label, options, selected, onSelect }: PillRowProps<T>) {
  return (
    <View style={pillStyles.section}>
      <Text style={pillStyles.sectionLabel}>{label}</Text>
      <View style={pillStyles.pillWrap}>
        {options.map((opt) => {
          const isSelected = opt.id === selected;
          return (
            <TouchableOpacity
              key={opt.id}
              onPress={() => onSelect(opt.id)}
              activeOpacity={0.7}
              style={[
                pillStyles.pill,
                isSelected ? pillStyles.pillSelected : pillStyles.pillDefault,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
            >
              <Text style={[pillStyles.pillText, isSelected ? pillStyles.pillTextSelected : pillStyles.pillTextDefault]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E293B',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillSelected: {
    backgroundColor: SereneColors.primary,
    borderColor: SereneColors.primary,
  },
  pillDefault: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextSelected: {
    color: '#FFFFFF',
  },
  pillTextDefault: {
    color: '#475569',
  },
});

export const FilterModal: React.FC<FilterModalProps> = ({
  visible,
  filters,
  availableProductTypes = [],
  onApplyFilters,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;

  const SHEET_MAX_HEIGHT = Math.round(screenHeight * 0.88);

  const [draft, setDraft] = useState<FilterState>(filters);

  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setDraft(filters);
    }
    prevVisibleRef.current = visible;
  }, [visible, filters]);

  const activeCount = useMemo(() => countActiveFilters(draft), [draft]);

  const handleClearAll = useCallback(() => {
    setDraft(DEFAULT_FILTERS);
  }, []);

  const handleApply = useCallback(() => {
    onApplyFilters(draft);
    onClose();
  }, [draft, onApplyFilters, onClose]);

  const handleCategorySelect = useCallback((categoryId: string) => {
    setDraft((prev) => {
      let nextPt = prev.productType;
      if (categoryId !== 'all' && nextPt !== 'all') {
        const allowed = getProductTypesForCategory(categoryId);
        if (allowed.length > 0 && !allowed.some((a) => a.toLowerCase() === nextPt.toLowerCase())) {
          nextPt = 'all';
        }
      }
      return { ...prev, categoryId, productType: nextPt };
    });
  }, []);

  const productTypeOptions: Array<{ id: string; label: string }> = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [{ id: 'all', label: 'All Types' }];
    const set = new Set<string>();

    if (draft.categoryId !== 'all') {
      for (const pt of getProductTypesForCategory(draft.categoryId)) set.add(pt);
    }
    for (const pt of availableProductTypes) {
      if (pt && pt.trim()) set.add(pt.trim());
    }
    for (const pt of Array.from(set).sort()) {
      list.push({ id: pt, label: pt });
    }
    return list;
  }, [draft.categoryId, availableProductTypes]);

  const priceOptions: Array<{ id: FilterState['priceRange']; label: string }> = [
    { id: 'all', label: 'Any' },
    { id: 'under_5k', label: 'Under ₹5K' },
    { id: '5k_25k', label: '₹5K–25K' },
    { id: '25k_100k', label: '₹25K–1L' },
    { id: 'above_100k', label: 'Above ₹1L' },
  ];

  const dateOptions: Array<{ id: FilterState['purchaseDateRange']; label: string }> = [
    { id: 'all', label: 'Any time' },
    { id: '30d', label: 'Last 30d' },
    { id: '3m', label: 'Last 3 mo' },
    { id: '6m', label: 'Last 6 mo' },
    { id: '12m', label: 'Last 12 mo' },
    { id: 'older_1y', label: '>1 year ago' },
  ];

  const warrantyOptions: Array<{ id: FilterState['warrantyStatus']; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'expiring', label: 'Expiring soon' },
    { id: 'expired', label: 'Expired' },
    { id: 'none', label: 'No warranty' },
  ];

  const returnOptions: Array<{ id: FilterState['returnStatus']; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'available', label: 'Return active' },
    { id: 'ending_soon', label: 'Ending soon' },
    { id: 'expired', label: 'Return ended' },
    { id: 'none', label: 'No return date' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={sheet.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* Sheet card — explicit numeric maxHeight to fix Android collapse */}
        <View
          style={[
            sheet.card,
            {
              maxHeight: SHEET_MAX_HEIGHT,
              paddingBottom: Math.max(insets.bottom, 14),
            },
          ]}
        >
          <View style={sheet.handle} />

          <View style={sheet.header}>
            <View style={sheet.headerLeft}>
              <Text style={sheet.headerTitle}>Filter Items</Text>
              {activeCount > 0 && (
                <View style={sheet.badge}>
                  <Text style={sheet.badgeText}>{activeCount}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={sheet.closeBtn}
              accessibilityLabel="Close filter panel"
            >
              <MaterialIcons name="close" size={18} color={SereneColors.onSurfaceVariant} />
            </TouchableOpacity>
          </View>

          {/* ── Scrollable filter content ──────────────────────────────────
              flexGrow: 1 + explicit height budget ensures content fills the
              space between header and footer on ALL Android versions.         */}
          <ScrollView
            style={sheet.scroll}
            contentContainerStyle={sheet.scrollContent}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled={true}
            bounces={Platform.OS === 'ios'}
            overScrollMode="always"
          >
            <View style={pillStyles.section}>
              <Text style={pillStyles.sectionLabel}>Category</Text>
              <View style={pillStyles.pillWrap}>
                {(() => {
                  const isSelected = draft.categoryId === 'all';
                  return (
                    <TouchableOpacity
                      key="all"
                      onPress={() => handleCategorySelect('all')}
                      activeOpacity={0.7}
                      style={[pillStyles.pill, isSelected ? pillStyles.pillSelected : pillStyles.pillDefault]}
                    >
                      <Text style={[pillStyles.pillText, isSelected ? pillStyles.pillTextSelected : pillStyles.pillTextDefault]}>
                        All
                      </Text>
                    </TouchableOpacity>
                  );
                })()}

                {DEFAULT_CATEGORIES.map((cat) => {
                  const isSelected = draft.categoryId === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      onPress={() => handleCategorySelect(cat.id)}
                      activeOpacity={0.7}
                      style={[pillStyles.pill, isSelected ? pillStyles.pillSelected : pillStyles.pillDefault]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isSelected }}
                    >
                      <Text style={[pillStyles.pillText, isSelected ? pillStyles.pillTextSelected : pillStyles.pillTextDefault]}>
                        {cat.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {productTypeOptions.length > 1 && (
              <PillRow
                label="Product Type"
                options={productTypeOptions}
                selected={draft.productType}
                onSelect={(v) => setDraft((p) => ({ ...p, productType: v }))}
              />
            )}

            <PillRow
              label="Price Range"
              options={priceOptions}
              selected={draft.priceRange}
              onSelect={(v) => setDraft((p) => ({ ...p, priceRange: v }))}
            />

            <PillRow
              label="Purchase Date"
              options={dateOptions}
              selected={draft.purchaseDateRange}
              onSelect={(v) => setDraft((p) => ({ ...p, purchaseDateRange: v }))}
            />

            <PillRow
              label="Warranty"
              options={warrantyOptions}
              selected={draft.warrantyStatus}
              onSelect={(v) => setDraft((p) => ({ ...p, warrantyStatus: v }))}
            />

            <PillRow
              label="Return Status"
              options={returnOptions}
              selected={draft.returnStatus}
              onSelect={(v) => setDraft((p) => ({ ...p, returnStatus: v }))}
            />
          </ScrollView>

          <View style={sheet.footer}>
            <TouchableOpacity
              style={sheet.clearBtn}
              onPress={handleClearAll}
              activeOpacity={0.7}
              accessibilityLabel="Clear all filters"
            >
              <Text style={sheet.clearText}>Clear All</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={sheet.applyBtn}
              onPress={handleApply}
              activeOpacity={0.85}
              accessibilityLabel="Apply filters"
            >
              <Text style={sheet.applyText}>
                {activeCount > 0 ? `Apply (${activeCount})` : 'Apply'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const sheet = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flexDirection: 'column',
    // No overflow: hidden — that clips the scroll on some Android versions
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginTop: 12,
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E293B',
  },
  badge: {
    backgroundColor: SereneColors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // CRITICAL layout fix:
  // flex: 1 alone collapses to 0 inside Modal on Android without a concrete height.
  // flexGrow: 1 + flexShrink: 1 + minHeight forces layout engine to allocate real space.
  scroll: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 180,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 20,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,80,134,0.08)',
    backgroundColor: '#FFFFFF',
  },
  clearBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  applyBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: SereneColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: SereneColors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  applyText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
