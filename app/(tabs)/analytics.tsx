import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Header } from '../../src/components/ui/Header';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import {
  AnalyticsDateFilter,
  AnalyticsFilterState,
  CustomDateRange,
  filterItemsForAnalytics,
  calculateSpendingOverview,
  calculateSpendingTrends,
  calculateCategorySpending,
  calculateTopPurchases,
  calculateGstAnalytics,
} from '../../src/services/analyticsService';
import { AnalyticsFilterBar } from '../../src/components/analytics/AnalyticsFilterBar';
import { AnalyticsOverviewCards } from '../../src/components/analytics/AnalyticsOverviewCards';
import { SpendingTrendsChart } from '../../src/components/analytics/SpendingTrendsChart';
import { CategorySpendingChart } from '../../src/components/analytics/CategorySpendingChart';
import { TopPurchasesList } from '../../src/components/analytics/TopPurchasesList';
import { GstAnalyticsCard } from '../../src/components/analytics/GstAnalyticsCard';

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const items = useItemStore((s) => s.items);
  const isLoading = useItemStore((s) => s.isLoading);
  const hydrateFromCloud = useItemStore((s) => s.hydrateFromCloud);

  const [refreshing, setRefreshing] = useState(false);
  const [trendsMode, setTrendsMode] = useState<'monthly' | 'yearly'>('monthly');

  // Filter State
  const [dateFilter, setDateFilter] = useState<AnalyticsDateFilter>('all_time');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [customRange, setCustomRange] = useState<CustomDateRange | undefined>(undefined);

  const filterState: AnalyticsFilterState = useMemo(
    () => ({
      dateFilter,
      customRange,
      categoryId,
      currency: 'INR',
    }),
    [dateFilter, customRange, categoryId]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await hydrateFromCloud();
    } catch (e) {
      console.warn('[AnalyticsScreen] Pull-to-refresh error:', e);
    } finally {
      setRefreshing(false);
    }
  }, [hydrateFromCloud]);

  const handleResetFilters = useCallback(() => {
    setDateFilter('all_time');
    setCategoryId('all');
    setCustomRange(undefined);
  }, []);

  // Filtered dataset
  const filteredItems = useMemo(
    () => filterItemsForAnalytics(items, filterState),
    [items, filterState]
  );

  // Computations
  const overview = useMemo(
    () => calculateSpendingOverview(filteredItems, filterState),
    [filteredItems, filterState]
  );

  const trendPoints = useMemo(
    () => calculateSpendingTrends(filteredItems, trendsMode),
    [filteredItems, trendsMode]
  );

  const categorySpending = useMemo(
    () => calculateCategorySpending(filteredItems),
    [filteredItems]
  );

  const topPurchases = useMemo(
    () => calculateTopPurchases(filteredItems, 5),
    [filteredItems]
  );

  const allRankedPurchases = useMemo(
    () => calculateTopPurchases(filteredItems, 1000),
    [filteredItems]
  );

  const gstSummary = useMemo(
    () => calculateGstAnalytics(filteredItems),
    [filteredItems]
  );

  // Global Empty State (User has zero recorded purchases)
  const isGlobalEmpty = items.length === 0;

  // Filter-specific Empty State (Filter produced 0 items, but vault has purchases)
  const isFilterEmpty = !isGlobalEmpty && filteredItems.length === 0;

  return (
    <View style={styles.screen}>
      <Header
        title="Analytics"
        rightAction={
          <TouchableOpacity onPress={onRefresh} style={{ padding: 4 }} activeOpacity={0.7}>
            <MaterialIcons name="refresh" size={22} color={SereneColors.primary} />
          </TouchableOpacity>
        }
      />

      {/* Global Filter Bar */}
      {!isGlobalEmpty && (
        <AnalyticsFilterBar
          selectedFilter={dateFilter}
          onSelectFilter={setDateFilter}
          selectedCategoryId={categoryId}
          onSelectCategory={setCategoryId}
          customRange={customRange}
          onSetCustomRange={setCustomRange}
          onReset={handleResetFilters}
        />
      )}

      {/* Main Content Area */}
      {isLoading && items.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={SereneColors.primary} />
          <Text style={styles.loadingText}>Analyzing purchase portfolio...</Text>
        </View>
      ) : isGlobalEmpty ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={SereneColors.primary}
            />
          }
        >
          <EmptyState
            icon="analytics"
            title="No Purchases Recorded"
            description="Add your first item or scan a receipt to generate comprehensive spending and tax analytics."
            actionText="Add First Item"
            onActionPress={() => router.push('/(tabs)/add')}
          />
        </ScrollView>
      ) : isFilterEmpty ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={SereneColors.primary}
            />
          }
        >
          <EmptyState
            icon="filter-list"
            title="No Matching Purchases"
            description="No purchases match your active date range or category filters."
            actionText="Reset Filters"
            onActionPress={handleResetFilters}
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 80 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={SereneColors.primary}
            />
          }
        >
          {/* Section A: Spending Overview Cards */}
          <AnalyticsOverviewCards overview={overview} />

          {/* Section B: Spending Trends Chart */}
          <SpendingTrendsChart
            trendPoints={trendPoints}
            mode={trendsMode}
            onToggleMode={setTrendsMode}
          />

          {/* Section C: Category-wise Spending */}
          <CategorySpendingChart
            categories={categorySpending}
            onSelectCategory={(catId) => setCategoryId(catId)}
          />

          {/* Section D: Most Expensive Purchases */}
          <TopPurchasesList
            topPurchases={topPurchases}
            allPurchases={allRankedPurchases}
          />

          {/* Section E: GST & Indirect Tax Analytics */}
          <GstAnalyticsCard gstSummary={gstSummary} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SereneColors.surface,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 16,
  },
  emptyScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: SereneColors.onSurfaceVariant,
    fontWeight: '500',
  },
});
