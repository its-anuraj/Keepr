import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  FlatList,
  StyleSheet,
  Pressable,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SereneColors, SereneRadius } from '../../constants/theme';
import { Item } from '../../types';
import { formatCurrency, formatDate } from '../../utils/currency';
import { getCategoryNameFromId, normalizeToDbCategoryId } from '../../constants/categories';
import { CATEGORY_COLORS } from '../../services/analyticsService';
import { useResolvedItemImage } from '../../hooks/useResolvedImage';

export interface TopPurchasesListProps {
  topPurchases: Item[];
  allPurchases: Item[];
}

const PurchaseRow: React.FC<{ item: Item; rank?: number }> = ({ item, rank }) => {
  const { resolvedUri } = useResolvedItemImage(item);
  const rawCat = item.categoryId || (typeof item.category === 'string' ? item.category : item.category?.id);
  const catId = normalizeToDbCategoryId(rawCat) || 'other';
  const catName = getCategoryNameFromId(catId) || 'Other';
  const catColor = CATEGORY_COLORS[catId] || CATEGORY_COLORS.other;

  return (
    <TouchableOpacity
      style={styles.purchaseRow}
      onPress={() => router.push(`/item/${item.id}`)}
      activeOpacity={0.7}
    >
      {/* Rank indicator if provided */}
      {rank !== undefined && (
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>#{rank}</Text>
        </View>
      )}

      {/* Item Thumbnail */}
      <View style={styles.thumbnailContainer}>
        {resolvedUri ? (
          <Image
            source={{ uri: resolvedUri }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumbnailPlaceholder, { backgroundColor: `${catColor}15` }]}>
            <MaterialIcons name="inventory-2" size={18} color={catColor} />
          </View>
        )}
      </View>

      {/* Item Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.categoryPill, { backgroundColor: `${catColor}15` }]}>
            <Text style={[styles.categoryText, { color: catColor }]}>{catName}</Text>
          </View>
          {item.merchant ? (
            <Text style={styles.merchantText} numberOfLines={1}>
              • {item.merchant}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Price & Date */}
      <View style={styles.priceContainer}>
        <Text style={styles.priceText}>{formatCurrency(item.purchasePrice)}</Text>
        <Text style={styles.dateText}>
          {formatDate(item.purchaseDate || item.createdAt, 'short')}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export const TopPurchasesList: React.FC<TopPurchasesListProps> = ({
  topPurchases,
  allPurchases,
}) => {
  const insets = useSafeAreaInsets();
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.cardTitle}>Highest Purchases</Text>
          <Text style={styles.cardSubtitle}>Top assets by capital expenditure</Text>
        </View>

        {allPurchases.length > topPurchases.length && (
          <TouchableOpacity
            style={styles.viewAllBtn}
            onPress={() => setModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.viewAllText}>View All ({allPurchases.length})</Text>
            <MaterialIcons name="chevron-right" size={16} color={SereneColors.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Top Purchases List */}
      {topPurchases.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="shopping-bag" size={36} color={SereneColors.outlineVariant} />
          <Text style={styles.emptyText}>No purchases found in this period</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {topPurchases.map((item, index) => (
            <PurchaseRow key={item.id} item={item} rank={index + 1} />
          ))}
        </View>
      )}

      {/* "View All" Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top || 16 }]}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>All Purchases</Text>
              <Text style={styles.modalSubtitle}>
                {allPurchases.length} records sorted by highest purchase price
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setModalVisible(false)}
              activeOpacity={0.7}
            >
              <MaterialIcons name="close" size={22} color={SereneColors.onSurface} />
            </TouchableOpacity>
          </View>

          {/* All Purchases List */}
          <FlatList
            data={allPurchases}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => <PurchaseRow item={item} rank={index + 1} />}
            contentContainerStyle={styles.modalListContent}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderRadius: SereneRadius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
    shadowColor: '#115086',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  cardSubtitle: {
    fontSize: 12,
    color: SereneColors.outline,
    marginTop: 2,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: SereneColors.primary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: SereneColors.outline,
  },
  list: {
    gap: 8,
  },
  purchaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: SereneRadius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  rankBadge: {
    width: 22,
    alignItems: 'center',
  },
  rankText: {
    fontSize: 12,
    fontWeight: '700',
    color: SereneColors.outline,
  },
  thumbnailContainer: {
    width: 40,
    height: 40,
    borderRadius: SereneRadius.sm,
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContainer: {
    flex: 1,
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700',
    color: SereneColors.onSurface,
    marginBottom: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '600',
  },
  merchantText: {
    fontSize: 11,
    color: SereneColors.outline,
    flexShrink: 1,
  },
  priceContainer: {
    alignItems: 'flex-end',
  },
  priceText: {
    fontSize: 14,
    fontWeight: '700',
    color: SereneColors.primary,
  },
  dateText: {
    fontSize: 10,
    color: SereneColors.outline,
    marginTop: 2,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: SereneColors.surface,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: SereneColors.subtleBorder,
    backgroundColor: SereneColors.surfaceContainerLowest,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  modalSubtitle: {
    fontSize: 12,
    color: SereneColors.outline,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalListContent: {
    padding: 16,
    gap: 8,
  },
});
