import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Header } from '../../src/components/ui/Header';
import { SereneColors } from '../../src/constants/theme';
import { useAuthStore } from '../../src/store/authStore';
import { useItemStore } from '../../src/store/itemStore';

import { VaultReportsModal } from '../../src/components/modals/VaultReportsModal';

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const items = useItemStore((s) => s.items);

  const [warrantyNotifs, setWarrantyNotifs] = useState(true);
  const [maintNotifs, setMaintNotifs] = useState(true);
  const [docNotifs, setDocNotifs] = useState(true);
  const [showReportsModal, setShowReportsModal] = useState(false);

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out of Vault',
      'Are you sure you want to sign out? Your stored items and receipts remain in your private vault.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/(auth)/welcome');
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Vault Account',
      'Are you sure you want to permanently delete your vault account? All vault records, receipts, and item history will be permanently deleted and cannot be recovered.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Permanently Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
              router.replace('/(auth)/welcome');
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Could not delete account. Please try again.';
              Alert.alert('Deletion Failed', msg);
            }
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-serene-surface">
      <Header title="Vault Profile" />

      <ScrollView
        contentContainerClassName="px-4 pb-10 gap-4"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center gap-3.5 bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border mt-2">
          <View className="w-14 h-14 rounded-full bg-serene-primary items-center justify-center">
            <Text className="text-[22px] font-bold text-white">
              {(user?.fullName || 'A').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-lg font-bold text-serene-on-surface">{user?.fullName || 'Anuraj Singh'}</Text>
            <Text className="text-xs text-serene-on-surface-variant">{user?.email || 'anuraj@example.com'}</Text>
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border gap-3.5">
          <Text className="text-sm font-bold text-serene-on-surface">Notification Preferences</Text>

          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-[13px] font-semibold text-serene-on-surface">Warranty Expiry Alerts</Text>
              <Text className="text-[11px] text-serene-on-surface-variant mt-[1px]">30 days and 7 days before expiration</Text>
            </View>
            <Switch
              value={warrantyNotifs}
              onValueChange={setWarrantyNotifs}
              trackColor={{ false: SereneColors.surfaceContainerHighest, true: SereneColors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-[13px] font-semibold text-serene-on-surface">Service & Maintenance Reminders</Text>
              <Text className="text-[11px] text-serene-on-surface-variant mt-[1px]">2 days prior to scheduled maintenance</Text>
            </View>
            <Switch
              value={maintNotifs}
              onValueChange={setMaintNotifs}
              trackColor={{ false: SereneColors.surfaceContainerHighest, true: SereneColors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-[13px] font-semibold text-serene-on-surface">Document Expiry Reminders</Text>
              <Text className="text-[11px] text-serene-on-surface-variant mt-[1px]">Insurance & certificate renewals</Text>
            </View>
            <Switch
              value={docNotifs}
              onValueChange={setDocNotifs}
              trackColor={{ false: SereneColors.surfaceContainerHighest, true: SereneColors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border gap-3.5">
          <Text className="text-sm font-bold text-serene-on-surface">Data Management</Text>

          <TouchableOpacity
            className="flex-row items-center justify-between py-1"
            onPress={() => setShowReportsModal(true)}
            activeOpacity={0.7}
          >
            <View className="flex-row items-center gap-3 flex-1 pr-2">
              <MaterialIcons name="summarize" size={20} color={SereneColors.primary} />
              <View className="flex-1 min-w-0">
                <Text className="text-[13px] font-semibold text-serene-on-surface">Vault Reports</Text>
                <Text className="text-[11px] text-serene-on-surface-variant mt-[1px]">
                  Generate PDF & CSV reports with custom date range
                </Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={SereneColors.outline} />
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-row items-center justify-between py-1"
            onPress={() =>
              Alert.alert(
                'About Keepr',
                'Keepr - Personal Digital Ownership Vault.\n\nVersion 1.0.0 \n\nEverything you don\'t want to forget about what you own.'
              )
            }
          >
            <View className="flex-row items-center gap-3 flex-1 pr-2">
              <MaterialIcons name="info-outline" size={20} color={SereneColors.primary} />
              <View>
                <Text className="text-[13px] font-semibold text-serene-on-surface">About Keepr Vault</Text>
                <Text className="text-[11px] text-serene-on-surface-variant mt-[1px]">Version 1.0.0 </Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={SereneColors.outline} />
          </TouchableOpacity>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border gap-3.5">
          <TouchableOpacity className="flex-row items-center justify-center gap-1.5 py-2.5 rounded-serene-md bg-serene-surface-container-low" onPress={handleSignOut}>
            <MaterialIcons name="logout" size={18} color={SereneColors.primary} />
            <Text className="text-[13px] font-semibold text-serene-primary">Sign Out of Vault</Text>
          </TouchableOpacity>

          <TouchableOpacity className="flex-row items-center justify-center gap-1.5 py-2.5 rounded-serene-md bg-serene-error-container" onPress={handleDeleteAccount}>
            <MaterialIcons name="delete-forever" size={18} color={SereneColors.error} />
            <Text className="text-[13px] font-semibold text-serene-error">Delete Vault Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <VaultReportsModal
        visible={showReportsModal}
        onClose={() => setShowReportsModal(false)}
      />
    </View>
  );
}
