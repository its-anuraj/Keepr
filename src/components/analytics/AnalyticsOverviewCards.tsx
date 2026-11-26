import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors, SereneRadius } from '../../constants/theme';
import { SpendingOverview } from '../../services/analyticsService';
import { formatCurrency, formatCompactCurrency } from '../../utils/currency';

export interface AnalyticsOverviewCardsProps {
  overview: SpendingOverview;
}

export const AnalyticsOverviewCards: React.FC<AnalyticsOverviewCardsProps> = ({ overview }) => {
  return (
    <View style={styles.container}>
      {/* 2x2 Responsive Card Grid */}
      <View style={styles.row}>
        {/* Card 1: Total Purchase Value */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconContainer, { backgroundColor: '#E0F2FE' }]}>
              <MaterialIcons name="account-balance-wallet" size={18} color="#0284C7" />
            </View>
            <Text style={styles.cardLabel} numberOfLines={1}>Total Value</Text>
          </View>
          <Text style={styles.cardValue} numberOfLines={1}>
            {formatCurrency(overview.totalPurchaseValue)}
          </Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {overview.dateRangeLabel}
          </Text>
        </View>

        {/* Card 2: Total Spending */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconContainer, { backgroundColor: '#EDE9FE' }]}>
              <MaterialIcons name="payments" size={18} color="#7C3AED" />
            </View>
            <Text style={styles.cardLabel} numberOfLines={1}>Net Spending</Text>
          </View>
          <Text style={[styles.cardValue, { color: SereneColors.primary }]} numberOfLines={1}>
            {formatCurrency(overview.totalSpending)}
          </Text>
          <View style={styles.savingsRow}>
            {overview.totalDiscounts > 0 ? (
              <Text style={styles.savingsText} numberOfLines={1}>
                Saved {formatCompactCurrency(overview.totalDiscounts)} off
              </Text>
            ) : (
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                Actual amount paid
              </Text>
            )}
          </View>
        </View>
      </View>

      <View style={styles.row}>
        {/* Card 3: GST Paid */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconContainer, { backgroundColor: '#DCFCE7' }]}>
              <MaterialIcons name="receipt-long" size={18} color="#16A34A" />
            </View>
            <Text style={styles.cardLabel} numberOfLines={1}>GST Paid</Text>
          </View>
          <Text style={styles.cardValue} numberOfLines={1}>
            {formatCurrency(overview.totalGstPaid)}
          </Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {overview.itemsWithGstCount > 0
              ? `From ${overview.itemsWithGstCount} purchases`
              : 'No GST data'}
          </Text>
        </View>

        {/* Card 4: Total Purchases */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconContainer, { backgroundColor: '#FEF3C7' }]}>
              <MaterialIcons name="shopping-bag" size={18} color="#D97706" />
            </View>
            <Text style={styles.cardLabel} numberOfLines={1}>Total Purchases</Text>
          </View>
          <Text style={styles.cardValue} numberOfLines={1}>
            {overview.purchaseCount}
          </Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {overview.purchaseCount > 0
              ? `Avg ${formatCompactCurrency(overview.averagePurchaseValue)}/item`
              : '0 records'}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    backgroundColor: SereneColors.surfaceContainerLowest,
    borderRadius: SereneRadius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: SereneColors.subtleBorder,
    shadowColor: '#115086',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
    justifyContent: 'space-between',
    minHeight: 104,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: SereneRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: SereneColors.onSurfaceVariant,
    flex: 1,
  },
  cardValue: {
    fontSize: 18,
    fontWeight: '700',
    color: SereneColors.onSurface,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 11,
    color: SereneColors.outline,
    fontWeight: '500',
  },
  savingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  savingsText: {
    fontSize: 11,
    color: SereneColors.success,
    fontWeight: '600',
  },
});
