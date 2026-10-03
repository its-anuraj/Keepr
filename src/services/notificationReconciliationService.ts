// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Notification Reconciliation Service
//
// This service is the SOLE post-hydration notification scheduler.
// It runs after hydrateFromCloud() completes and deterministically reconciles
// all locally scheduled notifications against the cloud-authoritative data.
//
// Design principles:
// - Idempotent: re-running produces the same result, never duplicates.
// - Deterministic IDs: notifications are keyed on record IDs, not timestamps.
// - Forward-only: only schedules future reminders; never schedules expired dates.
// - Preference-aware: respects user notification opt-outs.
// - Cancellation-first: removes stale notifications before adding new ones.
// - Never delays hydration: called asynchronously after store is populated.
// ==============================================================================

import { NotificationService } from './notifications';
import type { Item, Warranty, MaintenanceRecord, VaultDocument } from '../types';

/** Sentinel userIds from demo/seed data — never schedule notifications for these */
const DEMO_USER_IDS = new Set(['default-user', 'current-user', 'demo-user', '']);

/** Identifiers for item-level notifications that reconciliation manages */
const ITEM_NOTIFICATION_PREFIXES = ['warranty-', 'return-'];
/** Identifiers for maintenance notifications that reconciliation manages */
const MAINTENANCE_NOTIFICATION_PREFIX = 'maint-svc-';
/** Identifiers for document reminders that reconciliation manages */
const DOCUMENT_NOTIFICATION_PREFIX = 'doc-rem-';

/**
 * Returns true if this item belongs to seed/demo data and must not receive
 * production notifications.
 */
function isDemoItem(item: Item): boolean {
  return DEMO_USER_IDS.has(item.userId || '');
}

/**
 * Returns true if this is a future date (today or later).
 * Dates in the past are skipped — no notification will fire.
 */
function isFutureDate(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() >= today.getTime();
}

/**
 * Derives a deterministic notification identifier for a maintenance record.
 * Uses the record's stable ID (not timestamps) for idempotency.
 */
function maintenanceNotificationId(recordId: string): string {
  return `${MAINTENANCE_NOTIFICATION_PREFIX}${recordId}`;
}


export interface NotificationReconciliationResult {
  itemsScheduled: number;
  itemsSkipped: number;
  maintenanceScheduled: number;
  maintenanceSkipped: number;
  documentsScheduled: number;
  documentsSkipped: number;
  staleNotificationsCancelled: number;
  error?: string;
}

/**
 * Reconciles all scheduled notifications against the cloud-authoritative data.
 *
 * Call this AFTER hydrateFromCloud() has completed and the store is populated.
 * This function is idempotent: re-running after login, session restore,
 * or app restart will not create duplicate notifications.
 *
 * Execution order:
 * 1. Fetch all currently scheduled notifications from the OS.
 * 2. Build a set of notification IDs that SHOULD exist per cloud data.
 * 3. Cancel any notification whose ID is no longer valid.
 * 4. Schedule missing/changed notifications.
 *
 * @param userId - The currently authenticated user's ID. Used to guard against demo data.
 * @param items - Array of items from the hydrated store.
 * @param warranties - Array of warranties from the hydrated store.
 * @param maintenanceRecords - Array of maintenance records from the hydrated store.
 * @param documents - Array of documents from the hydrated store.
 */
export async function reconcileNotificationsAfterHydration(params: {
  userId: string;
  items: Item[];
  warranties: Warranty[];
  maintenanceRecords: MaintenanceRecord[];
  documents: VaultDocument[];
}): Promise<NotificationReconciliationResult> {
  const { userId, items, warranties, maintenanceRecords, documents } = params;

  const result: NotificationReconciliationResult = {
    itemsScheduled: 0,
    itemsSkipped: 0,
    maintenanceScheduled: 0,
    maintenanceSkipped: 0,
    documentsScheduled: 0,
    documentsSkipped: 0,
    staleNotificationsCancelled: 0,
  };

  if (DEMO_USER_IDS.has(userId || '')) {
    console.log('[NotifReconcile] Skipping — demo/seed userId');
    return result;
  }

  if (!NotificationService.isAvailable()) {
    console.log('[NotifReconcile] Skipping — notifications not available (Expo Go or web)');
    return result;
  }

  try {
    const prefs = await NotificationService.getNotificationPreferences();


    const expectedIds = new Set<string>();

    for (const item of items) {
      if (isDemoItem(item)) continue;
      if (item.userId !== userId) continue; // strict user isolation

      const hasWarranty =
        isFutureDate(item.warrantyUntil) ||
        warranties.some((w) => w.itemId === item.id && isFutureDate(w.endDate));
      const hasReturn = isFutureDate(item.returnUntil as string | null);

      // The deterministic IDs produced by NotificationService.scheduleAllItemReminders
      // follow the patterns: warranty-{itemId}-{N}, return-{itemId}-{N}
      // We include them in expectedIds so we can cancel stale ones.
      if (prefs.warrantyReminders && hasWarranty) {
        expectedIds.add(`warranty-${item.id}-30`);
        expectedIds.add(`warranty-${item.id}-7`);
        expectedIds.add(`warranty-${item.id}-3`);
        expectedIds.add(`warranty-${item.id}-1`);
        expectedIds.add(`warranty-${item.id}-0`);
      }
      if (prefs.returnReminders && hasReturn) {
        expectedIds.add(`return-${item.id}-7`);
        expectedIds.add(`return-${item.id}-3`);
        expectedIds.add(`return-${item.id}-1`);
        expectedIds.add(`return-${item.id}-0`);
      }
    }

    for (const record of maintenanceRecords) {
      if (!record.userId || record.userId !== userId) continue;
      if (prefs.maintenanceReminders && isFutureDate(record.nextServiceDate ?? null)) {
        expectedIds.add(maintenanceNotificationId(record.id));
      }
    }

    for (const doc of documents) {
      if (!doc.userId || doc.userId !== userId) continue;
      const hasExpiry = isFutureDate(doc.expiryDate ?? null);
      const hasDue = isFutureDate(doc.dueDate ?? null);
      if (prefs.documentReminders && (hasExpiry || hasDue)) {
        expectedIds.add(`${DOCUMENT_NOTIFICATION_PREFIX}${doc.id}-WARRANTY_EXPIRY_MONTH`);
        expectedIds.add(`${DOCUMENT_NOTIFICATION_PREFIX}${doc.id}-WARRANTY_EXPIRY_WEEK`);
        expectedIds.add(`${DOCUMENT_NOTIFICATION_PREFIX}${doc.id}-INSURANCE_EXPIRY_WEEK`);
        expectedIds.add(`${DOCUMENT_NOTIFICATION_PREFIX}${doc.id}-BILL_DUE_WEEK`);
        expectedIds.add(`${DOCUMENT_NOTIFICATION_PREFIX}${doc.id}-BILL_DUE_DAY`);
        expectedIds.add(`${DOCUMENT_NOTIFICATION_PREFIX}${doc.id}-DOCUMENT_EXPIRY_WEEK`);
        expectedIds.add(`${DOCUMENT_NOTIFICATION_PREFIX}${doc.id}-document_expiry`);
        expectedIds.add(`${DOCUMENT_NOTIFICATION_PREFIX}${doc.id}-insurance_expiry`);
        expectedIds.add(`${DOCUMENT_NOTIFICATION_PREFIX}${doc.id}-utility_due`);
      }
    }


    // We use the NotificationService's internal getNotifications accessor via the
    // public API: getAllScheduledNotificationsAsync is exposed through the module.
    const Notifications = (NotificationService as any)._getModule?.() ?? null;
    let scheduledList: Array<{ identifier: string }> = [];

    try {
      // Access the underlying expo-notifications module for getAllScheduledNotificationsAsync
      const { getAllScheduledNotificationsAsync } = require('expo-notifications');
      scheduledList = await getAllScheduledNotificationsAsync();
    } catch {
      // getAllScheduledNotificationsAsync may not be available (Expo Go, web)
      scheduledList = [];
    }

    for (const scheduled of scheduledList) {
      const id = scheduled.identifier;
      const isManagedByReconciler =
        ITEM_NOTIFICATION_PREFIXES.some((p) => id.startsWith(p)) ||
        id.startsWith(MAINTENANCE_NOTIFICATION_PREFIX) ||
        id.startsWith(DOCUMENT_NOTIFICATION_PREFIX);

      if (isManagedByReconciler && !expectedIds.has(id)) {
        try {
          const { cancelScheduledNotificationAsync } = require('expo-notifications');
          await cancelScheduledNotificationAsync(id);
          result.staleNotificationsCancelled++;
        } catch {
        }
      }
    }

    // -------------------------------------------------------------------------
    // Step 3: Schedule all item-level reminders.
    // NotificationService.scheduleAllItemReminders() is already idempotent:
    // it cancels existing reminders for the item before scheduling new ones.
    // -------------------------------------------------------------------------

    for (const item of items) {
      if (isDemoItem(item)) {
        result.itemsSkipped++;
        continue;
      }
      if (item.userId !== userId) {
        result.itemsSkipped++;
        continue;
      }

      const explicitWarranty = warranties.find((w) => w.itemId === item.id);
      const warrantyEndDate = explicitWarranty?.endDate ?? item.warrantyUntil ?? null;

      const hasSchedulableWarranty = isFutureDate(warrantyEndDate ?? null);
      const hasSchedulableReturn = isFutureDate(item.returnUntil as string | null);

      if (!hasSchedulableWarranty && !hasSchedulableReturn) {
        result.itemsSkipped++;
        continue;
      }

      try {
        await NotificationService.scheduleAllItemReminders(
          {
            id: item.id,
            name: item.name,
            categoryId: item.categoryId ?? null,
            productType: item.productType ?? null,
            returnUntil: (item.returnUntil as string | null) ?? null,
            warrantyUntil: warrantyEndDate,
          },
          warrantyEndDate
        );
        result.itemsScheduled++;
      } catch (schedErr) {
        console.warn(`[NotifReconcile] Failed scheduling item ${item.id}:`, schedErr);
        result.itemsSkipped++;
      }
    }

    // -------------------------------------------------------------------------
    // Step 4: Schedule maintenance reminders.
    // Use deterministic IDs: maint-svc-{recordId}
    // -------------------------------------------------------------------------

    if (prefs.maintenanceReminders) {
      for (const record of maintenanceRecords) {
        if (!record.userId || record.userId !== userId) {
          result.maintenanceSkipped++;
          continue;
        }

        const targetDate = record.nextServiceDate ?? null;
        if (!targetDate || !isFutureDate(targetDate)) {
          result.maintenanceSkipped++;
          continue;
        }

        try {
          const associatedItem = items.find((i) => i.id === record.itemId);

          // Build trigger date: 2 days before service
          const svcDate = new Date(targetDate);
          const trigger = new Date(svcDate);
          trigger.setDate(trigger.getDate() - 2);
          trigger.setHours(10, 0, 0, 0);

          const now = new Date();
          if (trigger.getTime() <= now.getTime()) {
            result.maintenanceSkipped++;
            continue;
          }

          const notifId = maintenanceNotificationId(record.id);
          const { Notifications: NotifModule } = (() => {
            try {
              return { Notifications: require('expo-notifications') };
            } catch {
              return { Notifications: null };
            }
          })();

          if (!NotifModule) {
            result.maintenanceSkipped++;
            continue;
          }

          // Cancel then reschedule with deterministic ID
          await NotifModule.cancelScheduledNotificationAsync(notifId).catch(() => {});
          await NotifModule.scheduleNotificationAsync({
            identifier: notifId,
            content: {
              title: 'Scheduled Service Reminder',
              body: `Service due soon for ${associatedItem?.name ?? 'your item'}: ${record.title} on ${targetDate}.`,
              data: { itemId: record.itemId, type: 'maintenance_due' },
              sound: true,
            },
            trigger: {
              type: NotifModule.SchedulableTriggerInputTypes.DATE,
              date: trigger,
            },
          });
          result.maintenanceScheduled++;
        } catch (maintErr) {
          console.warn(`[NotifReconcile] Failed scheduling maintenance ${record.id}:`, maintErr);
          result.maintenanceSkipped++;
        }
      }
    }


    if (prefs.documentReminders) {
      for (const doc of documents) {
        if (!doc.userId || doc.userId !== userId) {
          result.documentsSkipped++;
          continue;
        }
        const hasExpiry = isFutureDate(doc.expiryDate ?? null);
        const hasDue = isFutureDate(doc.dueDate ?? null);
        if (!hasExpiry && !hasDue) {
          result.documentsSkipped++;
          continue;
        }

        try {
          const associatedItem = doc.itemId ? items.find((i) => i.id === doc.itemId) : null;
          const scheduledIds = await NotificationService.scheduleSmartDocumentReminders(doc, associatedItem);
          if (scheduledIds.length > 0) {
            result.documentsScheduled += scheduledIds.length;
          } else {
            result.documentsSkipped++;
          }
        } catch (docErr) {
          console.warn(`[NotifReconcile] Failed scheduling doc reminder ${doc.id}:`, docErr);
          result.documentsSkipped++;
        }
      }
    }

    console.log(
      `[NotifReconcile] Complete: ` +
      `items=${result.itemsScheduled}/${result.itemsScheduled + result.itemsSkipped}, ` +
      `maint=${result.maintenanceScheduled}/${result.maintenanceScheduled + result.maintenanceSkipped}, ` +
      `docs=${result.documentsScheduled}/${result.documentsScheduled + result.documentsSkipped}, ` +
      `stale_cancelled=${result.staleNotificationsCancelled}`
    );

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[NotifReconcile] Reconciliation failed:', msg);
    return { ...result, error: msg };
  }
}
