import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors, SereneRadius } from '../../constants/theme';
import { GstAnalyticsSummary } from '../../services/analyticsService';
import { formatCurrency, formatCompactCurrency } from '../../utils/currency';

export interface GstAnalyticsCardProps {
  gstSummary: GstAnalyticsSummary;
}

export const GstAnalyticsCard: React.FC<GstAnalyticsCardProps> = ({ gstSummary }) => {
  const [showTaxRules, setShowTaxRules] = useState(false);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="receipt-long" size={18} color="#16A34A" />
          </View>
          <View>
            <Text style={styles.cardTitle}>GST & Tax Analytics</Text>
            <Text style={styles.cardSubtitle}>Verified indirect tax expenditures</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.infoBtn}
          onPress={() => setShowTaxRules(!showTaxRules)}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name={showTaxRules ? 'close' : 'info-outline'}
            size={18}
            color={SereneColors.outline}
          />
        </TouchableOpacity>
      </View>

      {/* Tax Documentation Explanation Note (Toggleable) */}
      {showTaxRules && (
        <View style={styles.taxRulesBox}>
          <Text style={styles.taxRulesTitle}>How Keepr calculates your GST:</Text>
          <Text style={styles.taxRulesText}>
            • Component Priority: Prefers explicit CGST, SGST, and IGST values extracted from receipt invoices.
          </Text>
          <Text style={styles.taxRulesText}>
            • Slabs: Where verified rates are provided (e.g. 18%), applies standard Indian MRP tax formulas without assuming unrecorded items.
          </Text>
          <Text style={styles.taxRulesText}>
            • Zero Assumption: Unrecorded tax info is never assumed to be ₹0, ensuring complete financial transparency.
          </Text>
        </View>
      )}

      {/* Main GST Paid Metric */}
      <View style={styles.mainGstBox}>
        <View>
          <Text style={styles.gstLabel}>TOTAL GST PAID</Text>
          <Text style={styles.gstAmount}>{formatCurrency(gstSummary.totalGstPaid)}</Text>
        </View>

        <View style={styles.coverageBadge}>
          <Text style={styles.coverageText}>
            {gstSummary.itemsWithGstCount} of {gstSummary.itemsTotalCount} verified
          </Text>
        </View>
      </View>

      {/* Component Breakdown: CGST, SGST, IGST */}
      <View style={styles.componentsRow}>
        <View style={styles.componentTile}>
          <Text style={styles.componentLabel}>CGST</Text>
          <Text style={styles.componentValue}>
            {formatCurrency(gstSummary.cgstTotal)}
          </Text>
        </View>

        <View style={styles.componentDivider} />

        <View style={styles.componentTile}>
          <Text style={styles.componentLabel}>SGST</Text>
          <Text style={styles.componentValue}>
            {formatCurrency(gstSummary.sgstTotal)}
          </Text>
        </View>

        <View style={styles.componentDivider} />

        <View style={styles.componentTile}>
          <Text style={styles.componentLabel}>IGST</Text>
          <Text style={styles.componentValue}>
            {formatCurrency(gstSummary.igstTotal)}
          </Text>
        </View>
      </View>

      {/* Category-wise GST Breakdown */}
      {gstSummary.gstByCategory.length > 0 && (
        <View style={styles.categoryGstSection}>
          <Text style={styles.categoryGstTitle}>GST by Asset Category</Text>
          <View style={styles.categoryGstList}>
            {gstSummary.gstByCategory.slice(0, 4).map((cat) => (
              <View key={cat.categoryId} style={styles.categoryGstRow}>
                <View style={styles.catNameRow}>
                  <View style={[styles.colorDot, { backgroundColor: cat.color }]} />
                  <Text style={styles.catName}>{cat.categoryName}</Text>
                  <Text style={styles.catPct}>{cat.percentage}%</Text>
                </View>
                <Text style={styles.catAmt}>{formatCurrency(cat.gstAmount)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  cardSubtitle: {
    fontSize: 12,
    color: SereneColors.outline,
    marginTop: 1,
  },
  infoBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxRulesBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: SereneRadius.md,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  taxRulesTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: SereneColors.onSurface,
    marginBottom: 2,
  },
  taxRulesText: {
    fontSize: 11,
    color: SereneColors.onSurfaceVariant,
    lineHeight: 16,
  },
  mainGstBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDF4',
    borderRadius: SereneRadius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginBottom: 12,
  },
  gstLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
    letterSpacing: 0.8,
  },
  gstAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#166534',
    marginTop: 2,
  },
  coverageBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: SereneRadius.full,
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  coverageText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#15803D',
  },
  componentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: SereneRadius.md,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  componentTile: {
    flex: 1,
    alignItems: 'center',
  },
  componentLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: SereneColors.outline,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  componentValue: {
    fontSize: 13,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  componentDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  categoryGstSection: {
    gap: 8,
  },
  categoryGstTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: SereneColors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryGstList: {
    gap: 6,
  },
  categoryGstRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  catNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  catName: {
    fontSize: 12,
    color: SereneColors.onSurface,
    fontWeight: '500',
  },
  catPct: {
    fontSize: 11,
    color: SereneColors.outline,
  },
  catAmt: {
    fontSize: 12,
    fontWeight: '600',
    color: SereneColors.onSurface,
  },
});
