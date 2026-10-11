
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityLog,
  Expense,
  Item,
  ItemCategory,
  ItemWithOwnerContext,
  MaintenanceRecord,
  Receipt,
  VaultDocument,
  VaultMetrics,
  Warranty,
  RecentlyAddedEntry,
  PurchasedProduct,
} from '../types';
import { DEFAULT_CATEGORIES, normalizeToDbCategoryId } from '../constants/categories';
import { calculateItemTCO, calculateVaultMetrics } from '../utils/ownershipCost';
import {
  calculateWarrantyExpiry,
  getRemainingWarrantyDays,
  getWarrantyProgressPercent,
  getWarrantyStatus,
  getReturnStatus,
  getRemainingReturnDays,
  getCategoryCapabilities,
  isNoWarrantyCategory,
} from '../utils/warranty';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { NotificationService } from '../services/notifications';
import { normalizeDateToIso } from '../services/receiptParser';
import { useAuthStore } from './authStore';
import {
  persistReceiptToVault,
  persistProductPhotoToVault,
  deleteLocalVaultFile,
  resolveItemReceipt,
  logReceiptDebug,
} from '../services/receiptFileService';
import {
  hydrateVaultFromCloud,
  clearInFlightCloudHydrations,
  cloudUpsertItem,
  cloudUpsertWarranty,
  cloudUpsertDocument,
  cloudUpsertReceipt,
  cloudUpsertMaintenance,
  cloudUpsertExpense,
  cloudUpsertActivityLog,
  cloudDeleteItem,
  cloudDeleteDocument,
  cloudDeleteMaintenance,
  cloudDeleteExpense,
  mapItemToDbRow,
  mapDocumentToDbRow,
  mapMaintenanceToDbRow,
  mapWarrantyToDbRow,
  mapReceiptToDbRow,
} from '../services/cloudSyncService';
import {
  uploadItemPhoto,
  uploadItemReceipt,
  uploadVaultDocument,
  deleteItemPhotosFromStorage,
  isStoragePath,
} from '../services/storageService';
import {
  canonicalizeProductPhotos,
  isLocalUri,
  isRemoteUrl,
  cleanStoragePath,
} from '../utils/storageUtils';
import {
  reconcileAndMigrateItemImages,
  reconcileAndMigrateReceiptsAndDocuments,
} from '../services/offlineMigrationService';
import { reconcileNotificationsAfterHydration } from '../services/notificationReconciliationService';
import {
  enqueueSyncOperation,
  clearUserSyncQueue,
  flushSyncQueue,
} from '../services/syncQueueService';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true if the string is a valid RFC 4122 UUID. */
export function isValidUUID(id?: string | null): boolean {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

/**
 * Generates a standard RFC 4122 compliant UUID v4 string for PostgreSQL compatibility.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Ensures atomic, immediate persistence of vault items and associated state to AsyncStorage.
 */
async function forceSyncVaultStorage(
  storageKey: string,
  updatedItems: Item[],
  extraState: {
    receipts?: Receipt[];
    warranties?: Warranty[];
    documents?: VaultDocument[];
    activityLogs?: any[];
  }
) {
  try {
    const rawStorage = await AsyncStorage.getItem(storageKey);
    let storageObj: any = {};
    if (rawStorage) {
      try {
        storageObj = JSON.parse(rawStorage);
      } catch {}
    }
    const persistedState = storageObj.state || {};
    const existingItems: Item[] = Array.isArray(persistedState.items) ? persistedState.items : [];
    const updatedIds = new Set(updatedItems.map((i) => i.id));
    const dedupedPersisted = [...updatedItems, ...existingItems.filter((i: Item) => !updatedIds.has(i.id))];

    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify({
        ...storageObj,
        state: {
          ...persistedState,
          items: dedupedPersisted,
          receipts: extraState.receipts || persistedState.receipts,
          warranties: extraState.warranties || persistedState.warranties,
          documents: extraState.documents || persistedState.documents,
          activityLogs: extraState.activityLogs || persistedState.activityLogs,
        },
        version: storageObj.version ?? 0,
      })
    );
  } catch (persistErr) {
    console.warn('[ItemStore] Direct AsyncStorage sync note:', persistErr);
  }
}

const SEED_ITEMS: Item[] = [];
const SEED_WARRANTIES: Warranty[] = [];
const SEED_DOCUMENTS: VaultDocument[] = [];
const SEED_MAINTENANCE: MaintenanceRecord[] = [];
const SEED_EXPENSES: Expense[] = [];
const SEED_ACTIVITY: ActivityLog[] = [];

interface ItemState {
  items: Item[];
  receipts: Receipt[];
  warranties: Warranty[];
  documents: VaultDocument[];
  maintenanceRecords: MaintenanceRecord[];
  expenses: Expense[];
  activityLogs: ActivityLog[];
  categories: ItemCategory[];

  searchQuery: string;
  selectedCategory: string; // 'all' or category id
  selectedSort: 'recent' | 'price_desc' | 'price_asc' | 'name';
  selectedWarrantyFilter: 'all' | 'active' | 'expiring' | 'expired';

  isLoading: boolean;
  error: string | null;

  setSearchQuery: (query: string) => void;
  setSelectedCategory: (categoryId: string) => void;
  setSelectedSort: (sort: 'recent' | 'price_desc' | 'price_asc' | 'name') => void;
  setSelectedWarrantyFilter: (filter: 'all' | 'active' | 'expiring' | 'expired') => void;

  addItem: (params: {
    name: string;
    categoryId: string;
    productType?: string;
    categoryConfidence?: 'high' | 'medium' | 'low';
    receiptId?: string;
    quantity?: number;
    unitPrice?: number;
    brand?: string;
    model?: string;
    serialNumber?: string;
    imei?: string;
    size?: string;
    color?: string;
    material?: string;
    registrationNumber?: string;
    insuranceExpiry?: string;
    pucDate?: string;
    purchaseDate?: string;
    purchasePrice: number;
    subtotal?: number;
    discount?: number;
    currency?: string;
    merchant?: string;
    sellerAddress?: string;
    gstin?: string;
    gstTax?: string;
    gstRate?: string;
    cgst?: string;
    sgst?: string;
    igst?: string;
    invoiceNumber?: string;
    returnUntil?: string | null;
    warrantyUntil?: string | null;
    warrantyProvider?: string;
    receiptUri?: string;
    receiptPath?: string;
    receiptName?: string;
    receiptType?: 'receipt' | 'invoice';
    photoUri?: string;
    productPhotos?: string[];
    additionalReceiptUris?: string[];
    notes?: string;
    imageUrl?: string;
    imageStoragePath?: string;
    warrantyDurationMonths?: number;
    enableWarrantyReminder?: boolean;
    initialDocumentName?: string;
    initialDocumentUri?: string;
    products?: PurchasedProduct[];
    isMultiProduct?: boolean;
    productCount?: number;
  }) => Promise<Item>;

  addMultipleItems: (params: {
    receipt: {
      fileUri: string;
      fileName: string;
      merchant?: string;
      sellerAddress?: string;
      gstin?: string;
      purchaseDate?: string;
      totalAmount?: number;
      subtotal?: number;
      discount?: number;
      gstTax?: string;
      invoiceNumber?: string;
    };
    items: Array<{
      name: string;
      categoryId?: string;
      productType?: string;
      categoryConfidence?: 'high' | 'medium' | 'low';
      brand?: string;
      model?: string;
      serialNumber?: string;
      purchasePrice: number;
      unitPrice?: number;
      quantity?: number;
      subtotal?: number;
      discount?: number;
      gstin?: string;
      currency?: string;
      returnUntil?: string | null;
      warrantyUntil?: string | null;
      warrantyProvider?: string;
      notes?: string;
      photoUri?: string;
      productPhotos?: string[];
      enableWarrantyReminder?: boolean;
    }>;
  }) => Promise<Item[]>;

  updateItem: (itemId: string, updates: Partial<Item>) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;

  addReceipt: (
    receipt: Omit<Receipt, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { userId?: string }
  ) => Promise<Receipt>;
  getReceiptById: (id: string) => Receipt | undefined;
  getItemsByReceiptId: (receiptId: string) => Item[];

  addWarranty: (warranty: Omit<Warranty, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Warranty>;
  updateWarranty: (warrantyId: string, updates: Partial<Warranty>) => Promise<void>;

  addMaintenanceRecord: (
    record: Omit<MaintenanceRecord, 'id' | 'createdAt' | 'updatedAt' | 'userId'> & {
      id?: string;
      userId?: string;
    }
  ) => Promise<MaintenanceRecord>;
  updateMaintenanceRecord: (
    recordId: string,
    updates: Partial<MaintenanceRecord>
  ) => Promise<MaintenanceRecord | null>;
  deleteMaintenanceRecord: (recordId: string) => Promise<void>;
  getMaintenanceRecordById: (recordId: string) => MaintenanceRecord | undefined;
  getMaintenanceRecordsByItemId: (itemId: string) => MaintenanceRecord[];
  getAllMaintenanceRecords: () => MaintenanceRecord[];

  addExpense: (expense: Omit<Expense, 'id' | 'createdAt'>) => Promise<Expense>;
  deleteExpense: (expenseId: string) => Promise<void>;

  addDocument: (
    doc: Omit<VaultDocument, 'id' | 'createdAt' | 'userId' | 'fileSizeBytes' | 'filePath' | 'mimeType'> & {
      id?: string;
      userId?: string;
      fileSizeBytes?: number;
      filePath?: string;
      mimeType?: string;
    }
  ) => Promise<VaultDocument>;
  updateDocument: (documentId: string, updates: Partial<VaultDocument>) => Promise<void>;
  deleteDocument: (documentId: string) => Promise<void>;
  getDocumentById: (id: string) => VaultDocument | undefined;
  getDocumentsByItemId: (itemId: string) => VaultDocument[];
  getStandaloneDocuments: () => VaultDocument[];
  getAllDocuments: () => VaultDocument[];
  getRecentlyAdded: (limit?: number) => RecentlyAddedEntry[];

  convertDocumentToItem: (documentId: string, itemData?: Partial<any>) => Promise<Item>;
  convertItemToDocument: (itemId: string, docData?: Partial<any>) => Promise<VaultDocument>;

  getItemById: (id: string) => ItemWithOwnerContext | null;
  getVaultMetrics: () => VaultMetrics;
  getFilteredItems: () => ItemWithOwnerContext[];
  resetFilters: () => void;

  /**
   * Fetches all vault data for the currently authenticated user from Supabase
   * and replaces the local Zustand state atomically.
   * Called on login, session restore, and second-device sync.
   * Returns a summary of what was loaded.
   */
  hydrateFromCloud: () => Promise<{ itemCount: number; docCount: number; success: boolean }>;

  /**
   * Wipes all user-owned vault data from in-memory state.
   * Must be called on sign out and account deletion to prevent
   * one user's data from being visible to the next user on the same device.
   */
  clearUserData: () => void;
}

/** Full User-scoped vault backup to prevent data loss across logout/login and query failures */
const USER_BACKUP_KEY_PREFIX = '@keepr_vault_backup_v1_';

export interface UserVaultBackup {
  items: Item[];
  documents?: VaultDocument[];
  warranties?: Warranty[];
  receipts?: Receipt[];
  maintenanceRecords?: MaintenanceRecord[];
  expenses?: Expense[];
  activityLogs?: ActivityLog[];
}

export async function saveUserVaultBackup(
  userId: string,
  backupOrItems: Item[] | UserVaultBackup
): Promise<void> {
  if (!userId) return;
  try {
    const key = `${USER_BACKUP_KEY_PREFIX}${userId}`;
    const payload: UserVaultBackup = Array.isArray(backupOrItems)
      ? { items: backupOrItems }
      : backupOrItems;
    await AsyncStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    console.warn('[ItemStore] saveUserVaultBackup note:', err);
  }
}

export async function getUserVaultBackup(userId: string): Promise<UserVaultBackup | null> {
  if (!userId) return null;
  try {
    const key = `${USER_BACKUP_KEY_PREFIX}${userId}`;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        items: parsed,
        documents: [],
        warranties: [],
        receipts: [],
        maintenanceRecords: [],
        expenses: [],
        activityLogs: [],
      };
    }
    return parsed;
  } catch (err) {
    console.warn('[ItemStore] getUserVaultBackup note:', err);
    return null;
  }
}

/** Active session token for cloud hydration to invalidate stale asynchronous completions */
let activeHydrationSessionToken: string | null = null;

/** In-flight hydration promise guard to prevent duplicate concurrent hydrations. */
let inFlightHydrationPromise: {
  userId: string;
  promise: Promise<{ itemCount: number; docCount: number; success: boolean }>;
} | null = null;

export const useItemStore = create<ItemState>()(
  persist(
    (set, get) => ({
      items: [],
      receipts: [],
      warranties: [],
      documents: [],
      maintenanceRecords: [],
      expenses: [],
      activityLogs: [],
      categories: DEFAULT_CATEGORIES,

      searchQuery: '',
      selectedCategory: 'all',
      selectedSort: 'recent',
      selectedWarrantyFilter: 'all',

      isLoading: false,
      error: null,

      setSearchQuery: (query) => set({ searchQuery: query }),
      setSelectedCategory: (cat) => set({ selectedCategory: cat }),
      setSelectedSort: (sort) => set({ selectedSort: sort }),
      setSelectedWarrantyFilter: (filter) => set({ selectedWarrantyFilter: filter }),
      resetFilters: () =>
        set({
          searchQuery: '',
          selectedCategory: 'all',
          selectedSort: 'recent',
          selectedWarrantyFilter: 'all',
        }),

      hydrateFromCloud: async () => {
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = authUser?.id || authSession?.user?.id;

        if (!userId || !isSupabaseConfigured) {
          console.log('[ItemStore] hydrateFromCloud skipped: no userId or Supabase not configured');
          return { itemCount: 0, docCount: 0, success: false };
        }

        // In-flight guard: If hydration for this user is already running, reuse the pending promise
        if (inFlightHydrationPromise && inFlightHydrationPromise.userId === userId) {
          console.log(`[ItemStore] Reusing in-flight hydrateFromCloud for user ${userId}`);
          return inFlightHydrationPromise.promise;
        }

        const sessionToken = generateUUID();
        activeHydrationSessionToken = sessionToken;

        const promise = (async () => {
          set({ isLoading: true, error: null });
          try {
            const cloudData = await hydrateVaultFromCloud(userId);

            // STALE CHECK 1: Before committing any asynchronous hydration result,
            // verify the authenticated user/session still matches the request's user ID
            // and the session token is still active (not cleared by logout or account switch).
            const currentAuthUser = useAuthStore.getState().user;
            const currentAuthSession = useAuthStore.getState().session;
            const currentUserId = currentAuthUser?.id || currentAuthSession?.user?.id;

            if (!currentUserId || currentUserId !== userId || activeHydrationSessionToken !== sessionToken) {
              console.warn(`[ItemStore] Discarding stale hydration result for user ${userId} (current user: ${currentUserId})`);
              set({ isLoading: false });
              return { itemCount: 0, docCount: 0, success: false };
            }

            const currentState = get();

            const verifyOwnership = <T extends { userId?: string }>(records: T[]): T[] =>
              records.filter((r) => !r.userId || r.userId === userId);

            // Fetch any pending offline item upsert IDs for this user
            let pendingItemIds = new Set<string>();
            try {
              const { getPendingUpsertItemIds } = require('../services/syncQueueService');
              pendingItemIds = await getPendingUpsertItemIds(userId);
            } catch {}

            // Handle items query failure vs successful response:
            let safeItems: Item[] = [];
            let itemsSuccess = true;

            if (cloudData.itemsFetchError) {
              // On query failure, NEVER overwrite previously available valid items with an empty array.
              itemsSuccess = false;
              console.warn(`[ItemStore] Cloud items query failed. Preserving local state and user backup.`);
              if (currentState.items.length > 0) {
                safeItems = currentState.items;
              } else {
                const backup = await getUserVaultBackup(userId);
                safeItems = (backup && backup.items && backup.items.length > 0) ? backup.items : [];
              }
            } else if (cloudData.itemsMappingErrors > 0 && cloudData.items.length === 0 && cloudData.itemsRawCount > 0) {
              // All items failed mapping. This is NOT an empty vault!
              itemsSuccess = false;
              console.warn(`[ItemStore] All ${cloudData.itemsRawCount} items failed mapping! Preserving local items.`);
              if (currentState.items.length > 0) {
                safeItems = currentState.items;
              } else {
                const backup = await getUserVaultBackup(userId);
                safeItems = (backup && backup.items && backup.items.length > 0) ? backup.items : [];
              }
            } else if (cloudData.items.length > 0) {
              // Successfully fetched items from cloud
              const cloudItemsOwned = verifyOwnership(cloudData.items);
              const mappedCloudIds = new Set(cloudItemsOwned.map((i) => i.id));

              // Map cloud items, merging local media paths where available
              const mappedItems = cloudItemsOwned.map((cloudItem) => {
                const localItem = currentState.items.find((i) => i.id === cloudItem.id);
                const canonicalPhotos = canonicalizeProductPhotos({
                  ...cloudItem,
                  productPhotos: (cloudItem.productPhotos && cloudItem.productPhotos.length > 0)
                    ? cloudItem.productPhotos
                    : localItem?.productPhotos,
                  receiptPath: cloudItem.receiptPath || localItem?.receiptPath,
                  receiptUri: localItem?.receiptUri || cloudItem.receiptUri,
                });
                const primaryStorage =
                  canonicalPhotos.find((p) => isStoragePath(p)) ||
                  cleanStoragePath(cloudItem.imageStoragePath || localItem?.imageStoragePath || cloudItem.imageUrl || localItem?.imageUrl) ||
                  undefined;
                const effectiveImage = primaryStorage || canonicalPhotos[0] || cloudItem.imageUrl || localItem?.imageUrl;
                return {
                  ...cloudItem,
                  photoUri: localItem?.photoUri || cloudItem.photoUri,
                  imageStoragePath: primaryStorage,
                  imageUrl: effectiveImage,
                  productPhotos: canonicalPhotos,
                  receiptUri: localItem?.receiptUri || cloudItem.receiptUri,
                  receiptPath: cloudItem.receiptPath || localItem?.receiptPath,
                  receiptName: cloudItem.receiptName || localItem?.receiptName,
                };
              });

              // Also preserve any local items that are pending sync or un-synced
              const pendingOrMissingLocalItems = currentState.items.filter(
                (loc) => !mappedCloudIds.has(loc.id) && (pendingItemIds.has(loc.id) || loc.userId === userId)
              );

              // Ensure any local-only un-synced items are enqueued for cloud upsert so they are never lost
              for (const unSyncedItem of pendingOrMissingLocalItems) {
                if (!pendingItemIds.has(unSyncedItem.id)) {
                  cloudUpsertItem(unSyncedItem, userId).then((err) => {
                    if (err) {
                      enqueueSyncOperation({
                        type: 'upsertItem',
                        entityId: unSyncedItem.id,
                        userId,
                        payload: mapItemToDbRow(unSyncedItem, userId),
                      }).catch(() => {});
                    }
                  }).catch(() => {});
                }
              }

              safeItems = [...mappedItems, ...pendingOrMissingLocalItems];
            } else {
              // Confirmed zero items from cloud (cloudData.itemsRawCount === 0 and itemsFetchError === false)
              // If there are pending local items for this user, preserve them and enqueue!
              const pendingLocalItems = currentState.items.filter(
                (loc) => (pendingItemIds.has(loc.id) || loc.userId === userId) && (!loc.userId || loc.userId === userId)
              );
              if (pendingLocalItems.length > 0) {
                safeItems = pendingLocalItems;
                for (const unSyncedItem of pendingLocalItems) {
                  if (!pendingItemIds.has(unSyncedItem.id)) {
                    cloudUpsertItem(unSyncedItem, userId).then((err) => {
                      if (err) {
                        enqueueSyncOperation({
                          type: 'upsertItem',
                          entityId: unSyncedItem.id,
                          userId,
                          payload: mapItemToDbRow(unSyncedItem, userId),
                        }).catch(() => {});
                      }
                    }).catch(() => {});
                  }
                }
              } else {
                safeItems = [];
              }
            }

            // Helper to lazily load user backup on any query failure
            let userBackup: UserVaultBackup | null = null;
            const getOrLoadBackup = async () => {
              if (!userBackup) userBackup = await getUserVaultBackup(userId);
              return userBackup;
            };

            // Documents reconciliation with query failure protection
            let safeDocs: VaultDocument[] = [];
            if (cloudData.documentsFetchError) {
              console.warn('[ItemStore] Cloud documents query failed. Preserving local state and user backup.');
              if (currentState.documents.length > 0) {
                safeDocs = currentState.documents;
              } else {
                const b = await getOrLoadBackup();
                safeDocs = (b && b.documents && b.documents.length > 0) ? b.documents : [];
              }
            } else if (cloudData.documentsMappingErrors > 0 && cloudData.documents.length === 0 && cloudData.documentsRawCount > 0) {
              console.warn('[ItemStore] All documents failed mapping! Preserving local documents and user backup.');
              if (currentState.documents.length > 0) {
                safeDocs = currentState.documents;
              } else {
                const b = await getOrLoadBackup();
                safeDocs = (b && b.documents && b.documents.length > 0) ? b.documents : [];
              }
            } else if (cloudData.documents.length > 0) {
              const cloudDocsOwned = verifyOwnership(cloudData.documents);
              const mappedCloudIds = new Set(cloudDocsOwned.map((d) => d.id));
              const mappedDocs = cloudDocsOwned.map((cloudDoc) => {
                const localDoc = currentState.documents.find((d) => d.id === cloudDoc.id);
                return {
                  ...cloudDoc,
                  filePath: localDoc?.filePath || cloudDoc.filePath,
                  fileUrl: localDoc?.fileUrl || cloudDoc.fileUrl,
                  storagePath: cloudDoc.storagePath || localDoc?.storagePath,
                };
              });
              const pendingOrMissingLocalDocs = currentState.documents.filter(
                (loc) => !mappedCloudIds.has(loc.id) && loc.userId === userId
              );
              safeDocs = [...mappedDocs, ...pendingOrMissingLocalDocs];
            } else {
              // Confirmed zero documents from cloud
              const pendingLocalDocs = currentState.documents.filter((loc) => loc.userId === userId);
              safeDocs = pendingLocalDocs.length > 0 ? pendingLocalDocs : [];
            }

            // Warranties reconciliation with query failure protection
            let safeWarranties: Warranty[] = [];
            if (cloudData.warrantiesFetchError) {
              console.warn('[ItemStore] Cloud warranties query failed. Preserving local warranties and backup.');
              if (currentState.warranties.length > 0) {
                safeWarranties = currentState.warranties;
              } else {
                const b = await getOrLoadBackup();
                safeWarranties = (b && b.warranties && b.warranties.length > 0) ? b.warranties : [];
              }
            } else if (cloudData.warranties.length > 0) {
              safeWarranties = verifyOwnership(cloudData.warranties);
            } else {
              safeWarranties = currentState.warranties.filter((w) => w.userId === userId);
            }

            // Receipts reconciliation with query failure protection
            let safeReceipts: Receipt[] = [];
            if (cloudData.receiptsFetchError) {
              console.warn('[ItemStore] Cloud receipts query failed. Preserving local receipts and backup.');
              if (currentState.receipts.length > 0) {
                safeReceipts = currentState.receipts;
              } else {
                const b = await getOrLoadBackup();
                safeReceipts = (b && b.receipts && b.receipts.length > 0) ? b.receipts : [];
              }
            } else if (cloudData.receipts.length > 0) {
              safeReceipts = verifyOwnership(cloudData.receipts);
            } else {
              safeReceipts = currentState.receipts.filter((r) => r.userId === userId);
            }

            // Maintenance records reconciliation with query failure protection
            let safeMaintenance: MaintenanceRecord[] = [];
            if (cloudData.maintenanceFetchError) {
              console.warn('[ItemStore] Cloud maintenance query failed. Preserving local maintenance and backup.');
              if (currentState.maintenanceRecords.length > 0) {
                safeMaintenance = currentState.maintenanceRecords;
              } else {
                const b = await getOrLoadBackup();
                safeMaintenance = (b && b.maintenanceRecords && b.maintenanceRecords.length > 0) ? b.maintenanceRecords : [];
              }
            } else if (cloudData.maintenanceRecords.length > 0) {
              safeMaintenance = verifyOwnership(cloudData.maintenanceRecords);
            } else {
              safeMaintenance = currentState.maintenanceRecords.filter((m) => m.userId === userId);
            }

            // Expenses reconciliation with query failure protection
            let safeExpenses: Expense[] = [];
            if (cloudData.expensesFetchError) {
              console.warn('[ItemStore] Cloud expenses query failed. Preserving local expenses and backup.');
              if (currentState.expenses.length > 0) {
                safeExpenses = currentState.expenses;
              } else {
                const b = await getOrLoadBackup();
                safeExpenses = (b && b.expenses && b.expenses.length > 0) ? b.expenses : [];
              }
            } else if (cloudData.expenses.length > 0) {
              safeExpenses = verifyOwnership(cloudData.expenses);
            } else {
              safeExpenses = currentState.expenses.filter((e) => e.userId === userId);
            }

            const safeActivityLogs = cloudData.activityLogs.length > 0
              ? cloudData.activityLogs.filter((l) => !l.userId || l.userId === userId)
              : currentState.activityLogs.length > 0 ? currentState.activityLogs : [];

            // Save verified complete vault to user backup
            saveUserVaultBackup(userId, {
              items: safeItems,
              documents: safeDocs,
              warranties: safeWarranties,
              receipts: safeReceipts,
              maintenanceRecords: safeMaintenance,
              expenses: safeExpenses,
              activityLogs: safeActivityLogs,
            }).catch(() => {});

            // STALE CHECK 2: Re-verify before final set()
            const finalAuthUser = useAuthStore.getState().user;
            const finalAuthSession = useAuthStore.getState().session;
            const finalUserId = finalAuthUser?.id || finalAuthSession?.user?.id;

            if (!finalUserId || finalUserId !== userId || activeHydrationSessionToken !== sessionToken) {
              console.warn(`[ItemStore] Aborting state commit: user or session changed during hydration.`);
              set({ isLoading: false });
              return { itemCount: 0, docCount: 0, success: false };
            }

            set({
              items: safeItems,
              receipts: safeReceipts,
              warranties: safeWarranties,
              documents: safeDocs,
              maintenanceRecords: safeMaintenance,
              expenses: safeExpenses,
              activityLogs: safeActivityLogs,
              isLoading: false,
              error: itemsSuccess ? null : 'Some items could not be synced from the cloud',
            });

            console.log(
              `[ItemStore] hydrateFromCloud complete for user ${userId}: ` +
              `${safeItems.length} items (success: ${itemsSuccess}), ${safeDocs.length} docs, ` +
              `${safeWarranties.length} warranties, ${safeReceipts.length} receipts`
            );

            // Flush any pending offline operations now that we have confirmed connectivity.
            flushSyncQueue(userId).catch((flushErr) => {
              console.warn('[ItemStore] Post-hydration sync queue flush error:', flushErr);
            });

            // POST-HYDRATION: Safely reconcile and migrate any device-local item photos to private Supabase Storage
            reconcileAndMigrateItemImages(userId, safeItems).catch((migErr) => {
              console.warn('[ItemStore] Post-hydration image reconciliation note:', migErr);
            });

            // POST-HYDRATION: Safely reconcile and migrate any device-local receipts and documents
            reconcileAndMigrateReceiptsAndDocuments(userId).catch((migErr) => {
              console.warn('[ItemStore] Post-hydration receipt/doc reconciliation note:', migErr);
            });

            // POST-HYDRATION: Reconcile notifications asynchronously.
            setTimeout(() => {
              reconcileNotificationsAfterHydration({
                userId,
                items: safeItems,
                warranties: safeWarranties,
                maintenanceRecords: safeMaintenance,
                documents: safeDocs,
              }).catch((reconcileErr) => {
                console.warn('[ItemStore] Post-hydration notification reconciliation error:', reconcileErr);
              });
            }, 0);

            return {
              itemCount: safeItems.length,
              docCount: safeDocs.length,
              success: itemsSuccess,
            };
          } catch (err) {
            console.warn('[ItemStore] hydrateFromCloud failed:', err);
            set({ isLoading: false, error: 'Hydration failed' });
            return { itemCount: 0, docCount: 0, success: false };
          } finally {
            if (inFlightHydrationPromise?.userId === userId) {
              inFlightHydrationPromise = null;
            }
          }
        })();

        inFlightHydrationPromise = { userId, promise };
        return promise;
      },

      clearUserData: () => {
        // Invalidate in-flight hydration tokens immediately
        activeHydrationSessionToken = null;
        inFlightHydrationPromise = null;
        clearInFlightCloudHydrations();
        const userId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;

        // Save entire current vault state to isolated user backup BEFORE clearing in-memory state
        // so recoverable local data is not lost across logout/login
        if (userId) {
          const currentState = get();
          saveUserVaultBackup(userId, {
            items: currentState.items,
            documents: currentState.documents,
            warranties: currentState.warranties,
            receipts: currentState.receipts,
            maintenanceRecords: currentState.maintenanceRecords,
            expenses: currentState.expenses,
            activityLogs: currentState.activityLogs,
          }).catch(() => {});
        }

        // Cancel all scheduled notifications to prevent previous user's reminders from firing.
        NotificationService.cancelAllNotifications().catch((err) => {
          console.warn('[ItemStore] cancelAllNotifications failed during clearUserData:', err);
        });

        // NOTE: We intentionally DO NOT call clearUserSyncQueue(userId) on logout!
        // Pending offline upserts/deletes are strictly scoped by userId and preserved
        // so offline work is never lost. They will safely flush when this user logs back in.

        set({
          items: [],
          receipts: [],
          warranties: [],
          documents: [],
          maintenanceRecords: [],
          expenses: [],
          activityLogs: [],
          searchQuery: '',
          selectedCategory: 'all',
          selectedSort: 'recent',
          selectedWarrantyFilter: 'all',
          isLoading: false,
          error: null,
        });
        AsyncStorage.removeItem('keepr-vault-items-storage').catch((err) => {
          console.warn('[ItemStore] clearUserData AsyncStorage removeItem note:', err);
        });
      },

      addItem: async (params) => {
        const id = generateUUID();
        const now = new Date().toISOString();
        const rawPurchaseDate = params.purchaseDate || now.split('T')[0];
        const purchaseDate = normalizeDateToIso(rawPurchaseDate) || rawPurchaseDate;
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = authUser?.id || authSession?.user?.id;
        if (!userId) {
          throw new Error('Authentication required: User must be signed in to save items.');
        }

        let warrantyUntil = params.warrantyUntil
          ? (normalizeDateToIso(params.warrantyUntil) || params.warrantyUntil)
          : null;
        if (!warrantyUntil && params.warrantyDurationMonths && params.warrantyDurationMonths > 0) {
          try {
            warrantyUntil = calculateWarrantyExpiry(
              purchaseDate,
              params.warrantyDurationMonths
            );
          } catch {
            warrantyUntil = null;
          }
        }

        const rawReturnUntil = params.returnUntil;
        const returnUntil = rawReturnUntil ? (normalizeDateToIso(rawReturnUntil) || rawReturnUntil) : null;

        const qty = Number(params.quantity) || 1;
        const lineTotal = Number(params.purchasePrice) || 0;
        const unitPrice =
          params.unitPrice !== undefined
            ? Number(params.unitPrice)
            : qty > 1
            ? lineTotal / qty
            : lineTotal;

        const canonicalCatId = normalizeToDbCategoryId(params.categoryId);

        let persistentReceiptUri = params.receiptUri || params.initialDocumentUri;
        let persistentStoragePath = params.receiptPath && isStoragePath(params.receiptPath) ? params.receiptPath : undefined;
        if (persistentReceiptUri) {
          try {
            const persistRes = await persistReceiptToVault(
              persistentReceiptUri,
              params.receiptName || params.initialDocumentName
            );
            if (persistRes.persisted && persistRes.uri) {
              persistentReceiptUri = persistRes.uri;
            }
          } catch (pErr) {
            console.warn('[ItemStore] Defensive receipt persistence note:', pErr);
          }
        }

        // Upload receipt to private Supabase Storage (item-documents) with user-scoped path
        if (persistentReceiptUri) {
          if (isStoragePath(persistentReceiptUri)) {
            persistentStoragePath = persistentReceiptUri;
          } else if (userId && isSupabaseConfigured) {
            try {
              const uRes = await uploadItemReceipt(
                userId,
                id,
                persistentReceiptUri,
                params.receiptName || params.initialDocumentName || 'receipt.jpg'
              );
              if (uRes.storagePath) {
                persistentStoragePath = uRes.storagePath;
              }
            } catch (uErr) {
              console.warn('[ItemStore] Background receipt upload notice:', uErr);
            }
          }
        }

        const isInvoice =
          params.receiptType === 'invoice' ||
          Boolean(params.invoiceNumber && params.invoiceNumber.trim());
        const determinedReceiptType: 'receipt' | 'invoice' = params.receiptType || (isInvoice ? 'invoice' : 'receipt');

        // Product photo must NEVER be contaminated by receipt image (Requirement 22)
        const rawCandidates: string[] = [];
        if (params.productPhotos && params.productPhotos.length > 0) {
          rawCandidates.push(...params.productPhotos);
        } else if (params.photoUri) {
          rawCandidates.push(params.photoUri);
        } else if (params.imageUrl) {
          rawCandidates.push(params.imageUrl);
        }

        const rawProductPhotos = canonicalizeProductPhotos(rawCandidates, {
          receiptPath: persistentStoragePath || params.receiptPath,
          receiptUri: persistentReceiptUri || params.receiptUri,
        });

        if (typeof __DEV__ !== 'undefined' ? __DEV__ : false) {
          console.log('[ItemStore:addItem] Product photo validation trace:', {
            incomingProductPhotosCount: params.productPhotos?.length ?? 0,
            photoUriPresent: Boolean(params.photoUri),
            imageUrlPresent: Boolean(params.imageUrl),
            rawCandidatesCount: rawCandidates.length,
            canonicalizedCount: rawProductPhotos.length,
            candidateTypes: rawCandidates.map((c) =>
              isStoragePath(c) ? 'storagePath' : isLocalUri(c) ? 'localUri' : isRemoteUrl(c) ? 'remoteUrl' : 'other'
            ),
          });
        }

        // Requirement 1 & 13: Product Image is strictly REQUIRED for Purchased Items!
        // At least one product image must exist before Save is allowed.
        if (params.products && params.products.length > 0) {
          for (const prod of params.products) {
            if (!prod.productPhotos || prod.productPhotos.length === 0) {
              throw new Error(`[ItemStore] Product photo is strictly required for "${prod.name}".`);
            }
          }
        } else if (rawProductPhotos.length === 0) {
          throw new Error('[ItemStore] Product photo is strictly required for Purchased Items.');
        }

        const persistedProductPhotos: string[] = [];
        for (const photo of rawProductPhotos) {
          try {
            const pRes = await persistProductPhotoToVault(photo, 'product_photo.jpg');
            if (pRes.persisted && pRes.uri) {
              persistedProductPhotos.push(pRes.uri);
            } else {
              persistedProductPhotos.push(photo);
            }
          } catch {
            persistedProductPhotos.push(photo);
          }
        }

        // Upload product photos to private Supabase Storage (item-images) with stable item ID
        // Maintain strict 1-to-1 correspondence with user photos; do NOT append duplicates!
        const finalPhotos: string[] = [];

        for (let idx = 0; idx < persistedProductPhotos.length; idx++) {
          const ph = persistedProductPhotos[idx];
          if (isStoragePath(ph)) {
            finalPhotos.push(ph);
          } else if (userId && isSupabaseConfigured) {
            try {
              const uRes = await uploadItemPhoto(userId, id, ph, idx);
              if (uRes.storagePath) {
                finalPhotos.push(uRes.storagePath);
              } else {
                finalPhotos.push(ph);
              }
            } catch (uErr) {
              console.warn('[ItemStore] Background photo upload notice:', uErr);
              finalPhotos.push(ph);
            }
          } else {
            finalPhotos.push(ph);
          }
        }

        const canonicalFinalPhotos = canonicalizeProductPhotos(
          finalPhotos.length > 0
            ? finalPhotos
            : (params.products && params.products.length > 0
              ? Array.from(new Set([...persistedProductPhotos, ...params.products.flatMap((p) => p.productPhotos)]))
              : persistedProductPhotos),
          {
            receiptPath: persistentStoragePath || params.receiptPath,
            receiptUri: persistentReceiptUri || params.receiptUri,
          }
        );

        const primaryStoragePath = canonicalFinalPhotos.find((p) => isStoragePath(p)) || undefined;
        const primaryLocalPhoto = persistedProductPhotos.find((p) => !isStoragePath(p)) || primaryStoragePath;

        const isMulti = Boolean(params.products && params.products.length > 1);
        const pCount = params.products ? params.products.length : undefined;

        const canonicalStoragePath = (persistentStoragePath && isStoragePath(persistentStoragePath))
          ? persistentStoragePath
          : (params.receiptPath && isStoragePath(params.receiptPath))
          ? params.receiptPath
          : undefined;

        const cleanReceiptId = (params.receiptId && isValidUUID(params.receiptId)) ? params.receiptId : undefined;

        const newItem: Item = {
          id,
          userId,
          name: params.name.trim(),
          categoryId: canonicalCatId,
          productType: params.productType?.trim(),
          categoryConfidence: params.categoryConfidence,
          receiptId: cleanReceiptId,
          receiptUri: canonicalStoragePath || persistentReceiptUri,
          receiptPath: canonicalStoragePath,
          receiptName: params.receiptName || (persistentReceiptUri ? (isInvoice ? 'Invoice.jpg' : 'Receipt.jpg') : undefined),
          receiptType: determinedReceiptType,
          quantity: qty,
          unitPrice,
          brand: params.brand?.trim(),
          model: params.model?.trim(),
          serialNumber: params.serialNumber?.trim(),
          imei: params.imei?.trim(),
          size: params.size?.trim(),
          color: params.color?.trim(),
          material: params.material?.trim(),
          registrationNumber: params.registrationNumber?.trim(),
          insuranceExpiry: params.insuranceExpiry?.trim(),
          pucDate: params.pucDate?.trim(),
          purchaseDate,
          purchasePrice: lineTotal,
          subtotal: params.subtotal !== undefined ? Number(params.subtotal) : undefined,
          discount: params.discount !== undefined ? Number(params.discount) : undefined,
          currency: params.currency || 'INR',
          merchant: params.merchant?.trim(),
          sellerAddress: params.sellerAddress?.trim(),
          gstin: params.gstin?.trim(),
          gstTax: params.gstTax?.trim(),
          gstRate: params.gstRate?.trim(),
          cgst: params.cgst?.trim(),
          sgst: params.sgst?.trim(),
          igst: params.igst?.trim(),
          invoiceNumber: params.invoiceNumber?.trim(),
          returnUntil,
          warrantyUntil,
          warrantyProvider: params.warrantyProvider?.trim(),
          photoUri: primaryLocalPhoto,
          imageUrl: primaryStoragePath || primaryLocalPhoto,
          imageStoragePath: primaryStoragePath,
          productPhotos: canonicalFinalPhotos,
          products: params.products,
          isMultiProduct: isMulti,
          productCount: pCount,
          notes: params.notes?.trim(),
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };

        logReceiptDebug('ITEM_HYDRATED', {
          itemId: id,
          receiptId: cleanReceiptId,
          storedUri: persistentReceiptUri,
          storagePath: canonicalStoragePath,
          fileName: newItem.receiptName,
          exists: Boolean(persistentReceiptUri),
        });

        const updatedItems = [newItem, ...get().items.filter((i) => i.id !== id)];
        let updatedWarranties = [...get().warranties];
        let updatedDocuments = [...get().documents];

        if (warrantyUntil) {
          const newWarranty: Warranty = {
            id: generateUUID(),
            itemId: id,
            userId,
            provider: params.warrantyProvider || `${params.name} Warranty`,
            warrantyType: 'manufacturer',
            durationMonths: params.warrantyDurationMonths || 12,
            startDate: purchaseDate,
            endDate: warrantyUntil,
            reminderEnabled: params.enableWarrantyReminder ?? true,
            reminderDaysBefore: 30,
            createdAt: now,
            updatedAt: now,
          };
          updatedWarranties = [newWarranty, ...updatedWarranties];

          const itemCaps = getCategoryCapabilities(canonicalCatId, params.productType, Boolean(warrantyUntil));
          if (itemCaps.warrantySupported && newWarranty.reminderEnabled) {
            try {
              NotificationService.scheduleWarrantyReminder({
                itemId: id,
                itemName: newItem.name,
                warrantyEndDate: warrantyUntil,
                daysBefore: 30,
              }).catch(() => {});
            } catch (e) {
              console.warn('[ItemStore] Non-fatal warranty reminder scheduling error:', e);
            }
          }
        }

        if (newItem.returnUntil) {
          try {
            NotificationService.scheduleReturnReminder({
              itemId: id,
              itemName: newItem.name,
              returnUntil: newItem.returnUntil,
              daysBefore: 3,
            }).catch(() => {});
          } catch (e) {
            console.warn('[ItemStore] Non-fatal return reminder scheduling error:', e);
          }
        }

        const activityItem: ActivityLog = {
          id: generateUUID(),
          userId,
          itemId: id,
          activityType: 'item_added',
          title: `New Asset Added: ${newItem.name}`,
          description: `₹${lineTotal.toLocaleString('en-IN')}${qty > 1 ? ` (Qty: ${qty})` : ''} · ${params.merchant || 'Store'}`,
          amount: lineTotal,
          createdAt: now,
        };

        set({
          items: updatedItems,
          warranties: updatedWarranties,
          activityLogs: [activityItem, ...get().activityLogs],
        });

        await forceSyncVaultStorage('keepr-vault-items-storage', [newItem], {
          receipts: get().receipts,
          warranties: updatedWarranties,
          documents: updatedDocuments,
          activityLogs: [activityItem, ...get().activityLogs],
        });

        const verifiedItem = get().items.find((i) => i.id === id);
        if (!verifiedItem) {
          throw new Error(`[ItemStore] Acceptance failure: Item ${id} not found in store after insert.`);
        }

        const effectiveUserId = authUser?.id || authSession?.user?.id || userId;
        if (isSupabaseConfigured && effectiveUserId) {
          cloudUpsertItem(newItem, effectiveUserId).then((err) => {
            if (err) {
              // Cloud sync failed — enqueue for retry when connectivity returns.
              enqueueSyncOperation({
                type: 'upsertItem',
                entityId: newItem.id,
                userId: effectiveUserId,
                payload: mapItemToDbRow(newItem, effectiveUserId),
              }).catch(() => {});
            }
          });
        }

        return newItem;
      },

      addMultipleItems: async ({ receipt, items }) => {
        const now = new Date().toISOString();
        const receiptId = generateUUID();
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = authUser?.id || authSession?.user?.id;
        if (!userId) {
          throw new Error('Authentication required: User must be signed in to save purchases.');
        }

        // 0. Persist single receipt image into permanent vault storage (Requirement 15)
        let persistentReceiptUri = receipt.fileUri;
        if (persistentReceiptUri) {
          try {
            const persistRes = await persistReceiptToVault(persistentReceiptUri, receipt.fileName);
            if (persistRes.persisted && persistRes.uri) {
              persistentReceiptUri = persistRes.uri;
            }
          } catch (pErr) {
            console.warn('[ItemStore] Multi-item receipt vault persistence note:', pErr);
          }
        }

        const isInvoice = Boolean(receipt.invoiceNumber && receipt.invoiceNumber.trim()) || items.length > 1;
        const receiptType: 'receipt' | 'invoice' = isInvoice ? 'invoice' : 'receipt';

        // Requirement 13 & 14: Every product in a multi-product purchase requires at least 1 product photo
        for (const it of items) {
          const hasPhoto = Boolean((it.productPhotos && it.productPhotos.length > 0) || it.photoUri);
          if (!hasPhoto) {
            throw new Error(`[ItemStore] Product photo is strictly required for "${it.name}".`);
          }
        }

        const purchaseId = generateUUID();

        // Upload shared receipt to private Supabase Storage (item-documents)
        let durableReceiptStoragePath: string | undefined = undefined;
        if (persistentReceiptUri) {
          if (isStoragePath(persistentReceiptUri)) {
            durableReceiptStoragePath = persistentReceiptUri;
          } else if (userId && isSupabaseConfigured) {
            try {
              const uRes = await uploadItemReceipt(
                userId,
                purchaseId,
                persistentReceiptUri,
                receipt.fileName || (isInvoice ? 'Invoice.jpg' : 'Receipt.jpg')
              );
              if (uRes.storagePath) {
                durableReceiptStoragePath = uRes.storagePath;
              }
            } catch (uErr) {
              console.warn('[ItemStore] Multi-item receipt upload notice:', uErr);
            }
          }
        }

        // 1. Single shared Receipt record
        const newReceipt: Receipt = {
          id: receiptId,
          userId,
          fileUri: durableReceiptStoragePath || persistentReceiptUri,
          storagePath: durableReceiptStoragePath,
          fileName: receipt.fileName || (isInvoice ? 'Invoice.jpg' : 'Receipt.jpg'),
          type: receiptType,
          merchant: receipt.merchant,
          sellerAddress: receipt.sellerAddress,
          gstin: receipt.gstin,
          purchaseDate: receipt.purchaseDate || now.split('T')[0],
          totalAmount: receipt.totalAmount,
          subtotal: receipt.subtotal,
          discount: receipt.discount,
          gstTax: receipt.gstTax,
          invoiceNumber: receipt.invoiceNumber,
          itemCount: items.length,
          itemIds: [purchaseId],
          createdAt: now,
          updatedAt: now,
        };

        const purchasedProducts: PurchasedProduct[] = [];
        const createdWarranties: Warranty[] = [];
        const purchaseDate = normalizeDateToIso(receipt.purchaseDate || '') || (receipt.purchaseDate || now.split('T')[0]);

        for (let idx = 0; idx < items.length; idx++) {
          const it = items[idx];
          const prodId = generateUUID();
          const lineTotal = Number(it.purchasePrice) || 0;
          const qty = Number(it.quantity) || 1;
          const unitPrice =
            it.unitPrice !== undefined
              ? Number(it.unitPrice)
              : qty > 1
              ? lineTotal / qty
              : lineTotal;

          const rawCandidates = it.productPhotos && it.productPhotos.length > 0 ? it.productPhotos : (it.photoUri ? [it.photoUri] : []);
          const rawPhotos = canonicalizeProductPhotos(rawCandidates, {
            receiptPath: durableReceiptStoragePath || receipt.fileUri,
            receiptUri: persistentReceiptUri || receipt.fileUri,
          });
          const persistedPhotos: string[] = [];
          for (const ph of rawPhotos) {
            try {
              const pRes = await persistProductPhotoToVault(ph, 'product_photo.jpg');
              persistedPhotos.push(pRes.persisted && pRes.uri ? pRes.uri : ph);
            } catch {
              persistedPhotos.push(ph);
            }
          }

          const finalItemPhotos: string[] = [];
          for (let pIdx = 0; pIdx < persistedPhotos.length; pIdx++) {
            const pUri = persistedPhotos[pIdx];
            if (isStoragePath(pUri)) {
              finalItemPhotos.push(pUri);
            } else if (userId && isSupabaseConfigured) {
              try {
                const uRes = await uploadItemPhoto(userId, purchaseId, pUri, pIdx);
                if (uRes.storagePath) {
                  finalItemPhotos.push(uRes.storagePath);
                } else {
                  finalItemPhotos.push(pUri);
                }
              } catch {
                finalItemPhotos.push(pUri);
              }
            } else {
              finalItemPhotos.push(pUri);
            }
          }

          const productFinalPhotos = canonicalizeProductPhotos(
            finalItemPhotos.length > 0 ? finalItemPhotos : persistedPhotos,
            {
              receiptPath: durableReceiptStoragePath || receipt.fileUri,
              receiptUri: persistentReceiptUri || receipt.fileUri,
            }
          );

          const itemWarranty = it.warrantyUntil ? (normalizeDateToIso(it.warrantyUntil) || it.warrantyUntil) : null;
          const itemReturn = it.returnUntil ? (normalizeDateToIso(it.returnUntil) || it.returnUntil) : null;

          purchasedProducts.push({
            id: prodId,
            name: it.name.trim(),
            categoryId: normalizeToDbCategoryId(it.categoryId),
            category: it.categoryId,
            productType: it.productType,
            categoryConfidence: it.categoryConfidence || 'high',
            brand: it.brand?.trim(),
            model: it.model?.trim(),
            serialNumber: it.serialNumber?.trim(),
            quantity: qty,
            unitPrice,
            lineTotal,
            warrantyUntil: itemWarranty,
            warrantyProvider: it.warrantyProvider?.trim() || (it.brand ? `${it.brand} Warranty` : undefined),
            returnUntil: itemReturn,
            productPhotos: productFinalPhotos,
            notes: it.notes?.trim(),
          });

          if (itemWarranty) {
            const warId = generateUUID();
            const newWar: Warranty = {
              id: warId,
              itemId: purchaseId,
              userId,
              provider: it.warrantyProvider || (it.brand ? `${it.brand} Warranty` : `${it.name} Warranty`),
              warrantyType: 'manufacturer',
              durationMonths: 12,
              startDate: purchaseDate,
              endDate: itemWarranty,
              reminderEnabled: it.enableWarrantyReminder ?? true,
              reminderDaysBefore: 30,
              createdAt: now,
              updatedAt: now,
            };
            createdWarranties.push(newWar);
          }
        }

        const allProductPhotos = canonicalizeProductPhotos(
          purchasedProducts.flatMap((p) => p.productPhotos),
          {
            receiptPath: durableReceiptStoragePath || receipt.fileUri,
            receiptUri: persistentReceiptUri || receipt.fileUri,
          }
        );
        const primaryPhoto = allProductPhotos[0] || undefined;
        const primaryStoragePath = allProductPhotos.find((p) => isStoragePath(p)) || undefined;
        const totalPurchasePrice = receipt.totalAmount || purchasedProducts.reduce((sum, p) => sum + p.lineTotal, 0);

        const purchaseName = receipt.merchant
          ? (items.length > 1 ? `${receipt.merchant.trim()} Purchase (${items.length} products)` : items[0].name.trim())
          : (items.length > 1 ? `${items[0].name.trim()} + ${items.length - 1} more` : items[0].name.trim());

        const groupedItem: Item = {
          id: purchaseId,
          userId,
          name: purchaseName,
          categoryId: purchasedProducts[0]?.categoryId || 'other',
          productType: purchasedProducts[0]?.productType,
          categoryConfidence: 'high',
          receiptId,
          receiptUri: durableReceiptStoragePath || persistentReceiptUri,
          receiptPath: durableReceiptStoragePath,
          receiptName: receipt.fileName || (isInvoice ? 'Invoice.jpg' : 'Receipt.jpg'),
          receiptType,
          purchaseDate,
          purchasePrice: totalPurchasePrice,
          subtotal: receipt.subtotal,
          discount: receipt.discount,
          gstTax: receipt.gstTax,
          invoiceNumber: receipt.invoiceNumber?.trim(),
          merchant: receipt.merchant?.trim(),
          sellerAddress: receipt.sellerAddress?.trim(),
          gstin: receipt.gstin?.trim(),
          quantity: items.length > 1 ? items.length : (purchasedProducts[0]?.quantity || 1),
          unitPrice: items.length === 1 ? purchasedProducts[0]?.unitPrice : undefined,
          currency: items[0]?.currency || 'INR',
          photoUri: primaryPhoto,
          imageUrl: primaryStoragePath || primaryPhoto,
          imageStoragePath: primaryStoragePath,
          productPhotos: allProductPhotos,
          products: purchasedProducts,
          isMultiProduct: items.length > 1,
          productCount: items.length,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };

        const createdItems: Item[] = [groupedItem];

        const createdLogs: ActivityLog[] = [
          {
            id: generateUUID(),
            userId,
            itemId: purchaseId,
            activityType: 'item_added',
            title: `Purchase Added: ${purchaseName}`,
            description: `₹${totalPurchasePrice.toLocaleString('en-IN')} · ${receipt.merchant || 'Store'} · ${items.length} products`,
            amount: totalPurchasePrice,
            createdAt: now,
          },
        ];

        const updatedItems = [groupedItem, ...get().items.filter((i) => i.id !== purchaseId)];
        const updatedWarranties = [...createdWarranties, ...get().warranties];
        const updatedLogs = [...createdLogs, ...get().activityLogs];

        set({
          receipts: [newReceipt, ...get().receipts],
          items: updatedItems,
          warranties: updatedWarranties,
          activityLogs: updatedLogs,
        });

        await forceSyncVaultStorage('keepr-vault-items-storage', createdItems, {
          receipts: [newReceipt, ...get().receipts],
          warranties: updatedWarranties,
          documents: get().documents,
          activityLogs: updatedLogs,
        });

        const effectiveUserId = authUser?.id || authSession?.user?.id || userId;
        if (isSupabaseConfigured && effectiveUserId) {
          const uid = effectiveUserId;
          cloudUpsertReceipt(newReceipt, uid).then((err) => {
            if (err) {
              enqueueSyncOperation({
                type: 'upsertReceipt',
                entityId: newReceipt.id,
                userId: uid,
                payload: mapReceiptToDbRow(newReceipt, uid),
              }).catch(() => {});
            }
          }).catch((e) =>
            console.warn('[ItemStore] addMultipleItems receipt sync:', e)
          );
          cloudUpsertItem(groupedItem, uid).then((err) => {
            if (err) {
              enqueueSyncOperation({
                type: 'upsertItem',
                entityId: groupedItem.id,
                userId: uid,
                payload: mapItemToDbRow(groupedItem, uid),
              }).catch(() => {});
            }
          }).catch((e) =>
            console.warn('[ItemStore] addMultipleItems item sync:', e)
          );
          for (const w of createdWarranties) {
            cloudUpsertWarranty(w, uid).then((err) => {
              if (err) {
                enqueueSyncOperation({
                  type: 'upsertWarranty',
                  entityId: w.id,
                  userId: uid,
                  payload: mapWarrantyToDbRow(w, uid),
                }).catch(() => {});
              }
            }).catch((e) =>
              console.warn('[ItemStore] addMultipleItems warranty sync:', e)
            );
          }
          for (const log of createdLogs) {
            cloudUpsertActivityLog(log, uid).catch((e) =>
              console.warn('[ItemStore] addMultipleItems activity sync:', e)
            );
          }
        }

        return createdItems;
      },

      addReceipt: async (receiptData) => {
        const now = new Date().toISOString();
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = receiptData.userId || authUser?.id || authSession?.user?.id;
        if (!userId) {
          throw new Error('Authentication required: User must be signed in to save receipts.');
        }
        const newReceipt: Receipt = {
          ...receiptData,
          userId,
          id: generateUUID(),
          createdAt: now,
          updatedAt: now,
        };
        set({ receipts: [newReceipt, ...get().receipts] });
        if (isSupabaseConfigured && authUser?.id) {
          cloudUpsertReceipt(newReceipt, authUser.id).catch((e) => {
            console.warn('[ItemStore] addReceipt cloud sync notice:', e);
          });
        }
        return newReceipt;
      },

      getReceiptById: (id) => {
        return get().receipts.find((r) => r.id === id);
      },

      getItemsByReceiptId: (receiptId) => {
        return get().items.filter((i) => i.receiptId === receiptId);
      },

      updateItem: async (itemId, updates) => {
        const now = new Date().toISOString();
        const authUser = useAuthStore.getState().user;
        const currentItem = get().items.find((i) => i.id === itemId);
        const userId = currentItem?.userId || authUser?.id || 'system';
        let updatedReceiptPath = updates.receiptPath && isStoragePath(updates.receiptPath)
          ? updates.receiptPath
          : currentItem?.receiptPath && isStoragePath(currentItem.receiptPath)
          ? currentItem.receiptPath
          : undefined;

        if (updates.receiptUri) {
          if (isStoragePath(updates.receiptUri)) {
            updatedReceiptPath = updates.receiptUri;
          } else if (userId && isSupabaseConfigured) {
            try {
              const uRes = await uploadItemReceipt(
                userId,
                itemId,
                updates.receiptUri,
                updates.receiptName || currentItem?.receiptName || 'receipt.jpg'
              );
              if (uRes.storagePath) {
                updatedReceiptPath = uRes.storagePath;
              }
            } catch (uErr) {
              console.warn('[ItemStore] updateItem receipt upload notice:', uErr);
            }
          }
        }

        let updatedPhotos = updates.productPhotos;
        let updatedStoragePath = updates.imageStoragePath ?? currentItem?.imageStoragePath;

        if (updates.productPhotos && Array.isArray(updates.productPhotos)) {
          const sanitizedCandidates = canonicalizeProductPhotos(updates.productPhotos, {
            receiptPath: updatedReceiptPath || currentItem?.receiptPath,
            receiptUri: updates.receiptUri || currentItem?.receiptUri,
          });

          const finalPhotos: string[] = [];
          for (let pIdx = 0; pIdx < sanitizedCandidates.length; pIdx++) {
            const p = sanitizedCandidates[pIdx];
            if (isStoragePath(p)) {
              finalPhotos.push(p);
            } else if (userId && isSupabaseConfigured) {
              try {
                const uRes = await uploadItemPhoto(userId, itemId, p, pIdx);
                if (uRes.storagePath) {
                  finalPhotos.push(uRes.storagePath);
                } else {
                  finalPhotos.push(p);
                }
              } catch {
                finalPhotos.push(p);
              }
            } else {
              finalPhotos.push(p);
            }
          }
          updatedPhotos = canonicalizeProductPhotos(finalPhotos, {
            receiptPath: updatedReceiptPath || currentItem?.receiptPath,
            receiptUri: updates.receiptUri || currentItem?.receiptUri,
          });
          const firstStorage = updatedPhotos.find((p) => isStoragePath(p));
          if (firstStorage) {
            updatedStoragePath = firstStorage;
          }
        }

        const finalUpdates: Partial<Item> = {
          ...updates,
          receiptPath: updatedReceiptPath,
          receiptUri: updatedReceiptPath || updates.receiptUri || currentItem?.receiptUri,
          imageStoragePath: updatedStoragePath,
          imageUrl: updatedStoragePath || updates.imageUrl || currentItem?.imageUrl,
          productPhotos: updatedPhotos ?? currentItem?.productPhotos,
          updatedAt: now,
        };

        const updated = get().items.map((i) =>
          i.id === itemId
            ? {
                ...i,
                ...finalUpdates,
              }
            : i
        );

        let updatedWarranties = [...get().warranties];
        if (updates.warrantyUntil !== undefined || updates.warrantyProvider !== undefined) {
          const warrantyEnd = updates.warrantyUntil ?? currentItem?.warrantyUntil;
          const provider = updates.warrantyProvider ?? currentItem?.warrantyProvider;

          if (warrantyEnd) {
            const existingIdx = updatedWarranties.findIndex((w) => w.itemId === itemId);
            if (existingIdx >= 0) {
              updatedWarranties[existingIdx] = {
                ...updatedWarranties[existingIdx],
                endDate: warrantyEnd,
                provider: provider || updatedWarranties[existingIdx].provider,
                updatedAt: now,
              };
            } else {
              updatedWarranties.unshift({
                id: generateUUID(),
                itemId,
                userId,
                provider: provider || `${currentItem?.name || 'Item'} Warranty`,
                warrantyType: 'manufacturer',
                durationMonths: 12,
                startDate: currentItem?.purchaseDate || now.split('T')[0],
                endDate: warrantyEnd,
                reminderEnabled: true,
                reminderDaysBefore: 30,
                createdAt: now,
                updatedAt: now,
              });
            }
          }
        }

        if (updates.returnUntil) {
          NotificationService.scheduleReturnReminder({
            itemId,
            itemName: updates.name || currentItem?.name || 'Item',
            returnUntil: updates.returnUntil,
            daysBefore: 3,
          });
        }

        let updatedDocuments = [...get().documents];
        if (updates.receiptUri !== undefined) {
          const docIdx = updatedDocuments.findIndex(
            (d) => d.itemId === itemId && (d.fileType === 'receipt' || d.fileType === 'invoice')
          );
          if (docIdx >= 0) {
            updatedDocuments[docIdx] = {
              ...updatedDocuments[docIdx],
              fileUrl: updates.receiptUri || '',
              filePath: updatedReceiptPath || updatedDocuments[docIdx].filePath,
              name: updates.receiptName || updatedDocuments[docIdx].name,
            };
          }
        }

        logReceiptDebug('ITEM_HYDRATED', {
          itemId,
          storedUri: updates.receiptUri ?? currentItem?.receiptUri,
          storagePath: updatedReceiptPath,
          fileName: updates.receiptName ?? currentItem?.receiptName,
        });

        set({ items: updated, warranties: updatedWarranties, documents: updatedDocuments });

        const effectiveUserId = authUser?.id || useAuthStore.getState().session?.user?.id || userId;
        if (isSupabaseConfigured && effectiveUserId) {
          const updatedItem = get().items.find((i) => i.id === itemId);
          if (updatedItem) {
            cloudUpsertItem(updatedItem, effectiveUserId).then((err) => {
              if (err) {
                enqueueSyncOperation({
                  type: 'upsertItem',
                  entityId: updatedItem.id,
                  userId: effectiveUserId,
                  payload: mapItemToDbRow(updatedItem, effectiveUserId),
                }).catch(() => {});
              }
            }).catch((e) => {
              console.warn('[ItemStore] updateItem cloud sync exception:', e);
            });
          }
        }
      },

      deleteItem: async (itemId) => {
        try {
          await NotificationService.cancelItemReminders(itemId);
        } catch {
        }

        const target = get().items.find((i) => i.id === itemId);
        const updatedItems = get().items.filter((i) => i.id !== itemId);
        const updatedWarranties = get().warranties.filter((w) => w.itemId !== itemId);
        // Requirement 25: Deleting an Item unlinks related documents (ON DELETE SET NULL),
        // preserving them as standalone documents in the Document vault.
        const unlinkedDocs: VaultDocument[] = [];
        const updatedDocs = get().documents.map((d) => {
          if (d.itemId === itemId) {
            const unlinked: VaultDocument = { ...d, itemId: null };
            unlinkedDocs.push(unlinked);
            return unlinked;
          }
          return d;
        });
        const updatedMaint = get().maintenanceRecords.filter((m) => m.itemId !== itemId);
        const updatedExp = get().expenses.filter((e) => e.itemId !== itemId);

        // Receipt lifecycle management (Requirement 18)
        let updatedReceipts = [...get().receipts];
        if (target) {
          const targetReceiptId = target.receiptId;
          const targetReceiptUri = target.receiptUri;

          // Clean up product photos from Supabase Storage
          const photosToDelete = (target.productPhotos || [])
            .concat([target.imageStoragePath, target.imageUrl].filter((p): p is string => Boolean(p)))
            .filter((p) => isStoragePath(p));
          if (photosToDelete.length > 0) {
            deleteItemPhotosFromStorage(photosToDelete).catch(() => {});
          }

          if (targetReceiptId) {
            const otherItemsSharing = updatedItems.filter((i) => i.receiptId === targetReceiptId);
            if (otherItemsSharing.length === 0) {
              // No other items share this receipt -> remove receipt record & delete local physical vault file
              updatedReceipts = updatedReceipts.filter((r) => r.id !== targetReceiptId);
              if (targetReceiptUri) {
                deleteLocalVaultFile(targetReceiptUri).catch(() => {});
              }
            } else {
              updatedReceipts = updatedReceipts.map((r) =>
                r.id === targetReceiptId
                  ? { ...r, itemIds: r.itemIds.filter((id) => id !== itemId) }
                  : r
              );
            }
          } else if (targetReceiptUri) {
            const otherItemsWithUri = updatedItems.filter((i) => i.receiptUri === targetReceiptUri);
            if (otherItemsWithUri.length === 0) {
              deleteLocalVaultFile(targetReceiptUri).catch(() => {});
            }
          }
        }

        const authUser = useAuthStore.getState().user;
        const log: ActivityLog = {
          id: generateUUID(),
          userId: authUser?.id || 'system',
          itemId,
          activityType: 'item_deleted',
          title: `Asset Removed: ${target?.name || 'Item'}`,
          createdAt: new Date().toISOString(),
        };

        set({
          items: updatedItems,
          receipts: updatedReceipts,
          warranties: updatedWarranties,
          documents: updatedDocs,
          maintenanceRecords: updatedMaint,
          expenses: updatedExp,
          activityLogs: [log, ...get().activityLogs],
        });

        if (isSupabaseConfigured) {
          const deleteUserId = authUser?.id || 'unknown';
          cloudDeleteItem(itemId).then((err) => {
            if (err) {
              enqueueSyncOperation({
                type: 'deleteItem',
                entityId: itemId,
                userId: deleteUserId,
                payload: null,
              }).catch(() => {});
            }
          }).catch((e) => {
            console.warn('[ItemStore] deleteItem cloud sync exception:', e);
          });
          for (const doc of unlinkedDocs) {
            if (doc.userId) {
              cloudUpsertDocument(doc, doc.userId).then((err) => {
                if (err) {
                  enqueueSyncOperation({
                    type: 'upsertDocument',
                    entityId: doc.id,
                    userId: doc.userId!,
                    payload: mapDocumentToDbRow(doc, doc.userId!),
                  }).catch(() => {});
                }
              }).catch(() => {});
            }
          }
        }
      },

      addWarranty: async (warrantyData) => {
        const now = new Date().toISOString();
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = warrantyData.userId || authUser?.id || authSession?.user?.id;
        if (!userId) {
          throw new Error('Authentication required: User must be signed in to save warranties.');
        }
        const newWarranty: Warranty = {
          ...warrantyData,
          id: generateUUID(),
          userId,
          createdAt: now,
          updatedAt: now,
        };

        set({ warranties: [newWarranty, ...get().warranties] });

        if (newWarranty.reminderEnabled) {
          const item = get().items.find((i) => i.id === newWarranty.itemId);
          const caps = getCategoryCapabilities(item?.categoryId || item?.category, item?.productType, Boolean(newWarranty.endDate));
          if (caps.warrantySupported) {
            NotificationService.scheduleWarrantyReminder({
              itemId: newWarranty.itemId,
              itemName: item?.name || 'Asset',
              warrantyEndDate: newWarranty.endDate,
              daysBefore: newWarranty.reminderDaysBefore || 30,
            });
          }
        }

        if (isSupabaseConfigured && authUser?.id) {
          cloudUpsertWarranty(newWarranty, authUser.id).catch((e) => {
            console.warn('[ItemStore] addWarranty cloud sync notice:', e);
          });
        }

        return newWarranty;
      },

      updateWarranty: async (warrantyId, updates) => {
        const updated = get().warranties.map((w) =>
          w.id === warrantyId ? { ...w, ...updates, updatedAt: new Date().toISOString() } : w
        );
        set({ warranties: updated });
      },

      addMaintenanceRecord: async (recordData) => {
        const now = new Date().toISOString();
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = recordData.userId || authUser?.id || authSession?.user?.id;
        if (!userId) {
          throw new Error('Authentication required: User must be signed in to log maintenance.');
        }
        const recordId = (recordData.id && isValidUUID(recordData.id)) ? recordData.id : generateUUID();
        const costAmount = recordData.amountPaid != null
          ? Number(recordData.amountPaid)
          : (Number(recordData.cost) || 0);

        const newRecord: MaintenanceRecord = {
          ...recordData,
          id: recordId,
          userId,
          cost: costAmount,
          amountPaid: costAmount,
          currency: recordData.currency || 'INR',
          serviceType: recordData.serviceType || 'Maintenance',
          status: recordData.status || 'completed',
          documentIds: recordData.documentIds || [],
          attachments: recordData.attachments || [],
          createdAt: now,
          updatedAt: now,
        };

        const item = recordData.itemId ? get().items.find((i) => i.id === recordData.itemId) : null;

        const log: ActivityLog = {
          id: generateUUID(),
          userId,
          itemId: recordData.itemId || undefined,
          activityType: 'maintenance_completed',
          title: `${newRecord.serviceType || 'Service'}: ${recordData.title}`,
          description: `${item?.name || 'Standalone Service'} · ₹${costAmount.toLocaleString('en-IN')}`,
          amount: costAmount,
          createdAt: now,
        };

        set({
          maintenanceRecords: [newRecord, ...get().maintenanceRecords],
          activityLogs: [log, ...get().activityLogs],
        });

        // Reminders: post-service warranty / guarantee / next service date
        NotificationService.scheduleServiceCoverageReminders(newRecord, item?.name).catch(() => {});

        if (isSupabaseConfigured && userId) {
          cloudUpsertMaintenance(newRecord, userId).then((err) => {
            if (err) {
              enqueueSyncOperation({
                type: 'upsertMaintenance',
                entityId: newRecord.id,
                userId,
                payload: mapMaintenanceToDbRow(newRecord, userId),
              }).catch(() => {});
            }
          }).catch((syncErr) => {
            console.warn('[ItemStore] addMaintenanceRecord cloud sync notice:', syncErr);
          });
        }

        return newRecord;
      },

      updateMaintenanceRecord: async (recordId, updates) => {
        const now = new Date().toISOString();
        const current = get().maintenanceRecords.find((m) => m.id === recordId);
        if (!current) return null;

        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = current.userId || authUser?.id || authSession?.user?.id;

        const costAmount = updates.amountPaid != null
          ? Number(updates.amountPaid)
          : updates.cost != null
          ? Number(updates.cost)
          : current.cost;

        const updatedRecord: MaintenanceRecord = {
          ...current,
          ...updates,
          cost: costAmount,
          amountPaid: costAmount,
          updatedAt: now,
        };

        set({
          maintenanceRecords: get().maintenanceRecords.map((m) => (m.id === recordId ? updatedRecord : m)),
        });

        const item = updatedRecord.itemId ? get().items.find((i) => i.id === updatedRecord.itemId) : null;
        NotificationService.scheduleServiceCoverageReminders(updatedRecord, item?.name).catch(() => {});

        if (isSupabaseConfigured && userId) {
          cloudUpsertMaintenance(updatedRecord, userId).then((err) => {
            if (err) {
              enqueueSyncOperation({
                type: 'upsertMaintenance',
                entityId: updatedRecord.id,
                userId,
                payload: mapMaintenanceToDbRow(updatedRecord, userId),
              }).catch(() => {});
            }
          }).catch((syncErr) => {
            console.warn('[ItemStore] updateMaintenanceRecord cloud sync notice:', syncErr);
          });
        }

        return updatedRecord;
      },

      deleteMaintenanceRecord: async (recordId) => {
        const current = get().maintenanceRecords.find((m) => m.id === recordId);
        set({
          maintenanceRecords: get().maintenanceRecords.filter((m) => m.id !== recordId),
        });

        NotificationService.cancelServiceReminders(recordId).catch(() => {});

        if (isSupabaseConfigured) {
          const authUser = useAuthStore.getState().user;
          const authSession = useAuthStore.getState().session;
          const userId = current?.userId || authUser?.id || authSession?.user?.id;

          cloudDeleteMaintenance(recordId).then((err) => {
            if (err && userId) {
              enqueueSyncOperation({
                type: 'deleteMaintenance',
                entityId: recordId,
                userId,
                payload: null,
              }).catch(() => {});
            }
          }).catch((syncErr) => {
            console.warn('[ItemStore] deleteMaintenanceRecord cloud sync notice:', syncErr);
          });
        }
      },

      getMaintenanceRecordById: (recordId: string) => {
        const currentUserId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;
        const rec = get().maintenanceRecords.find((m) => m.id === recordId);
        if (!rec) return undefined;
        if (currentUserId && rec.userId && rec.userId !== currentUserId) {
          return undefined;
        }
        return rec;
      },

      getMaintenanceRecordsByItemId: (itemId: string) => {
        const currentUserId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;
        return get().maintenanceRecords.filter((m) => {
          if (m.itemId !== itemId) return false;
          if (currentUserId && m.userId && m.userId !== currentUserId) return false;
          return true;
        });
      },

      getAllMaintenanceRecords: () => {
        const currentUserId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;
        return get().maintenanceRecords.filter((m) => {
          if (currentUserId && m.userId && m.userId !== currentUserId) return false;
          return true;
        });
      },

      addExpense: async (expenseData) => {
        const now = new Date().toISOString();
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = expenseData.userId || authUser?.id || authSession?.user?.id;
        if (!userId) {
          throw new Error('Authentication required: User must be signed in to log expenses.');
        }
        const newExpense: Expense = {
          ...expenseData,
          id: generateUUID(),
          userId,
          amount: Number(expenseData.amount) || 0,
          createdAt: now,
        };

        const item = get().items.find((i) => i.id === expenseData.itemId);

        const log: ActivityLog = {
          id: generateUUID(),
          userId,
          itemId: expenseData.itemId,
          activityType: 'expense_added',
          title: `Expense: ${expenseData.title}`,
          description: `${item?.name || 'Item'} · ₹${newExpense.amount.toLocaleString('en-IN')}`,
          amount: newExpense.amount,
          createdAt: now,
        };

        set({
          expenses: [newExpense, ...get().expenses],
          activityLogs: [log, ...get().activityLogs],
        });

        if (isSupabaseConfigured && authUser?.id) {
          cloudUpsertExpense(newExpense, authUser.id).catch((e) => {
            console.warn('[ItemStore] addExpense cloud sync notice:', e);
          });
        }

        return newExpense;
      },

      deleteExpense: async (expenseId) => {
        set({
          expenses: get().expenses.filter((e) => e.id !== expenseId),
        });
        if (isSupabaseConfigured) {
          cloudDeleteExpense(expenseId).catch((e) => {
            console.warn('[ItemStore] deleteExpense cloud sync notice:', e);
          });
        }
      },

      addDocument: async (docData) => {
        const now = new Date().toISOString();
        const docId = (docData.id && isValidUUID(docData.id)) ? docData.id : generateUUID();
        const validItemId = (docData.itemId && isValidUUID(docData.itemId)) ? docData.itemId : null;
        const title = docData.title || docData.name || 'Untitled Document';
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = docData.userId || authUser?.id || authSession?.user?.id;
        if (!userId) {
          throw new Error('Authentication required: User must be signed in to add documents.');
        }
        const fileSizeBytes = docData.fileSizeBytes || 0;
        const filePath = docData.filePath || docData.fileUrl || '';
        const cleanCandidate = (filePath || docData.storagePath || docData.fileUrl || '').trim().split(/[?#]/)[0].toLowerCase();
        const isPdf = cleanCandidate.endsWith('.pdf') || docData.mimeType?.toLowerCase().includes('pdf');
        const mimeType = docData.mimeType || (isPdf ? 'application/pdf' : cleanCandidate.endsWith('.png') ? 'image/png' : cleanCandidate.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
        const fileType = docData.fileType || (isPdf ? 'pdf' : 'image');

        let durableStoragePath = docData.storagePath && isStoragePath(docData.storagePath) ? docData.storagePath : undefined;
        if (filePath && !durableStoragePath && !isStoragePath(filePath) && isSupabaseConfigured && userId) {
          try {
            const uploadRes = await uploadVaultDocument(
              userId,
              docId,
              filePath,
              validItemId,
              docData.name || docData.title || 'document',
              ''
            );
            if (uploadRes.storagePath) {
              durableStoragePath = uploadRes.storagePath;
            }
          } catch (uErr) {
            console.warn('[itemStore] addDocument storage upload note:', uErr);
          }
        }

        const newDoc: VaultDocument = {
          ...docData,
          id: docId,
          itemId: validItemId,
          userId,
          filePath: durableStoragePath || filePath,
          fileUrl: durableStoragePath || docData.fileUrl || filePath,
          storagePath: durableStoragePath,
          fileType,
          mimeType,
          fileSizeBytes,
          title,
          name: title,
          category: docData.category || 'Other Important Documents',
          documentType: docData.documentType || 'Other Important Document',
          currency: docData.currency || 'INR',
          createdAt: now,
          updatedAt: now,
        };

        const item = validItemId ? get().items.find((i) => i.id === validItemId) : null;

        const log: ActivityLog = {
          id: generateUUID(),
          userId,
          itemId: validItemId || undefined,
          activityType: 'document_uploaded',
          title: `Document Attached: ${title}`,
          description: item ? `Vault Safe · ${item.name}` : 'Vault Safe · Standalone Document',
          createdAt: now,
        };

        set({
          documents: [newDoc, ...get().documents],
          activityLogs: [log, ...get().activityLogs],
        });

        if (isSupabaseConfigured && userId) {
          cloudUpsertDocument(newDoc, userId).then((err) => {
            if (err) {
              enqueueSyncOperation({
                type: 'upsertDocument',
                entityId: newDoc.id,
                userId,
                payload: mapDocumentToDbRow(newDoc, userId),
              }).catch(() => {});
            }
          }).catch((syncErr) => {
            console.warn('[itemStore] addDocument cloud sync exception:', syncErr);
          });
        }

        NotificationService.scheduleSmartDocumentReminders(newDoc, item).catch((remErr) => {
          console.warn('[itemStore] addDocument reminder scheduling notice:', remErr);
        });

        return newDoc;
      },

      updateDocument: async (documentId, updates) => {
        const now = new Date().toISOString();
        const current = get().documents.find((d) => d.id === documentId);
        if (!current) return;

        let durableStoragePath = updates.storagePath && isStoragePath(updates.storagePath)
          ? updates.storagePath
          : current.storagePath && isStoragePath(current.storagePath)
          ? current.storagePath
          : undefined;

        const candidateFilePath = updates.filePath || updates.fileUrl;
        if (candidateFilePath && !isStoragePath(candidateFilePath) && isSupabaseConfigured && current.userId) {
          try {
            const uploadRes = await uploadVaultDocument(
              current.userId,
              documentId,
              candidateFilePath,
              updates.itemId !== undefined ? updates.itemId : current.itemId,
              updates.title || current.title,
              ''
            );
            if (uploadRes.storagePath) {
              durableStoragePath = uploadRes.storagePath;
            }
          } catch (uErr) {
            console.warn('[itemStore] updateDocument storage upload note:', uErr);
          }
        }

        const effectiveFilePath = durableStoragePath || updates.filePath || current.filePath || '';
        const cleanCandidate = (effectiveFilePath || updates.fileUrl || current.fileUrl || '').trim().split(/[?#]/)[0].toLowerCase();
        const isPdf = cleanCandidate.endsWith('.pdf') || (updates.mimeType || current.mimeType)?.toLowerCase().includes('pdf');
        const fileType = updates.fileType || (isPdf ? 'pdf' : 'image');
        const mimeType = updates.mimeType || (isPdf ? 'application/pdf' : cleanCandidate.endsWith('.png') ? 'image/png' : cleanCandidate.endsWith('.webp') ? 'image/webp' : (current.mimeType && current.mimeType !== 'application/pdf' && current.mimeType !== 'application/octet-stream') ? current.mimeType : 'image/jpeg');

        const updatedDoc: VaultDocument = {
          ...current,
          ...updates,
          storagePath: durableStoragePath,
          filePath: effectiveFilePath,
          fileUrl: durableStoragePath || updates.fileUrl || current.fileUrl,
          fileType,
          mimeType,
          title: updates.title || updates.name || current.title,
          name: updates.title || updates.name || current.title,
          updatedAt: now,
        };

        set({
          documents: get().documents.map((d) => (d.id === documentId ? updatedDoc : d)),
        });

        if (isSupabaseConfigured && updatedDoc.userId) {
          cloudUpsertDocument(updatedDoc, updatedDoc.userId).then((err) => {
            if (err) {
              enqueueSyncOperation({
                type: 'upsertDocument',
                entityId: updatedDoc.id,
                userId: updatedDoc.userId!,
                payload: mapDocumentToDbRow(updatedDoc, updatedDoc.userId!),
              }).catch(() => {});
            }
          }).catch((syncErr) => {
            console.warn('[itemStore] updateDocument cloud sync exception:', syncErr);
          });
        }

        const associatedItem = updatedDoc.itemId ? get().items.find((i) => i.id === updatedDoc.itemId) : null;
        NotificationService.scheduleSmartDocumentReminders(updatedDoc, associatedItem).catch((remErr) => {
          console.warn('[itemStore] updateDocument reminder rescheduling notice:', remErr);
        });
      },

      deleteDocument: async (documentId) => {
        const target = get().documents.find((d) => d.id === documentId);
        set({
          documents: get().documents.filter((d) => d.id !== documentId),
        });

        NotificationService.cancelAllDocumentReminders(documentId).catch((remErr) => {
          console.warn('[itemStore] deleteDocument reminder cancellation notice:', remErr);
        });

        if (target) {
          const docFiles = [target.filePath, target.fileUrl, target.filePathBack, target.fileUrlBack, target.thumbnailPath].filter(Boolean) as string[];
          for (const f of docFiles) {
            deleteLocalVaultFile(f, 'vault_documents').catch(() => {});
          }
        }

        if (isSupabaseConfigured) {
          const docUserId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;
          cloudDeleteDocument(documentId).then((err) => {
            if (err && docUserId) {
              enqueueSyncOperation({
                type: 'deleteDocument',
                entityId: documentId,
                userId: docUserId,
                payload: null,
              }).catch(() => {});
            }
          }).catch((syncErr) => {
            console.warn('[itemStore] deleteDocument cloud sync exception:', syncErr);
          });
        }
      },

      getDocumentById: (id) => {
        const doc = get().documents.find((d) => d.id === id);
        if (!doc) return undefined;
        const currentUserId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;
        if (currentUserId && doc.userId && doc.userId !== currentUserId) {
          return undefined;
        }
        return doc;
      },

      getDocumentsByItemId: (itemId) => {
        return get().documents.filter((d) => d.itemId === itemId);
      },

      getStandaloneDocuments: () => {
        const currentUserId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;
        return get().documents.filter((d) => {
          if (d.itemId) return false;
          if (currentUserId) {
            return d.userId === currentUserId;
          }
          return false;
        });
      },

      getAllDocuments: () => {
        const currentUserId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;
        return get().documents.filter((d) => {
          if (currentUserId) {
            return d.userId === currentUserId;
          }
          return false;
        });
      },

      getRecentlyAdded: (limit = 20) => {
        const currentUserId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;

        const rawItems = get().items || [];
        const validItems = rawItems.filter((item) => {
          if (!item || !item.id || (item.status as string) === 'deleted') return false;
          if (currentUserId && item.userId && item.userId !== currentUserId) {
            return false;
          }
          return true;
        });

        const rawDocs = get().documents || [];
        const validDocs = rawDocs.filter((doc) => {
          if (!doc || !doc.id) return false;
          if (currentUserId && doc.userId && doc.userId !== currentUserId) {
            return false;
          }
          return true;
        });

        const itemEntries: RecentlyAddedEntry[] = validItems.map((item) => {
          let subtitle: string | undefined;
          if (item.isMultiProduct && item.products && item.products.length > 1) {
            const store = item.merchant || 'Store';
            const count = item.products.length;
            const price = item.purchasePrice ? `₹${(Number(item.purchasePrice) || 0).toLocaleString('en-IN')}` : '';
            subtitle = `${store} · ${count} products${price ? ` · ${price}` : ''}`;
          } else {
            subtitle = item.purchasePrice ? `₹${(Number(item.purchasePrice) || 0).toLocaleString('en-IN')}` : undefined;
          }

          return {
            id: item.id,
            entityType: 'PURCHASED_ITEM',
            title: item.name,
            subtitle,
            category: item.categoryId || (item.category as any)?.id || 'other',
            categoryName: item.isMultiProduct && item.products && item.products.length > 1
              ? `${item.products.length} Products`
              : (item.category as any)?.name || item.brand || undefined,
            createdAt: item.createdAt || new Date().toISOString(),
            price: item.purchasePrice,
            currency: item.currency || 'INR',
            thumbnail:
              item.imageStoragePath ||
              item.imageUrl ||
              item.photoUri ||
              (item.productPhotos && item.productPhotos.length > 0 ? item.productPhotos[0] : null),
            date: item.purchaseDate || null,
            item,
          };
        });

        const docEntries: RecentlyAddedEntry[] = validDocs.map((doc) => {
          let relatedName: string | undefined;
          if (doc.itemId) {
            const relItem = rawItems.find((i) => i.id === doc.itemId);
            if (relItem) relatedName = relItem.name;
          }
          return {
            id: doc.id,
            entityType: 'DOCUMENT',
            title: doc.title || doc.name || 'Document',
            subtitle: doc.documentType
              ? `${doc.documentType}${doc.expiryDate ? ` · Expires ${doc.expiryDate}` : ''}`
              : (doc.amount ? `₹${Number(doc.amount).toLocaleString('en-IN')}` : 'Document'),
            category: doc.category || 'Other Important Documents',
            categoryName: doc.documentType || doc.category,
            createdAt: doc.createdAt || new Date().toISOString(),
            amount: doc.amount,
            currency: doc.currency || 'INR',
            thumbnail: doc.storagePath || doc.filePath || doc.fileUrl || null,
            date: doc.documentDate || null,
            expiryDate: doc.expiryDate || null,
            dueDate: doc.dueDate || null,
            relatedItemId: doc.itemId || null,
            relatedItemName: relatedName,
            document: doc,
          };
        });

        const combined = [...itemEntries, ...docEntries].sort((a, b) => {
          const timeB = new Date(b.createdAt || 0).getTime();
          const timeA = new Date(a.createdAt || 0).getTime();
          return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
        });

        return combined.slice(0, limit);
      },

      convertDocumentToItem: async (documentId, itemData: Record<string, any> = {}) => {
        const doc = get().documents.find((d) => d.id === documentId);
        if (!doc) {
          throw new Error(`Document ${documentId} not found`);
        }

        const now = new Date().toISOString();
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = doc.userId || authUser?.id || authSession?.user?.id;
        if (!userId) {
          throw new Error('Authentication required: User must be signed in.');
        }

        NotificationService.cancelAllDocumentReminders(documentId).catch(() => {});

        const newItemId = generateUUID();
        const itemName = itemData.name || doc.title || doc.name || 'Purchased Item';
        const purchasePrice = Number(itemData.purchasePrice ?? doc.amount ?? 0);
        const purchaseDate = itemData.purchaseDate || doc.documentDate || now.split('T')[0];

        const newItem: Item = {
          id: newItemId,
          userId,
          name: itemName,
          categoryId: itemData.categoryId || 'other',
          brand: itemData.brand || undefined,
          model: itemData.model || undefined,
          serialNumber: itemData.serialNumber || undefined,
          purchaseDate,
          purchasePrice,
          currency: doc.currency || 'INR',
          merchant: itemData.merchant || doc.issuerName || undefined,
          invoiceNumber: itemData.invoiceNumber || doc.referenceNumber || undefined,
          receiptUri: doc.fileUrl || undefined,
          receiptPath: doc.filePath || undefined,
          receiptName: doc.name || undefined,
          receiptType: (doc.fileType as any) || 'receipt',
          photoUri: doc.fileUrl || undefined,
          imageUrl: doc.fileUrl || undefined,
          notes: itemData.notes || (doc.notes ? `Migrated from document: ${doc.notes}` : undefined),
          status: 'active',
          createdAt: doc.createdAt || now,
          updatedAt: now,
        };

        const updatedDocs = get().documents.filter((d) => d.id !== documentId);
        const updatedItems = [newItem, ...get().items];

        const log: ActivityLog = {
          id: generateUUID(),
          userId,
          itemId: newItemId,
          activityType: 'item_added',
          title: `Reclassified as Item: ${itemName}`,
          description: `Transferred from Document vault`,
          amount: purchasePrice,
          createdAt: now,
        };

        set({
          documents: updatedDocs,
          items: updatedItems,
          activityLogs: [log, ...get().activityLogs],
        });

        if (isSupabaseConfigured) {
          cloudDeleteDocument(documentId).catch((err) =>
            console.warn('[itemStore] convertDocumentToItem cloud delete error:', err)
          );
          cloudUpsertItem(newItem, userId).catch((err) =>
            console.warn('[itemStore] convertDocumentToItem cloud insert error:', err)
          );
        }

        return newItem;
      },

      convertItemToDocument: async (itemId, docData: Record<string, any> = {}) => {
        const item = get().items.find((i) => i.id === itemId);
        if (!item) {
          throw new Error(`Item ${itemId} not found`);
        }

        const now = new Date().toISOString();
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const userId = item.userId || authUser?.id || authSession?.user?.id;
        if (!userId) {
          throw new Error('Authentication required: User must be signed in.');
        }

        try {
          await NotificationService.cancelItemReminders(itemId);
        } catch {}

        const docId = generateUUID();
        const title = docData.title || item.name || 'Document';
        const docDate = docData.documentDate || item.purchaseDate;
        const fileUrl = docData.fileUrl || item.receiptUri || item.photoUri || item.imageUrl || '';

        const newDoc: VaultDocument = {
          id: docId,
          userId,
          itemId: null, // Standalone document
          title,
          name: docData.name || item.receiptName || `${item.name}.jpg`,
          category: docData.category || 'Receipts & Invoices',
          documentType: docData.documentType || 'Receipt',
          documentDate: docDate,
          issuerName: docData.issuerName || item.merchant || undefined,
          referenceNumber: docData.referenceNumber || item.invoiceNumber || undefined,
          amount: item.purchasePrice || undefined,
          currency: item.currency || 'INR',
          filePath: item.receiptPath || (fileUrl ? `documents/${docId}/${item.receiptName || 'document.jpg'}` : ''),
          fileUrl,
          fileType: (item.receiptType as any) || 'receipt',
          fileSizeBytes: 280000,
          mimeType: fileUrl?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
          createdAt: item.createdAt || now,
          updatedAt: now,
        };

        const updatedItems = get().items.filter((i) => i.id !== itemId);
        const updatedDocs = [
          newDoc,
          ...get().documents.map((d) => (d.itemId === itemId ? { ...d, itemId: null } : d)),
        ];

        const log: ActivityLog = {
          id: generateUUID(),
          userId,
          activityType: 'document_uploaded',
          title: `Reclassified as Document: ${title}`,
          description: `Transferred from Items collection`,
          amount: item.purchasePrice,
          createdAt: now,
        };

        set({
          items: updatedItems,
          documents: updatedDocs,
          activityLogs: [log, ...get().activityLogs],
        });

        if (isSupabaseConfigured) {
          cloudDeleteItem(itemId).catch((err) =>
            console.warn('[itemStore] convertItemToDocument cloud delete error:', err)
          );
          cloudUpsertDocument(newDoc, userId).catch((err) =>
            console.warn('[itemStore] convertItemToDocument cloud insert error:', err)
          );
        }

        NotificationService.scheduleSmartDocumentReminders(newDoc).catch(() => {});

        return newDoc;
      },

      getItemById: (id: string) => {
        const item = get().items.find((i) => i.id === id);
        if (!item) return null;
        const currentUserId = useAuthStore.getState().user?.id || useAuthStore.getState().session?.user?.id;
        if (currentUserId && item.userId && item.userId !== currentUserId) {
          return null;
        }

        const category = get().categories.find((c) => c.id === item.categoryId);
        const warranty = get().warranties.find((w) => w.itemId === item.id);
        const sharedReceipt = item.receiptId ? get().receipts.find((r) => r.id === item.receiptId) : undefined;
        const documents = get().documents.filter(
          (d) =>
            d.itemId === item.id ||
            (item.receiptId && (d.filePath?.includes(item.receiptId) || (d as any).receiptId === item.receiptId))
        );
        const maintenanceRecords = get().maintenanceRecords.filter(
          (m) => m.itemId === item.id
        );
        const expenses = get().expenses.filter((e) => e.itemId === item.id);

        const resolvedReceipt = resolveItemReceipt(item, get().receipts, documents as any);
        const effectiveReceiptUri = resolvedReceipt.uri || item.receiptUri;
        const effectiveReceiptName = resolvedReceipt.name || item.receiptName || sharedReceipt?.fileName;
        const effectiveReceiptType = resolvedReceipt.type || item.receiptType;

        const tcoCalc = calculateItemTCO(item, expenses, maintenanceRecords);
        const effectiveWarrantyEnd = item.warrantyUntil || warranty?.endDate;
        const caps = getCategoryCapabilities(item.categoryId || category, item.productType, Boolean(effectiveWarrantyEnd));
        const effectiveWarrantyStart =
          warranty?.startDate || item.purchaseDate || (typeof item.createdAt === 'string' ? item.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]);
        const warrantyStatus = caps.warrantySupported ? getWarrantyStatus(effectiveWarrantyEnd) : 'none';
        const rawRemainingWarranty = caps.warrantySupported && effectiveWarrantyEnd
          ? getRemainingWarrantyDays(effectiveWarrantyEnd)
          : 0;
        const remainingWarrantyDays = Number.isFinite(rawRemainingWarranty) ? rawRemainingWarranty : 0;
        const warrantyProgressPercent = caps.warrantySupported && effectiveWarrantyEnd
          ? getWarrantyProgressPercent(effectiveWarrantyStart, effectiveWarrantyEnd)
          : 0;
        const returnStatus = getReturnStatus(item.returnUntil);
        const rawRemainingReturn = item.returnUntil
          ? getRemainingReturnDays(item.returnUntil)
          : undefined;
        const remainingReturnDays =
          rawRemainingReturn !== undefined && Number.isFinite(rawRemainingReturn)
            ? rawRemainingReturn
            : undefined;

        return {
          ...item,
          receiptUri: effectiveReceiptUri,
          receiptName: effectiveReceiptName,
          receiptType: effectiveReceiptType,
          receipt: sharedReceipt,
          category,
          warranty,
          documents,
          maintenanceRecords,
          expenses,
          tco: tcoCalc.totalCost,
          warrantyStatus,
          remainingWarrantyDays,
          warrantyProgressPercent,
          returnStatus,
          remainingReturnDays,
        };
      },

      getVaultMetrics: () => {
        const authUser = useAuthStore.getState().user;
        const currentUserId = authUser?.id;
        const allItems = get().items || [];
        const userItems = currentUserId
          ? allItems.filter((i) => !i.userId || i.userId === currentUserId)
          : allItems;
        return calculateVaultMetrics(
          userItems,
          get().warranties,
          get().maintenanceRecords,
          get().expenses,
          get().documents
        );
      },

      getFilteredItems: () => {
        const {
          items,
          searchQuery,
          selectedCategory,
          selectedSort,
          selectedWarrantyFilter,
        } = get();

        let filtered = (items || [])
          .filter((item): item is Item => Boolean(item && item.id && (item.status as string) !== 'deleted'))
          .map((item) => get().getItemById(item.id))
          .filter((i): i is ItemWithOwnerContext => Boolean(i));

        // User ownership isolation: when authenticated, only show this user's items.
        const authUser = useAuthStore.getState().user;
        const authSession = useAuthStore.getState().session;
        const currentUserId = authUser?.id || authSession?.user?.id;
        if (currentUserId) {
          filtered = filtered.filter((i) => i.userId === currentUserId);
        }

        if (selectedCategory !== 'all') {
          filtered = filtered.filter((i) => i.categoryId === selectedCategory);
        }

        if (selectedWarrantyFilter !== 'all') {
          filtered = filtered.filter((i) => {
            const effectiveEnd = i.warrantyUntil || i.warranty?.endDate;
            const caps = getCategoryCapabilities(i.categoryId || i.category, i.productType, Boolean(effectiveEnd));
            if (!caps.warrantySupported) {
              return false;
            }
            if (selectedWarrantyFilter === 'active') {
              return i.warrantyStatus === 'active';
            }
            if (selectedWarrantyFilter === 'expiring') {
              return i.warrantyStatus === 'expiring_soon';
            }
            if (selectedWarrantyFilter === 'expired') {
              return i.warrantyStatus === 'expired';
            }
            return true;
          });
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          filtered = filtered.filter(
            (i) =>
              i.name.toLowerCase().includes(q) ||
              i.brand?.toLowerCase().includes(q) ||
              i.model?.toLowerCase().includes(q) ||
              i.productType?.toLowerCase().includes(q) ||
              i.serialNumber?.toLowerCase().includes(q) ||
              i.category?.name.toLowerCase().includes(q) ||
              i.merchant?.toLowerCase().includes(q)
          );
        }

        filtered.sort((a, b) => {
          if (selectedSort === 'price_desc') {
            return b.purchasePrice - a.purchasePrice;
          }
          if (selectedSort === 'price_asc') {
            return a.purchasePrice - b.purchasePrice;
          }
          if (selectedSort === 'name') {
            return a.name.localeCompare(b.name);
          }
          const timeB = new Date(b.createdAt || b.purchaseDate || 0).getTime();
          const timeA = new Date(a.createdAt || a.purchaseDate || 0).getTime();
          return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
        });

        return filtered;
      },

    }),
    {
      name: 'keepr-vault-items-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        items: state.items,
        receipts: state.receipts,
        warranties: state.warranties,
        documents: state.documents,
        maintenanceRecords: state.maintenanceRecords,
        expenses: state.expenses,
        activityLogs: state.activityLogs,
      }),
      merge: (persistedState: any, currentState: ItemState) => {
        if (!persistedState) return currentState;
        const mergedItems = Array.isArray(persistedState.items)
          ? persistedState.items
          : currentState.items;
        const seen = new Set<string>();
        const uniqueItems = (mergedItems || [])
          .filter((item: Item) => {
            if (!item?.id || seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          })
          .map((item: Item) => {
            const cleanReceiptId =
              item.receiptId && isValidUUID(item.receiptId) ? item.receiptId : undefined;
            return {
              ...item,
              receiptId: cleanReceiptId,
            };
          });

        const mergedReceipts = Array.isArray(persistedState.receipts)
          ? persistedState.receipts
          : currentState.receipts;
        const seenReceipts = new Set<string>();
        const uniqueReceipts = (mergedReceipts || []).filter((rec: Receipt) => {
          if (!rec?.id || seenReceipts.has(rec.id)) return false;
          seenReceipts.add(rec.id);
          return true;
        });

        // Normalize legacy documents: remap non-UUID IDs (e.g. doc-1791048116503 or doc-123456789) to valid UUIDs
        const rawDocs = Array.isArray(persistedState.documents)
          ? persistedState.documents
          : currentState.documents;
        const legacyDocIdMap = new Map<string, string>();
        const seenDocIds = new Set<string>();
        const uniqueDocuments: VaultDocument[] = [];

        for (const doc of (rawDocs || [])) {
          if (!doc || !doc.id) continue;
          let docId = doc.id;
          if (!isValidUUID(docId)) {
            const newUuid = generateUUID();
            legacyDocIdMap.set(docId, newUuid);
            docId = newUuid;
          }
          if (seenDocIds.has(docId)) continue;
          seenDocIds.add(docId);
          uniqueDocuments.push({
            ...doc,
            id: docId,
            itemId: (doc.itemId && isValidUUID(doc.itemId)) ? doc.itemId : null,
          });
        }

        return {
          ...currentState,
          ...persistedState,
          items: uniqueItems,
          receipts: uniqueReceipts,
          documents: uniqueDocuments,
        };
      },
    }
  )
);
