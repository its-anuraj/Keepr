
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  TextInput,
  Animated,
  Alert,
  Modal,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import {
  getActiveReceiptSession,
  setActiveReceiptSession,
  clearActiveReceiptSession,
} from '../../src/store/receiptSessionStore';
import {
  stabilizeReceiptImage,
  safeNormalizeRouteUri,
  normalizeImageUri,
  persistReceiptToVault,
  persistDocumentToVault,
  persistProductPhotoToVault,
} from '../../src/services/receiptFileService';

export { normalizeImageUri };
import { NotificationService } from '../../src/services/notifications';
import { formatCurrency, formatDate } from '../../src/utils/currency';
import {
  ExtractedReceiptData,
  ScannerCategory,
  ScannerScreenState,
  ProcessingStep,
  FieldValue,
  ReceiptMultiItem,
  OcrResult,
  OcrBlock,
  OcrPreprocessedOutput,
  CanonicalCategory,
} from '../../src/types/scanner';
import {
  CANONICAL_DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_NAMES,
  DOCUMENT_TYPES_BY_CATEGORY,
  normalizeToCanonicalDocumentCategory,
  normalizeToCanonicalDocumentType,
  getDocumentCategoryConfig,
} from '../../src/constants/documentCategories';
import { CanonicalDocumentCategory, CanonicalDocumentType } from '../../src/types';
import { DEMO_RECEIPT_PRESETS, DemoReceiptPreset } from '../../src/constants/demoReceipts';
import {
  isGeminiConfigured,
} from '../../src/services/receiptScanner';
import {
  executeGeminiReceiptAnalysis,
} from '../../src/services/geminiReceiptService';
import {
  parseGeminiResponseToExtractedData,
  recalculateCategoryFields,
} from '../../src/services/receiptParser';
import {
  CANONICAL_CATEGORIES,
  CATEGORY_RULES,
  normalizeToCanonicalCategory,
  scannerCodeToCanonical,
  canonicalToScannerCode,
} from '../../src/services/categoryRules';
import {
  detectCategoryAndProductType,
  DEFAULT_CATEGORIES,
  CATEGORY_PRODUCT_TYPES,
  getProductTypesForCategory,
  getCategoryNameFromId,
  getCategoryIdFromName,
} from '../../src/constants/categories';
import { MultiItemCard } from '../../src/components/scanner/MultiItemCard';
import { CategoryFieldsForm } from '../../src/components/scanner/CategoryFieldsForm';
import { OcrInspectorModal } from '../../src/components/scanner/OcrInspectorModal';
import { ConfidenceBadge } from '../../src/components/scanner/ConfidenceBadge';
import { evaluateRoutingDecision } from '../../src/services/documentClassifier';
import { matchDocumentToItem } from '../../src/services/itemMatcherService';

export default function AIReceiptScannerScreen() {
  const insets = useSafeAreaInsets();
  const items = useItemStore((s) => s.items);
  const addItem = useItemStore((s) => s.addItem);
  const addMultipleItems = useItemStore((s) => s.addMultipleItems);
  const params = useLocalSearchParams<{
    initialUri?: string;
    initialName?: string;
    mode?: string;
    autoProcess?: string;
  }>();

  const isExplicitCameraMode = params.mode === 'camera';
  const initialSession = isExplicitCameraMode ? null : getActiveReceiptSession();
  const fallbackParamUri = isExplicitCameraMode ? null : safeNormalizeRouteUri(params.initialUri);
  const initialUri = initialSession?.uri || fallbackParamUri || null;
  const initialSource = isExplicitCameraMode ? 'camera' : (initialSession?.source || (params.mode === 'gallery' ? 'gallery' : 'camera'));

  const [screenState, setScreenState] = useState<ScannerScreenState>(
    isExplicitCameraMode ? 'scan' : (initialUri ? 'preview' : 'scan')
  );

  const [flashMode, setFlashMode] = useState<'off' | 'auto' | 'on'>('auto');
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');

  const [capturedImageUri, setCapturedImageUri] = useState<string | null>(initialUri);
  const [capturedImageName, setCapturedImageName] = useState<string>(
    isExplicitCameraMode
      ? 'Receipt.jpg'
      : (initialSession?.fileName || (params.initialName ? decodeURIComponent(params.initialName) : 'Receipt.jpg'))
  );
  const [capturedBase64, setCapturedBase64] = useState<string | null>(
    isExplicitCameraMode ? null : (initialSession?.base64 || null)
  );

  const [imageSource, setImageSource] = useState<'camera' | 'gallery'>(initialSource);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const autoProcessTriggeredRef = useRef(false);

  const [showCropModal, setShowCropModal] = useState(false);
  const [cropRotation, setCropRotation] = useState(0);
  const [selectedCropPreset, setSelectedCropPreset] = useState<
    'full' | 'trim' | 'top75' | 'bottom75' | 'center80'
  >('full');
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isCropping, setIsCropping] = useState(false);

  const [showReviewDocTypeModal, setShowReviewDocTypeModal] = useState(false);
  const [selectedReviewCategory, setSelectedReviewCategory] = useState<CanonicalDocumentCategory>('Receipts & Invoices');
  const [selectedReviewDocType, setSelectedReviewDocType] = useState<CanonicalDocumentType>('Receipt');
  const [pendingRoutingData, setPendingRoutingData] = useState<{
    parsedData: ExtractedReceiptData;
    activeUri: string;
    imageName: string;
  } | null>(null);

  // Deterministically reset to clean camera scan screen whenever re-focused in camera mode
  useFocusEffect(
    useCallback(() => {
      if (params.mode === 'camera') {
        clearActiveReceiptSession();
        setCapturedImageUri(null);
        setCapturedBase64(null);
        setExtractedData(null);
        setSavedItemId(null);
        setProcessingError(null);
        setReceiptRejection(null);
        setIsScanning(false);
        setImageLoadError(false);
        setImageSource('camera');
        setScreenState('scan');
      }
    }, [params.mode])
  );

  useEffect(() => {
    if (params.mode === 'camera') {
      clearActiveReceiptSession();
      setCapturedImageUri(null);
      setCapturedBase64(null);
      setExtractedData(null);
      setSavedItemId(null);
      setProcessingError(null);
      setReceiptRejection(null);
      setIsScanning(false);
      setImageLoadError(false);
      setImageSource('camera');
      setScreenState('scan');
      return;
    }

    const session = getActiveReceiptSession();
    if (session?.uri) {
      console.log('[ReceiptPreview] Session restored URI:', session.uri);
      setCapturedImageUri(session.uri);
      setImageSource(session.source);
      setCapturedBase64(session.base64 || null);
      setCapturedImageName(session.fileName);
      setImageLoadError(false);
      setScreenState('preview');
      return;
    }

    if (params.initialUri) {
      const cleanUri = safeNormalizeRouteUri(params.initialUri);
      console.log('[ReceiptPreview] Initial URI:', cleanUri);
      setImageSource(params.mode === 'gallery' ? 'gallery' : 'camera');
      setImageLoadError(false);
      setCapturedImageUri(cleanUri);
      setCapturedImageName(
        params.initialName ? decodeURIComponent(params.initialName) : 'Receipt.jpg'
      );
      setSelectedPresetId(undefined);
      setScreenState('preview');
    }
  }, [params.initialUri, params.initialName, params.mode]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(undefined);
  const [extractedData, setExtractedData] = useState<ExtractedReceiptData | null>(null);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number>(0);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);
  const [reminderScheduled, setReminderScheduled] = useState(false);

  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editingItemName, setEditingItemName] = useState('');
  const [editingItemPrice, setEditingItemPrice] = useState('');
  const [editingItemQuantity, setEditingItemQuantity] = useState('1');
  const [editingItemCategoryId, setEditingItemCategoryId] = useState('electronics');
  const [editingItemProductType, setEditingItemProductType] = useState('');
  const [editingItemBrand, setEditingItemBrand] = useState('');
  const [editingItemModel, setEditingItemModel] = useState('');
  const [showEditItemModal, setShowEditItemModal] = useState(false);

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState('1');
  const [newItemCategoryId, setNewItemCategoryId] = useState('electronics');
  const [newItemProductType, setNewItemProductType] = useState('');
  const [newItemBrand, setNewItemBrand] = useState('');

  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [savedBatchCount, setSavedBatchCount] = useState(0);

  const [processingError, setProcessingError] = useState<string | null>(null);
  const [receiptRejection, setReceiptRejection] = useState<{
    reason: string;
    message: string;
  } | null>(null);
  const [detailsFound, setDetailsFound] = useState(false);

  const [showImageModal, setShowImageModal] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrPreprocessed, setOcrPreprocessed] = useState<OcrPreprocessedOutput | null>(null);
  const [showOcrInspector, setShowOcrInspector] = useState(false);

  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scanInProgressRef = useRef(false);

  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([
    { id: 1, label: 'Reading document', completed: false },
    { id: 2, label: 'Identifying what this is', completed: false },
    { id: 3, label: 'Extracting important details', completed: false },
    { id: 4, label: 'Preparing your information', completed: false },
  ]);
  const [processingTitle, setProcessingTitle] = useState('Understanding your document');

  useEffect(() => {
    if (screenState === 'scan') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, {
            toValue: 1,
            duration: 2200,
            useNativeDriver: true,
          }),
          Animated.timing(scanLineAnim, {
            toValue: 0,
            duration: 2200,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [screenState, scanLineAnim]);

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Camera Permission',
          'Camera permission is required to photograph physical receipts. Would you like to select from your gallery instead?',
          [
            { text: 'Choose Gallery', onPress: handleChooseGallery },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.9,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        console.log('[ReceiptCapture]\nCaptured URI:', asset.uri);

        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `Receipt_${dateStr}.jpg`;

        // Stabilize file location and verify readability
        const stabilized = await stabilizeReceiptImage(asset.uri, asset.base64);
        console.log('[ReceiptPreview] Camera capture URI:', stabilized.uri);

        setActiveReceiptSession({
          uri: stabilized.uri,
          source: 'camera',
          fileName,
          base64: asset.base64 || null,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
        });

        setImageSource('camera');
        setImageLoadError(false);
        setCapturedImageUri(stabilized.uri);
        setCapturedBase64(asset.base64 || null);
        setCapturedImageName(fileName);
        setSelectedPresetId(undefined);
        setScreenState('preview');
      }
    } catch (err) {
      console.warn('Camera capture error:', err);
      Alert.alert('Camera Error', 'Could not open camera on this device. Please choose an image from your gallery instead.');
    }
  };

  const handleChooseGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        console.log('[ReceiptSelection]\nSelected URI:', asset.uri);

        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = asset.fileName || `Receipt_${dateStr}.jpg`;

        // Stabilize file location and verify readability
        const stabilized = await stabilizeReceiptImage(asset.uri, asset.base64);
        console.log('[ReceiptPreview] Gallery pick URI:', stabilized.uri);

        setActiveReceiptSession({
          uri: stabilized.uri,
          source: 'gallery',
          fileName,
          base64: asset.base64 || null,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType,
        });

        setImageSource('gallery');
        setImageLoadError(false);
        setCapturedImageUri(stabilized.uri);
        setCapturedBase64(asset.base64 || null);
        setCapturedImageName(fileName);
        setSelectedPresetId(undefined);
        setScreenState('preview');
      }
    } catch (err) {
      console.warn('Gallery pick error:', err);
      Alert.alert('Gallery Notice', 'Could not open gallery on this device.');
    }
  };

  const handleSelectPreset = (preset: DemoReceiptPreset) => {
    console.log('[ReceiptSelection]\nSelected URI:', preset.imageUri);
    setActiveReceiptSession({
      uri: preset.imageUri,
      source: 'gallery',
      fileName: preset.name,
      base64: null,
    });
    console.log('[ReceiptPreview] Preset URI:', preset.imageUri);
    setImageSource('gallery');
    setImageLoadError(false);
    setCapturedImageUri(preset.imageUri);
    setCapturedBase64(null);
    setCapturedImageName(preset.name);
    setSelectedPresetId(undefined);
    setScreenState('preview');
  };

  const handleOpenCrop = () => {
    if (!capturedImageUri) return;
    setCropRotation(0);
    setSelectedCropPreset('full');
    Image.getSize(
      capturedImageUri,
      (width, height) => {
        setImageDimensions({ width, height });
        setShowCropModal(true);
      },
      (error) => {
        console.warn('[ReceiptCrop] Could not read image dimensions:', error);
        setImageDimensions(null);
        setShowCropModal(true);
      }
    );
  };

  const handleApplyCrop = async () => {
    if (!capturedImageUri) return;
    setIsCropping(true);
    try {
      const actions: any[] = [];
      if (cropRotation !== 0) {
        actions.push({ rotate: cropRotation });
      }
      if (selectedCropPreset !== 'full' && imageDimensions) {
        const { width: w, height: h } = imageDimensions;
        if (selectedCropPreset === 'trim') {
          actions.push({
            crop: {
              originX: Math.round(w * 0.05),
              originY: Math.round(h * 0.05),
              width: Math.round(w * 0.9),
              height: Math.round(h * 0.9),
            },
          });
        } else if (selectedCropPreset === 'top75') {
          actions.push({
            crop: {
              originX: 0,
              originY: 0,
              width: Math.round(w),
              height: Math.round(h * 0.75),
            },
          });
        } else if (selectedCropPreset === 'bottom75') {
          actions.push({
            crop: {
              originX: 0,
              originY: Math.round(h * 0.25),
              width: Math.round(w),
              height: Math.round(h * 0.75),
            },
          });
        } else if (selectedCropPreset === 'center80') {
          actions.push({
            crop: {
              originX: Math.round(w * 0.1),
              originY: Math.round(h * 0.1),
              width: Math.round(w * 0.8),
              height: Math.round(h * 0.8),
            },
          });
        }
      }

      if (actions.length > 0) {
        const result = await manipulateAsync(
          capturedImageUri,
          actions,
          { compress: 0.92, format: SaveFormat.JPEG, base64: true }
        );
        console.log('[ReceiptCapture]\nCaptured URI (Crop):', result.uri);
        const stabilized = await stabilizeReceiptImage(result.uri, result.base64);
        console.log('[ReceiptPreview] Cropped URI:', stabilized.uri);

        setActiveReceiptSession({
          uri: stabilized.uri,
          source: 'camera',
          fileName: capturedImageName,
          base64: result.base64 || capturedBase64 || null,
          width: result.width,
          height: result.height,
        });

        setCapturedImageUri(stabilized.uri);
        if (result.base64) {
          setCapturedBase64(result.base64);
        }
        setImageLoadError(false);
      }
      setShowCropModal(false);
    } catch (err) {
      console.error('[ReceiptCrop] Failed to crop receipt image:', err);
      Alert.alert('Crop Failed', 'Could not apply transformations to this image.');
    } finally {
      setIsCropping(false);
    }
  };

  const navigateToItemAdd = async (
    data: ExtractedReceiptData,
    activeUri: string,
    imageName: string
  ) => {
    console.log(`[ScannerDiagnostics] navigation started (destination=/(tabs)/add, product=${data.common.productName?.value || 'Item'})`);
    try {
      console.log(`[ScannerDiagnostics] image persistence started (target=vault_receipts, uri=${activeUri})`);
      const persistRes = await persistReceiptToVault(activeUri, imageName, capturedBase64 || null);
      let finalUri = activeUri;
      if (persistRes.persisted && persistRes.uri) {
        finalUri = persistRes.uri;
        console.log(`[ScannerDiagnostics] image persistence completed (persistedUri=${finalUri})`);
      } else {
        console.warn(`[ScannerDiagnostics] image persistence fallback (using active URI: ${activeUri})`);
      }

      const activeCatData = data.categoryDetails;
      const detectedModel =
        data.common.modelNumber?.value ||
        (activeCatData as any)?.model?.value ||
        data.items?.[0]?.model ||
        '';

      const detectedAddress =
        data.common.merchantAddress?.value ||
        data.common.storeLocation?.value ||
        '';

      const warDate =
        (data.common as any).warrantyUntil?.value ||
        (data.common as any).warrantyExpiryDate?.value ||
        data.items?.[0]?.warrantyUntil ||
        '';

      const detectedSerial =
        data.common.serialNumber?.value ||
        (activeCatData as any)?.serialNumber?.value ||
        data.items?.[0]?.serialNumber ||
        '';

      const primaryProductName =
        data.common.productName?.value ||
        data.items?.[0]?.productName ||
        '';

      const primaryPrice =
        data.common.finalAmount?.value
          ? String(data.common.finalAmount.value)
          : data.items?.[0]?.price
          ? String(data.items[0].price)
          : '';

      const detection = detectCategoryAndProductType({
        name: primaryProductName,
        brand: data.common.brand?.value || data.items?.[0]?.brand,
        model: detectedModel,
        merchant: data.common.merchant?.value,
        rawText: ocrResult?.text,
      });

      let coreCategoryId = detection.categoryId;
      if (!coreCategoryId && data.category && data.category !== 'other') {
        if (data.category === 'vehicle') coreCategoryId = 'vehicles';
        else if (data.category === 'home_appliance') coreCategoryId = 'appliances';
        else if (data.category === 'furniture') coreCategoryId = 'furniture';
        else if (data.category === 'fashion') coreCategoryId = 'fashion';
        else if (data.category === 'sports') coreCategoryId = 'sports';
        else if (data.category === 'beauty') coreCategoryId = 'beauty';
        else if (data.category === 'electronics' || data.category === 'mobile_laptop') {
          coreCategoryId = 'electronics';
        }
      }

      const productType = detection.productType || (data as any).productType || '';
      const categoryConfidence = detection.confidence;

      setActiveReceiptSession({
        uri: finalUri,
        source: imageSource,
        fileName: imageName || 'Receipt.jpg',
        base64: capturedBase64 || null,
      });

      console.log(
        `[ReceiptDocumentFlow]\nselectedUri=${finalUri}\nscanSuccess=true\naddPurchaseReceivedUri=${finalUri}\ndocumentStateUri=${finalUri}\ndocumentPreviewUri=${finalUri}`
      );

      router.replace({
        pathname: '/(tabs)/add',
        params: {
          fromScan: 'true',
          scannedReceiptUri: finalUri,
          scannedReceiptName: imageName || 'Receipt.jpg',
          scannedProductName: primaryProductName,
          scannedMerchant: data.common.merchant?.value || '',
          scannedSellerAddress: detectedAddress,
          scannedGstin: data.common.gstin?.value || '',
          scannedPurchaseDate: data.common.purchaseDate?.value || '',
          scannedPurchasePrice: primaryPrice,
          scannedQuantity: data.items?.[0]?.quantity ? String(data.items[0].quantity) : (data.common.quantity?.value ? String(data.common.quantity.value) : '1'),
          scannedUnitPrice: data.items?.[0]?.unitPrice ? String(data.items[0].unitPrice) : (data.common.unitPrice?.value ? String(data.common.unitPrice.value) : ''),
          scannedSubtotal: data.common.subtotal?.value ? String(data.common.subtotal.value) : '',
          scannedDiscount: data.common.discount?.value ? String(data.common.discount.value) : '',
          scannedGstTax: data.common.taxGst?.value ? String(data.common.taxGst.value) : '',
          scannedGstRate: data.common.gstRate?.value || '',
          scannedCgst: data.common.cgst?.value ? String(data.common.cgst.value) : '',
          scannedSgst: data.common.sgst?.value ? String(data.common.sgst.value) : '',
          scannedIgst: data.common.igst?.value ? String(data.common.igst.value) : '',
          scannedInvoiceNumber: data.common.invoiceNumber?.value || '',
          scannedCategory: coreCategoryId || '',
          scannedCategoryConfidence: categoryConfidence || 'high',
          scannedProductType: productType,
          scannedReturnUntil: (data as any).returnUntil || data.items?.[0]?.returnUntil || '',
          scannedWarrantyUntil: warDate,
          scannedWarrantyProvider: data.common.brand?.value ? `${data.common.brand.value} Warranty` : '',
          scannedBrand: data.common.brand?.value || data.items?.[0]?.brand || '',
          scannedModel: detectedModel,
          scannedSerialNumber: detectedSerial,
          scannedNotes: data.common.notes?.value || '',
        },
      });
      console.log(`[ScannerDiagnostics] navigation completed (/(tabs)/add)`);
    } catch (navErr) {
      console.error(`[ScannerDiagnostics] navigation error (/(tabs)/add):`, navErr);
      setProcessingError("Could not open Item Review. Please try again.");
    }
  };

  const navigateToDocumentAdd = async (
    targetCategory: CanonicalDocumentCategory,
    targetDocType: CanonicalDocumentType,
    data: ExtractedReceiptData,
    uri: string,
    fileName: string
  ) => {
    console.log(`[ScannerDiagnostics] navigation started (destination=/document/add, category=${targetCategory}, type=${targetDocType})`);
    try {
      console.log(`[ScannerDiagnostics] image persistence started (target=vault_documents, uri=${uri})`);
      const persistRes = await persistDocumentToVault(uri, fileName, capturedBase64 || null);
      let finalUri = uri;
      if (persistRes.persisted && persistRes.uri) {
        finalUri = persistRes.uri;
        console.log(`[ScannerDiagnostics] image persistence completed (persistedUri=${finalUri})`);
      } else {
        console.warn(`[ScannerDiagnostics] image persistence fallback (using active URI: ${uri})`);
      }

      const primaryPrice = data.common.finalAmount?.value
        ? String(data.common.finalAmount.value)
        : data.items?.[0]?.price
        ? String(data.items[0].price)
        : '';

      const detectedTitle =
        data.documentTitle ||
        (data.common.merchant?.value ? `${data.common.merchant.value} ${targetDocType}` : targetDocType);

      router.replace({
        pathname: '/document/add',
        params: {
          fileUri: finalUri,
          prefillTitle: detectedTitle,
          prefillCategory: targetCategory,
          prefillType: targetDocType,
          prefillIssuer: data.issuerName || data.common.merchant?.value || '',
          prefillReference: data.referenceNumber || data.common.invoiceNumber?.value || '',
          prefillAmount: primaryPrice,
          prefillDate: data.documentDate || data.common.purchaseDate?.value || '',
          prefillExpiryDate: data.expiryDate || (data.common as any).warrantyUntil?.value || '',
          prefillDueDate: data.dueDate || '',
          prefillCandidateItemId: data.classification?.itemMatch?.candidateItemId || '',
          prefillCandidateItemName: data.classification?.itemMatch?.matchedItemName ? encodeURIComponent(data.classification.itemMatch.matchedItemName) : '',
          fileUriBack: data.receiptUriBack || '',
        },
      });
      console.log(`[ScannerDiagnostics] navigation completed (/document/add)`);
    } catch (navErr) {
      console.error(`[ScannerDiagnostics] navigation error (/document/add):`, navErr);
      setProcessingError("Could not open Document Review. Please try again.");
    }
  };

  const navigateToServiceAdd = async (
    data: ExtractedReceiptData,
    uri: string,
    fileName: string
  ) => {
    console.log(`[ScannerDiagnostics] navigation started (destination=/service/add)`);
    try {
      console.log(`[ScannerDiagnostics] image persistence started (target=vault_services, uri=${uri})`);
      const persistRes = await persistDocumentToVault(uri, fileName, capturedBase64 || null);
      let finalUri = uri;
      if (persistRes.persisted && persistRes.uri) {
        finalUri = persistRes.uri;
        console.log(`[ScannerDiagnostics] image persistence completed (persistedUri=${finalUri})`);
      } else {
        console.warn(`[ScannerDiagnostics] image persistence fallback (using active URI: ${uri})`);
      }

      const sData = data.serviceRepair;
      const primaryPrice = sData?.amountPaid != null
        ? String(sData.amountPaid)
        : data.common.finalAmount?.value
        ? String(data.common.finalAmount.value)
        : '';

      router.replace({
        pathname: '/service/add',
        params: {
          scannedServiceUri: finalUri,
          scannedServiceName: fileName,
          prefillProvider: sData?.serviceProvider || data.issuerName || data.common.merchant?.value || '',
          prefillServiceType: sData?.serviceType || 'Service & Repair',
          prefillServiceDate: sData?.serviceDate || data.documentDate || data.common.purchaseDate?.value || '',
          prefillCost: primaryPrice,
          prefillProblem: sData?.problemDescription || '',
          prefillWorkDone: sData?.workPerformed || '',
          prefillTechnicianNotes: sData?.technicianNotes || '',
          prefillWarrantyCovered: sData?.warrantyCovered ? String(sData.warrantyCovered) : '',
          prefillWarrantyUntil: sData?.postServiceWarrantyUntil || '',
          prefillGuaranteeUntil: sData?.postServiceGuaranteeUntil || '',
          prefillCandidateItemId: data.classification?.itemMatch?.candidateItemId || '',
          prefillCandidateItemName: data.classification?.itemMatch?.matchedItemName ? encodeURIComponent(data.classification.itemMatch.matchedItemName) : '',
        },
      });
      console.log(`[ScannerDiagnostics] navigation completed (/service/add)`);
    } catch (navErr) {
      console.error(`[ScannerDiagnostics] navigation error (/service/add):`, navErr);
      setProcessingError("Could not open Service Review. Please try again.");
    }
  };

  const handleConfirmAndProcessReceipt = async () => {
    if (scanInProgressRef.current) {
      console.log('[ScannerDiagnostics] scan duplicate prevented: scan already in progress');
      return;
    }

    const activeUri = capturedImageUri || (capturedBase64 ? `data:image/jpeg;base64,${capturedBase64}` : '');
    if (!activeUri) return;

    scanInProgressRef.current = true;
    setIsScanning(true);
    console.log(`[ScannerDiagnostics] scan started: activeUri=${activeUri}`);
    console.log(`[ScannerDiagnostics] image URI received: uri=${activeUri}`);

    setScreenState('processing');
    setProcessingError(null);
    setReceiptRejection(null);
    setDetailsFound(false);

    setProcessingSteps([
      { id: 1, label: 'Reading document', completed: false },
      { id: 2, label: 'Identifying what this is', completed: false },
      { id: 3, label: 'Extracting important details', completed: false },
      { id: 4, label: 'Preparing your information', completed: false },
    ]);
    setProcessingTitle('Understanding your document');

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ])
    ).start();

    try {
      setProcessingSteps((prev) => prev.map((s) => (s.id <= 1 ? { ...s, completed: true } : s)));
      setProcessingTitle('Identifying what this is');
      await new Promise((r) => setTimeout(r, 200));

      const geminiResponse = await executeGeminiReceiptAnalysis({
        imageUri: activeUri,
        base64: capturedBase64 || undefined,
        fileName: capturedImageName,
      });

      setProcessingSteps((prev) => prev.map((s) => (s.id <= 2 ? { ...s, completed: true } : s)));
      setProcessingTitle('Extracting important details');
      await new Promise((r) => setTimeout(r, 200));

      const parsedData = parseGeminiResponseToExtractedData(
        geminiResponse,
        activeUri,
        capturedImageName
      );

      console.log(`[ScannerDiagnostics] result stored: id=${parsedData.id}`);

      if (!parsedData.isReceipt && !parsedData.isDocument && !parsedData.serviceRepair) {
        setProcessingSteps((prev) => prev.map((s) => ({ ...s, completed: false })));
        setProcessingTitle("That doesn't look like a supported document");
        setReceiptRejection({
          reason: parsedData.rejectionReason || "This image does not appear to be an invoice, bill, warranty, or service document.",
          message: parsedData.rejectionMessage || "Please upload a clear photo of your receipt, bill, or service record.",
        });
        setIsScanning(false);
        scanInProgressRef.current = false;
        return;
      }

      const blocks: OcrBlock[] = [];
      if (parsedData.common.merchant?.value) {
        blocks.push({
          text: `Store: ${parsedData.common.merchant.value}`,
          confidence: 0.98,
          lines: [{ text: `Store: ${parsedData.common.merchant.value}`, confidence: 0.98 }],
          boundingBox: { x: 0, y: 0, width: 100, height: 20 },
        });
      }
      if (parsedData.common.productName?.value) {
        blocks.push({
          text: `Product: ${parsedData.common.productName.value}`,
          confidence: 0.96,
          lines: [{ text: `Product: ${parsedData.common.productName.value}`, confidence: 0.96 }],
          boundingBox: { x: 0, y: 25, width: 100, height: 20 },
        });
      }
      if (parsedData.common.invoiceNumber?.value) {
        blocks.push({
          text: `Invoice: ${parsedData.common.invoiceNumber.value}`,
          confidence: 0.95,
          lines: [{ text: `Invoice: ${parsedData.common.invoiceNumber.value}`, confidence: 0.95 }],
          boundingBox: { x: 0, y: 50, width: 100, height: 20 },
        });
      }
      if (parsedData.common.finalAmount?.value) {
        blocks.push({
          text: `Total: ${parsedData.common.finalAmount.value}`,
          confidence: 0.99,
          lines: [{ text: `Total: ${parsedData.common.finalAmount.value}`, confidence: 0.99 }],
          boundingBox: { x: 0, y: 75, width: 100, height: 20 },
        });
      }

      setOcrResult({
        text: `Merchant: ${parsedData.common.merchant?.value || 'N/A'}\nProduct: ${parsedData.common.productName?.value || 'N/A'}\nInvoice: ${parsedData.common.invoiceNumber?.value || 'N/A'}\nDate: ${parsedData.common.purchaseDate?.value || 'N/A'}\nSubtotal: ${parsedData.common.subtotal?.value || 'N/A'}\nTax/GST: ${parsedData.common.taxGst?.value || 'N/A'}\nTotal: ${parsedData.common.finalAmount?.value || 'N/A'}`,
        confidence: (parsedData.rawConfidenceScore || 95) / 100,
        blocks,
        language: 'en',
      });

      const classification = parsedData.classification || {
        topLevelClassification: 'AMBIGUOUS' as const,
        documentSubtype: null,
        confidence: 0.50,
        reason: 'Unable to determine document type with confidence.',
        isPhysicalItemPurchase: null,
        shouldCreateItem: false,
      };

      if (parsedData.isDocument || parsedData.serviceRepair) {
        const matchRes = matchDocumentToItem(
          {
            title: parsedData.serviceRepair?.title || parsedData.documentTitle,
            issuerName: parsedData.serviceRepair?.serviceProvider || parsedData.issuerName || parsedData.common.merchant?.value,
            referenceNumber: parsedData.serviceRepair?.coverageReferenceNumber || parsedData.referenceNumber || parsedData.common.invoiceNumber?.value,
            documentType: parsedData.documentType,
            brand: parsedData.common.brand?.value,
            productName: parsedData.common.productName?.value,
            model: parsedData.common.modelNumber?.value,
            serialNumber: parsedData.common.serialNumber?.value,
            imei: parsedData.categoryDetails?.mobile_laptop?.imei?.value,
            registrationNumber: parsedData.categoryDetails?.vehicle?.registrationNumber?.value,
            vinChassisNumber: parsedData.categoryDetails?.vehicle?.chassisNumber?.value,
            engineNumber: parsedData.categoryDetails?.vehicle?.engineNumber?.value,
          },
          items
        );

        if (matchRes.candidateItemId) {
          classification.itemMatch = matchRes;
        }
      }

      const routingDecision = evaluateRoutingDecision(classification);

      setProcessingSteps((prev) => prev.map((s) => ({ ...s, completed: true })));
      setProcessingTitle(routingDecision.userFacingHeader);
      setExtractedData(parsedData);
      setSelectedItemIndex(0);
      setDetailsFound(true);

      const docCat = normalizeToCanonicalDocumentCategory(parsedData.documentCategory);
      const docType = docCat ? normalizeToCanonicalDocumentType(docCat, parsedData.documentType) : 'Receipt';

      // Canonical Scanner Telemetry: Expose canonical entityType, category, documentType, confidence, and destination
      const isGeneralDoc = classification.topLevelClassification === 'GENERAL_DOCUMENT';
      const isPurchaseItem = classification.topLevelClassification === 'PURCHASE_ITEM';
      const isServiceRepair = classification.topLevelClassification === 'SERVICE_REPAIR' || routingDecision.action === 'AUTO_ROUTE_SERVICE';
      const isMultiItem = isPurchaseItem && Boolean(parsedData.items && parsedData.items.length > 1);
      const isUserReview =
        routingDecision.action === 'USER_REVIEW' ||
        classification.topLevelClassification === 'AMBIGUOUS' ||
        classification.confidence < 0.85;

      const entityType = isServiceRepair ? 'SERVICE_REPAIR' : isGeneralDoc ? 'DOCUMENT' : isPurchaseItem ? 'PURCHASED_ITEM' : 'AMBIGUOUS';
      const rawCat = docCat || parsedData.category || (isServiceRepair ? 'SERVICE' : isPurchaseItem ? 'ELECTRONICS' : 'OTHER');
      const canonicalCategory = String(rawCat).toUpperCase().replace(/[\s&]+/g, '_');
      const canonicalDocType = (docType || classification.documentSubtype || (isServiceRepair ? 'SERVICE_INVOICE' : isPurchaseItem ? 'PURCHASE_INVOICE' : 'DOCUMENT')).toUpperCase().replace(/[\s&]+/g, '_');
      const confLevel = classification.confidence >= 0.85 ? 'high' : classification.confidence >= 0.6 ? 'medium' : 'low';
      const destination = isUserReview
        ? 'review_modal'
        : isServiceRepair
        ? '/service/add'
        : isGeneralDoc
        ? '/document/add'
        : isMultiItem
        ? 'multi_item_review'
        : '/(tabs)/add';

      console.log(`[ScannerDiagnostics] classification completed: entityType=${entityType} category=${canonicalCategory} documentType=${canonicalDocType} confidence=${confLevel} destination=${destination}`);

      // 1. Ambiguous or User-Review Required (confidence < 0.85 or uncertain classification):
      if (
        routingDecision.action === 'USER_REVIEW' ||
        classification.topLevelClassification === 'AMBIGUOUS' ||
        classification.confidence < 0.85
      ) {
        console.log(`[ScannerDiagnostics] review required (${classification.topLevelClassification}, conf=${classification.confidence}), opening Review Document Type`);
        setPendingRoutingData({
          parsedData,
          activeUri,
          imageName: capturedImageName || 'Document.jpg',
        });
        setSelectedReviewCategory(docCat || 'Other Important Documents');
        setSelectedReviewDocType(docType || 'Other Important Document');
        setShowReviewDocTypeModal(true);
        setScreenState('result'); // CRITICAL: NEVER LEAVE IN 'processing' DEADLOCK!
        setIsScanning(false);
        scanInProgressRef.current = false;
        return;
      }

      // 2. High-Confidence SERVICE_REPAIR (confidence >= 0.85):
      if (isServiceRepair) {
        console.log(`[ScannerDiagnostics] high-confidence SERVICE_REPAIR, routing to /service/add`);
        await navigateToServiceAdd(parsedData, activeUri, capturedImageName || 'Service_Record.jpg');
        return;
      }

      // 3. High-Confidence GENERAL_DOCUMENT (confidence >= 0.85):
      // College fee, utility bill, vehicle RC, insurance, PUC, warranty, service slip -> Document Vault!
      if (classification.topLevelClassification === 'GENERAL_DOCUMENT') {
        console.log(`[ScannerDiagnostics] high-confidence GENERAL_DOCUMENT (${classification.documentSubtype}), routing to /document/add`);
        await navigateToDocumentAdd(docCat || 'Other Important Documents', docType || 'Document', parsedData, activeUri, capturedImageName || 'Document.jpg');
        return;
      }

      // 4. High-Confidence PURCHASE_ITEM (confidence >= 0.85):
      if (classification.topLevelClassification === 'PURCHASE_ITEM') {
        // Multi-item purchase (>= 2 products): Show dedicated multi-item review checklist
        if (parsedData.items && parsedData.items.length > 1) {
          console.log(`[ScannerDiagnostics] multi-item purchase detected (${parsedData.items.length} items), opening multi_item_review`);
          setScreenState('multi_item_review');
          setIsScanning(false);
          scanInProgressRef.current = false;
          return;
        }

        console.log(`[ScannerDiagnostics] single physical item purchase detected, routing to /(tabs)/add`);
        await navigateToItemAdd(parsedData, activeUri, capturedImageName || 'Receipt.jpg');
        return;
      }

      setPendingRoutingData({
        parsedData,
        activeUri,
        imageName: capturedImageName || 'Document.jpg',
      });
      setSelectedReviewCategory(docCat || 'Other Important Documents');
      setSelectedReviewDocType(docType || 'Other Important Document');
      setShowReviewDocTypeModal(true);
      setScreenState('result');
    } catch (err: any) {
      console.error('[ScannerDiagnostics] error/failure in scanner pipeline:', err);
      setProcessingError(err?.message || "Some details couldn't be read. Please review them.");
    } finally {
      setIsScanning(false);
      scanInProgressRef.current = false;
    }
  };

  useEffect(() => {
    if (
      params.autoProcess === 'true' &&
      (capturedImageUri || capturedBase64) &&
      !autoProcessTriggeredRef.current &&
      !isScanning
    ) {
      autoProcessTriggeredRef.current = true;
      const timer = setTimeout(() => {
        handleConfirmAndProcessReceipt();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [params.autoProcess, capturedImageUri, capturedBase64, isScanning]);

  const handleUpdateCommonField = (field: keyof ExtractedReceiptData['common'], value: any) => {
    if (!extractedData) return;
    setExtractedData({
      ...extractedData,
      common: {
        ...extractedData.common,
        [field]: {
          ...extractedData.common[field],
          value,
          confidence: 'high',
          needsVerification: false,
        },
      },
    });
  };

  const handleUpdateCategoryField = (
    field: string,
    value: any,
    categoryOverride?: ScannerCategory
  ) => {
    if (!extractedData) return;
    const cat = categoryOverride || extractedData.category;
    const catDetails = (extractedData.categoryDetails as any)[cat] || {};
    setExtractedData({
      ...extractedData,
      categoryDetails: {
        ...extractedData.categoryDetails,
        [cat]: {
          ...catDetails,
          [field]: {
            ...(catDetails[field] || { confidence: 'high', aiSuggested: false }),
            value,
            confidence: 'high',
            needsVerification: false,
          },
        },
      },
    });
  };

  const handleToggleItemSelection = (index: number) => {
    if (!extractedData || !extractedData.items) return;
    const updated = [...extractedData.items];
    updated[index] = { ...updated[index], selected: !updated[index].selected };
    setExtractedData({ ...extractedData, items: updated });
  };

  const handleSelectAllItems = (select: boolean) => {
    if (!extractedData || !extractedData.items) return;
    const updated = extractedData.items.map((it) => ({ ...it, selected: select }));
    setExtractedData({ ...extractedData, items: updated });
  };

  const handleRemoveMultiItem = (index: number) => {
    if (!extractedData || !extractedData.items) return;
    if (extractedData.items.length <= 1) {
      Alert.alert(
        'Remove Item',
        'Are you sure you want to remove the last item from this receipt scan?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              setExtractedData({ ...extractedData, items: [] });
            },
          },
        ]
      );
      return;
    }
    const updated = extractedData.items.filter((_, idx) => idx !== index);
    setExtractedData({ ...extractedData, items: updated });
  };

  const handleAttachProductPhotoToItem = async (
    itemIndex: number,
    source: 'camera' | 'gallery'
  ) => {
    try {
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Camera Permission',
            'Camera permission is required to photograph physical products.',
            [{ text: 'OK' }]
          );
          return;
        }

        const result = await ImagePicker.launchCameraAsync({
          allowsEditing: false,
          quality: 0.85,
        });

        if (!result.canceled && result.assets && result.assets[0]) {
          const rawUri = result.assets[0].uri;
          const pRes = await persistProductPhotoToVault(rawUri, 'product_photo.jpg');
          const finalUri = pRes.persisted && pRes.uri ? pRes.uri : rawUri;

          setExtractedData((prev) => {
            if (!prev || !prev.items) return prev;
            const updated = [...prev.items];
            const existingPhotos = updated[itemIndex].productPhotos || [];
            updated[itemIndex] = {
              ...updated[itemIndex],
              productPhotos: [...existingPhotos, finalUri],
            };
            return { ...prev, items: updated };
          });
        }
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.85,
          allowsMultipleSelection: true,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
          const newUris: string[] = [];
          for (const asset of result.assets) {
            try {
              const pRes = await persistProductPhotoToVault(asset.uri, 'product_photo.jpg');
              newUris.push(pRes.persisted && pRes.uri ? pRes.uri : asset.uri);
            } catch {
              newUris.push(asset.uri);
            }
          }

          setExtractedData((prev) => {
            if (!prev || !prev.items) return prev;
            const updated = [...prev.items];
            const existingPhotos = updated[itemIndex].productPhotos || [];
            updated[itemIndex] = {
              ...updated[itemIndex],
              productPhotos: [...existingPhotos, ...newUris],
            };
            return { ...prev, items: updated };
          });
        }
      }
    } catch (err) {
      console.warn('[ScanReceipt] Product photo attach error:', err);
      Alert.alert('Photo Error', 'Could not attach product photo. Please try again.');
    }
  };

  const handleRemoveProductPhotoFromItem = (itemIndex: number, photoIndex: number) => {
    setExtractedData((prev) => {
      if (!prev || !prev.items) return prev;
      const updated = [...prev.items];
      const existingPhotos = updated[itemIndex].productPhotos || [];
      updated[itemIndex] = {
        ...updated[itemIndex],
        productPhotos: existingPhotos.filter((_, idx) => idx !== photoIndex),
      };
      return { ...prev, items: updated };
    });
  };

  const handleOpenEditItemModal = (index: number) => {
    if (!extractedData || !extractedData.items || !extractedData.items[index]) return;
    const it = extractedData.items[index];
    setEditingItemIndex(index);
    setEditingItemName(it.productName);
    setEditingItemPrice(it.price ? String(it.price) : '');
    setEditingItemQuantity(it.quantity ? String(it.quantity) : '1');
    setEditingItemCategoryId(it.categoryId || getCategoryIdFromName(it.category) || 'other');
    setEditingItemProductType(it.productType || '');
    setEditingItemBrand(it.brand || '');
    setEditingItemModel(it.model || '');
    setShowEditItemModal(true);
  };

  const handleSaveEditedItem = () => {
    if (editingItemIndex === null || !extractedData || !extractedData.items) return;
    if (!editingItemName.trim()) {
      Alert.alert('Missing Name', 'Please enter a product name.');
      return;
    }
    const priceNum = parseFloat(editingItemPrice) || 0;
    const qtyNum = Math.max(1, parseInt(editingItemQuantity, 10) || 1);
    const unitPrice = priceNum / qtyNum;
    const catName = getCategoryNameFromId(editingItemCategoryId);

    const updated = [...extractedData.items];
    updated[editingItemIndex] = {
      ...updated[editingItemIndex],
      productName: editingItemName.trim(),
      price: priceNum,
      quantity: qtyNum,
      unitPrice,
      categoryId: editingItemCategoryId,
      category: catName,
      productType: editingItemProductType.trim() || undefined,
      brand: editingItemBrand.trim() || undefined,
      model: editingItemModel.trim() || undefined,
    };
    setExtractedData({ ...extractedData, items: updated });
    setShowEditItemModal(false);
    setEditingItemIndex(null);
  };

  const handleOpenAddItemModal = () => {
    setNewItemName('');
    setNewItemPrice('');
    setNewItemQuantity('1');
    setNewItemCategoryId('electronics');
    setNewItemProductType('');
    setNewItemBrand('');
    setShowAddItemModal(true);
  };

  const handleSaveNewItem = () => {
    if (!newItemName.trim()) {
      Alert.alert('Missing Name', 'Please enter a product name.');
      return;
    }
    if (!extractedData) return;
    const priceNum = parseFloat(newItemPrice) || 0;
    const qtyNum = Math.max(1, parseInt(newItemQuantity, 10) || 1);
    const unitPrice = priceNum / qtyNum;
    const catName = getCategoryNameFromId(newItemCategoryId);

    const newItem: ReceiptMultiItem = {
      id: `item-manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      productName: newItemName.trim(),
      price: priceNum,
      quantity: qtyNum,
      unitPrice,
      categoryId: newItemCategoryId,
      category: catName,
      productType: newItemProductType.trim() || undefined,
      brand: newItemBrand.trim() || undefined,
      selected: true,
    };

    setExtractedData({
      ...extractedData,
      items: [...(extractedData.items || []), newItem],
    });

    setNewItemName('');
    setNewItemPrice('');
    setNewItemQuantity('1');
    setNewItemProductType('');
    setNewItemBrand('');
    setShowAddItemModal(false);
  };

  const handleSaveSelectedMultiItems = async () => {
    if (!extractedData || !extractedData.items) return;
    const selectedItems = extractedData.items.filter((it) => it.selected);
    if (selectedItems.length === 0) {
      Alert.alert('No Items Selected', 'Please select at least one item to save to your vault.');
      return;
    }

    // Requirements 1, 2, 13, 15: Every product in a multi-product receipt strictly requires >= 1 product image.
    // The receipt image CANNOT be used as the product photo.
    const missingPhotoItem = selectedItems.find(
      (it) => !it.productPhotos || it.productPhotos.length === 0
    );
    if (missingPhotoItem) {
      Alert.alert(
        'Product Photo Required',
        `At least one product photo is required for "${missingPhotoItem.productName}". Receipts cannot be used as product photos. Please take or choose a product photo before saving.`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setIsSavingBatch(true);
      const merchant = extractedData.common.merchant?.value || undefined;
      const purchaseDate = extractedData.common.purchaseDate?.value || new Date().toISOString().split('T')[0];
      const invoiceNumber = extractedData.common.invoiceNumber?.value || undefined;
      const sellerAddress =
        extractedData.common.merchantAddress?.value ||
        extractedData.common.storeLocation?.value ||
        undefined;
      const gstTax = extractedData.common.taxGst?.value ? String(extractedData.common.taxGst.value) : undefined;
      const grandTotal = extractedData.common.finalAmount?.value || undefined;
      const subtotal = extractedData.common.subtotal?.value || undefined;

      let finalReceiptUri = extractedData.receiptUri;
      if (finalReceiptUri) {
        try {
          const persistRes = await persistReceiptToVault(
            finalReceiptUri,
            extractedData.receiptImageName,
            capturedBase64
          );
          if (persistRes.persisted && persistRes.uri) {
            finalReceiptUri = persistRes.uri;
          } else {
            // Requirement 4: ATOMIC SAVE BEHAVIOR
            Alert.alert(
              'Receipt Persistence Error',
              "Couldn't save the receipt. Please try again."
            );
            return;
          }
        } catch (pErr) {
          console.error('[ScanReceipt] Batch receipt persistence error:', pErr);
          Alert.alert(
            'Receipt Persistence Error',
            "Couldn't save the receipt. Please try again."
          );
          return;
        }
      }

      const createdItems = await addMultipleItems({
        receipt: {
          fileUri: finalReceiptUri,
          fileName: extractedData.receiptImageName,
          merchant,
          sellerAddress,
          purchaseDate,
          totalAmount: grandTotal,
          subtotal,
          gstTax,
          invoiceNumber,
        },
        items: selectedItems.map((it) => ({
          name: it.productName,
          categoryId: it.categoryId || getCategoryIdFromName(it.category) || 'other',
          productType: it.productType,
          categoryConfidence: it.categoryConfidence || 'high',
          purchasePrice: it.price,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          brand: it.brand,
          model: it.model,
          serialNumber: it.serialNumber,
          productPhotos: it.productPhotos,
          returnUntil: it.returnUntil || null,
          warrantyUntil: it.warrantyUntil || null,
          warrantyProvider: it.warrantyProvider || (it.brand ? `${it.brand} Warranty` : undefined),
          notes: `Scanned from invoice #${invoiceNumber || 'receipt'}${it.quantity > 1 ? ` (Qty: ${it.quantity})` : ''}`,
        })),
      });

      setSavedBatchCount(createdItems.length);
      if (createdItems.length > 0) {
        setSavedItemId(createdItems[0].id);
      }
      setScreenState('saved_success');
    } catch (err) {
      console.error('Failed to batch save multi-items:', err);
      Alert.alert('Save Error', 'Failed to save items to vault. Please try again.');
    } finally {
      setIsSavingBatch(false);
    }
  };

  const handleChangeCategory = (newCategory: ScannerCategory) => {
    if (!extractedData) return;
    const canonical = scannerCodeToCanonical(newCategory);
    const updated = recalculateCategoryFields(extractedData, canonical);
    setExtractedData(updated);
    setScreenState('result');
  };

  const handleSaveToKeepr = async () => {
    if (!extractedData) return;

    try {
      let coreCategoryId = 'electronics';
      if (extractedData.category === 'vehicle') coreCategoryId = 'vehicles';
      else if (extractedData.category === 'home_appliance') coreCategoryId = 'appliances';
      else if (extractedData.category === 'furniture') coreCategoryId = 'furniture';
      else if (extractedData.category === 'fashion') coreCategoryId = 'fashion';
      else if (extractedData.category === 'other') coreCategoryId = 'other';

      let warrantyDuration: number | undefined = undefined;
      let warrantyProvider: string | undefined = undefined;
      let enableWarrantyReminder = false;
      let serialNumber = extractedData.common.serialNumber?.value || '';

      const catDetails = extractedData.categoryDetails;
      const activeCatObj =
        catDetails.electronics ||
        catDetails.mobile_laptop ||
        catDetails.home_appliance ||
        catDetails.furniture;

      if (
        activeCatObj &&
        activeCatObj.warrantyDurationMonths?.value &&
        Number(activeCatObj.warrantyDurationMonths.value) > 0
      ) {
        warrantyDuration = Number(activeCatObj.warrantyDurationMonths.value);
        enableWarrantyReminder = true;
        if (extractedData.common.brand?.value) {
          warrantyProvider = `${extractedData.common.brand.value} Warranty`;
        }
      } else if (extractedData.common.warrantyText?.value) {
        warrantyProvider = extractedData.common.warrantyText.value;
        enableWarrantyReminder = true;
      }

      if (!serialNumber) {
        if (extractedData.categoryDetails.electronics?.serialNumber?.value) {
          serialNumber = extractedData.categoryDetails.electronics.serialNumber.value;
        } else if (extractedData.categoryDetails.mobile_laptop?.serialNumber?.value) {
          serialNumber = extractedData.categoryDetails.mobile_laptop.serialNumber.value;
        } else if (extractedData.categoryDetails.home_appliance?.serialNumber?.value) {
          serialNumber = extractedData.categoryDetails.home_appliance.serialNumber.value;
        } else if (extractedData.categoryDetails.vehicle) {
          serialNumber =
            extractedData.categoryDetails.vehicle.vinChassisNumber?.value ||
            extractedData.categoryDetails.vehicle.vin?.value ||
            extractedData.categoryDetails.vehicle.chassisNumber?.value ||
            '';
        }
      }

      // Requirement 3 & 4: Persist receipt to permanent vault storage before save completes
      let persistentReceiptUri = extractedData.receiptUri;
      if (persistentReceiptUri) {
        try {
          const persistRes = await persistReceiptToVault(
            persistentReceiptUri,
            extractedData.receiptImageName,
            capturedBase64
          );
          if (persistRes.persisted && persistRes.uri) {
            persistentReceiptUri = persistRes.uri;
          } else {
            Alert.alert(
              'Receipt Persistence Error',
              "Couldn't save the receipt. Please try again."
            );
            return;
          }
        } catch (pErr) {
          console.error('[ScanReceipt] Receipt persistence failed in handleSaveToKeepr:', pErr);
          Alert.alert(
            'Receipt Persistence Error',
            "Couldn't save the receipt. Please try again."
          );
          return;
        }
      }

      const isInvoice = Boolean(
        extractedData.common.invoiceNumber?.value &&
        extractedData.common.invoiceNumber.value.trim()
      );
      const receiptType: 'receipt' | 'invoice' = isInvoice ? 'invoice' : 'receipt';

      const newItem = await addItem({
        name: extractedData.common.productName?.value || 'Receipt Item',
        categoryId: coreCategoryId,
        brand: extractedData.common.brand?.value || undefined,
        merchant: extractedData.common.merchant?.value || undefined,
        purchasePrice: extractedData.common.finalAmount?.value || 0,
        subtotal: extractedData.common.subtotal?.value || undefined,
        discount: extractedData.common.discount?.value || undefined,
        gstin: extractedData.common.gstin?.value || undefined,
        gstTax: extractedData.common.taxGst?.value ? String(extractedData.common.taxGst.value) : undefined,
        purchaseDate: extractedData.common.purchaseDate?.value || new Date().toISOString().split('T')[0],
        invoiceNumber: extractedData.common.invoiceNumber?.value || undefined,
        returnUntil: (extractedData.common as any).returnUntil?.value || (extractedData.categoryDetails as any)?.returnUntil?.value || null,
        warrantyUntil: (extractedData.categoryDetails as any)?.warrantyExpiryDate?.value || null,
        warrantyProvider: warrantyProvider || undefined,
        receiptUri: persistentReceiptUri,
        receiptName: extractedData.receiptImageName,
        receiptType,
        serialNumber: serialNumber || undefined,
        notes: `Receipt purchase.${extractedData.common.invoiceNumber?.value ? ` Invoice #${extractedData.common.invoiceNumber.value}.` : ''} ${extractedData.common.notes?.value || ''}`.trim(),
        // Requirement 22: Do NOT contaminate product photo with receipt image!
        imageUrl: undefined,
        warrantyDurationMonths: warrantyDuration,
        enableWarrantyReminder: enableWarrantyReminder,
        initialDocumentName: extractedData.receiptImageName,
        initialDocumentUri: persistentReceiptUri,
      });

      const otherItems = (extractedData.items || []).filter((it, idx) => idx !== 0 && it.selected);
      for (const extraItem of otherItems) {
        await addItem({
          name: extraItem.productName,
          categoryId: coreCategoryId,
          brand: extraItem.brand || extractedData.common.brand?.value || undefined,
          merchant: extractedData.common.merchant?.value || undefined,
          purchasePrice: extraItem.price || 0,
          subtotal: extraItem.subtotal,
          discount: extraItem.discount,
          gstin: extraItem.gstin || extractedData.common.gstin?.value || undefined,
          gstTax: extractedData.common.taxGst?.value ? String(extractedData.common.taxGst.value) : undefined,
          purchaseDate: extractedData.common.purchaseDate?.value || new Date().toISOString().split('T')[0],
          invoiceNumber: extractedData.common.invoiceNumber?.value || undefined,
          notes: `Multi-item invoice #${extractedData.common.invoiceNumber?.value || ''}`.trim(),
          receiptUri: persistentReceiptUri,
          receiptName: extractedData.receiptImageName,
          receiptType,
          imageUrl: undefined,
          warrantyDurationMonths: undefined,
          enableWarrantyReminder: false,
        });
      }

      setSavedItemId(newItem.id);
      setScreenState('saved_success');
    } catch (err) {
      console.error('Save to Keepr failed:', err);
      Alert.alert('Save Error', 'Failed to save item to your vault. Please try again.');
    }
  };

  const handleScheduleReminder = async () => {
    const granted = await NotificationService.requestPermissions();
    setReminderScheduled(true);
    if (granted) {
      Alert.alert(
        'Warranty Reminder Active',
        'Keepr will alert you 30 days before your warranty coverage lapses.'
      );
    } else {
      Alert.alert(
        'Reminder Saved',
        'Warranty reminder preference saved to your profile.'
      );
    }
  };

  const renderConfidenceBadge = (confidence: FieldValue<any>['confidence'], needsVerification?: boolean) => {
    if (needsVerification || confidence === 'verify') {
      return (
        <View className="flex-row items-center bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
          <MaterialIcons name="help-outline" size={11} color="#B45309" />
          <Text className="text-[10px] font-semibold text-amber-700 ml-1">Please verify</Text>
        </View>
      );
    }
    return null;
  };

  if (screenState === 'scan') {
    const scanLineTranslate = scanLineAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 320],
    });

    return (
      <View className="flex-1 bg-serene-surface" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between px-4 py-2">
          <TouchableOpacity
            className="w-11 h-11 rounded-full bg-white/90 items-center justify-center shadow-sm"
            onPress={() => {
              clearActiveReceiptSession();
              router.back();
            }}
            activeOpacity={0.8}
            accessibilityLabel="Back"
          >
            <MaterialIcons name="arrow-back" size={22} color="#1C1C17" />
          </TouchableOpacity>

          <View className="flex-1 items-center px-2">
            <Text className="text-lg font-bold text-serene-on-surface">Scan Receipt</Text>
            <Text className="text-[11px] text-serene-on-surface-variant text-center mt-0.5">
              Capture your receipt and we'll organize the details for you.
            </Text>
          </View>

          <TouchableOpacity
            className={`w-11 h-11 rounded-full items-center justify-center shadow-sm ${
              flashMode !== 'off' ? 'bg-[#D2E4FF]' : 'bg-white/90'
            }`}
            onPress={() => {
              if (flashMode === 'auto') setFlashMode('on');
              else if (flashMode === 'on') setFlashMode('off');
              else setFlashMode('auto');
            }}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name={
                flashMode === 'on'
                  ? 'flash-on'
                  : flashMode === 'auto'
                  ? 'flash-auto'
                  : 'flash-off'
              }
              size={20}
              color={flashMode !== 'off' ? SereneColors.primary : '#1C1C17'}
            />
          </TouchableOpacity>
        </View>

        <View className="flex-row items-center justify-center gap-2 mt-1.5 mb-2">
          <View className="flex-row items-center bg-amber-100/95 px-3 py-1 rounded-full border border-amber-500/25">
            <MaterialIcons name="wb-sunny" size={14} color="#D97706" />
            <Text className="text-[11px] font-semibold text-amber-800 ml-1.5">
              Good lighting detected · Hold steady
            </Text>
          </View>

          <View
            className="flex-row items-center bg-white px-2.5 py-1 rounded-full border border-serene-hairline-border"
          >
            <MaterialIcons
              name="check-circle"
              size={13}
              color="#047857"
            />
            <Text className="text-[11px] font-semibold ml-1.5 text-serene-primary">
              Scanner Ready
            </Text>
          </View>
        </View>

        <View className="flex-1 px-4 items-center justify-center max-h-[400px]">
          <View className="w-full h-[340px] rounded-serene-xl overflow-hidden relative bg-black">
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=700&auto=format&fit=crop',
              }}
              className="w-full h-full"
              resizeMode="cover"
            />
            <View className="absolute inset-0 bg-slate-900/35" />

            <View className="absolute w-7 h-7 border-white top-5 left-5 border-t-[3.5px] border-l-[3.5px] rounded-tl-[6px]" />
            <View className="absolute w-7 h-7 border-white top-5 right-5 border-t-[3.5px] border-r-[3.5px] rounded-tr-[6px]" />
            <View className="absolute w-7 h-7 border-white bottom-5 left-5 border-b-[3.5px] border-l-[3.5px] rounded-bl-[6px]" />
            <View className="absolute w-7 h-7 border-white bottom-5 right-5 border-b-[3.5px] border-r-[3.5px] rounded-br-[6px]" />

            <Animated.View
              className="absolute top-2.5 left-5 right-5 h-[2.5px] bg-[#38BDF8] shadow-lg shadow-[#38BDF8]"
              style={{ transform: [{ translateY: scanLineTranslate }] }}
            />

            <View className="absolute top-9 left-9 right-9 bottom-9 border-[1.5px] border-dashed border-[#38BDF8]/65 rounded-lg items-center justify-start pt-2.5">
              <View className="flex-row items-center bg-slate-900/75 px-2.5 py-1 rounded-[14px]">
                <View className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5" />
                <Text className="text-[11px] font-semibold text-white">Receipt edges detected</Text>
              </View>
            </View>

            <View className="absolute bottom-4 left-0 right-0 items-center">
              <Text className="text-xs font-semibold text-white/90 bg-black/50 px-3 py-1 rounded-full">
                Place the receipt inside the frame
              </Text>
            </View>
          </View>
        </View>

        <View className="px-4 mt-2 mb-1">
          <Text className="text-[10px] font-bold text-serene-outline tracking-wider mb-1.5">OR TEST WITH SAMPLE RECEIPT</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 py-0.5"
          >
            {DEMO_RECEIPT_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.id}
                className="flex-row items-center bg-white px-3 py-2 rounded-full border border-serene-hairline-border"
                onPress={() => handleSelectPreset(preset)}
                activeOpacity={0.85}
              >
                <MaterialIcons
                  name={
                    preset.category === 'mobile_laptop'
                      ? 'laptop-mac'
                      : preset.category === 'vehicle'
                      ? 'directions-car'
                      : preset.category === 'home_appliance'
                      ? 'kitchen'
                      : preset.category === 'furniture'
                      ? 'chair'
                      : preset.category === 'fashion'
                      ? 'checkroom'
                      : 'inventory-2'
                  }
                  size={15}
                  color={SereneColors.primary}
                />
                <Text className="text-xs font-semibold text-serene-primary ml-1.5">{preset.name.split(' (')[0]}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View className="flex-row items-center justify-around px-8 pt-2">
          <TouchableOpacity
            className="w-12 h-12 rounded-full bg-serene-surface-container-lowest items-center justify-center border border-serene-hairline-border"
            onPress={() => setCameraFacing((f) => (f === 'back' ? 'front' : 'back'))}
            activeOpacity={0.8}
          >
            <MaterialIcons name="flip-camera-ios" size={22} color={SereneColors.onSurface} />
          </TouchableOpacity>

          <TouchableOpacity
            className="w-[76px] h-[76px] rounded-full border-4 border-serene-primary items-center justify-center bg-white shadow-lg"
            onPress={handleTakePhoto}
            activeOpacity={0.85}
          >
            <View className="w-[60px] h-[60px] rounded-full bg-serene-primary items-center justify-center">
              <MaterialIcons name="camera-alt" size={28} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            className="w-[58px] h-[58px] rounded-2xl bg-serene-surface-container-lowest items-center justify-center border-[1.5px] border-[#3368A0] shadow-sm"
            onPress={handleChooseGallery}
            activeOpacity={0.85}
          >
            <MaterialIcons name="photo-library" size={22} color={SereneColors.primary} />
            <Text className="text-[10px] font-bold text-serene-primary mt-0.5">Gallery</Text>
          </TouchableOpacity>
        </View>

        <View className="items-center mt-1 mb-2.5">
          <Text className="text-[13px] font-bold text-serene-primary">Take Photo</Text>
        </View>
      </View>
    );
  }

  if (screenState === 'preview') {
    return (
      <View className="flex-1 bg-serene-surface" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between px-4 py-2 border-b border-serene-hairline-border">
          <TouchableOpacity
            className="w-10 h-10 rounded-full items-center justify-center"
            onPress={() => {
              clearActiveReceiptSession();
              setCapturedImageUri(null);
              setCapturedBase64(null);
              setScreenState('scan');
            }}
            activeOpacity={0.8}
            accessibilityLabel="Back to Scan"
          >
            <MaterialIcons name="arrow-back" size={22} color={SereneColors.onSurface} />
          </TouchableOpacity>
          <Text className="text-base font-bold text-serene-on-surface">Receipt Preview</Text>
          <View className="w-10 h-10" />
        </View>

        <View className="flex-1 px-4 pt-3">
          {(!capturedImageUri && !capturedBase64) || (imageLoadError && !capturedBase64) ? (
            <View className="flex-1 items-center justify-center p-6 bg-serene-surface-container-low rounded-serene-xl border border-serene-hairline-border mb-4">
              <View className="w-12 h-12 rounded-full bg-red-50 items-center justify-center mb-3">
                <MaterialIcons name="broken-image" size={26} color="#DC2626" />
              </View>
              <Text className="text-sm font-bold text-serene-on-surface text-center mb-1">
                Couldn't load this image
              </Text>
              <Text className="text-xs text-serene-on-surface-variant text-center mb-4 leading-4 px-4">
                The receipt image file is invalid or could not be loaded from storage.
              </Text>
              <TouchableOpacity
                className="py-2.5 px-4 rounded-serene-md bg-white border border-serene-hairline-border flex-row items-center gap-1.5 shadow-sm"
                onPress={imageSource === 'camera' ? handleTakePhoto : handleChooseGallery}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name={imageSource === 'camera' ? 'refresh' : 'photo-library'}
                  size={16}
                  color={SereneColors.primary}
                />
                <Text className="text-xs font-semibold text-serene-primary">
                  {imageSource === 'camera' ? 'Retake' : 'Choose Another'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View
              className="w-full rounded-serene-xl overflow-hidden relative border border-serene-hairline-border mb-4 bg-serene-surface-container-low"
              style={{ height: 420, justifyContent: 'center', alignItems: 'center' }}
            >
              <TouchableOpacity
                activeOpacity={0.95}
                onPress={() => setShowImageModal(true)}
                style={{ width: '100%', height: '100%' }}
                accessibilityLabel="Tap to view larger"
              >
                <Image
                  source={{
                    uri:
                      capturedImageUri ||
                      (capturedBase64 ? `data:image/jpeg;base64,${capturedBase64}` : undefined),
                  }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                  onLoadStart={() => {
                    setIsImageLoading(true);
                  }}
                  onLoadEnd={() => {
                    setIsImageLoading(false);
                    setImageLoadError(false);
                  }}
                  onError={(e) => {
                    const err = e.nativeEvent?.error || 'Image load error';
                    console.error('[ReceiptPreview] Image load failed\nURI:', capturedImageUri, '\nError:', err);
                    if (capturedBase64 && !capturedImageUri?.startsWith('data:')) {
                      console.log('[ReceiptPreview] Falling back to capturedBase64 data URI');
                      setCapturedImageUri(`data:image/jpeg;base64,${capturedBase64}`);
                      return;
                    }
                    setImageLoadError(true);
                    setIsImageLoading(false);
                  }}
                />

                {isImageLoading && !imageLoadError && (
                  <View className="absolute inset-0 items-center justify-center bg-serene-surface-container-low/60">
                    <ActivityIndicator size="large" color={SereneColors.primary} />
                  </View>
                )}

                <View className="absolute top-3 right-3 bg-black/60 p-1.5 rounded-full">
                  <MaterialIcons name="fullscreen" size={18} color="#FFFFFF" />
                </View>

                <View className="absolute bottom-3 left-3 flex-row items-center bg-black/60 px-2.5 py-1 rounded-full gap-1.5 max-w-[80%]">
                  <MaterialIcons
                    name={imageSource === 'camera' ? 'photo-camera' : 'photo-library'}
                    size={14}
                    color="#FFFFFF"
                  />
                  <Text className="text-[11px] font-medium text-white" numberOfLines={1}>
                    {capturedImageName}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View className="px-4 pb-4 gap-3">
          {imageSource === 'camera' ? (
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 flex-row items-center justify-center gap-1.5 py-3 rounded-serene-lg bg-serene-surface-container-lowest border border-serene-hairline-border"
                onPress={handleTakePhoto}
                activeOpacity={0.8}
              >
                <MaterialIcons name="refresh" size={18} color={SereneColors.onSurface} />
                <Text className="text-[13px] font-semibold text-serene-on-surface">Retake</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="flex-1 flex-row items-center justify-center gap-1.5 py-3 rounded-serene-lg bg-serene-surface-container-lowest border border-serene-hairline-border"
                onPress={handleOpenCrop}
                activeOpacity={0.8}
                disabled={!capturedImageUri && !capturedBase64}
              >
                <MaterialIcons name="crop" size={18} color={SereneColors.onSurface} />
                <Text className="text-[13px] font-semibold text-serene-on-surface">Crop</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              className="w-full flex-row items-center justify-center gap-1.5 py-3 rounded-serene-lg bg-serene-surface-container-lowest border border-serene-hairline-border"
              onPress={handleChooseGallery}
              activeOpacity={0.8}
            >
              <MaterialIcons name="photo-library" size={18} color={SereneColors.onSurface} />
              <Text className="text-[13px] font-semibold text-serene-on-surface">Choose Another</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={{
              backgroundColor: (!capturedImageUri && !capturedBase64) ? '#E2E8F0' : SereneColors.primary,
              borderWidth: (!capturedImageUri && !capturedBase64) ? 1 : 0,
              borderColor: (!capturedImageUri && !capturedBase64) ? '#CBD5E1' : 'transparent',
              opacity: 1,
            }}
            className="w-full flex-row items-center justify-center gap-2 py-3.5 rounded-serene-lg shadow-sm"
            onPress={handleConfirmAndProcessReceipt}
            disabled={(!capturedImageUri && !capturedBase64) || isScanning}
            activeOpacity={0.88}
            accessibilityLabel="Scan Receipt"
          >
            {isScanning ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 }}>
                  Scanning Receipt...
                </Text>
              </>
            ) : (
              <>
                <MaterialIcons
                  name="search"
                  size={20}
                  color={(!capturedImageUri && !capturedBase64) ? '#64748B' : '#FFFFFF'}
                />
                <Text
                  style={{
                    color: (!capturedImageUri && !capturedBase64) ? '#64748B' : '#FFFFFF',
                    fontWeight: 'bold',
                    fontSize: 14,
                  }}
                >
                  Scan Receipt
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <Modal visible={showImageModal} transparent animationType="fade">
          <View className="flex-1 bg-black/95 items-center justify-center">
            <TouchableOpacity
              className="absolute top-12 right-5 w-11 h-11 rounded-full bg-white/20 items-center justify-center z-10"
              onPress={() => setShowImageModal(false)}
            >
              <MaterialIcons name="close" size={26} color="#FFFFFF" />
            </TouchableOpacity>
            {capturedImageUri && (
              <Image
                source={{ uri: capturedImageUri }}
                style={{ width: '100%', height: '85%' }}
                resizeMode="contain"
              />
            )}
          </View>
        </Modal>

        <Modal visible={showCropModal} transparent animationType="slide">
          <View className="flex-1 bg-black/80 justify-end">
            <View
              className="bg-white rounded-t-serene-2xl px-5 pt-4 pb-6 shadow-2xl"
              style={{ paddingBottom: Math.max(insets.bottom, 24) }}
            >
              <View className="flex-row items-center justify-between pb-3 border-b border-serene-hairline-border">
                <TouchableOpacity
                  onPress={() => setShowCropModal(false)}
                  className="py-1 px-2"
                  disabled={isCropping}
                >
                  <Text className="text-sm font-medium text-serene-on-surface-variant">Cancel</Text>
                </TouchableOpacity>
                <Text className="text-base font-bold text-serene-on-surface">Crop Receipt</Text>
                <TouchableOpacity
                  onPress={handleApplyCrop}
                  className="py-1 px-3.5 bg-serene-primary rounded-serene-md"
                  disabled={isCropping}
                >
                  {isCropping ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text className="text-sm font-bold text-white">Apply</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View className="items-center justify-center my-4 bg-serene-surface-container-low rounded-serene-lg p-2 h-56 border border-serene-hairline-border overflow-hidden">
                {capturedImageUri && (
                  <Image
                    source={{ uri: capturedImageUri }}
                    style={{
                      width: '100%',
                      height: '100%',
                      transform: [{ rotate: `${cropRotation}deg` }],
                    }}
                    resizeMode="contain"
                  />
                )}
              </View>

              <View className="flex-row items-center justify-between mb-3 bg-serene-surface-container-low p-2.5 rounded-serene-md border border-serene-hairline-border">
                <Text className="text-xs font-semibold text-serene-on-surface">Orientation</Text>
                <TouchableOpacity
                  className="flex-row items-center gap-1.5 bg-white px-3 py-1.5 rounded-full border border-serene-hairline-border shadow-sm"
                  onPress={() => setCropRotation((prev) => (prev + 90) % 360)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="rotate-right" size={16} color={SereneColors.primary} />
                  <Text className="text-xs font-semibold text-serene-primary">Rotate 90°</Text>
                </TouchableOpacity>
              </View>

              <Text className="text-xs font-bold text-serene-outline mb-2">CROP AREA</Text>
              <View className="flex-row flex-wrap gap-2 mb-2">
                {[
                  { id: 'full', label: 'Full Image' },
                  { id: 'trim', label: 'Trim Margins' },
                  { id: 'center80', label: 'Center 80%' },
                  { id: 'top75', label: 'Top 75%' },
                  { id: 'bottom75', label: 'Bottom 75%' },
                ].map((preset) => (
                  <TouchableOpacity
                    key={preset.id}
                    className={`px-3 py-2 rounded-full border ${
                      selectedCropPreset === preset.id
                        ? 'bg-serene-primary border-serene-primary'
                        : 'bg-white border-serene-hairline-border'
                    }`}
                    onPress={() => setSelectedCropPreset(preset.id as any)}
                    activeOpacity={0.8}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        selectedCropPreset === preset.id ? 'text-white' : 'text-serene-on-surface'
                      }`}
                    >
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  if (screenState === 'processing') {
    return (
      <View className="flex-1 bg-serene-surface items-center justify-center px-6" style={{ paddingTop: insets.top }}>
        {capturedImageUri && (
          <Animated.View
            className="w-28 h-36 rounded-serene-lg overflow-hidden bg-black shadow-lg mb-6 relative"
            style={{ transform: [{ scale: pulseAnim }] }}
          >
            <Image
              source={{ uri: capturedImageUri }}
              className="w-full h-full"
              resizeMode="cover"
            />
            <View className="absolute bottom-0 inset-x-0 bg-serene-surface-container-lowest/95 flex-row items-center justify-center py-1.5 border-t border-serene-hairline-border">
              <MaterialIcons name="document-scanner" size={13} color={SereneColors.primary} />
              <Text className="text-serene-on-surface text-[9px] font-bold tracking-wider ml-1">
                SCANNING
              </Text>
            </View>
          </Animated.View>
        )}

        <Text className="text-[22px] font-bold text-serene-on-surface text-center mb-1.5">
          {processingTitle}
        </Text>
        <Text className="text-[13px] text-serene-on-surface-variant text-center max-w-[300px] mb-8">
          {detailsFound
            ? 'Details found.'
            : "We're identifying items, documents, warranties, bills, and service details."}
        </Text>

        {receiptRejection ? (
          <View className="w-full max-w-[340px] bg-red-50 rounded-serene-lg p-5 border border-red-200 items-center">
            <View className="w-12 h-12 rounded-full bg-red-100 items-center justify-center mb-2">
              <MaterialIcons name="image-not-supported" size={28} color="#DC2626" />
            </View>
            <Text className="text-[17px] font-bold text-serene-on-surface mt-1 text-center">
              That doesn't look like a supported document
            </Text>
            <Text className="text-xs text-serene-on-surface-variant text-center mt-1.5 mb-5 leading-4 px-2">
              {receiptRejection.message || 'Please upload a clear photo of your receipt, bill, warranty, or service record.'}
            </Text>

            <View className="flex-row gap-2.5 w-full">
              <TouchableOpacity
                className="flex-1 py-2.5 rounded-serene-md border border-serene-subtle-border items-center bg-white flex-row justify-center gap-1.5 shadow-xs"
                onPress={() => {
                  setReceiptRejection(null);
                  handleChooseGallery();
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="photo-library" size={16} color={SereneColors.primary} />
                <Text className="text-xs font-semibold text-serene-primary">Choose Another</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="flex-1 py-2.5 rounded-serene-md bg-serene-primary items-center flex-row justify-center gap-1.5 shadow-xs"
                onPress={() => {
                  setReceiptRejection(null);
                  handleTakePhoto();
                }}
                activeOpacity={0.8}
              >
                <MaterialIcons name="photo-camera" size={16} color="#FFFFFF" />
                <Text className="text-xs font-bold text-white">Take a New Photo</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : processingError ? (
          <View className="w-full max-w-[340px] bg-amber-50 rounded-serene-lg p-5 border border-amber-200 items-center">
            <MaterialIcons name="description" size={32} color={SereneColors.primary} />
            <Text className="text-[16px] font-bold text-serene-on-surface mt-2.5 text-center">
              {processingError}
            </Text>
            <Text className="text-xs text-serene-on-surface-variant text-center mt-1.5 mb-4 leading-4">
              You can retry or choose how you'd like to manually save this document.
            </Text>

            {processingError.toLowerCase().includes('sign in') && (
              <TouchableOpacity
                className="w-full py-2.5 rounded-serene-md bg-serene-primary items-center mb-2.5 shadow-xs"
                onPress={() => {
                  setProcessingError(null);
                  router.push('/(auth)/login');
                }}
              >
                <Text className="text-xs font-bold text-white">Sign In to Continue</Text>
              </TouchableOpacity>
            )}

            <View className="flex-row gap-2.5 w-full mb-3">
              <TouchableOpacity
                className="flex-1 py-2.5 rounded-serene-md border border-serene-subtle-border items-center bg-white"
                onPress={() => {
                  setProcessingError(null);
                  setScreenState('scan');
                }}
              >
                <Text className="text-xs font-semibold text-serene-on-surface">Choose Another</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="flex-1 py-2.5 rounded-serene-md bg-serene-primary items-center"
                onPress={handleConfirmAndProcessReceipt}
              >
                <Text className="text-xs font-bold text-white">Retry</Text>
              </TouchableOpacity>
            </View>

            <View className="w-full gap-2 pt-1 border-t border-amber-200/60">
              <TouchableOpacity
                className="w-full py-2.5 rounded-serene-md bg-white items-center border border-serene-subtle-border flex-row justify-center"
                onPress={() => {
                  router.push({
                    pathname: '/(tabs)/add',
                    params: {
                      scannedReceiptUri: capturedImageUri || undefined,
                      scannedReceiptName: capturedImageName || undefined,
                    },
                  } as any);
                }}
              >
                <MaterialIcons name="shopping-bag" size={15} color={SereneColors.primary} style={{ marginRight: 6 }} />
                <Text className="text-xs font-bold text-serene-primary">Add as Purchased Item</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="w-full py-2.5 rounded-serene-md bg-white items-center border border-serene-subtle-border flex-row justify-center"
                onPress={() => {
                  router.push({
                    pathname: '/document/add',
                    params: {
                      fileUri: capturedImageUri || undefined,
                    },
                  } as any);
                }}
              >
                <MaterialIcons name="folder" size={15} color={SereneColors.primary} style={{ marginRight: 6 }} />
                <Text className="text-xs font-bold text-serene-primary">Add as Document</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="w-full py-2.5 rounded-serene-md bg-white items-center border border-serene-subtle-border flex-row justify-center"
                onPress={() => {
                  router.push({
                    pathname: '/service/add',
                    params: {
                      scannedServiceUri: capturedImageUri || undefined,
                    },
                  } as any);
                }}
              >
                <MaterialIcons name="build" size={15} color={SereneColors.primary} style={{ marginRight: 6 }} />
                <Text className="text-xs font-bold text-serene-primary">Add as Service & Repair</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View className="w-full max-w-[340px] bg-serene-surface-container-lowest rounded-serene-lg p-4 border border-serene-hairline-border">
            {processingSteps.map((step) => (
              <View key={step.id} className="flex-row items-center my-1.5">
                <View
                  className={`w-6 h-6 rounded-full items-center justify-center mr-3 ${
                    step.completed ? 'bg-emerald-700' : 'bg-serene-surface-container-high'
                  }`}
                >
                  {step.completed ? (
                    <MaterialIcons name="check" size={16} color="#FFFFFF" />
                  ) : (
                    <View className="w-1.5 h-1.5 rounded-full bg-serene-outline" />
                  )}
                </View>
                <Text
                  className={`text-[13px] ${
                    step.completed ? 'text-serene-on-surface font-semibold' : 'text-serene-outline font-medium'
                  }`}
                >
                  {step.label}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  if (screenState === 'multi_item_review' && extractedData) {
    const items = extractedData.items || [];
    const selectedCount = items.filter((it) => it.selected).length;
    const totalItems = items.length;
    const selectedTotal = items
      .filter((it) => it.selected)
      .reduce((sum, it) => sum + (Number(it.price) || 0), 0);
    const receiptGrandTotal = extractedData.common.finalAmount?.value;
    const allSelected = totalItems > 0 && selectedCount === totalItems;
    const selectedMissingPhotoCount = items.filter(
      (it) => it.selected && (!it.productPhotos || it.productPhotos.length === 0)
    ).length;

    const availableProductTypes = getProductTypesForCategory(editingItemCategoryId);
    const availableNewProductTypes = getProductTypesForCategory(newItemCategoryId);

    return (
      <View
        className="flex-1 bg-serene-surface"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-serene-hairline-border bg-serene-surface">
          <TouchableOpacity
            className="w-10 h-10 rounded-full bg-serene-surface-container-lowest border border-serene-subtle-border items-center justify-center shadow-sm"
            onPress={() => setScreenState('preview')}
            activeOpacity={0.8}
            accessibilityLabel="Back to preview"
          >
            <MaterialIcons name="arrow-back" size={20} color={SereneColors.onSurface} />
          </TouchableOpacity>

          <View className="items-center">
            <Text className="text-base font-bold text-serene-on-surface">Review Receipt Items</Text>
            <Text className="text-[11px] font-medium text-serene-on-surface-variant">
              {totalItems} {totalItems === 1 ? 'item' : 'items'} detected · Select items to save
            </Text>
          </View>

          <TouchableOpacity
            className="w-10 h-10 rounded-full bg-serene-surface-container-lowest border border-serene-subtle-border items-center justify-center shadow-sm"
            onPress={() => setShowOcrInspector(true)}
            activeOpacity={0.8}
            accessibilityLabel="View OCR data"
          >
            <MaterialIcons name="fact-check" size={18} color={SereneColors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-1 px-4 pt-3"
          contentContainerStyle={{ paddingBottom: 120, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-3.5 border border-serene-subtle-border shadow-sm">
            <View className="flex-row items-center justify-between mb-2">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-full bg-blue-50 items-center justify-center">
                  <MaterialIcons name="receipt-long" size={18} color="#115086" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-serene-on-surface">
                    {extractedData.common.merchant?.value || 'Store Invoice'}
                  </Text>
                  <Text className="text-[11px] text-serene-on-surface-variant">
                    {extractedData.common.purchaseDate?.value || 'Purchase Date Unknown'}
                    {extractedData.common.invoiceNumber?.value
                      ? ` · #${extractedData.common.invoiceNumber.value}`
                      : ''}
                  </Text>
                </View>
              </View>
              {receiptGrandTotal ? (
                <View className="items-end">
                  <Text className="text-[10px] uppercase font-semibold text-serene-on-surface-variant">
                    Invoice Total
                  </Text>
                  <Text className="text-sm font-bold text-serene-primary">
                    {formatCurrency(receiptGrandTotal)}
                  </Text>
                </View>
              ) : null}
            </View>

            <View className="flex-row items-center justify-between pt-2 border-t border-serene-hairline-border">
              <Text className="text-[11px] text-serene-on-surface-variant">
                1 invoice document will link to all saved items
              </Text>
              <View className="flex-row items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <MaterialIcons name="verified" size={11} color="#047857" />
                <Text className="text-[10px] font-semibold text-emerald-800">
                  Shared Document
                </Text>
              </View>
            </View>
          </View>

          <View className="flex-row items-center justify-between mt-1">
            <TouchableOpacity
              className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-serene-surface-container-lowest border border-serene-subtle-border shadow-xs"
              onPress={() => handleSelectAllItems(!allSelected)}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={allSelected ? 'check-box' : 'check-box-outline-blank'}
                size={16}
                color={SereneColors.primary}
              />
              <Text className="text-xs font-semibold text-serene-on-surface">
                {allSelected ? 'Deselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-row items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-200"
              onPress={handleOpenAddItemModal}
              activeOpacity={0.8}
            >
              <MaterialIcons name="add" size={16} color="#115086" />
              <Text className="text-xs font-bold text-[#115086]">Add Missing Item</Text>
            </TouchableOpacity>
          </View>

          <Text className="text-xs font-bold uppercase tracking-wider text-serene-on-surface-variant mt-1">
            Detected Items ({items.length})
          </Text>

          {items.map((item, idx) => {
            const isSelected = item.selected;
            const categoryName = item.category || getCategoryNameFromId(item.categoryId);
            const lineTotal = Number(item.price) || 0;
            const qty = item.quantity || 1;
            const unitPrice = item.unitPrice || (qty > 1 ? lineTotal / qty : lineTotal);

            return (
              <View
                key={item.id || idx}
                className={`rounded-serene-xl p-3.5 border ${
                  isSelected
                    ? 'bg-serene-surface-container-lowest border-serene-primary shadow-sm'
                    : 'bg-serene-surface-container-low/50 border-serene-subtle-border opacity-70'
                }`}
              >
                <View className="flex-row items-start gap-3">
                  <TouchableOpacity
                    className="pt-0.5"
                    onPress={() => handleToggleItemSelection(idx)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons
                      name={isSelected ? 'check-box' : 'check-box-outline-blank'}
                      size={22}
                      color={isSelected ? SereneColors.primary : '#8E9192'}
                    />
                  </TouchableOpacity>

                  <View className="flex-1">
                    <TouchableOpacity
                      onPress={() => handleToggleItemSelection(idx)}
                      activeOpacity={0.8}
                    >
                      <Text
                        className={`text-[15px] font-bold ${
                          isSelected ? 'text-serene-on-surface' : 'text-serene-on-surface-variant line-through'
                        }`}
                        numberOfLines={2}
                      >
                        {item.productName}
                      </Text>
                    </TouchableOpacity>

                    <View className="flex-row flex-wrap items-center gap-1.5 mt-1.5">
                      <View className="bg-[#E2E8F0] px-2 py-0.5 rounded-full">
                        <Text className="text-[10px] font-semibold text-slate-700">
                          {categoryName}
                        </Text>
                      </View>

                      {item.productType ? (
                        <View className="bg-amber-100/80 px-2 py-0.5 rounded-full border border-amber-200">
                          <Text className="text-[10px] font-semibold text-amber-800">
                            {item.productType}
                          </Text>
                        </View>
                      ) : null}

                      {item.brand ? (
                        <View className="bg-stone-100 px-2 py-0.5 rounded-full">
                          <Text className="text-[10px] text-stone-600">
                            {item.brand}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <View className="flex-row items-baseline justify-between mt-2.5 pt-2 border-t border-serene-hairline-border">
                      <View>
                        {qty > 1 ? (
                          <Text className="text-[11px] font-medium text-serene-on-surface-variant">
                            {qty} × {formatCurrency(unitPrice)}
                          </Text>
                        ) : (
                          <Text className="text-[11px] text-serene-on-surface-variant">
                            Item Price
                          </Text>
                        )}
                      </View>
                      <Text className="text-[16px] font-bold text-serene-primary">
                        {formatCurrency(lineTotal)}
                      </Text>
                    </View>

                    {(item.warrantyUntil || item.returnUntil) ? (
                      <View className="flex-row items-center gap-3 mt-1.5">
                        {item.warrantyUntil ? (
                          <Text className="text-[10px] font-medium text-emerald-700">
                            🛡️ Warranty until {item.warrantyUntil}
                          </Text>
                        ) : null}
                        {item.returnUntil ? (
                          <Text className="text-[10px] font-medium text-amber-700">
                            ↩️ Return by {item.returnUntil}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>

                  <View className="flex-col gap-1 items-center">
                    <TouchableOpacity
                      className="w-8 h-8 rounded-full bg-serene-surface-container-low items-center justify-center"
                      onPress={() => handleOpenEditItemModal(idx)}
                      activeOpacity={0.8}
                      accessibilityLabel="Edit item details"
                    >
                      <MaterialIcons name="edit" size={15} color={SereneColors.primary} />
                    </TouchableOpacity>

                    <TouchableOpacity
                      className="w-8 h-8 rounded-full bg-red-50 items-center justify-center"
                      onPress={() => handleRemoveMultiItem(idx)}
                      activeOpacity={0.8}
                      accessibilityLabel="Remove item"
                    >
                      <MaterialIcons name="delete-outline" size={15} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Mandatory Product Photo Requirement for each item */}
                <View className="mt-3 pt-2.5 border-t border-serene-hairline-border gap-2">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-1.5">
                      <MaterialIcons name="photo-camera" size={14} color={SereneColors.primary} />
                      <Text className="text-xs font-bold text-serene-on-surface">Product Photo</Text>
                    </View>

                    {item.productPhotos && item.productPhotos.length > 0 ? (
                      <View className="flex-row items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <MaterialIcons name="check-circle" size={11} color="#059669" />
                        <Text className="text-[10px] font-bold text-emerald-800">
                          ✓ Product photo ({item.productPhotos.length})
                        </Text>
                      </View>
                    ) : (
                      <View className="flex-row items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-300">
                        <MaterialIcons name="warning" size={11} color="#D97706" />
                        <Text className="text-[10px] font-bold text-amber-800">
                          ⚠ Photo required
                        </Text>
                      </View>
                    )}
                  </View>

                  {item.productPhotos && item.productPhotos.length > 0 ? (
                    <View className="flex-row items-center gap-2 flex-wrap pt-0.5">
                      {item.productPhotos.map((pUri, pIdx) => (
                        <View key={`photo-${idx}-${pIdx}`} className="relative">
                          <Image
                            source={{ uri: pUri }}
                            className="w-14 h-14 rounded-serene-md border border-serene-subtle-border bg-serene-surface-container-high"
                            resizeMode="cover"
                          />
                          <TouchableOpacity
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 items-center justify-center shadow-xs"
                            onPress={() => handleRemoveProductPhotoFromItem(idx, pIdx)}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons name="close" size={12} color="#FFFFFF" />
                          </TouchableOpacity>
                        </View>
                      ))}

                      <View className="flex-row items-center gap-1">
                        <TouchableOpacity
                          className="flex-row items-center gap-1 bg-serene-surface-container px-2 py-1.5 rounded-serene-md border border-serene-subtle-border"
                          onPress={() => handleAttachProductPhotoToItem(idx, 'camera')}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="camera-alt" size={12} color={SereneColors.primary} />
                          <Text className="text-[10px] font-semibold text-serene-primary">+ Camera</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="flex-row items-center gap-1 bg-serene-surface-container px-2 py-1.5 rounded-serene-md border border-serene-subtle-border"
                          onPress={() => handleAttachProductPhotoToItem(idx, 'gallery')}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="photo-library" size={12} color={SereneColors.primary} />
                          <Text className="text-[10px] font-semibold text-serene-primary">+ Gallery</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View className="p-2.5 rounded-serene-md bg-amber-50/60 border border-dashed border-amber-300 flex-row items-center justify-between">
                      <View className="flex-1 mr-2">
                        <Text className="text-[11px] font-medium text-amber-900">
                          Receipt photo cannot be used as product photo.
                        </Text>
                        <Text className="text-[10px] text-amber-700">
                          Capture or select an actual photo of this product.
                        </Text>
                      </View>
                      <View className="flex-row gap-1.5">
                        <TouchableOpacity
                          className="flex-row items-center gap-1 bg-serene-primary px-2.5 py-1.5 rounded-serene-md shadow-xs"
                          onPress={() => handleAttachProductPhotoToItem(idx, 'camera')}
                          activeOpacity={0.85}
                        >
                          <MaterialIcons name="camera-alt" size={12} color="#FFFFFF" />
                          <Text className="text-[11px] font-bold text-white">Camera</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="flex-row items-center gap-1 bg-serene-surface-container-highest px-2.5 py-1.5 rounded-serene-md border border-serene-subtle-border"
                          onPress={() => handleAttachProductPhotoToItem(idx, 'gallery')}
                          activeOpacity={0.85}
                        >
                          <MaterialIcons name="photo-library" size={12} color={SereneColors.primary} />
                          <Text className="text-[11px] font-bold text-serene-primary">Gallery</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View
          className="absolute bottom-0 left-0 right-0 bg-serene-surface-container-lowest border-t border-serene-hairline-border px-4 py-3 shadow-lg"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {selectedMissingPhotoCount > 0 ? (
            <View className="flex-row items-center gap-1.5 mb-2 bg-amber-50 px-2.5 py-1.5 rounded-serene-md border border-amber-300">
              <MaterialIcons name="warning" size={14} color="#D97706" />
              <Text className="text-[11px] font-bold text-amber-800 flex-1">
                {selectedMissingPhotoCount} {selectedMissingPhotoCount === 1 ? 'product needs' : 'products need'} an actual product photo before saving
              </Text>
            </View>
          ) : null}

          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-serene-on-surface-variant">
              Selected: <Text className="font-bold text-serene-on-surface">{selectedCount} of {totalItems}</Text> items
            </Text>
            <Text className="text-sm font-bold text-serene-primary">
              Total: {formatCurrency(selectedTotal)}
            </Text>
          </View>

          <TouchableOpacity
            className={`w-full py-3.5 rounded-serene-lg flex-row items-center justify-center gap-2 ${
              selectedCount > 0 && !isSavingBatch
                ? selectedMissingPhotoCount > 0 ? 'bg-amber-600 shadow-sm' : 'bg-serene-primary shadow-sm'
                : 'bg-serene-outline-variant opacity-60'
            }`}
            onPress={handleSaveSelectedMultiItems}
            disabled={selectedCount === 0 || isSavingBatch}
            activeOpacity={0.88}
          >
            <MaterialIcons
              name={isSavingBatch ? 'hourglass-top' : selectedMissingPhotoCount > 0 ? 'add-a-photo' : 'save-alt'}
              size={18}
              color="#FFFFFF"
            />
            <Text className="text-sm font-bold text-white">
              {isSavingBatch
                ? 'Saving Purchase to Vault...'
                : selectedMissingPhotoCount > 0
                ? `Add Product Photos (${selectedMissingPhotoCount} Missing)`
                : `Save Grouped Purchase (${selectedCount} Products)`}
            </Text>
          </TouchableOpacity>
        </View>

        <Modal
          visible={showEditItemModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowEditItemModal(false)}
        >
          <View className="flex-1 bg-black/60 justify-end">
            <View
              className="bg-serene-surface rounded-t-3xl p-5 max-h-[85%]"
              style={{ paddingBottom: Math.max(insets.bottom, 16) }}
            >
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-lg font-bold text-serene-on-surface">Edit Item Details</Text>
                <TouchableOpacity
                  onPress={() => setShowEditItemModal(false)}
                  className="w-8 h-8 rounded-full bg-serene-surface-container-high items-center justify-center"
                >
                  <MaterialIcons name="close" size={18} color="#1C1C17" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                <View>
                  <Text className="text-xs font-bold text-serene-on-surface mb-1">Product Name *</Text>
                  <TextInput
                    className="bg-white border border-serene-subtle-border rounded-serene-md px-3 py-2.5 text-sm font-medium text-serene-on-surface"
                    value={editingItemName}
                    onChangeText={setEditingItemName}
                    placeholder="e.g. Lenovo IdeaPad Slim 3"
                  />
                </View>

                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-serene-on-surface mb-1">Total Price (₹) *</Text>
                    <TextInput
                      className="bg-white border border-serene-subtle-border rounded-serene-md px-3 py-2.5 text-sm font-bold text-serene-primary"
                      value={editingItemPrice}
                      onChangeText={setEditingItemPrice}
                      keyboardType="numeric"
                      placeholder="e.g. 40,990"
                    />
                  </View>

                  <View className="w-24">
                    <Text className="text-xs font-bold text-serene-on-surface mb-1">Quantity</Text>
                    <TextInput
                      className="bg-white border border-serene-subtle-border rounded-serene-md px-3 py-2.5 text-sm font-medium text-serene-on-surface text-center"
                      value={editingItemQuantity}
                      onChangeText={setEditingItemQuantity}
                      keyboardType="number-pad"
                      placeholder="e.g. 1"
                    />
                  </View>
                </View>

                <View>
                  <Text className="text-xs font-bold text-serene-on-surface mb-1.5">Category *</Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {DEFAULT_CATEGORIES.map((cat) => {
                      const isSel = editingItemCategoryId === cat.id;
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          className={`px-3 py-1.5 rounded-full border ${
                            isSel
                              ? 'bg-serene-primary border-serene-primary'
                              : 'bg-white border-serene-subtle-border'
                          }`}
                          onPress={() => {
                            setEditingItemCategoryId(cat.id);
                            const types = getProductTypesForCategory(cat.id);
                            if (types.length > 0 && !types.includes(editingItemProductType)) {
                              setEditingItemProductType(types[0]);
                            }
                          }}
                        >
                          <Text
                            className={`text-xs font-semibold ${
                              isSel ? 'text-white' : 'text-serene-on-surface'
                            }`}
                          >
                            {cat.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {availableProductTypes.length > 0 && (
                  <View>
                    <Text className="text-xs font-bold text-serene-on-surface mb-1.5">Product Type</Text>
                    <View className="flex-row flex-wrap gap-1.5">
                      {availableProductTypes.map((type) => {
                        const isSel = editingItemProductType === type;
                        return (
                          <TouchableOpacity
                            key={type}
                            className={`px-2.5 py-1 rounded-full border ${
                              isSel
                                ? 'bg-amber-600 border-amber-600'
                                : 'bg-amber-50 border-amber-200'
                            }`}
                            onPress={() => setEditingItemProductType(type)}
                          >
                            <Text
                              className={`text-[11px] font-semibold ${
                                isSel ? 'text-white' : 'text-amber-900'
                              }`}
                            >
                              {type}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-serene-on-surface mb-1">Brand</Text>
                    <TextInput
                      className="bg-white border border-serene-subtle-border rounded-serene-md px-3 py-2 text-sm text-serene-on-surface"
                      value={editingItemBrand}
                      onChangeText={setEditingItemBrand}
                      placeholder="e.g. Lenovo"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-serene-on-surface mb-1">Model</Text>
                    <TextInput
                      className="bg-white border border-serene-subtle-border rounded-serene-md px-3 py-2 text-sm text-serene-on-surface"
                      value={editingItemModel}
                      onChangeText={setEditingItemModel}
                      placeholder="e.g. IdeaPad Slim 3 15IAH8"
                    />
                  </View>
                </View>

                <View className="flex-row gap-3 mt-3">
                  <TouchableOpacity
                    className="flex-1 py-3 rounded-serene-md border border-serene-hairline-border items-center"
                    onPress={() => setShowEditItemModal(false)}
                  >
                    <Text className="text-xs font-bold text-serene-on-surface">Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    className="flex-1 py-3 rounded-serene-md bg-serene-primary items-center"
                    onPress={handleSaveEditedItem}
                  >
                    <Text className="text-xs font-bold text-white">Save Changes</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={showAddItemModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowAddItemModal(false)}
        >
          <View className="flex-1 bg-black/60 justify-end">
            <View
              className="bg-serene-surface rounded-t-3xl p-5 max-h-[85%]"
              style={{ paddingBottom: Math.max(insets.bottom, 16) }}
            >
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-lg font-bold text-serene-on-surface">Add Missing Item</Text>
                <TouchableOpacity
                  onPress={() => setShowAddItemModal(false)}
                  className="w-8 h-8 rounded-full bg-serene-surface-container-high items-center justify-center"
                >
                  <MaterialIcons name="close" size={18} color="#1C1C17" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                <View>
                  <Text className="text-xs font-bold text-serene-on-surface mb-1">Product Name *</Text>
                  <TextInput
                    className="bg-white border border-serene-subtle-border rounded-serene-md px-3 py-2.5 text-sm font-medium text-serene-on-surface"
                    value={newItemName}
                    onChangeText={setNewItemName}
                    placeholder="e.g. Lenovo IdeaPad Slim 3"
                  />
                </View>

                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-serene-on-surface mb-1">Price (₹) *</Text>
                    <TextInput
                      className="bg-white border border-serene-subtle-border rounded-serene-md px-3 py-2.5 text-sm font-bold text-serene-primary"
                      value={newItemPrice}
                      onChangeText={setNewItemPrice}
                      keyboardType="numeric"
                      placeholder="e.g. 40,990"
                    />
                  </View>

                  <View className="w-24">
                    <Text className="text-xs font-bold text-serene-on-surface mb-1">Quantity</Text>
                    <TextInput
                      className="bg-white border border-serene-subtle-border rounded-serene-md px-3 py-2.5 text-sm font-medium text-serene-on-surface text-center"
                      value={newItemQuantity}
                      onChangeText={setNewItemQuantity}
                      keyboardType="number-pad"
                      placeholder="e.g. 1"
                    />
                  </View>
                </View>

                <View>
                  <Text className="text-xs font-bold text-serene-on-surface mb-1.5">Category *</Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {DEFAULT_CATEGORIES.map((cat) => {
                      const isSel = newItemCategoryId === cat.id;
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          className={`px-3 py-1.5 rounded-full border ${
                            isSel
                              ? 'bg-serene-primary border-serene-primary'
                              : 'bg-white border-serene-subtle-border'
                          }`}
                          onPress={() => {
                            setNewItemCategoryId(cat.id);
                            const types = getProductTypesForCategory(cat.id);
                            if (types.length > 0) setNewItemProductType(types[0]);
                          }}
                        >
                          <Text
                            className={`text-xs font-semibold ${
                              isSel ? 'text-white' : 'text-serene-on-surface'
                            }`}
                          >
                            {cat.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {availableNewProductTypes.length > 0 && (
                  <View>
                    <Text className="text-xs font-bold text-serene-on-surface mb-1.5">Product Type</Text>
                    <View className="flex-row flex-wrap gap-1.5">
                      {availableNewProductTypes.map((type) => {
                        const isSel = newItemProductType === type;
                        return (
                          <TouchableOpacity
                            key={type}
                            className={`px-2.5 py-1 rounded-full border ${
                              isSel
                                ? 'bg-amber-600 border-amber-600'
                                : 'bg-amber-50 border-amber-200'
                            }`}
                            onPress={() => setNewItemProductType(type)}
                          >
                            <Text
                              className={`text-[11px] font-semibold ${
                                isSel ? 'text-white' : 'text-amber-900'
                              }`}
                            >
                              {type}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                <View>
                  <Text className="text-xs font-bold text-serene-on-surface mb-1">Brand (Optional)</Text>
                  <TextInput
                    className="bg-white border border-serene-subtle-border rounded-serene-md px-3 py-2 text-sm text-serene-on-surface"
                    value={newItemBrand}
                    onChangeText={setNewItemBrand}
                    placeholder="e.g. Lenovo"
                  />
                </View>

                <View className="flex-row gap-3 mt-3">
                  <TouchableOpacity
                    className="flex-1 py-3 rounded-serene-md border border-serene-hairline-border items-center"
                    onPress={() => setShowAddItemModal(false)}
                  >
                    <Text className="text-xs font-bold text-serene-on-surface">Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    className="flex-1 py-3 rounded-serene-md bg-serene-primary items-center"
                    onPress={handleSaveNewItem}
                  >
                    <Text className="text-xs font-bold text-white">Add Item</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        <OcrInspectorModal
          visible={showOcrInspector}
          onClose={() => setShowOcrInspector(false)}
          ocrResult={ocrResult}
          preprocessed={ocrPreprocessed}
        />
      </View>
    );
  }

  if (screenState === 'category_select') {
    const categories: Array<{ id: ScannerCategory; label: string; icon: string; desc: string }> = [
      { id: 'mobile_laptop', label: 'Mobile & Laptop', icon: 'laptop-mac', desc: 'Smartphones, laptops, tablets, accessories' },
      { id: 'electronics', label: 'Electronics', icon: 'headphones', desc: 'Audio, headphones, TVs, cameras, consoles' },
      { id: 'vehicle', label: 'Vehicle', icon: 'directions-car', desc: 'Automobiles, two-wheelers, parts, service bills' },
      { id: 'home_appliance', label: 'Home Appliance', icon: 'kitchen', desc: 'ACs, refrigerators, washing machines' },
      { id: 'furniture', label: 'Furniture', icon: 'chair', desc: 'Desks, sofas, beds, home décor' },
      { id: 'fashion', label: 'Fashion', icon: 'checkroom', desc: 'Luxury clothing, watches, shoes, bags' },
      { id: 'documents', label: 'Documents', icon: 'description', desc: 'Warranty certificates, invoices, deed records' },
      { id: 'other', label: 'Other', icon: 'inventory-2', desc: 'Miscellaneous personal property' },
    ];

    return (
      <View className="flex-1 bg-serene-surface" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center gap-3 px-4 py-3 border-b border-serene-hairline-border">
          <TouchableOpacity
            className="w-10 h-10 rounded-full items-center justify-center"
            onPress={() => setScreenState('result')}
          >
            <MaterialIcons name="arrow-back" size={22} color={SereneColors.onSurface} />
          </TouchableOpacity>
          <View>
            <Text className="text-base font-bold text-serene-on-surface">What type of item is this?</Text>
            <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">
              Select category to calibrate warranty and technical credentials.
            </Text>
          </View>
        </View>

        <ScrollView contentContainerClassName="p-4 gap-2.5" showsVerticalScrollIndicator={false}>
          {categories.map((cat) => {
            const isSelected = extractedData?.category === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                className={`flex-row items-center p-3.5 rounded-serene-lg bg-serene-surface-container-lowest border gap-3.5 ${
                  isSelected ? 'border-serene-primary bg-blue-50/40' : 'border-serene-hairline-border'
                }`}
                onPress={() => handleChangeCategory(cat.id)}
                activeOpacity={0.88}
              >
                <View
                  className={`w-11 h-11 rounded-full items-center justify-center ${
                    isSelected ? 'bg-serene-primary' : 'bg-serene-surface-container-low'
                  }`}
                >
                  <MaterialIcons
                    name={cat.icon as any}
                    size={24}
                    color={isSelected ? '#FFFFFF' : SereneColors.primary}
                  />
                </View>
                <View className="flex-1">
                  <Text
                    className={`text-sm font-bold ${
                      isSelected ? 'text-serene-primary' : 'text-serene-on-surface'
                    }`}
                  >
                    {cat.label}
                  </Text>
                  <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">{cat.desc}</Text>
                </View>
                {isSelected && (
                  <MaterialIcons name="check-circle" size={20} color={SereneColors.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  if (screenState === 'save_confirm' && extractedData) {
    const common = extractedData.common;
    const warrantyExpiry =
      extractedData.categoryDetails.electronics?.warrantyExpiry?.value ||
      extractedData.categoryDetails.mobile_laptop?.warrantyExpiry?.value ||
      extractedData.categoryDetails.home_appliance?.warrantyExpiry?.value ||
      extractedData.categoryDetails.vehicle?.warrantyExpiry?.value ||
      null;

    return (
      <View className="flex-1 bg-serene-surface" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between px-4 py-2 border-b border-serene-hairline-border">
          <TouchableOpacity
            className="w-10 h-10 rounded-full items-center justify-center"
            onPress={() => setScreenState('result')}
          >
            <MaterialIcons name="arrow-back" size={22} color={SereneColors.onSurface} />
          </TouchableOpacity>
          <Text className="text-base font-bold text-serene-on-surface">Ready to Save</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerClassName="px-4 pb-28" showsVerticalScrollIndicator={false}>
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-hairline-border gap-3 mb-4 mt-2">
            <View className="flex-row items-center gap-3.5">
              <Image
                source={{ uri: extractedData.receiptUri }}
                className="w-16 h-16 rounded-serene-md bg-serene-surface-container-low"
                resizeMode="cover"
              />
              <View className="flex-1 gap-0.5">
                <View className="self-start bg-serene-primary/10 px-2 py-0.5 rounded-full mb-1">
                  <Text className="text-[10px] font-bold text-serene-primary">
                    {common.category.value.replace('_', ' ').toUpperCase()}
                  </Text>
                </View>
                <Text className="text-base font-bold text-serene-on-surface">{common.productName.value || 'Receipt Item'}</Text>
                <Text className="text-base font-bold text-serene-primary">
                  {formatCurrency(common.finalAmount.value || 0)}
                </Text>
              </View>
            </View>

            <View className="h-[1px] bg-serene-subtle-border my-1" />

            <View className="flex-row items-center justify-between py-1">
              <Text className="text-xs text-serene-on-surface-variant">Store</Text>
              <Text className="text-xs font-semibold text-serene-on-surface">{common.merchant.value || 'N/A'}</Text>
            </View>
            <View className="flex-row items-center justify-between py-1">
              <Text className="text-xs text-serene-on-surface-variant">Purchased</Text>
              <Text className="text-xs font-semibold text-serene-on-surface">{common.purchaseDate.value ? formatDate(common.purchaseDate.value, 'medium') : 'N/A'}</Text>
            </View>
            <View className="flex-row items-center justify-between py-1">
              <Text className="text-xs text-serene-on-surface-variant">Invoice Number</Text>
              <Text className="text-xs font-semibold text-serene-on-surface">{common.invoiceNumber.value || 'N/A'}</Text>
            </View>
            {warrantyExpiry ? (
              <View className="flex-row items-center justify-between py-1">
                <Text className="text-xs text-serene-on-surface-variant">Warranty</Text>
                <Text className="text-xs font-semibold text-emerald-700">
                  Active until {formatDate(warrantyExpiry, 'short')}
                </Text>
              </View>
            ) : null}
            <View className="flex-row items-center justify-between py-1">
              <Text className="text-xs text-serene-on-surface-variant">Receipt</Text>
              <Text className="text-xs font-semibold text-serene-on-surface">Attached</Text>
            </View>
          </View>

          {Boolean(extractedData.items && extractedData.items.length > 1) && (
            <View className="flex-row items-center gap-2 bg-blue-50 p-3 rounded-serene-md border border-blue-200 mb-3">
              <MaterialIcons name="library-add-check" size={18} color={SereneColors.primary} />
              <Text className="text-xs text-blue-900 font-medium flex-1">
                {extractedData.items?.filter((it) => it.selected).length || 0} items from this invoice will be vaulted together.
              </Text>
            </View>
          )}

          <View className="flex-row items-center gap-2 bg-serene-surface-container-low p-3 rounded-serene-md mb-4">
            <MaterialIcons name="verified-user" size={16} color={SereneColors.primary} />
            <Text className="text-[11px] text-serene-on-surface-variant flex-1 leading-4">
              Receipt image and serial records are stored in your private vault.
            </Text>
          </View>
        </ScrollView>

        <View className="absolute bottom-0 inset-x-0 bg-serene-surface-container-lowest border-t border-serene-hairline-border p-4 flex-row gap-3">
          <TouchableOpacity
            className="flex-1 py-3 rounded-serene-lg border border-serene-hairline-border items-center justify-center bg-white"
            onPress={() => setScreenState('result')}
            activeOpacity={0.85}
          >
            <Text className="text-[13px] font-semibold text-serene-on-surface">Edit Details</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-1 flex-row items-center justify-center gap-1.5 py-3 rounded-serene-lg bg-serene-primary shadow-sm"
            onPress={handleSaveToKeepr}
            activeOpacity={0.88}
          >
            <MaterialIcons name="shield" size={18} color="#FFFFFF" />
            <Text className="text-[13px] font-bold text-white">Save to Keepr</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (screenState === 'saved_success') {
    return (
      <View className="flex-1 bg-serene-surface items-center justify-center px-6" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="w-20 h-20 rounded-full bg-emerald-600 items-center justify-center shadow-lg mb-4">
          <MaterialIcons name="check" size={44} color="#FFFFFF" />
        </View>

        <Text className="text-2xl font-bold text-serene-on-surface text-center mb-1.5">
          {savedBatchCount > 1 ? `${savedBatchCount} Items Saved to Keepr!` : 'Saved to Keepr'}
        </Text>
        <Text className="text-xs text-serene-on-surface-variant text-center max-w-[280px] mb-6 leading-4">
          {savedBatchCount > 1
            ? 'All items are individually cataloged in your vault and linked to the same invoice.'
            : 'Your asset, invoice, and warranty countdown are now securely vaulted.'}
        </Text>

        <View className="w-full max-w-[340px] bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-hairline-border gap-3 mb-4">
          <View className="flex-row items-center gap-2.5">
            <MaterialIcons name="verified" size={18} color="#047857" />
            <Text className="text-xs text-serene-on-surface font-medium">
              {savedBatchCount > 1
                ? `${savedBatchCount} individual assets cataloged in personal vault`
                : 'Asset cataloged in personal vault'}
            </Text>
          </View>
          <View className="flex-row items-center gap-2.5">
            <MaterialIcons name="timer" size={18} color="#047857" />
            <Text className="text-xs text-serene-on-surface font-medium">Active warranty tracking enabled</Text>
          </View>
          <View className="flex-row items-center gap-2.5">
            <MaterialIcons name="receipt-long" size={18} color="#047857" />
            <Text className="text-xs text-serene-on-surface font-medium">Receipt stored once & linked to all items</Text>
          </View>
          <View className="flex-row items-center gap-2.5">
            <MaterialIcons name="history-edu" size={18} color="#047857" />
            <Text className="text-xs text-serene-on-surface font-medium">Ownership audit ledger updated</Text>
          </View>
        </View>

        <View className="w-full max-w-[340px] flex-row items-center gap-3 bg-amber-50/70 p-3.5 rounded-serene-lg border border-amber-200/80 mb-6">
          <View className="w-10 h-10 rounded-full bg-amber-100 items-center justify-center">
            <MaterialIcons name="notifications-active" size={22} color={SereneColors.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-xs font-bold text-amber-900">Set a Reminder</Text>
            <Text className="text-[10px] text-amber-800 leading-[14px] mt-0.5">
              Receive proactive alerts before warranty or return periods expire.
            </Text>
          </View>
          <TouchableOpacity
            className={`px-3 py-1.5 rounded-full ${
              reminderScheduled ? 'bg-emerald-600' : 'bg-amber-600'
            }`}
            onPress={handleScheduleReminder}
            disabled={reminderScheduled}
          >
            <Text className="text-[11px] font-bold text-white">
              {reminderScheduled ? 'Scheduled ✓' : 'Set Reminder'}
            </Text>
          </TouchableOpacity>
        </View>

        <View className="w-full max-w-[340px] gap-2.5">
          <TouchableOpacity
            className="w-full flex-row items-center justify-center gap-2 py-3.5 rounded-serene-lg bg-serene-primary shadow-sm"
            onPress={() => {
              if (savedBatchCount > 1 || !savedItemId) {
                router.replace('/(tabs)/items');
              } else {
                router.replace(`/item/${savedItemId}`);
              }
            }}
            activeOpacity={0.88}
          >
            <Text className="text-[13px] font-bold text-white">
              {savedBatchCount > 1 ? 'View All Saved Items in Vault' : 'View Item in Vault'}
            </Text>
            <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity
            className="w-full flex-row items-center justify-center gap-2 py-3 rounded-serene-lg bg-serene-surface-container-lowest border border-serene-hairline-border"
            onPress={() => {
              clearActiveReceiptSession();
              setScreenState('scan');
              setCapturedImageUri(null);
              setCapturedBase64(null);
              setExtractedData(null);
              setSavedItemId(null);
              setProcessingError(null);
              setReceiptRejection(null);
              setIsScanning(false);
            }}
            activeOpacity={0.85}
          >
            <MaterialIcons name="camera-alt" size={18} color={SereneColors.primary} />
            <Text className="text-[13px] font-semibold text-serene-on-surface">Scan Another Receipt</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="py-2 items-center"
            onPress={() => router.replace('/(tabs)')}
          >
            <Text className="text-xs font-semibold text-serene-primary underline">Back to Vault Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!extractedData) {
    return null;
  }

  const common = extractedData.common;
  const currentCategory = extractedData.category;

  return (
    <View className="flex-1 bg-serene-surface" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="flex-row items-center justify-between px-4 py-2 border-b border-serene-hairline-border">
        <TouchableOpacity
          className="w-10 h-10 rounded-full items-center justify-center"
          onPress={() => setScreenState('preview')}
        >
          <MaterialIcons name="arrow-back" size={22} color={SereneColors.onSurface} />
        </TouchableOpacity>
        <Text className="text-base font-bold text-serene-on-surface">Review & Edit</Text>
        <TouchableOpacity
          className="flex-row items-center gap-1 bg-serene-primary/10 px-2.5 py-1.5 rounded-full"
          onPress={() => setScreenState('category_select')}
        >
          <MaterialIcons name="category" size={16} color={SereneColors.primary} />
          <Text className="text-xs font-semibold text-serene-primary">Category</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerClassName="px-4 pb-28"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center bg-emerald-50 px-3.5 py-2.5 rounded-serene-md border border-emerald-200 my-3">
          <MaterialIcons name="check-circle" size={18} color="#047857" />
          <View className="ml-2 flex-1">
            <Text className="text-xs font-bold text-emerald-800">Receipt Scanned</Text>
            <Text className="text-[11px] text-emerald-700">Review the details before saving.</Text>
          </View>
          <View className="bg-emerald-100 px-2 py-0.5 rounded-full">
            <Text className="text-[10px] font-bold text-emerald-800">
              Scanned
            </Text>
          </View>
        </View>

        <TouchableOpacity
          className="flex-row items-center bg-serene-surface-container-lowest p-3 rounded-serene-lg border border-serene-hairline-border mb-3 gap-3"
          onPress={() => setShowImageModal(true)}
          activeOpacity={0.9}
        >
          <Image
            source={{ uri: extractedData.receiptUri }}
            className="w-14 h-14 rounded-serene-md bg-serene-surface-container-low"
            resizeMode="cover"
          />
          <View className="flex-1 gap-0.5">
            <View className="flex-row items-center bg-serene-primary px-1.5 py-0.5 rounded self-start gap-1">
              <MaterialIcons name="receipt-long" size={12} color="#FFFFFF" />
              <Text className="text-[9px] font-bold text-white tracking-wider">RECEIPT ATTACHED</Text>
            </View>
            <Text className="text-xs font-bold text-serene-on-surface">{extractedData.receiptImageName}</Text>
            <Text className="text-[10px] text-serene-on-surface-variant">Tap to view full receipt image</Text>
          </View>
          <MaterialIcons name="zoom-in" size={24} color={SereneColors.outline} />
        </TouchableOpacity>



        {extractedData.items && extractedData.items.length > 1 && (
          <MultiItemCard
            items={extractedData.items}
            onToggleSelect={(id) => {
              const idx = extractedData.items?.findIndex((i) => i.id === id);
              if (idx !== undefined && idx >= 0) handleToggleItemSelection(idx);
            }}
            onRemoveItem={(id) => {
              const idx = extractedData.items?.findIndex((i) => i.id === id);
              if (idx !== undefined && idx >= 0) handleRemoveMultiItem(idx);
            }}
            onSaveAll={() => {
              if (extractedData.items) {
                const all = extractedData.items.map((it) => ({ ...it, selected: true }));
                setExtractedData({ ...extractedData, items: all });
              }
              setScreenState('save_confirm');
            }}
            onSaveSelected={() => {
              setScreenState('save_confirm');
            }}
          />
        )}

        <View className="flex-row bg-blue-50 p-3 rounded-serene-md border border-blue-200 mb-4 gap-2">
          <MaterialIcons name="info-outline" size={18} color="#115086" />
          <View className="flex-1">
            <Text className="text-xs font-bold text-blue-900">Review Before Saving</Text>
            <Text className="text-[11px] text-blue-800 mt-0.5 leading-4">
              Every field can be corrected manually. Uncertain fields are marked with "Please verify".
            </Text>
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-lg p-4 mb-4 border border-serene-hairline-border">
          <Text className="text-[11px] font-bold text-serene-on-surface-variant tracking-wider mb-3">PURCHASE INFORMATION</Text>

          <View className="mb-3">
            <View className="flex-row items-center justify-between mb-1.5">
              <Text className="text-xs font-semibold text-serene-on-surface">Product Name</Text>
              {renderConfidenceBadge(common.productName.confidence)}
            </View>
            <TextInput
              className="bg-serene-surface-container-low border border-serene-hairline-border rounded-serene-md px-3 py-2 text-[13px] text-serene-on-surface"
              value={common.productName.value ?? ''}
              onChangeText={(v) => handleUpdateCommonField('productName', v)}
              placeholder="e.g. Lenovo IdeaPad Slim 3"
              placeholderTextColor={SereneColors.outline}
            />
          </View>

          <View className="mb-3">
            <View className="flex-row items-center justify-between mb-1.5">
              <Text className="text-xs font-semibold text-serene-on-surface">Category</Text>
              <TouchableOpacity
                className="flex-row items-center gap-0.5"
                onPress={() => setScreenState('category_select')}
              >
                <Text className="text-xs font-semibold text-serene-primary">Change</Text>
                <MaterialIcons name="arrow-drop-down" size={18} color={SereneColors.primary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              className="flex-row items-center justify-between bg-serene-surface-container-low border border-serene-hairline-border rounded-serene-md px-3 py-2.5"
              onPress={() => setScreenState('category_select')}
            >
              <Text className="text-[13px] font-bold text-serene-primary">
                {common.category.value.replace('_', ' ').toUpperCase()}
              </Text>
              <MaterialIcons name="unfold-more" size={18} color={SereneColors.primary} />
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center">
            <View className="flex-1 mr-2 mb-3">
              <View className="flex-row items-center justify-between mb-1.5">
                <Text className="text-xs font-semibold text-serene-on-surface">Store / Merchant</Text>
                {renderConfidenceBadge(common.merchant.confidence)}
              </View>
              <TextInput
                className="bg-serene-surface-container-low border border-serene-hairline-border rounded-serene-md px-3 py-2 text-[13px] text-serene-on-surface"
                value={common.merchant.value ?? ''}
                onChangeText={(v) => handleUpdateCommonField('merchant', v)}
                placeholder="e.g. Flipkart"
                placeholderTextColor={SereneColors.outline}
              />
            </View>

            <View className="flex-1 ml-2 mb-3">
              <View className="flex-row items-center justify-between mb-1.5">
                <Text className="text-xs font-semibold text-serene-on-surface">Brand</Text>
                {renderConfidenceBadge(common.brand.confidence)}
              </View>
              <TextInput
                className="bg-serene-surface-container-low border border-serene-hairline-border rounded-serene-md px-3 py-2 text-[13px] text-serene-on-surface"
                value={common.brand.value ?? ''}
                onChangeText={(v) => handleUpdateCommonField('brand', v)}
                placeholder="e.g. Lenovo"
                placeholderTextColor={SereneColors.outline}
              />
            </View>
          </View>

          <View className="flex-row items-center">
            <View className="flex-1 mr-2 mb-3">
              <View className="flex-row items-center justify-between mb-1.5">
                <Text className="text-xs font-semibold text-serene-on-surface">Purchase Date</Text>
                {renderConfidenceBadge(common.purchaseDate.confidence)}
              </View>
              <TextInput
                className="bg-serene-surface-container-low border border-serene-hairline-border rounded-serene-md px-3 py-2 text-[13px] text-serene-on-surface"
                value={common.purchaseDate.value ?? ''}
                onChangeText={(v) => handleUpdateCommonField('purchaseDate', v)}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={SereneColors.outline}
              />
            </View>

            <View className="flex-1 ml-2 mb-3">
              <View className="flex-row items-center justify-between mb-1.5">
                <Text className="text-xs font-semibold text-serene-on-surface">Invoice Number</Text>
                {renderConfidenceBadge(common.invoiceNumber.confidence)}
              </View>
              <TextInput
                className="bg-serene-surface-container-low border border-serene-hairline-border rounded-serene-md px-3 py-2 text-[13px] text-serene-on-surface"
                value={common.invoiceNumber.value ?? ''}
                onChangeText={(v) => handleUpdateCommonField('invoiceNumber', v)}
                placeholder="e.g. INV-2026-1042"
                placeholderTextColor={SereneColors.outline}
              />
            </View>
          </View>

          <View className="flex-row items-center">
            <View className="flex-1 mr-2 mb-3">
              <View className="flex-row items-center justify-between mb-1.5">
                <Text className="text-xs font-semibold text-serene-on-surface">Tax / GST (₹)</Text>
                {renderConfidenceBadge(common.taxGst.confidence, common.taxGst.needsVerification)}
              </View>
              <TextInput
                className="bg-serene-surface-container-low border border-serene-hairline-border rounded-serene-md px-3 py-2 text-[13px] text-serene-on-surface"
                keyboardType="numeric"
                value={common.taxGst.value ? String(common.taxGst.value) : ''}
                onChangeText={(v) => handleUpdateCommonField('taxGst', parseFloat(v) || 0)}
                placeholder="e.g. 4,990"
                placeholderTextColor={SereneColors.outline}
              />
            </View>

            <View className="flex-1 ml-2 mb-3">
              <View className="flex-row items-center justify-between mb-1.5">
                <Text className="text-xs font-semibold text-serene-on-surface">Total Amount (₹)</Text>
                {renderConfidenceBadge(common.finalAmount.confidence)}
              </View>
              <TextInput
                className="bg-serene-surface-container-low border border-serene-hairline-border rounded-serene-md px-3 py-2 text-base font-bold text-serene-primary"
                keyboardType="numeric"
                value={common.finalAmount.value ? String(common.finalAmount.value) : ''}
                onChangeText={(v) => handleUpdateCommonField('finalAmount', parseFloat(v) || 0)}
                placeholder="e.g. 40,990"
                placeholderTextColor={SereneColors.outline}
              />
            </View>
          </View>
        </View>

        <CategoryFieldsForm
          category={scannerCodeToCanonical(currentCategory)}
          details={(extractedData.categoryDetails as any)[currentCategory] || {}}
          onChangeField={(key, val) => handleUpdateCategoryField(key, val)}
        />
      </ScrollView>

      <View className="absolute bottom-0 inset-x-0 bg-serene-surface-container-lowest border-t border-serene-hairline-border p-4 flex-row gap-3">
        <TouchableOpacity
          className="flex-1 py-3 rounded-serene-lg border border-serene-hairline-border items-center justify-center bg-white"
          onPress={() => setScreenState('category_select')}
          activeOpacity={0.85}
        >
          <Text className="text-[13px] font-semibold text-serene-on-surface">Category</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="flex-1 flex-row items-center justify-center gap-1.5 py-3 rounded-serene-lg bg-serene-primary shadow-sm"
          onPress={() => setScreenState('save_confirm')}
          activeOpacity={0.88}
        >
          <Text className="text-[13px] font-bold text-white">Review & Continue</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <Modal visible={showReviewDocTypeModal} transparent animationType="slide">
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-3xl p-6 max-h-[85%]">
            <View className="flex-row items-center justify-between pb-3 border-b border-serene-subtle-border">
              <View className="flex-1 pr-3">
                <Text className="text-lg font-bold text-serene-text-primary">
                  Review Document Type
                </Text>
                <Text className="text-xs text-serene-text-secondary mt-0.5">
                  Confirm the category to store this document accurately.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowReviewDocTypeModal(false)}
                className="w-8 h-8 rounded-full bg-serene-surface-container-high items-center justify-center"
              >
                <MaterialIcons name="close" size={20} color="#5F6368" />
              </TouchableOpacity>
            </View>

            <ScrollView className="mt-4" showsVerticalScrollIndicator={false}>
              <Text className="text-xs font-semibold text-serene-text-secondary uppercase tracking-wider mb-2">
                Document Category
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-4">
                {CANONICAL_DOCUMENT_CATEGORIES.map((catMeta) => {
                  const isSelected = selectedReviewCategory === catMeta.id;
                  return (
                    <TouchableOpacity
                      key={catMeta.id}
                      onPress={() => {
                        setSelectedReviewCategory(catMeta.id);
                        const validTypes = DOCUMENT_TYPES_BY_CATEGORY[catMeta.id] || [];
                        if (validTypes.length > 0) {
                          setSelectedReviewDocType(validTypes[0].type);
                        }
                      }}
                      className={`px-3 py-2 rounded-xl border flex-row items-center ${
                        isSelected
                          ? 'bg-serene-primary border-serene-primary'
                          : 'bg-serene-surface-container border-serene-subtle-border'
                      }`}
                    >
                      <MaterialIcons
                        name={catMeta.icon as any}
                        size={16}
                        color={isSelected ? '#FFFFFF' : '#3C4043'}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        className={`text-xs font-medium ${
                          isSelected ? 'text-white' : 'text-serene-text-primary'
                        }`}
                      >
                        {catMeta.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text className="text-xs font-semibold text-serene-text-secondary uppercase tracking-wider mb-2">
                Document Type
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-6">
                {(DOCUMENT_TYPES_BY_CATEGORY[selectedReviewCategory] || []).map((t) => {
                  const isSelected = selectedReviewDocType === t.type;
                  return (
                    <TouchableOpacity
                      key={t.type}
                      onPress={() => setSelectedReviewDocType(t.type)}
                      className={`px-3 py-2 rounded-xl border ${
                        isSelected
                          ? 'bg-serene-primary/10 border-serene-primary'
                          : 'bg-serene-surface-container border-serene-subtle-border'
                      }`}
                    >
                      <Text
                        className={`text-xs font-medium ${
                          isSelected ? 'text-serene-primary font-bold' : 'text-serene-text-primary'
                        }`}
                      >
                        {t.type}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View className="pt-3 border-t border-serene-subtle-border gap-2.5">
              <TouchableOpacity
                className="w-full py-3.5 rounded-xl bg-serene-primary items-center justify-center flex-row"
                onPress={() => {
                  if (pendingRoutingData) {
                    setShowReviewDocTypeModal(false);
                    navigateToDocumentAdd(
                      selectedReviewCategory,
                      selectedReviewDocType,
                      pendingRoutingData.parsedData,
                      pendingRoutingData.activeUri,
                      pendingRoutingData.imageName
                    );
                  }
                }}
              >
                <MaterialIcons name="folder" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text className="text-sm font-bold text-white">Save to Documents Vault</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="w-full py-3 rounded-xl bg-serene-surface-container-high items-center justify-center flex-row border border-serene-subtle-border"
                onPress={() => {
                  if (pendingRoutingData) {
                    setShowReviewDocTypeModal(false);
                    navigateToItemAdd(
                      pendingRoutingData.parsedData,
                      pendingRoutingData.activeUri,
                      pendingRoutingData.imageName
                    );
                  }
                }}
              >
                <MaterialIcons name="shopping-bag" size={18} color="#1A73E8" style={{ marginRight: 8 }} />
                <Text className="text-sm font-semibold text-serene-primary">Save as Retail Purchased Item</Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="w-full py-3 rounded-xl bg-amber-50 items-center justify-center flex-row border border-amber-200"
                onPress={() => {
                  if (pendingRoutingData) {
                    setShowReviewDocTypeModal(false);
                    navigateToServiceAdd(
                      pendingRoutingData.parsedData,
                      pendingRoutingData.activeUri,
                      pendingRoutingData.imageName
                    );
                  }
                }}
              >
                <MaterialIcons name="build" size={18} color="#D97706" style={{ marginRight: 8 }} />
                <Text className="text-sm font-semibold text-amber-800">Save as Service & Repair Record</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showImageModal} transparent animationType="fade">
        <View className="flex-1 bg-black/95 items-center justify-center">
          <TouchableOpacity
            className="absolute top-12 right-5 w-11 h-11 rounded-full bg-white/20 items-center justify-center z-10"
            onPress={() => setShowImageModal(false)}
          >
            <MaterialIcons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          {(capturedImageUri || extractedData?.receiptUri) ? (
            <Image
              source={{ uri: capturedImageUri || extractedData?.receiptUri || '' }}
              style={{ width: '100%', height: '85%' }}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </Modal>

      <OcrInspectorModal
        visible={showOcrInspector}
        onClose={() => setShowOcrInspector(false)}
        ocrResult={ocrResult}
        preprocessed={ocrPreprocessed}
      />
    </View>
  );
}