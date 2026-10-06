
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import { Profile } from '../types';
import { isSupabaseConfigured, supabase, supabaseUrl, runAuthStorageDiagnostics } from '../lib/supabase';
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
// Resolvers for the INITIAL_SESSION promise used by initialize()
let resolveInitialSession: (() => void) | null = null;

function setupAuthListener() {
  if (authListenerSubscribed || !isSupabaseConfigured) return;
  authListenerSubscribed = true;

  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log(
      `[AuthDiagnostic] onAuthStateChange event=${event} sessionExists=${Boolean(session)} accessTokenExists=${Boolean(session?.access_token)}`
    );

    // PASSWORD_RECOVERY: Supabase established a temporary recovery session from the
    // reset-email link. Set isRecoveryMode so the root auth guard does NOT redirect
    // to /(tabs). The reset-password screen clears this flag on completion.
    if (event === 'PASSWORD_RECOVERY') {
      console.log('[AuthDiagnostic] PASSWORD_RECOVERY event received — entering recovery mode');
      useAuthStore.setState({
        session,
        token: session?.access_token ?? null,
        isAuthenticated: Boolean(session),
        isRecoveryMode: true,
        isLoading: false,
        isInitialized: true,
        error: null,
      });
      // Resolve the init promise so the splash can hide
      resolveInitialSession?.();
      resolveInitialSession = null;
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
        // Immediate baseline profile from session metadata — never wait for network roundtrip to unblock UI!
        const baseProfile: Profile = {
          id: session.user.id,
          email: session.user.email || '',
          fullName:
            session.user.user_metadata?.full_name ||
            session.user.email?.split('@')[0] ||
            'Vault Member',
          currency: 'INR',
          createdAt: session.user.created_at || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        useAuthStore.setState({
          user: baseProfile,
          session,
          token: session.access_token,
          isAuthenticated: true,
          isLoading: false,
          isInitialized: true,
          error: null,
          isOfflineMode: false,
          isRecoveryMode: false,
        });

        // Resolve the init promise immediately on INITIAL_SESSION so splash screen can hide without delay
        if (event === 'INITIAL_SESSION') {
          console.log('[AuthDiagnostic] CASE F CHECK: INITIAL_SESSION resolved with active session');
          resolveInitialSession?.();
          resolveInitialSession = null;
        }

        // Fetch full profile from cloud asynchronously in background without blocking startup/splash
        fetchProfile(session.user)
          .then((fullProfile) => {
            useAuthStore.setState({ user: fullProfile });
          })
          .catch((err) => {
            console.warn('[AuthDiagnostic] Background fetchProfile warning:', err);
          });

        // Cloud hydration: load all vault data for this user from Supabase.
        // Only on SIGNED_IN or INITIAL_SESSION to avoid redundant fetches on token refresh.
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          try {
            const { useItemStore } = require('./itemStore');
            useItemStore.getState().hydrateFromCloud();
          } catch (hydrateErr) {
            console.warn('[AuthDiagnostic] hydrateFromCloud deferred:', hydrateErr);
          }
        }
      } else if (event === 'INITIAL_SESSION') {
        // No session in storage — definitively unauthenticated logged-out user
        console.log('[AuthDiagnostic] INITIAL_SESSION resolved: session=null (unauthenticated)');
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
        resolveInitialSession?.();
        resolveInitialSession = null;
      }
    } else if (event === 'SIGNED_OUT') {
      console.log('[AuthDiagnostic] SIGNED_OUT event received');
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
        if (get().isInitialized && get().session) {
          console.log('[AuthDiagnostic] Already initialized with active session, skipping re-init');
          return;
        }

        set({ isLoading: true, error: null });

        if (isSupabaseConfigured) {
          const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
          const storageKey = `sb-${projectRef}-auth-token`;

          // Check if a legacy session exists in SecureStore that needs migration to AsyncStorage
          try {
            const asyncVal = await AsyncStorage.getItem(storageKey);
            const secureVal = await SecureStore.getItemAsync(storageKey).catch(() => null);
            if (secureVal && !asyncVal) {
              console.log('[AuthDiagnostic] Migrating legacy session from SecureStore to AsyncStorage');
              await AsyncStorage.setItem(storageKey, secureVal);
            }
          } catch (migErr) {
            console.warn('[AuthDiagnostic] SecureStore migration check non-fatal error:', migErr);
          }

          // Register the auth listener BEFORE calling getSession(). The listener
          // will fire INITIAL_SESSION once Supabase reads the stored session from
          // AsyncStorage. We wait for that event via a Promise so we never treat
          // a transient null (while AsyncStorage is still loading) as a real logout.
          const initialSessionPromise = new Promise<void>((resolve) => {
            resolveInitialSession = resolve;
          });

          setupAuthListener();

          try {
            const rawStored = await AsyncStorage.getItem(storageKey);
            console.log(
              `[AuthDiagnostic] CASE D CHECK: AsyncStorage inspection storageKey=${storageKey} sessionInStorage=${Boolean(rawStored)} size=${rawStored ? rawStored.length : 0}`
            );

            const { data, error } = await supabase.auth.getSession();
            console.log(
              `[AuthDiagnostic] getSession: sessionExists=${Boolean(data?.session)} accessTokenExists=${Boolean(data?.session?.access_token)}`
            );

            if (error) {
              console.warn('[AuthDiagnostic] Supabase getSession error:', error.message);
            }

            if (data?.session?.user) {
              const supaUser = data.session.user;
              const baseProfile: Profile = {
                id: supaUser.id,
                email: supaUser.email || '',
                fullName:
                  supaUser.user_metadata?.full_name ||
                  supaUser.email?.split('@')[0] ||
                  'Vault Member',
                currency: 'INR',
                createdAt: supaUser.created_at || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };

              useAuthStore.setState({
                user: baseProfile,
                session: data.session,
                token: data.session.access_token,
                isAuthenticated: true,
                isLoading: false,
                isInitialized: true,
                error: null,
                isOfflineMode: false,
                isRecoveryMode: false,
              });

              if (resolveInitialSession) {
                console.log('[AuthDiagnostic] getSession resolved session directly before listener');
                resolveInitialSession();
                resolveInitialSession = null;
              }

              fetchProfile(supaUser)
                .then((fullProfile) => {
                  useAuthStore.setState({ user: fullProfile });
                })
                .catch(() => {});
            }
          } catch (err) {
            console.warn('[AuthDiagnostic] Session restore exception:', err);
          }

          // Safety timeout (5 s) in case INITIAL_SESSION never fires
          const timeout = new Promise<void>((resolve) =>
            setTimeout(() => {
              console.warn('[AuthDiagnostic] INITIAL_SESSION timeout — resolving as unauthenticated');
              if (resolveInitialSession) {
                resolveInitialSession = null;
                useAuthStore.setState({
                  user: null,
                  session: null,
                  token: null,
                  isAuthenticated: false,
                  isLoading: false,
                  isInitialized: true,
                  isOfflineMode: false,
                });
              }
              resolve();
            }, 5000)
          );

          await Promise.race([initialSessionPromise, timeout]);
          return;
        }

        // Supabase not configured — CASE A
        console.warn('[AuthDiagnostic] CASE A DETECTED: Supabase is unconfigured in APK build');
        set({
          user: null,
          session: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
          isOfflineMode: true,
        });
      },


      signIn: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        if (!email.trim() || !password.trim()) {
          set({ isLoading: false, error: 'Please provide both email and password.' });
          return { success: false, error: 'Please provide both email and password.' };
        }

        console.log('[AuthDiagnostic] sign-in started');

        if (isSupabaseConfigured) {
          try {
            const { data, error } = await supabase.auth.signInWithPassword({
              email: email.trim(),
              password: password.trim(),
            });

            if (error) {
              console.warn(`[AuthDiagnostic] CASE B: signIn failed: ${error.message}`);
              set({ isLoading: false, error: error.message });
              return { success: false, error: error.message };
            }

            if (data.user && data.session) {
              console.log(
                `[AuthDiagnostic] CASE C CHECK: sign-in response received: sessionExists=true accessTokenExists=${Boolean(data.session.access_token)} userExists=true`
              );

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
                console.warn('[AuthDiagnostic] signIn offline migration deferred:', migErr);
              }

              try {
                const { useItemStore } = require('./itemStore');
                useItemStore.getState().hydrateFromCloud();
              } catch (hydrateErr) {
                console.warn('[AuthDiagnostic] signIn hydrateFromCloud deferred:', hydrateErr);
              }

              const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
              const storageKey = `sb-${projectRef}-auth-token`;
              AsyncStorage.getItem(storageKey).then((rawStored) => {
                console.log(
                  `[AuthDiagnostic] CASE C VERIFIED: session persistence in storage: storageKeyExists=${Boolean(rawStored)} size=${rawStored ? rawStored.length : 0}`
                );
              }).catch(() => {});

              return { success: true };
            }

            const noSessionErr = 'Sign in succeeded but session is missing.';
            console.warn('[AuthDiagnostic] CASE B:', noSessionErr);
            set({ isLoading: false, error: noSessionErr });
            return { success: false, error: noSessionErr };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Network error during login';
            console.warn(`[AuthDiagnostic] CASE B: signIn exception: ${msg}`);
            set({ isLoading: false, error: msg });
            return { success: false, error: msg };
          }
        }

        // Supabase NOT configured — do NOT fake authentication!
        const configError =
          'Authentication service is not configured. Missing Supabase credentials in application build.';
        console.warn('[AuthDiagnostic] CASE A: signIn failed because Supabase is unconfigured');
        set({ isLoading: false, error: configError });
        return { success: false, error: configError };
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

        console.log('[AuthDiagnostic] sign-up started');

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
              console.warn(`[AuthDiagnostic] CASE B: signUp failed: ${error.message}`);
              set({ isLoading: false, error: error.message });
              return { success: false, error: error.message };
            }

            if (data.user && data.session) {
              console.log(
                `[AuthDiagnostic] CASE C CHECK: sign-up response received: sessionExists=true accessTokenExists=${Boolean(data.session.access_token)}`
              );

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

              const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
              const storageKey = `sb-${projectRef}-auth-token`;
              AsyncStorage.getItem(storageKey).then((rawStored) => {
                console.log(
                  `[AuthDiagnostic] CASE C VERIFIED: signup persistence in storage: storageKeyExists=${Boolean(rawStored)} size=${rawStored ? rawStored.length : 0}`
                );
              }).catch(() => {});

              return { success: true };
            }

            const incompleteMsg = 'Account created. Please check your email to confirm your account.';
            console.log('[AuthDiagnostic] signUp completed, email confirmation may be required');
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
            console.warn(`[AuthDiagnostic] CASE B: signUp exception: ${msg}`);
            set({ isLoading: false, error: msg });
            return { success: false, error: msg };
          }
        }

        // Supabase NOT configured — do NOT fake authentication!
        const configError =
          'Authentication service is not configured. Missing Supabase credentials in application build.';
        console.warn('[AuthDiagnostic] CASE A: signUp failed because Supabase is unconfigured');
        set({ isLoading: false, error: configError });
        return { success: false, error: configError };
      },

      signOut: async () => {
        if (isSupabaseConfigured) {
          try {
            await supabase.auth.signOut();
          } catch (e) {
            console.warn('[AuthDiagnostic] Supabase signOut error:', e);
          }
        }

        const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
        const storageKey = `sb-${projectRef}-auth-token`;
        AsyncStorage.getItem(storageKey).then((rawStored) => {
          console.log(
            `[AuthDiagnostic] signOut status: sessionExists=false accessTokenExists=false storageCleared=${!rawStored}`
          );
        }).catch(() => {});

        try {
          const { useItemStore } = require('./itemStore');
          useItemStore.getState().clearUserData();
        } catch (e) {
          console.warn('[AuthDiagnostic] clearUserData on signOut failed:', e);
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
              console.warn('[AuthDiagnostic] delete-account function error:', errorMsg);
              throw new Error(errorMsg);
            }

            if (data && data.success === false) {
              const serverMsg = data.error || 'Account deletion was rejected by the server.';
              console.warn('[AuthDiagnostic] delete-account server rejection:', serverMsg);
              throw new Error(serverMsg);
            }

            console.log('[AuthDiagnostic] Account successfully deleted via Edge Function.');
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown account deletion error';
            console.warn('[AuthDiagnostic] deleteAccount failed:', msg);
            throw new Error(msg);
          }
        }

        try {
          const { useItemStore } = require('./itemStore');
          useItemStore.getState().clearUserData();
        } catch (e) {
          console.warn('[AuthDiagnostic] clearUserData on deleteAccount failed:', e);
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
            console.log('[AuthDiagnostic] Requesting password reset link for email');
            const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
              redirectTo: 'keepr://auth/reset-password',
            });

            if (error) {
              console.warn('[AuthDiagnostic] resetPasswordForEmail error:', error.message);
              if (error.status === 429 || error.message.toLowerCase().includes('rate')) {
                return {
                  success: false,
                  error: 'Too many reset requests. Please wait a few minutes before trying again.',
                };
              }
              return { success: true };
            }

            console.log('[AuthDiagnostic] Password reset request successfully received by Supabase');
            return { success: true };
          } catch (err: any) {
            console.error('[AuthDiagnostic] resetPasswordForEmail exception:', err?.message);
            return {
              success: false,
              error: 'Unable to connect. Please check your internet connection and try again.',
            };
          }
        }

        const configError = 'Authentication service is not configured.';
        console.warn('[AuthDiagnostic] CASE A: resetPassword attempted but Supabase is unconfigured.');
        return { success: false, error: configError };
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
              console.warn('[AuthDiagnostic] No active session found when updating password');
              return {
                success: false,
                error: 'Your reset link is no longer valid or has expired. Please request a new one.',
              };
            }

            console.log('[AuthDiagnostic] Invoking supabase.auth.updateUser to update password...');
            const { data, error } = await supabase.auth.updateUser({
              password: newPassword,
            });

            if (error) {
              console.warn('[AuthDiagnostic] updateUser error:', error.message);
              return {
                success: false,
                error: error.message || 'Unable to update your password. Please try again.',
              };
            }

            console.log('[AuthDiagnostic] Password successfully updated in Supabase');

            // Sign out the recovery session cleanly so user logs in afresh with new credentials
            try {
              await supabase.auth.signOut();
            } catch (signOutErr) {
              console.warn('[AuthDiagnostic] Signout after password update warning:', signOutErr);
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
            console.error('[AuthDiagnostic] Network error during password update:', err?.message);
            return {
              success: false,
              error: 'Unable to connect. Please check your internet connection and try again.',
            };
          }
        }

        const configError = 'Authentication service is not configured.';
        console.warn('[AuthDiagnostic] CASE A: updatePassword attempted but Supabase is unconfigured.');
        set({ isRecoveryMode: false });
        return { success: false, error: configError };
      },
    }),
    {
      name: 'keepr-auth-vault-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
