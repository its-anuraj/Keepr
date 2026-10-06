
import React, { useEffect, useState, useRef, useCallback } from 'react';
import '../global.css';
import { Stack, router, useSegments, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../src/store/authStore';
import { SereneColors } from '../src/constants/theme';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NotificationService } from '../src/services/notifications';
import * as Linking from 'expo-linking';
import { handleIncomingAuthLink } from '../src/services/authRecoveryService';

import { hideSplashScreen } from '../src/utils/splashCoordinator';

// Prevent the native splash from auto-hiding. It stays visible until
// the first real screen (Welcome or Vault) completes its layout.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const initializeAuth = useAuthStore((s) => s.initialize);
  const session = useAuthStore((s) => s.session);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isRecoveryMode = useAuthStore((s) => s.isRecoveryMode);
  const segments = useSegments();
  const pathname = usePathname();

  // Single authoritative loading flag.
  // Stays false until auth state is definitively resolved (authenticated OR unauthenticated).
  // While false the JSX returns null — no React screen is mounted, native splash stays on top.
  const [appReady, setAppReady] = useState(false);

  const pendingNotificationRef = useRef<string | null>(null);
  // Prevents duplicate navigation if both live listener and cold-start check fire
  const notificationHandledRef = useRef(false);

  // ── Auth Initialization ────────────────────────────────────────────────────
  useEffect(() => {
    async function prepare() {
      console.log('[StartupAuth] auth initialization started');
      try {
        await initializeAuth();
      } catch (e) {
        console.warn('App initialization error:', e);
      } finally {
        const currentSession = useAuthStore.getState().session;
        if (currentSession) {
          console.log('[StartupAuth] session resolved: logged-in');
        } else {
          console.log('[StartupAuth] session resolved: logged-out');
        }
        // Auth state definitively resolved — allow route tree to mount.
        // DO NOT hide the splash here! The native splash remains visible
        // until the first real screen (Welcome for logged-out, Vault for logged-in)
        // completes its initial layout.
        setAppReady(true);
      }
    }

    console.log('[StartupAuth] prepare() queued');
    prepare();
  }, [initializeAuth]);

  // ── Safety Fallback for Splash Screen ──────────────────────────────────────
  // If for any reason no screen calls hideSplashScreen within 3s after appReady,
  // ensure the splash is hidden so the user is never stuck.
  useEffect(() => {
    if (!appReady) return;
    const timer = setTimeout(() => {
      hideSplashScreen('safety-timeout');
    }, 3000);
    return () => clearTimeout(timer);
  }, [appReady]);

  // ── Auth Routing Guard ─────────────────────────────────────────────────────
  // Runs after appReady is true (and therefore after all hooks are stable).
  // Keeps unauthenticated users in (auth), sends authenticated users to (tabs).
  useEffect(() => {
    if (!appReady || !isInitialized) return;

    const segs = (segments as unknown as string[]) || [];
    const authScreens = ['welcome', 'login', 'signup', 'forgot-password', 'reset-password'];
    const authPaths = ['/welcome', '/login', '/signup', '/forgot-password', '/reset-password'];

    const inAuthGroup =
      segs[0] === '(auth)' ||
      segs.includes('(auth)') ||
      authScreens.some((screen) => segs.includes(screen)) ||
      authPaths.some((authPath) => pathname === authPath || pathname.startsWith(authPath)) ||
      pathname.startsWith('/(auth)');

    const isResetPasswordScreen =
      inAuthGroup && (segs.includes('reset-password') || pathname.includes('reset-password'));

    // CRITICAL: If user is in password recovery mode or actively on reset-password screen,
    // do NOT redirect them to (tabs), even though they technically have an active recovery session.
    if (isRecoveryMode || isResetPasswordScreen) {
      return;
    }

    if (!session && !inAuthGroup) {
      console.log('[AuthDiagnostic] RootLayout redirecting unauthenticated user to /(auth)/welcome');
      router.replace('/(auth)/welcome');
    } else if (session && inAuthGroup) {
      console.log('[AuthDiagnostic] RootLayout redirecting authenticated user to /(tabs)');
      router.replace('/(tabs)');
    }
  }, [session, isInitialized, appReady, segments, pathname, isRecoveryMode]);

  // ── Deep Link / Auth Recovery Handling ────────────────────────────────────
  useEffect(() => {
    if (!appReady) return;

    let isMounted = true;

    async function processUrl(url: string | null) {
      if (!url || !isMounted) return;

      const result = await handleIncomingAuthLink(url);
      if (!isMounted || !result.isRecovery) return;

      if (result.isError) {
        router.replace({
          pathname: '/(auth)/reset-password',
          params: {
            error: result.errorCode || 'error',
            error_description: result.errorDescription || 'Link expired',
          },
        } as any);
      } else {
        router.replace('/(auth)/reset-password' as any);
      }
    }

    Linking.getInitialURL().then((url) => {
      if (url) processUrl(url);
    }).catch((e) => console.warn('Failed to get initial URL:', e));

    const subscription = Linking.addEventListener('url', (event) => {
      processUrl(event.url);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [appReady]);

  // ── Notification Navigation Helpers ───────────────────────────────────────
  // Navigates to target (service, document, or item) exactly once, preventing duplicates
  const navigateToTarget = useCallback((target: { itemId?: string; documentId?: string; serviceId?: string }) => {
    if (notificationHandledRef.current) return;
    if (target.serviceId) {
      notificationHandledRef.current = true;
      setTimeout(() => {
        router.push(`/service/${target.serviceId}` as any);
        setTimeout(() => { notificationHandledRef.current = false; }, 1500);
      }, 100);
    } else if (target.documentId) {
      notificationHandledRef.current = true;
      setTimeout(() => {
        router.push(`/document/${target.documentId}` as any);
        setTimeout(() => { notificationHandledRef.current = false; }, 1500);
      }, 100);
    } else if (target.itemId) {
      notificationHandledRef.current = true;
      setTimeout(() => {
        router.push(`/item/${target.itemId}` as any);
        setTimeout(() => { notificationHandledRef.current = false; }, 1500);
      }, 100);
    }
  }, []);

  // ── Notification Deep Linking ─────────────────────────────────────────────
  // Deep linking on notification tap -> opens Service, Item Details, or Document Details screen
  useEffect(() => {
    if (!appReady || !session) {
      NotificationService.checkInitialNotificationResponse((target) => {
        if (target.serviceId || target.documentId || target.itemId) {
          pendingNotificationRef.current = target.serviceId
            ? `service:${target.serviceId}`
            : target.documentId
            ? `doc:${target.documentId}`
            : `item:${target.itemId}`;
        }
      });
      return;
    }

    if (pendingNotificationRef.current) {
      const pendingRaw = pendingNotificationRef.current;
      pendingNotificationRef.current = null;
      if (pendingRaw.startsWith('service:')) {
        navigateToTarget({ serviceId: pendingRaw.slice(8) });
      } else if (pendingRaw.startsWith('doc:')) {
        navigateToTarget({ documentId: pendingRaw.slice(4) });
      } else if (pendingRaw.startsWith('item:')) {
        navigateToTarget({ itemId: pendingRaw.slice(5) });
      } else {
        navigateToTarget({ itemId: pendingRaw });
      }
    }

    const unsubscribe = NotificationService.setupNotificationResponseListener((target) => {
      if (target.serviceId || target.documentId || target.itemId) {
        console.log('[Keepr Notifications] Tap received:', target);
        navigateToTarget(target);
      }
    });

    // Cold-start check (app was completely closed when notification was tapped)
    NotificationService.checkInitialNotificationResponse((target) => {
      if (target.serviceId || target.documentId || target.itemId) {
        console.log('[Keepr Notifications] Cold-start notification tap:', target);
        navigateToTarget(target);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [appReady, session, navigateToTarget]);

  // ── CRITICAL: Block render until auth is resolved ─────────────────────────
  // While appReady is false, return null so no screen is mounted.
  // The native splash screen (from expo-splash-screen) stays visible during this time.
  // Only after initializeAuth() completes do we set appReady=true and call hideAsync().
  if (!appReady) {
    return null;
  }

  if (session) {
    console.log('[StartupAuth] rendering authenticated tree');
  } else {
    console.log('[StartupAuth] rendering auth tree');
  }

  return (
    <SafeAreaProvider>
      <View className="flex-1 bg-serene-surface">
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: SereneColors.surface },
            animation: Platform.OS === 'ios' ? 'default' : 'fade_from_bottom',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen
            name="item/[id]"
            options={{
              headerShown: false,
              presentation: 'card',
            }}
          />
          <Stack.Screen
            name="document/[id]"
            options={{
              headerShown: false,
              presentation: 'card',
            }}
          />
          <Stack.Screen
            name="document/add"
            options={{
              headerShown: false,
              presentation: 'card',
            }}
          />
          <Stack.Screen
            name="modals/add-expense"
            options={{
              presentation: 'modal',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="modals/add-maintenance"
            options={{
              presentation: 'modal',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="scan-receipt/index"
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
            }}
          />
        </Stack>
      </View>
    </SafeAreaProvider>
  );
}
