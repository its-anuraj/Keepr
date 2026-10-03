
import {
  Expense,
  Item,
  MaintenanceRecord,
  VaultDocument,
  VaultMetrics,
  Warranty,
} from '../types';
import { getWarrantyStatus, getReturnStatus, getCategoryCapabilities } from './warranty';

/**
 * Computes live portfolio metrics across all cataloged items and documents.
 */
export function calculateVaultMetrics(
  items: Item[],
  warranties: Warranty[],
  maintenanceRecords: MaintenanceRecord[],
  expenses: Expense[],
  documents: VaultDocument[] = []
): VaultMetrics {
  const activeItems = items.filter((i) => i.status !== 'disposed');

  const totalReplacementValue = activeItems.reduce(
    (sum, i) => sum + (Number(i.purchasePrice) || 0),
    0
  );

  let activeWarrantiesCount = 0;
  let expiringWarrantiesCount = 0;

  for (const w of warranties) {
    const item = items.find((i) => i.id === w.itemId);
    if (item) {
      const caps = getCategoryCapabilities(item.categoryId || item.category, item.productType, Boolean(w.endDate));
      if (!caps.warrantySupported) continue;
    }

    const status = getWarrantyStatus(w.endDate);
    if (status === 'active') {
      activeWarrantiesCount++;
    } else if (status === 'expiring_soon') {
      expiringWarrantiesCount++;
      activeWarrantiesCount++; // Expiring soon is still technically active
    }
  }

  const now = new Date();
  const upcomingMaintenanceCount = maintenanceRecords.filter((m) => {
    if (m.status === 'scheduled') return true;
    if (!m.nextServiceDate) return false;
    const nextDate = new Date(m.nextServiceDate);
    const diffDays = Math.ceil(
      (nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    return diffDays >= 0 && diffDays <= 14;
  }).length;

  const totalOwnershipExpenses =
    expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0) +
    maintenanceRecords.reduce((sum, m) => sum + (Number(m.cost) || 0), 0);

  const currentYearMonth = `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, '0')}`;

  const eventsThisMonth =
    items.filter((i) => i.createdAt.startsWith(currentYearMonth)).length +
    expenses.filter((e) => e.expenseDate.startsWith(currentYearMonth)).length +
    maintenanceRecords.filter((m) =>
      m.serviceDate.startsWith(currentYearMonth)
    ).length;

  let returnsEndingSoon = 0;
  for (const item of activeItems) {
    if (item.returnUntil) {
      const returnStatus = getReturnStatus(item.returnUntil);
      if (returnStatus === 'expiring_soon') {
        returnsEndingSoon++;
      }
    }
  }

  return {
    totalItems: activeItems.length,
    totalDocuments: (documents || []).length,
    returnsEndingSoon,
    warrantiesEndingSoon: expiringWarrantiesCount,
    totalReplacementValue,
    itemsTrackedCount: activeItems.length,
    activeWarrantiesCount,
    expiringWarrantiesCount,
    upcomingMaintenanceCount,
    totalOwnershipExpenses,
    totalEventsThisMonth: eventsThisMonth,
  };
}

/**
 * Calculates Total Cost of Ownership (TCO) breakdown for a single item.
 */
export function calculateItemTCO(
  item: Item,
  expenses: Expense[] = [],
  maintenanceRecords: MaintenanceRecord[] = []
): {
  totalCost: number;
  hardwareCost: number;
  upkeepCost: number;
  hardwarePercent: number;
  upkeepPercent: number;
} {
  const hardwareCost = Number(item.purchasePrice) || 0;
  const upkeepCost =
    expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0) +
    maintenanceRecords.reduce((sum, m) => sum + (Number(m.cost) || 0), 0);
  const totalCost = hardwareCost + upkeepCost;
  const hardwarePercent = totalCost > 0 ? (hardwareCost / totalCost) * 100 : 100;
  const upkeepPercent = totalCost > 0 ? (upkeepCost / totalCost) * 100 : 0;

  return {
    totalCost,
    hardwareCost,
    upkeepCost,
    hardwarePercent,
    upkeepPercent,
  };
}
