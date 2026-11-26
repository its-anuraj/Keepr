import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { G, Circle, Path, Text as SvgText } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors, SereneRadius } from '../../constants/theme';
import { CategorySpendingItem } from '../../services/analyticsService';
import { formatCurrency, formatCompactCurrency } from '../../utils/currency';

export interface CategorySpendingChartProps {
  categories: CategorySpendingItem[];
  onSelectCategory?: (categoryId: string) => void;
}

export const CategorySpendingChart: React.FC<CategorySpendingChartProps> = ({
  categories,
  onSelectCategory,
}) => {
  const [highlightedCategory, setHighlightedCategory] = useState<string | null>(null);

  const totalSpending = categories.reduce((sum, c) => sum + c.totalSpending, 0);
  const size = 180;
  const strokeWidth = 26;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Compute stroke offsets for donut segments
  let accumulatedPercent = 0;
  const segments = categories.map((cat) => {
    const strokeDasharray = `${(cat.percentage / 100) * circumference} ${circumference}`;
    const strokeDashoffset = -((accumulatedPercent / 100) * circumference);
    accumulatedPercent += cat.percentage;

    return {
      ...cat,
      strokeDasharray,
      strokeDashoffset,
    };
  });

  const activeItem = highlightedCategory
    ? categories.find((c) => c.categoryId === highlightedCategory)
    : categories[0] || null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.cardTitle}>Category Spending</Text>
        <Text style={styles.cardSubtitle}>Portfolio allocation breakdown</Text>
      </View>

      {categories.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="pie-chart" size={40} color={SereneColors.outlineVariant} />
          <Text style={styles.emptyText}>No category purchases in this period</Text>
        </View>
      ) : (
        <>
          {/* Donut Chart with Center Display */}
          <View style={styles.donutWrapper}>
            <Svg width={size} height={size}>
              {/* Background track circle */}
              <Circle
                cx={center}
                cy={center}
                r={radius}
                stroke="#F1F5F9"
                strokeWidth={strokeWidth}
                fill="none"
              />

              <G rotation="-90" origin={`${center}, ${center}`}>
                {segments.map((seg) => {
                  const isHighlighted = highlightedCategory === seg.categoryId;
                  return (
                    <Circle
                      key={seg.categoryId}
                      cx={center}
                      cy={center}
                      r={radius}
                      stroke={seg.color}
                      strokeWidth={isHighlighted ? strokeWidth + 4 : strokeWidth}
                      strokeDasharray={seg.strokeDasharray}
                      strokeDashoffset={seg.strokeDashoffset}
                      strokeLinecap="butt"
                      fill="none"
                      onPress={() => {
                        const next = highlightedCategory === seg.categoryId ? null : seg.categoryId;
                        setHighlightedCategory(next);
                      }}
                    />
                  );
                })}
              </G>
            </Svg>

            {/* Donut Center Content */}
            <View style={styles.centerOverlay} pointerEvents="none">
              <Text style={styles.centerTitle} numberOfLines={1}>
                {activeItem ? activeItem.categoryName : 'Total'}
              </Text>
              <Text style={styles.centerValue} numberOfLines={1}>
                {formatCompactCurrency(activeItem ? activeItem.totalSpending : totalSpending)}
              </Text>
              <Text style={styles.centerPct} numberOfLines={1}>
                {activeItem ? `${activeItem.percentage}%` : '100%'}
              </Text>
            </View>
          </View>

          {/* Ranked Category List */}
          <View style={styles.categoryList}>
            {categories.map((cat, index) => {
              const isSelected = highlightedCategory === cat.categoryId;

              return (
                <TouchableOpacity
                  key={cat.categoryId}
                  style={[styles.categoryRow, isSelected && styles.categoryRowSelected]}
                  onPress={() => {
                    const next = isSelected ? null : cat.categoryId;
                    setHighlightedCategory(next);
                    if (onSelectCategory) {
                      onSelectCategory(cat.categoryId);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowTop}>
                    <View style={styles.rowLeft}>
                      <View style={[styles.categoryIconWrap, { backgroundColor: `${cat.color}15` }]}>
                        <MaterialIcons
                          name={(cat.icon as any) || 'inventory-2'}
                          size={16}
                          color={cat.color}
                        />
                      </View>
                      <View>
                        <Text style={styles.categoryName}>{cat.categoryName}</Text>
                        <Text style={styles.itemCountText}>
                          {cat.itemCount} {cat.itemCount === 1 ? 'purchase' : 'purchases'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.rowRight}>
                      <Text style={styles.categorySpending}>
                        {formatCurrency(cat.totalSpending)}
                      </Text>
                      <Text style={styles.categoryPercentage}>
                        {cat.percentage}%
                      </Text>
                    </View>
                  </View>

                  {/* Progress / Allocation Bar */}
                  <View style={styles.progressBarBackground}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min(cat.percentage, 100)}%`,
                          backgroundColor: cat.color,
                        },
                      ]}
                    />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
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
    marginBottom: 16,
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
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: SereneColors.outline,
  },
  donutWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginVertical: 10,
  },
  centerOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: 110,
  },
  centerTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: SereneColors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  centerValue: {
    fontSize: 18,
    fontWeight: '700',
    color: SereneColors.onSurface,
    marginTop: 2,
  },
  centerPct: {
    fontSize: 11,
    fontWeight: '700',
    color: SereneColors.primary,
    marginTop: 1,
  },
  categoryList: {
    marginTop: 16,
    gap: 10,
  },
  categoryRow: {
    padding: 10,
    borderRadius: SereneRadius.md,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  categoryRowSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: SereneColors.primary,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categoryIconWrap: {
    width: 32,
    height: 32,
    borderRadius: SereneRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryName: {
    fontSize: 13,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  itemCountText: {
    fontSize: 11,
    color: SereneColors.outline,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  categorySpending: {
    fontSize: 14,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  categoryPercentage: {
    fontSize: 11,
    fontWeight: '600',
    color: SereneColors.onSurfaceVariant,
  },
  progressBarBackground: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
});
