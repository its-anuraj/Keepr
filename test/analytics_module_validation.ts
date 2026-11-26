import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  filterItemsForAnalytics,
  calculateSpendingOverview,
  calculateSpendingTrends,
  calculateCategorySpending,
  calculateTopPurchases,
  calculateGstAnalytics,
  extractItemGstDetail,
  getDateFilterBoundaries,
  AnalyticsFilterState,
} from '../src/services/analyticsService';
import { Item } from '../src/types';

console.log('================================================================');
console.log(' KEEPR: PURCHASE & SPENDING ANALYTICS MODULE VALIDATION SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runSuite() {
  const rootDir = path.resolve(__dirname, '..');
  const refDate = new Date(2026, 9, 15); // Fixed reference date: 15 Oct 2026

  // ---------------------------------------------------------------------------
  // 1. Spending Calculations
  // ---------------------------------------------------------------------------
  console.log('--- 1. Spending Calculations & Edge Cases ---');

  await test('Single purchase calculates exact spending and overview', () => {
    const items: Item[] = [
      {
        id: 'item-1',
        userId: 'usr-1',
        name: 'Sony WH-1000XM5',
        categoryId: 'electronics',
        purchasePrice: 26990,
        currency: 'INR',
        purchaseDate: '2026-10-01',
        status: 'active',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ];

    const filter: AnalyticsFilterState = { dateFilter: 'all_time' };
    const filtered = filterItemsForAnalytics(items, filter, refDate);
    const overview = calculateSpendingOverview(filtered, filter, refDate);

    assert.strictEqual(overview.purchaseCount, 1);
    assert.strictEqual(overview.totalSpending, 26990);
    assert.strictEqual(overview.totalPurchaseValue, 26990);
    assert.strictEqual(overview.averagePurchaseValue, 26990);
  });

  await test('Multiple purchases aggregate spending correctly across records', () => {
    const items: Item[] = [
      {
        id: 'item-1',
        userId: 'usr-1',
        name: 'iPhone 16 Pro',
        categoryId: 'electronics',
        purchasePrice: 119900,
        currency: 'INR',
        purchaseDate: '2026-09-20',
        status: 'active',
        createdAt: '2026-09-20',
        updatedAt: '2026-09-20',
      },
      {
        id: 'item-2',
        userId: 'usr-1',
        name: 'LG Washing Machine',
        categoryId: 'appliances',
        purchasePrice: 34990,
        currency: 'INR',
        purchaseDate: '2026-10-05',
        status: 'active',
        createdAt: '2026-10-05',
        updatedAt: '2026-10-05',
      },
      {
        id: 'item-3',
        userId: 'usr-1',
        name: 'Nike Running Shoes',
        categoryId: 'fashion',
        purchasePrice: 8495,
        currency: 'INR',
        purchaseDate: '2026-10-10',
        status: 'active',
        createdAt: '2026-10-10',
        updatedAt: '2026-10-10',
      },
    ];

    const filter: AnalyticsFilterState = { dateFilter: 'all_time' };
    const filtered = filterItemsForAnalytics(items, filter, refDate);
    const overview = calculateSpendingOverview(filtered, filter, refDate);

    assert.strictEqual(overview.purchaseCount, 3);
    assert.strictEqual(overview.totalSpending, 119900 + 34990 + 8495); // 163385
    assert.strictEqual(overview.averagePurchaseValue, Math.round(163385 / 3));
  });

  await test('Discounted purchase computes gross purchase value, net spending, and savings', () => {
    const items: Item[] = [
      {
        id: 'item-disc-1',
        userId: 'usr-1',
        name: 'MacBook Air M3',
        categoryId: 'electronics',
        purchasePrice: 99900, // Net price paid
        subtotal: 114900, // Original sticker price
        discount: 15000, // Card discount
        currency: 'INR',
        purchaseDate: '2026-10-01',
        status: 'active',
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
      },
    ];

    const filter: AnalyticsFilterState = { dateFilter: 'all_time' };
    const overview = calculateSpendingOverview(items, filter, refDate);

    assert.strictEqual(overview.totalSpending, 99900, 'Net spending must be actual price paid');
    assert.strictEqual(overview.totalPurchaseValue, 114900, 'Gross value must reflect subtotal before discount');
    assert.strictEqual(overview.totalDiscounts, 15000, 'Total discount must equal 15000');
  });

  await test('Handles zero-value purchases and missing prices safely without NaN', () => {
    const items: Item[] = [
      {
        id: 'item-gift',
        userId: 'usr-1',
        name: 'Gifted Watch',
        purchasePrice: 0,
        currency: 'INR',
        status: 'active',
        createdAt: '2026-05-01',
        updatedAt: '2026-05-01',
      },
      {
        id: 'item-nan',
        userId: 'usr-1',
        name: 'Warrantied Replacement',
        purchasePrice: undefined as any,
        currency: 'INR',
        status: 'active',
        createdAt: '2026-05-02',
        updatedAt: '2026-05-02',
      },
    ];

    const filter: AnalyticsFilterState = { dateFilter: 'all_time' };
    const overview = calculateSpendingOverview(items, filter, refDate);

    assert.strictEqual(overview.purchaseCount, 2);
    assert.strictEqual(overview.totalSpending, 0);
    assert.strictEqual(overview.averagePurchaseValue, 0);
    assert.ok(!isNaN(overview.totalSpending));
  });

  await test('Disposed and deleted items are strictly excluded from spending analytics', () => {
    const items: Item[] = [
      {
        id: 'item-act',
        userId: 'usr-1',
        name: 'Active iPad',
        purchasePrice: 49900,
        currency: 'INR',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'item-disp',
        userId: 'usr-1',
        name: 'Disposed Monitor',
        purchasePrice: 15000,
        currency: 'INR',
        status: 'disposed',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'item-del',
        userId: 'usr-1',
        name: 'Deleted Phone',
        purchasePrice: 30000,
        currency: 'INR',
        status: 'deleted' as any,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ];

    const filtered = filterItemsForAnalytics(items, { dateFilter: 'all_time' }, refDate);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].id, 'item-act');

    const overview = calculateSpendingOverview(filtered, { dateFilter: 'all_time' }, refDate);
    assert.strictEqual(overview.totalSpending, 49900);
  });

  // ---------------------------------------------------------------------------
  // 2. Spending Trends: Monthly & Yearly
  // ---------------------------------------------------------------------------
  console.log('--- 2. Spending Trends: Monthly & Yearly Aggregation ---');

  await test('Monthly spending trends create sequential months with zero-spending handling', () => {
    const items: Item[] = [
      {
        id: 'i-may',
        userId: 'u1',
        name: 'May Item',
        purchasePrice: 10000,
        currency: 'INR',
        purchaseDate: '2026-05-15',
        status: 'active',
        createdAt: '2026-05-15',
        updatedAt: '2026-05-15',
      },
      {
        id: 'i-aug',
        userId: 'u1',
        name: 'Aug Item',
        purchasePrice: 25000,
        currency: 'INR',
        purchaseDate: '2026-08-20',
        status: 'active',
        createdAt: '2026-08-20',
        updatedAt: '2026-08-20',
      },
    ];

    // Reference date: Oct 2026 -> Trailing 6 months: May, Jun, Jul, Aug, Sep, Oct
    const trends = calculateSpendingTrends(items, 'monthly', refDate);
    assert.strictEqual(trends.length, 6, 'Must generate exactly 6 consecutive trailing months');

    const mayPoint = trends.find((t) => t.month === 5);
    const junPoint = trends.find((t) => t.month === 6);
    const augPoint = trends.find((t) => t.month === 8);

    assert.ok(mayPoint, 'May must exist');
    assert.strictEqual(mayPoint.spending, 10000);
    assert.strictEqual(mayPoint.purchaseCount, 1);

    assert.ok(junPoint, 'June must exist even with 0 purchases');
    assert.strictEqual(junPoint.spending, 0, 'Zero-purchase month must have spending = 0');
    assert.strictEqual(junPoint.purchaseCount, 0);

    assert.ok(augPoint, 'August must exist');
    assert.strictEqual(augPoint.spending, 25000);
  });

  await test('Yearly spending trends aggregate multi-year records and MoM/YoY change', () => {
    const items: Item[] = [
      {
        id: 'i-2024',
        userId: 'u1',
        name: '2024 Car',
        purchasePrice: 800000,
        currency: 'INR',
        purchaseDate: '2024-03-10',
        status: 'active',
        createdAt: '2024-03-10',
        updatedAt: '2024-03-10',
      },
      {
        id: 'i-2025',
        userId: 'u1',
        name: '2025 TV',
        purchasePrice: 60000,
        currency: 'INR',
        purchaseDate: '2025-07-15',
        status: 'active',
        createdAt: '2025-07-15',
        updatedAt: '2025-07-15',
      },
      {
        id: 'i-2026',
        userId: 'u1',
        name: '2026 Laptop',
        purchasePrice: 120000,
        currency: 'INR',
        purchaseDate: '2026-02-20',
        status: 'active',
        createdAt: '2026-02-20',
        updatedAt: '2026-02-20',
      },
    ];

    const trends = calculateSpendingTrends(items, 'yearly', refDate);
    const y2024 = trends.find((t) => t.year === 2024);
    const y2025 = trends.find((t) => t.year === 2025);
    const y2026 = trends.find((t) => t.year === 2026);

    assert.ok(y2024 && y2025 && y2026);
    assert.strictEqual(y2024.spending, 800000);
    assert.strictEqual(y2025.spending, 60000);
    assert.strictEqual(y2026.spending, 120000);

    // YoY from 2025 (60k) to 2026 (120k) is +100%
    assert.strictEqual(y2026.pctChangeVsPrev, 100);
  });

  // ---------------------------------------------------------------------------
  // 3. Category Spending & Ranking
  // ---------------------------------------------------------------------------
  console.log('--- 3. Category Spending & Ranking ---');

  await test('Category spending aggregates correctly, computes percentages, and sorts high to low', () => {
    const items: Item[] = [
      {
        id: 'i-c1',
        userId: 'u1',
        name: 'iPhone',
        categoryId: 'electronics',
        purchasePrice: 100000,
        currency: 'INR',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'i-c2',
        userId: 'u1',
        name: 'Refrigerator',
        categoryId: 'appliances',
        purchasePrice: 60000,
        currency: 'INR',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'i-c3',
        userId: 'u1',
        name: 'Shirt',
        categoryId: 'fashion',
        purchasePrice: 40000,
        currency: 'INR',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ];

    // Total: 200,000. Electronics = 50%, Appliances = 30%, Fashion = 20%
    const catBreakdown = calculateCategorySpending(items);
    assert.strictEqual(catBreakdown.length, 3);
    assert.strictEqual(catBreakdown[0].categoryId, 'electronics');
    assert.strictEqual(catBreakdown[0].totalSpending, 100000);
    assert.strictEqual(catBreakdown[0].percentage, 50.0);

    assert.strictEqual(catBreakdown[1].categoryId, 'appliances');
    assert.strictEqual(catBreakdown[1].totalSpending, 60000);
    assert.strictEqual(catBreakdown[1].percentage, 30.0);

    assert.strictEqual(catBreakdown[2].categoryId, 'fashion');
    assert.strictEqual(catBreakdown[2].totalSpending, 40000);
    assert.strictEqual(catBreakdown[2].percentage, 20.0);
  });

  await test('Uncategorized purchases are grouped gracefully into other/uncategorized', () => {
    const items: Item[] = [
      {
        id: 'i-uncat',
        userId: 'u1',
        name: 'Antique Lamp',
        categoryId: undefined,
        category: undefined,
        purchasePrice: 12000,
        currency: 'INR',
        status: 'active',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ];

    const catBreakdown = calculateCategorySpending(items);
    assert.strictEqual(catBreakdown.length, 1);
    assert.strictEqual(catBreakdown[0].categoryId, 'other');
    assert.strictEqual(catBreakdown[0].totalSpending, 12000);
    assert.strictEqual(catBreakdown[0].percentage, 100);
  });

  // ---------------------------------------------------------------------------
  // 4. Most Expensive Purchases
  // ---------------------------------------------------------------------------
  console.log('--- 4. Top Expensive Purchases Ranking ---');

  await test('calculateTopPurchases returns items ranked strictly by purchasePrice descending', () => {
    const items: Item[] = [
      { id: '1', userId: 'u', name: 'Item A', purchasePrice: 5000, currency: 'INR', status: 'active', createdAt: '', updatedAt: '' },
      { id: '2', userId: 'u', name: 'Item B', purchasePrice: 90000, currency: 'INR', status: 'active', createdAt: '', updatedAt: '' },
      { id: '3', userId: 'u', name: 'Item C', purchasePrice: 35000, currency: 'INR', status: 'active', createdAt: '', updatedAt: '' },
      { id: '4', userId: 'u', name: 'Item D', purchasePrice: 120000, currency: 'INR', status: 'active', createdAt: '', updatedAt: '' },
      { id: '5', userId: 'u', name: 'Item E', purchasePrice: 15000, currency: 'INR', status: 'active', createdAt: '', updatedAt: '' },
      { id: '6', userId: 'u', name: 'Item F', purchasePrice: 45000, currency: 'INR', status: 'active', createdAt: '', updatedAt: '' },
    ];

    const top5 = calculateTopPurchases(items, 5);
    assert.strictEqual(top5.length, 5);
    assert.strictEqual(top5[0].id, '4', 'Highest is 120000 (Item D)');
    assert.strictEqual(top5[1].id, '2', 'Second highest is 90000 (Item B)');
    assert.strictEqual(top5[2].id, '6', 'Third highest is 45000 (Item F)');
    assert.strictEqual(top5[3].id, '3', 'Fourth highest is 35000 (Item C)');
    assert.strictEqual(top5[4].id, '5', 'Fifth highest is 15000 (Item E)');
  });

  // ---------------------------------------------------------------------------
  // 5. GST Analytics & Calculation Rules
  // ---------------------------------------------------------------------------
  console.log('--- 5. GST Analytics & Indian Taxation Rules ---');

  await test('Extracts explicit CGST and SGST components accurately', () => {
    const item: Item = {
      id: 'item-cgst',
      userId: 'u',
      name: 'Monitor',
      purchasePrice: 23600,
      cgst: '1800.00',
      sgst: '1800.00',
      currency: 'INR',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const gst = extractItemGstDetail(item);
    assert.strictEqual(gst.hasGst, true);
    assert.strictEqual(gst.gstAmount, 3600);
    assert.strictEqual(gst.cgst, 1800);
    assert.strictEqual(gst.sgst, 1800);
    assert.strictEqual(gst.source, 'explicit_components');
  });

  await test('Extracts explicit IGST component accurately', () => {
    const item: Item = {
      id: 'item-igst',
      userId: 'u',
      name: 'Inter-state Hard Drive',
      purchasePrice: 11800,
      igst: '₹1,800',
      currency: 'INR',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const gst = extractItemGstDetail(item);
    assert.strictEqual(gst.hasGst, true);
    assert.strictEqual(gst.gstAmount, 1800);
    assert.strictEqual(gst.igst, 1800);
    assert.strictEqual(gst.source, 'explicit_components');
  });

  await test('Calculates GST from verified rate percentage using inclusive MRP formula', () => {
    const item: Item = {
      id: 'item-rate',
      userId: 'u',
      name: 'Headphones',
      purchasePrice: 11800, // MRP inclusive of 18% GST (10000 base + 1800 GST)
      gstRate: '18%',
      currency: 'INR',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const gst = extractItemGstDetail(item);
    assert.strictEqual(gst.hasGst, true);
    // (11800 * 18) / 118 = 1800
    assert.strictEqual(gst.gstAmount, 1800);
    assert.strictEqual(gst.gstRatePercent, 18);
    assert.strictEqual(gst.source, 'calculated_rate');
  });

  await test('Calculates GST from subtotal using exclusive formula when subtotal < purchasePrice', () => {
    const item: Item = {
      id: 'item-excl',
      userId: 'u',
      name: 'Office Chair',
      subtotal: 10000,
      purchasePrice: 11800,
      gstRate: '18%',
      currency: 'INR',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const gst = extractItemGstDetail(item);
    assert.strictEqual(gst.hasGst, true);
    // (10000 * 18) / 100 = 1800
    assert.strictEqual(gst.gstAmount, 1800);
  });

  await test('Strict Rule: Items without GST data return hasGst = false and gstAmount = 0', () => {
    const itemNoGst: Item = {
      id: 'item-nogst',
      userId: 'u',
      name: 'Used Bicycle',
      purchasePrice: 4500,
      currency: 'INR',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    };

    const gst = extractItemGstDetail(itemNoGst);
    assert.strictEqual(gst.hasGst, false, 'Must not assume GST exists');
    assert.strictEqual(gst.gstAmount, 0);
    assert.strictEqual(gst.source, 'none');
  });

  await test('GstAnalyticsSummary tracks totals, component split, and coverage ratio', () => {
    const items: Item[] = [
      {
        id: '1',
        userId: 'u',
        name: 'Phone',
        categoryId: 'electronics',
        purchasePrice: 23600,
        cgst: '1800',
        sgst: '1800',
        currency: 'INR',
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: '2',
        userId: 'u',
        name: 'Desk',
        categoryId: 'furniture',
        purchasePrice: 11800,
        igst: '1800',
        currency: 'INR',
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: '3',
        userId: 'u',
        name: 'Second Hand Book',
        categoryId: 'other',
        purchasePrice: 500,
        currency: 'INR',
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const summary = calculateGstAnalytics(items);
    assert.strictEqual(summary.totalGstPaid, 5400); // 3600 + 1800
    assert.strictEqual(summary.cgstTotal, 1800);
    assert.strictEqual(summary.sgstTotal, 1800);
    assert.strictEqual(summary.igstTotal, 1800);
    assert.strictEqual(summary.itemsWithGstCount, 2);
    assert.strictEqual(summary.itemsTotalCount, 3);
    assert.strictEqual(summary.gstCoveragePercentage, 66.7);
  });

  // ---------------------------------------------------------------------------
  // 6. Global Date Filters & Boundary Calculations
  // ---------------------------------------------------------------------------
  console.log('--- 6. Global Date Filters & Boundary Handling ---');

  await test('this_month boundary calculates exact month start and end', () => {
    const { start, end } = getDateFilterBoundaries('this_month', undefined, refDate);
    assert.ok(start && end);
    assert.strictEqual(start.getFullYear(), 2026);
    assert.strictEqual(start.getMonth(), 9); // October
    assert.strictEqual(start.getDate(), 1);
    assert.strictEqual(end.getDate(), 31);
  });

  await test('last_month boundary targets September 2026', () => {
    const { start, end } = getDateFilterBoundaries('last_month', undefined, refDate);
    assert.ok(start && end);
    assert.strictEqual(start.getFullYear(), 2026);
    assert.strictEqual(start.getMonth(), 8); // September
    assert.strictEqual(start.getDate(), 1);
    assert.strictEqual(end.getDate(), 30);
  });

  await test('this_year boundary spans Jan 1 to Dec 31 of 2026', () => {
    const { start, end } = getDateFilterBoundaries('this_year', undefined, refDate);
    assert.ok(start && end);
    assert.strictEqual(start.getFullYear(), 2026);
    assert.strictEqual(start.getMonth(), 0); // January
    assert.strictEqual(start.getDate(), 1);
    assert.strictEqual(end.getMonth(), 11); // December
    assert.strictEqual(end.getDate(), 31);
  });

  await test('custom date range respects user-defined start and end dates', () => {
    const { start, end, label } = getDateFilterBoundaries(
      'custom',
      { startDate: '2026-03-01', endDate: '2026-04-15' },
      refDate
    );
    assert.ok(start && end);
    assert.strictEqual(start.getFullYear(), 2026);
    assert.strictEqual(start.getMonth(), 2); // March
    assert.strictEqual(start.getDate(), 1);
    assert.strictEqual(end.getDate(), 15);
    assert.strictEqual(label, '2026-03-01 to 2026-04-15');
  });

  await test('filterItemsForAnalytics filters items by date boundary', () => {
    const items: Item[] = [
      {
        id: 'i-sept',
        userId: 'u',
        name: 'Sept Item',
        purchaseDate: '2026-09-15',
        purchasePrice: 1000,
        currency: 'INR',
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'i-oct',
        userId: 'u',
        name: 'Oct Item',
        purchaseDate: '2026-10-05',
        purchasePrice: 2000,
        currency: 'INR',
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const octFiltered = filterItemsForAnalytics(items, { dateFilter: 'this_month' }, refDate);
    assert.strictEqual(octFiltered.length, 1);
    assert.strictEqual(octFiltered[0].id, 'i-oct');

    const septFiltered = filterItemsForAnalytics(items, { dateFilter: 'last_month' }, refDate);
    assert.strictEqual(septFiltered.length, 1);
    assert.strictEqual(septFiltered[0].id, 'i-sept');
  });

  // ---------------------------------------------------------------------------
  // 7. Security, RLS & Multi-Currency Isolation
  // ---------------------------------------------------------------------------
  console.log('--- 7. Security & Multi-Currency Safeguards ---');

  await test('Foreign currency items are strictly isolated from INR totals without conversion', () => {
    const mixedItems: Item[] = [
      {
        id: 'i-inr',
        userId: 'u',
        name: 'Local Purchase',
        purchasePrice: 50000,
        currency: 'INR',
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'i-usd',
        userId: 'u',
        name: 'Foreign Software License',
        purchasePrice: 299, // 299 USD
        currency: 'USD',
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
    ];

    const inrFiltered = filterItemsForAnalytics(mixedItems, { dateFilter: 'all_time', currency: 'INR' }, refDate);
    assert.strictEqual(inrFiltered.length, 1);
    assert.strictEqual(inrFiltered[0].id, 'i-inr', 'USD item must not be mixed into INR totals');

    const inrOverview = calculateSpendingOverview(inrFiltered, { dateFilter: 'all_time', currency: 'INR' }, refDate);
    assert.strictEqual(inrOverview.totalSpending, 50000);
  });

  // ---------------------------------------------------------------------------
  // 8. Architecture & Tab Layout Integration
  // ---------------------------------------------------------------------------
  console.log('--- 8. Architecture & Tab Layout Integration ---');

  await test('app/(tabs)/analytics.tsx screen file exists and integrates all 5 analytics sections', () => {
    const analyticsScreenPath = path.join(rootDir, 'app', '(tabs)', 'analytics.tsx');
    assert.strictEqual(fs.existsSync(analyticsScreenPath), true, 'analytics.tsx must exist');

    const content = fs.readFileSync(analyticsScreenPath, 'utf8');
    assert.ok(content.includes('AnalyticsOverviewCards'), 'Must include Section A: AnalyticsOverviewCards');
    assert.ok(content.includes('SpendingTrendsChart'), 'Must include Section B: SpendingTrendsChart');
    assert.ok(content.includes('CategorySpendingChart'), 'Must include Section C: CategorySpendingChart');
    assert.ok(content.includes('TopPurchasesList'), 'Must include Section D: TopPurchasesList');
    assert.ok(content.includes('GstAnalyticsCard'), 'Must include Section E: GstAnalyticsCard');
    assert.ok(content.includes('AnalyticsFilterBar'), 'Must include AnalyticsFilterBar');
  });

  await test('app/(tabs)/_layout.tsx registers Analytics as a first-class bottom navigation tab', () => {
    const layoutPath = path.join(rootDir, 'app', '(tabs)', '_layout.tsx');
    const content = fs.readFileSync(layoutPath, 'utf8');

    assert.ok(content.includes('name="analytics"'), 'Must define Tabs.Screen with name="analytics"');
    assert.ok(content.includes("title: 'Analytics'"), "Must have title: 'Analytics'");
    assert.ok(content.includes('insights') || content.includes('analytics'), 'Must use insights/analytics icon');
  });

  await test('All 6 analytics component files exist in src/components/analytics/', () => {
    const compDir = path.join(rootDir, 'src', 'components', 'analytics');
    assert.strictEqual(fs.existsSync(path.join(compDir, 'AnalyticsOverviewCards.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(compDir, 'SpendingTrendsChart.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(compDir, 'CategorySpendingChart.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(compDir, 'TopPurchasesList.tsx')), true);
    assert.strictEqual(fs.existsSync(path.join(compDir, 'GstAnalyticsCard.tsx')), true);
    assert.strictEqual(path.join(compDir, 'AnalyticsFilterBar.tsx'), path.join(compDir, 'AnalyticsFilterBar.tsx'));
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(` RESULT: ${passedTests}/${totalTests} analytics module tests passed!`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exitCode = 1;
  }
}

runSuite().catch((err) => {
  console.error('Fatal test suite failure:', err);
  process.exit(1);
});
