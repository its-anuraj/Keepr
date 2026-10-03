
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Header } from '../../src/components/ui/Header';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { useAuthStore } from '../../src/store/authStore';

export default function AddMaintenanceModal() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const [title, setTitle] = useState('');
  const [serviceProvider, setServiceProvider] = useState('');
  const [serviceDate, setServiceDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [cost, setCost] = useState('');
  const [nextServiceDate, setNextServiceDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addMaintenanceRecord = useItemStore((s) => s.addMaintenanceRecord);

  const handleSave = async () => {
    setError(null);
    if (!title.trim()) {
      setError('Please provide a maintenance service title.');
      return;
    }
    if (!itemId) {
      setError('Missing target item reference.');
      return;
    }

    const cleanCost = parseFloat(cost.replace(/[^0-9.]/g, '')) || 0;
    const authUser = useAuthStore.getState().user;
    const authSession = useAuthStore.getState().session;
    const resolvedUserId = authUser?.id || authSession?.user?.id;

    if (!resolvedUserId) {
      setError('Authentication required. Please sign in to log maintenance.');
      return;
    }

    await addMaintenanceRecord({
      itemId,
      userId: resolvedUserId,
      title: title.trim(),
      serviceProvider: serviceProvider.trim() || undefined,
      serviceDate,
      cost: cleanCost,
      nextServiceDate: nextServiceDate.trim() || undefined,
      status: 'completed',
      notes: notes.trim() || undefined,
    });

    router.back();
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-serene-surface"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header title="Log Maintenance" showBack />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="pt-2 gap-1">
          <Text className="text-[20px] font-bold text-serene-on-surface">Record Service or Upkeep</Text>
          <Text className="text-[12px] text-serene-on-surface-variant leading-[17px]">
            All upkeep entries are persisted to the asset's total cost of ownership ledger.
          </Text>
        </View>

        {error ? (
          <View className="flex-row items-center gap-[6px] bg-serene-error-container p-[10px] rounded-serene-md">
            <MaterialIcons name="error-outline" size={16} color={SereneColors.error} />
            <Text className="text-[12px] text-serene-error">{error}</Text>
          </View>
        ) : null}

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border gap-[14px]">
          <View className="gap-1">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Service Title *</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
              placeholder="e.g. Laptop cleaning, Oil change, Coil repair"
              placeholderTextColor={SereneColors.outline}
              value={title}
              onChangeText={setTitle}
            />
          </View>

          <View className="gap-1">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Cost (₹)</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
              placeholder="e.g. 1,200"
              placeholderTextColor={SereneColors.outline}
              value={cost}
              onChangeText={setCost}
              keyboardType="numeric"
            />
          </View>

          <View className="gap-1">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Service Provider</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
              placeholder="e.g. Apple Care or Urban Company"
              placeholderTextColor={SereneColors.outline}
              value={serviceProvider}
              onChangeText={setServiceProvider}
            />
          </View>

          <View className="gap-1">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Service Date</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
              placeholder="YYYY-MM-DD"
              placeholderTextColor={SereneColors.outline}
              value={serviceDate}
              onChangeText={setServiceDate}
            />
          </View>

          <View className="gap-1">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Next Service Due (Optional)</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
              placeholder="YYYY-MM-DD"
              placeholderTextColor={SereneColors.outline}
              value={nextServiceDate}
              onChangeText={setNextServiceDate}
            />
          </View>

          <View className="gap-1">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Notes</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface h-[70px]"
              style={{ textAlignVertical: 'top' }}
              placeholder="e.g. Replaced thermal paste, includes 6-month warranty"
              placeholderTextColor={SereneColors.outline}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />
          </View>

          <TouchableOpacity
            className="flex-row items-center justify-center gap-[6px] bg-serene-primary h-[46px] rounded-serene-lg mt-[6px]"
            activeOpacity={0.88}
            onPress={handleSave}
          >
            <MaterialIcons name="done" size={18} color="#FFFFFF" />
            <Text className="text-[13px] font-semibold text-white">Save Maintenance Record</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
