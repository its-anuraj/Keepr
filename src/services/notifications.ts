
let Platform: { OS: string; select?: <T>(obj: any) => T } = { OS: 'ios' };
try {
  const rn = require('react-native');
  if (rn && rn.Platform) {
    Platform = rn.Platform;
  }
} catch {
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDeadlineStatus, PlannedNotificationReminder } from '../utils/warranty';
import { Item } from '../types';

const NOTIFICATION_PREFS_KEY = '@keepr_notification_preferences';

export interface NotificationPreferences {
  returnReminders: boolean;
  warrantyReminders: boolean;
  maintenanceReminders: boolean;
  documentReminders: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  returnReminders: true,
  warrantyReminders: true,
  maintenanceReminders: true,
  documentReminders: true,
};

// Lazy accessor for expo-notifications module to prevent top-level crash in Expo Go on Android (SDK 53+)
let _notificationsModule: typeof import('expo-notifications') | null = null;
let _hasAttemptedLoad = false;

export function setNotificationsModuleForTesting(mockModule: any): void {
  _notificationsModule = mockModule;
  _hasAttemptedLoad = true;
}

function getNotifications(): typeof import('expo-notifications') | null {
  if (_notificationsModule) {
    return _notificationsModule;
  }
  if (typeof Platform === 'undefined' || !Platform || Platform.OS === 'web') {
    return null;
  }

  if (_hasAttemptedLoad) {
    return _notificationsModule;
  }
  _hasAttemptedLoad = true;

  // Expo Go on Android removed remote/push notifications in SDK 53+,
  // and importing/evaluating expo-notifications inside Expo Go throws a fatal Error.
  try {
    const { isRunningInExpoGo } = require('expo');
    if (Platform.OS === 'android' && isRunningInExpoGo && isRunningInExpoGo()) {
      console.info(
        '[Keepr Notifications] Local/remote notifications via expo-notifications are disabled in Expo Go on Android (SDK 53+). To test native notifications on Android, use an Expo development build (npx expo run:android).'
      );
      return null;
    }
  } catch {
  }

  try {
    const mod = require('expo-notifications');
    _notificationsModule = mod;

    if (mod && mod.setNotificationHandler) {
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
          priority: mod.AndroidNotificationPriority?.HIGH,
        }),
      });
    }
  } catch (err) {
    console.warn('[Keepr Notifications] expo-notifications is not available:', err);
    _notificationsModule = null;
  }

  return _notificationsModule;
}

export class NotificationService {
  /**
   * Returns whether native notifications are supported in the current environment.
   */
  static isAvailable(): boolean {
    return getNotifications() !== null;
  }

  /**
   * Retrieves persisted notification preferences from AsyncStorage.
   */
  static async getNotificationPreferences(): Promise<NotificationPreferences> {
    try {
      if (typeof window !== 'undefined' || typeof (global as any).nativePerformanceNow !== 'undefined') {
        const raw = await AsyncStorage.getItem(NOTIFICATION_PREFS_KEY);
        if (raw) {
          return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
        }
      }
    } catch {
    }
    return DEFAULT_PREFERENCES;
  }

  /**
   * Persists updated notification preferences to AsyncStorage.
   */
  static async setNotificationPreferences(
    partialPrefs: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    try {
      const current = await NotificationService.getNotificationPreferences();
      const updated = { ...current, ...partialPrefs };
      await AsyncStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(updated));
      return updated;
    } catch (err) {
      console.warn('[Keepr Notifications] Failed to save notification preferences:', err);
      return DEFAULT_PREFERENCES;
    }
  }

  /**
   * Requests system notification permissions from the user gracefully.
   * Safe to call repeatedly; never throws.
   */
  static async requestPermissions(): Promise<boolean> {
    const Notifications = getNotifications();
    if (!Notifications) {
      return false;
    }

    try {
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        return false;
      }

      if (Platform.OS === 'android' && Notifications.setNotificationChannelAsync) {
        await Notifications.setNotificationChannelAsync('vault-alerts', {
          name: 'Keepr Vault Alerts',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#115086',
        });
      }

      return true;
    } catch (error) {
      console.warn('[Keepr Notifications] Failed to request notification permission:', error);
      return false;
    }
  }

  /**
   * Cancels all scheduled return and warranty notifications associated with an item.
   * Uses both deterministic identifiers and scanning scheduled notifications for thorough cleanup.
   */
  static async cancelItemReminders(itemId: string): Promise<void> {
    const Notifications = getNotifications();
    if (!Notifications || !itemId) return;

    try {
      // Cancel all deterministic identifiers for this item.
      const deterministicIds = [
        `return-${itemId}-7`,
        `return-${itemId}-3`,
        `return-${itemId}-1`,
        `return-${itemId}-0`,
        `warranty-${itemId}-30`,
        `warranty-${itemId}-7`,
        `warranty-${itemId}-3`,
        `warranty-${itemId}-1`,
        `warranty-${itemId}-0`,
      ];

      for (const id of deterministicIds) {
        try {
          await Notifications.cancelScheduledNotificationAsync(id);
        } catch {
        }
      }

      // Scan remaining scheduled notifications for any itemId-keyed entries
      // (covers maintenance reminders and any other identifiers not in the list above).
      if (Notifications.getAllScheduledNotificationsAsync) {
        const scheduledList = await Notifications.getAllScheduledNotificationsAsync();
        for (const notif of scheduledList) {
          const notifId = notif.identifier;
          const data = notif.content?.data as { itemId?: string } | undefined;

          if (
            (notifId && (
              notifId.startsWith(`return-${itemId}-`) ||
              notifId.startsWith(`warranty-${itemId}-`) ||
              notifId.startsWith(`maint-${itemId}-`)
            )) ||
            (data && data.itemId === itemId)
          ) {
            try {
              await Notifications.cancelScheduledNotificationAsync(notifId);
            } catch {
            }
          }
        }
      }
    } catch (error) {
      console.warn(`[Keepr Notifications] Error canceling reminders for item ${itemId}:`, error);
    }
  }

  /**
   * Schedules all future return and warranty reminders for an item using the
   * centralized deadline engine (getDeadlineStatus).
   *
   * Automatically cancels any prior notifications for this item to prevent duplicates,
   * enforces category eligibility, and assigns deterministic identifiers.
   */
  static async scheduleAllItemReminders(
    item: {
      id: string;
      name: string;
      categoryId?: string | null;
      category?: any;
      productType?: string | null;
      returnUntil?: string | null;
      warrantyUntil?: string | null;
    },
    warrantyEndDate?: string | null
  ): Promise<string[]> {
    const Notifications = getNotifications();
    if (!Notifications || !item || !item.id) {
      return [];
    }

    try {
      await NotificationService.cancelItemReminders(item.id);

      const prefs = await NotificationService.getNotificationPreferences();

      const status = getDeadlineStatus(item, warrantyEndDate);
      const scheduledIds: string[] = [];

      for (const reminder of status.plannedReminders) {
        if (reminder.type === 'return' && !prefs.returnReminders) {
          continue;
        }
        if (reminder.type === 'warranty' && !prefs.warrantyReminders) {
          continue;
        }

        try {
          const id = await Notifications.scheduleNotificationAsync({
            identifier: reminder.identifier,
            content: {
              title: reminder.title,
              body: reminder.body,
              data: {
                itemId: reminder.itemId,
                type: reminder.type,
              },
              sound: true,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: reminder.triggerDate,
            },
          });
          scheduledIds.push(id);
        } catch (scheduleErr) {
          console.warn(
            `[Keepr Notifications] Failed scheduling reminder ${reminder.identifier}:`,
            scheduleErr
          );
        }
      }

      return scheduledIds;
    } catch (error) {
      console.warn(
        `[Keepr Notifications] Error in scheduleAllItemReminders for ${item.id}:`,
        error
      );
      return [];
    }
  }

  /**
   * Sets up a listener for notification response (tap) events.
   * When tapped, extracts itemId or documentId and triggers callback.
   */
  static setupNotificationResponseListener(
    callback: (target: { itemId?: string; documentId?: string; type?: string }) => void
  ): () => void {
    const Notifications = getNotifications();
    if (!Notifications || !Notifications.addNotificationResponseReceivedListener) {
      return () => {};
    }

    try {
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        try {
          const data = response?.notification?.request?.content?.data as
            | { itemId?: string; documentId?: string; type?: string }
            | undefined;
          if (data && (data.documentId || data.itemId)) {
            callback({
              documentId: data.documentId ? String(data.documentId) : undefined,
              itemId: data.itemId ? String(data.itemId) : undefined,
              type: data.type ? String(data.type) : undefined,
            });
          }
        } catch (err) {
          console.warn('[Keepr Notifications] Error in response listener callback:', err);
        }
      });

      return () => {
        if (subscription && typeof (subscription as any).remove === 'function') {
          (subscription as any).remove();
        } else if ((Notifications as any).removeNotificationSubscription) {
          (Notifications as any).removeNotificationSubscription(subscription);
        }
      };
    } catch (error) {
      console.warn('[Keepr Notifications] Failed to register notification response listener:', error);
      return () => {};
    }
  }

  /**
   * Checks if the app was launched by tapping a notification.
   */
  static async checkInitialNotificationResponse(
    callback: (target: { itemId?: string; documentId?: string; type?: string }) => void
  ): Promise<void> {
    const Notifications = getNotifications();
    if (!Notifications || !Notifications.getLastNotificationResponseAsync) {
      return;
    }

    try {
      const response = await Notifications.getLastNotificationResponseAsync();
      const data = response?.notification?.request?.content?.data as
        | { itemId?: string; documentId?: string; type?: string }
        | undefined;
      if (data && (data.documentId || data.itemId)) {
        callback({
          documentId: data.documentId ? String(data.documentId) : undefined,
          itemId: data.itemId ? String(data.itemId) : undefined,
          type: data.type ? String(data.type) : undefined,
        });
      }
    } catch (error) {
      console.warn('[Keepr Notifications] Error checking initial notification response:', error);
    }
  }

  /**
   * Schedules a reminder for an expiring document (e.g. Insurance, PUC, Utility Due Date).
   * Strictly requires a real expiryDate string. Never schedules if expiryDate is null.
   * Supports either an options object or positional arguments.
   */
  static async scheduleDocumentReminder(
    documentIdOrParams:
      | string
      | {
          documentId: string;
          documentTitle: string;
          documentType?: string;
          expiryDate: string;
          daysBefore?: number;
        },
    title?: string,
    expiryDateStr?: string | null,
    reminderType: 'insurance_expiry' | 'utility_due' | 'warranty_expiry' | 'document_expiry' = 'document_expiry',
    daysBefore: number = 3
  ): Promise<string | null> {
    let documentId: string;
    let notifDocTitle: string;
    let expDate: string | null | undefined;
    let days: number;
    let remType = reminderType;

    if (typeof documentIdOrParams === 'object') {
      documentId = documentIdOrParams.documentId;
      notifDocTitle = documentIdOrParams.documentTitle;
      expDate = documentIdOrParams.expiryDate;
      days = documentIdOrParams.daysBefore ?? 3;
      if (documentIdOrParams.documentType?.toLowerCase().includes('insurance')) {
        remType = 'insurance_expiry';
      } else if (documentIdOrParams.documentType?.toLowerCase().includes('bill')) {
        remType = 'utility_due';
      }
    } else {
      documentId = documentIdOrParams;
      notifDocTitle = title || 'Document';
      expDate = expiryDateStr;
      days = daysBefore;
    }

    if (!expDate || !expDate.trim()) {
      return null;
    }

    const expiryDate = new Date(expDate);
    if (isNaN(expiryDate.getTime())) {
      return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const triggerDate = new Date(expiryDate);
    triggerDate.setDate(triggerDate.getDate() - days);
    triggerDate.setHours(9, 0, 0, 0);

    if (triggerDate.getTime() <= today.getTime()) {
      triggerDate.setTime(expiryDate.getTime());
      triggerDate.setDate(triggerDate.getDate() - 1);
      triggerDate.setHours(9, 0, 0, 0);
      if (triggerDate.getTime() <= today.getTime()) return null;
    }

    const Notifications = getNotifications();
    if (!Notifications || !Notifications.scheduleNotificationAsync) {
      return null;
    }

    const identifier = `doc-rem-${documentId}-${remType}`;
    const notifTitle =
      remType === 'utility_due'
        ? `Bill Due Soon: ${notifDocTitle}`
        : remType === 'insurance_expiry'
        ? `Insurance Expiring Soon: ${notifDocTitle}`
        : `Document Expiry Reminder: ${notifDocTitle}`;

    const notifBody =
      remType === 'utility_due'
        ? `Your bill for "${notifDocTitle}" is due in ${days} days.`
        : `Your document "${notifDocTitle}" expires on ${expDate}. Check details in Keepr.`;

    try {
      if (Notifications.cancelScheduledNotificationAsync) {
        await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
      }

      const id = await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: notifTitle,
          body: notifBody,
          data: {
            documentId,
            type: remType,
          },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes?.DATE || 'date',
          date: triggerDate,
        },
      });

      return id;
    } catch (err) {
      console.warn(`[Keepr Notifications] Failed scheduling document reminder ${identifier}:`, err);
      return null;
    }
  }

  /**
   * Schedules a reminder for an expiring warranty (backward-compatibility wrapper).
   */
  static async scheduleWarrantyReminder(params: {
    itemId: string;
    itemName: string;
    warrantyEndDate: string;
    daysBefore?: number;
  }): Promise<string | null> {
    const ids = await NotificationService.scheduleAllItemReminders(
      {
        id: params.itemId,
        name: params.itemName,
        warrantyUntil: params.warrantyEndDate,
      },
      params.warrantyEndDate
    );
    return ids[0] || null;
  }

  /**
   * Schedules a reminder for an upcoming return deadline (backward-compatibility wrapper).
   */
  static async scheduleReturnReminder(params: {
    itemId: string;
    itemName: string;
    returnUntil: string;
    daysBefore?: number;
  }): Promise<string | null> {
    const ids = await NotificationService.scheduleAllItemReminders({
      id: params.itemId,
      name: params.itemName,
      returnUntil: params.returnUntil,
    });
    return ids[0] || null;
  }

  /**
   * Schedules a reminder for an upcoming maintenance appointment.
   */
  static async scheduleMaintenanceReminder(params: {
    itemId: string;
    itemName: string;
    maintenanceTitle: string;
    serviceDate: string;
  }): Promise<string | null> {
    const Notifications = getNotifications();
    if (!Notifications) return null;

    try {
      const { itemId, itemName, maintenanceTitle, serviceDate } = params;
      const targetDate = new Date(serviceDate);
      if (isNaN(targetDate.getTime())) return null;

      const triggerDate = new Date(targetDate);
      triggerDate.setDate(triggerDate.getDate() - 2); // 2 days before
      triggerDate.setHours(10, 0, 0, 0);

      const now = new Date();
      if (triggerDate.getTime() <= now.getTime()) return null;

      // Deterministic identifier: same service date for the same item produces the
      // same identifier, so scheduling twice cancels the previous reminder automatically.
      const dateKey = serviceDate.replace(/[^0-9]/g, '');
      const identifier = `maint-${itemId}-${dateKey}`;

      // Cancel any existing reminder with this identifier before rescheduling.
      try {
        await Notifications.cancelScheduledNotificationAsync(identifier);
      } catch {
      }

      const id = await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: 'Scheduled Service Reminder',
          body: `Service due soon for ${itemName}: ${maintenanceTitle} on ${serviceDate}.`,
          data: { itemId, type: 'maintenance_due' },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
        },
      });

      return id;
    } catch (error) {
      console.warn('[Keepr Notifications] Failed to schedule maintenance reminder:', error);
      return null;
    }
  }

  /**
   * Cancels a scheduled notification by ID.
   */
  static async cancelNotification(notificationId: string): Promise<void> {
    const Notifications = getNotifications();
    if (!Notifications) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (error) {
      console.warn('[Keepr Notifications] Failed to cancel notification:', error);
    }
  }

  /**
   * Cancels all scheduled notification identifiers associated with a document.
   */
  static async cancelAllDocumentReminders(documentId: string): Promise<void> {
    const Notifications = getNotifications();
    if (!Notifications || !Notifications.cancelScheduledNotificationAsync) return;

    const possibleSuffixes = [
      'WARRANTY_EXPIRY_MONTH',
      'WARRANTY_EXPIRY_WEEK',
      'INSURANCE_EXPIRY_WEEK',
      'BILL_DUE_WEEK',
      'BILL_DUE_DAY',
      'DOCUMENT_EXPIRY_WEEK',
      'document_expiry',
      'insurance_expiry',
      'utility_due',
      'warranty_expiry',
    ];

    for (const suffix of possibleSuffixes) {
      const identifier = `doc-rem-${documentId}-${suffix}`;
      await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
    }
  }

  /**
   * Schedules smart reminders for a document strictly using verified dates found in the document.
   *
   * 1. Warranty & Guarantee:
   *    - 1 month before expiry (WARRANTY_EXPIRY_MONTH: 30 days)
   *    - 1 week before expiry (WARRANTY_EXPIRY_WEEK: 7 days)
   * 2. Insurance:
   *    - 1 week before expiry (INSURANCE_EXPIRY_WEEK: 7 days renewal reminder)
   * 3. Bills & Utilities:
   *    - 1 week before due date (BILL_DUE_WEEK: 7 days)
   *    - 1 day before due date (BILL_DUE_DAY: 1 day)
   * 4. Other Documents with Expiry:
   *    - 1 week before expiry (DOCUMENT_EXPIRY_WEEK: 7 days)
   *
   * ZERO FABRICATION: If the required date is missing or invalid, no reminder is scheduled.
   */
  static async scheduleSmartDocumentReminders(
    doc: {
      id: string;
      title: string;
      category?: string | null;
      documentType?: string | null;
      expiryDate?: string | null;
      dueDate?: string | null;
      itemId?: string | null;
    },
    item?: Item | null
  ): Promise<string[]> {
    const Notifications = getNotifications();
    if (!Notifications || !Notifications.scheduleNotificationAsync) return [];

    const prefs = await NotificationService.getNotificationPreferences();
    if (!prefs.documentReminders) return [];

    await NotificationService.cancelAllDocumentReminders(doc.id);

    const scheduledIds: string[] = [];
    const planned = computeSmartDocumentReminders(doc, item);

    for (const plan of planned) {
      try {
        const id = await Notifications.scheduleNotificationAsync({
          identifier: plan.identifier,
          content: {
            title: plan.title,
            body: plan.body,
            data: {
              documentId: doc.id,
              itemId: doc.itemId || undefined,
              type: plan.suffix,
            },
            sound: true,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes?.DATE || 'date',
            date: plan.triggerDate,
          },
        });
        scheduledIds.push(id);
      } catch (err) {
        console.warn(`[Keepr Notifications] Error scheduling ${plan.identifier}:`, err);
      }
    }

    return scheduledIds;
  }

  /**
   * Pure deterministic planner for smart document reminders.
   * Can be tested without native device dependencies.
   */
  static computeSmartDocumentReminders(
    doc: {
      id: string;
      title: string;
      category?: string | null;
      documentType?: string | null;
      expiryDate?: string | null;
      dueDate?: string | null;
      itemId?: string | null;
    },
    item?: Item | null,
    referenceDate?: Date
  ): Array<{
    identifier: string;
    suffix: string;
    targetDate: string;
    daysBefore: number;
    triggerDate: Date;
    title: string;
    body: string;
  }> {
    const cat = (doc.category || '').toLowerCase();
    const docType = (doc.documentType || '').toLowerCase();
    const today = referenceDate ? new Date(referenceDate) : new Date();
    today.setHours(0, 0, 0, 0);

    const planned: Array<{
      identifier: string;
      suffix: string;
      targetDate: string;
      daysBefore: number;
      triggerDate: Date;
      title: string;
      body: string;
    }> = [];

    const addPlan = (suffix: string, targetDateStr: string, daysBefore: number, title: string, body: string) => {
      const targetDate = new Date(targetDateStr);
      if (isNaN(targetDate.getTime())) return;

      const triggerDate = new Date(targetDate);
      triggerDate.setDate(triggerDate.getDate() - daysBefore);
      triggerDate.setHours(9, 0, 0, 0);

      if (triggerDate.getTime() <= today.getTime()) return;

      planned.push({
        identifier: `doc-rem-${doc.id}-${suffix}`,
        suffix,
        targetDate: targetDateStr,
        daysBefore,
        triggerDate,
        title,
        body,
      });
    };

    const isWarranty =
      cat.includes('warranty') ||
      cat.includes('guarantee') ||
      docType.includes('warranty') ||
      docType.includes('guarantee');

    if (isWarranty && doc.expiryDate && doc.expiryDate.trim()) {
      addPlan(
        'WARRANTY_EXPIRY_MONTH',
        doc.expiryDate,
        30,
        'Warranty Expiring in 1 Month',
        `Your warranty for "${doc.title}" expires on ${doc.expiryDate}. Check coverage details in Keepr.`
      );
      addPlan(
        'WARRANTY_EXPIRY_WEEK',
        doc.expiryDate,
        7,
        'Warranty Expiring Soon',
        `Your warranty for "${doc.title}" expires in 1 week on ${doc.expiryDate}.`
      );
    }

    const isInsurance = cat.includes('insurance') || docType.includes('insurance');
    if (isInsurance && doc.expiryDate && doc.expiryDate.trim()) {
      addPlan(
        'INSURANCE_EXPIRY_WEEK',
        doc.expiryDate,
        7,
        'Insurance Expiring Soon',
        item ? `Your insurance for "${item.name}" expires in 1 week.` : `Your vehicle insurance expires in 1 week.`
      );
    }

    const isBill = cat.includes('bill') || cat.includes('utility') || docType.includes('bill');
    const billTargetDate = doc.dueDate && doc.dueDate.trim() ? doc.dueDate : (!isWarranty && !isInsurance ? doc.expiryDate : null);

    if (isBill && billTargetDate && billTargetDate.trim()) {
      addPlan(
        'BILL_DUE_WEEK',
        billTargetDate,
        7,
        'Bill Due in 1 Week',
        `Your bill for "${doc.title}" is due in 1 week.`
      );
      addPlan(
        'BILL_DUE_DAY',
        billTargetDate,
        1,
        'Bill Due Tomorrow',
        `Your bill for "${doc.title}" is due tomorrow.`
      );
    }

    if (!isWarranty && !isInsurance && !isBill && doc.expiryDate && doc.expiryDate.trim()) {
      addPlan(
        'DOCUMENT_EXPIRY_WEEK',
        doc.expiryDate,
        7,
        'Document Expiring Soon',
        `Your document "${doc.title}" expires on ${doc.expiryDate}. Check details in Keepr.`
      );
    }

    return planned;
  }

  /**
   * Cancels all scheduled notifications on the device (used on signOut / clearUserData).
   */
  static async cancelAllNotifications(): Promise<void> {
    const Notifications = getNotifications();
    if (!Notifications) return;
    try {
      if (Notifications.cancelAllScheduledNotificationsAsync) {
        await Notifications.cancelAllScheduledNotificationsAsync();
      }
    } catch (error) {
      console.warn('[Keepr Notifications] Failed to cancel all notifications:', error);
    }
  }
}

export async function scheduleDocumentReminder(
  documentId: string,
  title: string,
  expiryDateStr?: string | null,
  reminderType: 'insurance_expiry' | 'utility_due' | 'warranty_expiry' | 'document_expiry' = 'document_expiry',
  daysBefore: number = 3
): Promise<string | null> {
  return NotificationService.scheduleDocumentReminder(
    documentId,
    title,
    expiryDateStr,
    reminderType,
    daysBefore
  );
}

export async function scheduleSmartDocumentReminders(
  doc: {
    id: string;
    title: string;
    category?: string | null;
    documentType?: string | null;
    expiryDate?: string | null;
    dueDate?: string | null;
    itemId?: string | null;
  },
  item?: Item | null
): Promise<string[]> {
  return NotificationService.scheduleSmartDocumentReminders(doc, item);
}

export async function cancelAllDocumentReminders(documentId: string): Promise<void> {
  return NotificationService.cancelAllDocumentReminders(documentId);
}

export const computeSmartDocumentReminders = NotificationService.computeSmartDocumentReminders;


