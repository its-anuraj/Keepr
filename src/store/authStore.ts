
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import { Profile } from '../types';
import { isSupabaseConfigured, supabase, runAuthStorageDiagnostics } from '../lib/supabase';
import * as SecureStore from 'expo-secure-store';

export interface AuthState {
  user: Profile | null;
  session: Session | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  isOfflineMode: boolean;
  /**
   * True when Supabase has established a PASSWORD_RECOVERY session.
   * While this is true the root layout auth guard must NOT redirect to /(tabs).
   */
  isRecoveryMode: boolean;

  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
  clearRecoveryMode: () => void;
  resetPasswordForEmail: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

async function fetchProfile(supaUser: User): Promise<Profile> {
  try {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', supaUser.id)
      .single();

    return {
      id: supaUser.id,
      email: supaUser.email || '',
      fullName:
        profileData?.full_name ||
        supaUser.user_metadata?.full_name ||
        'Vault Member',
      avatarUrl: profileData?.avatar_url,
      currency: profileData?.currency || 'INR',
      createdAt: supaUser.created_at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      id: supaUser.id,
      email: supaUser.email || '',
      fullName: supaUser.user_metadata?.full_name || 'Vault Member',
      currency: 'INR',
      createdAt: supaUser.created_at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

let authListenerSubscribed = false;

function setupAuthListener() {
  if (authListenerSubscribed || !isSupabaseConfigured) return;
  authListenerSubscribed = true;

  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log(`[AuthDiagnostics] onAuthStateChange event=${event}, sessionExists=${Boolean(session)}`);

    // PASSWORD_RECOVERY: Supabase established a temporary recovery session from the
    // reset-email link. Set isRecoveryMode so the root auth guard does NOT redirect
    // to /(tabs). The reset-password screen clears this flag on completion.
    if (event === 'PASSWORD_RECOVERY') {
      console.log('[PasswordReset] PASSWORD_RECOVERY event received — entering recovery mode');
      useAuthStore.setState({
        session,
        token: session?.access_token ?? null,
        isAuthenticated: Boolean(session),
        isRecoveryMode: true,
        isLoading: false,
        isInitialized: true,
        error: null,
      });
      setTimeout(() => {
        const { router } = require('expo-router');
        router.replace('/(auth)/reset-password');
      }, 50);
      return;
    }

    if (
      event === 'SIGNED_IN' ||
      event === 'TOKEN_REFRESHED' ||
      event === 'USER_UPDATED' ||
      event === 'INITIAL_SESSION'
    ) {
      if (session?.user) {
        const profile = await fetchProfile(session.user);
        useAuthStore.setState({
          user: profile,
          session,
          token: session.access_token,
          isAuthenticated: true,
          isLoading: false,
          isInitialized: true,
          error: null,
          isOfflineMode: false,
          isRecoveryMode: false,
        });
        // Cloud hydration: load all vault data for this user from Supabase.
        // Only on SIGNED_IN (not TOKEN_REFRESHED) to avoid redundant fetches.
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          try {
            const { useItemStore } = require('./itemStore');
            useItemStore.getState().hydrateFromCloud();
          } catch (hydrateErr) {
            console.warn('[AuthStore] hydrateFromCloud deferred:', hydrateErr);
          }
        }
      } else if (event === 'INITIAL_SESSION') {
        useAuthStore.setState({
          user: null,
          session: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          error: null,
          isRecoveryMode: false,
        });
      }
    } else if (event === 'SIGNED_OUT') {
      useAuthStore.setState({
        user: null,
        session: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        isInitialized: true,
        error: null,
        isRecoveryMode: false,
      });
    }
  });
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      session: null,
      token: null,
      isAuthenticated: false,
      isRecoveryMode: false,
      isLoading: true,
      isInitialized: false,
      error: null,
      isOfflineMode: !isSupabaseConfigured,
      clearRecoveryMode: () => set({ isRecoveryMode: false }),

      initialize: async () => {
        set({ isLoading: true, error: null });

        if (isSupabaseConfigured) {
          const diag = await runAuthStorageDiagnostics();

          // Check if a legacy session exists in SecureStore that needs migration to AsyncStorage
          if (diag?.secureValExists && !diag?.asyncValExists) {
            try {
              const secureSessionRaw = await SecureStore.getItemAsync(diag.actualStorageKey);
              if (secureSessionRaw) {
                console.log('[AuthStore] Migrating legacy session from SecureStore to AsyncStorage...');
                await AsyncStorage.setItem(diag.actualStorageKey, secureSessionRaw);
              }
            } catch (migErr) {
              console.warn('[AuthStore] SecureStore migration check failed:', migErr);
            }
          }

          setupAuthListener();

          try {
            const { data, error } = await supabase.auth.getSession();
            const storageKey = `sb-lqzhfnsxgytwbeudtzks-auth-token`;
            const rawStored = await AsyncStorage.getItem(storageKey);
            console.log(
              `[AuthDiagnostics] getSession Telemetry: sessionExists=${Boolean(data?.session)} tokenExists=${Boolean(data?.session?.access_token)} userId=${data?.session?.user?.id || 'none'} storageKeyExists=${Boolean(rawStored)} storageSize=${rawStored ? rawStored.length : 0}`
            );

            if (error) {
              console.warn('[AuthDiagnostics] Supabase getSession error:', error.message);
            } else if (data.session?.user) {
              const profile = await fetchProfile(data.session.user);
              console.log(`[AuthDiagnostics] Restored session for user: ${data.session.user.id}`);
              set({
                user: profile,
                session: data.session,
                token: data.session.access_token,
                isAuthenticated: true,
                isLoading: false,
                isInitialized: true,
                isOfflineMode: false,
              });
              try {
                const { useItemStore } = require('./itemStore');
                useItemStore.getState().hydrateFromCloud();
              } catch (hydrateErr) {
                console.warn('[AuthStore] initialize: hydrateFromCloud deferred:', hydrateErr);
              }
              return;
            }
          } catch (err) {
            console.warn('[AuthDiagnostics] Session restore exception:', err);
          }
        }

        set({
          user: null,
          session: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          isOfflineMode: !isSupabaseConfigured,
        });
      },

      signIn: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        if (!email.trim() || !password.trim()) {
          set({ isLoading: false, error: 'Please provide both email and password.' });
          return { success: false, error: 'Please provide both email and password.' };
        }

        if (isSupabaseConfigured) {
          try {
            const { data, error } = await supabase.auth.signInWithPassword({
              email: email.trim(),
              password: password.trim(),
            });

            if (error) {
              console.warn(`[AuthDiagnostics] signIn failed for ${email.trim()}: ${error.message}`);
              set({ isLoading: false, error: error.message });
              return { success: false, error: error.message };
            }

            if (data.user && data.session) {
              const authenticatedUser = await fetchProfile(data.user);

              set({
                user: authenticatedUser,
                session: data.session,
                token: data.session.access_token,
                isAuthenticated: true,
                isLoading: false,
                isInitialized: true,
                error: null,
                isOfflineMode: false,
              });

              try {
                const { useItemStore } = require('./itemStore');
                const { migrateLocalDataToCloud, fetchCloudItemIds, isMigrationComplete } =
                  require('../services/offlineMigrationService');
                const uid = data.user.id;
                const needsMigration = !(await isMigrationComplete(uid));
                if (needsMigration) {
                  const localState = useItemStore.getState();
                  const cloudIds = await fetchCloudItemIds(uid);
                  await migrateLocalDataToCloud(uid, {
                    items: localState.items,
                    warranties: localState.warranties,
                    documents: localState.documents,
                    receipts: localState.receipts,
                    maintenanceRecords: localState.maintenanceRecords,
                    expenses: localState.expenses,
                  }, cloudIds);
                }
              } catch (migErr) {
                console.warn('[AuthStore] signIn: offline migration error (non-fatal):', migErr);
              }

              try {
                const { useItemStore } = require('./itemStore');
                useItemStore.getState().hydrateFromCloud();
              } catch (hydrateErr) {
                console.warn('[AuthStore] signIn: hydrateFromCloud deferred:', hydrateErr);
              }

              const storageKey = `sb-lqzhfnsxgytwbeudtzks-auth-token`;
              const rawStored = await AsyncStorage.getItem(storageKey);
              console.log(
                `[AuthDiagnostics] Login Telemetry: sessionExists=true tokenExists=${Boolean(data.session.access_token)} userId=${data.user.id} storageKeyExists=${Boolean(rawStored)} storageSize=${rawStored ? rawStored.length : 0}`
              );

              return { success: true };
            }

            const noSessionErr = 'Sign in succeeded but session is missing.';
            set({ isLoading: false, error: noSessionErr });
            return { success: false, error: noSessionErr };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Network error during login';
            console.warn(`[AuthDiagnostics] signIn exception: ${msg}`);
            set({ isLoading: false, error: msg });
            return { success: false, error: msg };
          }
        }

        const localUser: Profile = {
          id: 'user-' + email.replace(/[^a-zA-Z0-9]/g, '_'),
          email: email.trim(),
          fullName: email.split('@')[0] || 'Vault Member',
          currency: 'INR',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set({
          user: localUser,
          session: null,
          token: 'local-vault-token',
          isAuthenticated: true,
          isLoading: false,
          isInitialized: true,
          error: null,
          isOfflineMode: true,
        });

        return { success: true };
      },

      signUp: async (email: string, password: string, fullName: string) => {
        set({ isLoading: true, error: null });

        if (!email.trim() || !password.trim() || !fullName.trim()) {
          set({ isLoading: false, error: 'All fields are required.' });
          return { success: false, error: 'All fields are required.' };
        }

        if (password.length < 6) {
          set({ isLoading: false, error: 'Password must be at least 6 characters.' });
          return { success: false, error: 'Password must be at least 6 characters.' };
        }

        if (isSupabaseConfigured) {
          try {
            const { data, error } = await supabase.auth.signUp({
              email: email.trim(),
              password: password.trim(),
              options: {
                data: {
                  full_name: fullName.trim(),
                },
              },
            });

            if (error) {
              console.warn(`[AuthDiagnostics] signUp failed for ${email.trim()}: ${error.message}`);
              set({ isLoading: false, error: error.message });
              return { success: false, error: error.message };
            }

            if (data.user && data.session) {
              const newUser: Profile = {
                id: data.user.id,
                email: data.user.email || email,
                fullName: fullName.trim(),
                currency: 'INR',
                createdAt: data.user.created_at || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              set({
                user: newUser,
                session: data.session,
                token: data.session.access_token,
                isAuthenticated: true,
                isLoading: false,
                isInitialized: true,
                error: null,
                isOfflineMode: false,
              });

              const storageKey = `sb-lqzhfnsxgytwbeudtzks-auth-token`;
              const rawStored = await AsyncStorage.getItem(storageKey);
              console.log(
                `[AuthDiagnostics] Signup Telemetry: sessionExists=true tokenExists=${Boolean(data.session.access_token)} userId=${data.user.id} storageKeyExists=${Boolean(rawStored)} storageSize=${rawStored ? rawStored.length : 0}`
              );

              return { success: true };
            }

            const incompleteMsg = 'Account created, but authentication is not complete.';
            console.warn(`[AuthDiagnostics] signUp completed without session for user ${data?.user?.id || 'unknown'}`);
            set({
              user: null,
              session: null,
              token: null,
              isAuthenticated: false,
              isLoading: false,
              isInitialized: true,
              error: incompleteMsg,
            });
            return { success: false, error: incompleteMsg };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Network error during signup';
            console.warn(`[AuthDiagnostics] signUp exception: ${msg}`);
            set({ isLoading: false, error: msg });
            return { success: false, error: msg };
          }
        }

        const newLocalUser: Profile = {
          id: 'user-' + Date.now().toString(),
          email: email.trim(),
          fullName: fullName.trim(),
          currency: 'INR',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set({
          user: newLocalUser,
          session: null,
          token: 'local-vault-token',
          isAuthenticated: true,
          isLoading: false,
          isInitialized: true,
          error: null,
          isOfflineMode: true,
        });

        return { success: true };
      },

      signOut: async () => {
        if (isSupabaseConfigured) {
          try {
            await supabase.auth.signOut();
          } catch (e) {
            console.warn('[AuthDiagnostics] Supabase signout failed', e);
          }
        }

        const storageKey = `sb-lqzhfnsxgytwbeudtzks-auth-token`;
        const rawStored = await AsyncStorage.getItem(storageKey);
        console.log(
          `[AuthDiagnostics] SignOut Telemetry: sessionExists=false tokenExists=false storageKeyExists=${Boolean(rawStored)}`
        );

        try {
          const { useItemStore } = require('./itemStore');
          useItemStore.getState().clearUserData();
        } catch (e) {
          console.warn('[AuthDiagnostics] clearUserData on signOut failed:', e);
        }

        set({
          user: null,
          session: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          error: null,
        });
      },

      updateProfile: async (updates: Partial<Profile>) => {
        const current = get().user;
        if (!current) return;

        const updated = { ...current, ...updates, updatedAt: new Date().toISOString() };
        set({ user: updated });

        if (isSupabaseConfigured && !get().isOfflineMode) {
          try {
            await supabase
              .from('profiles')
              .update({
                full_name: updated.fullName,
                currency: updated.currency,
                avatar_url: updated.avatarUrl,
                updated_at: updated.updatedAt,
              })
              .eq('id', current.id);
          } catch (e) {
            console.warn('Cloud profile update failed:', e);
          }
        }
      },

      deleteAccount: async () => {
        const current = get().user;
        const currentSession = get().session;
        if (!current) return;

        if (isSupabaseConfigured && !get().isOfflineMode) {
          try {
            const accessToken = currentSession?.access_token;
            if (!accessToken) {
              throw new Error('No active session token found. Please sign in again.');
            }

            const { data, error } = await supabase.functions.invoke('delete-account', {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });

            if (error) {
              const errorMsg = error.message || 'Account deletion failed on server.';
              console.warn('[AuthDiagnostics] delete-account function error:', errorMsg);
              throw new Error(errorMsg);
            }

            if (data && data.success === false) {
              const serverMsg = data.error || 'Account deletion was rejected by the server.';
              console.warn('[AuthDiagnostics] delete-account server rejection:', serverMsg);
              throw new Error(serverMsg);
            }

            console.log('[AuthDiagnostics] Account successfully deleted via Edge Function.');
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown account deletion error';
            console.warn('[AuthDiagnostics] deleteAccount failed:', msg);
            throw new Error(msg);
          }
        }

        try {
          const { useItemStore } = require('./itemStore');
          useItemStore.getState().clearUserData();
        } catch (e) {
          console.warn('[AuthDiagnostics] clearUserData on deleteAccount failed:', e);
        }

        set({
          user: null,
          session: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          error: null,
        });
      },

      clearError: () => set({ error: null }),

      resetPasswordForEmail: async (email: string) => {
        const cleanEmail = email.trim();
        if (!cleanEmail) {
          return { success: false, error: 'Please enter your email address.' };
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
          return { success: false, error: 'Please enter a valid email address.' };
        }

        if (isSupabaseConfigured) {
          try {
            console.log(`[PasswordReset] Requesting password reset link for email`);
            const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
              redirectTo: 'keepr://auth/reset-password',
            });

            if (error) {
              console.warn(`[PasswordReset] resetPasswordForEmail error:`, error.message);
              if (error.status === 429 || error.message.toLowerCase().includes('rate')) {
                return {
                  success: false,
                  error: 'Too many reset requests. Please wait a few minutes before trying again.',
                };
              }
              return { success: true };
            }

            console.log('[PasswordReset] Password reset request successfully received by Supabase');
            return { success: true };
          } catch (err: any) {
            console.error('[PasswordReset] resetPasswordForEmail exception:', err?.message);
            return {
              success: false,
              error: 'Unable to connect. Please check your internet connection and try again.',
            };
          }
        }

        console.log('[PasswordReset] Offline mode reset simulation');
        return { success: true };
      },

      updatePassword: async (newPassword: string) => {
        if (!newPassword) {
          return { success: false, error: 'Please enter a new password.' };
        }

        if (newPassword.length < 6) {
          return { success: false, error: 'Password must be at least 6 characters long.' };
        }

        if (isSupabaseConfigured) {
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const activeSession = sessionData?.session || get().session;

            if (!activeSession) {
              console.warn('[PasswordReset] No active session found when updating password');
              return {
                success: false,
                error: 'Your reset link is no longer valid or has expired. Please request a new one.',
              };
            }

            console.log('[PasswordReset] Invoking supabase.auth.updateUser to update password...');
            const { data, error } = await supabase.auth.updateUser({
              password: newPassword,
            });

            if (error) {
              console.warn('[PasswordReset] updateUser error:', error.message);
              return {
                success: false,
                error: error.message || 'Unable to update your password. Please try again.',
              };
            }

            console.log('[PasswordReset] Password successfully updated in Supabase');

            // Sign out the recovery session cleanly so user logs in afresh with new credentials
            try {
              await supabase.auth.signOut();
            } catch (signOutErr) {
              console.warn('[PasswordReset] Signout after password update warning:', signOutErr);
            }

            set({
              user: null,
              session: null,
              token: null,
              isAuthenticated: false,
              isRecoveryMode: false,
              isLoading: false,
              error: null,
            });

            return { success: true };
          } catch (err: any) {
            console.error('[PasswordReset] Network error during password update:', err?.message);
            return {
              success: false,
              error: 'Unable to connect. Please check your internet connection and try again.',
            };
          }
        }

        set({ isRecoveryMode: false });
        return { success: true };
      },
    }),
    {
      name: 'keepr-auth-vault-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
