import assert from 'node:assert';
import {
  isWarrantyEndingSoon,
  isReturnEndingSoon,
  getRemainingWarrantyDays,
  getRemainingReturnDays,
  formatWarrantyBadge,
  formatReturnBadge,
  getDeadlineStatus,
} from '../src/utils/warranty';
import { calculateVaultMetrics } from '../src/utils/ownershipCost';
import { formatDate } from '../src/utils/currency';
import { Item, Warranty } from '../src/types';

console.log('=== KEEPR: WARRANTY & RETURN ENDING FILTER VALIDATION SUITE ===\n');

// Fixed reference date: 2026-10-10
const refDate = new Date();

function formatIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const addDays = (days: number) => {
  const d = new Date(refDate.getTime());
  d.setDate(d.getDate() + days);
  return formatIso(d);
};

const dateToday = addDays(0);
const dateIn5Days = addDays(5);
const dateIn30Days = addDays(30);
const dateIn31Days = addDays(31);
const dateExpiredYesterday = addDays(-1);
const dateExpiredLongAgo = addDays(-365);

console.log('--- Test 1: Warranty Ending Filter Eligibility ---');
{
  const itemEndingToday: Item = {
    id: 'item-war-today',
    userId: 'u1',
    name: 'MacBook Air',
    categoryId: 'electronics',
    purchasePrice: 99990,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    warrantyUntil: dateToday,
  };
  assert.strictEqual(isWarrantyEndingSoon(itemEndingToday, null, refDate), true, 'Ending today must be included');

  const itemEndingIn5d: Item = {
    id: 'item-war-5d',
    userId: 'u1',
    name: 'Sony WH-1000XM5',
    categoryId: 'electronics',
    purchasePrice: 26990,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    warrantyUntil: dateIn5Days,
  };
  assert.strictEqual(isWarrantyEndingSoon(itemEndingIn5d, null, refDate), true, 'Ending in 5 days must be included');

  const itemEndingIn30d: Item = {
    id: 'item-war-30d',
    userId: 'u1',
    name: 'Dell Monitor',
    categoryId: 'electronics',
    purchasePrice: 15000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    warrantyUntil: dateIn30Days,
  };
  assert.strictEqual(isWarrantyEndingSoon(itemEndingIn30d, null, refDate), true, 'Ending in 30 days exact must be included');

  const itemEndingIn31d: Item = {
    id: 'item-war-31d',
    userId: 'u1',
    name: 'iPad Pro',
    categoryId: 'electronics',
    purchasePrice: 80000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    warrantyUntil: dateIn31Days,
  };
  assert.strictEqual(isWarrantyEndingSoon(itemEndingIn31d, null, refDate), false, 'Ending in 31 days must be excluded');

  const itemExpiredYesterday: Item = {
    id: 'item-war-exp-1',
    userId: 'u1',
    name: 'Logitech Mouse',
    categoryId: 'electronics',
    purchasePrice: 3000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    warrantyUntil: dateExpiredYesterday,
  };
  assert.strictEqual(isWarrantyEndingSoon(itemExpiredYesterday, null, refDate), false, 'Expired warranty must be excluded');

  const itemNoWarranty: Item = {
    id: 'item-no-war',
    userId: 'u1',
    name: 'Plain Shirt',
    categoryId: 'fashion',
    purchasePrice: 1500,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    warrantyUntil: null,
  };
  assert.strictEqual(isWarrantyEndingSoon(itemNoWarranty, null, refDate), false, 'Missing warranty must be excluded');

  const itemInvalidDate: Item = {
    id: 'item-invalid-date',
    userId: 'u1',
    name: 'Broken Item',
    categoryId: 'electronics',
    purchasePrice: 2000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    warrantyUntil: 'not-a-date',
  };
  assert.strictEqual(isWarrantyEndingSoon(itemInvalidDate, null, refDate), false, 'Invalid date must be excluded');

  // Linked Warranty entity test
  const itemLinkedWar: Item = {
    id: 'item-linked-war',
    userId: 'u1',
    name: 'Washing Machine',
    categoryId: 'appliances',
    purchasePrice: 35000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    warrantyUntil: null, // stored on separate entity
  };
  assert.strictEqual(isWarrantyEndingSoon(itemLinkedWar, dateIn5Days, refDate), true, 'Linked warranty ending in 5d must be included');
  assert.strictEqual(isWarrantyEndingSoon(itemLinkedWar, dateExpiredYesterday, refDate), false, 'Linked expired warranty must be excluded');

  console.log('✓ All Warranty Ending eligibility checks passed!');
}

console.log('\n--- Test 2: Return Ending Filter Eligibility ---');
{
  const itemReturnToday: Item = {
    id: 'ret-today',
    userId: 'u1',
    name: 'Running Shoes',
    categoryId: 'fashion',
    purchasePrice: 4000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    returnUntil: dateToday,
  };
  assert.strictEqual(isReturnEndingSoon(itemReturnToday, refDate), true, 'Return ending today must be included');

  const itemReturnIn7d: Item = {
    id: 'ret-7d',
    userId: 'u1',
    name: 'Winter Jacket',
    categoryId: 'fashion',
    purchasePrice: 6000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    returnUntil: dateIn5Days,
  };
  assert.strictEqual(isReturnEndingSoon(itemReturnIn7d, refDate), true, 'Return ending in 5d must be included');

  const itemReturnIn30d: Item = {
    id: 'ret-30d',
    userId: 'u1',
    name: 'Coffee Maker',
    categoryId: 'appliances',
    purchasePrice: 8000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    returnUntil: dateIn30Days,
  };
  assert.strictEqual(isReturnEndingSoon(itemReturnIn30d, refDate), true, 'Return ending in 30d must be included');

  const itemReturnIn31d: Item = {
    id: 'ret-31d',
    userId: 'u1',
    name: 'Camera Lens',
    categoryId: 'electronics',
    purchasePrice: 45000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    returnUntil: dateIn31Days,
  };
  assert.strictEqual(isReturnEndingSoon(itemReturnIn31d, refDate), false, 'Return ending in 31d must be excluded');

  const itemReturnExpired: Item = {
    id: 'ret-exp',
    userId: 'u1',
    name: 'Earphones',
    categoryId: 'electronics',
    purchasePrice: 1500,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    returnUntil: dateExpiredYesterday,
  };
  assert.strictEqual(isReturnEndingSoon(itemReturnExpired, refDate), false, 'Expired return must be excluded');

  const itemNoReturn: Item = {
    id: 'ret-none',
    userId: 'u1',
    name: 'Book',
    categoryId: 'other',
    purchasePrice: 500,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    returnUntil: null,
  };
  assert.strictEqual(isReturnEndingSoon(itemNoReturn, refDate), false, 'Missing return date must be excluded');

  const itemInvalidReturn: Item = {
    id: 'ret-inv',
    userId: 'u1',
    name: 'Lamp',
    categoryId: 'furniture',
    purchasePrice: 1200,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    returnUntil: 'invalid-string',
  };
  assert.strictEqual(isReturnEndingSoon(itemInvalidReturn, refDate), false, 'Invalid return date must be excluded');

  console.log('✓ All Return Ending eligibility checks passed!');
}

console.log('\n--- Test 3: Dashboard Counts Exactly Match Filtered Lists ---');
{
  const mockItems: Item[] = [
    // 2 items with warranty ending soon:
    {
      id: 'i1',
      userId: 'u1',
      name: 'Item 1 (War 5d)',
      categoryId: 'electronics',
      purchasePrice: 10000,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      warrantyUntil: dateIn5Days,
    },
    {
      id: 'i2',
      userId: 'u1',
      name: 'Item 2 (War Today)',
      categoryId: 'electronics',
      purchasePrice: 20000,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      warrantyUntil: dateToday,
      returnUntil: dateIn5Days, // also has return ending soon
    },
    // 1 item with warranty expiring >30d (active, but not ending soon):
    {
      id: 'i3',
      userId: 'u1',
      name: 'Item 3 (War 31d)',
      categoryId: 'electronics',
      purchasePrice: 30000,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      warrantyUntil: dateIn31Days,
    },
    // 1 item with warranty already expired:
    {
      id: 'i4',
      userId: 'u1',
      name: 'Item 4 (War Expired)',
      categoryId: 'electronics',
      purchasePrice: 5000,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      warrantyUntil: dateExpiredYesterday,
    },
    // 1 item with return ending soon:
    {
      id: 'i5',
      userId: 'u1',
      name: 'Item 5 (Return Today)',
      categoryId: 'fashion',
      purchasePrice: 2500,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-10-01',
      updatedAt: '2026-10-01',
      returnUntil: dateToday,
    },
    // 1 item with return expired:
    {
      id: 'i6',
      userId: 'u1',
      name: 'Item 6 (Return Expired)',
      categoryId: 'fashion',
      purchasePrice: 1200,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      returnUntil: dateExpiredYesterday,
    },
    // 1 disposed item (must be ignored everywhere):
    {
      id: 'i7',
      userId: 'u1',
      name: 'Item 7 (Disposed)',
      categoryId: 'electronics',
      purchasePrice: 8000,
      currency: 'INR',
      status: 'disposed',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      warrantyUntil: dateIn5Days,
      returnUntil: dateIn5Days,
    },
  ];

  const mockWarranties: Warranty[] = [];

  const metrics = calculateVaultMetrics(mockItems, mockWarranties, [], [], []);

  // Filter items screen simulation:
  const activeItems = mockItems.filter(
    (i) => i.status !== 'disposed' && (i.status as string) !== 'deleted'
  );

  const filteredWarrantyItems = activeItems.filter((i) =>
    isWarrantyEndingSoon(i, undefined, refDate)
  );

  const filteredReturnItems = activeItems.filter((i) =>
    isReturnEndingSoon(i, refDate)
  );

  console.log(`Dashboard warrantiesEndingSoon: ${metrics.warrantiesEndingSoon}`);
  console.log(`Filtered warranty items count:  ${filteredWarrantyItems.length}`);
  assert.strictEqual(
    metrics.warrantiesEndingSoon,
    filteredWarrantyItems.length,
    'Dashboard warranty ending count must match filtered item count exactly'
  );
  assert.strictEqual(metrics.warrantiesEndingSoon, 2, 'Expected exactly 2 warranty ending items (i1, i2)');
  assert.deepStrictEqual(
    filteredWarrantyItems.map((i) => i.id).sort(),
    ['i1', 'i2'],
    'Correct items matched for warranty ending'
  );

  console.log(`Dashboard returnsEndingSoon:    ${metrics.returnsEndingSoon}`);
  console.log(`Filtered return items count:    ${filteredReturnItems.length}`);
  assert.strictEqual(
    metrics.returnsEndingSoon,
    filteredReturnItems.length,
    'Dashboard return ending count must match filtered item count exactly'
  );
  assert.strictEqual(metrics.returnsEndingSoon, 2, 'Expected exactly 2 return ending items (i2, i5)');
  assert.deepStrictEqual(
    filteredReturnItems.map((i) => i.id).sort(),
    ['i2', 'i5'],
    'Correct items matched for return ending'
  );

  console.log('✓ Dashboard count and filtered list match perfectly!');
}

console.log('\n--- Test 4: Zero-Count State Consistency ---');
{
  const emptyItems: Item[] = [
    {
      id: 'z1',
      userId: 'u1',
      name: 'Shirt without dates',
      categoryId: 'fashion',
      purchasePrice: 1000,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  const metrics = calculateVaultMetrics(emptyItems, [], [], [], []);
  assert.strictEqual(metrics.warrantiesEndingSoon, 0, 'Zero warranty count');
  assert.strictEqual(metrics.returnsEndingSoon, 0, 'Zero return count');

  const filteredWarranty = emptyItems.filter((i) => isWarrantyEndingSoon(i, undefined, refDate));
  const filteredReturn = emptyItems.filter((i) => isReturnEndingSoon(i, refDate));

  assert.strictEqual(filteredWarranty.length, 0);
  assert.strictEqual(filteredReturn.length, 0);
  console.log('✓ Zero-count state produces exactly 0 filtered items on both cards');
}

console.log('\n--- Test 5: Badge Presentation (Remaining Days & Expiry Date) ---');
{
  const badge0d = formatWarrantyBadge(dateToday);
  assert.strictEqual(badge0d.status, 'expiring_soon');
  assert.strictEqual(badge0d.label, 'Warranty ends today');

  const badge5d = formatWarrantyBadge(dateIn5Days);
  assert.strictEqual(badge5d.status, 'expiring_soon');
  assert.strictEqual(badge5d.label, '5d warranty left');

  const badge30d = formatWarrantyBadge(dateIn30Days);
  assert.strictEqual(badge30d.status, 'expiring_soon');
  assert.strictEqual(badge30d.label, '30d warranty left');

  const badgeExpired = formatWarrantyBadge(dateExpiredYesterday);
  assert.strictEqual(badgeExpired.status, 'expired');
  assert.strictEqual(badgeExpired.label, 'Warranty ended');

  const retBadge0d = formatReturnBadge(dateToday);
  assert.strictEqual(retBadge0d.status, 'expiring_soon');
  assert.strictEqual(retBadge0d.label, 'Return ends today');

  const retBadge5d = formatReturnBadge(dateIn5Days);
  assert.strictEqual(retBadge5d.label, '5d return left');

  const retBadgeExpired = formatReturnBadge(dateExpiredYesterday);
  assert.strictEqual(retBadgeExpired.status, 'expired');
  assert.strictEqual(retBadgeExpired.label, 'Return ended');

  // Formatted date check
  const formatted5d = formatDate(dateIn5Days, 'short');
  assert.ok(formatted5d.includes('2026'), 'Date format includes year');
  console.log(`Sample badge output: "${badge5d.label} · ${formatted5d}"`);
  console.log('✓ Badge displays remaining days and formatted dates correctly!');
}

console.log('\n--- Test 6: Filter Switching & State Transitions ---');
{
  type QuickFilter = 'warranty_ending' | 'return_ending' | null;

  // Simulate user navigation events:
  let quickFilter: QuickFilter = null;

  // 1. User taps Warranty ending on dashboard
  function onParamsReceived(paramFilter?: string) {
    if (paramFilter === 'warranty_ending') quickFilter = 'warranty_ending';
    else if (paramFilter === 'return_ending') quickFilter = 'return_ending';
    else if (paramFilter === 'all') quickFilter = null;
  }

  onParamsReceived('warranty_ending');
  assert.strictEqual(quickFilter, 'warranty_ending', 'Switched to warranty_ending');

  // 2. User taps Return ending on dashboard while screen is mounted
  onParamsReceived('return_ending');
  assert.strictEqual(quickFilter, 'return_ending', 'Switched to return_ending');

  // 3. User taps Items on dashboard (unfiltered)
  onParamsReceived('all');
  assert.strictEqual(quickFilter, null, 'Cleared stale filter when navigating to Items');

  // 4. User manually clears filter on items screen
  quickFilter = 'warranty_ending';
  function handleClear() {
    quickFilter = null;
  }
  handleClear();
  assert.strictEqual(quickFilter, null, 'Clear button resets filter');

  console.log('✓ Filter transitions and stale state clearing verified!');
}

console.log('\n--- Test 7: Navigation Lifecycle & Route Segments Auto-Clear Scenarios ---');
{
  type QuickFilter = 'warranty_ending' | 'return_ending' | null;

  class ItemsScreenSimulator {
    quickFilter: QuickFilter = null;
    routeParams: { filter?: string; t?: string } = {};
    lastHandledParam: string | null = null;
    activeSegments: string[] = ['(tabs)', 'index']; // Starts at Vault

    clearQuickFilterState() {
      this.quickFilter = null;
      this.lastHandledParam = '_';
      this.routeParams = {};
    }

    // Handles incoming route params (e.g. from router.push)
    onParamsReceived(params: { filter?: string; t?: string }) {
      this.routeParams = { ...params };
      const paramKey = `${this.routeParams.filter || ''}_${this.routeParams.t || ''}`;
      if (paramKey === this.lastHandledParam) return;
      this.lastHandledParam = paramKey;

      if (this.routeParams.filter === 'warranty_ending') {
        this.quickFilter = 'warranty_ending';
      } else if (this.routeParams.filter === 'return_ending') {
        this.quickFilter = 'return_ending';
      } else if (this.routeParams.filter === 'all') {
        this.clearQuickFilterState();
      }
    }

    // Handles route segment / tab navigation changes
    onRouteSegmentChange(newSegments: string[]) {
      this.activeSegments = newSegments;
      const isOtherTab =
        (this.activeSegments[0] === '(tabs)' && this.activeSegments[1] !== 'items') ||
        this.activeSegments[0] === '(auth)';

      if (isOtherTab && this.quickFilter !== null) {
        this.clearQuickFilterState();
      }
    }

    // Handles user pressing the 'Items' tab on the bottom tab bar
    onItemsTabPress() {
      if (this.quickFilter !== null) {
        this.clearQuickFilterState();
      }
      this.onRouteSegmentChange(['(tabs)', 'items']);
    }

    // Computes visible items based on current quickFilter
    getVisibleItems(mockItems: Item[]): Item[] {
      return mockItems.filter((item) => {
        if (this.quickFilter === 'warranty_ending') {
          return isWarrantyEndingSoon(item, undefined, refDate);
        }
        if (this.quickFilter === 'return_ending') {
          return isReturnEndingSoon(item, refDate);
        }
        return true;
      });
    }
  }

  const allActiveItems: Item[] = [
    {
      id: 'i1',
      userId: 'u1',
      name: 'Item 1 (War 5d)',
      categoryId: 'electronics',
      purchasePrice: 10000,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      warrantyUntil: dateIn5Days,
    },
    {
      id: 'i2',
      userId: 'u1',
      name: 'Item 2 (War Today & Ret 5d)',
      categoryId: 'electronics',
      purchasePrice: 20000,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      warrantyUntil: dateToday,
      returnUntil: dateIn5Days,
    },
    {
      id: 'i3',
      userId: 'u1',
      name: 'Item 3 (Active >30d)',
      categoryId: 'electronics',
      purchasePrice: 30000,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      warrantyUntil: dateIn31Days,
    },
    {
      id: 'i5',
      userId: 'u1',
      name: 'Item 5 (Return Today)',
      categoryId: 'fashion',
      purchasePrice: 2500,
      currency: 'INR',
      status: 'active',
      createdAt: '2026-10-01',
      updatedAt: '2026-10-01',
      returnUntil: dateToday,
    },
  ];

  const screen = new ItemsScreenSimulator();

  // Scenario 1: Vault → Warranty Ending → matching items appear.
  screen.onRouteSegmentChange(['(tabs)', 'items']);
  screen.onParamsReceived({ filter: 'warranty_ending', t: '1001' });
  assert.strictEqual(screen.quickFilter, 'warranty_ending', 'Scenario 1: Filter is warranty_ending');
  let visible = screen.getVisibleItems(allActiveItems);
  assert.deepStrictEqual(visible.map(i => i.id).sort(), ['i1', 'i2'], 'Scenario 1: Only items expiring soon appear (i1, i2)');

  // Scenario 2: Switch to Documents → return to Vault → all items are visible.
  screen.onRouteSegmentChange(['(tabs)', 'documents']);
  assert.strictEqual(screen.quickFilter, null, 'Scenario 2: Quick filter auto-cleared when switching to Documents');
  assert.strictEqual(screen.routeParams.filter, undefined, 'Scenario 2: Route params cleared');
  screen.onRouteSegmentChange(['(tabs)', 'index']); // Return to Vault
  assert.strictEqual(screen.quickFilter, null, 'Scenario 2: Quick filter stays cleared when returning to Vault');
  screen.onRouteSegmentChange(['(tabs)', 'items']); // Navigate to Items
  visible = screen.getVisibleItems(allActiveItems);
  assert.strictEqual(visible.length, allActiveItems.length, 'Scenario 2: All items are visible');

  // Scenario 3: Vault → Return Ending → matching items appear.
  screen.onRouteSegmentChange(['(tabs)', 'items']);
  screen.onParamsReceived({ filter: 'return_ending', t: '1002' });
  assert.strictEqual(screen.quickFilter, 'return_ending', 'Scenario 3: Filter is return_ending');
  visible = screen.getVisibleItems(allActiveItems);
  assert.deepStrictEqual(visible.map(i => i.id).sort(), ['i2', 'i5'], 'Scenario 3: Only return items appear (i2, i5)');

  // Scenario 4: Switch to Services or another main tab → return to Vault → all items are visible.
  screen.onRouteSegmentChange(['(tabs)', 'services']);
  assert.strictEqual(screen.quickFilter, null, 'Scenario 4: Quick filter auto-cleared when switching to Services');
  screen.onRouteSegmentChange(['(tabs)', 'index']); // Return to Vault
  screen.onRouteSegmentChange(['(tabs)', 'items']); // Enter Items
  visible = screen.getVisibleItems(allActiveItems);
  assert.strictEqual(visible.length, allActiveItems.length, 'Scenario 4: All items are visible');

  // Scenario 5: Open an item detail from a filtered list → go back → the filter remains active.
  screen.onParamsReceived({ filter: 'warranty_ending', t: '1003' });
  assert.strictEqual(screen.quickFilter, 'warranty_ending');
  // Open item detail screen (leaves (tabs) to root stack ['item', '[id]'])
  screen.onRouteSegmentChange(['item', 'i1']);
  assert.strictEqual(screen.quickFilter, 'warranty_ending', 'Scenario 5: Filter preserved while viewing item detail');
  // User navigates back from item detail screen
  screen.onRouteSegmentChange(['(tabs)', 'items']);
  assert.strictEqual(screen.quickFilter, 'warranty_ending', 'Scenario 5: Filter still active after returning from item detail');
  visible = screen.getVisibleItems(allActiveItems);
  assert.deepStrictEqual(visible.map(i => i.id).sort(), ['i1', 'i2'], 'Scenario 5: Matching items still filtered');

  // Scenario 6: Tap Items from the dashboard → all items appear.
  screen.onParamsReceived({ filter: 'all', t: '1004' });
  assert.strictEqual(screen.quickFilter, null, 'Scenario 6: Tapping Items dashboard card clears filter');
  visible = screen.getVisibleItems(allActiveItems);
  assert.strictEqual(visible.length, allActiveItems.length, 'Scenario 6: All items appear');

  // Scenario 7: Switch between Warranty Ending and Return Ending → the selected filter updates correctly.
  screen.onParamsReceived({ filter: 'warranty_ending', t: '1005' });
  assert.strictEqual(screen.quickFilter, 'warranty_ending', 'Scenario 7: Set to warranty_ending');
  screen.onParamsReceived({ filter: 'return_ending', t: '1006' });
  assert.strictEqual(screen.quickFilter, 'return_ending', 'Scenario 7: Directly updated to return_ending');
  visible = screen.getVisibleItems(allActiveItems);
  assert.deepStrictEqual(visible.map(i => i.id).sort(), ['i2', 'i5'], 'Scenario 7: Matches return ending items');

  // Scenario 8: Tapping Items tab on bottom bar while on filtered view clears filter.
  screen.onItemsTabPress();
  assert.strictEqual(screen.quickFilter, null, 'Scenario 8: Tab press clears filter');
  visible = screen.getVisibleItems(allActiveItems);
  assert.strictEqual(visible.length, allActiveItems.length, 'Scenario 8: All items appear after tab press');

  console.log('✓ All 7 navigation lifecycle scenarios validated perfectly!');
}

console.log('\n--- Test 8: Needs Attention & Expiry Status Verification ---');
{
  // 1. Missing or invalid dates must not be treated as expired
  const warInvalid = formatWarrantyBadge('invalid-date');
  assert.strictEqual(warInvalid.status, 'none');
  assert.strictEqual(warInvalid.label, 'No warranty');

  const retInvalid = formatReturnBadge('invalid-date');
  assert.strictEqual(retInvalid.status, 'none');
  assert.strictEqual(retInvalid.label, 'No return date');

  // 2. Deadline status check: today's deadlines not marked expired
  const itemEndingToday: Item = {
    id: 'it-today',
    userId: 'u1',
    name: 'AirPods Max',
    categoryId: 'electronics',
    purchasePrice: 59900,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    warrantyUntil: dateToday,
    returnUntil: dateToday,
  };
  const statusToday = getDeadlineStatus(itemEndingToday, null, refDate);
  assert.strictEqual(statusToday.isWarrantyExpired, false, 'Today is not expired warranty');
  assert.strictEqual(statusToday.isReturnExpired, false, 'Today is not expired return');
  assert.strictEqual(statusToday.warrantyStatusText, 'Warranty ends today');
  assert.strictEqual(statusToday.returnStatusText, 'Return ends today');
  assert.strictEqual(statusToday.hasUpcomingWarranty, true);
  assert.strictEqual(statusToday.hasUpcomingReturn, true);

  // 3. Expired status text verification
  const itemExpired: Item = {
    id: 'it-exp',
    userId: 'u1',
    name: 'Old Keyboard',
    categoryId: 'electronics',
    purchasePrice: 4000,
    currency: 'INR',
    status: 'active',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    warrantyUntil: dateExpiredYesterday,
    returnUntil: dateExpiredYesterday,
  };
  const statusExp = getDeadlineStatus(itemExpired, null, refDate);
  assert.strictEqual(statusExp.isWarrantyExpired, true);
  assert.strictEqual(statusExp.isReturnExpired, true);
  assert.strictEqual(statusExp.warrantyStatusText, 'Warranty ended');
  assert.strictEqual(statusExp.returnStatusText, 'Return ended');
  assert.strictEqual(statusExp.hasUpcomingWarranty, false, 'Expired warranty must NOT be upcoming');
  assert.strictEqual(statusExp.hasUpcomingReturn, false, 'Expired return must NOT be upcoming');

  // 4. Needs Attention carousel item extraction simulation
  function computePriorityItems(itemsList: Item[], warList: Warranty[]) {
    const list: any[] = [];
    for (const item of itemsList) {
      const w = warList.find((war) => war.itemId === item.id);
      const status = getDeadlineStatus(item, w?.endDate, refDate);

      if (status.hasUpcomingReturn && !status.isReturnExpired && status.returnDaysRemaining >= 0) {
        list.push({
          id: `urgent-return-${item.id}`,
          itemId: item.id,
          type: 'return',
          urgentLabel: status.returnDaysRemaining === 0 ? 'Return Ends Today' : `Return Ends in ${status.returnDaysRemaining}d`,
        });
      }

      if (status.hasUpcomingWarranty && !status.isWarrantyExpired && status.warrantyDaysRemaining >= 0) {
        list.push({
          id: `urgent-war-${w?.id || item.id}`,
          itemId: item.id,
          type: 'warranty',
          urgentLabel: status.warrantyDaysRemaining === 0 ? 'Warranty Ends Today' : `Expires in ${status.warrantyDaysRemaining}d`,
        });
      }
    }
    return list;
  }

  // 4a. Expired entries disappear from Needs Attention
  const priorityExpired = computePriorityItems([itemExpired], []);
  assert.strictEqual(priorityExpired.length, 0, 'Expired item must have 0 priority items in Needs Attention');

  // 4b. An item with one expired deadline and one active deadline retains only the active one
  const itemMixed: Item = {
    id: 'it-mixed',
    userId: 'u1',
    name: 'Smart Watch',
    categoryId: 'electronics',
    purchasePrice: 25000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    returnUntil: dateExpiredYesterday, // Return period ended
    warrantyUntil: dateIn5Days, // Warranty ends in 5 days
  };
  const priorityMixed = computePriorityItems([itemMixed], []);
  assert.strictEqual(priorityMixed.length, 1, 'Only 1 priority item retained');
  assert.strictEqual(priorityMixed[0].type, 'warranty', 'Only active warranty retained');
  assert.strictEqual(priorityMixed[0].urgentLabel, 'Expires in 5d');

  // 4c. Opposite mixed: active return, expired warranty
  const itemMixed2: Item = {
    id: 'it-mixed-2',
    userId: 'u1',
    name: 'Jacket',
    categoryId: 'fashion',
    purchasePrice: 5000,
    currency: 'INR',
    status: 'active',
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    returnUntil: dateIn5Days, // Return ends in 5 days
    warrantyUntil: dateExpiredYesterday, // Expired warranty
  };
  const priorityMixed2 = computePriorityItems([itemMixed2], []);
  assert.strictEqual(priorityMixed2.length, 1, 'Only 1 priority item retained');
  assert.strictEqual(priorityMixed2[0].type, 'return', 'Only active return retained');
  assert.strictEqual(priorityMixed2[0].urgentLabel, 'Return Ends in 5d');

  // 4d. Item with today's deadlines:
  const priorityToday = computePriorityItems([itemEndingToday], []);
  assert.strictEqual(priorityToday.length, 2, 'Both same-day items present');
  assert.strictEqual(priorityToday.some((p) => p.urgentLabel === 'Warranty Ends Today'), true);
  assert.strictEqual(priorityToday.some((p) => p.urgentLabel === 'Return Ends Today'), true);

  // 5. Preserving records: items, receipts, documents untouched
  assert.strictEqual(itemExpired.name, 'Old Keyboard');
  assert.strictEqual(itemExpired.status, 'active');
  assert.strictEqual(itemExpired.warrantyUntil, dateExpiredYesterday);

  console.log('✓ All Needs Attention & Expired Status rules verified!');
}

console.log('\n======================================================');
console.log('ALL TESTS PASSED SUCCESSFULLY! (100% test assertions valid)');
console.log('======================================================');
