// ==============================================================================
// KEEPR: Notification Read State Store
//
// Tracks which in-app notification IDs the user has "seen" (opened the
// Notification Center while that entry was visible). This is the ONLY
// state needed for the bell dot.
//
// Architecture notes:
// - Notifications are derived from itemStore (not persisted themselves).
// - A notification is "unread" if its deterministic ID (e.g. "return-abc123"
//   or "warranty-abc123") is NOT in the `readIds` set.
// - When the user opens Notification Center, all currently visible IDs are
//   marked read via `markAllRead()`.
// - If a new deadline appears whose ID was never seen, the dot reappears.
// - State persists across restarts via AsyncStorage.
// ==============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';


const NOTIFICATION_READ_KEY = '@keepr_notification_read_ids';


interface NotificationReadState {
  /** Set of notification IDs the user has already seen in the Notification Center. */
  readIds: string[];

  /**
   * Mark a list of notification IDs as read.
   * Called by the Notification Center when it renders.
   */
  markAllRead: (ids: string[]) => void;

  /**
   * Returns true if at least one of the provided IDs has NOT been seen before.
   * Used by the Header bell dot.
   */
  hasUnread: (currentIds: string[]) => boolean;

  /** Remove IDs that are no longer active (cleanup on itemStore changes). */
  pruneStale: (currentIds: string[]) => void;
}


export const useNotificationReadStore = create<NotificationReadState>()(
  persist(
    (set, get) => ({
      readIds: [],

      markAllRead: (ids: string[]) => {
        if (ids.length === 0) return;
        set((state) => {
          const existing = new Set(state.readIds);
          ids.forEach((id) => existing.add(id));
          return { readIds: Array.from(existing) };
        });
      },

      hasUnread: (currentIds: string[]): boolean => {
        if (currentIds.length === 0) return false;
        const readSet = new Set(get().readIds);
        return currentIds.some((id) => !readSet.has(id));
      },

      pruneStale: (currentIds: string[]) => {
        const current = new Set(currentIds);
        set((state) => ({
          readIds: state.readIds.filter((id) => current.has(id)),
        }));
      },
    }),
    {
      name: NOTIFICATION_READ_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);


/**
 * Selector: returns true when any of the provided notification IDs is unread.
 * Use this in the Header to drive the bell dot.
 *
 * Example:
 *   const unread = useHasUnreadNotifications(currentIds);
 */
export function useHasUnreadNotifications(currentIds: string[]): boolean {
  return useNotificationReadStore((state) => state.hasUnread(currentIds));
}
