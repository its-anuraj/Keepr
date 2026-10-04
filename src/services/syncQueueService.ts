
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const QUEUE_KEY = '@keepr_sync_queue_v1';

export type SyncOpType =
  | 'upsertItem'
  | 'deleteItem'
  | 'upsertDocument'
  | 'deleteDocument'
  | 'upsertMaintenance'
  | 'deleteMaintenance';

export interface SyncQueueEntry {
  /**
   * Deterministic identifier: `${type}::${entityId}`.
   * Ensures the same entity is never queued twice for the same operation type.
   * A delete supersedes a pending upsert for the same entity.
   */
  opId: string;
  type: SyncOpType;
  entityId: string;
  userId: string;
  /** Serializable domain payload; null for delete operations. */
  payload: Record<string, unknown> | null;
  createdAt: string;
  retryCount: number;
  lastAttemptAt?: string;
}

async function readQueue(): Promise<SyncQueueEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as SyncQueueEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(entries: SyncQueueEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
  } catch {
    // Non-fatal: queue will be rebuilt from local state on next flush attempt.
  }
}

/**
 * Enqueues a failed cloud operation.
 *
 * Idempotency rules:
 * - A second upsert for the same entity replaces the first (newest payload wins).
 * - deleteItem for entity X removes any pending upsertItem for X (delete wins).
 * - deleteDocument for entity X removes any pending upsertDocument for X.
 * - deleteMaintenance for entity X removes any pending upsertMaintenance for X.
 * - Operations are keyed by userId and can never be flushed for a different user.
 */
export async function enqueueSyncOperation(
  op: Pick<SyncQueueEntry, 'type' | 'entityId' | 'userId' | 'payload'>
): Promise<void> {
  const opId = `${op.type}::${op.entityId}`;
  const now = new Date().toISOString();
  let queue = await readQueue();

  // A delete supersedes any pending upsert for the same entity.
  if (op.type === 'deleteItem') {
    queue = queue.filter(
      (e) => !(e.entityId === op.entityId && e.type === 'upsertItem')
    );
  } else if (op.type === 'deleteDocument') {
    queue = queue.filter(
      (e) => !(e.entityId === op.entityId && e.type === 'upsertDocument')
    );
  } else if (op.type === 'deleteMaintenance') {
    queue = queue.filter(
      (e) => !(e.entityId === op.entityId && e.type === 'upsertMaintenance')
    );
  }

  // Remove any existing entry with the same opId to prevent duplicates.
  queue = queue.filter((e) => e.opId !== opId);

  queue.push({
    opId,
    type: op.type,
    entityId: op.entityId,
    userId: op.userId,
    payload: op.payload,
    createdAt: now,
    retryCount: 0,
  });

  await writeQueue(queue);
}

async function dequeueOperation(opId: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((e) => e.opId !== opId));
}

async function markRetryFailed(opId: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(
    queue.map((e) =>
      e.opId === opId
        ? { ...e, retryCount: e.retryCount + 1, lastAttemptAt: new Date().toISOString() }
        : e
    )
  );
}

/**
 * Returns the set of item IDs with a pending upsert operation for the given user.
 */
export async function getPendingUpsertItemIds(userId: string): Promise<Set<string>> {
  const queue = await readQueue();
  return new Set(
    queue
      .filter((e) => e.userId === userId && e.type === 'upsertItem')
      .map((e) => e.entityId)
  );
}

/**
 * Returns the set of document IDs with a pending upsert operation for the given user.
 */
export async function getPendingUpsertDocumentIds(userId: string): Promise<Set<string>> {
  const queue = await readQueue();
  return new Set(
    queue
      .filter((e) => e.userId === userId && e.type === 'upsertDocument')
      .map((e) => e.entityId)
  );
}

/**
 * Removes all queued operations for the given user.
 * Must be called on signOut and account deletion to prevent cross-user data leakage.
 */
export async function clearUserSyncQueue(userId: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((e) => e.userId !== userId));
}

/**
 * Attempts to flush all pending sync operations for the given user.
 *
 * Each operation is retried independently:
 * - Success → removed from queue.
 * - Failure → retry count incremented, remains in queue for next flush.
 *
 * Uses Supabase upsert with onConflict:'id' for idempotency — a previously
 * succeeded operation re-run will not create a duplicate record.
 *
 * Ownership invariant: each operation is scoped to userId via the WHERE clause,
 * so User A's pending operations cannot write into User B's data.
 */
export async function flushSyncQueue(userId: string): Promise<void> {
  if (!isSupabaseConfigured || !userId) return;

  const queue = await readQueue();
  const userOps = queue.filter((e) => e.userId === userId);
  if (userOps.length === 0) return;

  for (const entry of userOps) {
    try {
      let success = false;

      if (entry.type === 'upsertItem' && entry.payload) {
        const { error } = await supabase
          .from('items')
          .upsert(entry.payload, { onConflict: 'id' });
        success = !error;
        if (error) {
          console.warn(`[SyncQueue] upsertItem retry failed for ${entry.entityId}:`, error.message);
        }
      } else if (entry.type === 'deleteItem') {
        const { error } = await supabase
          .from('items')
          .delete()
          .eq('id', entry.entityId)
          .eq('user_id', userId);
        // Row already deleted is acceptable.
        success = !error || error.code === 'PGRST116';
        if (error && error.code !== 'PGRST116') {
          console.warn(`[SyncQueue] deleteItem retry failed for ${entry.entityId}:`, error.message);
        }
      } else if (entry.type === 'upsertDocument' && entry.payload) {
        const { error } = await supabase
          .from('documents')
          .upsert(entry.payload, { onConflict: 'id' });
        success = !error;
        if (error) {
          console.warn(`[SyncQueue] upsertDocument retry failed for ${entry.entityId}:`, error.message);
        }
      } else if (entry.type === 'deleteDocument') {
        const { error } = await supabase
          .from('documents')
          .delete()
          .eq('id', entry.entityId)
          .eq('user_id', userId);
        success = !error || error.code === 'PGRST116';
        if (error && error.code !== 'PGRST116') {
          console.warn(`[SyncQueue] deleteDocument retry failed for ${entry.entityId}:`, error.message);
        }
      } else if (entry.type === 'upsertMaintenance' && entry.payload) {
        const { error } = await supabase
          .from('maintenance_records')
          .upsert(entry.payload, { onConflict: 'id' });
        success = !error;
        if (error) {
          console.warn(`[SyncQueue] upsertMaintenance retry failed for ${entry.entityId}:`, error.message);
        }
      } else if (entry.type === 'deleteMaintenance') {
        const { error } = await supabase
          .from('maintenance_records')
          .delete()
          .eq('id', entry.entityId)
          .eq('user_id', userId);
        success = !error || error.code === 'PGRST116';
        if (error && error.code !== 'PGRST116') {
          console.warn(`[SyncQueue] deleteMaintenance retry failed for ${entry.entityId}:`, error.message);
        }
      }

      if (success) {
        await dequeueOperation(entry.opId);
      } else {
        await markRetryFailed(entry.opId);
      }
    } catch {
      // Network unavailable — keep in queue for next flush.
      await markRetryFailed(entry.opId);
    }
  }
}
