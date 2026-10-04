
import React, { useState, useEffect } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Header } from '../../src/components/ui/Header';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { formatCurrency, formatDate } from '../../src/utils/currency';
import {
  DOCUMENT_CATEGORIES,
  getDocumentCategoryConfig,
  getDocumentTypeConfig,
} from '../../src/constants/documentCategories';
import {
  safeNormalizeRouteUri,
  getCanonicalDocumentUri,
  verifyDocumentFileExists,
} from '../../src/services/receiptFileService';
import {
  createPrivateSignedUrl,
  BUCKET_VAULT_DOCUMENTS,
} from '../../src/services/storageService';
import * as FileSystem from 'expo-file-system/legacy';

export default function DocumentDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const getDocumentById = useItemStore((s) => s.getDocumentById);
  const deleteDocument = useItemStore((s) => s.deleteDocument);
  const getItemById = useItemStore((s) => s.getItemById);
  const updateDocument = useItemStore((s) => s.updateDocument);
  const convertDocumentToItem = useItemStore((s) => s.convertDocumentToItem);
  const items = useItemStore((s) => s.items);

  const doc = getDocumentById(id);
  const linkedItem = doc?.itemId ? getItemById(doc.itemId) : null;

  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [fileExists, setFileExists] = useState<boolean | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

  const [photo1Url, setPhoto1Url] = useState<string | null>(null);
  const [photo2Url, setPhoto2Url] = useState<string | null>(null);
  const [activePhotoTab, setActivePhotoTab] = useState<'front' | 'back'>('front');

  // Load photos (local or private Supabase signed URL)
  useEffect(() => {
    let isMounted = true;

    async function resolvePhotos() {
      if (!doc) return;

      let raw1 = doc.filePath ? getCanonicalDocumentUri(doc.filePath) : null;
      let norm1 = raw1 ? safeNormalizeRouteUri(raw1) : null;
      let p1Exists = norm1 ? await verifyDocumentFileExists(norm1) : false;

      if (p1Exists && norm1) {
        if (isMounted) {
          setPhoto1Url(norm1);
          setFileExists(true);
          try {
            const info = await FileSystem.getInfoAsync(norm1);
            if (info.exists && typeof info.size === 'number') {
              setFileSize(info.size);
            }
          } catch {
          }
        }
      } else if (doc.storagePath && !doc.storagePath.startsWith('file:')) {
        const signed = await createPrivateSignedUrl(BUCKET_VAULT_DOCUMENTS, doc.storagePath);
        if (isMounted && signed) {
          setPhoto1Url(signed);
          setFileExists(true);
        }
      } else if (doc.fileUrl && (doc.fileUrl.startsWith('http://') || doc.fileUrl.startsWith('https://'))) {
        if (isMounted) {
          setPhoto1Url(doc.fileUrl);
          setFileExists(true);
        }
      } else {
        if (isMounted) setFileExists(false);
      }

      let raw2 = doc.filePathBack ? getCanonicalDocumentUri(doc.filePathBack) : null;
      let norm2 = raw2 ? safeNormalizeRouteUri(raw2) : null;
      let p2Exists = norm2 ? await verifyDocumentFileExists(norm2) : false;

      if (p2Exists && norm2) {
        if (isMounted) setPhoto2Url(norm2);
      } else if (doc.storagePathBack && !doc.storagePathBack.startsWith('file:')) {
        const signed2 = await createPrivateSignedUrl(BUCKET_VAULT_DOCUMENTS, doc.storagePathBack);
        if (isMounted && signed2) setPhoto2Url(signed2);
      } else if (doc.fileUrlBack && (doc.fileUrlBack.startsWith('http://') || doc.fileUrlBack.startsWith('https://'))) {
        if (isMounted) setPhoto2Url(doc.fileUrlBack);
      }
    }

    resolvePhotos();

    return () => {
      isMounted = false;
    };
  }, [doc?.id, doc?.filePath, doc?.filePathBack, doc?.storagePath, doc?.storagePathBack]);

  if (!doc) {
    return (
      <View className="flex-1 bg-serene-background items-center justify-center p-6">
        <View className="bg-serene-surface-container-lowest p-6 rounded-serene-2xl border border-serene-subtle-border items-center max-w-[320px] w-full shadow-sm">
          <View className="w-12 h-12 rounded-full bg-serene-surface-container-high items-center justify-center mb-3">
            <MaterialIcons name="description" size={24} color={SereneColors.outline} />
          </View>
          <Text className="text-[16px] font-bold text-serene-on-surface mb-1">
            Document Not Found
          </Text>
          <Text className="text-[12px] text-serene-on-surface-variant text-center mb-4">
            This document may have been removed or moved to another vault.
          </Text>
          <TouchableOpacity
            className="bg-serene-primary px-5 py-2.5 rounded-full"
            activeOpacity={0.88}
            onPress={() => router.replace('/(tabs)/documents')}
          >
            <Text className="text-[13px] font-semibold text-white">Back to Documents</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const catConfig = getDocumentCategoryConfig(doc.category);
  const typeConfig = getDocumentTypeConfig(doc.category, doc.documentType);

  let expiryStatus: 'none' | 'active' | 'expiring_soon' | 'expired' = 'none';
  let expiryDaysText = '';
  if (doc.expiryDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(doc.expiryDate);
    expDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      expiryStatus = 'expired';
      expiryDaysText = `Expired ${Math.abs(diffDays)}d ago`;
    } else if (diffDays <= 30) {
      expiryStatus = 'expiring_soon';
      expiryDaysText = diffDays === 0 ? 'Expires today' : `Expires in ${diffDays}d`;
    } else {
      expiryStatus = 'active';
      expiryDaysText = `Valid for ${diffDays}d`;
    }
  }

  // Payment Due Date status calculation (Semantically distinct from expiry)
  let dueStatus: 'none' | 'due_soon' | 'due_today' | 'overdue' | 'future' = 'none';
  let dueDaysText = '';
  if (doc.dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dDate = new Date(doc.dueDate);
    dDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((dDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      dueStatus = 'overdue';
      dueDaysText = `Overdue by ${Math.abs(diffDays)}d`;
    } else if (diffDays === 0) {
      dueStatus = 'due_today';
      dueDaysText = 'Due today';
    } else if (diffDays <= 7) {
      dueStatus = 'due_soon';
      dueDaysText = `Due in ${diffDays}d`;
    } else {
      dueStatus = 'future';
      dueDaysText = `Due in ${diffDays}d`;
    }
  }

  const handleDelete = () => {
    Alert.alert(
      'Delete Document',
      `Are you sure you want to delete "${doc.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await deleteDocument(doc.id);
              router.replace('/(tabs)/documents');
            } catch (err) {
              Alert.alert('Error', 'Failed to delete document. Please try again.');
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleShare = async () => {
    try {
      const shareText = `Document: ${doc.title}\nCategory: ${catConfig.name}\nType: ${typeConfig.name}${
        doc.issuerName ? `\nIssuer: ${doc.issuerName}` : ''
      }${doc.referenceNumber ? `\nReference #: ${doc.referenceNumber}` : ''}${
        doc.expiryDate ? `\nExpires: ${doc.expiryDate}` : ''
      }`;
      await Share.share({
        message: shareText,
        url: photo1Url || undefined,
        title: doc.title,
      });
    } catch (err) {
    }
  };

  const handleUnlinkItem = () => {
    Alert.alert(
      'Unlink Purchased Item',
      `Do you want to unlink "${linkedItem?.name || 'Item'}" from this document? The document will remain preserved as a standalone document in your vault.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          onPress: async () => {
            await updateDocument(doc.id, { itemId: null });
          },
        },
      ]
    );
  };

  const handleLinkItem = async (targetItemId: string) => {
    setShowLinkModal(false);
    await updateDocument(doc.id, { itemId: targetItemId });
  };

  const handleReclassifyAsItem = () => {
    Alert.alert(
      'Convert to Purchased Item?',
      'This document will be reclassified as a Purchased Item in your vault and moved from Documents to Items, while preserving the proof file and dates.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Convert to Item',
          onPress: async () => {
            setIsConverting(true);
            try {
              const newItem = await convertDocumentToItem(doc.id);
              router.replace(`/item/${newItem.id}` as any);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to convert document to item');
              setIsConverting(false);
            }
          },
        },
      ]
    );
  };

  const isPdf =
    doc.mimeType?.includes('pdf') ||
    photo1Url?.toLowerCase().endsWith('.pdf') ||
    doc.filePath?.toLowerCase().endsWith('.pdf');

  return (
    <View className="flex-1 bg-serene-background">
      <Header
        title="Document Details"
        showBack
        rightAction={
          <View className="flex-row items-center gap-1.5">
            <TouchableOpacity
              onPress={handleShare}
              className="w-9 h-9 rounded-full bg-serene-surface-container-high items-center justify-center"
              activeOpacity={0.7}
              accessibilityLabel="Share document"
            >
              <MaterialIcons name="share" size={18} color={SereneColors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push(`/document/add?editId=${doc.id}` as any)}
              className="w-9 h-9 rounded-full bg-serene-surface-container-high items-center justify-center"
              activeOpacity={0.7}
              accessibilityLabel="Edit document"
            >
              <MaterialIcons name="edit" size={17} color={SereneColors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleDelete}
              className="w-9 h-9 rounded-full bg-serene-surface-container-high items-center justify-center"
              activeOpacity={0.7}
              disabled={isDeleting}
              accessibilityLabel="Delete document"
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color={SereneColors.error} />
              ) : (
                <MaterialIcons name="delete-outline" size={18} color={SereneColors.error} />
              )}
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView
        contentContainerClassName="p-4 pb-20 gap-4"
        showsVerticalScrollIndicator={false}
      >
        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-3">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-3">
              <View className="flex-row items-center gap-1.5 mb-1.5 flex-wrap">
                <View className="flex-row items-center gap-1 bg-serene-surface-container-high px-2 py-0.5 rounded-full">
                  <MaterialIcons
                    name={catConfig.icon as any}
                    size={12}
                    color={SereneColors.primary}
                  />
                  <Text className="text-[10px] font-semibold text-serene-primary">
                    {catConfig.name}
                  </Text>
                </View>

                <View className="bg-serene-surface-container px-2 py-0.5 rounded-full">
                  <Text className="text-[10px] font-medium text-serene-on-surface-variant">
                    {typeConfig.name}
                  </Text>
                </View>
              </View>

              <Text className="text-[18px] font-bold text-serene-on-surface leading-tight">
                {doc.title}
              </Text>

              {doc.issuerName ? (
                <Text className="text-[13px] text-serene-on-surface-variant font-medium mt-1">
                  Issued by {doc.issuerName}
                </Text>
              ) : null}
            </View>

            {doc.amount !== undefined && doc.amount !== null ? (
              <View className="items-end bg-serene-surface-container-low px-3 py-1.5 rounded-serene-md border border-serene-subtle-border">
                <Text className="text-[10px] text-serene-on-surface-variant uppercase font-medium">
                  Amount
                </Text>
                <Text className="text-[16px] font-bold text-serene-primary">
                  {formatCurrency(doc.amount, doc.currency === 'INR' ? '₹' : '$')}
                </Text>
              </View>
            ) : null}
          </View>

          {doc.dueDate ? (
            <View
              className={`flex-row items-center justify-between p-2.5 rounded-serene-md border ${
                dueStatus === 'overdue'
                  ? 'bg-red-50 border-red-200'
                  : dueStatus === 'due_today' || dueStatus === 'due_soon'
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-emerald-50 border-emerald-200'
              }`}
            >
              <View className="flex-row items-center gap-1.5">
                <MaterialIcons
                  name={dueStatus === 'overdue' ? 'warning' : 'schedule'}
                  size={16}
                  color={
                    dueStatus === 'overdue'
                      ? '#DC2626'
                      : dueStatus === 'due_today' || dueStatus === 'due_soon'
                      ? '#D97706'
                      : '#059669'
                  }
                />
                <Text
                  className={`text-[12px] font-bold ${
                    dueStatus === 'overdue'
                      ? 'text-red-700'
                      : dueStatus === 'due_today' || dueStatus === 'due_soon'
                      ? 'text-amber-800'
                      : 'text-emerald-700'
                  }`}
                >
                  Payment Due: {formatDate(doc.dueDate, 'medium')}
                </Text>
              </View>

              <View
                className={`px-2 py-0.5 rounded-full ${
                  dueStatus === 'overdue'
                    ? 'bg-red-100'
                    : dueStatus === 'due_today' || dueStatus === 'due_soon'
                    ? 'bg-amber-100'
                    : 'bg-emerald-100'
                }`}
              >
                <Text
                  className={`text-[10px] font-semibold ${
                    dueStatus === 'overdue'
                      ? 'text-red-700'
                      : dueStatus === 'due_today' || dueStatus === 'due_soon'
                      ? 'text-amber-800'
                      : 'text-emerald-700'
                  }`}
                >
                  {dueDaysText}
                </Text>
              </View>
            </View>
          ) : null}

          {doc.expiryDate ? (
            <View
              className={`flex-row items-center justify-between p-2.5 rounded-serene-md border ${
                expiryStatus === 'expired'
                  ? 'bg-red-50 border-red-200'
                  : expiryStatus === 'expiring_soon'
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-emerald-50 border-emerald-200'
              }`}
            >
              <View className="flex-row items-center gap-1.5">
                <MaterialIcons
                  name={
                    expiryStatus === 'expired'
                      ? 'warning'
                      : expiryStatus === 'expiring_soon'
                      ? 'schedule'
                      : 'verified'
                  }
                  size={16}
                  color={
                    expiryStatus === 'expired'
                      ? '#DC2626'
                      : expiryStatus === 'expiring_soon'
                      ? '#D97706'
                      : '#059669'
                  }
                />
                <Text
                  className={`text-[12px] font-bold ${
                    expiryStatus === 'expired'
                      ? 'text-red-700'
                      : expiryStatus === 'expiring_soon'
                      ? 'text-amber-800'
                      : 'text-emerald-700'
                  }`}
                >
                  Expires: {formatDate(doc.expiryDate, 'medium')}
                </Text>
              </View>

              <View
                className={`px-2 py-0.5 rounded-full ${
                  expiryStatus === 'expired'
                    ? 'bg-red-100'
                    : expiryStatus === 'expiring_soon'
                    ? 'bg-amber-100'
                    : 'bg-emerald-100'
                }`}
              >
                <Text
                  className={`text-[10px] font-semibold ${
                    expiryStatus === 'expired'
                      ? 'text-red-700'
                      : expiryStatus === 'expiring_soon'
                      ? 'text-amber-800'
                      : 'text-emerald-700'
                  }`}
                >
                  {expiryDaysText}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="attachment" size={18} color={SereneColors.primary} />
              <Text className="text-[14px] font-bold text-serene-on-surface">Document Photos</Text>
            </View>

            {photo1Url ? (
              <View className="flex-row items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full">
                <MaterialIcons name="check-circle" size={12} color="#059669" />
                <Text className="text-[10px] font-semibold text-emerald-700">Verified</Text>
              </View>
            ) : fileExists === false ? (
              <View className="flex-row items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-full">
                <MaterialIcons name="error-outline" size={12} color="#D97706" />
                <Text className="text-[10px] font-semibold text-amber-700">No Image</Text>
              </View>
            ) : (
              <ActivityIndicator size="small" color={SereneColors.primary} />
            )}
          </View>

          {photo2Url && (
            <View className="flex-row bg-serene-surface-container-low p-1 rounded-serene-md border border-serene-subtle-border">
              <TouchableOpacity
                className={`flex-1 py-1.5 items-center justify-center rounded-serene-sm ${
                  activePhotoTab === 'front' ? 'bg-serene-primary shadow-xs' : ''
                }`}
                onPress={() => setActivePhotoTab('front')}
              >
                <Text
                  className={`text-[12px] font-semibold ${
                    activePhotoTab === 'front' ? 'text-white' : 'text-serene-on-surface-variant'
                  }`}
                >
                  Photo 1 (Front)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                className={`flex-1 py-1.5 items-center justify-center rounded-serene-sm ${
                  activePhotoTab === 'back' ? 'bg-serene-primary shadow-xs' : ''
                }`}
                onPress={() => setActivePhotoTab('back')}
              >
                <Text
                  className={`text-[12px] font-semibold ${
                    activePhotoTab === 'back' ? 'text-white' : 'text-serene-on-surface-variant'
                  }`}
                >
                  Photo 2 (Back)
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {(activePhotoTab === 'back' ? photo2Url : photo1Url) ? (
            <TouchableOpacity
              className="w-full h-56 rounded-serene-lg overflow-hidden border border-serene-subtle-border relative bg-serene-surface-container-low"
              activeOpacity={0.9}
              onPress={() => setPreviewModalVisible(true)}
            >
              {isPdf && activePhotoTab === 'front' ? (
                <View className="w-full h-full items-center justify-center bg-serene-surface-container-low p-4">
                  <MaterialIcons name="picture-as-pdf" size={54} color={SereneColors.error} />
                  <Text className="text-[13px] font-mono text-serene-on-surface mt-2 font-semibold">
                    {doc.title}.pdf
                  </Text>
                  <Text className="text-[11px] text-serene-on-surface-variant mt-1">
                    Tap to view document
                  </Text>
                </View>
              ) : (
                <Image
                  source={{ uri: (activePhotoTab === 'back' ? photo2Url : photo1Url)! }}
                  style={{ width: '100%', height: '100%' }}
                  className="w-full h-full"
                  resizeMode="contain"
                />
              )}
              <View className="absolute bottom-2 right-2 bg-black/75 px-3 py-1 rounded-full flex-row items-center gap-1">
                <MaterialIcons name="zoom-in" size={14} color="#FFFFFF" />
                <Text className="text-[11px] font-medium text-white">Full Screen</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <View className="p-6 rounded-serene-lg bg-serene-surface-container-low items-center justify-center gap-2">
              <MaterialIcons name="insert-drive-file" size={36} color={SereneColors.outline} />
              <Text className="text-[12px] text-serene-on-surface-variant text-center">
                This document was created as a metadata record without a direct image file.
              </Text>
            </View>
          )}

          <View className="flex-row items-center justify-between pt-1">
            <Text className="text-[11px] text-serene-on-surface-variant font-mono">
              {fileSize ? `${(fileSize / 1024).toFixed(0)} KB · ` : ''}
              {activePhotoTab === 'back' ? 'Back side' : (doc.mimeType || 'Document')}
            </Text>

            {(activePhotoTab === 'back' ? photo2Url : photo1Url) && (
              <TouchableOpacity
                className="bg-serene-surface-container-high px-3.5 py-1.5 rounded-serene-md flex-row items-center gap-1"
                onPress={() => setPreviewModalVisible(true)}
              >
                <MaterialIcons name="fullscreen" size={16} color={SereneColors.primary} />
                <Text className="text-[12px] font-semibold text-serene-primary">Open Full Doc</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-2.5">
          <Text className="text-[14px] font-bold text-serene-on-surface mb-0.5">
            Document Information
          </Text>

          <View className="bg-serene-surface-container-low rounded-serene-lg p-3 gap-2">
            <View className="flex-row justify-between py-0.5">
              <Text className="text-[12px] text-serene-on-surface-variant">Document Date</Text>
              <Text className="text-[13px] font-medium text-serene-on-surface">
                {doc.documentDate ? formatDate(doc.documentDate, 'medium') : 'Not specified'}
              </Text>
            </View>

            {doc.issuerName ? (
              <View className="flex-row justify-between py-0.5">
                <Text className="text-[12px] text-serene-on-surface-variant">Issuer / Authority</Text>
                <Text className="text-[13px] font-medium text-serene-on-surface">
                  {doc.issuerName}
                </Text>
              </View>
            ) : null}

            {doc.referenceNumber ? (
              <View className="flex-row justify-between py-0.5">
                <Text className="text-[12px] text-serene-on-surface-variant">
                  Reference / Policy / Bill #
                </Text>
                <Text className="text-[13px] font-mono font-bold text-serene-on-surface">
                  {doc.referenceNumber}
                </Text>
              </View>
            ) : null}

            {doc.dueDate ? (
              <View className="flex-row justify-between py-0.5">
                <Text className="text-[12px] text-serene-on-surface-variant">Payment Due Date</Text>
                <Text className="text-[13px] font-semibold text-serene-on-surface">
                  {formatDate(doc.dueDate, 'medium')}
                </Text>
              </View>
            ) : null}

            {doc.expiryDate ? (
              <View className="flex-row justify-between py-0.5">
                <Text className="text-[12px] text-serene-on-surface-variant">Expiry Date</Text>
                <Text className="text-[13px] font-semibold text-serene-on-surface">
                  {formatDate(doc.expiryDate, 'medium')}
                </Text>
              </View>
            ) : null}

            {(doc.expiryDate || doc.dueDate) ? (
              <View className="flex-row justify-between py-0.5 border-t border-serene-subtle-border/40 pt-1.5">
                <Text className="text-[12px] text-serene-on-surface-variant">Smart Reminders</Text>
                <Text className="text-[12px] font-semibold text-emerald-700">
                  {doc.dueDate
                    ? 'Active (7d & 1d before due)'
                    : doc.category === 'Warranty & Guarantee'
                    ? 'Active (1mo & 1w before expiry)'
                    : 'Active (1w before expiry)'}
                </Text>
              </View>
            ) : null}

            <View className="flex-row justify-between py-0.5">
              <Text className="text-[12px] text-serene-on-surface-variant">Added to Vault</Text>
              <Text className="text-[12px] text-serene-outline font-mono">
                {formatDate(doc.createdAt, 'short')}
              </Text>
            </View>
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-2.5">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <MaterialIcons name="link" size={18} color={SereneColors.primary} />
              <Text className="text-[14px] font-bold text-serene-on-surface">
                Related Item in Vault
              </Text>
            </View>
            {linkedItem ? (
              <View className="flex-row items-center gap-1.5">
                <View className="bg-blue-50 px-2 py-0.5 rounded-full">
                  <Text className="text-[10px] font-semibold text-blue-700">Linked</Text>
                </View>
                <TouchableOpacity
                  onPress={handleUnlinkItem}
                  className="bg-red-50 border border-red-200 px-2 py-0.5 rounded-full flex-row items-center gap-0.5"
                >
                  <MaterialIcons name="link-off" size={11} color="#DC2626" />
                  <Text className="text-[10px] font-semibold text-red-700">Unlink</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="bg-serene-surface-container px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-medium text-serene-on-surface-variant">
                  Standalone
                </Text>
              </View>
            )}
          </View>

          {linkedItem ? (
            <TouchableOpacity
              className="bg-serene-surface-container-low rounded-serene-lg p-3 flex-row items-center justify-between border border-serene-subtle-border"
              activeOpacity={0.85}
              onPress={() => router.push(`/item/${linkedItem.id}` as any)}
            >
              <View className="flex-1 mr-2">
                <Text className="text-[14px] font-semibold text-serene-on-surface" numberOfLines={1}>
                  {linkedItem.name}
                </Text>
                <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">
                  {linkedItem.merchant || 'Purchased Item'} ·{' '}
                  {formatCurrency(linkedItem.purchasePrice, linkedItem.currency === 'INR' ? '₹' : '$')}
                </Text>
              </View>
              <View className="flex-row items-center gap-1 bg-serene-primary/10 px-2.5 py-1 rounded-full">
                <Text className="text-[11px] font-semibold text-serene-primary">View Item</Text>
                <MaterialIcons name="chevron-right" size={16} color={SereneColors.primary} />
              </View>
            </TouchableOpacity>
          ) : (
            <View className="bg-serene-surface-container-low p-3 rounded-serene-lg gap-2">
              <Text className="text-[12px] text-serene-on-surface-variant leading-relaxed">
                This is a standalone document (e.g. warranty card, insurance, bill). It is preserved
                securely without being counted as an Item. You can optionally link it to a purchased item.
              </Text>
              <TouchableOpacity
                className="bg-serene-primary/10 border border-serene-primary/20 py-2 px-3 rounded-serene-md flex-row items-center justify-center gap-1.5 self-start mt-0.5"
                activeOpacity={0.85}
                onPress={() => setShowLinkModal(true)}
              >
                <MaterialIcons name="add-link" size={16} color={SereneColors.primary} />
                <Text className="text-[12px] font-semibold text-serene-primary">Link to Purchased Item</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Document Actions Card */}
        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-3">
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="touch-app" size={18} color={SereneColors.primary} />
            <Text className="text-[14px] font-bold text-serene-on-surface">Document Actions</Text>
          </View>

          <View className="flex-row items-center gap-2.5">
            <TouchableOpacity
              className="flex-1 h-11 rounded-serene-lg bg-serene-surface-container-low border border-serene-subtle-border flex-row items-center justify-center gap-1.5"
              activeOpacity={0.8}
              onPress={() => router.push(`/document/add?editId=${doc.id}` as any)}
            >
              <MaterialIcons name="edit" size={16} color={SereneColors.primary} />
              <Text className="text-[13px] font-semibold text-serene-primary">Edit Details</Text>
            </TouchableOpacity>

            {linkedItem ? (
              <TouchableOpacity
                className="flex-1 h-11 rounded-serene-lg bg-serene-surface-container-low border border-serene-subtle-border flex-row items-center justify-center gap-1.5"
                activeOpacity={0.8}
                onPress={() => router.push(`/service/add?itemId=${linkedItem.id}` as any)}
              >
                <MaterialIcons name="build" size={16} color={SereneColors.primary} />
                <Text className="text-[13px] font-semibold text-serene-primary">Add Service</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                className="flex-1 h-11 rounded-serene-lg bg-serene-surface-container-low border border-serene-subtle-border flex-row items-center justify-center gap-1.5"
                activeOpacity={0.8}
                onPress={() => setShowLinkModal(true)}
              >
                <MaterialIcons name="link" size={16} color={SereneColors.primary} />
                <Text className="text-[13px] font-semibold text-serene-primary">Link to Item</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-2">
          <View className="flex-row items-center gap-1.5">
            <MaterialIcons name="swap-horiz" size={18} color="#4F46E5" />
            <Text className="text-[14px] font-bold text-serene-on-surface">Classification Actions</Text>
          </View>
          <Text className="text-[12px] text-serene-on-surface-variant leading-relaxed">
            If this file was categorized as a Document by mistake, you can convert it to a Purchased Item. It will be moved to your Items catalog.
          </Text>
          <TouchableOpacity
            className="w-full h-11 rounded-serene-lg bg-indigo-50 border border-indigo-200 flex-row items-center justify-center gap-2 mt-1"
            activeOpacity={0.85}
            disabled={isConverting}
            onPress={handleReclassifyAsItem}
          >
            {isConverting ? (
              <ActivityIndicator size="small" color="#4F46E5" />
            ) : (
              <>
                <MaterialIcons name="shopping-bag" size={17} color="#4338CA" />
                <Text className="text-[13px] font-semibold text-indigo-700">
                  Convert to Purchased Item
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {doc.notes ? (
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-2">
            <Text className="text-[14px] font-bold text-serene-on-surface">Notes</Text>
            <Text className="text-[13px] text-serene-on-surface-variant leading-relaxed">
              {doc.notes}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={previewModalVisible}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setPreviewModalVisible(false)}
      >
        <View className="flex-1 bg-black justify-between">
          <View className="pt-12 px-4 flex-row items-center justify-between">
            <Text className="text-white text-[15px] font-semibold flex-1 mr-3" numberOfLines={1}>
              {doc.title}
            </Text>
            <TouchableOpacity
              className="w-10 h-10 rounded-full bg-white/20 items-center justify-center"
              onPress={() => setPreviewModalVisible(false)}
            >
              <MaterialIcons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View className="flex-1 items-center justify-center p-4">
            {(activePhotoTab === 'back' ? photo2Url : photo1Url) ? (
              <Image
                source={{ uri: (activePhotoTab === 'back' ? photo2Url : photo1Url)! }}
                className="w-full h-full"
                resizeMode="contain"
              />
            ) : (
              <Text className="text-white">Document preview unavailable</Text>
            )}
          </View>

          {photo2Url && (
            <View className="flex-row justify-center gap-3 pb-4">
              <TouchableOpacity
                className={`px-4 py-1.5 rounded-full ${
                  activePhotoTab === 'front' ? 'bg-serene-primary' : 'bg-white/20'
                }`}
                onPress={() => setActivePhotoTab('front')}
              >
                <Text className="text-white text-xs font-semibold">Photo 1 (Front)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`px-4 py-1.5 rounded-full ${
                  activePhotoTab === 'back' ? 'bg-serene-primary' : 'bg-white/20'
                }`}
                onPress={() => setActivePhotoTab('back')}
              >
                <Text className="text-white text-xs font-semibold">Photo 2 (Back)</Text>
              </TouchableOpacity>
            </View>
          )}

          <View className="pb-10 px-4 items-center">
            <TouchableOpacity
              className="bg-white/20 px-6 py-2.5 rounded-full"
              onPress={() => setPreviewModalVisible(false)}
            >
              <Text className="text-white font-semibold text-[13px]">Close Viewer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showLinkModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLinkModal(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-serene-surface rounded-t-serene-2xl p-5 max-h-[80%] gap-4">
            <View className="flex-row items-center justify-between pb-2 border-b border-serene-subtle-border">
              <View>
                <Text className="text-[17px] font-bold text-serene-on-surface">Link to Purchased Item</Text>
                <Text className="text-[12px] text-serene-on-surface-variant">Select an item to connect with this document</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowLinkModal(false)}
                className="w-8 h-8 rounded-full bg-serene-surface-container-high items-center justify-center"
              >
                <MaterialIcons name="close" size={20} color={SereneColors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <ScrollView className="max-h-[350px]" showsVerticalScrollIndicator={false}>
              {items.length === 0 ? (
                <Text className="text-center py-6 text-serene-on-surface-variant text-[13px]">
                  No items found in your vault to link.
                </Text>
              ) : (
                <View className="gap-2">
                  {items.map((it) => (
                    <TouchableOpacity
                      key={it.id}
                      className="p-3 rounded-serene-lg border border-serene-subtle-border bg-serene-surface-container-lowest flex-row items-center justify-between"
                      activeOpacity={0.7}
                      onPress={() => handleLinkItem(it.id)}
                    >
                      <View className="flex-1 mr-2">
                        <Text className="text-[14px] font-bold text-serene-on-surface" numberOfLines={1}>
                          {it.name}
                        </Text>
                        <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">
                          {it.merchant || 'Store'} · ₹{(Number(it.purchasePrice) || 0).toLocaleString('en-IN')}
                        </Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={20} color={SereneColors.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
