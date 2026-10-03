
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ReceiptMultiItem } from '../../types/scanner';

interface MultiItemCardProps {
  items: ReceiptMultiItem[];
  onToggleSelect: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onEditItem?: (item: ReceiptMultiItem) => void;
  onSaveAll: () => void;
  onSaveSelected: () => void;
}

export const MultiItemCard: React.FC<MultiItemCardProps> = ({
  items,
  onToggleSelect,
  onRemoveItem,
  onEditItem,
  onSaveAll,
  onSaveSelected,
}) => {
  if (!items || items.length <= 1) {
    return null;
  }

  const selectedCount = items.filter((i) => i.selected).length;
  const totalAmount = items.reduce((acc, i) => acc + (i.selected ? i.price * (i.quantity || 1) : 0), 0);

  return (
    <View className="bg-white rounded-[14px] border border-[#E2E8F0] overflow-hidden mb-4 shadow-sm">
      <View className="p-[14px] bg-[#F8FAFC] border-b border-[#F1F5F9]">
        <View className="flex-row items-center gap-2 mb-1">
          <MaterialIcons name="inventory-2" size={18} color="#115086" />
          <Text className="text-[14px] font-bold text-[#0F172A]">Multi-Product Receipt Detected</Text>
        </View>
        <Text className="text-[12px] text-[#64748B] leading-4">
          {items.length} items found. Choose which products to save into your Keepr Vault.
        </Text>
      </View>

      <View className="p-[10px] gap-2">
        {items.map((item, index) => {
          return (
            <View
              key={item.id || `item-${index}`}
              className={`flex-row items-center p-[10px] rounded-[10px] border ${
                item.selected ? 'bg-[#F0F7FD] border-[#BAE6FD]' : 'bg-[#FAFAF9] border-[#E7E5E4]'
              }`}
            >
              <TouchableOpacity
                className="pr-2"
                onPress={() => onToggleSelect(item.id)}
                activeOpacity={0.7}
              >
                <MaterialIcons
                  name={item.selected ? 'check-box' : 'check-box-outline-blank'}
                  size={22}
                  color={item.selected ? '#115086' : '#94A3B8'}
                />
              </TouchableOpacity>

              <View className="flex-1 gap-1">
                <View className="flex-row justify-between items-center pr-[6px]">
                  <Text className="text-[13px] font-semibold text-[#1E293B] flex-1" numberOfLines={1}>
                    {item.productName}
                  </Text>
                  <Text className="text-[13px] font-bold text-[#115086] ml-2">
                    ₹{Number(item.price * (item.quantity || 1)).toLocaleString('en-IN')}
                  </Text>
                </View>

                <View className="flex-row items-center gap-2">
                  <View className="bg-[#E2E8F0] px-[6px] py-[2px] rounded">
                    <Text className="text-[10px] font-semibold text-[#475569]">{item.category}</Text>
                  </View>
                  <Text className="text-[11px] text-[#64748B]">Qty: {item.quantity || 1}</Text>
                </View>
              </View>

              <View className="flex-row items-center gap-1">
                {onEditItem && (
                  <TouchableOpacity
                    className="p-[6px] rounded-[6px] bg-[#F1F5F9]"
                    onPress={() => onEditItem(item)}
                    activeOpacity={0.6}
                  >
                    <MaterialIcons name="edit" size={16} color="#64748B" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  className="p-[6px] rounded-[6px] bg-[#F1F5F9]"
                  onPress={() => onRemoveItem(item.id)}
                  activeOpacity={0.6}
                >
                  <MaterialIcons name="delete-outline" size={17} color="#DC2626" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      <View className="p-3 bg-[#F8FAFC] border-t border-[#F1F5F9] gap-[10px]">
        <View className="flex-row justify-between items-center">
          <Text className="text-[12px] font-semibold text-[#64748B]">
            Selected Total ({selectedCount}/{items.length}):
          </Text>
          <Text className="text-[14px] font-extrabold text-[#115086]">
            ₹{Number(totalAmount).toLocaleString('en-IN')}
          </Text>
        </View>

        <View className="flex-row gap-[10px]">
          <TouchableOpacity
            className="flex-1 flex-row items-center justify-center gap-[6px] py-[10px] bg-[#E0F2FE] rounded-serene-md border border-[#BAE6FD]"
            onPress={onSaveSelected}
            disabled={selectedCount === 0}
            activeOpacity={0.8}
          >
            <MaterialIcons name="check" size={16} color="#115086" />
            <Text className="text-[12px] font-bold text-[#115086]">
              Save Selected ({selectedCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-1 flex-row items-center justify-center gap-[6px] py-[10px] bg-[#115086] rounded-serene-md"
            onPress={onSaveAll}
            activeOpacity={0.8}
          >
            <MaterialIcons name="done-all" size={16} color="#FFFFFF" />
            <Text className="text-[12px] font-bold text-white">Save All ({items.length})</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};
