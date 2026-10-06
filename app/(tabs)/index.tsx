
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Header } from '../../src/components/ui/Header';
import { PriorityCard } from '../../src/components/ui/PriorityCard';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { useAuthStore } from '../../src/store/authStore';
import { getDeadlineStatus } from '../../src/utils/warranty';
import { formatDate } from '../../src/utils/currency';
import * as ImagePicker from 'expo-image-picker';
import { AddReceiptModal } from '../../src/components/scanner/AddReceiptModal';
import {
  setActiveReceiptSession,
  clearActiveReceiptSession,
} from '../../src/store/receiptSessionStore';
import { stabilizeReceiptImage } from '../../src/services/receiptFileService';
import { ItemWithOwnerContext, RecentlyAddedEntry } from '../../src/types';
import { hideSplashScreen } from '../../src/utils/splashCoordinator';

const INITIAL_BATCH_SIZE = 4;
const LOAD_MORE_BATCH_SIZE = 4;

export default function VaultDashboardScreen() {
  const user = useAuthStore((s) => s.user);
  const items = useItemStore((s) => s.items);
  const documents = useItemStore((s) => s.documents);
  const warranties = useItemStore((s) => s.warranties);
  const getItemById = useItemStore((s) => s.getItemById);
  const getVaultMetrics = useItemStore((s) => s.getVaultMetrics);
  const getRecentlyAdded = useItemStore((s) => s.getRecentlyAdded);

  const metrics = useMemo(() => getVaultMetrics(), [items, documents, warranties, getVaultMetrics]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const userName = user?.fullName ? user.fullName.split(' ')[0] : 'there';

  // Urgent Priority Attention items (returns ending soon <= 7d or warranties expiring soon <= 30d)
  const priorityItems = useMemo(() => {
    const list: Array<{
      id: string;
      itemId: string;
      type: 'warranty' | 'return';
      urgentLabel: string;
      title: string;
      subtitle: string;
      footerLabel: string;
      actionText: string;
    }> = [];

    for (const item of items) {
      const warrantyForThisItem = warranties.find((w) => w.itemId === item.id);
      const status = getDeadlineStatus(item, warrantyForThisItem?.endDate);

      if (status.hasUpcomingReturn) {
        list.push({
          id: `urgent-return-${item.id}`,
          itemId: item.id,
          type: 'return',
          urgentLabel:
            status.returnDaysRemaining === 0
              ? 'Return Ends Today!'
              : `Return Ends in ${status.returnDaysRemaining}d`,
          title: item.name,
          subtitle: `Return deadline: ${formatDate(item.returnUntil)}`,
          footerLabel: item.merchant ? `Purchased at ${item.merchant}` : 'Return Window',
          actionText: 'View Item',
        });
      }

      if (status.hasUpcomingWarranty) {
        list.push({
          id: `urgent-war-${warrantyForThisItem?.id || item.id}`,
          itemId: item.id,
          type: 'warranty',
          urgentLabel:
            status.warrantyDaysRemaining === 0
              ? 'Warranty Expires Today'
              : `Expires in ${status.warrantyDaysRemaining}d`,
          title: item.name,
          subtitle: `${warrantyForThisItem?.provider || 'Warranty'} Expiry`,
          footerLabel: `Purchased ${formatDate(item.purchaseDate)}`,
          actionText: 'View Item',
        });
      }
    }

    return list;
  }, [items, warranties]);

  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Mixed Feed (Purchased Items + Documents) strictly sorted by createdAt DESC
  const allRecentlyAdded = useMemo(() => {
    return getRecentlyAdded(100);
  }, [items, documents, getRecentlyAdded, user?.id]);

  const newestEntryId = allRecentlyAdded[0]?.id;
  const totalEntryCount = allRecentlyAdded.length;
  const prevNewestIdRef = useRef(newestEntryId);
  const prevCountRef = useRef(totalEntryCount);

  useEffect(() => {
    if (newestEntryId !== prevNewestIdRef.current || totalEntryCount > prevCountRef.current) {
      // New record added: Reset to initial batch size so newly saved record appears at position 1
      setVisibleCount(INITIAL_BATCH_SIZE);
      prevNewestIdRef.current = newestEntryId;
      prevCountRef.current = totalEntryCount;
    } else if (totalEntryCount < prevCountRef.current) {
      prevCountRef.current = totalEntryCount;
      setVisibleCount((prev) => Math.max(INITIAL_BATCH_SIZE, Math.min(prev, totalEntryCount)));
    }
  }, [newestEntryId, totalEntryCount]);

  const hasMoreItems = visibleCount < allRecentlyAdded.length;
  const isLoadingMoreRef = useRef(false);

  const handleLoadMore = useCallback(() => {
    if (isLoadingMoreRef.current || !hasMoreItems) return;

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + LOAD_MORE_BATCH_SIZE, allRecentlyAdded.length));
      setIsLoadingMore(false);
      isLoadingMoreRef.current = false;
    }, 250);
  }, [hasMoreItems, allRecentlyAdded.length]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 80;
    const isCloseToBottom =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;

    if (contentOffset.y > 0 && isCloseToBottom && hasMoreItems && !isLoadingMoreRef.current) {
      handleLoadMore();
    }
  };

  const visibleEntries = useMemo((): RecentlyAddedEntry[] => {
    return allRecentlyAdded.slice(0, visibleCount);
  }, [allRecentlyAdded, visibleCount]);

  const [showAddReceiptModal, setShowAddReceiptModal] = useState(false);

  const handleScanItem = () => {
    setShowAddReceiptModal(true);
  };

  const handleModalChooseGallery = async () => {
    setShowAddReceiptModal(false);
    try {
      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          'Permission Required',
          'Camera roll permission is required to choose receipt photos.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        console.log('[ReceiptSelection]\nSelected URI:', asset.uri);
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = asset.fileName || `Receipt_${dateStr}.jpg`;

        const stabilized = await stabilizeReceiptImage(asset.uri, asset.base64);
        setActiveReceiptSession({
          uri: stabilized.uri,
          source: 'gallery',
          fileName,
          base64: asset.base64 || null,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
        });

        router.push({
          pathname: '/scan-receipt',
          params: {
            mode: 'gallery',
            autoProcess: 'true',
            initialUri: stabilized.uri,
            initialName: encodeURIComponent(fileName),
          },
        } as any);
      }
    } catch (err) {
      console.warn('Gallery pick error:', err);
    }
  };

  useEffect(() => {
    console.log('[StartupAuth] authenticated route ready');
  }, []);

  const handleLayout = useCallback(() => {
    hideSplashScreen('vault');
  }, []);

  return (
    <View className="flex-1 bg-serene-surface" onLayout={handleLayout}>
      <Header title="Keepr" />

      <ScrollView
        contentContainerClassName="px-4 pb-12 gap-5"
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={32}
      >
        <View className="pt-2 gap-1">
          <Text className="text-2xl font-bold text-serene-on-surface tracking-tight">
            {greeting}, {userName}
          </Text>
          <Text className="text-xs text-serene-on-surface-variant">
            Your purchase & warranty vault
          </Text>
        </View>

        <View className="flex-row gap-2">
          <TouchableOpacity
            className="flex-1 bg-serene-surface-container-lowest px-1.5 py-2.5 rounded-serene-xl border border-serene-subtle-border shadow-sm min-h-[100px] justify-between"
            activeOpacity={0.85}
            onPress={() => router.push('/(tabs)/items')}
          >
            <View className="w-7 h-7 rounded-serene-md bg-serene-surface-container-highest items-center justify-center mb-1">
              <MaterialIcons name="inventory-2" size={15} color={SereneColors.primary} />
            </View>
            <Text className="text-xl font-bold text-serene-on-surface">
              {metrics.totalItems}
            </Text>
            <View className="h-[28px] justify-start mt-0.5">
              <Text className="text-[10px] font-medium text-serene-on-surface-variant leading-[13px]" numberOfLines={2}>
                Items
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-1 bg-serene-surface-container-lowest px-1.5 py-2.5 rounded-serene-xl border border-serene-subtle-border shadow-sm min-h-[100px] justify-between"
            activeOpacity={0.85}
            onPress={() => router.push('/(tabs)/documents')}
          >
            <View className="w-7 h-7 rounded-serene-md bg-blue-50 items-center justify-center mb-1">
              <MaterialIcons name="description" size={15} color={SereneColors.primary} />
            </View>
            <Text className="text-xl font-bold text-serene-on-surface">
              {metrics.totalDocuments}
            </Text>
            <View className="h-[28px] justify-start mt-0.5">
              <Text className="text-[10px] font-medium text-serene-on-surface-variant leading-[13px]" numberOfLines={2}>
                Documents
              </Text>
            </View>
          </TouchableOpacity>

          <View className="flex-1 bg-serene-surface-container-lowest px-1.5 py-2.5 rounded-serene-xl border border-serene-subtle-border shadow-sm min-h-[100px] justify-between">
            <View className="w-7 h-7 rounded-serene-md bg-rose-50 items-center justify-center mb-1">
              <MaterialIcons name="verified-user" size={15} color={SereneColors.error} />
            </View>
            <Text className="text-xl font-bold text-serene-on-surface">
              {metrics.warrantiesEndingSoon}
            </Text>
            <View className="h-[28px] justify-start mt-0.5">
              <Text className="text-[10px] font-medium text-serene-on-surface-variant leading-[13px]" numberOfLines={2}>
                Warranty{'\n'}ending
              </Text>
            </View>
          </View>

          <View className="flex-1 bg-serene-surface-container-lowest px-1.5 py-2.5 rounded-serene-xl border border-serene-subtle-border shadow-sm min-h-[100px] justify-between">
            <View className="w-7 h-7 rounded-serene-md bg-amber-50 items-center justify-center mb-1">
              <MaterialIcons name="assignment-return" size={15} color="#D97706" />
            </View>
            <Text className="text-xl font-bold text-serene-on-surface">
              {metrics.returnsEndingSoon}
            </Text>
            <View className="h-[28px] justify-start mt-0.5">
              <Text className="text-[10px] font-medium text-serene-on-surface-variant leading-[13px]" numberOfLines={2}>
                Return{'\n'}ending
              </Text>
            </View>
          </View>
        </View>

        <View className="gap-1.5">
          <View className="flex-row items-center gap-2.5">
            <TouchableOpacity
              className="flex-1 h-12 bg-serene-primary rounded-serene-lg flex-row items-center justify-center gap-2 shadow-sm"
              activeOpacity={0.88}
              onPress={() => router.push('/(tabs)/add')}
            >
              <MaterialIcons name="add" size={20} color="#FFFFFF" />
              <Text className="text-[14px] font-semibold text-white">Add Item</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-1 h-12 bg-serene-surface-container-lowest rounded-serene-lg border border-serene-subtle-border flex-row items-center justify-center gap-2"
              activeOpacity={0.88}
              onPress={handleScanItem}
            >
              <MaterialIcons
                name="document-scanner"
                size={18}
                color={SereneColors.primary}
              />
              <Text className="text-[14px] font-semibold text-serene-primary">
                Scan Item
              </Text>
            </TouchableOpacity>
          </View>
          <Text className="text-[11px] text-center text-serene-on-surface-variant/80">
            Scan a receipt, bill, document, warranty or service record.
          </Text>
        </View>

        {priorityItems.length > 0 && (
          <View className="gap-2.5">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <View className="w-[7px] h-[7px] rounded-full bg-amber-500" />
                <Text className="text-[16px] font-bold text-serene-on-surface">
                  Needs Attention
                </Text>
              </View>
              <Text className="text-[11px] text-serene-on-surface-variant">
                {priorityItems.length} action item{priorityItems.length === 1 ? '' : 's'}
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="pr-4"
            >
              {priorityItems.map((item) => (
                <PriorityCard
                  key={item.id}
                  type={item.type}
                  urgentLabel={item.urgentLabel}
                  title={item.title}
                  subtitle={item.subtitle}
                  footerLabel={item.footerLabel}
                  actionText={item.actionText}
                  onCardPress={() => router.push(`/item/${item.itemId}`)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        <View className="gap-2.5 mb-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-[16px] font-bold text-serene-on-surface">
              Recently Added
            </Text>
            {allRecentlyAdded.length > 0 && (
              <View className="flex-row items-center gap-2">
                <TouchableOpacity
                  className="flex-row items-center gap-0.5"
                  onPress={() => router.push('/(tabs)/items')}
                >
                  <Text className="text-xs font-semibold text-serene-primary">
                    Items ({metrics.totalItems})
                  </Text>
                </TouchableOpacity>
                <Text className="text-xs text-serene-outline">·</Text>
                <TouchableOpacity
                  className="flex-row items-center gap-0.5"
                  onPress={() => router.push('/(tabs)/documents')}
                >
                  <Text className="text-xs font-semibold text-serene-primary">
                    Docs ({metrics.totalDocuments})
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View className="bg-serene-surface-container-lowest border border-serene-subtle-border rounded-serene-xl overflow-hidden shadow-sm">
            {visibleEntries.length > 0 ? (
              <View>
                {visibleEntries.map((entry, index) => {
                  const isItem = entry.entityType === 'PURCHASED_ITEM';
                  return (
                    <TouchableOpacity
                      key={`${entry.entityType}-${entry.id}`}
                      activeOpacity={0.7}
                      onPress={() => {
                        if (isItem) {
                          router.push(`/item/${entry.id}` as any);
                        } else {
                          router.push(`/document/${entry.id}` as any);
                        }
                      }}
                      className={`p-3.5 flex-row items-center gap-3 ${
                        index < visibleEntries.length - 1 ? 'border-b border-serene-subtle-border/60' : ''
                      }`}
                    >
                      <View className="relative">
                        {entry.thumbnail ? (
                          <Image
                            source={{ uri: entry.thumbnail }}
                            className="w-12 h-12 rounded-serene-md bg-serene-surface-container-high"
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            className={`w-12 h-12 rounded-serene-md items-center justify-center ${
                              isItem ? 'bg-indigo-50' : 'bg-emerald-50'
                            }`}
                          >
                            <MaterialIcons
                              name={isItem ? 'inventory-2' : 'description'}
                              size={22}
                              color={isItem ? '#4F46E5' : '#059669'}
                            />
                          </View>
                        )}
                      </View>

                      <View className="flex-1 justify-center">
                        <View className="flex-row items-center gap-1.5 mb-1 flex-wrap">
                          <View
                            className={`px-1.5 py-0.5 rounded-full flex-row items-center gap-1 ${
                              isItem
                                ? 'bg-indigo-50 border border-indigo-200'
                                : 'bg-emerald-50 border border-emerald-200'
                            }`}
                          >
                            <MaterialIcons
                              name={isItem ? 'shopping-bag' : 'description'}
                              size={10}
                              color={isItem ? '#4338CA' : '#047857'}
                            />
                            <Text
                              className={`text-[9px] font-bold uppercase tracking-wider ${
                                isItem ? 'text-indigo-700' : 'text-emerald-700'
                              }`}
                            >
                              {isItem ? 'Purchased Item' : 'Document'}
                            </Text>
                          </View>

                          {entry.item?.isMultiProduct && entry.item?.products && entry.item.products.length > 1 && (
                            <View className="px-1.5 py-0.5 rounded-full bg-indigo-100 border border-indigo-200">
                              <Text className="text-[9px] font-bold text-indigo-800">
                                {entry.item.products.length} Products
                              </Text>
                            </View>
                          )}

                          {entry.relatedItemName && (
                            <View className="px-1.5 py-0.5 rounded-full bg-sky-50 border border-sky-200 flex-row items-center gap-0.5">
                              <MaterialIcons name="link" size={9} color="#0284C7" />
                              <Text className="text-[9px] font-medium text-sky-800" numberOfLines={1}>
                                {entry.relatedItemName}
                              </Text>
                            </View>
                          )}
                        </View>

                        <Text className="text-[14px] font-bold text-serene-on-surface" numberOfLines={1}>
                          {entry.title}
                        </Text>

                        <View className="flex-row items-center gap-1 mt-0.5">
                          {entry.subtitle ? (
                            <Text
                              className="text-[12px] font-medium text-serene-on-surface-variant"
                              numberOfLines={1}
                            >
                              {entry.subtitle}
                            </Text>
                          ) : null}
                          {entry.date ? (
                            <>
                              <Text className="text-[11px] text-serene-outline">·</Text>
                              <Text className="text-[11px] text-serene-outline">{formatDate(entry.date)}</Text>
                            </>
                          ) : null}
                        </View>
                      </View>

                      <MaterialIcons name="chevron-right" size={18} color={SereneColors.onSurfaceVariant} />
                    </TouchableOpacity>
                  );
                })}

                {isLoadingMore && (
                  <View className="flex-row items-center justify-center py-2.5 gap-2 border-t border-serene-subtle-border/40">
                    <ActivityIndicator size="small" color={SereneColors.primary} />
                    <Text className="text-[12px] font-medium text-serene-on-surface-variant">
                      Loading more...
                    </Text>
                  </View>
                )}

                {!hasMoreItems && allRecentlyAdded.length > INITIAL_BATCH_SIZE && (
                  <View className="items-center justify-center py-2 border-t border-serene-subtle-border/40">
                    <Text className="text-[11px] font-medium text-serene-outline">
                      You're all caught up
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <View className="items-center justify-center py-7 px-4">
                <View className="w-11 h-11 rounded-full bg-[rgba(17,80,134,0.08)] items-center justify-center mb-2.5">
                  <MaterialIcons name="inventory-2" size={22} color={SereneColors.primary} />
                </View>
                <Text className="text-[15px] font-bold text-serene-on-surface text-center">
                  No records yet
                </Text>
                <Text className="text-[12px] text-serene-on-surface-variant text-center mt-0.5 mb-3.5 max-w-[240px]">
                  Add your first purchase or document to see it here.
                </Text>
                <TouchableOpacity
                  className="flex-row items-center gap-1.5 bg-serene-primary px-4 py-2 rounded-serene-lg shadow-sm"
                  activeOpacity={0.85}
                  onPress={() => router.push('/(tabs)/add')}
                >
                  <MaterialIcons name="add" size={16} color="#FFFFFF" />
                  <Text className="text-[13px] font-semibold text-white">Add Item</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <AddReceiptModal
        visible={showAddReceiptModal}
        onClose={() => setShowAddReceiptModal(false)}
        onChooseFromGallery={handleModalChooseGallery}
      />
    </View>
  );
}
