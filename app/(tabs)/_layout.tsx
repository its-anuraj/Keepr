
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SereneColors } from '../../src/constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  // ── Startup gate ──────────────────────────────────────────────────────────
  // If auth has not yet been initialized, render nothing so the native splash
  // stays on top. This is a belt-and-suspenders guard: the root layout already
  // returns null while appReady is false, so (tabs) should only ever mount
  // when isInitialized is true. The check here prevents any flash if the root
  // layout renders the Stack one frame before the auth guard effect fires.
  if (!isInitialized) {
    console.log('[AuthDiagnostic] (tabs) layout: auth not yet initialized — blocking render');
    return null;
  }

  // ── Auth gate ─────────────────────────────────────────────────────────────
  // If no session exists after initialization, redirect synchronously during
  // this render. Because <Redirect> fires in the same render pass as mounting
  // (tabs), the tab content (Vault/Home) never paints to screen.
  if (!session) {
    console.log('[AuthDiagnostic] (tabs) layout: no session — synchronous redirect to welcome');
    return <Redirect href="/(auth)/welcome" />;
  }

  console.log('[AuthDiagnostic] CASE F: (tabs) layout rendering authenticated tree');

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: SereneColors.primary,
        tabBarInactiveTintColor: SereneColors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          borderTopWidth: 1,
          borderTopColor: 'rgba(17, 80, 134, 0.08)',
          height: Platform.OS === 'ios' ? 76 + insets.bottom : 64 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
          shadowColor: '#115086',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.04,
          shadowRadius: 10,
          elevation: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Vault',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="shield" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="items"
        options={{
          title: 'Items',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="inventory-2" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="documents"
        options={{
          title: 'Documents',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="description" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="services"
        options={{
          title: 'Services',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="build" size={22} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="add"
        options={{
          href: null,
        }}
      />

      <Tabs.Screen
        name="activity"
        options={{
          href: null,
          title: 'Activity',
        }}
      />

      <Tabs.Screen
        name="notifications"
        options={{
          href: null,
          title: 'Notifications',
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
