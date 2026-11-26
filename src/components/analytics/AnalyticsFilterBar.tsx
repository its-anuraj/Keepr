import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SereneColors, SereneRadius } from '../../constants/theme';
import { AnalyticsDateFilter, CustomDateRange } from '../../services/analyticsService';
import { DEFAULT_CATEGORIES, getCategoryNameFromId } from '../../constants/categories';

export interface AnalyticsFilterBarProps {
  selectedFilter: AnalyticsDateFilter;
  onSelectFilter: (filter: AnalyticsDateFilter) => void;
  selectedCategoryId?: string;
  onSelectCategory: (categoryId: string) => void;
  customRange?: CustomDateRange;
  onSetCustomRange: (range: CustomDateRange) => void;
  onReset: () => void;
}

const DATE_OPTIONS: Array<{ id: AnalyticsDateFilter; label: string }> = [
  { id: 'all_time', label: 'All Time' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'last_3_months', label: 'Last 3M' },
  { id: 'last_6_months', label: 'Last 6M' },
  { id: 'this_year', label: 'This Year' },
  { id: 'last_year', label: 'Last Year' },
  { id: 'custom', label: 'Custom' },
];

export const AnalyticsFilterBar: React.FC<AnalyticsFilterBarProps> = ({
  selectedFilter,
  onSelectFilter,
  selectedCategoryId = 'all',
  onSelectCategory,
  customRange,
  onSetCustomRange,
  onReset,
}) => {
  const insets = useSafeAreaInsets();
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);

  const [customStart, setCustomStart] = useState(customRange?.startDate || '2026-01-01');
  const [customEnd, setCustomEnd] = useState(
    customRange?.endDate || new Date().toISOString().split('T')[0]
  );

  const hasActiveFilters = selectedFilter !== 'all_time' || selectedCategoryId !== 'all';
  const categoryLabel = selectedCategoryId !== 'all' ? getCategoryNameFromId(selectedCategoryId) : 'All Categories';

  const handleApplyCustomRange = () => {
    // Validate YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(customStart) || !dateRegex.test(customEnd)) {
      Alert.alert('Invalid Date Format', 'Please enter dates in YYYY-MM-DD format (e.g. 2026-03-15).');
      return;
    }
    if (new Date(customStart) > new Date(customEnd)) {
      Alert.alert('Invalid Range', 'Start date must be earlier than or equal to end date.');
      return;
    }

    onSetCustomRange({ startDate: customStart, endDate: customEnd });
    onSelectFilter('custom');
    setShowCustomModal(false);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Reset Button (only shown when non-default filter is applied) */}
        {hasActiveFilters && (
          <TouchableOpacity style={styles.resetBtn} onPress={onReset} activeOpacity={0.7}>
            <MaterialIcons name="refresh" size={14} color={SereneColors.error} />
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
        )}

        {/* Date Filter Pills */}
        {DATE_OPTIONS.map((opt) => {
          const isSelected = selectedFilter === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.pill, isSelected ? styles.pillSelected : styles.pillDefault]}
              onPress={() => {
                if (opt.id === 'custom') {
                  setShowCustomModal(true);
                } else {
                  onSelectFilter(opt.id);
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.pillText, isSelected ? styles.pillTextSelected : styles.pillTextDefault]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Category Filter Button */}
        <TouchableOpacity
          style={[styles.categoryBtn, selectedCategoryId !== 'all' && styles.categoryBtnActive]}
          onPress={() => setShowCategoryModal(true)}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name="category"
            size={14}
            color={selectedCategoryId !== 'all' ? '#FFFFFF' : SereneColors.onSurfaceVariant}
          />
          <Text
            style={[
              styles.categoryBtnText,
              selectedCategoryId !== 'all' && styles.categoryBtnTextActive,
            ]}
          >
            {categoryLabel}
          </Text>
          <MaterialIcons
            name="arrow-drop-down"
            size={16}
            color={selectedCategoryId !== 'all' ? '#FFFFFF' : SereneColors.onSurfaceVariant}
          />
        </TouchableOpacity>
      </ScrollView>

      {/* Custom Date Range Modal */}
      <Modal
        visible={showCustomModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCustomModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Custom Date Range</Text>
              <TouchableOpacity onPress={() => setShowCustomModal(false)}>
                <MaterialIcons name="close" size={20} color={SereneColors.outline} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Start Date (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.textInput}
                  value={customStart}
                  onChangeText={setCustomStart}
                  placeholder="2026-01-01"
                  placeholderTextColor={SereneColors.outline}
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>End Date (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.textInput}
                  value={customEnd}
                  onChangeText={setCustomEnd}
                  placeholder="2026-12-31"
                  placeholderTextColor={SereneColors.outline}
                  autoCapitalize="none"
                />
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowCustomModal(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.applyBtn}
                onPress={handleApplyCustomRange}
              >
                <Text style={styles.applyText}>Apply Range</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Category Selection Modal */}
      <Modal
        visible={showCategoryModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCategoryModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filter by Category</Text>
              <TouchableOpacity onPress={() => setShowCategoryModal(false)}>
                <MaterialIcons name="close" size={20} color={SereneColors.outline} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 300 }}>
              <TouchableOpacity
                style={[
                  styles.categoryOptionRow,
                  selectedCategoryId === 'all' && styles.categoryOptionSelected,
                ]}
                onPress={() => {
                  onSelectCategory('all');
                  setShowCategoryModal(false);
                }}
              >
                <Text style={[styles.categoryOptionText, selectedCategoryId === 'all' && styles.categoryOptionTextSelected]}>
                  All Categories
                </Text>
                {selectedCategoryId === 'all' && (
                  <MaterialIcons name="check" size={18} color={SereneColors.primary} />
                )}
              </TouchableOpacity>

              {DEFAULT_CATEGORIES.map((cat) => {
                const isSel = selectedCategoryId === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryOptionRow,
                      isSel && styles.categoryOptionSelected,
                    ]}
                    onPress={() => {
                      onSelectCategory(cat.id);
                      setShowCategoryModal(false);
                    }}
                  >
                    <View style={styles.catOptionLeft}>
                      <MaterialIcons name={(cat.icon as any) || 'folder'} size={18} color={SereneColors.primary} />
                      <Text style={[styles.categoryOptionText, isSel && styles.categoryOptionTextSelected]}>
                        {cat.name}
                      </Text>
                    </View>
                    {isSel && (
                      <MaterialIcons name="check" size={18} color={SereneColors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: SereneRadius.full,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  resetText: {
    fontSize: 12,
    fontWeight: '700',
    color: SereneColors.error,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: SereneRadius.full,
    borderWidth: 1,
  },
  pillDefault: {
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderColor: SereneColors.subtleBorder,
  },
  pillSelected: {
    backgroundColor: SereneColors.primary,
    borderColor: SereneColors.primary,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextDefault: {
    color: SereneColors.onSurfaceVariant,
  },
  pillTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  categoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: SereneRadius.full,
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
  },
  categoryBtnActive: {
    backgroundColor: SereneColors.primary,
    borderColor: SereneColors.primary,
  },
  categoryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: SereneColors.onSurfaceVariant,
  },
  categoryBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderRadius: SereneRadius.xl,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  modalBody: {
    gap: 12,
    marginBottom: 20,
  },
  inputGroup: {
    gap: 4,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: SereneColors.onSurfaceVariant,
  },
  textInput: {
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
    borderRadius: SereneRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: SereneColors.onSurface,
    backgroundColor: '#F8FAFC',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: SereneRadius.md,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: SereneColors.outline,
  },
  applyBtn: {
    backgroundColor: SereneColors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: SereneRadius.md,
  },
  applyText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  categoryOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  categoryOptionSelected: {
    backgroundColor: '#EFF6FF',
    borderRadius: SereneRadius.sm,
  },
  catOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: SereneColors.onSurface,
  },
  categoryOptionTextSelected: {
    color: SereneColors.primary,
    fontWeight: '700',
  },
});
