
import { create } from 'zustand';

export interface ReceiptSession {
  uri: string;
  source: 'camera' | 'gallery';
  fileName: string;
  base64?: string | null;
  mimeType?: string;
  width?: number;
  height?: number;
  timestamp: number;
}

interface ReceiptSessionState {
  currentSession: ReceiptSession | null;
  setSession: (session: Omit<ReceiptSession, 'timestamp'>) => void;
  updateUri: (uri: string, base64?: string | null) => void;
  clearSession: () => void;
}

let activeReceiptSession: ReceiptSession | null = null;

export const useReceiptSessionStore = create<ReceiptSessionState>((set) => ({
  currentSession: null,
  setSession: (sessionData) => {
    const fullSession: ReceiptSession = {
      ...sessionData,
      timestamp: Date.now(),
    };
    activeReceiptSession = fullSession;
    set({ currentSession: fullSession });
  },
  updateUri: (newUri, newBase64) => {
    set((state) => {
      if (!state.currentSession) return state;
      const updated: ReceiptSession = {
        ...state.currentSession,
        uri: newUri,
        base64: newBase64 !== undefined ? newBase64 : state.currentSession.base64,
        timestamp: Date.now(),
      };
      activeReceiptSession = updated;
      return { currentSession: updated };
    });
  },
  clearSession: () => {
    activeReceiptSession = null;
    set({ currentSession: null });
  },
}));

/**
 * Direct synchronous getter for active receipt session.
 * Prevents route param serialization and timing race conditions.
 */
export function getActiveReceiptSession(): ReceiptSession | null {
  return activeReceiptSession;
}

/**
 * Direct synchronous setter for active receipt session.
 */
export function setActiveReceiptSession(sessionData: Omit<ReceiptSession, 'timestamp'>): ReceiptSession {
  const fullSession: ReceiptSession = {
    ...sessionData,
    timestamp: Date.now(),
  };
  activeReceiptSession = fullSession;
  useReceiptSessionStore.setState({ currentSession: fullSession });
  return fullSession;
}

/**
 * Direct synchronous clearer for active receipt session.
 */
export function clearActiveReceiptSession(): void {
  activeReceiptSession = null;
  useReceiptSessionStore.setState({ currentSession: null });
}
