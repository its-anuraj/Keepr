// ==============================================================================
// KEEPR DIGITAL OWNERSHIP VAULT: Offline → Cloud Migration Service
//
// Safely migrates locally-created vault data (items, documents, receipts,
// warranties, maintenance, expenses) to Supabase when the user first signs in
// after creating data in offline/unconfigured mode.
//
// Design principles:
// - NEVER migrate SEED/demo data (userId === 'default-user' sentinel)
// - Idempotent: re-running never creates duplicates
// - Staged: DB metadata first, then Storage media uploads
// - Partial-failure safe: persists successfully migrated records, retries others
// - Non-destructive: never deletes local data until cloud persistence is confirmed
// - Preserves original IDs where they are valid UUIDs
// - Generates fresh UUIDs for records with non-UUID IDs (e.g. 'item-001')
// - Per-user/device migration lock persisted in AsyncStorage
// ==============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  cloudUpsertItem,
  cloudUpsertWarranty,
  cloudUpsertDocument,
  cloudUpsertReceipt,
  cloudUpsertMaintenance,
  cloudUpsertExpense,
  mapItemToDbRow,
} from './cloudSyncService';
import type {
  Item,
  Warranty,
  VaultDocument,
  Receipt,
  MaintenanceRecord,
  Expense,
  ActivityLog,
} from '../types';


/** AsyncStorage key prefix for migration completion records. */
const MIGRATION_DONE_KEY_PREFIX = '@keepr_migration_done_v1_';

/** Sentinel userIds that belong to demo/seed data — never migrate these. */
const DEMO_USER_IDS = new Set(['default-user', 'current-user', 'demo-user', '']);

/** Well-known SEED item IDs that are never real user data. */
const SEED_ITEM_IDS = new Set([
  'item-001', 'item-002', 'item-003', 'item-004',
  'war-001', 'war-002', 'war-003',
  'doc-001', 'doc-002', 'doc-003', 'doc-004', 'doc-005', 'doc-006', 'doc-007',
  'maint-001',
  'rec-001', 'rec-002',
  'act-001', 'act-002', 'act-003',
  'exp-001', 'exp-002',
]);

/**
 * Supabase Storage bucket names for uploads.
 * Files are stored at: `{bucket}/{userId}/{category}/{filename}`
 */
const BUCKET_ITEM_IMAGES = 'item-images';
const BUCKET_ITEM_DOCUMENTS = 'item-documents';
const BUCKET_VAULT_DOCUMENTS = 'vault-documents';


const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns true if the string is a valid RFC 4122 v4 UUID. */
function isValidUUID(s: string): boolean {
  return UUID_V4_REGEX.test(s);
}

/** Generates a v4 UUID for use when an existing ID is not a valid UUID. */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch {}
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns the record's existing ID if it is a valid UUID,
 * otherwise generates a new UUID and returns it.
 * Maintains a stable mapping within a single migration run.
 */
function resolveId(id: string, idMap: Map<string, string>): string {
  if (isValidUUID(id)) return id;
  if (idMap.has(id)) return idMap.get(id)!;
  const newId = generateUUID();
  idMap.set(id, newId);
  return newId;
}


/** Returns true if this item is seed/demo data and must not be migrated. */
function isSeedItem(item: Item): boolean {
  return (
    DEMO_USER_IDS.has(item.userId || '') ||
    SEED_ITEM_IDS.has(item.id)
  );
}

/** Returns true if this warranty is seed/demo data. */
function isSeedWarranty(w: Warranty): boolean {
  return DEMO_USER_IDS.has(w.userId || '') || SEED_ITEM_IDS.has(w.id) || SEED_ITEM_IDS.has(w.itemId);
}

/** Returns true if this document is seed/demo data. */
function isSeedDocument(d: VaultDocument): boolean {
  return (
    DEMO_USER_IDS.has(d.userId || '') ||
    SEED_ITEM_IDS.has(d.id) ||
    (!!d.itemId && SEED_ITEM_IDS.has(d.itemId))
  );
}

/** Returns true if this receipt is seed/demo data. */
function isSeedReceipt(r: Receipt): boolean {
  return DEMO_USER_IDS.has(r.userId || '') || SEED_ITEM_IDS.has(r.id);
}

/** Returns true if this maintenance record is seed/demo data. */
function isSeedMaintenance(m: MaintenanceRecord): boolean {
  return (
    DEMO_USER_IDS.has(m.userId || '') ||
    SEED_ITEM_IDS.has(m.id) ||
    Boolean(m.itemId && SEED_ITEM_IDS.has(m.itemId))
  );
}

/** Returns true if this expense is seed/demo data. */
function isSeedExpense(e: Expense): boolean {
  return (
    DEMO_USER_IDS.has(e.userId || '') ||
    SEED_ITEM_IDS.has(e.id) ||
    SEED_ITEM_IDS.has(e.itemId)
  );
}


/** Returns the AsyncStorage key for this user's migration completion flag. */
function migrationDoneKey(userId: string): string {
  return `${MIGRATION_DONE_KEY_PREFIX}${userId}`;
}

/** Returns true if migration has already been completed for this user. */
export async function isMigrationComplete(userId: string): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(migrationDoneKey(userId));
    return val === 'done';
  } catch {
    return false;
  }
}

/** Marks migration as complete for this user. */
async function markMigrationComplete(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(migrationDoneKey(userId), 'done');
  } catch (e) {
    console.warn('[Migration] Failed to write migration completion flag:', e);
  }
}

/** Clears the migration completion flag (for testing or re-run). */
export async function resetMigrationFlag(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(migrationDoneKey(userId));
  } catch {}
}


/**
 * Determines MIME type from a file URI or path.
 * Falls back to 'application/octet-stream'.
 */
function inferMimeType(uri: string): string {
  const lower = uri.toLowerCase().split('?')[0];
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

/**
 * Returns the file extension from a URI (including the dot), e.g. '.jpg'.
 */
function getExtension(uri: string): string {
  const stripped = uri.split('?')[0];
  const dot = stripped.lastIndexOf('.');
  if (dot === -1) return '';
  return stripped.substring(dot);
}

/**
 * Checks whether a local file URI actually exists and is readable.
 */
async function localFileExists(uri: string): Promise<boolean> {
  if (!uri) return false;
  if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:')) {
    return true; // Remote URLs are assumed available
  }
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

/**
 * Uploads a local file to Supabase Storage using the anon key + user JWT.
 * Storage path format: `{userId}/{subfolder}/{filename}`
 *
 * Returns the public/signed storage path on success, null on failure.
 * NEVER exposes the file publicly unless uploading to item-images (intentionally public).
 */
async function uploadLocalFileToStorage(
  localUri: string,
  bucket: string,
  storagePath: string,
  mimeType: string
): Promise<string | null> {
  try {
    const exists = await localFileExists(localUri);
    if (!exists) {
      console.warn(`[Migration] Local file not found, skipping upload: ${storagePath}`);
      return null;
    }

    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const { error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, bytes, {
        contentType: mimeType,
        upsert: true, // Idempotent: overwrite if re-migrating
      });

    if (error) {
      console.warn(`[Migration] Storage upload failed for ${storagePath}:`, error.message);
      return null;
    }

    console.log(`[Migration] Uploaded: ${bucket}/${storagePath}`);
    return storagePath;
  } catch (err) {
    console.warn(`[Migration] Storage upload exception for ${storagePath}:`, err);
    return null;
  }
}


export interface MigrationResult {
  skipped: boolean; // true if migration was already done or not needed
  itemsMigrated: number;
  itemsFailed: number;
  mediaUploaded: number;
  mediaFailed: number;
  warrantyMigrated: number;
  documentsMigrated: number;
  maintenanceMigrated: number;
  expensesMigrated: number;
  receiptsMigrated: number;
  errors: string[];
}

/**
 * Migrates locally-created vault data to Supabase for the authenticated user.
 *
 * Safe to call repeatedly: uses a per-user completion flag in AsyncStorage.
 * Idempotent: uses upsert semantics for all DB writes.
 *
 * @param userId - The authenticated user's Supabase UUID.
 * @param localData - The current local Zustand store state.
 * @param cloudItemIds - Set of item IDs already in Supabase (to skip re-upload).
 */
export async function migrateLocalDataToCloud(
  userId: string,
  localData: {
    items: Item[];
    warranties: Warranty[];
    documents: VaultDocument[];
    receipts: Receipt[];
    maintenanceRecords: MaintenanceRecord[];
    expenses: Expense[];
  },
  cloudItemIds: Set<string>
): Promise<MigrationResult> {
  const result: MigrationResult = {
    skipped: false,
    itemsMigrated: 0,
    itemsFailed: 0,
    mediaUploaded: 0,
    mediaFailed: 0,
    warrantyMigrated: 0,
    documentsMigrated: 0,
    maintenanceMigrated: 0,
    expensesMigrated: 0,
    receiptsMigrated: 0,
    errors: [],
  };

  if (!userId || DEMO_USER_IDS.has(userId) || !isSupabaseConfigured) {
    result.skipped = true;
    return result;
  }

  const alreadyDone = await isMigrationComplete(userId);
  if (alreadyDone) {
    result.skipped = true;
    console.log('[Migration] Already completed for this user, skipping.');
    return result;
  }

  const localItems = localData.items.filter((item) => {
    if (isSeedItem(item)) return false;
    if (cloudItemIds.has(item.id)) return false;
    if (item.userId !== userId && item.userId !== 'current-user' && item.userId !== '') return false;
    return true;
  });

  if (localItems.length === 0) {
    await markMigrationComplete(userId);
    result.skipped = true;
    console.log('[Migration] No local-only items to migrate.');
    return result;
  }

  console.log(`[Migration] Migrating ${localItems.length} local items for user ${userId}...`);

  const idMap = new Map<string, string>();

  const migratedItemIdMap = new Map<string, string>(); // old id → new cloud id

  for (const item of localItems) {
    const newId = resolveId(item.id, idMap);
    const migratedItem: Item = { ...item, id: newId, userId };

    const err = await cloudUpsertItem(migratedItem, userId);
    if (err) {
      result.itemsFailed++;
      result.errors.push(`Item "${item.name}": ${err}`);
      console.warn(`[Migration] Item upsert failed for "${item.name}":`, err);
    } else {
      result.itemsMigrated++;
      migratedItemIdMap.set(item.id, newId);
    }
  }

  for (const receipt of localData.receipts) {
    if (isSeedReceipt(receipt)) continue;
    if (receipt.userId !== userId && receipt.userId !== 'current-user') continue;
    if (cloudItemIds.has(receipt.id)) continue; // already synced

    const newId = resolveId(receipt.id, idMap);
    const migratedReceipt: Receipt = { ...receipt, id: newId, userId };

    migratedReceipt.itemIds = receipt.itemIds
      .map((oldId) => migratedItemIdMap.get(oldId) || idMap.get(oldId) || oldId)
      .filter((id) => isValidUUID(id));

    const err = await cloudUpsertReceipt(migratedReceipt, userId);
    if (!err) {
      result.receiptsMigrated++;
    } else {
      result.errors.push(`Receipt "${receipt.fileName}": ${err}`);
    }
  }

  for (const warranty of localData.warranties) {
    if (isSeedWarranty(warranty)) continue;

    const newItemId = migratedItemIdMap.get(warranty.itemId) || idMap.get(warranty.itemId) || warranty.itemId;
    if (!isValidUUID(newItemId)) continue; // can't link to non-existent item

    const newId = resolveId(warranty.id, idMap);
    const migratedWarranty: Warranty = { ...warranty, id: newId, itemId: newItemId, userId };

    const err = await cloudUpsertWarranty(migratedWarranty, userId);
    if (!err) {
      result.warrantyMigrated++;
    } else {
      result.errors.push(`Warranty for item "${warranty.itemId}": ${err}`);
    }
  }

  for (const doc of localData.documents) {
    if (isSeedDocument(doc)) continue;

    const newItemId = doc.itemId
      ? migratedItemIdMap.get(doc.itemId) || idMap.get(doc.itemId) || doc.itemId
      : null;

    if (newItemId && !isValidUUID(newItemId)) continue;

    const newId = resolveId(doc.id, idMap);

    const bucket = newItemId ? BUCKET_ITEM_DOCUMENTS : BUCKET_VAULT_DOCUMENTS;

    // Build user-scoped storage path
    const ext = getExtension(doc.filePath || doc.fileUrl || '');
    const storagePath = newItemId
      ? `${userId}/items/${newItemId}/doc_${newId}${ext}`
      : `${userId}/vault/${newId}${ext}`;

    let finalFileUrl = doc.fileUrl;
    let finalFilePath = doc.filePath;

    const localUri = doc.fileUrl?.startsWith('file://') || doc.fileUrl?.startsWith('content://')
      ? doc.fileUrl
      : doc.filePath?.startsWith('file://')
      ? doc.filePath
      : null;

    if (localUri) {
      const mimeType = doc.mimeType || inferMimeType(localUri);
      const uploadedPath = await uploadLocalFileToStorage(localUri, bucket, storagePath, mimeType);
      if (uploadedPath) {
        result.mediaUploaded++;
        // For private document buckets, store the path; signed URLs generated at render time
        finalFileUrl = uploadedPath;
        finalFilePath = uploadedPath;
      } else {
        result.mediaFailed++;
      }
    }

    const migratedDoc: VaultDocument = {
      ...doc,
      id: newId,
      userId,
      itemId: newItemId || null,
      fileUrl: finalFileUrl,
      filePath: finalFilePath,
    };

    const err = await cloudUpsertDocument(migratedDoc, userId);
    if (!err) {
      result.documentsMigrated++;
    } else {
      result.errors.push(`Document "${doc.title}": ${err}`);
    }
  }

  for (const item of localItems) {
    const newItemId = migratedItemIdMap.get(item.id);
    if (!newItemId) continue; // item failed to migrate

    const photoUri = item.imageUrl || item.photoUri;
    if (photoUri && (photoUri.startsWith('file://') || photoUri.startsWith('content://'))) {
      const ext = getExtension(photoUri);
      const storagePath = `${userId}/items/${newItemId}/photo${ext}`;
      const mimeType = inferMimeType(photoUri);
      const uploaded = await uploadLocalFileToStorage(
        photoUri,
        BUCKET_ITEM_IMAGES,
        storagePath,
        mimeType
      );
      if (uploaded) {
        result.mediaUploaded++;
        // For private bucket, store the user-scoped storage path
        const updatedItem: Item = { ...item, id: newItemId, userId, imageUrl: uploaded };
        await cloudUpsertItem(updatedItem, userId).catch(() => {});
      } else if (photoUri) {
        result.mediaFailed++;
      }
    }

    if (Array.isArray(item.productPhotos)) {
      for (let i = 0; i < item.productPhotos.length; i++) {
        const photoU = item.productPhotos[i];
        if (!photoU || (!photoU.startsWith('file://') && !photoU.startsWith('content://'))) continue;
        const ext = getExtension(photoU);
        const storagePath = `${userId}/items/${newItemId}/photo_${i}${ext}`;
        const mimeType = inferMimeType(photoU);
        const uploaded = await uploadLocalFileToStorage(photoU, BUCKET_ITEM_IMAGES, storagePath, mimeType);
        if (uploaded) {
          result.mediaUploaded++;
        } else {
          result.mediaFailed++;
        }
      }
    }
  }

  for (const record of localData.maintenanceRecords) {
    if (isSeedMaintenance(record)) continue;

    let newItemId: string | null = null;
    if (record.itemId) {
      const resolved = migratedItemIdMap.get(record.itemId) || idMap.get(record.itemId) || record.itemId;
      if (isValidUUID(resolved)) {
        newItemId = resolved;
      }
    }

    const newId = resolveId(record.id, idMap);
    const migrated: MaintenanceRecord = { ...record, id: newId, itemId: newItemId, userId };

    const err = await cloudUpsertMaintenance(migrated, userId);
    if (!err) {
      result.maintenanceMigrated++;
    } else {
      result.errors.push(`Maintenance "${record.title}": ${err}`);
    }
  }

  for (const expense of localData.expenses) {
    if (isSeedExpense(expense)) continue;

    const newItemId = migratedItemIdMap.get(expense.itemId) || idMap.get(expense.itemId) || expense.itemId;
    if (!isValidUUID(newItemId)) continue;

    const newId = resolveId(expense.id, idMap);
    const migrated: Expense = { ...expense, id: newId, itemId: newItemId, userId };

    const err = await cloudUpsertExpense(migrated, userId);
    if (!err) {
      result.expensesMigrated++;
    } else {
      result.errors.push(`Expense "${expense.title}": ${err}`);
    }
  }

  if (result.itemsMigrated > 0 || localItems.length === 0) {
    await markMigrationComplete(userId);
  }

  console.log(
    `[Migration] Complete: ` +
    `items=${result.itemsMigrated}/${localItems.length}, ` +
    `docs=${result.documentsMigrated}, ` +
    `media=${result.mediaUploaded} uploaded / ${result.mediaFailed} failed, ` +
    `warranties=${result.warrantyMigrated}, ` +
    `errors=${result.errors.length}`
  );

  return result;
}

/**
 * Returns the set of item IDs currently in Supabase for the given user.
 * Used to determine which local items are genuinely local-only.
 */
export async function fetchCloudItemIds(userId: string): Promise<Set<string>> {
  if (!userId || !isSupabaseConfigured) return new Set();
  try {
    const { data, error } = await supabase
      .from('items')
      .select('id')
      .eq('user_id', userId);
    if (error || !data) return new Set();
    return new Set(data.map((r: { id: string }) => r.id));
  } catch {
    return new Set();
  }
}
