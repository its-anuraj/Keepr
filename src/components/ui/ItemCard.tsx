import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ItemWithOwnerContext } from '../../types';
import { SereneColors } from '../../constants/theme';
import { formatCurrency, formatDate } from '../../utils/currency';
import { formatWarrantyBadge, formatReturnBadge, getCategoryCapabilities } from '../../utils/warranty';
import { router } from 'expo-router';

interface ItemCardProps {
  item: ItemWithOwnerContext;
  isEmbedded?: boolean;
  showDivider?: boolean;
}

const getCategoryIcon = (categoryId?: string): keyof typeof MaterialIcons.glyphMap => {
  switch (categoryId) {
    case 'electronics':
    case 'mobile_laptop':
      return 'devices';
    case 'appliances':
      return 'kitchen';
    case 'fashion':
      return 'checkroom';
    case 'vehicles':
      return 'directions-car';
    case 'furniture':
      return 'chair';
    case 'sports':
      return 'fitness-center';
    case 'beauty':
      return 'spa';
    default:
      return 'inventory-2';
  }
};

export const ItemCard: React.FC<ItemCardProps> = ({
  item,
  isEmbedded = false,
  showDivider = false,
}) => {
  const [imageError, setImageError] = React.useState(false);

  React.useEffect(() => {
    setImageError(false);
  }, [item.photoUri, item.imageUrl]);

  const categoryName =
    typeof item.category === 'object' && item.category?.name
      ? item.category.name
      : typeof item.category === 'string'
      ? item.category
      : 'Item';

  const effectiveWarrantyEnd = item.warrantyUntil || item.warranty?.endDate;
  const hasExplicitWarranty = Boolean(effectiveWarrantyEnd);
  const capabilities = getCategoryCapabilities(
    item.categoryId || (typeof item.category === 'object' ? item.category?.id : item.category),
    item.productType,
    hasExplicitWarranty
  );

  const warrantyBadge = formatWarrantyBadge(effectiveWarrantyEnd, capabilities.warrantySupported);
  const returnBadge = formatReturnBadge(item.returnUntil);
  const hasReceipt = Boolean(item.receiptUri || item.documents?.some((d) => d.fileType === 'receipt'));

  const handlePress = () => {
    router.push(`/item/${item.id}`);
  };

  const rawImageUri = item.photoUri || item.imageUrl;
  const showImage = !imageError && Boolean(rawImageUri);

  if (isEmbedded) {
    return (
      <View>
        <TouchableOpacity
          className="px-3.5 py-3 flex-row items-center justify-between"
          activeOpacity={0.7}
          onPress={handlePress}
        >
          <View className="flex-row items-center gap-3 flex-1 min-w-0 pr-2">
            <View
              style={{ width: 48, height: 48 }}
              className="rounded-serene-lg bg-serene-surface-container-low overflow-hidden items-center justify-center shrink-0"
            >
              {showImage ? (
                <Image
                  source={{ uri: rawImageUri }}
                  style={{ width: 48, height: 48 }}
                  resizeMode="cover"
                  onError={() => setImageError(true)}
                />
              ) : (
                <View
                  style={{ width: 48, height: 48 }}
                  className="items-center justify-center bg-serene-surface-container-high"
                >
                  <MaterialIcons
                    name={getCategoryIcon(item.categoryId)}
                    size={22}
                    color={SereneColors.primary}
                  />
                </View>
              )}
            </View>

            <View className="flex-1 min-w-0 justify-center">
              <Text
                className="text-[14px] font-semibold text-serene-on-surface"
                numberOfLines={1}
              >
                {item.name || 'Untitled Item'}
              </Text>

              <View className="flex-row items-center gap-1.5 mt-[2px]">
                <Text
                  className="text-[11px] font-medium text-serene-on-surface-variant"
                  numberOfLines={1}
                >
                  {categoryName}
                </Text>
                {item.merchant ? (
                  <>
                    <Text className="text-[10px] text-serene-outline">·</Text>
                    <Text
                      className="text-[11px] text-serene-on-surface-variant"
                      numberOfLines={1}
                    >
                      {item.merchant}
                    </Text>
                  </>
                ) : null}
              </View>

              <View className="flex-row items-center gap-2 mt-[3px]">
                <Text className="text-[13px] font-bold text-serene-primary">
                  {formatCurrency(item.purchasePrice, item.currency === 'INR' ? '₹' : '$')}
                </Text>
                {item.purchaseDate ? (
                  <Text className="text-[11px] text-serene-outline">
                    {formatDate(item.purchaseDate, 'short')}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          <View className="w-7 h-7 items-center justify-center shrink-0">
            <MaterialIcons
              name="chevron-right"
              size={20}
              color={SereneColors.outline}
            />
          </View>
        </TouchableOpacity>

        {showDivider && (
          <View className="h-[1px] bg-serene-subtle-border/60 mx-3.5" />
        )}
      </View>
    );
  }

  return (
    <TouchableOpacity
      className="bg-serene-surface-container-lowest rounded-serene-xl overflow-hidden border border-serene-subtle-border mb-[10px] shadow-sm"
      activeOpacity={0.88}
      onPress={handlePress}
    >
      <View className="flex-row items-center justify-between p-serene-md">
        <View className="flex-row items-center gap-3 flex-1 min-w-0 pr-2">
          <View
            style={{ width: 48, height: 48 }}
            className="rounded-serene-lg bg-serene-surface-container-low overflow-hidden items-center justify-center shrink-0"
          >
            {showImage ? (
              <Image
                source={{ uri: rawImageUri }}
                style={{ width: 48, height: 48 }}
                resizeMode="cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <View
                style={{ width: 48, height: 48 }}
                className="items-center justify-center bg-serene-surface-container-high"
              >
                <MaterialIcons
                  name={getCategoryIcon(item.categoryId)}
                  size={22}
                  color={SereneColors.primary}
                />
              </View>
            )}
          </View>

          <View className="flex-1 min-w-0 justify-center">
            <Text
              className="text-[15px] font-semibold text-serene-on-surface"
              numberOfLines={1}
            >
              {item.name || 'Untitled Item'}
            </Text>
            <View className="flex-row items-center gap-1.5 mt-[2px]">
              <Text className="text-[11px] font-medium text-serene-on-surface-variant">
                {categoryName}
              </Text>
              {item.merchant ? (
                <>
                  <Text className="text-[10px] text-serene-outline">·</Text>
                  <Text
                    className="text-[11px] text-serene-on-surface-variant"
                    numberOfLines={1}
                  >
                    {item.merchant}
                  </Text>
                </>
              ) : null}
            </View>

            <View className="flex-row items-center gap-2 mt-[4px]">
              <Text className="text-[14px] font-bold text-serene-primary">
                {formatCurrency(item.purchasePrice, item.currency === 'INR' ? '₹' : '$')}
              </Text>
              {item.purchaseDate ? (
                <Text className="text-[11px] text-serene-outline">
                  Purchased {formatDate(item.purchaseDate, 'short')}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <View className="w-7 h-7 items-center justify-center shrink-0">
          <MaterialIcons
            name="chevron-right"
            size={20}
            color={SereneColors.outline}
          />
        </View>
      </View>

      <View className="flex-row items-center justify-between bg-[rgba(246,243,235,0.65)] px-serene-md py-2 border-t border-[rgba(51,104,160,0.05)]">
        <View className="flex-row items-center gap-2 flex-wrap flex-1">
          {capabilities.warrantySupported ? (
            effectiveWarrantyEnd ? (
              <View
                className={`flex-row items-center gap-1 px-2 py-[2.5px] rounded-full ${
                  warrantyBadge.status === 'expired'
                    ? 'bg-serene-error-container'
                    : warrantyBadge.status === 'expiring_soon'
                    ? 'bg-serene-warning-container'
                    : 'bg-serene-secondary-fixed'
                }`}
              >
                <View
                  className={`w-[5px] h-[5px] rounded-full ${
                    warrantyBadge.status === 'expired'
                      ? 'bg-serene-error'
                      : warrantyBadge.status === 'expiring_soon'
                      ? 'bg-serene-warning'
                      : 'bg-serene-secondary'
                  }`}
                />
                <Text
                  className={`text-[10px] font-semibold ${
                    warrantyBadge.status === 'expired'
                      ? 'text-serene-error'
                      : warrantyBadge.status === 'expiring_soon'
                      ? 'text-serene-warning'
                      : 'text-serene-on-secondary-container'
                  }`}
                >
                  {warrantyBadge.label}
                </Text>
              </View>
            ) : capabilities.showNoWarrantyPlaceholder ? (
              <View className="flex-row items-center gap-1 px-2 py-[2.5px] rounded-full bg-[rgba(230,227,219,0.7)]">
                <View className="w-[5px] h-[5px] rounded-full bg-serene-outline/50" />
                <Text className="text-[10px] font-semibold text-serene-outline">
                  No warranty
                </Text>
              </View>
            ) : null
          ) : null}

          {capabilities.returnSupported && (
            <View
              className={`flex-row items-center gap-1 px-2 py-[2.5px] rounded-full ${
                returnBadge.status === 'expired'
                  ? 'bg-gray-200'
                  : returnBadge.status === 'expiring_soon'
                  ? 'bg-amber-100'
                  : returnBadge.status === 'active'
                  ? 'bg-emerald-50'
                  : 'bg-[rgba(230,227,219,0.7)]'
              }`}
            >
              <View
                className={`w-[5px] h-[5px] rounded-full ${
                  returnBadge.status === 'expired'
                    ? 'bg-gray-500'
                    : returnBadge.status === 'expiring_soon'
                    ? 'bg-amber-600'
                    : returnBadge.status === 'active'
                    ? 'bg-emerald-600'
                    : 'bg-serene-outline/50'
                }`}
              />
              <Text
                className={`text-[10px] font-semibold ${
                  returnBadge.status === 'expired'
                    ? 'text-gray-700'
                    : returnBadge.status === 'expiring_soon'
                    ? 'text-amber-800'
                    : returnBadge.status === 'active'
                    ? 'text-emerald-700'
                    : 'text-serene-outline'
                }`}
              >
                {returnBadge.label}
              </Text>
            </View>
          )}
        </View>

        {hasReceipt ? (
          <View className="flex-row items-center gap-1">
            <MaterialIcons
              name="receipt-long"
              size={14}
              color={SereneColors.primary}
            />
            <Text className="text-[11px] font-medium text-serene-primary">
              Receipt
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};
