
import React, { useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useItemStore } from '../../src/store/itemStore';
import { getDeadlineStatus } from '../../src/utils/warranty';
import { SereneColors } from '../../src/constants/theme';
import { formatDate } from '../../src/utils/currency';
import { useNotificationReadStore } from '../../src/store/notificationReadStore';


interface NotificationEntry {
  id: string;
  itemId: string;
  itemName: string;
  type: 'return' | 'warranty';
  daysRemaining: number;
  deadlineDate: string;
  statusText: string;
  isUrgent: boolean; // today or ≤ 1 day
}


function buildNotifications(items: ReturnType<typeof useItemStore.getState>['items']): NotificationEntry[] {
  const entries: NotificationEntry[] = [];

  for (const item of items) {
    const status = getDeadlineStatus(item);

    if (status.hasUpcomingReturn && !status.isReturnExpired && item.returnUntil) {
      entries.push({
        id: `return-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        type: 'return',
        daysRemaining: status.returnDaysRemaining,
        deadlineDate: item.returnUntil,
        statusText: status.returnStatusText || status.returnBadgeText,
        isUrgent: status.returnDaysRemaining <= 1,
      });
    }

    const warrantyDate = item.warrantyUntil || (item as any).warranty?.endDate;
    if (status.hasUpcomingWarranty && !status.isWarrantyExpired && warrantyDate) {
      entries.push({
        id: `warranty-${item.id}`,
        itemId: item.id,
        itemName: item.name,
        type: 'warranty',
        daysRemaining: status.warrantyDaysRemaining,
        deadlineDate: warrantyDate,
        statusText: status.warrantyStatusText || status.warrantyBadgeText,
        isUrgent: status.warrantyDaysRemaining <= 1,
      });
    }
  }

  // Sort: urgent first, then by days remaining ascending
  return entries.sort((a, b) => {
    if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
    return a.daysRemaining - b.daysRemaining;
  });
}


function NotificationCard({ entry }: { entry: NotificationEntry }) {
  const isReturn = entry.type === 'return';
  const urgentBg = entry.isUrgent ? 'bg-red-50' : isReturn ? 'bg-amber-50' : 'bg-blue-50';
  const urgentBorder = entry.isUrgent
    ? 'border-red-200'
    : isReturn
    ? 'border-amber-200'
    : 'border-blue-200';
  const urgentIcon = entry.isUrgent ? '#DC2626' : isReturn ? '#D97706' : '#3B82F6';
  const urgentText = entry.isUrgent
    ? 'text-red-900'
    : isReturn
    ? 'text-amber-900'
    : 'text-blue-900';
  const subText = entry.isUrgent
    ? 'text-red-700'
    : isReturn
    ? 'text-amber-700'
    : 'text-blue-700';

  const typeLabel = isReturn ? 'Return Deadline' : 'Warranty Expiry';
  const iconName = isReturn ? 'assignment-return' : 'shield';
  const dayLabel =
    entry.daysRemaining === 0
      ? 'Ends today'
      : entry.daysRemaining === 1
      ? '1 day left'
      : `${entry.daysRemaining} days left`;

  return (
    <TouchableOpacity
      className={`${urgentBg} border ${urgentBorder} rounded-serene-lg p-4 flex-row items-start gap-3`}
      activeOpacity={0.82}
      onPress={() => router.push(`/item/${entry.itemId}` as any)}
      accessibilityRole="button"
      accessibilityLabel={`${entry.itemName} — ${entry.statusText}`}
    >
      <View className="w-9 h-9 rounded-full bg-white/70 items-center justify-center shrink-0 mt-0.5">
        <MaterialIcons name={iconName as any} size={18} color={urgentIcon} />
      </View>

      <View className="flex-1 gap-0.5">
        <Text className={`text-[13px] font-bold ${urgentText}`} numberOfLines={1}>
          {entry.itemName}
        </Text>
        <Text className={`text-[11px] font-semibold ${subText}`}>{typeLabel}</Text>
        <Text className={`text-[12px] ${urgentText}`}>{entry.statusText}</Text>
        <View className="flex-row items-center gap-1.5 mt-1">
          <MaterialIcons name="event" size={12} color={urgentIcon} />
          <Text className={`text-[11px] ${subText}`}>
            {formatDate(entry.deadlineDate, 'medium')} · {dayLabel}
          </Text>
        </View>
      </View>

      <MaterialIcons
        name="chevron-right"
        size={18}
        color={urgentIcon}
        style={{ marginTop: 2 }}
      />
    </TouchableOpacity>
  );
}


export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const items = useItemStore((s) => s.items);
  const markAllRead = useNotificationReadStore((s) => s.markAllRead);
  const pruneStale = useNotificationReadStore((s) => s.pruneStale);

  const notifications = useMemo(() => buildNotifications(items), [items]);

  const currentIds = useMemo(() => notifications.map((n) => n.id), [notifications]);

  // Mark all currently visible notifications as read when this screen opens.
  // This clears the bell dot. Runs whenever the notification list changes
  // (e.g. a deadline passes while the screen is open).
  useEffect(() => {
    if (currentIds.length > 0) {
      markAllRead(currentIds);
    }
    // Also prune any stale IDs from the read set (items that no longer have
    // active deadlines) so the persisted set doesn't grow unboundedly.
    pruneStale(currentIds);
  }, [currentIds, markAllRead, pruneStale]);

  const urgent = notifications.filter((n) => n.isUrgent);
  const upcoming = notifications.filter((n) => !n.isUrgent);

  return (
    <View
      className="flex-1 bg-serene-background"
      style={{ paddingTop: Math.max(insets.top, 0) }}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <View className="bg-[rgba(252,249,241,0.97)] border-b border-serene-hairline-border px-4 pb-3 pt-3 flex-row items-center gap-3">
        <TouchableOpacity
          className="w-9 h-9 rounded-full items-center justify-center"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="arrow-back" size={22} color={SereneColors.onSurface} />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-[18px] font-bold text-serene-on-surface">Notifications</Text>
          {notifications.length > 0 && (
            <Text className="text-[11px] text-serene-on-surface-variant">
              {notifications.length} active reminder{notifications.length !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
        {notifications.length > 0 && (
          <View className="bg-serene-primary px-2.5 py-0.5 rounded-full">
            <Text className="text-[11px] font-bold text-white">{notifications.length}</Text>
          </View>
        )}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          gap: 20,
          paddingBottom: Math.max(insets.bottom + 24, 32),
        }}
        showsVerticalScrollIndicator={false}
      >
        {notifications.length === 0 ? (
          <View className="flex-1 items-center justify-center pt-20 gap-4">
            <View className="w-20 h-20 rounded-full bg-serene-surface-container-low items-center justify-center border border-serene-subtle-border">
              <MaterialIcons
                name="notifications-none"
                size={36}
                color={SereneColors.outline}
              />
            </View>
            <View className="items-center gap-1">
              <Text className="text-[16px] font-bold text-serene-on-surface">All clear</Text>
              <Text className="text-[13px] text-serene-on-surface-variant text-center max-w-[260px] leading-5">
                No upcoming return deadlines or warranty expirations in the next 30 days.
              </Text>
            </View>
            <TouchableOpacity
              className="mt-2 bg-serene-primary px-5 py-2.5 rounded-full flex-row items-center gap-1.5"
              activeOpacity={0.85}
              onPress={() => router.push('/(tabs)/items' as any)}
            >
              <MaterialIcons name="inventory-2" size={16} color="#FFFFFF" />
              <Text className="text-[13px] font-semibold text-white">View My Items</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {urgent.length > 0 && (
              <View className="gap-2.5">
                <View className="flex-row items-center gap-1.5">
                  <MaterialIcons name="error-outline" size={14} color="#DC2626" />
                  <Text className="text-[12px] font-bold text-red-700 uppercase tracking-wider">
                    Needs Attention
                  </Text>
                </View>
                {urgent.map((entry) => (
                  <NotificationCard key={entry.id} entry={entry} />
                ))}
              </View>
            )}

            {upcoming.length > 0 && (
              <View className="gap-2.5">
                <View className="flex-row items-center gap-1.5">
                  <MaterialIcons name="schedule" size={14} color={SereneColors.onSurfaceVariant} />
                  <Text className="text-[12px] font-bold text-serene-on-surface-variant uppercase tracking-wider">
                    Upcoming
                  </Text>
                </View>
                {upcoming.map((entry) => (
                  <NotificationCard key={entry.id} entry={entry} />
                ))}
              </View>
            )}

            <View className="flex-row items-center gap-1.5 pt-2 pb-2">
              <MaterialIcons name="info-outline" size={13} color={SereneColors.outline} />
              <Text className="text-[10px] text-serene-on-surface-variant flex-1 leading-4">
                Showing return deadlines within 7 days and warranty expirations within 30 days.
                Tap any reminder to view the item.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
