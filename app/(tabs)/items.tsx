
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  Share,
  BackHandler,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Header } from '../../src/components/ui/Header';
import { ItemCard } from '../../src/components/ui/ItemCard';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { useAuthStore } from '../../src/store/authStore';
import { formatCompactCurrency, formatDate, formatCurrency } from '../../src/utils/currency';
import { DEFAULT_CATEGORIES } from '../../src/constants/categories';
import {
  getWarrantyStatus,
  getRemainingWarrantyDays,
  getRemainingReturnDays,
  getCategoryCapabilities,
} from '../../src/utils/warranty';
import {
  SortModal,
  SortOption,
} from '../../src/components/items/SortModal';
import {
  FilterModal,
  FilterState,
  DEFAULT_FILTERS,
  countActiveFilters,
} from '../../src/components/items/FilterModal';
import { ItemWithOwnerContext, Item } from '../../src/types';
import { NotificationService } from '../../src/services/notifications';

const SORT_LABELS: Record<SortOption, string> = {
  recent_added: 'Recently Added',
  purchase_desc: 'Recent Purchase',
  purchase_asc: 'Oldest Purchase',
  price_desc: 'Price: High to Low',
  price_asc: 'Price: Low to High',
  name_asc: 'Name: A to Z',
  name_desc: 'Name: Z to A',
};

interface SelectableItemCardProps {
  item: ItemWithOwnerContext;
  isSelected: boolean;
  isSelectionMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const SelectableItemCard = React.memo(function SelectableItemCard({
  item,
  isSelected,
  isSelectionMode,
  onPress,
  onLongPress,
}: SelectableItemCardProps) {
  return (
    <ItemCard
      item={item}
      isSelected={isSelected}
      isSelectionMode={isSelectionMode}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
    />
  );
});

export default function ItemsCatalogScreen() {
  const user = useAuthStore((s) => s.user);
  const items = useItemStore((s) => s.items);
  const getItemById = useItemStore((s) => s.getItemById);
  const deleteItem = useItemStore((s) => s.deleteItem);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSort, setSelectedSort] = useState<SortOption>('recent_added');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [showSortModal, setShowSortModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);

  // ── Multi-Select State (ID-based, never index-based) ─────────────────────
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of DEFAULT_CATEGORIES) {
      map.set(cat.id, cat.name);
    }
    return map;
  }, []);

  const activeCanonicalItems = useMemo((): Item[] => {
    const currentUserId = user?.id;
    return (items || []).filter((item) => {
      if (!item || !item.id || (item.status as string) === 'deleted' || (item.status as string) === 'disposed') return false;
      if (currentUserId && item.userId && item.userId !== currentUserId) return false;
      return true;
    });
  }, [items, user?.id]);

  const collectionSummary = useMemo(() => {
    const count = activeCanonicalItems.length;
    let sumValue = 0;
    for (const item of activeCanonicalItems) {
      sumValue += Number(item.purchasePrice) || 0;
    }
    return {
      count,
      totalValue: sumValue,
      displayText: `${count} ${count === 1 ? 'item' : 'items'} · ${formatCompactCurrency(sumValue)}`,
    };
  }, [activeCanonicalItems]);

  const availableProductTypes = useMemo(() => {
    const set = new Set<string>();
    for (const item of activeCanonicalItems) {
      if (item.productType && item.productType.trim()) set.add(item.productType.trim());
    }
    return Array.from(set).sort();
  }, [activeCanonicalItems]);

  const displayItems = useMemo((): ItemWithOwnerContext[] => {
    const query = searchQuery.trim().toLowerCase();
    const queryTokens = query ? query.split(/\s+/).filter(Boolean) : [];
    const now = new Date().getTime();

    const searched = activeCanonicalItems.filter((item) => {
      if (queryTokens.length === 0) return true;
      const catName = ((item.categoryId && categoryMap.get(item.categoryId)) || '').toLowerCase();
      const searchableText = [
        item.name, item.brand, item.model, item.productType,
        item.categoryId, catName, item.merchant, item.sellerAddress,
        item.invoiceNumber, item.serialNumber, item.imei,
        item.registrationNumber, item.notes,
      ].filter(Boolean).map((f) => String(f).toLowerCase().trim()).join(' ');
      return queryTokens.every((token) => searchableText.includes(token));
    });

    const filtered = searched.filter((item) => {
      if (filters.categoryId !== 'all' && item.categoryId !== filters.categoryId) return false;

      if (filters.priceRange !== 'all') {
        const price = Number(item.purchasePrice) || 0;
        if (filters.priceRange === 'under_5k' && price >= 5000) return false;
        if (filters.priceRange === '5k_25k' && (price < 5000 || price > 25000)) return false;
        if (filters.priceRange === '25k_100k' && (price < 25000 || price > 100000)) return false;
        if (filters.priceRange === 'above_100k' && price <= 100000) return false;
      }

      if (filters.purchaseDateRange !== 'all') {
        if (!item.purchaseDate) return false;
        const purchaseTime = new Date(item.purchaseDate).getTime();
        if (isNaN(purchaseTime)) return false;
        const diffDays = (now - purchaseTime) / (1000 * 60 * 60 * 24);
        if (filters.purchaseDateRange === '30d' && (diffDays < 0 || diffDays > 30)) return false;
        if (filters.purchaseDateRange === '3m' && (diffDays < 0 || diffDays > 90)) return false;
        if (filters.purchaseDateRange === '6m' && (diffDays < 0 || diffDays > 180)) return false;
        if (filters.purchaseDateRange === '12m' && (diffDays < 0 || diffDays > 365)) return false;
        if (filters.purchaseDateRange === 'older_1y' && diffDays <= 365) return false;
      }

      if (filters.warrantyStatus !== 'all') {
        const effectiveEnd = item.warrantyUntil;
        const caps = getCategoryCapabilities(item.categoryId || item.category, item.productType, Boolean(effectiveEnd));
        if (filters.warrantyStatus === 'none') {
          if (!caps.warrantySupported || effectiveEnd) return false;
        } else {
          if (!caps.warrantySupported || !effectiveEnd) return false;
          const status = getWarrantyStatus(effectiveEnd);
          if (filters.warrantyStatus === 'active' && status !== 'active' && status !== 'expiring_soon') return false;
          if (filters.warrantyStatus === 'expiring' && status !== 'expiring_soon') return false;
          if (filters.warrantyStatus === 'expired' && status !== 'expired') return false;
        }
      }

      if (filters.returnStatus !== 'all') {
        if (!item.returnUntil) {
          if (filters.returnStatus !== 'none') return false;
        } else {
          if (filters.returnStatus === 'none') return false;
          const remainingDays = getRemainingReturnDays(item.returnUntil);
          if (filters.returnStatus === 'available' && (remainingDays === undefined || remainingDays < 0)) return false;
          if (filters.returnStatus === 'ending_soon' && (remainingDays === undefined || remainingDays < 0 || remainingDays > 3)) return false;
          if (filters.returnStatus === 'expired' && (remainingDays === undefined || remainingDays >= 0)) return false;
        }
      }

      if (filters.productType && filters.productType !== 'all') {
        if (!item.productType || item.productType.trim().toLowerCase() !== filters.productType.toLowerCase()) return false;
      }

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (selectedSort === 'recent_added') {
        return (new Date(b.createdAt || 0).getTime() || 0) - (new Date(a.createdAt || 0).getTime() || 0);
      }
      if (selectedSort === 'purchase_desc') {
        return (new Date(b.purchaseDate || 0).getTime() || 0) - (new Date(a.purchaseDate || 0).getTime() || 0);
      }
      if (selectedSort === 'purchase_asc') {
        return (new Date(a.purchaseDate || 0).getTime() || 0) - (new Date(b.purchaseDate || 0).getTime() || 0);
      }
      if (selectedSort === 'price_desc') return (Number(b.purchasePrice) || 0) - (Number(a.purchasePrice) || 0);
      if (selectedSort === 'price_asc') return (Number(a.purchasePrice) || 0) - (Number(b.purchasePrice) || 0);
      if (selectedSort === 'name_asc') return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
      if (selectedSort === 'name_desc') return (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' });
      return 0;
    });

    return sorted
      .map((item) => getItemById(item.id))
      .filter((i): i is ItemWithOwnerContext => Boolean(i));
  }, [activeCanonicalItems, searchQuery, filters, selectedSort, getItemById, categoryMap]);

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  const modalFilters = useMemo(
    () => ({ ...filters, sortBy: selectedSort }),
    [filters, selectedSort]
  );

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedItemIds(new Set());
  }, []);

  const enterSelectionMode = useCallback((firstItemId: string) => {
    setIsSelectionMode(true);
    setSelectedItemIds(new Set([firstItemId]));
  }, []);

  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (isSelectionMode && selectedItemIds.size > 0) {
      const validIds = new Set(activeCanonicalItems.map((i) => i.id));
      const pruned = new Set([...selectedItemIds].filter((id) => validIds.has(id)));
      if (pruned.size !== selectedItemIds.size) {
        setSelectedItemIds(pruned);
        if (pruned.size === 0) exitSelectionMode();
      }
    }
  }, [activeCanonicalItems]);



  // ── Android Back Button: exit selection first ──────────────────────────────
  useFocusEffect(
    useCallback(() => {
      const handler = BackHandler.addEventListener('hardwareBackPress', () => {
        if (isSelectionMode) {
          exitSelectionMode();
          return true; // consume the event
        }
        return false; // let default navigation happen
      });
      return () => handler.remove();
    }, [isSelectionMode, exitSelectionMode])
  );


  const lastLongPressRef = useRef<number>(0);

  const handleItemPress = useCallback((item: ItemWithOwnerContext) => {
    // Prevent accidental onPress execution immediately after long press release on Android
    if (Date.now() - lastLongPressRef.current < 500) {
      return;
    }
    if (isSelectionMode) {
      toggleItemSelection(item.id);
    } else {
      router.push(`/item/${item.id}`);
    }
  }, [isSelectionMode, toggleItemSelection]);

  const handleItemLongPress = useCallback((item: ItemWithOwnerContext) => {
    lastLongPressRef.current = Date.now();
    if (!isSelectionMode) {
      enterSelectionMode(item.id);
    } else {
      toggleItemSelection(item.id);
    }
  }, [isSelectionMode, enterSelectionMode, toggleItemSelection]);

  const displayedIds = useMemo(() => new Set(displayItems.map((i) => i.id)), [displayItems]);
  const allDisplayedSelected = displayItems.length > 0 && displayItems.every((i) => selectedItemIds.has(i.id));

  const handleSelectAllToggle = useCallback(() => {
    if (allDisplayedSelected) {
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        for (const id of displayedIds) next.delete(id);
        return next;
      });
    } else {
      // Select all displayed items (union with any already selected outside current view)
      setSelectedItemIds((prev) => new Set([...prev, ...displayedIds]));
    }
  }, [allDisplayedSelected, displayedIds]);

  const buildShareText = useCallback((ids: Set<string>): string => {
    const selectedItems = activeCanonicalItems.filter((i) => ids.has(i.id));
    if (selectedItems.length === 0) return '';

    const lines: string[] = ['📦 Keepr Purchase Details\n'];

    selectedItems.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.name}`);
      if (item.brand) lines.push(`   Brand: ${item.brand}${item.model ? ` ${item.model}` : ''}`);
      lines.push(`   Price: ${formatCurrency(item.purchasePrice, item.currency || 'INR')}`);
      if (item.quantity && item.quantity > 1) lines.push(`   Quantity: ${item.quantity}`);
      if (item.purchaseDate) lines.push(`   Purchased: ${formatDate(item.purchaseDate)}`);
      const catName = (item.categoryId && categoryMap.get(item.categoryId)) || item.productType || '';
      if (catName) lines.push(`   Category: ${catName}`);
      if (item.merchant) lines.push(`   Store: ${item.merchant}`);
      if (item.invoiceNumber) lines.push(`   Invoice: ${item.invoiceNumber}`);
      if (item.serialNumber) lines.push(`   Serial: ${item.serialNumber}`);
      if (item.warrantyUntil) lines.push(`   Warranty until: ${formatDate(item.warrantyUntil)}`);
      if (item.returnUntil) lines.push(`   Return by: ${formatDate(item.returnUntil)}`);
      if (item.notes) lines.push(`   Notes: ${item.notes}`);
      lines.push('');
    });

    return lines.join('\n');
  }, [activeCanonicalItems, categoryMap]);

  const handleShare = useCallback(async () => {
    if (selectedItemIds.size === 0) return;
    const shareText = buildShareText(selectedItemIds);
    if (!shareText) return;

    try {
      await Share.share({
        message: shareText,
        title: selectedItemIds.size === 1 ? 'Purchase Details' : `${selectedItemIds.size} Purchase Records`,
      });
      // Keep selection mode active after share so user can take further actions
    } catch (err: any) {
      if (err?.message !== 'User did not share') {
        Alert.alert("Couldn't Share", "Couldn't share the selected items. Please try again.");
      }
    }
  }, [selectedItemIds, buildShareText]);

  const handleDelete = useCallback(() => {
    if (selectedItemIds.size === 0) return;

    const count = selectedItemIds.size;
    const title = 'Delete permanently?';
    const message = count === 1
      ? 'This item will be permanently deleted and cannot be recovered.'
      : 'These items will be permanently deleted and cannot be recovered.';

    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            const idsToDelete = [...selectedItemIds];
            for (const itemId of idsToDelete) {
              try {
                await NotificationService.cancelItemReminders(itemId);
              } catch {
              }
              try {
                await deleteItem(itemId);
              } catch (err: any) {
                console.warn('[ItemsCatalog] Failed to delete item:', itemId, err?.message);
              }
            }
            setSelectedItemIds((prev) => {
              const next = new Set(prev);
              for (const id of idsToDelete) next.delete(id);
              return next;
            });
            exitSelectionMode();
          },
        },
      ]
    );
  }, [selectedItemIds, deleteItem, exitSelectionMode]);

  const handleApplyFilters = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    if (newFilters.sortBy) setSelectedSort(newFilters.sortBy);
  }, []);

  const handleSelectSort = useCallback((sort: SortOption) => {
    setSelectedSort(sort);
    setFilters((prev) => ({ ...prev, sortBy: sort }));
  }, []);

  const handleClearFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const handleClearAllSearchAndFilters = useCallback(() => {
    setSearchQuery('');
    setFilters(DEFAULT_FILTERS);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ItemWithOwnerContext }) => (
      <SelectableItemCard
        item={item}
        isSelected={selectedItemIds.has(item.id)}
        isSelectionMode={isSelectionMode}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemLongPress(item)}
      />
    ),
    [selectedItemIds, isSelectionMode, handleItemPress, handleItemLongPress]
  );

  const keyExtractor = useCallback((item: ItemWithOwnerContext) => item.id, []);

  const listHeader = useMemo(() => (
    <View style={{ gap: 14, paddingTop: 8, paddingBottom: 4 }}>
      {!isSelectionMode && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text className="text-[22px] font-bold text-serene-on-surface tracking-tight">
              My Collection
            </Text>
            <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">
              Archived purchase logs
            </Text>
          </View>
          <View className="flex-row items-center gap-1 bg-serene-tertiary-fixed px-3 py-1.5 rounded-full">
            <MaterialIcons name="verified-user" size={15} color={SereneColors.tertiary} />
            <Text className="text-[12px] font-semibold text-serene-on-tertiary-fixed">
              {collectionSummary.displayText}
            </Text>
          </View>
        </View>
      )}

      <View className="flex-row items-center bg-serene-surface-container-lowest rounded-serene-lg border border-serene-subtle-border h-11 px-3">
        <MaterialIcons name="search" size={20} color={SereneColors.outline} style={{ marginRight: 8 }} />
        <TextInput
          className="flex-1 text-[13px] text-serene-on-surface"
          placeholder="Search items, brands, models or stores"
          placeholderTextColor={SereneColors.outline}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')} className="p-1" accessibilityLabel="Clear search">
            <MaterialIcons name="close" size={18} color={SereneColors.outline} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View className="flex-row items-center justify-between gap-2.5">
        <TouchableOpacity
          className="flex-1 flex-row items-center justify-between bg-serene-surface-container-lowest border border-serene-subtle-border px-3 py-2 rounded-serene-lg"
          onPress={() => setShowSortModal(true)}
          activeOpacity={0.8}
          accessibilityLabel="Sort options"
        >
          <View className="flex-row items-center gap-1.5 flex-1 pr-1">
            <MaterialIcons name="sort" size={17} color={SereneColors.primary} />
            <Text className="text-[12px] font-medium text-serene-on-surface" numberOfLines={1}>
              Sorted by:{' '}
              <Text className="font-bold text-serene-primary">{SORT_LABELS[selectedSort]}</Text>
            </Text>
          </View>
          <MaterialIcons name="expand-more" size={18} color={SereneColors.onSurfaceVariant} />
        </TouchableOpacity>

        <TouchableOpacity
          className={`flex-row items-center gap-1.5 px-3.5 py-2 rounded-serene-lg border ${
            activeFilterCount > 0
              ? 'bg-serene-surface-container-highest border-serene-primary'
              : 'bg-serene-surface-container-lowest border-serene-subtle-border'
          }`}
          onPress={() => setShowFilterModal(true)}
          activeOpacity={0.8}
          accessibilityLabel="Filter options"
        >
          <MaterialIcons
            name="tune"
            size={18}
            color={activeFilterCount > 0 ? SereneColors.primary : SereneColors.onSurfaceVariant}
          />
          <Text className={`text-[12px] ${activeFilterCount > 0 ? 'font-bold text-serene-primary' : 'font-semibold text-serene-on-surface'}`}>
            {activeFilterCount > 0 ? `Filter · ${activeFilterCount}` : 'Filters'}
          </Text>
        </TouchableOpacity>
      </View>

      {(activeFilterCount > 0 || searchQuery) && (
        <View className="flex-row items-center justify-between bg-serene-surface-container-low px-3 py-2 rounded-serene-md border border-serene-subtle-border">
          <View className="flex-row items-center gap-1.5 flex-1 mr-2">
            <MaterialIcons name="filter-alt" size={14} color={SereneColors.primary} />
            <Text className="text-[11px] text-serene-on-surface flex-1" numberOfLines={1}>
              {searchQuery ? `"${searchQuery}"` : ''}
              {filters.categoryId !== 'all' ? `${searchQuery ? ' · ' : ''}${categoryMap.get(filters.categoryId) || filters.categoryId}` : ''}
              {filters.priceRange !== 'all' ? ' · Price' : ''}
              {filters.warrantyStatus !== 'all' ? ` · Warranty: ${filters.warrantyStatus}` : ''}
              {filters.productType && filters.productType !== 'all' ? ` · ${filters.productType}` : ''}
              {` (${displayItems.length} matching)`}
            </Text>
          </View>
          <TouchableOpacity onPress={handleClearAllSearchAndFilters}>
            <Text className="text-[11px] font-bold text-serene-primary">Clear All</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  ), [
    isSelectionMode, collectionSummary.displayText, searchQuery,
    selectedSort, activeFilterCount, filters, categoryMap, displayItems.length,
    handleClearAllSearchAndFilters,
  ]);

  const listEmpty = useMemo(() => (
    activeCanonicalItems.length === 0 ? (
      <EmptyState
        title="Your collection is empty"
        description="Add the things you buy to keep warranty, return dates, and receipts in one place."
        actionText="Add your first item"
        onActionPress={() => router.push('/(tabs)/add')}
      />
    ) : (
      <EmptyState
        icon="search-off"
        title="No items found"
        description="Try a different name, brand, model, or store."
        actionText="Clear Search & Filters"
        onActionPress={handleClearAllSearchAndFilters}
      />
    )
  ), [activeCanonicalItems.length, handleClearAllSearchAndFilters]);

  return (
    <View className="flex-1 bg-serene-surface">
      {isSelectionMode ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: 52,
            paddingBottom: 12,
            backgroundColor: '#fff',
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(17,80,134,0.08)',
          }}
        >
          <TouchableOpacity
            onPress={exitSelectionMode}
            style={{ padding: 4, marginRight: 10 }}
            accessibilityLabel="Exit selection mode"
          >
            <MaterialIcons name="close" size={22} color={SereneColors.primary} />
          </TouchableOpacity>

          <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: SereneColors.onSurface }}>
            {selectedItemIds.size} selected
          </Text>

          <TouchableOpacity
            onPress={handleSelectAllToggle}
            style={{ marginRight: 6, paddingVertical: 4, paddingHorizontal: 8 }}
            accessibilityLabel={allDisplayedSelected ? 'Deselect all' : 'Select all'}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: SereneColors.primary }}>
              {allDisplayedSelected ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Header title="Keepr" />
      )}

      <FlatList
        data={displayItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={selectedItemIds}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        windowSize={10}
        maxToRenderPerBatch={20}
        initialNumToRender={15}
        removeClippedSubviews={false}
      />

      {isSelectionMode && (
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            paddingHorizontal: 16,
            paddingVertical: 12,
            paddingBottom: Platform.OS === 'ios' ? 28 : 16,
            backgroundColor: '#fff',
            borderTopWidth: 1,
            borderTopColor: 'rgba(17,80,134,0.10)',
          }}
        >
          <TouchableOpacity
            onPress={handleShare}
            disabled={selectedItemIds.size === 0}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: 'rgba(17,80,134,0.08)',
              borderWidth: 1,
              borderColor: 'rgba(17,80,134,0.18)',
              opacity: selectedItemIds.size === 0 ? 0.45 : 1,
            }}
            accessibilityLabel={`Share ${selectedItemIds.size} selected items`}
          >
            <MaterialIcons name="share" size={18} color={SereneColors.primary} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: SereneColors.primary }}>
              Share
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDelete}
            disabled={selectedItemIds.size === 0}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: 'rgba(186,26,26,0.08)',
              borderWidth: 1,
              borderColor: 'rgba(186,26,26,0.20)',
              opacity: selectedItemIds.size === 0 ? 0.45 : 1,
            }}
            accessibilityLabel={`Delete ${selectedItemIds.size} selected items`}
          >
            <MaterialIcons name="delete-outline" size={18} color={SereneColors.error} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: SereneColors.error }}>
              {selectedItemIds.size > 0 ? `Delete (${selectedItemIds.size})` : 'Delete'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <SortModal
        visible={showSortModal}
        selectedSort={selectedSort}
        onSelectSort={handleSelectSort}
        onClose={() => setShowSortModal(false)}
      />

      <FilterModal
        visible={showFilterModal}
        filters={modalFilters}
        availableProductTypes={availableProductTypes}
        onApplyFilters={handleApplyFilters}
        onClose={() => setShowFilterModal(false)}
      />
    </View>
  );
}
