
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { KeeprLogo } from './KeeprLogo';
import { SereneColors } from '../../constants/theme';
import { router } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useItemStore } from '../../store/itemStore';
import { getDeadlineStatus } from '../../utils/warranty';
import { useNotificationReadStore } from '../../store/notificationReadStore';

interface HeaderProps {
  title?: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
}


function useActiveNotificationIds(): string[] {
  const items = useItemStore((s) => s.items);
  return useMemo(() => {
    const ids: string[] = [];
    for (const item of items) {
      const status = getDeadlineStatus(item);
      if (status.hasUpcomingReturn && !status.isReturnExpired && item.returnUntil) {
        ids.push(`return-${item.id}`);
      }
      const warrantyDate = item.warrantyUntil || (item as any).warranty?.endDate;
      if (status.hasUpcomingWarranty && !status.isWarrantyExpired && warrantyDate) {
        ids.push(`warranty-${item.id}`);
      }
    }
    return ids;
  }, [items]);
}


export const Header: React.FC<HeaderProps> = ({ title = 'Keepr', showBack = false, rightAction }) => {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  const activeIds = useActiveNotificationIds();

  const hasUnread = useNotificationReadStore((state) => state.hasUnread(activeIds));

  return (
    <View
      className="bg-[rgba(252,249,241,0.95)] border-b border-serene-hairline-border pb-[10px] px-4 z-50"
      style={{ paddingTop: Math.max(insets.top, 12) }}
    >
      <View className="h-12 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2 flex-1 mr-2">
          {showBack && (
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-8 h-8 rounded-full bg-serene-surface-container-high items-center justify-center -ml-1 mr-1"
              activeOpacity={0.7}
            >
              <MaterialIcons name="chevron-left" size={24} color={SereneColors.onSurface} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => router.push('/(tabs)/')}
            activeOpacity={0.8}
            className="flex-row items-center gap-2"
          >
            {!showBack && <KeeprLogo size={28} />}
            <Text className="text-[18px] font-bold text-serene-on-surface tracking-tight" numberOfLines={1}>
              {title}
            </Text>
          </TouchableOpacity>
        </View>

        {rightAction ? (
          <View className="flex-row items-center">{rightAction}</View>
        ) : (
          <View className="flex-row items-center gap-3">
            <TouchableOpacity
              className="w-[38px] h-[38px] rounded-full items-center justify-center relative"
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={() => router.push('/(tabs)/notifications')}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <MaterialIcons name="notifications-none" size={22} color={SereneColors.onSurfaceVariant} />
              {hasUnread && (
                <View className="absolute top-2 right-2 w-[7px] h-[7px] rounded-full bg-serene-primary border-[1.5px] border-serene-surface" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              className="w-[34px] h-[34px] rounded-full border-[1.5px] border-[rgba(51,104,160,0.25)] overflow-hidden"
              onPress={() => router.push('/(tabs)/profile')}
              accessibilityRole="button"
              accessibilityLabel="Profile"
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              {user?.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} className="w-full h-full rounded-full" />
              ) : (
                <View className="w-full h-full bg-serene-primary-container items-center justify-center">
                  <Text className="text-white text-[14px] font-bold">
                    {(user?.fullName || 'A').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
};
