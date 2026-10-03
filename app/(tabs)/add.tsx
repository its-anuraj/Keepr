
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Header } from '../../src/components/ui/Header';
import { SereneColors } from '../../src/constants/theme';
import { useItemStore } from '../../src/store/itemStore';
import { getActiveReceiptSession, clearActiveReceiptSession } from '../../src/store/receiptSessionStore';
import * as FileSystem from 'expo-file-system/legacy';
import {
  safeNormalizeRouteUri,
  normalizeImageUri,
  verifyReceiptFileExists,
  persistReceiptToVault,
  persistProductPhotoToVault,
  logReceiptDebug,
} from '../../src/services/receiptFileService';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  DEFAULT_CATEGORIES,
  getItemCategoryConfig,
  getProductTypesForCategory,
} from '../../src/constants/categories';
import { normalizeDateToIso } from '../../src/services/receiptParser';
import { formatDate } from '../../src/utils/currency';
import { isNoWarrantyCategory } from '../../src/utils/warranty';

export default function AddOrEditItemScreen() {
  const params = useLocalSearchParams<{
    editId?: string;
    fromScan?: string;
    scannedReceiptUri?: string;
    scannedReceiptName?: string;
    scannedProductName?: string;
    scannedMerchant?: string;
    scannedSellerAddress?: string;
    scannedGstin?: string;
    scannedPurchaseDate?: string;
    scannedPurchasePrice?: string;
    scannedSubtotal?: string;
    scannedDiscount?: string;
    scannedGstTax?: string;
    scannedGstRate?: string;
    scannedCgst?: string;
    scannedSgst?: string;
    scannedIgst?: string;
    scannedQuantity?: string;
    scannedUnitPrice?: string;
    scannedCategory?: string;
    scannedCategoryConfidence?: string;
    scannedProductType?: string;
    scannedInvoiceNumber?: string;
    scannedReturnUntil?: string;
    scannedWarrantyUntil?: string;
    scannedWarrantyProvider?: string;
    scannedBrand?: string;
    scannedModel?: string;
    scannedSerialNumber?: string;
    scannedNotes?: string;
    categoryId?: string;
  }>();

  const isEditMode = Boolean(params.editId);
  const isFromScan = Boolean(
    params.fromScan === 'true' ||
    params.scannedReceiptUri ||
    params.scannedProductName
  );

  const getItemById = useItemStore((s) => s.getItemById);
  const addItem = useItemStore((s) => s.addItem);
  const updateItem = useItemStore((s) => s.updateItem);
  const categories = useItemStore((s) => s.categories);
  const resetFilters = useItemStore((s) => s.resetFilters);

  const initialCategory = params.scannedCategory || params.categoryId || null;
  const [categoryId, setCategoryId] = useState<string | null>(initialCategory);
  const [categoryConfidence, setCategoryConfidence] = useState<'high' | 'medium' | 'low' | null>(
    (params.scannedCategoryConfidence as 'high' | 'medium' | 'low') || (params.scannedCategory ? 'high' : null)
  );

  const catConfig = getItemCategoryConfig(categoryId);

  const [name, setName] = useState(params.scannedProductName || '');
  const [productType, setProductType] = useState<string>(params.scannedProductType || '');
  const [purchasePrice, setPurchasePrice] = useState(params.scannedPurchasePrice || '');
  const [purchaseDate, setPurchaseDate] = useState(
    params.scannedPurchaseDate || new Date().toISOString().split('T')[0]
  );
  const [merchant, setMerchant] = useState(params.scannedMerchant || '');

  const [subtotal, setSubtotal] = useState(params.scannedSubtotal || '');
  const [discount, setDiscount] = useState(params.scannedDiscount || '');
  const [gstTax, setGstTax] = useState(params.scannedGstTax || '');
  const [gstRate, setGstRate] = useState(params.scannedGstRate || '');
  const [cgst, setCgst] = useState(params.scannedCgst || '');
  const [sgst, setSgst] = useState(params.scannedSgst || '');
  const [igst, setIgst] = useState(params.scannedIgst || '');
  const [quantity, setQuantity] = useState(params.scannedQuantity || '1');
  const [unitPrice, setUnitPrice] = useState(params.scannedUnitPrice || '');

  const [sellerAddress, setSellerAddress] = useState(params.scannedSellerAddress || '');
  const [gstin, setGstin] = useState(params.scannedGstin || '');
  const [invoiceNumber, setInvoiceNumber] = useState(params.scannedInvoiceNumber || '');

  const [brand, setBrand] = useState(params.scannedBrand || '');
  const [model, setModel] = useState(params.scannedModel || '');
  const [serialNumber, setSerialNumber] = useState(params.scannedSerialNumber || '');
  const [imei, setImei] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [material, setMaterial] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [vinChassisNumber, setVinChassisNumber] = useState('');
  const [engineNumber, setEngineNumber] = useState('');
  const [variant, setVariant] = useState('');
  const [dealer, setDealer] = useState('');
  const [insuranceExpiry, setInsuranceExpiry] = useState('');
  const [pucDate, setPucDate] = useState('');

  const isInitialVehicle = Boolean(
    categoryId === 'vehicles' ||
    params.scannedCategory?.toLowerCase().includes('vehicle')
  );
  // Vehicles: return deadline default OFF (custom arrangement only). General: default ON.
  const [returnEnabled, setReturnEnabled] = useState(
    !isInitialVehicle && Boolean(params.scannedReturnUntil || !params.editId)
  );
  const [returnUntil, setReturnUntil] = useState(params.scannedReturnUntil || '');

  // Warranty: For Vehicles, default OFF unless explicitly scanned/provided.
  // For Fashion/Beauty, suppressed. For Electronics/Appliances, default ON.
  const [warrantyEnabled, setWarrantyEnabled] = useState(
    isInitialVehicle ? Boolean(params.scannedWarrantyUntil) : !isNoWarrantyCategory(categoryId)
  );
  const [warrantyUntil, setWarrantyUntil] = useState(params.scannedWarrantyUntil || '');
  const [warrantyProvider, setWarrantyProvider] = useState(params.scannedWarrantyProvider || '');
  const [enableReminder, setEnableReminder] = useState(true);

  const [productPhotos, setProductPhotos] = useState<string[]>([]);

  type ReceiptStatus = 'none' | 'selected' | 'attached' | 'unavailable';

  // CRITICAL FIX FOR BUG #20:
  // If NOT from scan and NOT editing, initial receipt must be strictly null.
  // Do NOT load getActiveReceiptSession() if this is a fresh manual Add Item!
  const _initSession = isFromScan ? getActiveReceiptSession() : null;
  const initialReceiptUri = isFromScan
    ? (normalizeImageUri(_initSession?.uri) || normalizeImageUri(params.scannedReceiptUri) || null)
    : null;

  const [attachedReceiptUri, setAttachedReceiptUri] = useState<string | null>(initialReceiptUri);
  const [attachedReceiptPath, setAttachedReceiptPath] = useState<string | null>(null);
  const [attachedReceiptName, setAttachedReceiptName] = useState<string | null>(
    isFromScan ? (params.scannedReceiptName || _initSession?.fileName || 'Receipt.jpg') : null
  );
  const [receiptStatus, setReceiptStatus] = useState<ReceiptStatus>(initialReceiptUri ? 'selected' : 'none');

  const [additionalReceiptPhotos, setAdditionalReceiptPhotos] = useState<string[]>([]);

  const [previewModalUri, setPreviewModalUri] = useState<string | null>(null);
  const [previewModalTitle, setPreviewModalTitle] = useState<string>('Preview');

  const [notes, setNotes] = useState(params.scannedNotes || '');

  const hasAdvancedPrefilled = Boolean(
    params.scannedGstin ||
    params.scannedSubtotal ||
    params.scannedDiscount ||
    params.scannedSellerAddress ||
    params.scannedModel ||
    params.scannedSerialNumber ||
    params.scannedUnitPrice ||
    params.scannedGstRate ||
    params.scannedCgst ||
    params.scannedSgst ||
    params.scannedIgst
  );
  const [showMoreDetails, setShowMoreDetails] = useState(hasAdvancedPrefilled);

  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    category?: string;
    price?: string;
    date?: string;
    merchant?: string;
    quantity?: string;
    brand?: string;
    receipt?: string;
    productPhotos?: string;
  }>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFromScan && !isEditMode) {
      clearActiveReceiptSession();
    }
  }, [isFromScan, isEditMode]);

  useEffect(() => {
    if (params.editId) {
      const existing = getItemById(params.editId);
      if (existing) {
        setName(existing.name || '');
        setCategoryId(existing.categoryId || null);
        setProductType(existing.productType || '');
        setCategoryConfidence(existing.categoryConfidence || null);
        setPurchasePrice(existing.purchasePrice ? String(existing.purchasePrice) : '');
        setSubtotal(existing.subtotal ? String(existing.subtotal) : '');
        setDiscount(existing.discount ? String(existing.discount) : '');
        setPurchaseDate(existing.purchaseDate || new Date().toISOString().split('T')[0]);
        setMerchant(existing.merchant || '');
        setSellerAddress(existing.sellerAddress || '');
        setGstin(existing.gstin || '');
        setGstTax(existing.gstTax || '');
        setInvoiceNumber(existing.invoiceNumber || '');
        setNotes(existing.notes || '');

        if (existing.subtotal || existing.discount || existing.gstin || existing.sellerAddress) {
          setShowMoreDetails(true);
        }

        if (existing.returnUntil) {
          setReturnEnabled(true);
          setReturnUntil(existing.returnUntil);
        }

        if (existing.productPhotos && existing.productPhotos.length > 0) {
          setProductPhotos(existing.productPhotos);
        } else {
          const pPhoto = existing.photoUri || existing.imageUrl;
          if (pPhoto && pPhoto !== existing.receiptUri) {
            setProductPhotos([pPhoto]);
          }
        }

        const rUri = existing.receiptUri || existing.documents?.[0]?.fileUrl;
        const rPath = existing.receiptPath || existing.documents?.[0]?.filePath;
        if (rUri || rPath) {
          const normalizedR = normalizeImageUri(rPath ? safeNormalizeRouteUri(rPath) : rUri);
          setAttachedReceiptUri(normalizedR);
          setAttachedReceiptPath(rPath || null);
          setAttachedReceiptName(existing.receiptName || existing.documents?.[0]?.name || 'Receipt.jpg');
          setReceiptStatus('selected');
          verifyReceiptFileExists(normalizedR || rUri).then((exists) => {
            setReceiptStatus(exists ? 'attached' : 'unavailable');
          }).catch(() => setReceiptStatus('unavailable'));
        }

        if (existing.documents && existing.documents.length > 1) {
          const addDocs = existing.documents.slice(1).map((d) => d.fileUrl).filter(Boolean);
          setAdditionalReceiptPhotos(addDocs);
        }

        setBrand(existing.brand || '');
        setModel(existing.model || '');
        setSerialNumber(existing.serialNumber || '');
        setImei(existing.imei || '');
        setSize(existing.size || '');
        setColor(existing.color || '');
        setMaterial(existing.material || '');
        setRegistrationNumber(existing.registrationNumber || '');
        setVinChassisNumber(existing.vinChassisNumber || '');
        setEngineNumber(existing.engineNumber || '');
        setVariant(existing.variant || '');
        setDealer(existing.dealer || '');
        setInsuranceExpiry(existing.insuranceExpiry || '');
        setPucDate(existing.pucDate || '');

        const warEnd = existing.warrantyUntil || existing.warranty?.endDate;
        if (warEnd) {
          setWarrantyEnabled(true);
          setWarrantyUntil(warEnd);
          setWarrantyProvider(existing.warrantyProvider || existing.warranty?.provider || '');
        }
      }
    }
  }, [params.editId, getItemById]);

  useEffect(() => {
    if (isEditMode || !isFromScan) return;

    const activeReceipt = getActiveReceiptSession();
    const effectiveReceiptUri =
      normalizeImageUri(activeReceipt?.uri) ||
      normalizeImageUri(params.scannedReceiptUri);

    if (effectiveReceiptUri) {
      setAttachedReceiptUri(effectiveReceiptUri);
      setAttachedReceiptName(params.scannedReceiptName || activeReceipt?.fileName || 'Receipt.jpg');
      setReceiptStatus('selected');

      logReceiptDebug('SELECTED', {
        originalUri: effectiveReceiptUri,
        sourceType: activeReceipt?.source || (params.scannedReceiptUri ? 'param' : 'none'),
        fileName: params.scannedReceiptName || activeReceipt?.fileName || 'Receipt.jpg',
        mimeType: activeReceipt?.mimeType || 'image/jpeg',
      });

      const base64ForPersist = activeReceipt?.base64 || null;
      const fileNameForPersist = params.scannedReceiptName || activeReceipt?.fileName || 'Receipt.jpg';
      persistReceiptToVault(effectiveReceiptUri, fileNameForPersist, base64ForPersist)
        .then(async (persistRes) => {
          if (persistRes.persisted && persistRes.uri) {
            const vaultInfo = await FileSystem.getInfoAsync(persistRes.uri).catch(() => null);
            const confirmed = vaultInfo?.exists && !vaultInfo.isDirectory && (vaultInfo.size === undefined || vaultInfo.size > 0);
            if (confirmed) {
              setAttachedReceiptUri(persistRes.uri);
              if (persistRes.storagePath) setAttachedReceiptPath(persistRes.storagePath);
              setReceiptStatus('attached');
            } else {
              setReceiptStatus('unavailable');
            }
          } else {
            const origExists = await verifyReceiptFileExists(effectiveReceiptUri);
            setReceiptStatus(origExists ? 'attached' : 'unavailable');
          }
        })
        .catch(async () => {
          const origExists = await verifyReceiptFileExists(effectiveReceiptUri);
          setReceiptStatus(origExists ? 'attached' : 'unavailable');
        });
    }

    if (params.scannedProductName) setName(params.scannedProductName);
    if (params.scannedMerchant) setMerchant(params.scannedMerchant);
    if (params.scannedSellerAddress) setSellerAddress(params.scannedSellerAddress);
    if (params.scannedGstin) setGstin(params.scannedGstin);
    if (params.scannedPurchaseDate) setPurchaseDate(params.scannedPurchaseDate);
    if (params.scannedPurchasePrice) setPurchasePrice(params.scannedPurchasePrice);
    if (params.scannedSubtotal) setSubtotal(params.scannedSubtotal);
    if (params.scannedDiscount) setDiscount(params.scannedDiscount);
    if (params.scannedGstTax) setGstTax(params.scannedGstTax);
    if (params.scannedInvoiceNumber) setInvoiceNumber(params.scannedInvoiceNumber);
    if (params.scannedCategory) setCategoryId(params.scannedCategory);
    if (params.scannedCategoryConfidence) setCategoryConfidence(params.scannedCategoryConfidence as any);
    if (params.scannedProductType) setProductType(params.scannedProductType);
    if (params.scannedReturnUntil) {
      setReturnEnabled(true);
      setReturnUntil(params.scannedReturnUntil);
    }
    if (params.scannedWarrantyUntil) {
      setWarrantyEnabled(true);
      setWarrantyUntil(params.scannedWarrantyUntil);
      if (params.scannedWarrantyProvider) {
        setWarrantyProvider(params.scannedWarrantyProvider);
      }
    }
    if (params.scannedBrand) setBrand(params.scannedBrand);
    if (params.scannedModel) setModel(params.scannedModel);
    if (params.scannedSerialNumber) setSerialNumber(params.scannedSerialNumber);
    if (params.scannedNotes) setNotes(params.scannedNotes);

    if (
      params.scannedGstin ||
      params.scannedSubtotal ||
      params.scannedDiscount ||
      params.scannedSellerAddress ||
      params.scannedModel ||
      params.scannedSerialNumber
    ) {
      setShowMoreDetails(true);
    }
  }, [
    isEditMode,
    isFromScan,
    params.scannedReceiptUri,
    params.scannedReceiptName,
    params.scannedProductName,
    params.scannedMerchant,
    params.scannedSellerAddress,
    params.scannedGstin,
    params.scannedPurchaseDate,
    params.scannedPurchasePrice,
    params.scannedSubtotal,
    params.scannedDiscount,
    params.scannedGstTax,
    params.scannedCategory,
    params.scannedCategoryConfidence,
    params.scannedProductType,
    params.scannedInvoiceNumber,
    params.scannedReturnUntil,
    params.scannedWarrantyUntil,
    params.scannedWarrantyProvider,
    params.scannedBrand,
    params.scannedModel,
    params.scannedSerialNumber,
    params.scannedNotes,
  ]);

  const handleSelectCategory = (catId: string) => {
    setCategoryId(catId);
    setCategoryConfidence('high');
    if (fieldErrors.category) {
      setFieldErrors((prev) => ({ ...prev, category: undefined }));
    }

    const config = getItemCategoryConfig(catId);
    if (catId === 'vehicles') {
      setReturnEnabled(false);
      setReturnUntil('');
      setWarrantyEnabled(false);
      setWarrantyUntil('');
    } else if (catId === 'fashion' || catId === 'beauty') {
      setWarrantyEnabled(false);
      setWarrantyUntil('');
      setReturnEnabled(true);
    } else {
      setWarrantyEnabled(config.defaultWarrantyEnabled);
      setReturnEnabled(config.defaultReturnEnabled);
    }

    const validTypes = getProductTypesForCategory(catId);
    if (!validTypes.map((v) => v.toLowerCase()).includes(productType.toLowerCase())) {
      setProductType('');
    }
  };

  const applyReturnDaysOffset = (days: number) => {
    const base = purchaseDate ? new Date(purchaseDate) : new Date();
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    setReturnEnabled(true);
    setReturnUntil(d.toISOString().split('T')[0]);
  };

  const applyWarrantyYearsOffset = (years: number) => {
    const base = purchaseDate ? new Date(purchaseDate) : new Date();
    const d = new Date(base);
    d.setFullYear(d.getFullYear() + years);
    setWarrantyEnabled(true);
    setWarrantyUntil(d.toISOString().split('T')[0]);
  };

  const handleCaptureProductPhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera Permission', 'Camera access is needed to photograph the item.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.85,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        const uri = res.assets[0].uri;
        const persistRes = await persistProductPhotoToVault(uri, 'product_photo.jpg');
        const finalUri = persistRes.persisted && persistRes.uri ? persistRes.uri : uri;
        setProductPhotos((prev) => [...prev, finalUri]);
      }
    } catch (err) {
      console.warn('Product camera error:', err);
    }
  };

  const handlePickProductPhotoGallery = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Gallery Permission', 'Gallery access is needed to select a photo.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        quality: 0.85,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        for (const asset of res.assets) {
          const persistRes = await persistProductPhotoToVault(asset.uri, 'product_photo.jpg');
          const finalUri = persistRes.persisted && persistRes.uri ? persistRes.uri : asset.uri;
          setProductPhotos((prev) => [...prev, finalUri]);
        }
      }
    } catch (err) {
      console.warn('Product gallery error:', err);
    }
  };

  const handleRemoveProductPhoto = (indexToRemove: number) => {
    setProductPhotos((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleCaptureReceipt = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera Permission', 'Camera access is needed to photograph your receipt.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        const tempUri = normalizeImageUri(res.assets[0].uri);
        const base64 = res.assets[0].base64 || null;
        const fileName = `Receipt_${new Date().toISOString().slice(0, 10)}.jpg`;

        if (!attachedReceiptUri) {
          setAttachedReceiptUri(tempUri);
          setAttachedReceiptName(fileName);
          setReceiptStatus('selected');
          if (fieldErrors.receipt) setFieldErrors((prev) => ({ ...prev, receipt: undefined }));

          const persistRes = await persistReceiptToVault(tempUri, fileName, base64);
          if (persistRes.persisted && persistRes.uri) {
            setAttachedReceiptUri(persistRes.uri);
            if (persistRes.storagePath) setAttachedReceiptPath(persistRes.storagePath);
            setReceiptStatus('attached');
          } else {
            const origExists = await verifyReceiptFileExists(tempUri || '');
            setReceiptStatus(origExists ? 'attached' : 'unavailable');
          }
        } else {
          const persistRes = await persistReceiptToVault(tempUri, `Receipt_Page_${additionalReceiptPhotos.length + 2}.jpg`, base64);
          const finalUri = persistRes.persisted && persistRes.uri ? persistRes.uri : (tempUri || '');
          if (finalUri) setAdditionalReceiptPhotos((prev) => [...prev, finalUri]);
        }
      }
    } catch (err) {
      console.warn('Receipt camera error:', err);
    }
  };

  const handlePickReceiptGallery = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Gallery Permission', 'Gallery access is needed to select your receipt image.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        quality: 0.9,
        base64: true,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        for (let i = 0; i < res.assets.length; i++) {
          const asset = res.assets[i];
          const tempUri = normalizeImageUri(asset.uri);
          const base64 = asset.base64 || null;
          const fileName = `Receipt_${new Date().toISOString().slice(0, 10)}_${i + 1}.jpg`;

          if (i === 0 && !attachedReceiptUri) {
            setAttachedReceiptUri(tempUri);
            setAttachedReceiptName(fileName);
            setReceiptStatus('selected');
            if (fieldErrors.receipt) setFieldErrors((prev) => ({ ...prev, receipt: undefined }));

            const persistRes = await persistReceiptToVault(tempUri, fileName, base64);
            if (persistRes.persisted && persistRes.uri) {
              setAttachedReceiptUri(persistRes.uri);
              if (persistRes.storagePath) setAttachedReceiptPath(persistRes.storagePath);
              setReceiptStatus('attached');
            } else {
              const origExists = await verifyReceiptFileExists(tempUri || '');
              setReceiptStatus(origExists ? 'attached' : 'unavailable');
            }
          } else {
            const persistRes = await persistReceiptToVault(tempUri, fileName, base64);
            const finalUri = persistRes.persisted && persistRes.uri ? persistRes.uri : (tempUri || '');
            if (finalUri) setAdditionalReceiptPhotos((prev) => [...prev, finalUri]);
          }
        }
      }
    } catch (err) {
      console.warn('Receipt gallery error:', err);
    }
  };

  const handlePickReceiptDocument = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        const norm = normalizeImageUri(res.assets[0].uri);
        const docName = res.assets[0].name || 'Invoice.pdf';
        if (!attachedReceiptUri) {
          setAttachedReceiptUri(norm);
          setAttachedReceiptName(docName);
          setReceiptStatus('attached');
          if (fieldErrors.receipt) setFieldErrors((prev) => ({ ...prev, receipt: undefined }));
        } else if (norm) {
          setAdditionalReceiptPhotos((prev) => [...prev, norm]);
        }
      }
    } catch (err) {
      console.warn('Document picker error:', err);
    }
  };

  const handleSave = async () => {
    setFormError(null);
    setSaveErrorMessage(null);

    const errors: {
      name?: string;
      category?: string;
      price?: string;
      date?: string;
      merchant?: string;
      brand?: string;
      productPhotos?: string;
    } = {};

    const missingFields: string[] = [];

    if (!name.trim()) {
      errors.name = 'Please enter the item name.';
      missingFields.push('name');
    }

    const cleanPrice = parseFloat(purchasePrice.replace(/[^0-9.]/g, ''));
    if (isNaN(cleanPrice) || cleanPrice <= 0) {
      errors.price = 'Please enter a valid price.';
      missingFields.push('price');
    }

    if (!purchaseDate || !purchaseDate.trim()) {
      errors.date = 'Please enter the purchase date.';
      missingFields.push('date');
    }

    if (!merchant || !merchant.trim()) {
      errors.merchant = catConfig.sellerFieldLabel
        ? `Please enter the ${catConfig.sellerFieldLabel.toLowerCase()}.`
        : 'Please enter the shop or seller name.';
      missingFields.push('merchant');
    }

    if (
      (categoryId === 'electronics' || categoryId === 'appliances' || categoryId === 'vehicles') &&
      (!brand || !brand.trim())
    ) {
      errors.brand = 'Please enter the brand or manufacturer.';
      missingFields.push('brand');
    }

    // 6. Product Photo (Requirement 1: Mandatory for Purchased Items - Minimum 1 photo)
    if (!productPhotos || productPhotos.length === 0) {
      errors.productPhotos = 'At least one product photo is required.';
      missingFields.push('productPhotos');
    }

    if (missingFields.length > 0) {
      setFieldErrors(errors);
      if (errors.brand) setShowMoreDetails(true);

      if (missingFields.length === 1) {
        if (errors.name) setFormError('Please enter the item name.');
        else if (errors.price) setFormError('Please enter the purchase amount.');
        else if (errors.date) setFormError('Please enter the purchase date.');
        else if (errors.merchant) setFormError(errors.merchant);
        else if (errors.brand) setFormError('Please enter the brand.');
        else if (errors.productPhotos) setFormError('At least one product photo is required before saving.');
      } else {
        if (errors.productPhotos) {
          setFormError('Please complete required fields including at least one product photo.');
        } else {
          setFormError('Please complete the required purchase details.');
        }
      }
      return;
    }

    setFieldErrors({});
    setSaveStatus('saving');

    try {
      const isNoWarranty = isNoWarrantyCategory(categoryId, catConfig.label, productType);
      const cleanSubtotal = subtotal ? parseFloat(subtotal.replace(/[^0-9.]/g, '')) : undefined;
      const cleanDiscount = discount ? parseFloat(discount.replace(/[^0-9.]/g, '')) : undefined;
      const rawReturn = returnEnabled && returnUntil.trim() ? returnUntil.trim() : null;
      const finalReturnUntil = rawReturn ? (normalizeDateToIso(rawReturn) || rawReturn) : null;

      // For Fashion, Beauty & Personal Care: warrantyEndDate remains NULL
      const rawWarranty = !isNoWarranty && warrantyEnabled && warrantyUntil.trim() ? warrantyUntil.trim() : null;
      const finalWarrantyUntil = rawWarranty ? (normalizeDateToIso(rawWarranty) || rawWarranty) : null;
      const normalizedPurchaseDate = normalizeDateToIso(purchaseDate.trim()) || purchaseDate.trim();

      const primaryProductPhoto = productPhotos[0] || undefined;
      let persistentReceiptUri = attachedReceiptUri || undefined;
      let persistentReceiptPath = attachedReceiptPath || undefined;

      if (attachedReceiptUri) {
        try {
          const sessionBase64 = isFromScan ? getActiveReceiptSession()?.base64 || null : null;
          const persistRes = await persistReceiptToVault(
            attachedReceiptUri,
            attachedReceiptName || undefined,
            sessionBase64
          );
          if (persistRes.persisted && persistRes.uri) {
            persistentReceiptUri = persistRes.uri;
            persistentReceiptPath = persistRes.storagePath || persistentReceiptPath;
          }
        } catch (pErr) {
          console.warn('[AddScreen] Receipt persistence note:', pErr);
        }
      }

      const canonicalStoragePath =
        persistentReceiptPath ||
        (persistentReceiptUri && persistentReceiptUri.includes('vault_receipts/')
          ? `vault_receipts/${persistentReceiptUri.split('vault_receipts/')[1]}`
          : undefined);

      const cleanQty = quantity ? parseInt(quantity.replace(/[^0-9]/g, ''), 10) : 1;

      const itemPayload = {
        name: name.trim(),
        categoryId: categoryId || 'other',
        productType: productType.trim() || undefined,
        categoryConfidence: categoryConfidence || undefined,
        purchasePrice: cleanPrice,
        quantity: cleanQty > 0 ? cleanQty : 1,
        unitPrice: unitPrice ? parseFloat(unitPrice.replace(/[^0-9.]/g, '')) : undefined,
        subtotal: cleanSubtotal,
        discount: cleanDiscount,
        currency: 'INR',
        purchaseDate: normalizedPurchaseDate,
        merchant: merchant.trim() || undefined,
        sellerAddress: sellerAddress.trim() || undefined,
        gstin: gstin.trim() || undefined,
        gstTax: gstTax.trim() || undefined,
        gstRate: gstRate.trim() || undefined,
        cgst: cgst.trim() || undefined,
        sgst: sgst.trim() || undefined,
        igst: igst.trim() || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        returnUntil: finalReturnUntil,
        warrantyUntil: finalWarrantyUntil,
        warrantyProvider: !isNoWarranty && warrantyProvider.trim() ? warrantyProvider.trim() : undefined,
        receiptUri: persistentReceiptUri,
        receiptPath: canonicalStoragePath,
        receiptName: attachedReceiptName || undefined,
        receiptType: (Boolean(invoiceNumber.trim()) ? 'invoice' : 'receipt') as 'receipt' | 'invoice',
        productPhotos: productPhotos,
        additionalReceiptUris: additionalReceiptPhotos,
        photoUri: primaryProductPhoto || undefined,
        imageUrl: primaryProductPhoto || undefined,
        notes: notes.trim() || undefined,
        brand: brand.trim() || undefined,
        model: model.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        imei: imei.trim() || undefined,
        size: size.trim() || undefined,
        color: color.trim() || undefined,
        material: material.trim() || undefined,
        registrationNumber: registrationNumber.trim() || undefined,
        vinChassisNumber: vinChassisNumber.trim() || undefined,
        engineNumber: engineNumber.trim() || undefined,
        variant: variant.trim() || undefined,
        dealer: dealer.trim() || undefined,
        insuranceExpiry: insuranceExpiry.trim() || undefined,
        pucDate: pucDate.trim() || undefined,
      };

      if (isEditMode && params.editId) {
        await updateItem(params.editId, itemPayload);
        resetFilters();
        clearActiveReceiptSession();
        setSaveStatus('saved');
        setTimeout(() => {
          router.replace(`/item/${params.editId}`);
        }, 300);
      } else {
        const created = await addItem({
          ...itemPayload,
          enableWarrantyReminder: isNoWarranty ? false : enableReminder,
        });

        if (!created || !created.id) {
          throw new Error('Item was created without a valid ID.');
        }

        resetFilters();
        clearActiveReceiptSession();
        setSaveStatus('saved');
        setTimeout(() => {
          router.replace(`/item/${created.id}`);
        }, 300);
      }
    } catch (err: unknown) {
      console.error('[AddScreen] Save error:', err);
      setSaveStatus('error');
      setSaveErrorMessage("Couldn't save this purchase. Your entered details are safe.");
    }
  };

  const selectedCatObj = categoryId ? categories.find((c) => c.id === categoryId) : null;
  const selectedCatName = selectedCatObj ? selectedCatObj.name : catConfig.label;

  if (!categoryId && !isEditMode) {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-serene-surface"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Header title="Add Item" showBack={false} />

        <ScrollView
          contentContainerClassName="px-4 py-4 pb-20 gap-4"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text className="text-xl font-bold text-serene-on-surface">Choose Category</Text>
            <Text className="text-xs text-serene-on-surface-variant mt-1">
              Select the category that best describes your purchase to open the customized record form.
            </Text>
          </View>

          <TouchableOpacity
            className="bg-serene-surface-container-lowest rounded-serene-xl p-3.5 flex-row items-center justify-between border border-[#3368A0]/30 shadow-sm"
            onPress={() => router.push('/scan-receipt?mode=camera' as any)}
            activeOpacity={0.88}
          >
            <View className="flex-1 flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-full bg-serene-primary items-center justify-center">
                <MaterialIcons name="document-scanner" size={20} color="#FFFFFF" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-1">
                  <Text className="text-xs font-bold text-serene-primary">SCAN RECEIPT / BILL</Text>
                  <Text className="text-[10px] text-serene-outline">· Auto-detect</Text>
                </View>
                <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">
                  Scan invoice to automatically detect category, product, price & seller.
                </Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={SereneColors.primary} />
          </TouchableOpacity>

          <View className="gap-2.5">
            <Text className="text-xs font-bold text-serene-on-surface tracking-wider uppercase">
              Or Select a Category Manually
            </Text>

            {DEFAULT_CATEGORIES.map((cat) => {
              return (
                <TouchableOpacity
                  key={cat.id}
                  className="bg-serene-surface-container-lowest rounded-serene-xl p-3.5 flex-row items-center justify-between border border-serene-subtle-border shadow-xs active:border-serene-primary"
                  activeOpacity={0.82}
                  onPress={() => handleSelectCategory(cat.id)}
                >
                  <View className="flex-row items-center gap-3.5 flex-1 mr-2">
                    <View className="w-10 h-10 rounded-full bg-serene-surface-container-high items-center justify-center shrink-0">
                      <MaterialIcons name={cat.icon as any} size={20} color={SereneColors.primary} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-[14px] font-bold text-serene-on-surface">{cat.name}</Text>
                      <Text className="text-[11px] text-serene-on-surface-variant mt-0.5" numberOfLines={1}>
                        {cat.description}
                      </Text>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={SereneColors.outline} />
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-serene-surface"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header
        title={isEditMode ? 'Edit Item' : `${selectedCatName} Record`}
        showBack={isEditMode}
      />

      <ScrollView
        contentContainerClassName="px-4 pb-20 gap-4"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="py-1">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-2">
              <Text className="text-xl font-bold text-serene-on-surface">
                {isEditMode ? 'Edit Purchase Record' : `Save ${selectedCatName}`}
              </Text>
              <Text className="text-xs text-serene-on-surface-variant mt-0.5">
                {isEditMode ? 'Update purchase and warranty details' : 'Keepr safely stores your proof of ownership'}
              </Text>
            </View>

            {!isEditMode && (
              <TouchableOpacity
                onPress={() => setCategoryId(null)}
                className="px-3 py-1.5 rounded-full bg-serene-surface-container-high border border-serene-subtle-border flex-row items-center gap-1"
                activeOpacity={0.8}
              >
                <MaterialIcons name="swap-horiz" size={14} color={SereneColors.primary} />
                <Text className="text-[11px] font-semibold text-serene-primary">Change Category</Text>
              </TouchableOpacity>
            )}
          </View>

          <View className="flex-row items-center gap-2.5 mt-3">
            <TouchableOpacity
              onPress={() => {
                if (!isEditMode && categoryId) {
                  setCategoryId(null);
                } else {
                  router.back();
                }
              }}
              activeOpacity={0.75}
              className="px-4 py-2.5 rounded-serene-md border border-serene-outline-variant/60 bg-serene-surface items-center justify-center min-h-[44px]"
            >
              <Text className="text-[13px] text-serene-on-surface-variant font-medium">Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className={`flex-1 flex-row items-center justify-center gap-1.5 px-4 py-2.5 rounded-serene-md shadow-sm min-h-[44px] ${
                saveStatus === 'saved'
                  ? 'bg-emerald-700'
                  : saveStatus === 'error'
                  ? 'bg-amber-800'
                  : 'bg-serene-primary'
              } ${saveStatus === 'saving' ? 'opacity-70' : ''}`}
              activeOpacity={0.88}
              onPress={handleSave}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? (
                <>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text className="text-[13px] font-semibold text-white">Saving…</Text>
                </>
              ) : saveStatus === 'saved' ? (
                <>
                  <MaterialIcons name="check" size={17} color="#FFFFFF" />
                  <Text className="text-[13px] font-semibold text-white">Saved</Text>
                </>
              ) : saveStatus === 'error' ? (
                <>
                  <MaterialIcons name="replay" size={17} color="#FFFFFF" />
                  <Text className="text-[13px] font-semibold text-white">Try Again</Text>
                </>
              ) : (
                <>
                  <MaterialIcons name="check" size={17} color="#FFFFFF" />
                  <Text className="text-[13px] font-semibold text-white">
                    {isEditMode ? 'Save Changes' : 'Save Purchase'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {saveStatus === 'error' && saveErrorMessage ? (
          <View className="bg-red-50 border border-red-200 p-3 rounded-serene-lg flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1 mr-2">
              <MaterialIcons name="error-outline" size={20} color={SereneColors.error} />
              <View className="flex-1">
                <Text className="text-xs font-bold text-red-900">{saveErrorMessage}</Text>
                <Text className="text-[11px] text-red-700 mt-0.5">Your input is safe. Tap Try Again to re-attempt.</Text>
              </View>
            </View>
            <TouchableOpacity
              className="bg-serene-primary px-3 py-1.5 rounded-serene-md"
              onPress={handleSave}
            >
              <Text className="text-xs font-semibold text-white">Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {formError ? (
          <View className="flex-row items-center gap-2 bg-serene-error-container p-2.5 rounded-serene-md">
            <MaterialIcons name="error-outline" size={18} color={SereneColors.error} />
            <Text className="text-xs text-serene-error font-medium flex-1">{formError}</Text>
          </View>
        ) : null}

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border gap-3.5 shadow-sm">
          <View className="flex-row items-center justify-between">
            <Text className="text-[15px] font-bold text-serene-on-surface">Purchase Information</Text>
            <View className="bg-serene-surface-container-high px-2 py-0.5 rounded-full">
              <Text className="text-[10px] font-bold text-serene-primary">{selectedCatName}</Text>
            </View>
          </View>

          <View className="gap-1">
            <Text className="text-xs font-semibold text-serene-on-surface">
              {categoryId === 'vehicles' ? 'Vehicle Name *' : 'Item / Product Name *'}
            </Text>
            <TextInput
              className={`bg-serene-surface-container-low rounded-serene-md border px-3 py-2.5 text-[14px] text-serene-on-surface ${
                fieldErrors.name ? 'border-red-500' : 'border-serene-subtle-border'
              }`}
              placeholder={catConfig.namePlaceholder}
              placeholderTextColor={SereneColors.outline}
              value={name}
              onChangeText={(t) => {
                setName(t);
                if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
                setFormError(null);
              }}
            />
            {fieldErrors.name ? (
              <Text className="text-[11px] text-red-600 font-medium">{fieldErrors.name}</Text>
            ) : null}
          </View>

          {catConfig.productTypes.length > 0 && (
            <View className="gap-1.5 bg-serene-surface-container-low rounded-serene-lg p-3 border border-serene-subtle-border">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-serene-on-surface">Product Type</Text>
                {productType ? (
                  <TouchableOpacity onPress={() => setProductType('')}>
                    <Text className="text-[10px] text-serene-primary font-semibold">Clear ({productType})</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="py-0.5 gap-1.5"
              >
                {catConfig.productTypes.map((pt) => {
                  const isSelected = productType.toLowerCase() === pt.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={pt}
                      className={`px-3 py-1.5 rounded-serene-sm border ${
                        isSelected
                          ? 'bg-serene-primary border-serene-primary'
                          : 'bg-serene-surface-container-highest border-serene-subtle-border'
                      }`}
                      activeOpacity={0.85}
                      onPress={() => setProductType(isSelected ? '' : pt)}
                    >
                      <Text
                        className={`text-[11px] font-medium ${
                          isSelected ? 'text-white font-bold' : 'text-serene-on-surface'
                        }`}
                      >
                        {pt}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View
            className={`bg-serene-surface-container-low rounded-serene-lg p-3.5 gap-1 border ${
              fieldErrors.price ? 'border-red-500' : 'border-transparent'
            }`}
          >
            <Text className="text-[10px] font-bold text-serene-on-surface-variant tracking-wider">
              PRICE PAID / PURCHASE AMOUNT *
            </Text>
            <View className="flex-row items-baseline gap-1">
              <Text className="text-2xl font-bold text-serene-primary">₹</Text>
              <TextInput
                className="flex-1 text-[24px] font-bold text-serene-primary p-0"
                placeholder="40,990"
                placeholderTextColor="rgba(17, 80, 134, 0.3)"
                value={purchasePrice}
                onChangeText={(t) => {
                  setPurchasePrice(t);
                  if (fieldErrors.price) setFieldErrors((prev) => ({ ...prev, price: undefined }));
                }}
                keyboardType="numeric"
              />
            </View>
            {fieldErrors.price ? (
              <Text className="text-[11px] text-red-600 font-medium">{fieldErrors.price}</Text>
            ) : null}
          </View>

          <View className="flex-row gap-2.5">
            <View className="flex-1 gap-1">
              <Text className="text-xs font-semibold text-serene-on-surface">Purchase Date *</Text>
              <TextInput
                className={`bg-serene-surface-container-low rounded-serene-md border px-3 py-2 text-[13px] text-serene-on-surface ${
                  fieldErrors.date ? 'border-red-500' : 'border-serene-subtle-border'
                }`}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={SereneColors.outline}
                value={purchaseDate}
                onChangeText={(t) => {
                  setPurchaseDate(t);
                  if (fieldErrors.date) setFieldErrors((prev) => ({ ...prev, date: undefined }));
                }}
              />
              {purchaseDate ? (
                <Text className="text-[11px] text-serene-on-surface-variant mt-0.5">
                  {formatDate(purchaseDate, 'full')}
                </Text>
              ) : null}
              {fieldErrors.date ? (
                <Text className="text-[11px] text-red-600 font-medium">{fieldErrors.date}</Text>
              ) : null}
            </View>

            <View className="flex-1 gap-1">
              <Text className="text-xs font-semibold text-serene-on-surface">
                {catConfig.sellerFieldLabel} *
              </Text>
              <TextInput
                className={`bg-serene-surface-container-low rounded-serene-md border px-3 py-2 text-[13px] text-serene-on-surface ${
                  fieldErrors.merchant ? 'border-red-500' : 'border-serene-subtle-border'
                }`}
                placeholder={catConfig.sellerPlaceholder}
                placeholderTextColor={SereneColors.outline}
                value={merchant}
                onChangeText={(t) => {
                  setMerchant(t);
                  if (fieldErrors.merchant) setFieldErrors((prev) => ({ ...prev, merchant: undefined }));
                }}
              />
              {fieldErrors.merchant ? (
                <Text className="text-[11px] text-red-600 font-medium">{fieldErrors.merchant}</Text>
              ) : null}
            </View>
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border gap-3.5 shadow-sm">
          <View className="flex-row items-center justify-between">
            <Text className="text-[15px] font-bold text-serene-on-surface">
              {categoryId === 'vehicles' ? 'Vehicle Specifications' : `${selectedCatName} Details`}
            </Text>
            <Text className="text-[11px] text-serene-on-surface-variant">Identification</Text>
          </View>

          <View className="flex-row gap-2.5">
            <View className="flex-1 gap-1">
              <Text className="text-xs font-semibold text-serene-on-surface">
                Brand / Manufacturer {catConfig.supportsSerial ? '*' : ''}
              </Text>
              <TextInput
                className={`bg-serene-surface-container-low rounded-serene-md border px-3 py-2 text-[13px] text-serene-on-surface ${
                  fieldErrors.brand ? 'border-red-500' : 'border-serene-subtle-border'
                }`}
                placeholder={catConfig.brandPlaceholder}
                placeholderTextColor={SereneColors.outline}
                value={brand}
                onChangeText={(t) => {
                  setBrand(t);
                  if (fieldErrors.brand) setFieldErrors((prev) => ({ ...prev, brand: undefined }));
                }}
              />
              {fieldErrors.brand ? (
                <Text className="text-[11px] text-red-600 font-medium">{fieldErrors.brand}</Text>
              ) : null}
            </View>

            {catConfig.supportsModel && (
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Model</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder={catConfig.modelPlaceholder}
                  placeholderTextColor={SereneColors.outline}
                  value={model}
                  onChangeText={setModel}
                />
              </View>
            )}
          </View>

          {catConfig.supportsVariant && (
            <View className="gap-1">
              <Text className="text-xs font-semibold text-serene-on-surface">Variant</Text>
              <TextInput
                className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                placeholder={categoryId === 'vehicles' ? 'e.g. SX(O) Diesel' : 'e.g. 16GB / 512GB'}
                placeholderTextColor={SereneColors.outline}
                value={variant}
                onChangeText={setVariant}
              />
            </View>
          )}

          {catConfig.supportsSerial && (
            <View className="gap-1">
              <Text className="text-xs font-semibold text-serene-on-surface">
                Serial Number {catConfig.label === 'Electronics' ? '(Recommended)' : ''}
              </Text>
              <TextInput
                className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface font-mono"
                placeholder="e.g. PF4ABC123456"
                placeholderTextColor={SereneColors.outline}
                value={serialNumber}
                onChangeText={setSerialNumber}
              />
            </View>
          )}

          {catConfig.supportsFashionDetails && (
            <View className="flex-row gap-2.5">
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Size</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. UK 9"
                  placeholderTextColor={SereneColors.outline}
                  value={size}
                  onChangeText={setSize}
                />
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Color</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. Midnight Navy"
                  placeholderTextColor={SereneColors.outline}
                  value={color}
                  onChangeText={setColor}
                />
              </View>
            </View>
          )}

          {catConfig.supportsFurnitureDetails && (
            <View className="flex-row gap-2.5">
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Material</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. Teak Wood, Mesh"
                  placeholderTextColor={SereneColors.outline}
                  value={material}
                  onChangeText={setMaterial}
                />
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Color / Finish</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. Walnut Brown"
                  placeholderTextColor={SereneColors.outline}
                  value={color}
                  onChangeText={setColor}
                />
              </View>
            </View>
          )}

          {catConfig.supportsVehicleDetails && (
            <View className="gap-2.5 pt-2 border-t border-serene-subtle-border">
              <View className="flex-row gap-2.5">
                <View className="flex-1 gap-1">
                  <Text className="text-xs font-semibold text-serene-on-surface">Registration / Plate #</Text>
                  <TextInput
                    className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface font-mono"
                    placeholder="e.g. UP16AB1234"
                    placeholderTextColor={SereneColors.outline}
                    value={registrationNumber}
                    onChangeText={setRegistrationNumber}
                    autoCapitalize="characters"
                  />
                </View>

                <View className="flex-1 gap-1">
                  <Text className="text-xs font-semibold text-serene-on-surface">VIN / Chassis #</Text>
                  <TextInput
                    className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface font-mono"
                    placeholder="e.g. MA1XXXXXXXXXXXXXX"
                    placeholderTextColor={SereneColors.outline}
                    value={vinChassisNumber}
                    onChangeText={setVinChassisNumber}
                    autoCapitalize="characters"
                  />
                </View>
              </View>

              <View className="flex-row gap-2.5">
                <View className="flex-1 gap-1">
                  <Text className="text-xs font-semibold text-serene-on-surface">Engine Number</Text>
                  <TextInput
                    className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface font-mono"
                    placeholder="e.g. D4FXXXXXXX"
                    placeholderTextColor={SereneColors.outline}
                    value={engineNumber}
                    onChangeText={setEngineNumber}
                    autoCapitalize="characters"
                  />
                </View>

                <View className="flex-1 gap-1">
                  <Text className="text-xs font-semibold text-serene-on-surface">Dealership</Text>
                  <TextInput
                    className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                    placeholder="e.g. ABC Motors"
                    placeholderTextColor={SereneColors.outline}
                    value={dealer}
                    onChangeText={setDealer}
                  />
                </View>
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity
          className="bg-serene-surface-container-low rounded-serene-lg p-3 flex-row items-center justify-between border border-serene-subtle-border"
          onPress={() => setShowMoreDetails(!showMoreDetails)}
          activeOpacity={0.85}
        >
          <View className="flex-row items-center gap-2">
            <MaterialIcons
              name={showMoreDetails ? 'expand-less' : 'tune'}
              size={18}
              color={SereneColors.primary}
            />
            <Text className="text-xs font-bold text-serene-primary">
              {showMoreDetails
                ? 'Hide additional payment breakdown & seller info'
                : 'More purchase details (Payment breakdown, Tax, Seller Address)'}
            </Text>
          </View>
          <MaterialIcons
            name={showMoreDetails ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
            size={20}
            color={SereneColors.primary}
          />
        </TouchableOpacity>

        {showMoreDetails && (
          <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border gap-3.5 shadow-sm">
            <Text className="text-[15px] font-bold text-serene-on-surface">Payment Breakdown & Tax</Text>

            <View className="flex-row gap-2.5">
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Quantity</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. 1"
                  placeholderTextColor={SereneColors.outline}
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="numeric"
                />
              </View>

              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Unit Price</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. 40,990"
                  placeholderTextColor={SereneColors.outline}
                  value={unitPrice}
                  onChangeText={setUnitPrice}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View className="flex-row gap-2.5">
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Subtotal</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. 38,000"
                  placeholderTextColor={SereneColors.outline}
                  value={subtotal}
                  onChangeText={setSubtotal}
                  keyboardType="numeric"
                />
              </View>

              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Discount</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. 2,000"
                  placeholderTextColor={SereneColors.outline}
                  value={discount}
                  onChangeText={setDiscount}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View className="flex-row gap-2.5">
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">GST / Tax Amount</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. 4,990"
                  placeholderTextColor={SereneColors.outline}
                  value={gstTax}
                  onChangeText={setGstTax}
                />
              </View>

              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">GSTIN</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface font-mono"
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  placeholderTextColor={SereneColors.outline}
                  value={gstin}
                  onChangeText={setGstin}
                  autoCapitalize="characters"
                />
              </View>
            </View>

            <View className="flex-row gap-2.5">
              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Invoice / Bill #</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface font-mono"
                  placeholder="e.g. INV-2026-1042"
                  placeholderTextColor={SereneColors.outline}
                  value={invoiceNumber}
                  onChangeText={setInvoiceNumber}
                />
              </View>

              <View className="flex-1 gap-1">
                <Text className="text-xs font-semibold text-serene-on-surface">Seller Address</Text>
                <TextInput
                  className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="e.g. Greater Noida, Uttar Pradesh"
                  placeholderTextColor={SereneColors.outline}
                  value={sellerAddress}
                  onChangeText={setSellerAddress}
                />
              </View>
            </View>
          </View>
        )}

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border gap-3.5 shadow-sm">
          <Text className="text-[15px] font-bold text-serene-on-surface">
            {categoryId === 'vehicles' ? 'Warranty & Guarantee' : 'Return & Warranty'}
          </Text>

          {categoryId === 'vehicles' ? (
            returnEnabled ? (
              <View className="bg-serene-surface-container-low rounded-serene-lg p-3 gap-2">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 mr-2">
                    <Text className="text-xs font-bold text-serene-on-surface">Return Arrangement</Text>
                    <Text className="text-[10px] text-serene-on-surface-variant">
                      Custom dealer or contract return deadline
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setReturnEnabled(false);
                      setReturnUntil('');
                    }}
                  >
                    <Text className="text-[11px] font-semibold text-serene-error">Remove</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  className="bg-serene-surface-container-lowest rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={SereneColors.outline}
                  value={returnUntil}
                  onChangeText={setReturnUntil}
                />
              </View>
            ) : (
              <TouchableOpacity
                className="py-1.5 flex-row items-center gap-1.5"
                onPress={() => setReturnEnabled(true)}
              >
                <MaterialIcons name="add" size={14} color={SereneColors.outline} />
                <Text className="text-[11px] text-serene-on-surface-variant">
                  Add return arrangement (optional)
                </Text>
              </TouchableOpacity>
            )
          ) : (
            <View className="bg-serene-surface-container-low rounded-serene-lg p-3 gap-2">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 mr-2">
                  <Text className="text-xs font-bold text-serene-on-surface">Return Deadline</Text>
                  <Text className="text-[10px] text-serene-on-surface-variant">
                    Keepr will alert you before the return window closes
                  </Text>
                </View>
                <Switch
                  value={returnEnabled}
                  onValueChange={setReturnEnabled}
                  trackColor={{
                    false: SereneColors.surfaceContainerHighest,
                    true: SereneColors.primary,
                  }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {returnEnabled && (
                <View className="gap-2 pt-1 border-t border-serene-subtle-border">
                  <TextInput
                    className="bg-serene-surface-container-lowest rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                    placeholder="YYYY-MM-DD (e.g. 2026-10-15)"
                    placeholderTextColor={SereneColors.outline}
                    value={returnUntil}
                    onChangeText={setReturnUntil}
                  />
                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-[10px] text-serene-on-surface-variant">Quick add:</Text>
                    <TouchableOpacity
                      className="bg-serene-surface-container-high px-2 py-1 rounded-full"
                      onPress={() => applyReturnDaysOffset(7)}
                    >
                      <Text className="text-[10px] font-semibold text-serene-primary">+7 Days</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="bg-serene-surface-container-high px-2 py-1 rounded-full"
                      onPress={() => applyReturnDaysOffset(14)}
                    >
                      <Text className="text-[10px] font-semibold text-serene-primary">+14 Days</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="bg-serene-surface-container-high px-2 py-1 rounded-full"
                      onPress={() => applyReturnDaysOffset(30)}
                    >
                      <Text className="text-[10px] font-semibold text-serene-primary">+30 Days</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

          {!isNoWarrantyCategory(categoryId, catConfig.label, productType) && (
            <View className="bg-serene-surface-container-low rounded-serene-lg p-3 gap-2">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 mr-2">
                  <Text className="text-xs font-bold text-serene-on-surface">Warranty Protection</Text>
                  <Text className="text-[10px] text-serene-on-surface-variant">
                    {categoryId === 'vehicles'
                      ? 'Record manufacturer or extended warranty'
                      : 'Track expiration date and service provider'}
                  </Text>
                </View>
                <Switch
                  value={warrantyEnabled}
                  onValueChange={setWarrantyEnabled}
                  trackColor={{
                    false: SereneColors.surfaceContainerHighest,
                    true: SereneColors.primary,
                  }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {warrantyEnabled && (
                <View className="gap-2.5 pt-1 border-t border-serene-subtle-border">
                  <View className="gap-1">
                    <Text className="text-xs font-semibold text-serene-on-surface">Warranty End Date</Text>
                    <TextInput
                      className="bg-serene-surface-container-lowest rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                      placeholder="YYYY-MM-DD (e.g. 2027-04-14)"
                      placeholderTextColor={SereneColors.outline}
                      value={warrantyUntil}
                      onChangeText={setWarrantyUntil}
                    />
                  </View>

                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-[10px] text-serene-on-surface-variant">Quick add:</Text>
                    <TouchableOpacity
                      className="bg-serene-surface-container-high px-2 py-1 rounded-full"
                      onPress={() => applyWarrantyYearsOffset(1)}
                    >
                      <Text className="text-[10px] font-semibold text-serene-primary">+1 Year</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="bg-serene-surface-container-high px-2 py-1 rounded-full"
                      onPress={() => applyWarrantyYearsOffset(2)}
                    >
                      <Text className="text-[10px] font-semibold text-serene-primary">+2 Years</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="bg-serene-surface-container-high px-2 py-1 rounded-full"
                      onPress={() => applyWarrantyYearsOffset(3)}
                    >
                      <Text className="text-[10px] font-semibold text-serene-primary">+3 Years</Text>
                    </TouchableOpacity>
                  </View>

                  <View className="gap-1 mt-0.5">
                    <Text className="text-xs font-semibold text-serene-on-surface">Warranty Provider / Plan</Text>
                    <TextInput
                      className="bg-serene-surface-container-lowest rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface"
                      placeholder="e.g. Lenovo"
                      placeholderTextColor={SereneColors.outline}
                      value={warrantyProvider}
                      onChangeText={setWarrantyProvider}
                    />
                  </View>

                  <TouchableOpacity
                    className="flex-row items-center gap-2 mt-1"
                    activeOpacity={0.8}
                    onPress={() => setEnableReminder(!enableReminder)}
                  >
                    <View
                      className={`w-[17px] h-[17px] rounded border-[1.5px] items-center justify-center ${
                        enableReminder ? 'bg-serene-primary border-serene-primary' : 'border-serene-outline'
                      }`}
                    >
                      {enableReminder ? <MaterialIcons name="check" size={13} color="#FFFFFF" /> : null}
                    </View>
                    <Text className="text-xs text-serene-on-surface">
                      Remind 30 days before warranty expires
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border gap-4 shadow-sm">
          <Text className="text-[15px] font-bold text-serene-on-surface">Documents & Photos</Text>

          <View className="bg-serene-surface-container-low rounded-serene-lg p-3 gap-2.5 border border-serene-subtle-border">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <MaterialIcons name="receipt-long" size={15} color={SereneColors.primary} />
                <Text className="text-[12px] font-bold text-serene-on-surface">
                  Receipt / Invoice (Optional)
                </Text>
              </View>

              {receiptStatus === 'attached' ? (
                <View className="flex-row items-center gap-1 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-full">
                  <MaterialIcons name="check-circle" size={11} color="#059669" />
                  <Text className="text-[9px] font-bold text-emerald-800">Attached</Text>
                </View>
              ) : receiptStatus === 'selected' ? (
                <View className="flex-row items-center gap-1 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                  <ActivityIndicator size={10} color="#3B82F6" />
                  <Text className="text-[9px] font-bold text-blue-700">Securing...</Text>
                </View>
              ) : null}
            </View>

            {receiptStatus === 'attached' && attachedReceiptUri ? (
              <View className="gap-2">
                <TouchableOpacity
                  className="w-full h-44 rounded-serene-md overflow-hidden bg-serene-surface-container-low relative items-center justify-center border border-serene-subtle-border shadow-xs"
                  activeOpacity={0.88}
                  onPress={() => {
                    setPreviewModalTitle(attachedReceiptName || 'Receipt');
                    setPreviewModalUri(attachedReceiptUri);
                  }}
                >
                  {attachedReceiptUri.toLowerCase().endsWith('.pdf') ? (
                    <View className="items-center justify-center p-3">
                      <MaterialIcons name="picture-as-pdf" size={38} color={SereneColors.error} />
                      <Text className="text-[10px] text-serene-on-surface font-mono mt-1.5" numberOfLines={1}>
                        {attachedReceiptName || 'Invoice.pdf'}
                      </Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: attachedReceiptUri }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                      onError={() => setReceiptStatus('unavailable')}
                    />
                  )}
                  <View className="absolute bottom-2 right-2 bg-black/65 px-2.5 py-1 rounded-full flex-row items-center gap-1">
                    <MaterialIcons name="zoom-in" size={12} color="#FFFFFF" />
                    <Text className="text-[10px] text-white font-medium">Tap to Zoom</Text>
                  </View>
                </TouchableOpacity>

                {additionalReceiptPhotos.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerClassName="py-1 gap-2"
                  >
                    {additionalReceiptPhotos.map((pageUri, idx) => (
                      <View key={`rec-page-${idx}`} className="relative">
                        <TouchableOpacity
                          className="w-16 h-16 rounded-serene-md overflow-hidden border border-serene-subtle-border bg-black/5"
                          onPress={() => {
                            setPreviewModalTitle(`Receipt Page ${idx + 2}`);
                            setPreviewModalUri(pageUri);
                          }}
                        >
                          <Image source={{ uri: pageUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/75 items-center justify-center"
                          onPress={() => setAdditionalReceiptPhotos((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <MaterialIcons name="close" size={10} color="#FFFFFF" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                )}

                <View className="flex-row items-center justify-between pt-1">
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={handleCaptureReceipt}
                      className="flex-row items-center gap-1 bg-serene-surface-container-highest px-2.5 py-1 rounded-serene-sm border border-serene-subtle-border"
                      activeOpacity={0.8}
                    >
                      <MaterialIcons name="add-a-photo" size={12} color={SereneColors.primary} />
                      <Text className="text-[10px] font-semibold text-serene-primary">+ Page (Camera)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handlePickReceiptGallery}
                      className="flex-row items-center gap-1 bg-serene-surface-container-highest px-2.5 py-1 rounded-serene-sm border border-serene-subtle-border"
                      activeOpacity={0.8}
                    >
                      <MaterialIcons name="photo-library" size={12} color={SereneColors.primary} />
                      <Text className="text-[10px] font-semibold text-serene-primary">+ Page (Gallery)</Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    onPress={() => {
                      setAttachedReceiptUri(null);
                      setAttachedReceiptPath(null);
                      setAttachedReceiptName(null);
                      setReceiptStatus('none');
                    }}
                    className="px-2 py-1"
                  >
                    <Text className="text-[11px] font-semibold text-red-600">Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : receiptStatus === 'selected' ? (
              <View className="w-full h-32 rounded-serene-md bg-serene-surface-container-low border border-serene-subtle-border items-center justify-center gap-2">
                <ActivityIndicator size="small" color={SereneColors.primary} />
                <Text className="text-[11px] text-serene-on-surface-variant">Securing receipt...</Text>
              </View>
            ) : (
              <View className="py-2.5 items-center gap-1.5">
                <Text className="text-[11px] text-serene-on-surface-variant text-center">
                  Attach receipt, bill or invoice proof
                </Text>
                <View className="flex-row gap-2 mt-1">
                  <TouchableOpacity
                    onPress={handleCaptureReceipt}
                    className="flex-row items-center gap-1 bg-serene-primary px-3 py-1.5 rounded-serene-sm"
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="camera-alt" size={13} color="#FFFFFF" />
                    <Text className="text-xs font-semibold text-white">Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handlePickReceiptGallery}
                    className="flex-row items-center gap-1 bg-serene-surface-container-highest px-3 py-1.5 rounded-serene-sm border border-serene-subtle-border"
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="photo-library" size={13} color={SereneColors.primary} />
                    <Text className="text-xs font-semibold text-serene-primary">Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handlePickReceiptDocument}
                    className="flex-row items-center gap-1 bg-serene-surface-container-highest px-3 py-1.5 rounded-serene-sm border border-serene-subtle-border"
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="attach-file" size={13} color={SereneColors.primary} />
                    <Text className="text-xs font-semibold text-serene-primary">PDF</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Product Photos (Multi-photo Support - MANDATORY FOR PURCHASED ITEMS) */}
          <View className={`bg-serene-surface-container-low rounded-serene-lg p-3 gap-2.5 border ${
            fieldErrors.productPhotos ? 'border-red-300' : 'border-serene-subtle-border'
          }`}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <MaterialIcons name="photo-camera" size={15} color={fieldErrors.productPhotos ? '#DC2626' : SereneColors.primary} />
                <Text className="text-[12px] font-bold text-serene-on-surface">
                  {categoryId === 'vehicles' ? 'Vehicle Photos (Required)' : 'Product Photos (Required)'}
                </Text>
                {productPhotos.length > 0 ? (
                  <View className="bg-emerald-50 border border-emerald-200 px-2 py-0.2 rounded-full flex-row items-center gap-1">
                    <MaterialIcons name="check-circle" size={10} color="#059669" />
                    <Text className="text-[10px] font-bold text-emerald-800">
                      {productPhotos.length} {productPhotos.length === 1 ? 'photo' : 'photos'}
                    </Text>
                  </View>
                ) : (
                  <View className="bg-amber-50 border border-amber-300 px-2 py-0.2 rounded-full flex-row items-center gap-1">
                    <MaterialIcons name="warning" size={10} color="#D97706" />
                    <Text className="text-[10px] font-bold text-amber-800">
                      Required
                    </Text>
                  </View>
                )}
              </View>

              {productPhotos.length > 0 && (
                <View className="flex-row items-center gap-2">
                  <TouchableOpacity
                    onPress={handleCaptureProductPhoto}
                    className="flex-row items-center gap-1 bg-serene-surface-container-highest px-2 py-1 rounded-serene-sm"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="camera-alt" size={12} color={SereneColors.primary} />
                    <Text className="text-[10px] font-semibold text-serene-primary">+ Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handlePickProductPhotoGallery}
                    className="flex-row items-center gap-1 bg-serene-surface-container-highest px-2 py-1 rounded-serene-sm"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="photo-library" size={12} color={SereneColors.primary} />
                    <Text className="text-[10px] font-semibold text-serene-primary">+ Gallery</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {productPhotos.length === 0 ? (
              <View className="py-3 px-2 items-center gap-1.5 bg-serene-surface-container-lowest rounded-serene-md border border-dashed border-serene-subtle-border">
                <Text className="text-[11px] font-medium text-serene-on-surface-variant text-center">
                  At least 1 product photo is required (front, back, label, or box)
                </Text>
                <Text className="text-[10px] text-amber-800 text-center font-medium">
                  Receipt image cannot be used as product photo
                </Text>
                <View className="flex-row gap-2 mt-1">
                  <TouchableOpacity
                    onPress={handleCaptureProductPhoto}
                    className="flex-row items-center gap-1.5 bg-serene-primary px-3 py-1.5 rounded-serene-md"
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="camera-alt" size={13} color="#FFFFFF" />
                    <Text className="text-xs font-semibold text-white">Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handlePickProductPhotoGallery}
                    className="flex-row items-center gap-1.5 bg-serene-surface-container-highest px-3 py-1.5 rounded-serene-md border border-serene-subtle-border"
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="photo-library" size={13} color={SereneColors.primary} />
                    <Text className="text-xs font-semibold text-serene-primary">Gallery</Text>
                  </TouchableOpacity>
                </View>

                {fieldErrors.productPhotos && (
                  <View className="flex-row items-center gap-1.5 mt-2 bg-red-50 p-2 rounded-serene-md border border-red-200">
                    <MaterialIcons name="error-outline" size={14} color="#DC2626" />
                    <Text className="text-[11px] font-semibold text-red-700">{fieldErrors.productPhotos}</Text>
                  </View>
                )}
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="py-1 gap-2.5 items-center"
              >
                {productPhotos.map((photoUri, index) => (
                  <View key={`photo-${index}-${photoUri}`} className="relative">
                    <TouchableOpacity
                      className="w-20 h-20 rounded-serene-md overflow-hidden bg-black/5 border border-serene-subtle-border"
                      activeOpacity={0.88}
                      onPress={() => {
                        setPreviewModalTitle(`Product Photo ${index + 1}`);
                        setPreviewModalUri(photoUri);
                      }}
                    >
                      <Image source={{ uri: photoUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/75 items-center justify-center shadow-sm"
                      activeOpacity={0.8}
                      onPress={() => handleRemoveProductPhoto(index)}
                    >
                      <MaterialIcons name="close" size={12} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ))}

                <View className="flex-row gap-1.5">
                  <TouchableOpacity
                    onPress={handleCaptureProductPhoto}
                    className="w-16 h-20 rounded-serene-md border border-dashed border-serene-primary/40 items-center justify-center bg-serene-surface-container-lowest"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="camera-alt" size={16} color={SereneColors.primary} />
                    <Text className="text-[9px] font-semibold text-serene-primary mt-1">+ Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handlePickProductPhotoGallery}
                    className="w-16 h-20 rounded-serene-md border border-dashed border-serene-primary/40 items-center justify-center bg-serene-surface-container-lowest"
                    activeOpacity={0.8}
                  >
                    <MaterialIcons name="photo-library" size={16} color={SereneColors.primary} />
                    <Text className="text-[9px] font-semibold text-serene-primary mt-1">+ Gallery</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>

        <View className="bg-serene-surface-container-lowest rounded-serene-xl p-4 border border-serene-subtle-border gap-2 shadow-sm">
          <Text className="text-[15px] font-bold text-serene-on-surface">Notes</Text>
          <TextInput
            className="bg-serene-surface-container-low rounded-serene-md border border-serene-subtle-border px-3 py-2 text-[13px] text-serene-on-surface h-[70px]"
            placeholder={
              categoryId === 'vehicles'
                ? 'e.g. Purchased from ABC Motors with extended warranty'
                : 'e.g. Includes charger and original box'
            }
            placeholderTextColor={SereneColors.outline}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          className={`h-12 rounded-serene-lg flex-row items-center justify-center gap-2 shadow-sm mt-1 ${
            saveStatus === 'saved'
              ? 'bg-emerald-700'
              : saveStatus === 'error'
              ? 'bg-amber-800'
              : 'bg-serene-primary'
          } ${saveStatus === 'saving' ? 'opacity-70' : ''}`}
          activeOpacity={0.88}
          onPress={handleSave}
          disabled={saveStatus === 'saving'}
        >
          {saveStatus === 'saving' ? (
            <>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text className="text-[14px] font-semibold text-white">Saving…</Text>
            </>
          ) : saveStatus === 'saved' ? (
            <>
              <MaterialIcons name="check" size={18} color="#FFFFFF" />
              <Text className="text-[14px] font-semibold text-white">Purchase saved</Text>
            </>
          ) : saveStatus === 'error' ? (
            <>
              <MaterialIcons name="replay" size={18} color="#FFFFFF" />
              <Text className="text-[14px] font-semibold text-white">Try Again</Text>
            </>
          ) : (
            <>
              <MaterialIcons name="check" size={18} color="#FFFFFF" />
              <Text className="text-[14px] font-semibold text-white">
                {isEditMode ? 'Save Changes' : 'Save Purchase'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={Boolean(previewModalUri)}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setPreviewModalUri(null)}
      >
        <View className="flex-1 bg-black justify-between">
          <View className="pt-12 px-4 flex-row items-center justify-between">
            <Text className="text-white text-[15px] font-semibold" numberOfLines={1}>
              {previewModalTitle}
            </Text>
            <TouchableOpacity
              className="w-10 h-10 rounded-full bg-white/20 items-center justify-center"
              onPress={() => setPreviewModalUri(null)}
            >
              <MaterialIcons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View className="flex-1 items-center justify-center p-4">
            {previewModalUri ? (
              <Image source={{ uri: previewModalUri }} className="w-full h-full" resizeMode="contain" />
            ) : null}
          </View>

          <View className="pb-10 px-4 items-center">
            <TouchableOpacity
              className="bg-white/20 px-6 py-2.5 rounded-full"
              onPress={() => setPreviewModalUri(null)}
            >
              <Text className="text-white font-semibold text-[13px]">Close Preview</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
