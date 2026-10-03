
import { WarrantyStatus, ReturnStatus, ItemCategory } from '../types';
import { formatDate, parseFlexibleDate } from './currency';

/**
 * Category capabilities interface defining feature applicability.
 */
export interface CategoryCapabilities {
  /** Whether warranty is applicable/supported for this item */
  warrantySupported: boolean;
  /** Whether to show "[ No warranty ]" badge if warranty date is missing */
  showNoWarrantyPlaceholder: boolean;
  /** Whether return window tracking is supported */
  returnSupported: boolean;
}

/**
 * Centralized helper determining feature capabilities per category & product type.
 *
 * Rules:
 * - If explicit warranty date exists: always preserve & show warranty.
 * - Electronics & Home Appliances: standard warranty categories (shows "No warranty" if null).
 * - Fashion & Beauty: warranty NOT shown by default (suppressed completely).
 * - Vehicle, Furniture, Sports, Other: warranty only shown when explicit warranty date exists.
 * - Return window tracking is supported across all retail categories.
 */
export function getCategoryCapabilities(
  category?: string | ItemCategory | null,
  productType?: string | null,
  hasExplicitWarrantyDate: boolean = false,
  hasExplicitReturnDate: boolean = false
): CategoryCapabilities {
  let catStr = '';
  if (category) {
    if (typeof category === 'object' && category.id) {
      catStr = `${category.id} ${category.name || ''}`.toLowerCase();
    } else if (typeof category === 'string') {
      catStr = category.toLowerCase();
    }
  }
  const pTypeStr = (productType || '').toLowerCase();

  const isVehicle =
    catStr.includes('vehicle') ||
    catStr.includes('automobile') ||
    /\b(car|cars|bike|bikes|motorcycle|scooter)\b/i.test(catStr) ||
    /\b(car|cars|bike|bikes|motorcycle|scooter)\b/i.test(pTypeStr);

  if (isVehicle) {
    return {
      warrantySupported: hasExplicitWarrantyDate,
      showNoWarrantyPlaceholder: false,
      returnSupported: hasExplicitReturnDate,
    };
  }

  if (hasExplicitWarrantyDate) {
    return {
      warrantySupported: true,
      showNoWarrantyPlaceholder: false,
      returnSupported: true,
    };
  }

  const isFashion =
    catStr.includes('fashion') ||
    catStr.includes('clothing') ||
    catStr.includes('apparel') ||
    pTypeStr.includes('clothing') ||
    pTypeStr.includes('shoe') ||
    pTypeStr.includes('bag') ||
    pTypeStr.includes('dress') ||
    pTypeStr.includes('shirt') ||
    pTypeStr.includes('pant') ||
    pTypeStr.includes('jeans') ||
    pTypeStr.includes('jacket') ||
    pTypeStr.includes('accessory');

  const isBeauty =
    catStr.includes('beauty') ||
    catStr.includes('personal care') ||
    catStr.includes('personal_care') ||
    pTypeStr.includes('skincare') ||
    pTypeStr.includes('haircare') ||
    pTypeStr.includes('makeup') ||
    pTypeStr.includes('cosmetic') ||
    pTypeStr.includes('perfume') ||
    pTypeStr.includes('fragrance');

  if (isFashion || isBeauty) {
    return {
      warrantySupported: false,
      showNoWarrantyPlaceholder: false,
      returnSupported: true,
    };
  }

  const isElectronics =
    catStr.includes('electronic') ||
    catStr.includes('mobile_laptop') ||
    pTypeStr.includes('mobile') ||
    pTypeStr.includes('laptop') ||
    pTypeStr.includes('computer') ||
    pTypeStr.includes('tv') ||
    pTypeStr.includes('tablet') ||
    pTypeStr.includes('headphone') ||
    pTypeStr.includes('camera') ||
    pTypeStr.includes('smartwatch');

  const isAppliances =
    catStr.includes('appliance') ||
    catStr.includes('kitchen') ||
    pTypeStr.includes('refrigerator') ||
    pTypeStr.includes('washing machine') ||
    pTypeStr.includes('microwave') ||
    pTypeStr.includes('air conditioner') ||
    pTypeStr.includes('ac') ||
    pTypeStr.includes('cooler') ||
    pTypeStr.includes('vacuum');

  if (isElectronics || isAppliances) {
    return {
      warrantySupported: true,
      showNoWarrantyPlaceholder: true,
      returnSupported: true,
    };
  }

  return {
    warrantySupported: false,
    showNoWarrantyPlaceholder: false,
    returnSupported: true,
  };
}

/**
 * Calculates the exact warranty expiry date given a purchase/start date
 * and duration in months.
 */
export function calculateWarrantyExpiry(
  startDateStr: string,
  durationMonths: number
): string {
  const startDate = parseFlexibleDate(startDateStr);
  if (!startDate || isNaN(startDate.getTime())) {
    return startDateStr;
  }

  const expiryDate = new Date(startDate);
  expiryDate.setMonth(expiryDate.getMonth() + durationMonths);
  return expiryDate.toISOString().split('T')[0];
}

/**
 * Calculates the number of whole days remaining until the warranty end date.
 * A negative return indicates the warranty has already expired.
 */
export function getRemainingWarrantyDays(
  endDateStr: string,
  referenceDate: Date = new Date()
): number {
  const endDate = parseFlexibleDate(endDateStr);
  if (!endDate || isNaN(endDate.getTime())) {
    return 0;
  }

  // Normalize reference date to start of day for deterministic comparison
  const refStart = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const endStart = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate()
  );

  const diffMs = endStart.getTime() - refStart.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Derives the semantic warranty status from remaining days:
 * - 'expired': < 0 days remaining
 * - 'expiring_soon': between 0 and 30 days remaining
 * - 'active': > 30 days remaining
 * - 'none': no valid end date
 */
export function getWarrantyStatus(endDateStr?: string | null): WarrantyStatus {
  if (!endDateStr) return 'none';
  const remainingDays = getRemainingWarrantyDays(endDateStr);
  if (remainingDays < 0) return 'expired';
  if (remainingDays <= 30) return 'expiring_soon';
  return 'active';
}

/**
 * Computes elapsed warranty percentage (0% to 100%) for visual gauge tracking.
 */
export function getWarrantyProgressPercent(
  startDateStr: string,
  endDateStr: string,
  referenceDate: Date = new Date()
): number {
  const startDate = parseFlexibleDate(startDateStr);
  const endDate = parseFlexibleDate(endDateStr);
  const start = startDate ? startDate.getTime() : NaN;
  const end = endDate ? endDate.getTime() : NaN;
  const now = referenceDate.getTime();

  if (isNaN(start) || isNaN(end) || end <= start) {
    return 100;
  }

  if (now <= start) return 0;
  if (now >= end) return 100;

  const elapsed = now - start;
  const total = end - start;
  const percent = Math.round((elapsed / total) * 100);
  return Math.min(100, Math.max(0, percent));
}

/**
 * Returns human-readable presentation metadata for remaining warranty duration.
 *
 * States:
 * - Active: "● 2758d warranty left"
 * - Ending soon: "● Warranty ending soon"
 * - Ends today: "● Warranty ends today"
 * - Expired: "● Warranty expired" (Never generic "Expired")
 * - Missing: "● No warranty" (When applicable) or suppressed
 */
export function formatWarrantyBadge(
  endDateStr?: string | null,
  isApplicable: boolean = true
): {
  status: WarrantyStatus;
  label: string;
  subtext: string;
  daysRemaining: number;
} {
  if (!isApplicable && !endDateStr) {
    return {
      status: 'none',
      label: '',
      subtext: '',
      daysRemaining: 0,
    };
  }

  if (!endDateStr) {
    return {
      status: 'none',
      label: 'No warranty',
      subtext: 'Add protection plan',
      daysRemaining: 0,
    };
  }

  const days = getRemainingWarrantyDays(endDateStr);

  if (days < 0) {
    const expiredDaysAgo = Math.abs(days);
    return {
      status: 'expired',
      label: 'Warranty expired',
      subtext: `Expired ${expiredDaysAgo}d ago`,
      daysRemaining: days,
    };
  }

  if (days === 0) {
    return {
      status: 'expiring_soon',
      label: 'Warranty ends today',
      subtext: 'Warranty ends today',
      daysRemaining: 0,
    };
  }

  if (days <= 30) {
    return {
      status: 'expiring_soon',
      label: 'Warranty ending soon',
      subtext: `${days} days left`,
      daysRemaining: days,
    };
  }

  const months = Math.floor(days / 30);
  return {
    status: 'active',
    label: `${days}d warranty left`,
    subtext: months > 0 ? `${months} mos remaining` : `${days} days remaining`,
    daysRemaining: days,
  };
}

/**
 * Calculates the number of days remaining for the return window.
 * Returns negative if expired.
 */
export function getRemainingReturnDays(
  returnUntilStr?: string | null,
  referenceDate: Date = new Date()
): number {
  if (!returnUntilStr) return 0;
  const returnDate = parseFlexibleDate(returnUntilStr);
  if (!returnDate || isNaN(returnDate.getTime())) return 0;

  const refStart = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const endStart = new Date(
    returnDate.getFullYear(),
    returnDate.getMonth(),
    returnDate.getDate()
  );

  const diffMs = endStart.getTime() - refStart.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Derives the semantic return status:
 * - 'none': no return deadline set
 * - 'expired': deadline has passed (< 0)
 * - 'expiring_soon': 0 to 3 days remaining
 * - 'active': more than 3 days remaining
 */
export function getReturnStatus(returnUntilStr?: string | null): ReturnStatus {
  if (!returnUntilStr) return 'none';
  const remaining = getRemainingReturnDays(returnUntilStr);
  if (remaining < 0) return 'expired';
  if (remaining <= 3) return 'expiring_soon';
  return 'active';
}

/**
 * Formats a clean, user-friendly badge for return window status.
 *
 * States:
 * - No return date: "No return date"
 * - Active: "X days left" or "Xd return left"
 * - Ends today: "Return ends today"
 * - Expired: "Return period ended" (Never "Expired")
 */
export function formatReturnBadge(returnUntilStr?: string | null): {
  status: ReturnStatus;
  label: string;
  subtext: string;
  daysRemaining: number;
} {
  if (!returnUntilStr) {
    return {
      status: 'none',
      label: 'No return date',
      subtext: '',
      daysRemaining: 0,
    };
  }

  const days = getRemainingReturnDays(returnUntilStr);

  if (days < 0) {
    const expiredDaysAgo = Math.abs(days);
    return {
      status: 'expired',
      label: 'Return period ended',
      subtext: `Ended ${expiredDaysAgo}d ago`,
      daysRemaining: days,
    };
  }

  if (days === 0) {
    return {
      status: 'expiring_soon',
      label: 'Return ends today',
      subtext: 'Ends today',
      daysRemaining: 0,
    };
  }

  return {
    status: days <= 3 ? 'expiring_soon' : 'active',
    label: `${days}d return left`,
    subtext: `${days} days left`,
    daysRemaining: days,
  };
}

/**
 * Checks if a category should NOT have a warranty end date (Fashion, Beauty & Personal Care, Clothing, Apparel, Shoes, Cosmetics).
 * Maintained for backward compatibility; forwards to getCategoryCapabilities.
 */
export function isNoWarrantyCategory(
  catId?: string | null,
  catName?: string | null,
  pType?: string | null
): boolean {
  const caps = getCategoryCapabilities(catId || catName, pType, false);
  return !caps.warrantySupported;
}

/**
 * Planned reminder descriptor for scheduling deterministic local notifications.
 */
export interface PlannedNotificationReminder {
  type: 'return' | 'warranty';
  daysBefore: number;
  triggerDate: Date;
  title: string;
  body: string;
  identifier: string;
  itemId: string;
}

/**
 * Normalized deadline status used as the single source of truth
 * for both Vault UI "Needs Attention" / "Ending Soon" sections and the OS Notification Engine.
 */
export interface ItemDeadlineStatus {
  itemId: string;
  hasReturnDeadline: boolean;
  returnDaysRemaining: number;
  hasUpcomingReturn: boolean;
  isReturnExpired: boolean;
  returnStatusText: string;
  returnBadgeText: string;

  isWarrantyApplicable: boolean;
  hasWarrantyExpiry: boolean;
  warrantyDaysRemaining: number;
  hasUpcomingWarranty: boolean;
  isWarrantyExpired: boolean;
  warrantyStatusText: string;
  warrantyBadgeText: string;

  // Unified attention status
  isAttentionRequired: boolean;
  nearestDays: number;

  plannedReminders: PlannedNotificationReminder[];
}

/**
 * Centralized deadline evaluation engine.
 *
 * Rules:
 * - Return: considered upcoming if between 0 and 7 days remaining.
 * - Warranty: considered upcoming if between 0 and 30 days remaining AND category supports warranty.
 * - Expired items (< 0 days remaining) are excluded from upcoming attention.
 * - Day-of (0 days): "Return ends today" / "Warranty ends today".
 * - Notifications: only schedules milestones strictly in the future (triggerDate > now).
 */
export function getDeadlineStatus(
  item: {
    id: string;
    name: string;
    categoryId?: string | null;
    category?: any;
    productType?: string | null;
    returnUntil?: string | null;
    warrantyUntil?: string | null;
  },
  warrantyEndDate?: string | null,
  referenceDate: Date = new Date()
): ItemDeadlineStatus {
  const resolvedWarrantyEnd = warrantyEndDate || item.warrantyUntil || null;
  const caps = getCategoryCapabilities(
    item.categoryId || item.category,
    item.productType,
    Boolean(resolvedWarrantyEnd)
  );

  const nowTime = referenceDate.getTime();

  let hasReturnDeadline = false;
  let returnDaysRemaining = 0;
  let hasUpcomingReturn = false;
  let isReturnExpired = false;
  let returnStatusText = '';
  let returnBadgeText = '';

  const plannedReminders: PlannedNotificationReminder[] = [];

  if (caps.returnSupported && item.returnUntil) {
    const returnDate = parseFlexibleDate(item.returnUntil);
    if (returnDate && !isNaN(returnDate.getTime())) {
      hasReturnDeadline = true;
      returnDaysRemaining = getRemainingReturnDays(item.returnUntil, referenceDate);

      if (returnDaysRemaining < 0) {
        isReturnExpired = true;
      } else if (returnDaysRemaining <= 7) {
        hasUpcomingReturn = true;
        if (returnDaysRemaining === 0) {
          returnStatusText = 'Return ends today';
          returnBadgeText = 'Return ends today';
        } else if (returnDaysRemaining === 1) {
          returnStatusText = 'Return ends in 1 day';
          returnBadgeText = 'Return: 1 day left';
        } else {
          returnStatusText = `Return ends in ${returnDaysRemaining} days`;
          returnBadgeText = `Return: ${returnDaysRemaining} days left`;
        }
      }

      const returnMilestones = [7, 3, 1, 0];
      for (const daysBefore of returnMilestones) {
        const trigger = new Date(
          returnDate.getFullYear(),
          returnDate.getMonth(),
          returnDate.getDate() - daysBefore,
          9,
          0,
          0,
          0
        );

        if (trigger.getTime() > nowTime) {
          const isToday = daysBefore === 0;
          const title = isToday ? 'Return window ends today' : 'Return window ending soon';
          const body = isToday
            ? `Your ${item.name} return window ends today.`
            : `Your ${item.name} return window ends in ${daysBefore} ${daysBefore === 1 ? 'day' : 'days'}.`;

          plannedReminders.push({
            type: 'return',
            daysBefore,
            triggerDate: trigger,
            title,
            body,
            identifier: `return-${item.id}-${daysBefore}`,
            itemId: item.id,
          });
        }
      }
    }
  }

  let hasWarrantyExpiry = false;
  let warrantyDaysRemaining = 0;
  let hasUpcomingWarranty = false;
  let isWarrantyExpired = false;
  let warrantyStatusText = '';
  let warrantyBadgeText = '';

  if (caps.warrantySupported && resolvedWarrantyEnd) {
    const warDate = parseFlexibleDate(resolvedWarrantyEnd);
    if (warDate && !isNaN(warDate.getTime())) {
      hasWarrantyExpiry = true;
      warrantyDaysRemaining = getRemainingWarrantyDays(resolvedWarrantyEnd, referenceDate);

      if (warrantyDaysRemaining < 0) {
        isWarrantyExpired = true;
      } else if (warrantyDaysRemaining <= 30) {
        hasUpcomingWarranty = true;
        if (warrantyDaysRemaining === 0) {
          warrantyStatusText = 'Warranty ends today';
          warrantyBadgeText = 'Warranty ends today';
        } else if (warrantyDaysRemaining === 1) {
          warrantyStatusText = 'Warranty ends in 1 day';
          warrantyBadgeText = 'Warranty: 1 day left';
        } else {
          warrantyStatusText = `Warranty ends in ${warrantyDaysRemaining} days`;
          warrantyBadgeText = `Warranty: ${warrantyDaysRemaining} days left`;
        }
      }

      const warrantyMilestones = [30, 7, 3, 1, 0];
      for (const daysBefore of warrantyMilestones) {
        const trigger = new Date(
          warDate.getFullYear(),
          warDate.getMonth(),
          warDate.getDate() - daysBefore,
          9,
          0,
          0,
          0
        );

        if (trigger.getTime() > nowTime) {
          const isToday = daysBefore === 0;
          const title = isToday ? 'Warranty ends today' : 'Warranty ending soon';
          const body = isToday
            ? `Your ${item.name} warranty ends today.`
            : `Your ${item.name} warranty ends in ${daysBefore} ${daysBefore === 1 ? 'day' : 'days'}.`;

          plannedReminders.push({
            type: 'warranty',
            daysBefore,
            triggerDate: trigger,
            title,
            body,
            identifier: `warranty-${item.id}-${daysBefore}`,
            itemId: item.id,
          });
        }
      }
    }
  }

  // 3. Unified Attention & Sorting Metric
  const isAttentionRequired = hasUpcomingReturn || hasUpcomingWarranty;

  let nearestDays = Infinity;
  if (hasUpcomingReturn && hasUpcomingWarranty) {
    nearestDays = Math.min(returnDaysRemaining, warrantyDaysRemaining);
  } else if (hasUpcomingReturn) {
    nearestDays = returnDaysRemaining;
  } else if (hasUpcomingWarranty) {
    nearestDays = warrantyDaysRemaining;
  }

  return {
    itemId: item.id,
    hasReturnDeadline,
    returnDaysRemaining,
    hasUpcomingReturn,
    isReturnExpired,
    returnStatusText,
    returnBadgeText,
    isWarrantyApplicable: caps.warrantySupported,
    hasWarrantyExpiry,
    warrantyDaysRemaining,
    hasUpcomingWarranty,
    isWarrantyExpired,
    warrantyStatusText,
    warrantyBadgeText,
    isAttentionRequired,
    nearestDays,
    plannedReminders,
  };
}


