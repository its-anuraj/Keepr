
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder-keepr.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_KEY ||
  'placeholder-anon-key';

export const isSupabaseConfigured =
  Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY) &&
  process.env.EXPO_PUBLIC_SUPABASE_URL !== 'https://placeholder-keepr.supabase.co';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

import * as SecureStore from 'expo-secure-store';

export async function runAuthStorageDiagnostics() {
  try {
    const authObj = (supabase as any).auth;
    const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
    const actualStorageKey = authObj?.storageKey || `sb-${projectRef}-auth-token`;

    const asyncVal = await AsyncStorage.getItem(actualStorageKey);
    let secureVal: string | null = null;
    try {
      secureVal = await SecureStore.getItemAsync(actualStorageKey);
    } catch {
      secureVal = null;
    }

    const allKeys = await AsyncStorage.getAllKeys();

    console.log('[AuthDiagnostics] Storage Configuration:');
    console.log(`  projectRef=${projectRef}`);
    console.log(`  storageAdapter=${AsyncStorage ? 'AsyncStorage' : 'NONE'}`);
    console.log(`  persistSession=${Boolean(authObj?.persistSession)}`);
    console.log(`  autoRefreshToken=${Boolean(authObj?.autoRefreshToken)}`);
    console.log(`  actualStorageKey=${actualStorageKey}`);
    console.log(`  authStorageKeyExists=${Boolean(asyncVal)}`);
    console.log(`  storedSessionExists=${Boolean(asyncVal)}`);
    console.log(`  storedSessionSize=${asyncVal ? asyncVal.length : 0}`);
    console.log(`  secureStoreKeyExists=${Boolean(secureVal)}`);
    console.log(`  secureStoreSessionSize=${secureVal ? secureVal.length : 0}`);
    console.log(`  allAsyncStorageKeys=${JSON.stringify(allKeys)}`);

    return {
      actualStorageKey,
      asyncValExists: Boolean(asyncVal),
      secureValExists: Boolean(secureVal),
    };
  } catch (err) {
    console.warn('[AuthDiagnostics] Diagnostic execution failed:', err);
    return null;
  }
}
