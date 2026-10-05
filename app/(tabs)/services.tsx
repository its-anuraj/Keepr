// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Services & Repair Tab Screen
// Full Scoped Search + Sort + Filter implementation for Service & Repair records.
// Strict entity separation: only Service records shown here, derived from
// canonical maintenance_records, linked to Purchased Items.
// ==============================================================================

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { Header } from '../../src/components/ui/Header';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { useAuthStore } from '../../src/store/authStore';
import { MaintenanceRecord, ServiceType } from '../../src/types';
import { formatCurrency, formatDate } from '../../src/utils/currency';
import {
  ServiceSortModal,
  ServiceSortOption,
  SERVICE_SORT_LABELS,
} from '../../src/components/services/ServiceSortModal';
import {
  ServiceFilterModal,
  ServiceFilterState,
  DEFAULT_SERVICE_FILTERS,
  countActiveServiceFilters,
} from '../../src/components/services/ServiceFilterModal';

const SERVICE_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  Repair: 'build',
  Maintenance: 'handyman',
  Servicing: 'car-repair',
  Inspection: 'search',
  'Part Replacement': 'extension',
  'Software / Technical': 'memory',
  Cleaning: 'cleaning-services',
  Other: 'more-horiz',
};

interface ServiceCardProps {
  record: MaintenanceRecord;
  linkedItemName?: string | null;
  isSelected: boolean;
  isSelectionMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const ServiceCard = React.memo(function ServiceCard({
  record,
  linkedItemName,
  isSelected,
  isSelectionMode,
  onPress,
  onLongPress,
}: ServiceCardProps) {
  const icon = SERVICE_ICONS[record.serviceType || 'Repair'] || 'build';
  const amount = record.amountPaid != null ? record.amountPaid : (record.cost ?? 0);

  // Post-service warranty / guarantee status
  const hasWarranty = Boolean(record.postServiceWarranty && record.postServiceWarrantyUntil);
  const hasGuarantee = Boolean(record.postServiceGuarantee && record.postServiceGuaranteeUntil);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isSelected && {
          backgroundColor: 'rgba(17, 80, 134, 0.07)',
          borderColor: 'rgba(17, 80, 134, 0.35)',
          borderWidth: 1.5,
        },
      ]}
      activeOpacity={0.75}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View style={styles.cardHeader}>
        <View style={styles.iconContainer}>
          <MaterialIcons name={icon} size={20} color={SereneColors.primary} />
        </View>

        <View style={styles.cardHeaderContent}>
          <Text style={styles.recordTitle} numberOfLines={1}>
            {record.title}
          </Text>
          <View style={styles.itemRow}>
            <MaterialIcons name="inventory-2" size={13} color={SereneColors.onSurfaceVariant} />
            <Text style={styles.linkedItemText} numberOfLines={1}>
              {linkedItemName || 'Unlinked Service'}
            </Text>
          </View>
        </View>

        {isSelectionMode ? (
          <View
            style={[
              styles.checkbox,
              isSelected && {
                backgroundColor: SereneColors.primary,
                borderColor: SereneColors.primary,
              },
            ]}
          >
            {isSelected && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
          </View>
        ) : (
          <View style={styles.amountContainer}>
            <Text style={styles.amountText}>
              {amount > 0 ? formatCurrency(amount) : 'Free'}
            </Text>
          </View>
        )}
      </View>

      {/* Meta Row: Date, Service Type, Provider */}
      <View style={styles.cardMetaRow}>
        <View style={styles.metaItem}>
          <MaterialIcons name="event" size={12} color={SereneColors.onSurfaceVariant} />
          <Text style={styles.metaText}>{formatDate(record.serviceDate)}</Text>
        </View>

        {record.serviceProvider && (
          <View style={styles.metaItem}>
            <MaterialIcons name="storefront" size={12} color={SereneColors.onSurfaceVariant} />
            <Text style={styles.metaText} numberOfLines={1}>
              {record.serviceProvider}
            </Text>
          </View>
        )}
      </View>

      {/* Badges Row: Coverage, Post Warranty/Guarantee */}
      <View style={styles.badgesRow}>
        <View
          style={[
            styles.badge,
            record.warrantyCovered === 'yes'
              ? styles.badgeCovered
              : record.warrantyCovered === 'no'
              ? styles.badgeNotCovered
              : styles.badgeNeutral,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              record.warrantyCovered === 'yes'
                ? styles.badgeTextCovered
                : record.warrantyCovered === 'no'
                ? styles.badgeTextNotCovered
                : styles.badgeTextNeutral,
            ]}
          >
            {record.warrantyCovered === 'yes'
              ? 'Warranty Covered'
              : record.warrantyCovered === 'no'
              ? 'Paid Out-of-Pocket'
              : 'Standard Service'}
          </Text>
        </View>

        {hasWarranty && record.postServiceWarrantyUntil && (
          <View style={[styles.badge, styles.badgeWarranty]}>
            <MaterialIcons name="verified-user" size={11} color="#047857" />
            <Text style={[styles.badgeText, { color: '#047857' }]}>
              Warranty: {formatDate(record.postServiceWarrantyUntil)}
            </Text>
          </View>
        )}

        {hasGuarantee && record.postServiceGuaranteeUntil && (
          <View style={[styles.badge, styles.badgeGuarantee]}>
            <MaterialIcons name="security" size={11} color="#B45309" />
            <Text style={[styles.badgeText, { color: '#B45309' }]}>
              Guarantee: {formatDate(record.postServiceGuaranteeUntil)}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

export default function ServicesScreen() {
  const user = useAuthStore((s) => s.user);
  const items = useItemStore((s) => s.items);
  const maintenanceRecords = useItemStore((s) => s.maintenanceRecords);
  const deleteMaintenanceRecord = useItemStore((s) => s.deleteMaintenanceRecord);

  // Current authenticated user's records only
  const userRecords = useMemo(() => {
    const currentUserId = user?.id;
    return maintenanceRecords.filter((m) => {
      if (currentUserId && m.userId && m.userId !== currentUserId) return false;
      return true;
    });
  }, [maintenanceRecords, user?.id]);

  // Lookup map for linked item names
  const itemMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, item.name);
    }
    return map;
  }, [items]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSort, setSelectedSort] = useState<ServiceSortOption>('newest_service');
  const [filters, setFilters] = useState<ServiceFilterState>(DEFAULT_SERVICE_FILTERS);

  const [showSortModal, setShowSortModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Selection Mode State for batch deletion
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      return () => {
        setIsSelectionMode(false);
        setSelectedIds(new Set());
      };
    }, [])
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCardPress = useCallback(
    (record: MaintenanceRecord) => {
      if (isSelectionMode) {
        toggleSelect(record.id);
      } else {
        router.push(`/service/${record.id}` as any);
      }
    },
    [isSelectionMode, toggleSelect]
  );

  const handleCardLongPress = useCallback(
    (record: MaintenanceRecord) => {
      if (!isSelectionMode) {
        setIsSelectionMode(true);
        setSelectedIds(new Set([record.id]));
      } else {
        toggleSelect(record.id);
      }
    },
    [isSelectionMode, toggleSelect]
  );

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    Alert.alert(
      'Delete Service Records',
      `Are you sure you want to permanently delete ${selectedIds.size} service record${
        selectedIds.size === 1 ? '' : 's'
      }? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const id of selectedIds) {
              await deleteMaintenanceRecord(id);
            }
            setIsSelectionMode(false);
            setSelectedIds(new Set());
          },
        },
      ]
    );
  };

  // Pipeline: search -> filter -> sort
  const filteredAndSortedRecords = useMemo(() => {
    let result = [...userRecords];

    // 1. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((m) => {
        const itemName = m.itemId ? (itemMap.get(m.itemId) || '').toLowerCase() : '';
        const title = (m.title || '').toLowerCase();
        const type = (m.serviceType || '').toLowerCase();
        const provider = (m.serviceProvider || '').toLowerCase();
        const problem = (m.problemDescription || m.description || '').toLowerCase();
        const work = (m.workPerformed || '').toLowerCase();
        const parts = (m.partsReplaced || '').toLowerCase();
        const notes = (m.notes || m.technicianNotes || '').toLowerCase();

        return (
          title.includes(q) ||
          itemName.includes(q) ||
          type.includes(q) ||
          provider.includes(q) ||
          problem.includes(q) ||
          work.includes(q) ||
          parts.includes(q) ||
          notes.includes(q)
        );
      });
    }

    // 2. Filters
    if (filters.serviceType !== 'all') {
      result = result.filter((m) => m.serviceType === filters.serviceType);
    }

    if (filters.coverage !== 'all') {
      result = result.filter((m) => m.warrantyCovered === filters.coverage);
    }

    if (filters.postCoverage !== 'all') {
      if (filters.postCoverage === 'has_warranty') {
        result = result.filter((m) => Boolean(m.postServiceWarranty && m.postServiceWarrantyUntil));
      } else if (filters.postCoverage === 'has_guarantee') {
        result = result.filter((m) => Boolean(m.postServiceGuarantee && m.postServiceGuaranteeUntil));
      } else if (filters.postCoverage === 'none') {
        result = result.filter((m) => !m.postServiceWarranty && !m.postServiceGuarantee);
      }
    }

    if (filters.linkedItem !== 'all') {
      if (filters.linkedItem === 'linked') {
        result = result.filter((m) => Boolean(m.itemId));
      } else if (filters.linkedItem === 'unlinked') {
        result = result.filter((m) => !m.itemId);
      }
    }

    if (filters.dateRange !== 'all') {
      const now = Date.now();
      result = result.filter((m) => {
        if (!m.serviceDate) return false;
        const d = new Date(m.serviceDate).getTime();
        if (isNaN(d)) return false;
        const ageDays = (now - d) / 86400000;
        if (filters.dateRange === '30d') return ageDays <= 30;
        if (filters.dateRange === '3m') return ageDays <= 90;
        if (filters.dateRange === '6m') return ageDays <= 180;
        if (filters.dateRange === '12m') return ageDays <= 365;
        if (filters.dateRange === 'older_1y') return ageDays > 365;
        return true;
      });
    }

    // 3. Sort
    result.sort((a, b) => {
      switch (selectedSort) {
        case 'newest_service': {
          const dateA = a.serviceDate || '';
          const dateB = b.serviceDate || '';
          return dateB.localeCompare(dateA);
        }
        case 'oldest_service': {
          const dateA = a.serviceDate || '';
          const dateB = b.serviceDate || '';
          return dateA.localeCompare(dateB);
        }
        case 'recently_added': {
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        }
        case 'oldest_added': {
          return (a.createdAt || '').localeCompare(b.createdAt || '');
        }
        case 'amount_desc': {
          const costA = a.amountPaid != null ? a.amountPaid : (a.cost ?? 0);
          const costB = b.amountPaid != null ? b.amountPaid : (b.cost ?? 0);
          return costB - costA;
        }
        case 'amount_asc': {
          const costA = a.amountPaid != null ? a.amountPaid : (a.cost ?? 0);
          const costB = b.amountPaid != null ? b.amountPaid : (b.cost ?? 0);
          return costA - costB;
        }
        case 'item_asc': {
          const nameA = (a.itemId ? itemMap.get(a.itemId) : a.title) || '';
          const nameB = (b.itemId ? itemMap.get(b.itemId) : b.title) || '';
          return nameA.localeCompare(nameB);
        }
        case 'item_desc': {
          const nameA = (a.itemId ? itemMap.get(a.itemId) : a.title) || '';
          const nameB = (b.itemId ? itemMap.get(b.itemId) : b.title) || '';
          return nameB.localeCompare(nameA);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [userRecords, searchQuery, filters, selectedSort, itemMap]);

  const activeFiltersCount = useMemo(() => countActiveServiceFilters(filters), [filters]);

  const renderItem = useCallback(
    ({ item }: { item: MaintenanceRecord }) => {
      const linkedName = item.itemId ? itemMap.get(item.itemId) : null;
      const isSelected = selectedIds.has(item.id);
      return (
        <ServiceCard
          record={item}
          linkedItemName={linkedName}
          isSelected={isSelected}
          isSelectionMode={isSelectionMode}
          onPress={() => handleCardPress(item)}
          onLongPress={() => handleCardLongPress(item)}
        />
      );
    },
    [itemMap, selectedIds, isSelectionMode, handleCardPress, handleCardLongPress]
  );

  return (
    <View style={styles.container}>
      <Header
        title={isSelectionMode ? `${selectedIds.size} Selected` : 'Service & Repair'}
        showBack={false}
        rightAction={
          isSelectionMode ? (
            <View style={styles.selectionActions}>
              <TouchableOpacity
                onPress={handleDeleteSelected}
                disabled={selectedIds.size === 0}
                style={[styles.deleteBtn, selectedIds.size === 0 && { opacity: 0.4 }]}
              >
                <MaterialIcons name="delete" size={20} color="#DC2626" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setIsSelectionMode(false);
                  setSelectedIds(new Set());
                }}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => router.push('/service/add' as any)}
              style={styles.addBtn}
              activeOpacity={0.85}
            >
              <MaterialIcons name="add" size={18} color="#FFFFFF" />
              <Text style={styles.addBtnText}>Add Service</Text>
            </TouchableOpacity>
          )
        }
      />

      {/* Search and Filter Controls */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchInputWrap}>
          <MaterialIcons name="search" size={20} color={SereneColors.onSurfaceVariant} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search repairs, items, providers..."
            placeholderTextColor={SereneColors.onSurfaceVariant}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7}>
              <MaterialIcons name="cancel" size={18} color={SereneColors.onSurfaceVariant} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.filterBtn, activeFiltersCount > 0 && styles.filterBtnActive]}
          onPress={() => setShowFilterModal(true)}
          activeOpacity={0.8}
        >
          <MaterialIcons
            name="tune"
            size={18}
            color={activeFiltersCount > 0 ? '#FFFFFF' : SereneColors.onSurfaceVariant}
          />
          {activeFiltersCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFiltersCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => setShowSortModal(true)}
          activeOpacity={0.8}
        >
          <MaterialIcons name="sort" size={20} color={SereneColors.onSurfaceVariant} />
        </TouchableOpacity>
      </View>

      {/* Subheader: Results count & Sort label */}
      <View style={styles.subHeader}>
        <Text style={styles.resultsCount}>
          {filteredAndSortedRecords.length} record{filteredAndSortedRecords.length === 1 ? '' : 's'}
        </Text>
        <TouchableOpacity
          style={styles.activeSortTextWrap}
          onPress={() => setShowSortModal(true)}
        >
          <Text style={styles.activeSortText}>{SERVICE_SORT_LABELS[selectedSort]}</Text>
          <MaterialIcons name="arrow-drop-down" size={16} color={SereneColors.onSurfaceVariant} />
        </TouchableOpacity>
      </View>

      {/* Main List */}
      <FlatList
        data={filteredAndSortedRecords}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons name="build" size={36} color={SereneColors.primary} />
            </View>
            <Text style={styles.emptyTitle}>
              {userRecords.length === 0
                ? 'No Service Records Yet'
                : 'No Matching Service Records'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {userRecords.length === 0
                ? 'Track repairs, maintenance, and part replacements for your purchased items.'
                : 'Try adjusting your search terms or clearing your active filters.'}
            </Text>
            {userRecords.length === 0 ? (
              <TouchableOpacity
                style={styles.emptyAddBtn}
                onPress={() => router.push('/service/add' as any)}
                activeOpacity={0.85}
              >
                <MaterialIcons name="add" size={18} color="#FFFFFF" />
                <Text style={styles.emptyAddBtnText}>Add First Service</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.emptyResetBtn}
                onPress={() => {
                  setSearchQuery('');
                  setFilters(DEFAULT_SERVICE_FILTERS);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyResetText}>Reset Search & Filters</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <ServiceSortModal
        visible={showSortModal}
        selectedSort={selectedSort}
        onSelectSort={setSelectedSort}
        onClose={() => setShowSortModal(false)}
      />

      <ServiceFilterModal
        visible={showFilterModal}
        filters={filters}
        onApplyFilters={setFilters}
        onClose={() => setShowFilterModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SereneColors.surface,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: SereneColors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deleteBtn: {
    padding: 6,
  },
  cancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: SereneColors.primary,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,80,134,0.06)',
  },
  searchInputWrap: {
    flex: 1,
    height: 40,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: SereneColors.onSurface,
    paddingVertical: 0,
  },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterBtnActive: {
    backgroundColor: SereneColors.primary,
  },
  filterBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  filterBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sortBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  resultsCount: {
    fontSize: 12,
    fontWeight: '600',
    color: SereneColors.onSurfaceVariant,
  },
  activeSortTextWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  activeSortText: {
    fontSize: 11,
    fontWeight: '600',
    color: SereneColors.onSurfaceVariant,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 10,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(17,80,134,0.08)',
    gap: 10,
    shadowColor: '#115086',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(17,80,134,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderContent: {
    flex: 1,
    gap: 2,
  },
  recordTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  linkedItemText: {
    fontSize: 12,
    fontWeight: '500',
    color: SereneColors.onSurfaceVariant,
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 14,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: SereneColors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,80,134,0.05)',
    paddingTop: 8,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 11,
    color: SereneColors.onSurfaceVariant,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeCovered: {
    backgroundColor: '#ECFDF5',
  },
  badgeNotCovered: {
    backgroundColor: '#F1F5F9',
  },
  badgeNeutral: {
    backgroundColor: '#F8FAFC',
  },
  badgeWarranty: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  badgeGuarantee: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  badgeTextCovered: {
    color: '#047857',
  },
  badgeTextNotCovered: {
    color: '#64748B',
  },
  badgeTextNeutral: {
    color: '#475569',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(17,80,134,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: SereneColors.onSurface,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: SereneColors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: SereneColors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  emptyAddBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyResetBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: SereneColors.primary,
    marginTop: 8,
  },
  emptyResetText: {
    fontSize: 13,
    fontWeight: '600',
    color: SereneColors.primary,
  },
});
