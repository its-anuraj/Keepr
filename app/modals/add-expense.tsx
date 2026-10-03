
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
import { ExpenseType } from '../../src/types';

export default function AddExpenseModal() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const [title, setTitle] = useState('');
  const [expenseType, setExpenseType] = useState<ExpenseType>('accessories');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addExpense = useItemStore((s) => s.addExpense);

  const expenseTypes: Array<{ type: ExpenseType; label: string }> = [
    { type: 'accessories', label: 'Accessory' },
    { type: 'repair', label: 'Repair' },
    { type: 'replacement_parts', label: 'Parts' },
    { type: 'insurance', label: 'Insurance' },
    { type: 'maintenance', label: 'Maintenance' },
    { type: 'other', label: 'Other' },
  ];

  const handleSave = async () => {
    setError(null);
    if (!title.trim()) {
      setError('Please provide an expense title.');
      return;
    }
    if (!amount.trim()) {
      setError('Please provide an expense amount.');
      return;
    }
    if (!itemId) {
      setError('Missing target item reference.');
      return;
    }

    const cleanAmount = parseFloat(amount.replace(/[^0-9.]/g, '')) || 0;
    const authUser = useAuthStore.getState().user;
    const authSession = useAuthStore.getState().session;
    const resolvedUserId = authUser?.id || authSession?.user?.id;

    if (!resolvedUserId) {
      setError('Authentication required. Please sign in to log expenses.');
      return;
    }

    await addExpense({
      itemId,
      userId: resolvedUserId,
      title: title.trim(),
      expenseType,
      amount: cleanAmount,
      expenseDate,
      notes: notes.trim() || undefined,
    });

    router.back();
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-serene-surface"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header title="Log Expense" showBack />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="pt-2 gap-1">
          <Text className="text-[20px] font-bold text-serene-on-surface">Log Ownership Expense</Text>
          <Text className="text-[12px] text-serene-on-surface-variant leading-[17px]">
            Upkeep expenses update the asset's Total Cost of Ownership (TCO).
          </Text>
        </View>

        {error ? (
          <View className="flex-row items-center gap-[6px] bg-serene-error-container p-[10px] rounded-serene-md">
            <MaterialIcons name="error-outline" size={16} color={SereneColors.error} />
            <Text className="text-[12px] text-serene-error">{error}</Text>
          </View>
        ) : null}

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border gap-[14px]">
          <View className="gap-[6px]">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Expense Category</Text>
            <View className="flex-row flex-wrap gap-[6px]">
              {expenseTypes.map((et) => {
                const isSelected = expenseType === et.type;
                return (
                  <TouchableOpacity
                    key={et.type}
                    className={`px-3 py-[6px] rounded-full ${
                      isSelected ? 'bg-serene-primary' : 'bg-serene-surface-container-high'
                    }`}
                    onPress={() => setExpenseType(et.type)}
                  >
                    <Text
                      className={`text-[11px] font-semibold ${
                        isSelected ? 'text-white' : 'text-serene-on-surface-variant'
                      }`}
                    >
                      {et.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View className="gap-[6px]">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Expense Title *</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
              placeholder="e.g. Belkin Screen Protector or Laptop Sleeve"
              placeholderTextColor={SereneColors.outline}
              value={title}
              onChangeText={setTitle}
            />
          </View>

          <View className="gap-[6px]">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Amount (₹) *</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
              placeholder="e.g. 1,800"
              placeholderTextColor={SereneColors.outline}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
          </View>

          <View className="gap-[6px]">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Expense Date</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
              placeholder="YYYY-MM-DD"
              placeholderTextColor={SereneColors.outline}
              value={expenseDate}
              onChangeText={setExpenseDate}
            />
          </View>

          <View className="gap-[6px]">
            <Text className="text-[12px] font-semibold text-serene-on-surface">Notes</Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface h-[70px]"
              style={{ textAlignVertical: 'top' }}
              placeholder="e.g. Purchased from Croma with 1-year warranty"
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
            <Text className="text-[13px] font-semibold text-white">Save Expense</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
