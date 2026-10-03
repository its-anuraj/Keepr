
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { KeeprLogo } from '../../src/components/ui/KeeprLogo';
import { SereneColors } from '../../src/constants/theme';

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 bg-serene-surface px-serene-lg justify-between"
      style={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }}
    >
      <View className="items-center mt-5">
        <View className="mb-4 shadow-md">
          <KeeprLogo size={80} />
        </View>

        <Text className="text-[32px] font-bold text-serene-primary tracking-[-1px]">Keepr</Text>
        <Text className="text-[14px] text-serene-on-surface-variant text-center italic mt-[6px] max-w-[280px]">
          "Everything you don't want to forget about what you own."
        </Text>

        <View className="flex-row items-center gap-[6px] bg-serene-tertiary-fixed px-[10px] py-1 rounded-full mt-3">
          <MaterialIcons name="lock" size={14} color={SereneColors.tertiary} />
          <Text className="text-[10px] font-bold text-serene-on-tertiary-fixed tracking-[0.8px]">
            ENCRYPTED AES-256 VAULT
          </Text>
        </View>
      </View>

      <View className="gap-4 my-[10px]">
        <View className="flex-row items-start gap-3">
          <View className="w-[38px] h-[38px] rounded-serene-md bg-serene-surface-container-lowest border border-serene-subtle-border items-center justify-center">
            <MaterialIcons name="receipt-long" size={20} color={SereneColors.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-[14px] font-semibold text-serene-on-surface">Receipts & Invoices</Text>
            <Text className="text-[12px] text-serene-on-surface-variant mt-[2px] leading-[17px]">
              Never lose track of purchase records, proof of ownership, or resale provenance.
            </Text>
          </View>
        </View>

        <View className="flex-row items-start gap-3">
          <View className="w-[38px] h-[38px] rounded-serene-md bg-serene-surface-container-lowest border border-serene-subtle-border items-center justify-center">
            <MaterialIcons name="verified" size={20} color={SereneColors.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-[14px] font-semibold text-serene-on-surface">Active Warranties</Text>
            <Text className="text-[12px] text-serene-on-surface-variant mt-[2px] leading-[17px]">
              Dynamic countdowns and proactive expiry notifications before coverage lapses.
            </Text>
          </View>
        </View>

        <View className="flex-row items-start gap-3">
          <View className="w-[38px] h-[38px] rounded-serene-md bg-serene-surface-container-lowest border border-serene-subtle-border items-center justify-center">
            <MaterialIcons name="build" size={20} color={SereneColors.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-[14px] font-semibold text-serene-on-surface">Maintenance & Expenses</Text>
            <Text className="text-[12px] text-serene-on-surface-variant mt-[2px] leading-[17px]">
              Log servicing history, calculate total ownership cost, and stay on top of upkeep.
            </Text>
          </View>
        </View>
      </View>

      <View className="gap-[10px] mb-[10px]">
        <TouchableOpacity
          className="flex-row items-center justify-center gap-2 bg-serene-primary h-12 rounded-serene-lg shadow-sm"
          activeOpacity={0.88}
          onPress={() => router.push('/(auth)/signup')}
        >
          <Text className="text-[14px] font-semibold text-white">Create Vault Account</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity
          className="items-center justify-center bg-serene-surface-container-lowest h-12 rounded-serene-lg border border-serene-subtle-border"
          activeOpacity={0.88}
          onPress={() => router.push('/(auth)/login')}
        >
          <Text className="text-[14px] font-semibold text-serene-primary">Sign In to Existing Vault</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
