
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Switch,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Header } from '../../src/components/ui/Header';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import {
  CanonicalDocumentCategory,
  CanonicalDocumentType,
} from '../../src/types';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TYPES_BY_CATEGORY,
  getDocumentCategoryConfig,
} from '../../src/constants/documentCategories';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  persistDocumentToVault,
  safeNormalizeRouteUri,
  verifyDocumentFileExists,
} from '../../src/services/receiptFileService';
import { scheduleDocumentReminder } from '../../src/services/notifications';
import { checkForDuplicateDocument } from '../../src/services/duplicateDocumentService';

export default function AddDocumentScreen() {
  const params = useLocalSearchParams<{
    linkedItemId?: string;
    linkedItemName?: string;
    prefillCategory?: string;
    prefillType?: string;
    prefillTitle?: string;
    prefillIssuer?: string;
    prefillReference?: string;
    prefillAmount?: string;
    prefillDate?: string;
    prefillExpiryDate?: string;
    prefillDueDate?: string;
    prefillCandidateItemId?: string;
    prefillCandidateItemName?: string;
    fileUri?: string;
    fileUriBack?: string;
    editId?: string;
  }>();

  const items = useItemStore((s) => s.items);
  const addDocument = useItemStore((s) => s.addDocument);
  const getDocumentById = useItemStore((s) => s.getDocumentById);
  const updateDocument = useItemStore((s) => s.updateDocument);

  const editDoc = params.editId ? getDocumentById(params.editId) : undefined;
  const isEditing = Boolean(editDoc);

  const [title, setTitle] = useState(editDoc?.title || params.prefillTitle || '');
  const [category, setCategory] = useState<CanonicalDocumentCategory>(
    (editDoc?.category as CanonicalDocumentCategory) ||
      (params.prefillCategory as CanonicalDocumentCategory) ||
      'Receipts & Invoices'
  );
  const [documentType, setDocumentType] = useState<CanonicalDocumentType>(
    (editDoc?.documentType as CanonicalDocumentType) ||
      (params.prefillType as CanonicalDocumentType) ||
      'Receipt'
  );

  const [documentDate, setDocumentDate] = useState(
    editDoc?.documentDate || params.prefillDate || new Date().toISOString().split('T')[0]
  );
  const [issuerName, setIssuerName] = useState(editDoc?.issuerName || params.prefillIssuer || '');
  const [referenceNumber, setReferenceNumber] = useState(
    editDoc?.referenceNumber || params.prefillReference || ''
  );
  const [amount, setAmount] = useState(
    editDoc?.amount != null ? String(editDoc.amount) : params.prefillAmount || ''
  );
  const [expiryDate, setExpiryDate] = useState(editDoc?.expiryDate || params.prefillExpiryDate || '');
  const [dueDate, setDueDate] = useState(editDoc?.dueDate || params.prefillDueDate || '');
  const [enableReminder, setEnableReminder] = useState(
    Boolean(
      editDoc?.expiryDate ||
        editDoc?.dueDate ||
        params.prefillExpiryDate ||
        params.prefillDueDate
    )
  );
  const [notes, setNotes] = useState(editDoc?.notes || '');

  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    editDoc?.itemId || params.linkedItemId || (params.prefillCandidateItemId || null)
  );
  const [candidateMatch, setCandidateMatch] = useState<{ id: string; name: string } | null>(
    params.prefillCandidateItemId && params.prefillCandidateItemName
      ? { id: params.prefillCandidateItemId, name: decodeURIComponent(params.prefillCandidateItemName) }
      : null
  );

  const [attachedFileUri, setAttachedFileUri] = useState<string | null>(
    editDoc?.filePath || (params.fileUri ? safeNormalizeRouteUri(params.fileUri) : null)
  );
  const [attachedFileName, setAttachedFileName] = useState<string | null>(
    params.fileUri ? 'Document_Photo_1.jpg' : editDoc ? 'Document_Photo_1.jpg' : null
  );
  const [attachedMimeType, setAttachedMimeType] = useState<string | null>(
    editDoc?.mimeType || 'image/jpeg'
  );

  const [attachedFileUriBack, setAttachedFileUriBack] = useState<string | null>(
    editDoc?.filePathBack || (params.fileUriBack ? safeNormalizeRouteUri(params.fileUriBack) : null)
  );
  const [attachedFileNameBack, setAttachedFileNameBack] = useState<string | null>(
    params.fileUriBack ? 'Document_Photo_2.jpg' : editDoc?.filePathBack ? 'Document_Photo_2.jpg' : null
  );
  const [attachedMimeTypeBack, setAttachedMimeTypeBack] = useState<string | null>('image/jpeg');

  const [isPersistingFile, setIsPersistingFile] = useState(false);
  const [fileVerified, setFileVerified] = useState(Boolean(editDoc?.filePath));

  const [showItemPicker, setShowItemPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string;
    photo?: string;
  }>({});

  useEffect(() => {
    const validTypes = DOCUMENT_TYPES_BY_CATEGORY[category] || [];
    if (!validTypes.some((t) => t.type === documentType)) {
      if (validTypes.length > 0) {
        setDocumentType(validTypes[0].type);
      }
    }
  }, [category]);

  const handleAttachUri = async (
    uri: string,
    fileName: string,
    mimeType: string,
    base64?: string | null,
    isBackSide = false
  ) => {
    try {
      setIsPersistingFile(true);
      if (isBackSide) {
        setAttachedFileUriBack(uri);
        setAttachedFileNameBack(fileName);
        setAttachedMimeTypeBack(mimeType);
      } else {
        setAttachedFileUri(uri);
        setAttachedFileName(fileName);
        setAttachedMimeType(mimeType);
        if (fieldErrors.photo) {
          setFieldErrors((prev) => ({ ...prev, photo: undefined }));
        }
      }

      const persistRes = await persistDocumentToVault(uri, fileName, base64 || null);
      if (persistRes.persisted && persistRes.uri) {
        const verified = await verifyDocumentFileExists(persistRes.uri);
        if (isBackSide) {
          setAttachedFileUriBack(persistRes.uri);
        } else {
          setAttachedFileUri(persistRes.uri);
          setFileVerified(verified);
        }
      }
    } catch (err) {
      console.warn('[AddDoc] File persist warning:', err);
    } finally {
      setIsPersistingFile(false);
    }
  };

  useEffect(() => {
    if (params.fileUri) {
      handleAttachUri(params.fileUri, 'ScannedDocument.jpg', 'image/jpeg', null, false);
    }
    if (params.fileUriBack) {
      handleAttachUri(params.fileUriBack, 'ScannedDocument_Back.jpg', 'image/jpeg', null, true);
    }
  }, [params.fileUri, params.fileUriBack]);

  const handleCaptureCamera = async (isBackSide = false) => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera Permission', 'Camera access is required to capture documents.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        const asset = res.assets[0];
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `Doc_${category}_${isBackSide ? 'Back' : 'Front'}_${dateStr}.jpg`;
        await handleAttachUri(asset.uri, fileName, asset.mimeType || 'image/jpeg', asset.base64, isBackSide);
      }
    } catch (err) {
      console.warn('Document camera error:', err);
    }
  };

  const handlePickGallery = async (isBackSide = false) => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Gallery Permission', 'Gallery access is required to select document photos.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        const asset = res.assets[0];
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = asset.fileName || `Doc_${category}_${isBackSide ? 'Back' : 'Front'}_${dateStr}.jpg`;
        await handleAttachUri(asset.uri, fileName, asset.mimeType || 'image/jpeg', asset.base64, isBackSide);
      }
    } catch (err) {
      console.warn('Document gallery error:', err);
    }
  };

  const handlePickDocumentFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        const asset = res.assets[0];
        await handleAttachUri(asset.uri, asset.name, asset.mimeType || 'application/pdf', null, false);
      }
    } catch (err) {
      console.warn('Document file pick error:', err);
    }
  };

  const performSave = async (forceReplaceId?: string) => {
    setIsSaving(true);
    try {
      const cleanAmount = amount ? parseFloat(amount.replace(/[^0-9.]/g, '')) : undefined;

      const docPayload = {
        title: title.trim(),
        category,
        documentType,
        documentDate: documentDate.trim() || undefined,
        issuerName: issuerName.trim() || undefined,
        referenceNumber: referenceNumber.trim() || undefined,
        amount: cleanAmount && !isNaN(cleanAmount) ? cleanAmount : undefined,
        currency: 'INR',
        expiryDate: expiryDate.trim() || undefined,
        dueDate: dueDate.trim() || undefined,
        itemId: selectedItemId || null,
        filePath: attachedFileUri || '',
        fileUrl: attachedFileUri || '',
        filePathBack: attachedFileUriBack || undefined,
        fileUrlBack: attachedFileUriBack || undefined,
        mimeType: attachedMimeType || 'image/jpeg',
        notes: notes.trim() || undefined,
      };

      if (isEditing && editDoc) {
        await updateDocument(editDoc.id, docPayload);
        router.back();
      } else if (forceReplaceId) {
        await useItemStore.getState().updateDocument(forceReplaceId, docPayload);
        router.replace('/(tabs)/documents');
      } else {
        await addDocument(docPayload);
        router.replace('/(tabs)/documents');
      }
    } catch (err) {
      Alert.alert('Save Error', 'Failed to save document to vault. Please try again.');
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setFieldErrors((prev) => ({ ...prev, title: 'Please enter a document title.' }));
      return;
    }

    // MANDATORY PHOTO VALIDATION: At least one document photo is strictly required
    if (!attachedFileUri) {
      setFieldErrors((prev) => ({
        ...prev,
        photo: 'At least one document photo is mandatory for verification.',
      }));
      Alert.alert(
        'Document Photo Mandatory',
        'At least one scanned document photo is required to store this document in the vault.'
      );
      return;
    }

    setFieldErrors({});

    const cleanAmount = amount ? parseFloat(amount.replace(/[^0-9.]/g, '')) : undefined;
    const existingDocs = useItemStore.getState().documents;

    if (!isEditing) {
      const dupResult = checkForDuplicateDocument(
        {
          title: title.trim(),
          category,
          documentType,
          referenceNumber: referenceNumber.trim() || undefined,
          issuerName: issuerName.trim() || undefined,
          documentDate: documentDate.trim() || undefined,
          amount: cleanAmount && !isNaN(cleanAmount) ? cleanAmount : undefined,
        },
        existingDocs
      );

      if (dupResult.isDuplicate) {
        Alert.alert(
          'Similar Document Detected',
          `${dupResult.message}\n\nWould you like to keep both or replace the existing document in your vault?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setIsSaving(false) },
            {
              text: 'Keep Both',
              onPress: () => performSave(),
            },
            {
              text: 'Replace Existing',
              onPress: () => performSave(dupResult.matchedDocument?.id),
            },
          ]
        );
        return;
      }
    }

    await performSave();
  };

  const selectedCategoryConfig = getDocumentCategoryConfig(category);
  const availableTypes = DOCUMENT_TYPES_BY_CATEGORY[category] || [];
  const linkedItem = selectedItemId ? items.find((i) => i.id === selectedItemId) : null;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-serene-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header
        title={isEditing ? 'Edit Document' : 'Add Document'}
        showBack
        rightAction={
          <TouchableOpacity
            className={`bg-serene-primary px-4 py-1.5 rounded-full flex-row items-center gap-1 ${
              isSaving ? 'opacity-70' : ''
            }`}
            activeOpacity={0.88}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <MaterialIcons name="check" size={16} color="#FFFFFF" />
                <Text className="text-[13px] font-semibold text-white">Save</Text>
              </>
            )}
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerClassName="p-4 pb-24 gap-4"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {candidateMatch && selectedItemId !== candidateMatch.id && (
          <View className="bg-amber-50 border border-amber-300 rounded-serene-xl p-3.5 flex-row items-center justify-between">
            <View className="flex-1 mr-3">
              <View className="flex-row items-center gap-1.5 mb-1">
                <MaterialIcons name="auto-awesome" size={16} color="#D97706" />
                <Text className="text-[12px] font-bold text-amber-900">Suggested Item Match</Text>
              </View>
              <Text className="text-[14px] font-bold text-amber-950" numberOfLines={1}>
                {candidateMatch.name}
              </Text>
              <Text className="text-[11px] text-amber-800 mt-0.5">
                AI matched this document to your existing vault item.
              </Text>
            </View>
            <TouchableOpacity
              className="bg-amber-600 px-3.5 py-1.5 rounded-full"
              activeOpacity={0.85}
              onPress={() => setSelectedItemId(candidateMatch.id)}
            >
              <Text className="text-[12px] font-bold text-white">Link Item</Text>
            </TouchableOpacity>
          </View>
        )}

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-[14px] font-bold text-serene-on-surface">Document Photos</Text>
              <View className="bg-serene-surface-container-high px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-bold text-serene-primary">
                  {attachedFileUri && attachedFileUriBack ? '2 / 2' : attachedFileUri ? '1 / 2' : '0 / 2 (1 Required)'}
                </Text>
              </View>
            </View>
            {isPersistingFile ? (
              <View className="flex-row items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-full">
                <ActivityIndicator size="small" color={SereneColors.primary} />
                <Text className="text-[10px] font-medium text-blue-700">Storing in Vault...</Text>
              </View>
            ) : fileVerified ? (
              <View className="flex-row items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full">
                <MaterialIcons name="check-circle" size={12} color="#059669" />
                <Text className="text-[10px] font-semibold text-emerald-700">Stored & Verified</Text>
              </View>
            ) : null}
          </View>

          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-[12px] font-semibold text-serene-on-surface">
                Photo 1 — Front Side <Text className="text-red-500">*</Text>
              </Text>
              {attachedFileUri && (
                <TouchableOpacity
                  onPress={() => {
                    setAttachedFileUri(null);
                    setAttachedFileName(null);
                    setFileVerified(false);
                  }}
                  className="px-2 py-0.5 bg-red-50 rounded"
                >
                  <Text className="text-[11px] font-semibold text-red-600">Remove</Text>
                </TouchableOpacity>
              )}
            </View>

            {attachedFileUri ? (
              <View className="rounded-serene-lg overflow-hidden border border-serene-subtle-border bg-serene-surface-container-low p-2">
                <View className="h-40 rounded-serene-md overflow-hidden bg-black/5 items-center justify-center">
                  {attachedMimeType?.includes('pdf') ? (
                    <View className="items-center justify-center p-4">
                      <MaterialIcons name="picture-as-pdf" size={44} color={SereneColors.error} />
                      <Text className="text-[12px] font-mono text-serene-on-surface mt-1 font-semibold" numberOfLines={1}>
                        {attachedFileName || 'document.pdf'}
                      </Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: attachedFileUri }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="contain"
                    />
                  )}
                </View>
              </View>
            ) : (
              <View className="gap-1.5">
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    className="flex-1 py-3 bg-serene-surface-container-low rounded-serene-lg border border-dashed border-serene-subtle-border items-center justify-center gap-1"
                    activeOpacity={0.8}
                    onPress={() => handleCaptureCamera(false)}
                  >
                    <MaterialIcons name="photo-camera" size={20} color={SereneColors.primary} />
                    <Text className="text-[11px] font-semibold text-serene-on-surface">Camera</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    className="flex-1 py-3 bg-serene-surface-container-low rounded-serene-lg border border-dashed border-serene-subtle-border items-center justify-center gap-1"
                    activeOpacity={0.8}
                    onPress={() => handlePickGallery(false)}
                  >
                    <MaterialIcons name="photo-library" size={20} color={SereneColors.primary} />
                    <Text className="text-[11px] font-semibold text-serene-on-surface">Gallery</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    className="flex-1 py-3 bg-serene-surface-container-low rounded-serene-lg border border-dashed border-serene-subtle-border items-center justify-center gap-1"
                    activeOpacity={0.8}
                    onPress={handlePickDocumentFile}
                  >
                    <MaterialIcons name="picture-as-pdf" size={20} color={SereneColors.primary} />
                    <Text className="text-[11px] font-semibold text-serene-on-surface">PDF / File</Text>
                  </TouchableOpacity>
                </View>
                {fieldErrors.photo && (
                  <Text className="text-[11px] text-red-600 font-medium">{fieldErrors.photo}</Text>
                )}
              </View>
            )}
          </View>

          <View className="gap-2 pt-2 border-t border-serene-subtle-border/60">
            <View className="flex-row items-center justify-between">
              <Text className="text-[12px] font-semibold text-serene-on-surface">
                Photo 2 — Back Side <Text className="text-serene-outline font-normal">(Optional)</Text>
              </Text>
              {attachedFileUriBack && (
                <TouchableOpacity
                  onPress={() => {
                    setAttachedFileUriBack(null);
                    setAttachedFileNameBack(null);
                  }}
                  className="px-2 py-0.5 bg-red-50 rounded"
                >
                  <Text className="text-[11px] font-semibold text-red-600">Remove</Text>
                </TouchableOpacity>
              )}
            </View>

            {attachedFileUriBack ? (
              <View className="rounded-serene-lg overflow-hidden border border-serene-subtle-border bg-serene-surface-container-low p-2">
                <View className="h-40 rounded-serene-md overflow-hidden bg-black/5 items-center justify-center">
                  <Image
                    source={{ uri: attachedFileUriBack }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="contain"
                  />
                </View>
              </View>
            ) : (
              <View className="flex-row gap-2">
                <TouchableOpacity
                  className="flex-1 py-2.5 bg-serene-surface-container-low rounded-serene-lg border border-dashed border-serene-subtle-border flex-row items-center justify-center gap-1.5"
                  activeOpacity={0.8}
                  onPress={() => handleCaptureCamera(true)}
                >
                  <MaterialIcons name="photo-camera" size={16} color={SereneColors.primary} />
                  <Text className="text-[11px] font-semibold text-serene-on-surface">Camera (Back Side)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="flex-1 py-2.5 bg-serene-surface-container-low rounded-serene-lg border border-dashed border-serene-subtle-border flex-row items-center justify-center gap-1.5"
                  activeOpacity={0.8}
                  onPress={() => handlePickGallery(true)}
                >
                  <MaterialIcons name="photo-library" size={16} color={SereneColors.primary} />
                  <Text className="text-[11px] font-semibold text-serene-on-surface">Gallery (Back Side)</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-3">
          <Text className="text-[14px] font-bold text-serene-on-surface">Document Details</Text>

          <View className="gap-1">
            <Text className="text-xs font-semibold text-serene-on-surface">Document Title *</Text>
            <TextInput
              className={`bg-serene-surface-container-low rounded-serene-md border px-3 py-2 text-[14px] text-serene-on-surface ${
                fieldErrors.title ? 'border-red-500' : 'border-serene-subtle-border'
              }`}
              placeholder={
                category === 'Fees & Payments'
                  ? 'e.g. College Fee Receipt — Semester 7'
                  : category === 'Vehicle Documents'
                  ? 'e.g. Vehicle Insurance 2026-27'
                  : category === 'Bills & Utilities'
                  ? 'e.g. Electricity Bill Sep 2026'
                  : category === 'Warranty & Guarantee'
                  ? 'e.g. Lenovo 2-Year Extended Warranty'
                  : 'e.g. Purchase Invoice'
              }
              placeholderTextColor={SereneColors.outline}
              value={title}
              onChangeText={(t) => {
                setTitle(t);
                if (fieldErrors.title) setFieldErrors({});
              }}
            />
            {fieldErrors.title ? (
              <Text className="text-[11px] text-red-600 font-medium">{fieldErrors.title}</Text>
            ) : null}
          </View>

          <View className="gap-1.5 mt-1">
            <Text className="text-xs font-semibold text-serene-on-surface">Category</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="py-1 gap-2"
            >
              {DOCUMENT_CATEGORIES.map((cat) => {
                const isSelected = category === cat.category;
                return (
                  <TouchableOpacity
                    key={cat.category}
                    className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-full border ${
                      isSelected
                        ? 'bg-serene-primary border-serene-primary'
                        : 'bg-serene-surface-container-high border-transparent'
                    }`}
                    activeOpacity={0.85}
                    onPress={() => setCategory(cat.category)}
                  >
                    <MaterialIcons
                      name={cat.icon as any}
                      size={14}
                      color={isSelected ? '#FFFFFF' : SereneColors.onSurfaceVariant}
                    />
                    <Text
                      className={`text-[12px] font-semibold ${
                        isSelected ? 'text-white' : 'text-serene-on-surface-variant'
                      }`}
                    >
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View className="gap-1.5 mt-1">
            <Text className="text-xs font-semibold text-serene-on-surface">Document Type</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="py-1 gap-1.5"
            >
              {availableTypes.map((t) => {
                const isSelected = documentType === t.type;
                return (
                  <TouchableOpacity
                    key={t.type}
                    className={`px-3 py-1 rounded-serene-md border ${
                      isSelected
                        ? 'bg-serene-secondary-container border-serene-secondary'
                        : 'bg-serene-surface-container-low border-serene-subtle-border'
                    }`}
                    activeOpacity={0.85}
                    onPress={() => setDocumentType(t.type)}
                  >
                    <Text
                      className={`text-[12px] font-medium ${
                        isSelected ? 'text-serene-on-secondary-container font-bold' : 'text-serene-on-surface-variant'
                      }`}
                    >
                      {t.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-3">
          <Text className="text-[14px] font-bold text-serene-on-surface">Specific Information</Text>

          <View className="flex-row gap-2.5">
            <View className="flex-1 gap-1">
              <Text className="text-xs font-semibold text-serene-on-surface">Document Date</Text>
              <TextInput
                className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                placeholder="YYYY-MM-DD"
                placeholderTextColor={SereneColors.outline}
                value={documentDate}
                onChangeText={setDocumentDate}
              />
            </View>

            <View className="flex-1 gap-1">
              <Text className="text-xs font-semibold text-serene-on-surface">Amount (₹)</Text>
              <TextInput
                className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                placeholder="e.g. 45,000"
                placeholderTextColor={SereneColors.outline}
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
              />
            </View>
          </View>

          <View className="gap-1">
            <Text className="text-xs font-semibold text-serene-on-surface">
              {category === 'Vehicle Documents'
                ? 'Insurer / Authority (e.g. ICICI Lombard, RTO Delhi)'
                : category === 'Bills & Utilities'
                ? 'Utility Provider (e.g. BSES, Adani Gas, Airtel)'
                : category === 'Fees & Payments'
                ? 'Educational Institution / Payee (e.g. IIT Delhi)'
                : 'Issuer / Merchant'}
            </Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
              placeholder={
                category === 'Fees & Payments'
                  ? 'e.g. KCC Institute of Technology & Management'
                  : category === 'Vehicle Documents'
                  ? 'e.g. ICICI Lombard'
                  : category === 'Bills & Utilities'
                  ? 'e.g. Electricity Provider'
                  : category === 'Warranty & Guarantee'
                  ? 'e.g. Lenovo'
                  : 'e.g. Flipkart'
              }
              placeholderTextColor={SereneColors.outline}
              value={issuerName}
              onChangeText={setIssuerName}
            />
          </View>

          <View className="gap-1">
            <Text className="text-xs font-semibold text-serene-on-surface">
              {category === 'Vehicle Documents'
                ? 'Policy # / Vehicle Reg # / RC #'
                : category === 'Bills & Utilities'
                ? 'Consumer # / CA # / Account #'
                : category === 'Fees & Payments'
                ? 'Challan # / Roll # / Receipt #'
                : 'Invoice # / Reference #'}
            </Text>
            <TextInput
              className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface font-mono"
              placeholder={
                category === 'Fees & Payments'
                  ? 'e.g. RECEIPT-2026-1042'
                  : category === 'Vehicle Documents'
                  ? 'e.g. POL-2026-123456'
                  : category === 'Bills & Utilities'
                  ? 'e.g. BILL-2026-1042'
                  : category === 'Warranty & Guarantee'
                  ? 'e.g. PF4ABC123456'
                  : 'e.g. INV-2026-1042'
              }
              placeholderTextColor={SereneColors.outline}
              value={referenceNumber}
              onChangeText={setReferenceNumber}
            />
          </View>

          <View className="gap-2.5 pt-2 border-t border-serene-subtle-border">
            {category === 'Bills & Utilities' ? (
              <View className="gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">
                  Payment Due Date (YYYY-MM-DD)
                </Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface font-mono"
                  placeholder="e.g. 2026-10-15"
                  placeholderTextColor={SereneColors.outline}
                  value={dueDate}
                  onChangeText={(t) => {
                    setDueDate(t);
                    if (t.trim() && !enableReminder) setEnableReminder(true);
                  }}
                />
                <Text className="text-[10px] text-serene-on-surface-variant">
                  Keepr Smart Reminders will automatically schedule alerts 1 week and 1 day before due date.
                </Text>
              </View>
            ) : (
              <View className="gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">
                  {category === 'Warranty & Guarantee'
                    ? 'Warranty Expiry Date (YYYY-MM-DD)'
                    : category === 'Vehicle Documents'
                    ? 'Policy / Certificate Expiry Date (YYYY-MM-DD)'
                    : 'Document Expiry Date (YYYY-MM-DD)'}
                </Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface font-mono"
                  placeholder="e.g. 2027-09-30"
                  placeholderTextColor={SereneColors.outline}
                  value={expiryDate}
                  onChangeText={(t) => {
                    setExpiryDate(t);
                    if (t.trim() && !enableReminder) setEnableReminder(true);
                  }}
                />
                <Text className="text-[10px] text-serene-on-surface-variant">
                  {category === 'Warranty & Guarantee'
                    ? 'Smart Reminders will alert you 1 month and 1 week before warranty ends.'
                    : category === 'Vehicle Documents'
                    ? 'Smart Reminders will alert you 1 week before policy expiration.'
                    : 'Optional expiry date for this document record.'}
                </Text>
              </View>
            )}

            {(expiryDate.trim() || dueDate.trim()) ? (
              <View className="flex-row items-center justify-between bg-serene-surface-container-low p-2.5 rounded-serene-md">
                <View className="flex-1 mr-2">
                  <Text className="text-xs font-bold text-serene-on-surface">Smart Reminder Engine</Text>
                  <Text className="text-[10px] text-serene-on-surface-variant">
                    {category === 'Bills & Utilities'
                      ? 'Scheduled 7 days and 1 day prior to due date'
                      : category === 'Warranty & Guarantee'
                      ? 'Scheduled 1 month and 1 week prior to expiry'
                      : 'Scheduled 1 week prior to expiry'}
                  </Text>
                </View>
                <Switch
                  value={enableReminder}
                  onValueChange={setEnableReminder}
                  trackColor={{
                    false: SereneColors.surfaceContainerHighest,
                    true: SereneColors.primary,
                  }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ) : null}
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-2.5">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <MaterialIcons name="link" size={16} color={SereneColors.primary} />
              <Text className="text-[14px] font-bold text-serene-on-surface">
                Link to Vault Item (Optional)
              </Text>
            </View>
            {selectedItemId && (
              <TouchableOpacity onPress={() => setSelectedItemId(null)}>
                <Text className="text-[11px] font-semibold text-serene-error">Unlink</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text className="text-[11px] text-serene-on-surface-variant">
            Link this document to a vehicle, appliance, or gadget in your vault. Or leave blank for standalone documents like utility bills or college fees.
          </Text>

          {linkedItem ? (
            <View className="flex-row items-center justify-between bg-blue-50/80 border border-blue-200 p-2.5 rounded-serene-md">
              <View className="flex-1 mr-2">
                <Text className="text-[13px] font-bold text-[#115086]" numberOfLines={1}>
                  {linkedItem.name}
                </Text>
                <Text className="text-[10px] text-[#115086]/80">
                  {linkedItem.merchant || 'Item'} · {linkedItem.categoryId}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowItemPicker(!showItemPicker)}
                className="bg-white px-2.5 py-1 rounded border border-blue-200"
              >
                <Text className="text-[11px] font-semibold text-[#115086]">Change</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setShowItemPicker(!showItemPicker)}
              className="flex-row items-center justify-between bg-serene-surface-container-low border border-serene-subtle-border p-2.5 rounded-serene-md"
            >
              <Text className="text-[12px] text-serene-on-surface-variant">
                Select an item from your vault...
              </Text>
              <MaterialIcons
                name={showItemPicker ? 'expand-less' : 'expand-more'}
                size={18}
                color={SereneColors.outline}
              />
            </TouchableOpacity>
          )}

          {showItemPicker && (
            <View className="bg-serene-surface-container-low rounded-serene-md p-2 gap-1 border border-serene-subtle-border max-h-48">
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                <TouchableOpacity
                  onPress={() => {
                    setSelectedItemId(null);
                    setShowItemPicker(false);
                  }}
                  className="p-2 border-b border-serene-subtle-border"
                >
                  <Text className="text-[12px] font-semibold text-serene-primary">
                    None (Standalone Document)
                  </Text>
                </TouchableOpacity>

                {items.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => {
                      setSelectedItemId(item.id);
                      setShowItemPicker(false);
                    }}
                    className="p-2 border-b border-serene-subtle-border/60 flex-row items-center justify-between"
                  >
                    <Text className="text-[12px] text-serene-on-surface font-medium" numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text className="text-[10px] text-serene-outline">{item.categoryId}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border shadow-sm gap-2">
          <Text className="text-[14px] font-bold text-serene-on-surface">Notes</Text>
          <TextInput
            className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border p-3 text-[13px] text-serene-on-surface min-h-[70px]"
            placeholder={
              category === 'Fees & Payments'
                ? 'e.g. Semester 7 tuition fee'
                : 'e.g. Keep this document for future reference'
            }
            placeholderTextColor={SereneColors.outline}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
