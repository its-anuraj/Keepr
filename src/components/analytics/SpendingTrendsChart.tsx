import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import Svg, { Rect, Line, Text as SvgText, G } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors, SereneRadius } from '../../constants/theme';
import { SpendingTrendPoint } from '../../services/analyticsService';
import { formatCurrency, formatCompactCurrency } from '../../utils/currency';

export interface SpendingTrendsChartProps {
  trendPoints: SpendingTrendPoint[];
  mode: 'monthly' | 'yearly';
  onToggleMode: (newMode: 'monthly' | 'yearly') => void;
}

export const SpendingTrendsChart: React.FC<SpendingTrendsChartProps> = ({
  trendPoints,
  mode,
  onToggleMode,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    trendPoints.length > 0 ? trendPoints.length - 1 : null
  );

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.max(screenWidth - 48, 280);
  const chartHeight = 160;
  const paddingBottom = 28;
  const paddingTop = 20;
  const paddingLeft = 10;
  const paddingRight = 10;

  const innerHeight = chartHeight - paddingTop - paddingBottom;
  const innerWidth = chartWidth - paddingLeft - paddingRight;

  const maxSpending = Math.max(...trendPoints.map((p) => p.spending), 1000);
  const selectedPoint = selectedIndex !== null && selectedIndex >= 0 && selectedIndex < trendPoints.length
    ? trendPoints[selectedIndex]
    : null;

  const barCount = trendPoints.length;
  const slotWidth = barCount > 0 ? innerWidth / barCount : innerWidth;
  const barWidth = Math.min(Math.max(slotWidth * 0.55, 14), 36);

  return (
    <View style={styles.card}>
      {/* Header with Title & Mode Switcher */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.cardTitle}>Spending Trends</Text>
          <Text style={styles.cardSubtitle}>
            {mode === 'monthly' ? 'Monthly breakdown' : 'Year-over-year comparison'}
          </Text>
        </View>

        {/* Segmented Control */}
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[styles.segmentBtn, mode === 'monthly' && styles.segmentBtnActive]}
            onPress={() => {
              onToggleMode('monthly');
              setSelectedIndex(null);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, mode === 'monthly' && styles.segmentTextActive]}>
              Monthly
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, mode === 'yearly' && styles.segmentBtnActive]}
            onPress={() => {
              onToggleMode('yearly');
              setSelectedIndex(null);
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, mode === 'yearly' && styles.segmentTextActive]}>
              Yearly
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Interactive Tooltip Card */}
      {selectedPoint ? (
        <View style={styles.tooltipCard}>
          <View style={styles.tooltipLeft}>
            <Text style={styles.tooltipPeriod}>{selectedPoint.label}</Text>
            <Text style={styles.tooltipPurchases}>
              {selectedPoint.purchaseCount} {selectedPoint.purchaseCount === 1 ? 'purchase' : 'purchases'}
            </Text>
          </View>

          <View style={styles.tooltipRight}>
            <Text style={styles.tooltipAmount}>{formatCurrency(selectedPoint.spending)}</Text>
            {selectedPoint.pctChangeVsPrev !== undefined && (
              <View style={styles.pctBadge}>
                <MaterialIcons
                  name={selectedPoint.pctChangeVsPrev >= 0 ? 'arrow-upward' : 'arrow-downward'}
                  size={12}
                  color={selectedPoint.pctChangeVsPrev >= 0 ? '#DC2626' : SereneColors.success}
                />
                <Text
                  style={[
                    styles.pctText,
                    {
                      color:
                        selectedPoint.pctChangeVsPrev >= 0 ? '#DC2626' : SereneColors.success,
                    },
                  ]}
                >
                  {Math.abs(selectedPoint.pctChangeVsPrev)}% vs prev
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.tooltipPlaceholder}>
          <Text style={styles.tooltipPlaceholderText}>Tap any bar to inspect spending details</Text>
        </View>
      )}

      {/* SVG Bar Chart */}
      <View style={styles.chartWrapper}>
        <Svg width={chartWidth} height={chartHeight}>
          {/* Subtle Grid Guidelines */}
          <Line
            x1={paddingLeft}
            y1={paddingTop}
            x2={chartWidth - paddingRight}
            y2={paddingTop}
            stroke="#E2E8F0"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          <Line
            x1={paddingLeft}
            y1={paddingTop + innerHeight / 2}
            x2={chartWidth - paddingRight}
            y2={paddingTop + innerHeight / 2}
            stroke="#E2E8F0"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          <Line
            x1={paddingLeft}
            y1={paddingTop + innerHeight}
            x2={chartWidth - paddingRight}
            y2={paddingTop + innerHeight}
            stroke="#CBD5E1"
            strokeWidth={1.5}
          />

          {/* Render Trend Bars */}
          {trendPoints.map((point, index) => {
            const xCenter = paddingLeft + index * slotWidth + slotWidth / 2;
            const x = xCenter - barWidth / 2;
            const normalizedHeight =
              maxSpending > 0 ? (point.spending / maxSpending) * innerHeight : 0;
            // Ensure zero spending still renders a subtle baseline tick (3px)
            const height = Math.max(normalizedHeight, point.spending > 0 ? 6 : 2);
            const y = paddingTop + innerHeight - height;
            const isSelected = selectedIndex === index;

            return (
              <G key={point.key} onPress={() => setSelectedIndex(index)}>
                {/* Invisible hit area for easier finger tapping */}
                <Rect
                  x={paddingLeft + index * slotWidth}
                  y={paddingTop}
                  width={slotWidth}
                  height={innerHeight + paddingBottom}
                  fill="transparent"
                />

                {/* Bar */}
                <Rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx={4}
                  fill={
                    isSelected
                      ? SereneColors.primary
                      : point.spending > 0
                      ? '#38BDF8'
                      : '#E2E8F0'
                  }
                />

                {/* X-axis Label */}
                <SvgText
                  x={xCenter}
                  y={chartHeight - 6}
                  fontSize={11}
                  fontWeight={isSelected ? '700' : '500'}
                  fill={isSelected ? SereneColors.primary : SereneColors.onSurfaceVariant}
                  textAnchor="middle"
                >
                  {point.shortLabel}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
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
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: SereneRadius.md,
    padding: 3,
  },
  segmentBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: SereneRadius.sm,
  },
  segmentBtnActive: {
    backgroundColor: SereneColors.surfaceContainerLowest,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '500',
    color: SereneColors.onSurfaceVariant,
  },
  segmentTextActive: {
    fontWeight: '700',
    color: SereneColors.primary,
  },
  tooltipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: SereneRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  tooltipLeft: {
    flex: 1,
  },
  tooltipPeriod: {
    fontSize: 13,
    fontWeight: '700',
    color: SereneColors.onSurface,
  },
  tooltipPurchases: {
    fontSize: 11,
    color: SereneColors.outline,
  },
  tooltipRight: {
    alignItems: 'flex-end',
  },
  tooltipAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: SereneColors.primary,
  },
  pctBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  pctText: {
    fontSize: 10,
    fontWeight: '600',
  },
  tooltipPlaceholder: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 8,
  },
  tooltipPlaceholderText: {
    fontSize: 11,
    color: SereneColors.outline,
    fontStyle: 'italic',
  },
  chartWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
