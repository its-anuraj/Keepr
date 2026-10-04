
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

// Keep native splash screen visible during asset and auth loading
SplashScreen.preventAutoHideAsync().catch(() => {
});

export default function RootLayout() {
  const initializeAuth = useAuthStore((s) => s.initialize);
  const session = useAuthStore((s) => s.session);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isRecoveryMode = useAuthStore((s) => s.isRecoveryMode);
  const segments = useSegments();
  const pathname = usePathname();

  const [appReady, setAppReady] = useState(false);

  const pendingNotificationRef = useRef<string | null>(null);
  // Prevents duplicate navigation if both live listener and cold-start check fire
  const notificationHandledRef = useRef(false);

  useEffect(() => {
    async function prepare() {
      try {
        await initializeAuth();
      } catch (e) {
        console.warn('App initialization error:', e);
      } finally {
        setAppReady(true);
      }
    }

    prepare();
  }, [initializeAuth]);

  useEffect(() => {
    if (appReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appReady]);

  // Auth Routing Guard: Keep unauthenticated users in (auth), send authenticated users to (tabs)
  useEffect(() => {
    const segs = (segments as unknown as string[]) || [];
    if (!appReady || !isInitialized || segs.length === 0) return;

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
      router.replace('/(auth)/welcome');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, isInitialized, appReady, segments, pathname, isRecoveryMode]);

  useEffect(() => {
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

    if (appReady) {
      Linking.getInitialURL().then((url) => {
        if (url) processUrl(url);
      }).catch((e) => console.warn('Failed to get initial URL:', e));
    }

    const subscription = Linking.addEventListener('url', (event) => {
      processUrl(event.url);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [appReady]);

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
