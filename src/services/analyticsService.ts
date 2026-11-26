/**
 * KEEPR: Purchase & Spending Analytics Engine
 * Institutional-grade calculation and aggregation service for personal asset & purchase analytics.
 *
 * Designed to be 100% pure TypeScript, zero React Native UI dependencies for
 * full testability across Node, Jest, and mobile runtimes.
 */

import { Item, ItemCategory } from '../types';
import { parseFlexibleDate } from '../utils/currency';
import {
  DEFAULT_CATEGORIES,
  getCategoryNameFromId,
  normalizeToDbCategoryId,
} from '../constants/categories';

export type AnalyticsDateFilter =
  | 'all_time'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'custom';

export interface CustomDateRange {
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
}

export interface AnalyticsFilterState {
  dateFilter: AnalyticsDateFilter;
  customRange?: CustomDateRange;
  categoryId?: string; // 'all' or specific category ID
  currency?: string; // Default 'INR'
}

export interface SpendingOverview {
  totalPurchaseValue: number; // Gross value of all eligible purchases
  totalSpending: number; // Net actual expenditure
  totalDiscounts: number; // Total discounts captured
  totalGstPaid: number; // Confirmed GST paid
  purchaseCount: number; // Number of eligible records
  averagePurchaseValue: number; // Average expenditure per purchase
  itemsWithGstCount: number; // Count of records with valid GST
  itemsWithoutGstCount: number; // Count of records lacking GST data
  currency: string;
  dateRangeLabel: string;
}

export interface CategorySpendingItem {
  categoryId: string;
  categoryName: string;
  totalSpending: number;
  percentage: number; // 0 to 100
  itemCount: number;
  totalGstPaid: number;
  icon: string;
  color: string;
}

export interface SpendingTrendPoint {
  key: string; // e.g. '2026-03' or '2026'
  label: string; // e.g. 'Mar 26' or '2026'
  shortLabel: string; // e.g. 'Mar'
  year: number;
  month?: number; // 1-12
  spending: number;
  purchaseCount: number;
  gstPaid: number;
  pctChangeVsPrev?: number; // MoM or YoY change
}

export interface GstDetail {
  hasGst: boolean;
  gstAmount: number;
  gstRatePercent?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  isEstimated: boolean;
  source: 'explicit_components' | 'explicit_tax' | 'calculated_rate' | 'none';
}

export interface GstAnalyticsSummary {
  totalGstPaid: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  otherGstTotal: number;
  itemsWithGstCount: number;
  itemsTotalCount: number;
  gstCoveragePercentage: number; // e.g. 75.5% of items have GST
  gstByCategory: Array<{
    categoryId: string;
    categoryName: string;
    gstAmount: number;
    percentage: number;
    color: string;
  }>;
  gstByPeriod: Array<{
    periodKey: string;
    periodLabel: string;
    gstAmount: number;
  }>;
}

// Serene-aligned vibrant palette for category visualization
export const CATEGORY_COLORS: Record<string, string> = {
  electronics: '#115086', // Primary Deep Navy
  appliances: '#0284C7', // Sky Blue
  fashion: '#9333EA', // Purple
  vehicles: '#EA580C', // Amber / Orange
  furniture: '#B45309', // Warm Bronze / Brown
  sports: '#10B981', // Emerald Green
  beauty: '#EC4899', // Rose Pink
  other: '#64748B', // Slate Gray
  uncategorized: '#94A3B8', // Neutral Muted Gray
};

/**
 * Parses numeric tax and currency values safely from strings.
 */
export function parseCleanNumber(val?: string | number | null): number {
  if (val == null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Extracts comprehensive GST details from an item record following strict Indian taxation rules:
 * 1. Explicit CGST + SGST components.
 * 2. Explicit IGST component.
 * 3. Explicit gst_tax rupee amount.
 * 4. Calculated from gst_rate percentage.
 * 5. Returns 0 and hasGst = false when no tax info exists (never invents taxes).
 */
export function extractItemGstDetail(item: Item): GstDetail {
  const purchasePrice = Number(item.purchasePrice) || 0;
  if (purchasePrice <= 0) {
    return { hasGst: false, gstAmount: 0, isEstimated: false, source: 'none' };
  }

  // 1. Check explicit CGST / SGST components
  const cgstVal = parseCleanNumber(item.cgst);
  const sgstVal = parseCleanNumber(item.sgst);
  if (cgstVal > 0 || sgstVal > 0) {
    const totalGst = cgstVal + sgstVal;
    return {
      hasGst: true,
      gstAmount: totalGst,
      cgst: cgstVal,
      sgst: sgstVal,
      isEstimated: false,
      source: 'explicit_components',
    };
  }

  // 2. Check explicit IGST component
  const igstVal = parseCleanNumber(item.igst);
  if (igstVal > 0) {
    return {
      hasGst: true,
      gstAmount: igstVal,
      igst: igstVal,
      isEstimated: false,
      source: 'explicit_components',
    };
  }

  // 3. Check gstTax field
  if (item.gstTax) {
    const gstTaxStr = String(item.gstTax).trim();
    // If it's not a pure percentage string (e.g. "₹2,160" or "2160")
    if (!gstTaxStr.endsWith('%') && !gstTaxStr.toLowerCase().includes('percent')) {
      const explicitAmt = parseCleanNumber(gstTaxStr);
      if (explicitAmt > 0 && explicitAmt < purchasePrice * 0.5) {
        return {
          hasGst: true,
          gstAmount: explicitAmt,
          isEstimated: false,
          source: 'explicit_tax',
        };
      }
    }
  }

  // 4. Check gstRate or percentage in gstTax (e.g. "18%" or "18")
  const rateCandidate = item.gstRate || item.gstTax;
  if (rateCandidate) {
    const rateNum = parseCleanNumber(rateCandidate);
    // Standard GST slabs in India are typically 3%, 5%, 12%, 18%, 28%
    if (rateNum > 0 && rateNum <= 40) {
      let calculatedGst = 0;
      // If subtotal is present and distinct from purchasePrice
      if (item.subtotal && item.subtotal > 0 && item.subtotal < purchasePrice) {
        // Exclusive tax formula: GST = Subtotal * Rate / 100
        calculatedGst = Math.round((item.subtotal * rateNum) / 100);
      } else {
        // Standard Inclusive MRP formula: GST = PurchasePrice * Rate / (100 + Rate)
        calculatedGst = Math.round((purchasePrice * rateNum) / (100 + rateNum));
      }

      if (calculatedGst > 0) {
        return {
          hasGst: true,
          gstAmount: calculatedGst,
          gstRatePercent: rateNum,
          isEstimated: true,
          source: 'calculated_rate',
        };
      }
    }
  }

  // 5. No valid GST data available
  return {
    hasGst: false,
    gstAmount: 0,
    isEstimated: false,
    source: 'none',
  };
}

/**
 * Returns date range boundaries for a given filter.
 */
export function getDateFilterBoundaries(
  filter: AnalyticsDateFilter,
  customRange?: CustomDateRange,
  now: Date = new Date()
): { start: Date | null; end: Date | null; label: string } {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  switch (filter) {
    case 'this_month': {
      const start = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return { start, end, label: `${monthNames[currentMonth]} ${currentYear}` };
    }

    case 'last_month': {
      const start = new Date(currentYear, currentMonth - 1, 1, 0, 0, 0, 0);
      const end = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);
      const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return { start, end, label: `${monthNames[prevMonthDate.getMonth()]} ${prevMonthDate.getFullYear()}` };
    }

    case 'last_3_months': {
      const start = new Date(currentYear, currentMonth - 2, 1, 0, 0, 0, 0);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, label: 'Past 3 Months' };
    }

    case 'last_6_months': {
      const start = new Date(currentYear, currentMonth - 5, 1, 0, 0, 0, 0);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      return { start, end, label: 'Past 6 Months' };
    }

    case 'this_year': {
      const start = new Date(currentYear, 0, 1, 0, 0, 0, 0);
      const end = new Date(currentYear, 11, 31, 23, 59, 59, 999);
      return { start, end, label: `Year ${currentYear}` };
    }

    case 'last_year': {
      const start = new Date(currentYear - 1, 0, 1, 0, 0, 0, 0);
      const end = new Date(currentYear - 1, 11, 31, 23, 59, 59, 999);
      return { start, end, label: `Year ${currentYear - 1}` };
    }

    case 'custom': {
      if (customRange?.startDate && customRange?.endDate) {
        const start = parseFlexibleDate(customRange.startDate) || new Date(0);
        const end = parseFlexibleDate(customRange.endDate) || new Date();
        end.setHours(23, 59, 59, 999);
        return {
          start,
          end,
          label: `${customRange.startDate} to ${customRange.endDate}`,
        };
      }
      return { start: null, end: null, label: 'Custom Range' };
    }

    case 'all_time':
    default:
      return { start: null, end: null, label: 'All Time' };
  }
}

/**
 * Filters items based on analytics criteria:
 * - Status check: excludes disposed or deleted records.
 * - Date boundary check.
 * - Category filter check.
 * - Currency isolation check.
 */
export function filterItemsForAnalytics(
  items: Item[],
  filterState: AnalyticsFilterState,
  refDate: Date = new Date()
): Item[] {
  if (!Array.isArray(items)) return [];

  const { start, end } = getDateFilterBoundaries(
    filterState.dateFilter,
    filterState.customRange,
    refDate
  );

  const selectedCategory = filterState.categoryId && filterState.categoryId !== 'all'
    ? filterState.categoryId.toLowerCase().trim()
    : null;

  const targetCurrency = filterState.currency || 'INR';

  return items.filter((item) => {
    if (!item || !item.id) return false;

    // 1. Exclude disposed or deleted records
    const status = item.status as string;
    if (status === 'disposed' || status === 'deleted') {
      return false;
    }

    // 2. Currency check (safeguard against mixed exchange rate summation)
    const itemCurrency = (item.currency || 'INR').toUpperCase();
    if (itemCurrency !== targetCurrency.toUpperCase()) {
      return false;
    }

    // 3. Category filter
    if (selectedCategory) {
      const itemCat = normalizeToDbCategoryId(item.categoryId || (typeof item.category === 'string' ? item.category : item.category?.id));
      if (itemCat !== selectedCategory) {
        return false;
      }
    }

    // 4. Date filter
    if (start || end) {
      const itemDate = parseFlexibleDate(item.purchaseDate) || parseFlexibleDate(item.createdAt);
      if (!itemDate) {
        // Items without dates are only included in all_time
        return false;
      }
      if (start && itemDate < start) return false;
      if (end && itemDate > end) return false;
    }

    return true;
  });
}

/**
 * Computes Section A: Spending Overview Summary Cards.
 */
export function calculateSpendingOverview(
  filteredItems: Item[],
  filterState: AnalyticsFilterState,
  refDate: Date = new Date()
): SpendingOverview {
  const { label: dateRangeLabel } = getDateFilterBoundaries(
    filterState.dateFilter,
    filterState.customRange,
    refDate
  );

  let totalPurchaseValue = 0;
  let totalSpending = 0;
  let totalDiscounts = 0;
  let totalGstPaid = 0;
  let itemsWithGstCount = 0;
  let itemsWithoutGstCount = 0;

  for (const item of filteredItems) {
    const price = Number(item.purchasePrice) || 0;
    const discount = Number(item.discount) || 0;
    const subtotal = Number(item.subtotal) || 0;

    // Spending: actual amount paid
    totalSpending += price;

    // Gross purchase value: subtotal or (price + discount)
    if (subtotal > 0) {
      totalPurchaseValue += subtotal;
    } else {
      totalPurchaseValue += price + discount;
    }

    totalDiscounts += discount;

    // GST analysis
    const gstDetail = extractItemGstDetail(item);
    if (gstDetail.hasGst && gstDetail.gstAmount > 0) {
      totalGstPaid += gstDetail.gstAmount;
      itemsWithGstCount++;
    } else {
      itemsWithoutGstCount++;
    }
  }

  const purchaseCount = filteredItems.length;
  const averagePurchaseValue = purchaseCount > 0 ? Math.round(totalSpending / purchaseCount) : 0;

  return {
    totalPurchaseValue: Math.round(totalPurchaseValue),
    totalSpending: Math.round(totalSpending),
    totalDiscounts: Math.round(totalDiscounts),
    totalGstPaid: Math.round(totalGstPaid),
    purchaseCount,
    averagePurchaseValue,
    itemsWithGstCount,
    itemsWithoutGstCount,
    currency: filterState.currency || 'INR',
    dateRangeLabel,
  };
}

/**
 * Computes Section B: Interactive Monthly / Yearly Spending Trends.
 */
export function calculateSpendingTrends(
  filteredItems: Item[],
  mode: 'monthly' | 'yearly' = 'monthly',
  now: Date = new Date()
): SpendingTrendPoint[] {
  if (mode === 'yearly') {
    // Collect all years present or trailing 4 years
    const yearMap = new Map<number, { spending: number; count: number; gst: number }>();
    const currentYear = now.getFullYear();

    // Default to at least past 3 years if empty
    for (let y = currentYear - 2; y <= currentYear; y++) {
      yearMap.set(y, { spending: 0, count: 0, gst: 0 });
    }

    for (const item of filteredItems) {
      const d = parseFlexibleDate(item.purchaseDate) || parseFlexibleDate(item.createdAt);
      if (!d) continue;
      const y = d.getFullYear();
      const existing = yearMap.get(y) || { spending: 0, count: 0, gst: 0 };
      const price = Number(item.purchasePrice) || 0;
      const gst = extractItemGstDetail(item).gstAmount;

      yearMap.set(y, {
        spending: existing.spending + price,
        count: existing.count + 1,
        gst: existing.gst + gst,
      });
    }

    const sortedYears = Array.from(yearMap.keys()).sort((a, b) => a - b);
    const points: SpendingTrendPoint[] = [];

    for (let i = 0; i < sortedYears.length; i++) {
      const yr = sortedYears[i];
      const data = yearMap.get(yr)!;
      let pctChangeVsPrev: number | undefined;

      if (i > 0) {
        const prevData = yearMap.get(sortedYears[i - 1])!;
        if (prevData.spending > 0) {
          pctChangeVsPrev = Math.round(((data.spending - prevData.spending) / prevData.spending) * 100);
        }
      }

      points.push({
        key: String(yr),
        label: String(yr),
        shortLabel: String(yr).slice(-2),
        year: yr,
        spending: Math.round(data.spending),
        purchaseCount: data.count,
        gstPaid: Math.round(data.gst),
        pctChangeVsPrev,
      });
    }

    return points;
  }

  // Monthly mode: Trailing 6 or 12 sequential months
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthMap = new Map<string, { year: number; month: number; spending: number; count: number; gst: number }>();

  // Generate trailing 6 months sequence up to current month
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    monthMap.set(key, { year: y, month: m, spending: 0, count: 0, gst: 0 });
  }

  // Aggregate items into monthly buckets
  for (const item of filteredItems) {
    const d = parseFlexibleDate(item.purchaseDate) || parseFlexibleDate(item.createdAt);
    if (!d) continue;
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;

    if (monthMap.has(key)) {
      const curr = monthMap.get(key)!;
      const price = Number(item.purchasePrice) || 0;
      const gst = extractItemGstDetail(item).gstAmount;
      curr.spending += price;
      curr.count += 1;
      curr.gst += gst;
    }
  }

  const sortedKeys = Array.from(monthMap.keys()).sort();
  const points: SpendingTrendPoint[] = [];

  for (let i = 0; i < sortedKeys.length; i++) {
    const k = sortedKeys[i];
    const data = monthMap.get(k)!;
    const shortLabel = monthNames[data.month - 1];
    const fullLabel = `${shortLabel} '${String(data.year).slice(-2)}`;

    let pctChangeVsPrev: number | undefined;
    if (i > 0) {
      const prevData = monthMap.get(sortedKeys[i - 1])!;
      if (prevData.spending > 0) {
        pctChangeVsPrev = Math.round(((data.spending - prevData.spending) / prevData.spending) * 100);
      }
    }

    points.push({
      key: k,
      label: fullLabel,
      shortLabel,
      year: data.year,
      month: data.month,
      spending: Math.round(data.spending),
      purchaseCount: data.count,
      gstPaid: Math.round(data.gst),
      pctChangeVsPrev,
    });
  }

  return points;
}

/**
 * Computes Section C: Category-wise Spending & Percentages.
 */
export function calculateCategorySpending(filteredItems: Item[]): CategorySpendingItem[] {
  const totalSpending = filteredItems.reduce(
    (sum, i) => sum + (Number(i.purchasePrice) || 0),
    0
  );

  const categoryAgg = new Map<
    string,
    { name: string; spending: number; count: number; gst: number; icon: string }
  >();

  // Initialize known categories
  for (const cat of DEFAULT_CATEGORIES) {
    categoryAgg.set(cat.id, {
      name: cat.name,
      spending: 0,
      count: 0,
      gst: 0,
      icon: cat.icon,
    });
  }

  // Populate data
  for (const item of filteredItems) {
    const rawCat = item.categoryId || (typeof item.category === 'string' ? item.category : item.category?.id);
    const catId = normalizeToDbCategoryId(rawCat) || 'other';
    const price = Number(item.purchasePrice) || 0;
    const gst = extractItemGstDetail(item).gstAmount;

    if (!categoryAgg.has(catId)) {
      categoryAgg.set(catId, {
        name: getCategoryNameFromId(catId) || 'Other',
        spending: 0,
        count: 0,
        gst: 0,
        icon: 'inventory-2',
      });
    }

    const current = categoryAgg.get(catId)!;
    current.spending += price;
    current.count += 1;
    current.gst += gst;
  }

  // Filter out categories with 0 items, then sort by spending descending
  const result: CategorySpendingItem[] = [];

  for (const [id, data] of categoryAgg.entries()) {
    if (data.count > 0 || data.spending > 0) {
      const percentage = totalSpending > 0 ? (data.spending / totalSpending) * 100 : 0;
      result.push({
        categoryId: id,
        categoryName: data.name,
        totalSpending: Math.round(data.spending),
        percentage: Number(percentage.toFixed(1)),
        itemCount: data.count,
        totalGstPaid: Math.round(data.gst),
        icon: data.icon,
        color: CATEGORY_COLORS[id] || CATEGORY_COLORS.other,
      });
    }
  }

  return result.sort((a, b) => b.totalSpending - a.totalSpending);
}

/**
 * Computes Section D: Most Expensive Purchases (ranked high to low).
 */
export function calculateTopPurchases(filteredItems: Item[], limit: number = 5): Item[] {
  return [...filteredItems]
    .sort((a, b) => (Number(b.purchasePrice) || 0) - (Number(a.purchasePrice) || 0))
    .slice(0, limit);
}

/**
 * Computes Section E: Detailed GST & Tax Summary.
 */
export function calculateGstAnalytics(filteredItems: Item[]): GstAnalyticsSummary {
  let totalGstPaid = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  let otherGstTotal = 0;
  let itemsWithGstCount = 0;

  const categoryGstMap = new Map<string, number>();

  for (const item of filteredItems) {
    const gst = extractItemGstDetail(item);
    if (gst.hasGst && gst.gstAmount > 0) {
      totalGstPaid += gst.gstAmount;
      itemsWithGstCount++;

      if (gst.cgst || gst.sgst) {
        cgstTotal += gst.cgst || 0;
        sgstTotal += gst.sgst || 0;
      } else if (gst.igst) {
        igstTotal += gst.igst;
      } else {
        otherGstTotal += gst.gstAmount;
      }

      const rawCat = item.categoryId || (typeof item.category === 'string' ? item.category : item.category?.id);
      const catId = normalizeToDbCategoryId(rawCat) || 'other';
      categoryGstMap.set(catId, (categoryGstMap.get(catId) || 0) + gst.gstAmount);
    }
  }

  const itemsTotalCount = filteredItems.length;
  const gstCoveragePercentage =
    itemsTotalCount > 0 ? Number(((itemsWithGstCount / itemsTotalCount) * 100).toFixed(1)) : 0;

  // Category breakdown for GST
  const gstByCategory = Array.from(categoryGstMap.entries())
    .map(([catId, amount]) => ({
      categoryId: catId,
      categoryName: getCategoryNameFromId(catId) || 'Other',
      gstAmount: Math.round(amount),
      percentage: totalGstPaid > 0 ? Number(((amount / totalGstPaid) * 100).toFixed(1)) : 0,
      color: CATEGORY_COLORS[catId] || CATEGORY_COLORS.other,
    }))
    .sort((a, b) => b.gstAmount - a.gstAmount);

  return {
    totalGstPaid: Math.round(totalGstPaid),
    cgstTotal: Math.round(cgstTotal),
    sgstTotal: Math.round(sgstTotal),
    igstTotal: Math.round(igstTotal),
    otherGstTotal: Math.round(otherGstTotal),
    itemsWithGstCount,
    itemsTotalCount,
    gstCoveragePercentage,
    gstByCategory,
    gstByPeriod: [], // Can be populated if periodic tax drilldown is needed
  };
}
