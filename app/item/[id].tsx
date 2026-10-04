
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Share,
  Modal,
  ActivityIndicator,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Header } from '../../src/components/ui/Header';
import { WarrantyGauge } from '../../src/components/ui/WarrantyGauge';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { formatCurrency, formatDate } from '../../src/utils/currency';
import { formatReturnBadge, formatWarrantyBadge, getCategoryCapabilities, isNoWarrantyCategory } from '../../src/utils/warranty';
import { getDocumentCategoryConfig } from '../../src/constants/documentCategories';
import {
  safeNormalizeRouteUri,
  getCanonicalReceiptUri,
  normalizeImageUri,
  verifyReceiptFileExists,
  logReceiptDiagnostics,
} from '../../src/services/receiptFileService';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const getItemById = useItemStore((s) => s.getItemById);
  const deleteItem = useItemStore((s) => s.deleteItem);
  const convertItemToDocument = useItemStore((s) => s.convertItemToDocument);
  const getDocumentsByItemId = useItemStore((s) => s.getDocumentsByItemId);
  const getMaintenanceRecordsByItemId = useItemStore((s) => s.getMaintenanceRecordsByItemId);
  const item = getItemById(id);
  const linkedDocuments = id ? getDocumentsByItemId(id) : [];
  const maintenanceRecords = id ? getMaintenanceRecordsByItemId(id) : [];

  const [maintenanceSortOrder, setMaintenanceSortOrder] = useState<'newest' | 'oldest'>('newest');

  const sortedMaintenanceRecords = useMemo(() => {
    return [...maintenanceRecords].sort((a, b) => {
      const dateA = new Date(a.serviceDate || a.createdAt).getTime();
      const dateB = new Date(b.serviceDate || b.createdAt).getTime();
      return maintenanceSortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
  }, [maintenanceRecords, maintenanceSortOrder]);

  const [previewModal, setPreviewModal] = useState<{ uri: string; title: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

  if (!item) {
    return (
      <View className="flex-1 bg-serene-background items-center justify-center p-6">
        <View className="bg-serene-surface-container-lowest p-6 rounded-serene-2xl border border-serene-subtle-border items-center max-w-[320px] w-full shadow-sm">
          <View className="w-12 h-12 rounded-full bg-serene-surface-container-high items-center justify-center mb-3">
            <MaterialIcons name="inventory-2" size={24} color={SereneColors.outline} />
          </View>
          <Text className="text-[16px] font-bold text-serene-on-surface mb-1">Item Not Found</Text>
          <Text className="text-[12px] text-serene-on-surface-variant text-center mb-4">
            This item may have been deleted or moved to another vault.
          </Text>
          <TouchableOpacity
            className="bg-serene-primary px-5 py-2.5 rounded-full"
            activeOpacity={0.88}
            onPress={() => router.replace('/(tabs)/items')}
          >
            <Text className="text-[13px] font-semibold text-white">Return to Items</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const effectiveWarrantyEnd = item.warrantyUntil || item.warranty?.endDate;
  const hasExplicitWarranty = Boolean(effectiveWarrantyEnd);
  const capabilities = getCategoryCapabilities(
    item.categoryId || (typeof item.category === 'object' ? item.category?.id : item.category),
    item.productType,
    hasExplicitWarranty,
    Boolean(item.returnUntil)
  );

  const warrantyBadge = formatWarrantyBadge(effectiveWarrantyEnd, capabilities.warrantySupported);
  const returnBadge = formatReturnBadge(item.returnUntil);

  const categoryName =
    typeof item.category === 'object' && item.category?.name
      ? item.category.name
      : typeof item.category === 'string'
      ? item.category
      : 'Item';

  const rawProductPhotoUri =
    item.photoUri ||
    (item.imageUrl && item.imageUrl !== item.receiptUri ? item.imageUrl : undefined);
  const productPhotoUri = normalizeImageUri(rawProductPhotoUri);

  const allProductPhotos: string[] = (
    item.productPhotos && item.productPhotos.length > 0
      ? item.productPhotos
      : productPhotoUri
      ? [productPhotoUri]
      : []
  )
    .map((u) => normalizeImageUri(u))
    .filter((u): u is string => Boolean(u));

  // Receipt / Invoice (proof of purchase document)
  // Use getCanonicalReceiptUri to re-anchor vault_receipts/ paths to the current
  // documentDirectory (survives app reinstall, iOS container UUID changes, Android restarts)
  const rawReceiptUri =
    item.receiptUri ||
    item.documents?.find((d) => d.fileType === 'receipt' || d.fileType === 'invoice')?.fileUrl;
  const receiptUri = rawReceiptUri
    ? (getCanonicalReceiptUri(rawReceiptUri) || normalizeImageUri(rawReceiptUri) || undefined)
    : undefined;

  const isInvoice = Boolean(
    item.receiptType === 'invoice' ||
    Boolean(item.invoiceNumber && item.invoiceNumber.trim())
  );
  const documentLabel = isInvoice ? 'Invoice' : 'Receipt';

  // Physical disk file existence verification (Requirement 10 & 21)
  const [receiptState, setReceiptState] = useState<{
    status: 'idle' | 'checking' | 'exists' | 'unavailable';
    fileSize?: number;
  }>({ status: receiptUri ? 'checking' : 'idle' });

  const verifyReceipt = useCallback(async () => {
    if (!receiptUri) {
      setReceiptState({ status: 'idle' });
      return;
    }
    setReceiptState((prev) => ({ ...prev, status: 'checking' }));
    try {
      if (
        receiptUri.startsWith('http://') ||
        receiptUri.startsWith('https://') ||
        receiptUri.startsWith('data:')
      ) {
        logReceiptDiagnostics({
          itemId: item.id,
          receiptId: item.receiptId,
          storagePath: receiptUri,
          resolvedUri: receiptUri,
          fileExists: true,
        });
        setReceiptState({ status: 'exists' });
        return;
      }

      const exists = await verifyReceiptFileExists(receiptUri);
      let fileSize: number | undefined;
      if (exists) {
        const info = await FileSystem.getInfoAsync(receiptUri).catch(() => null);
        fileSize = info?.exists ? info.size : undefined;
      }

      logReceiptDiagnostics({
        itemId: item.id,
        receiptId: item.receiptId,
        storagePath: rawReceiptUri,
        resolvedUri: receiptUri,
        fileExists: exists,
        fileSize,
      });

      if (exists) {
        setReceiptState({ status: 'exists', fileSize });
      } else {
        setReceiptState({ status: 'unavailable' });
      }
    } catch (err) {
      console.warn('[ItemDetails] Receipt verification error:', err);
      setReceiptState({ status: 'unavailable' });
    }
  }, [receiptUri, rawReceiptUri, item.id, item.receiptId]);

  useEffect(() => {
    verifyReceipt();
  }, [verifyReceipt]);

  const hasCategoryDetails = Boolean(
    item.productType ||
    item.brand ||
    item.model ||
    item.serialNumber ||
    item.imei ||
    item.size ||
    item.color ||
    item.material ||
    item.registrationNumber ||
    item.vinChassisNumber ||
    item.engineNumber ||
    item.variant ||
    item.dealer ||
    item.insuranceExpiry ||
    item.pucDate
  );

  const isNoWarranty = isNoWarrantyCategory(item.categoryId, categoryName, item.productType);

  const handleShare = async () => {
    try {
      await Share.share({
        title: `Keepr: ${item.name}`,
        message: `Keepr Purchase Record: ${item.name}\nCategory: ${categoryName}${
          item.productType ? ` (${item.productType})` : ''
        }\nPrice: ${formatCurrency(
          item.purchasePrice,
          item.currency === 'INR' ? '₹' : '$'
        )}\nPurchase Date: ${formatDate(item.purchaseDate, 'medium')}${
          item.merchant ? `\nPlatform/Shop: ${item.merchant}` : ''
        }${item.sellerAddress ? `\nAddress: ${item.sellerAddress}` : ''}${
          item.gstTax ? `\nGST/Tax: ${item.gstTax}` : ''
        }${item.invoiceNumber ? `\nInvoice: ${item.invoiceNumber}` : ''}${
          item.returnUntil ? `\nReturn Deadline: ${formatDate(item.returnUntil)}` : ''
        }${!isNoWarranty && effectiveWarrantyEnd ? `\nWarranty Until: ${formatDate(effectiveWarrantyEnd)}` : ''}`,
      });
    } catch {
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Item',
      `Are you sure you want to permanently delete "${item.name}" from your vault?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteItem(item.id);
            router.replace('/(tabs)/items');
          },
        },
      ]
    );
  };

  const handleReclassifyAsDocument = () => {
    Alert.alert(
      'Convert to Standalone Document?',
      'This item will be reclassified as a Document in your Document Vault. It will no longer appear in Items, while preserving your purchase proof and dates.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Convert to Document',
          onPress: async () => {
            setIsConverting(true);
            try {
              const newDoc = await convertItemToDocument(item.id);
              router.replace(`/document/${newDoc.id}` as any);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to convert item to document');
              setIsConverting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-serene-surface">
      <Header title="Item Detail" showBack />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 50, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="pt-2 flex-row items-center justify-between">
          <View className="flex-row items-center gap-1.5 bg-serene-tertiary-fixed px-3 py-1 rounded-full">
            <MaterialIcons name="verified" size={14} color={SereneColors.tertiary} />
            <Text className="text-[11px] font-bold text-serene-on-tertiary-fixed tracking-[0.6px]">
              {item.productType
                ? `${categoryName.toUpperCase()} · ${item.productType.toUpperCase()}`
                : categoryName.toUpperCase()}
            </Text>
          </View>

          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              className="w-9 h-9 rounded-full bg-serene-surface-container-lowest border border-serene-subtle-border items-center justify-center shadow-sm"
              onPress={handleShare}
              accessibilityLabel="Share item"
            >
              <MaterialIcons name="share" size={17} color={SereneColors.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              className="w-9 h-9 rounded-full bg-serene-surface-container-lowest border border-serene-subtle-border items-center justify-center shadow-sm"
              onPress={() => router.push(`/(tabs)/add?editId=${item.id}` as any)}
              accessibilityLabel="Edit item"
            >
              <MaterialIcons name="edit" size={17} color={SereneColors.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              className="w-9 h-9 rounded-full bg-serene-surface-container-lowest border border-serene-subtle-border items-center justify-center shadow-sm"
              onPress={handleDelete}
              accessibilityLabel="Delete item"
            >
              <MaterialIcons name="delete-outline" size={18} color={SereneColors.error} />
            </TouchableOpacity>
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border overflow-hidden shadow-sm relative">
          <View className="h-[3px] bg-serene-primary absolute top-0 left-0 right-0" />

          <View className="flex-row justify-between items-start gap-3 mt-1">
            <View className="flex-1">
              <Text className="text-[22px] font-bold text-serene-on-surface tracking-tight">
                {item.name}
              </Text>
              <Text className="text-[12px] text-serene-on-surface-variant mt-0.5">
                {categoryName}
                {item.merchant ? ` · ${item.merchant}` : ''}
              </Text>
            </View>

            <TouchableOpacity
              className="w-16 h-16 rounded-serene-lg overflow-hidden bg-serene-surface-container-low border border-serene-subtle-border items-center justify-center"
              activeOpacity={0.88}
              onPress={() => {
                if (productPhotoUri) {
                  setPreviewModal({ uri: productPhotoUri, title: `${item.name} · Product Photo` });
                }
              }}
              disabled={!productPhotoUri}
            >
              {productPhotoUri ? (
                <Image source={{ uri: productPhotoUri }} className="w-full h-full" resizeMode="cover" />
              ) : (
                <MaterialIcons name="inventory-2" size={28} color={SereneColors.primary} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Quick Add Actions: Extend item with documents, services, or receipts */}
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            className="flex-1 bg-serene-surface-container-lowest border border-serene-subtle-border py-2.5 px-2 rounded-serene-lg flex-row items-center justify-center gap-1.5 shadow-sm"
            activeOpacity={0.8}
            onPress={() =>
              router.push(
                `/document/add?linkedItemId=${item.id}&linkedItemName=${encodeURIComponent(
                  item.name
                )}` as any
              )
            }
          >
            <MaterialIcons name="note-add" size={16} color={SereneColors.primary} />
            <Text className="text-[12px] font-semibold text-serene-on-surface">Add Document</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-1 bg-serene-surface-container-lowest border border-serene-subtle-border py-2.5 px-2 rounded-serene-lg flex-row items-center justify-center gap-1.5 shadow-sm"
            activeOpacity={0.8}
            onPress={() => router.push(`/service/add?itemId=${item.id}` as any)}
          >
            <MaterialIcons name="build" size={16} color={SereneColors.primary} />
            <Text className="text-[12px] font-semibold text-serene-on-surface">Add Service</Text>
          </TouchableOpacity>

          {!receiptUri ? (
            <TouchableOpacity
              className="flex-1 bg-serene-surface-container-lowest border border-serene-subtle-border py-2.5 px-2 rounded-serene-lg flex-row items-center justify-center gap-1.5 shadow-sm"
              activeOpacity={0.8}
              onPress={() => router.push(`/(tabs)/add?editId=${item.id}` as any)}
            >
              <MaterialIcons name="receipt" size={16} color={SereneColors.primary} />
              <Text className="text-[12px] font-semibold text-serene-on-surface">Add Receipt</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {allProductPhotos.length > 0 && (
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <MaterialIcons name="photo-camera" size={18} color={SereneColors.primary} />
                <Text className="text-[15px] font-bold text-serene-on-surface">Product Photos</Text>
              </View>
              <View className="bg-serene-primary/10 px-2 py-0.5 rounded-full">
                <Text className="text-[11px] font-bold text-serene-primary">
                  {allProductPhotos.length} {allProductPhotos.length === 1 ? 'photo' : 'photos'}
                </Text>
              </View>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingVertical: 2 }}
            >
              {allProductPhotos.map((pUri, idx) => (
                <TouchableOpacity
                  key={`detail-photo-${idx}`}
                  className="w-28 h-28 rounded-serene-lg overflow-hidden border border-serene-subtle-border relative bg-serene-surface-container-low"
                  activeOpacity={0.88}
                  onPress={() =>
                    setPreviewModal({
                      uri: pUri,
                      title: `${item.name} · Photo ${idx + 1} of ${allProductPhotos.length}`,
                    })
                  }
                >
                  <Image source={{ uri: pUri }} className="w-full h-full" resizeMode="cover" />
                  <View className="absolute bottom-1 right-1 bg-black/65 px-1.5 py-0.5 rounded-full flex-row items-center gap-0.5">
                    <MaterialIcons name="zoom-in" size={12} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-3">
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="receipt" size={18} color={SereneColors.primary} />
            <Text className="text-[15px] font-bold text-serene-on-surface">Purchase Details</Text>
          </View>

          <View className="bg-[rgba(246,243,235,0.65)] rounded-serene-lg p-3 gap-2.5">
            <View className="flex-row items-baseline justify-between">
              <View>
                <Text className="text-[12px] text-serene-on-surface-variant">
                  {item.quantity && item.quantity > 1 ? 'Line Total' : 'Purchase Price'}
                </Text>
                {item.quantity && item.quantity > 1 && (
                  <Text className="text-[11px] font-medium text-serene-on-surface-variant mt-0.5">
                    Qty: {item.quantity} × {formatCurrency(item.unitPrice || item.purchasePrice / item.quantity, item.currency === 'INR' ? '₹' : '$')}
                  </Text>
                )}
              </View>
              <Text className="text-[20px] font-bold text-serene-primary">
                {formatCurrency(item.purchasePrice, item.currency === 'INR' ? '₹' : '$')}
              </Text>
            </View>

            {item.receiptId ? (
              <View className="flex-row items-center justify-between py-1 px-2.5 bg-blue-50/80 rounded-serene-md border border-blue-200/70">
                <View className="flex-row items-center gap-1.5">
                  <MaterialIcons name="receipt-long" size={14} color="#115086" />
                  <Text className="text-[11px] font-semibold text-[#115086]">
                    Part of Multi-Item Invoice {item.invoiceNumber ? `#${item.invoiceNumber}` : ''}
                  </Text>
                </View>
                <Text className="text-[10px] font-medium text-[#115086]/80">Shared Receipt</Text>
              </View>
            ) : null}

            <View className="h-[1px] bg-serene-subtle-border" />

            <View className="flex-row justify-between py-0.5">
              <Text className="text-[12px] text-serene-on-surface-variant">Purchase Date</Text>
              <Text className="text-[13px] font-medium text-serene-on-surface">
                {formatDate(item.purchaseDate, 'full') || 'Not entered'}
              </Text>
            </View>

            <View className="flex-row justify-between py-0.5">
              <Text className="text-[12px] text-serene-on-surface-variant">Platform / Shop / Seller</Text>
              <Text className="text-[13px] font-medium text-serene-on-surface">
                {item.merchant || 'Not specified'}
              </Text>
            </View>

            {item.sellerAddress ? (
              <View className="flex-row justify-between py-0.5">
                <Text className="text-[12px] text-serene-on-surface-variant">Seller Address</Text>
                <Text className="text-[13px] font-medium text-serene-on-surface flex-1 text-right ml-4" numberOfLines={2}>
                  {item.sellerAddress}
                </Text>
              </View>
            ) : null}

            {item.gstTax ? (
              <View className="flex-row justify-between py-0.5">
                <Text className="text-[12px] text-serene-on-surface-variant">GST / Tax</Text>
                <Text className="text-[13px] font-medium text-serene-on-surface">
                  {item.gstTax}
                </Text>
              </View>
            ) : null}

            {item.invoiceNumber ? (
              <View className="flex-row justify-between py-0.5">
                <Text className="text-[12px] text-serene-on-surface-variant">Invoice Number</Text>
                <Text className="text-[13px] font-mono font-bold text-serene-on-surface">
                  {item.invoiceNumber}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {item.products && item.products.length > 0 && (
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <MaterialIcons name="shopping-bag" size={18} color={SereneColors.primary} />
                <Text className="text-[15px] font-bold text-serene-on-surface">
                  Purchased Products ({item.products.length})
                </Text>
              </View>
              <View className="bg-serene-primary/10 px-2 py-0.5 rounded-full">
                <Text className="text-[11px] font-bold text-serene-primary">
                  {item.products.length} {item.products.length === 1 ? 'item' : 'items'}
                </Text>
              </View>
            </View>

            <View className="gap-2.5">
              {item.products.map((prod, pIdx) => {
                const prodPhoto = prod.productPhotos && prod.productPhotos.length > 0 ? prod.productPhotos[0] : null;
                return (
                  <View
                    key={prod.id || `prod-${pIdx}`}
                    className="p-3 rounded-serene-lg bg-[rgba(246,243,235,0.65)] border border-serene-subtle-border/60 gap-2"
                  >
                    <View className="flex-row items-start gap-3">
                      {prodPhoto ? (
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => setPreviewModal({ uri: prodPhoto, title: `${prod.name} · Product Photo` })}
                        >
                          <Image
                            source={{ uri: prodPhoto }}
                            className="w-14 h-14 rounded-serene-md bg-white border border-serene-subtle-border"
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                      ) : (
                        <View className="w-14 h-14 rounded-serene-md bg-serene-surface-container-high items-center justify-center">
                          <MaterialIcons name="inventory-2" size={20} color={SereneColors.outline} />
                        </View>
                      )}

                      <View className="flex-1 justify-center">
                        <Text className="text-[14px] font-bold text-serene-on-surface" numberOfLines={2}>
                          {prod.name}
                        </Text>

                        <View className="flex-row flex-wrap items-center gap-1.5 mt-1">
                          {prod.brand ? (
                            <View className="bg-stone-100 px-1.5 py-0.5 rounded-full">
                              <Text className="text-[10px] text-stone-700">{prod.brand}</Text>
                            </View>
                          ) : null}
                          {prod.model ? (
                            <View className="bg-stone-100 px-1.5 py-0.5 rounded-full">
                              <Text className="text-[10px] text-stone-700">{prod.model}</Text>
                            </View>
                          ) : null}
                          {prod.productType ? (
                            <View className="bg-amber-100/70 px-1.5 py-0.5 rounded-full">
                              <Text className="text-[10px] font-semibold text-amber-800">{prod.productType}</Text>
                            </View>
                          ) : null}
                        </View>

                        <View className="flex-row items-baseline justify-between mt-2 pt-1 border-t border-serene-hairline-border">
                          <Text className="text-[11px] text-serene-on-surface-variant">
                            {prod.quantity && prod.quantity > 1
                              ? `${prod.quantity} × ${formatCurrency(prod.unitPrice || prod.lineTotal / prod.quantity, item.currency === 'INR' ? '₹' : '$')}`
                              : 'Price'}
                          </Text>
                          <Text className="text-[13px] font-bold text-serene-primary">
                            {formatCurrency(prod.lineTotal, item.currency === 'INR' ? '₹' : '$')}
                          </Text>
                        </View>

                        {prod.serialNumber ? (
                          <Text className="text-[10px] font-mono text-serene-on-surface-variant mt-1">
                            S/N: {prod.serialNumber}
                          </Text>
                        ) : null}

                        {prod.warrantyUntil ? (
                          <Text className="text-[10px] font-medium text-emerald-700 mt-0.5">
                            🛡️ Warranty until {formatDate(prod.warrantyUntil)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {hasCategoryDetails && (
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-3">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="tune" size={18} color={SereneColors.primary} />
              <Text className="text-[15px] font-bold text-serene-on-surface">
                {categoryName} Specifications
              </Text>
            </View>

            <View className="bg-[rgba(246,243,235,0.65)] rounded-serene-lg p-3 gap-2">
              {item.productType ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Product Type</Text>
                  <Text className="text-[13px] font-semibold text-serene-primary">{item.productType}</Text>
                </View>
              ) : null}

              {item.brand ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Brand / Maker</Text>
                  <Text className="text-[13px] font-medium text-serene-on-surface">{item.brand}</Text>
                </View>
              ) : null}

              {item.model ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Model / Variant</Text>
                  <Text className="text-[13px] font-medium text-serene-on-surface">{item.model}</Text>
                </View>
              ) : null}

              {item.serialNumber ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Serial Number</Text>
                  <Text className="text-[13px] font-mono font-bold text-serene-on-surface">{item.serialNumber}</Text>
                </View>
              ) : null}

              {item.imei ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">IMEI</Text>
                  <Text className="text-[13px] font-mono font-bold text-serene-on-surface">{item.imei}</Text>
                </View>
              ) : null}

              {item.size ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Size</Text>
                  <Text className="text-[13px] font-medium text-serene-on-surface">{item.size}</Text>
                </View>
              ) : null}

              {item.color ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Color</Text>
                  <Text className="text-[13px] font-medium text-serene-on-surface">{item.color}</Text>
                </View>
              ) : null}

              {item.material ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Material</Text>
                  <Text className="text-[13px] font-medium text-serene-on-surface">{item.material}</Text>
                </View>
              ) : null}

              {item.registrationNumber ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Registration / Plate</Text>
                  <Text className="text-[13px] font-mono font-bold text-serene-on-surface">{item.registrationNumber}</Text>
                </View>
              ) : null}

              {item.variant ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Variant</Text>
                  <Text className="text-[13px] font-medium text-serene-on-surface">{item.variant}</Text>
                </View>
              ) : null}

              {item.vinChassisNumber ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">VIN / Chassis #</Text>
                  <Text className="text-[13px] font-mono font-bold text-serene-on-surface">{item.vinChassisNumber}</Text>
                </View>
              ) : null}

              {item.engineNumber ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Engine Number</Text>
                  <Text className="text-[13px] font-mono font-bold text-serene-on-surface">{item.engineNumber}</Text>
                </View>
              ) : null}

              {item.dealer ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Dealership</Text>
                  <Text className="text-[13px] font-medium text-serene-on-surface">{item.dealer}</Text>
                </View>
              ) : null}

              {item.insuranceExpiry ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">Insurance Expiry</Text>
                  <Text className="text-[13px] font-medium text-serene-on-surface">{formatDate(item.insuranceExpiry, 'full')}</Text>
                </View>
              ) : null}

              {item.pucDate ? (
                <View className="flex-row justify-between py-0.5">
                  <Text className="text-[12px] text-serene-on-surface-variant">PUC / Service Date</Text>
                  <Text className="text-[13px] font-medium text-serene-on-surface">{formatDate(item.pucDate, 'full')}</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}

        {(capabilities.returnSupported || Boolean(item.returnUntil)) && (
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <MaterialIcons name="assignment-return" size={18} color="#D97706" />
                <Text className="text-[15px] font-bold text-serene-on-surface">Return Period</Text>
              </View>

              <View
                className={`px-2.5 py-1 rounded-full ${
                  returnBadge.status === 'expired'
                    ? 'bg-gray-200'
                    : returnBadge.status === 'expiring_soon'
                    ? 'bg-amber-100'
                    : returnBadge.status === 'active'
                    ? 'bg-emerald-50'
                    : 'bg-serene-surface-container'
                }`}
              >
                <Text
                  className={`text-[11px] font-semibold ${
                    returnBadge.status === 'expired'
                      ? 'text-gray-700'
                      : returnBadge.status === 'expiring_soon'
                      ? 'text-amber-800'
                      : returnBadge.status === 'active'
                      ? 'text-emerald-700'
                      : 'text-serene-on-surface-variant'
                  }`}
                >
                  {returnBadge.label}
                </Text>
              </View>
            </View>

            {item.returnUntil ? (
              <View className="bg-[rgba(246,243,235,0.65)] rounded-serene-lg p-3 gap-1.5">
                <View className="flex-row justify-between items-center">
                  <Text className="text-[12px] text-serene-on-surface-variant">Last Return Date</Text>
                  <Text className="text-[13px] font-semibold text-serene-on-surface">
                    {formatDate(item.returnUntil, 'full')}
                  </Text>
                </View>
                {returnBadge.subtext ? (
                  <Text className="text-[11px] text-serene-outline text-right">
                    {returnBadge.subtext}
                  </Text>
                ) : null}
              </View>
            ) : (
              <View className="bg-serene-surface-container-low p-3 rounded-serene-md">
                <Text className="text-[12px] text-serene-on-surface-variant">
                  No return date added. You can edit this item to record a return window.
                </Text>
              </View>
            )}
          </View>
        )}

        {capabilities.warrantySupported && (
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <MaterialIcons name="verified-user" size={18} color={SereneColors.primary} />
                <Text className="text-[15px] font-bold text-serene-on-surface">Warranty Protection</Text>
              </View>

              <View
                className={`px-2.5 py-1 rounded-full ${
                  warrantyBadge.status === 'expired'
                    ? 'bg-serene-error-container'
                    : warrantyBadge.status === 'expiring_soon'
                    ? 'bg-serene-warning-container'
                    : warrantyBadge.status === 'active'
                    ? 'bg-serene-secondary-fixed'
                    : 'bg-serene-surface-container'
                }`}
              >
                <Text
                  className={`text-[11px] font-semibold ${
                    warrantyBadge.status === 'expired'
                      ? 'text-serene-error'
                      : warrantyBadge.status === 'expiring_soon'
                      ? 'text-serene-warning'
                      : warrantyBadge.status === 'active'
                      ? 'text-serene-on-secondary-container'
                      : 'text-serene-on-surface-variant'
                  }`}
                >
                  {warrantyBadge.label}
                </Text>
              </View>
            </View>

            {effectiveWarrantyEnd ? (
              <View className="gap-3">
                <WarrantyGauge warranty={item.warranty} />

                <View className="bg-[rgba(246,243,235,0.65)] rounded-serene-lg p-3 gap-2">
                  <View className="flex-row justify-between py-0.5">
                    <Text className="text-[12px] text-serene-on-surface-variant">Warranty Expires</Text>
                    <Text className="text-[13px] font-semibold text-serene-on-surface">
                      {formatDate(effectiveWarrantyEnd, 'full')}
                    </Text>
                  </View>

                  {(item.warrantyProvider || item.warranty?.provider) ? (
                    <View className="flex-row justify-between py-0.5">
                      <Text className="text-[12px] text-serene-on-surface-variant">Provider</Text>
                      <Text className="text-[13px] font-medium text-serene-on-surface">
                        {item.warrantyProvider || item.warranty?.provider}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : (
              <View className="bg-serene-surface-container-low p-3 rounded-serene-md">
                <Text className="text-[12px] text-serene-on-surface-variant">
                  No warranty added. You can edit this item to attach warranty coverage.
                </Text>
              </View>
            )}
          </View>
        )}

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <MaterialIcons
                name={isInvoice ? 'receipt' : 'receipt-long'}
                size={18}
                color={SereneColors.primary}
              />
              <Text className="text-[15px] font-bold text-serene-on-surface">
                {documentLabel} / Proof of Purchase
              </Text>
            </View>

            {receiptUri && receiptState.status === 'exists' ? (
              <View className="bg-emerald-50 px-2.5 py-0.5 rounded-full">
                <Text className="text-[10px] font-semibold text-emerald-700">✓ {documentLabel} Attached</Text>
              </View>
            ) : receiptUri && receiptState.status === 'unavailable' ? (
              <View className="bg-red-50 px-2.5 py-0.5 rounded-full">
                <Text className="text-[10px] font-semibold text-red-600">Unavailable</Text>
              </View>
            ) : null}
          </View>

          {receiptUri ? (
            receiptState.status === 'checking' ? (
              <View className="bg-serene-surface-container-low p-6 rounded-serene-lg items-center justify-center gap-2">
                <ActivityIndicator size="small" color={SereneColors.primary} />
                <Text className="text-[12px] text-serene-on-surface-variant">
                  Verifying {documentLabel.toLowerCase()} attachment...
                </Text>
              </View>
            ) : receiptState.status === 'exists' ? (
              <View className="gap-3">
                <TouchableOpacity
                  className="w-full h-48 rounded-serene-lg overflow-hidden border border-serene-subtle-border relative bg-serene-surface-container-low"
                  activeOpacity={0.9}
                  onPress={() => setPreviewModal({ uri: receiptUri, title: `${item.name} · ${documentLabel}` })}
                >
                  {receiptUri.toLowerCase().endsWith('.pdf') ? (
                    <View className="w-full h-full items-center justify-center bg-serene-surface-container-low">
                      <MaterialIcons name="picture-as-pdf" size={48} color={SereneColors.error} />
                      <Text className="text-[12px] font-mono text-serene-on-surface mt-2 font-semibold">
                        {item.receiptName || `${documentLabel}.pdf`}
                      </Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: receiptUri }}
                      style={{ width: '100%', height: '100%' }}
                      className="w-full h-full"
                      resizeMode="contain"
                    />
                  )}
                  <View className="absolute bottom-2 right-2 bg-black/70 px-2.5 py-1 rounded-full flex-row items-center gap-1">
                    <MaterialIcons name="zoom-in" size={14} color="#FFFFFF" />
                    <Text className="text-[11px] font-medium text-white">Tap to preview</Text>
                  </View>
                </TouchableOpacity>

                <View className="flex-row items-center justify-between">
                  <Text className="text-[11px] text-serene-on-surface-variant font-mono flex-1 mr-2" numberOfLines={1}>
                    {item.receiptName || `Attached ${documentLabel.toLowerCase()} document`}
                    {receiptState.fileSize ? ` · ${(receiptState.fileSize / 1024).toFixed(0)} KB` : ''}
                  </Text>
                  <TouchableOpacity
                    className="bg-serene-surface-container-high px-3 py-1.5 rounded-serene-md flex-row items-center gap-1"
                    onPress={() => setPreviewModal({ uri: receiptUri, title: `${item.name} · ${documentLabel}` })}
                  >
                    <MaterialIcons name="fullscreen" size={16} color={SereneColors.primary} />
                    <Text className="text-[12px] font-semibold text-serene-primary">View {documentLabel}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              // Requirement 10 & 21: Clean error state when file is missing from disk
              <View className="bg-amber-50/60 border border-amber-200/80 p-4 rounded-serene-md items-center gap-2">
                <MaterialIcons name="error-outline" size={26} color="#D97706" />
                <Text className="text-[13px] font-bold text-amber-900">Receipt unavailable</Text>
                <Text className="text-[12px] text-amber-800 text-center">
                  Receipt file is unavailable. The file may have been moved or cleared from local storage.
                </Text>
                <View className="flex-row items-center gap-2 mt-1">
                  <TouchableOpacity
                    className="bg-amber-600 px-3.5 py-1.5 rounded-serene-md flex-row items-center gap-1"
                    onPress={verifyReceipt}
                  >
                    <MaterialIcons name="refresh" size={15} color="#FFFFFF" />
                    <Text className="text-[12px] font-semibold text-white">Try Again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="bg-white border border-amber-300 px-3.5 py-1.5 rounded-serene-md flex-row items-center gap-1"
                    onPress={() => router.push(`/(tabs)/add?editId=${item.id}` as any)}
                  >
                    <MaterialIcons name="add-photo-alternate" size={15} color="#92400E" />
                    <Text className="text-[12px] font-semibold text-amber-900">Re-attach</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          ) : (
            <View className="bg-serene-surface-container-low p-4 rounded-serene-md items-center gap-2">
              <MaterialIcons name="receipt-long" size={28} color={SereneColors.outline} />
              <Text className="text-[12px] text-serene-on-surface-variant text-center">
                No receipt attached
              </Text>
              <TouchableOpacity
                className="mt-1 bg-serene-primary px-3.5 py-1.5 rounded-serene-md flex-row items-center gap-1"
                onPress={() => router.push(`/(tabs)/add?editId=${item.id}` as any)}
              >
                <MaterialIcons name="add-photo-alternate" size={16} color="#FFFFFF" />
                <Text className="text-[12px] font-semibold text-white">Attach {documentLabel}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="folder-special" size={18} color={SereneColors.primary} />
              <Text className="text-[15px] font-bold text-serene-on-surface">
                Documents Vault
              </Text>
              <View className="bg-serene-surface-container-high px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-bold text-serene-primary">
                  {linkedDocuments.length}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              className="bg-serene-primary/10 px-3 py-1 rounded-full flex-row items-center gap-1"
              activeOpacity={0.8}
              onPress={() =>
                router.push(
                  `/document/add?linkedItemId=${item.id}&linkedItemName=${encodeURIComponent(
                    item.name
                  )}` as any
                )
              }
            >
              <MaterialIcons name="add" size={14} color={SereneColors.primary} />
              <Text className="text-[11px] font-semibold text-serene-primary">Add Document</Text>
            </TouchableOpacity>
          </View>

          {linkedDocuments.length > 0 ? (
            <View className="gap-2">
              {linkedDocuments.map((doc) => {
                const catCfg = getDocumentCategoryConfig(doc.category);
                return (
                  <TouchableOpacity
                    key={doc.id}
                    className="bg-serene-surface-container-low rounded-serene-lg p-3 flex-row items-center justify-between border border-serene-subtle-border"
                    activeOpacity={0.85}
                    onPress={() => router.push(`/document/${doc.id}` as any)}
                  >
                    <View className="flex-row items-center gap-3 flex-1 min-w-0 mr-2">
                      <View className="w-8 h-8 rounded-full bg-serene-surface-container-high items-center justify-center shrink-0">
                        <MaterialIcons
                          name={(catCfg.icon as any) || 'description'}
                          size={18}
                          color={SereneColors.primary}
                        />
                      </View>
                      <View className="flex-1 min-w-0">
                        <Text
                          className="text-[13px] font-semibold text-serene-on-surface"
                          numberOfLines={1}
                        >
                          {doc.title}
                        </Text>
                        <View className="flex-row items-center gap-1.5 mt-0.5">
                          <Text className="text-[10px] font-medium text-serene-on-surface-variant">
                            {doc.documentType}
                          </Text>
                          {doc.issuerName ? (
                            <>
                              <Text className="text-[9px] text-serene-outline">·</Text>
                              <Text
                                className="text-[10px] text-serene-on-surface-variant"
                                numberOfLines={1}
                              >
                                {doc.issuerName}
                              </Text>
                            </>
                          ) : null}
                          {doc.expiryDate ? (
                            <>
                              <Text className="text-[9px] text-serene-outline">·</Text>
                              <Text className="text-[10px] text-amber-700 font-medium">
                                Exp: {doc.expiryDate}
                              </Text>
                            </>
                          ) : null}
                        </View>
                      </View>
                    </View>

                    <MaterialIcons name="chevron-right" size={18} color={SereneColors.outline} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View className="bg-serene-surface-container-low p-4 rounded-serene-md items-center gap-1.5">
              <MaterialIcons name="description" size={24} color={SereneColors.outline} />
              <Text className="text-[12px] text-serene-on-surface-variant text-center">
                {item.categoryId === 'vehicles'
                  ? 'No vehicle documents attached yet (RC, Insurance, PUC, etc.).'
                  : 'No additional documents linked to this item.'}
              </Text>
              <TouchableOpacity
                className="mt-1 bg-serene-surface-container-high px-3 py-1 rounded-full flex-row items-center gap-1"
                onPress={() =>
                  router.push(
                    `/document/add?linkedItemId=${item.id}&linkedItemName=${encodeURIComponent(
                      item.name
                    )}` as any
                  )
                }
              >
                <MaterialIcons name="add" size={14} color={SereneColors.primary} />
                <Text className="text-[11px] font-semibold text-serene-primary">
                  {item.categoryId === 'vehicles' ? 'Attach Vehicle Document' : 'Attach Document'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Service & Repair Section */}
        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="build" size={18} color={SereneColors.primary} />
              <Text className="text-[15px] font-bold text-serene-on-surface">Service & Repair</Text>
              <View className="bg-serene-surface-container-high px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-bold text-serene-primary">
                  {maintenanceRecords.length}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              className="bg-serene-primary/10 px-3 py-1 rounded-full flex-row items-center gap-1"
              activeOpacity={0.8}
              onPress={() => router.push(`/service/add?itemId=${item.id}` as any)}
            >
              <MaterialIcons name="add" size={14} color={SereneColors.primary} />
              <Text className="text-[11px] font-semibold text-serene-primary">Add Service</Text>
            </TouchableOpacity>
          </View>

          {sortedMaintenanceRecords.length > 0 ? (
            <View className="gap-2.5">
              {sortedMaintenanceRecords.length > 1 && (
                <View className="flex-row items-center justify-between pt-0.5">
                  <Text className="text-[11px] font-medium text-serene-on-surface-variant">
                    Service & Repair History
                  </Text>
                  <TouchableOpacity
                    className="flex-row items-center gap-1 px-2.5 py-1 rounded-full bg-serene-surface-container-low border border-serene-subtle-border"
                    activeOpacity={0.7}
                    onPress={() =>
                      setMaintenanceSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))
                    }
                  >
                    <MaterialIcons name="sort" size={13} color={SereneColors.primary} />
                    <Text className="text-[10px] font-semibold text-serene-primary">
                      {maintenanceSortOrder === 'newest' ? 'Newest First' : 'Oldest First'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {sortedMaintenanceRecords.map((record) => {
                const isWarrantyCovered = record.warrantyCovered === 'yes';
                const isWarrantyUnknown = record.warrantyCovered === 'unknown';
                const currencySymbol = record.currency === 'INR' || item.currency === 'INR' ? '₹' : '$';
                const effectiveCost = record.amountPaid ?? record.cost ?? 0;

                return (
                  <TouchableOpacity
                    key={record.id}
                    className="p-3 rounded-serene-lg bg-[rgba(246,243,235,0.65)] border border-serene-subtle-border/70 gap-2"
                    activeOpacity={0.85}
                    onPress={() => router.push(`/service/${record.id}` as any)}
                  >
                    <View className="flex-row items-start justify-between gap-2">
                      <View className="flex-1">
                        <View className="flex-row items-center gap-1.5 flex-wrap">
                          <View className="bg-serene-primary/10 px-2 py-0.5 rounded-full">
                            <Text className="text-[10px] font-bold text-serene-primary">
                              {record.serviceType || 'Service'}
                            </Text>
                          </View>
                          {isWarrantyCovered ? (
                            <View className="bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                              <Text className="text-[10px] font-bold text-emerald-700">
                                Warranty Covered
                              </Text>
                            </View>
                          ) : isWarrantyUnknown ? (
                            <View className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              <Text className="text-[10px] font-bold text-amber-700">
                                Coverage Unknown
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        <Text
                          className="text-[14px] font-bold text-serene-on-surface mt-1.5"
                          numberOfLines={1}
                        >
                          {record.title}
                        </Text>

                        {record.serviceProvider ? (
                          <Text
                            className="text-[11px] text-serene-on-surface-variant mt-0.5"
                            numberOfLines={1}
                          >
                            Provider: {record.serviceProvider}
                          </Text>
                        ) : null}
                      </View>

                      <View className="items-end">
                        <Text className="text-[11px] text-serene-on-surface-variant">
                          {formatDate(record.serviceDate, 'medium') || record.serviceDate}
                        </Text>
                        <Text className="text-[13px] font-bold text-serene-primary mt-1">
                          {isWarrantyCovered && effectiveCost === 0
                            ? `${currencySymbol}0`
                            : formatCurrency(effectiveCost, currencySymbol)}
                        </Text>
                      </View>
                    </View>

                    {(record.workPerformed || record.problemDescription) && (
                      <Text
                        className="text-[12px] text-serene-on-surface-variant line-clamp-2"
                        numberOfLines={2}
                      >
                        {record.workPerformed || record.problemDescription}
                      </Text>
                    )}

                    {record.partsReplaced && (
                      <View className="flex-row items-center gap-1 mt-0.5">
                        <MaterialIcons name="extension" size={12} color={SereneColors.outline} />
                        <Text
                          className="text-[11px] text-serene-on-surface-variant italic flex-1"
                          numberOfLines={1}
                        >
                          Parts: {record.partsReplaced}
                        </Text>
                      </View>
                    )}

                    <View className="flex-row items-center justify-between pt-1 border-t border-serene-subtle-border/40">
                      <View className="flex-row items-center gap-1.5">
                        {record.postServiceWarranty && record.postServiceWarrantyUntil && (
                          <Text className="text-[10px] font-semibold text-emerald-700">
                            🛡️ Warranty: {formatDate(record.postServiceWarrantyUntil, 'medium')}
                          </Text>
                        )}
                        {record.postServiceGuarantee && record.postServiceGuaranteeUntil && (
                          <Text className="text-[10px] font-semibold text-blue-700">
                            ✓ Guarantee: {formatDate(record.postServiceGuaranteeUntil, 'medium')}
                          </Text>
                        )}
                        {!record.postServiceWarranty &&
                          !record.postServiceGuarantee &&
                          record.documentIds &&
                          record.documentIds.length > 0 && (
                            <Text className="text-[10px] text-serene-outline">
                              📎 {record.documentIds.length} attached doc
                              {record.documentIds.length > 1 ? 's' : ''}
                            </Text>
                          )}
                      </View>
                      <MaterialIcons name="chevron-right" size={16} color={SereneColors.outline} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View className="bg-serene-surface-container-low p-4 rounded-serene-md items-center gap-1.5">
              <MaterialIcons name="build-circle" size={24} color={SereneColors.outline} />
              <Text className="text-[12px] text-serene-on-surface-variant text-center">
                No service or repair history yet.
              </Text>
              <TouchableOpacity
                className="mt-1 bg-serene-surface-container-high px-3 py-1 rounded-full flex-row items-center gap-1"
                onPress={() => router.push(`/service/add?itemId=${item.id}` as any)}
              >
                <MaterialIcons name="add" size={14} color={SereneColors.primary} />
                <Text className="text-[11px] font-semibold text-serene-primary">
                  Add Service or Repair
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {item.notes ? (
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-serene-md border border-serene-subtle-border shadow-sm gap-2">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="notes" size={18} color={SereneColors.primary} />
              <Text className="text-[15px] font-bold text-serene-on-surface">Notes</Text>
            </View>
            <Text className="text-[13px] text-serene-on-surface-variant leading-5">
              {item.notes}
            </Text>
          </View>
        ) : null}

        <View className="flex-row gap-3 pt-2">
          <TouchableOpacity
            className="flex-1 h-12 rounded-serene-lg bg-serene-primary flex-row items-center justify-center gap-2 shadow-sm"
            activeOpacity={0.88}
            onPress={() => router.push(`/(tabs)/add?editId=${item.id}` as any)}
          >
            <MaterialIcons name="edit" size={18} color="#FFFFFF" />
            <Text className="text-[14px] font-semibold text-white">Edit Item</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="h-12 px-4 rounded-serene-lg bg-red-50 border border-red-200 flex-row items-center justify-center gap-1.5"
            activeOpacity={0.88}
            onPress={handleDelete}
          >
            <MaterialIcons name="delete" size={18} color={SereneColors.error} />
            <Text className="text-[14px] font-semibold text-serene-error">Delete</Text>
          </TouchableOpacity>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-2 mt-1">
          <View className="flex-row items-center gap-1.5">
            <MaterialIcons name="swap-horiz" size={18} color="#4F46E5" />
            <Text className="text-[14px] font-bold text-serene-on-surface">Classification Actions</Text>
          </View>
          <Text className="text-[12px] text-serene-on-surface-variant leading-relaxed">
            If this was scanned as a Purchased Item by mistake (e.g. warranty certificate, insurance paper, or fee receipt), you can convert it to a Document.
          </Text>
          <TouchableOpacity
            className="w-full h-11 rounded-serene-lg bg-indigo-50 border border-indigo-200 flex-row items-center justify-center gap-2 mt-1"
            activeOpacity={0.85}
            disabled={isConverting}
            onPress={handleReclassifyAsDocument}
          >
            {isConverting ? (
              <ActivityIndicator size="small" color="#4F46E5" />
            ) : (
              <>
                <MaterialIcons name="description" size={17} color="#4338CA" />
                <Text className="text-[13px] font-semibold text-indigo-700">
                  Convert to Standalone Document
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(previewModal)}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setPreviewModal(null)}
      >
        <View className="flex-1 bg-black justify-between">
          <View className="pt-12 px-4 flex-row items-center justify-between">
            <Text className="text-white text-[15px] font-semibold" numberOfLines={1}>
              {previewModal?.title || 'Preview'}
            </Text>
            <TouchableOpacity
              className="w-10 h-10 rounded-full bg-white/20 items-center justify-center"
              onPress={() => setPreviewModal(null)}
            >
              <MaterialIcons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View className="flex-1 items-center justify-center p-4">
            {previewModal?.uri ? (
              <Image
                source={{ uri: previewModal.uri }}
                className="w-full h-full"
                resizeMode="contain"
              />
            ) : (
              <Text className="text-white">Image preview unavailable</Text>
            )}
          </View>

          <View className="pb-10 px-4 items-center">
            <TouchableOpacity
              className="bg-white/20 px-6 py-2.5 rounded-full"
              onPress={() => setPreviewModal(null)}
            >
              <Text className="text-white font-semibold text-[13px]">Close Preview</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
