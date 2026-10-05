
export type CanonicalCategory =
  | 'Electronics'
  | 'Home & Appliances'
  | 'Fashion'
  | 'Vehicle'
  | 'Furniture'
  | 'Sports & Fitness'
  | 'Beauty & Personal Care'
  | 'Other'
  | 'Mobile & Laptop'
  | 'Home Appliance'
  | 'Documents';

export type ScannerCategory =
  | 'electronics'
  | 'home_appliance'
  | 'fashion'
  | 'vehicle'
  | 'furniture'
  | 'sports'
  | 'beauty'
  | 'other'
  | 'mobile_laptop'
  | 'documents';

export type ConfidenceLevel = 'high' | 'medium' | 'verify';

export type ExtractionConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface ExtractedField<T = string> {
  value: T | null;
  confidence: ExtractionConfidence;
  evidence: string | null;
}

export interface ExtractedLineItem {
  name: ExtractedField<string>;
  quantity: ExtractedField<number>;
  unitPrice: ExtractedField<number>;
  totalPrice: ExtractedField<number>;
}

export interface StructuredReceiptExtraction {
  isReceipt?: boolean;
  receiptConfidence?: number | null;
  rejectionReason?: string | null;
  message?: string | null;
  receiptNumber?: ExtractedField<string> | string | null;
  grandTotal?: ExtractedField<number> | number | null;
  taxAmount?: ExtractedField<number> | number | null;
  taxRate?: ExtractedField<number> | number | null;
  merchantName: ExtractedField<string>;
  merchantAddress: ExtractedField<string>;
  merchantPhone: ExtractedField<string>;
  gstin: ExtractedField<string>;
  invoiceNumber: ExtractedField<string>;
  invoiceDate: ExtractedField<string>;
  currency: ExtractedField<string>;
  subtotal: ExtractedField<number>;
  tax: ExtractedField<number>;
  discount: ExtractedField<number>;
  total: ExtractedField<number>;
  paymentMethod: ExtractedField<string>;
  items: ExtractedLineItem[];
  serialNumber: ExtractedField<string>;
  modelNumber: ExtractedField<string>;
  warrantyText: ExtractedField<string>;
  category?: ExtractedField<CanonicalCategory>;
  source?: {
    receiptImageRequired?: boolean;
    provider?: string;
    model?: string;
    requestId?: string;
  };
}

export interface FieldValue<T = string | null> {
  value: T;
  confidence: ConfidenceLevel;
  confidenceScore?: number; // 0.0 to 1.0
  needsVerification?: boolean;
  aiSuggested?: boolean;
  evidence?: string | null;
  rawConfidence?: ExtractionConfidence;
}

export interface CommonReceiptInfo {
  productName: FieldValue<string | null>;
  category: FieldValue<ScannerCategory>;
  brand: FieldValue<string | null>;
  merchant: FieldValue<string | null>;
  merchantAddress?: FieldValue<string | null>;
  merchantPhone?: FieldValue<string | null>;
  gstin?: FieldValue<string | null>;
  purchaseDate: FieldValue<string | null>; // YYYY-MM-DD
  invoiceNumber: FieldValue<string | null>;
  quantity: FieldValue<number | null>;
  unitPrice: FieldValue<number | null>;
  subtotal?: FieldValue<number | null>;
  discount: FieldValue<number | null>;
  taxGst: FieldValue<number | null>;
  finalAmount: FieldValue<number | null>;
  currency?: FieldValue<string | null>;
  paymentMethod: FieldValue<string | null>;
  storeLocation: FieldValue<string | null>;
  notes: FieldValue<string | null>;
  serialNumber?: FieldValue<string | null>;
  modelNumber?: FieldValue<string | null>;
  warrantyText?: FieldValue<string | null>;
  gstRate?: FieldValue<string | null>;
  cgst?: FieldValue<number | null>;
  sgst?: FieldValue<number | null>;
  igst?: FieldValue<number | null>;
}

export interface ElectronicsDetails {
  brand?: FieldValue<string | null>;
  productName?: FieldValue<string | null>;
  model: FieldValue<string | null>;
  serialNumber: FieldValue<string | null>;
  imeiDeviceId?: FieldValue<string | null>;
  storage?: FieldValue<string | null>;
  ram?: FieldValue<string | null>;
  color?: FieldValue<string | null>;
  purchaseDate?: FieldValue<string | null>;
  purchasePrice?: FieldValue<number | null>;
  invoiceNumber?: FieldValue<string | null>;
  warrantyPeriod?: FieldValue<string | null>;
  warrantyExpiry: FieldValue<string | null>;
  warrantyDurationMonths: FieldValue<number | null>;
  seller?: FieldValue<string | null>;
  accessories?: FieldValue<string | null>;
  condition: FieldValue<'Brand New' | 'Like New' | 'Refurbished' | 'Used' | string | null>;
}

export interface MobileLaptopDetails {
  brand: FieldValue<string | null>;
  deviceName: FieldValue<string | null>;
  model: FieldValue<string | null>;
  serialNumber: FieldValue<string | null>;
  imei: FieldValue<string | null>;
  imei2?: FieldValue<string | null>;
  storage: FieldValue<string | null>;
  ram: FieldValue<string | null>;
  processor?: FieldValue<string | null>;
  gpu?: FieldValue<string | null>;
  color: FieldValue<string | null>;
  purchaseDate: FieldValue<string | null>;
  purchasePrice: FieldValue<number | null>;
  seller: FieldValue<string | null>;
  invoiceNumber: FieldValue<string | null>;
  warrantyPeriod?: FieldValue<string | null>;
  warrantyExpiry: FieldValue<string | null>;
  warrantyDurationMonths: FieldValue<number | null>;
  accessories: FieldValue<string | null>;
  condition: FieldValue<'Brand New' | 'Like New' | 'Refurbished' | 'Used' | string | null>;
}

export interface VehicleDetails {
  brand: FieldValue<string | null>;
  vehicleName: FieldValue<string | null>;
  variant: FieldValue<string | null>;
  registrationNumber: FieldValue<string | null>;
  vin?: FieldValue<string | null>;
  vinChassisNumber?: FieldValue<string | null>;
  chassisNumber?: FieldValue<string | null>;
  engineNumber: FieldValue<string | null>;
  purchaseDate: FieldValue<string | null>;
  purchasePrice: FieldValue<number | null>;
  dealer: FieldValue<string | null>;
  invoiceNumber: FieldValue<string | null>;
  warrantyPeriod?: FieldValue<string | null>;
  warrantyExpiry: FieldValue<string | null>;
  insuranceExpiry: FieldValue<string | null>;
  odometerReading: FieldValue<string | null>;
  serviceDueDate: FieldValue<string | null>;
}

export interface HomeApplianceDetails {
  brand: FieldValue<string | null>;
  productName: FieldValue<string | null>;
  modelNumber: FieldValue<string | null>;
  serialNumber: FieldValue<string | null>;
  purchaseDate: FieldValue<string | null>;
  purchasePrice: FieldValue<number | null>;
  seller: FieldValue<string | null>;
  invoiceNumber: FieldValue<string | null>;
  warrantyPeriod?: FieldValue<string | null>;
  warrantyExpiry: FieldValue<string | null>;
  warrantyDurationMonths: FieldValue<number | null>;
  installationDate: FieldValue<string | null>;
  serviceDueDate: FieldValue<string | null>;
  condition: FieldValue<'Brand New' | 'Like New' | 'Refurbished' | string | null>;
}

export interface FurnitureDetails {
  itemName: FieldValue<string | null>;
  brand?: FieldValue<string | null>;
  brandSeller?: FieldValue<string | null>;
  seller?: FieldValue<string | null>;
  material: FieldValue<string | null>;
  color: FieldValue<string | null>;
  purchaseDate: FieldValue<string | null>;
  purchasePrice: FieldValue<number | null>;
  invoiceNumber: FieldValue<string | null>;
  warrantyPeriod?: FieldValue<string | null>;
  warrantyExpiry: FieldValue<string | null>;
  warrantyDurationMonths: FieldValue<number | null>;
  dimensions: FieldValue<string | null>;
  room?: FieldValue<string | null>;
  roomLocation?: FieldValue<string | null>;
  condition: FieldValue<'Brand New' | 'Like New' | 'Floor Sample' | 'Vintage' | string | null>;
}

export interface FashionDetails {
  brand: FieldValue<string | null>;
  itemName: FieldValue<string | null>;
  type?: FieldValue<string | null>;
  itemType?: FieldValue<string | null>;
  size: FieldValue<string | null>;
  color: FieldValue<string | null>;
  purchaseDate: FieldValue<string | null>;
  purchasePrice: FieldValue<number | null>;
  store: FieldValue<string | null>;
  invoiceNumber: FieldValue<string | null>;
  returnUntil: FieldValue<string | null>;
  warrantyPeriod?: FieldValue<string | null>;
  warrantyDurationMonths?: FieldValue<number | null>;
  condition: FieldValue<'Brand New with Tags' | 'Pristine' | 'Pre-owned' | string | null>;
}

export interface DocumentsDetails {
  documentTitle?: FieldValue<string | null>;
  documentType?: FieldValue<string | null>;
  documentName?: FieldValue<string | null>;
  issuer: FieldValue<string | null>;
  referenceId?: FieldValue<string | null>;
  documentNumber?: FieldValue<string | null>;
  issueDate: FieldValue<string | null>;
  expiryDate: FieldValue<string | null>;
  associatedItem?: FieldValue<string | null>;
  notes: FieldValue<string | null>;
}

export interface OtherDetails {
  itemName: FieldValue<string | null>;
  brand: FieldValue<string | null>;
  categoryDescription: FieldValue<string | null>;
  purchasePrice: FieldValue<number | null>;
  purchaseDate: FieldValue<string | null>;
  seller: FieldValue<string | null>;
  notes: FieldValue<string | null>;
}

export interface OcrBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrTextLine {
  text: string;
  confidence: number; // 0.0 to 1.0
  boundingBox?: OcrBoundingBox;
}

export interface OcrBlock {
  text: string;
  confidence: number; // 0.0 to 1.0
  lines: OcrTextLine[];
  boundingBox?: OcrBoundingBox;
}

export interface OcrResult {
  text: string;
  blocks: OcrBlock[];
  confidence: number; // 0.0 to 1.0
  processingTimeMs?: number;
  language?: string;
}

export interface OcrPreprocessedOutput {
  cleanedText: string;
  preservedIdentifiers: {
    currencyValues: string[];
    invoiceNumbers: string[];
    serialNumbers: string[];
    imeiNumbers: string[];
    dates: string[];
    gstNumbers: string[];
  };
  rawTextLength: number;
  cleanedTextLength: number;
}

export interface GeminiMultimodalInput {
  imageUri: string;
  base64?: string;
  ocrText?: string;
  ocrBlocks?: OcrBlock[];
  fileName?: string;
}

export interface ReceiptMultiItem {
  id: string;
  productName: string;
  category: CanonicalCategory | string;
  categoryId?: string;
  productType?: string;
  categoryConfidence?: 'high' | 'medium' | 'low';
  brand?: string;
  model?: string;
  serialNumber?: string;
  quantity: number;
  unitPrice?: number;
  subtotal?: number;
  discount?: number;
  gstin?: string;
  price: number;
  returnUntil?: string;
  warrantyUntil?: string;
  warrantyProvider?: string;
  selected: boolean;
  productPhotos?: string[]; // Product image requirement: >= 1 required before final save
  categorySpecific?: Record<string, string | number | null>;
}


export type TopLevelType =
  | 'PURCHASED_ITEM'
  | 'DOCUMENT'
  | 'AMBIGUOUS'
  | 'INVALID';

export type CanonicalVaultEntityType = 'PURCHASED_ITEM' | 'DOCUMENT' | 'SERVICE_REPAIR';

export type TopLevelClassification =
  | 'PURCHASE_ITEM'
  | 'GENERAL_DOCUMENT'
  | 'SERVICE_REPAIR'
  | 'AMBIGUOUS'
  | 'INVALID_DOCUMENT'
  | 'PURCHASED_ITEM'
  | 'DOCUMENT'
  | 'INVALID';

export type PurchaseItemSubtype =
  | 'RECEIPT'
  | 'INVOICE'
  | 'PURCHASE_RECEIPT'
  | 'PURCHASE_INVOICE'
  | 'TAX_INVOICE'
  | 'ONLINE_ORDER_INVOICE'
  | 'OTHER_PURCHASE_PROOF';

export type DocumentCategoryType =
  | 'VEHICLE'
  | 'FEES_AND_PAYMENTS'
  | 'BILLS_AND_UTILITIES'
  | 'WARRANTY_AND_GUARANTEE'
  | 'INSURANCE'
  | 'OWNERSHIP_AND_PURCHASE'
  | 'OTHER';

export type GeneralDocumentSubtype =
  | 'FEE_RECEIPT'
  | 'PAYMENT_RECEIPT'
  | 'VEHICLE_RC'
  | 'VEHICLE_INSURANCE'
  | 'PUC'
  | 'WARRANTY'
  | 'GUARANTEE'
  | 'EXTENDED_WARRANTY'
  | 'UTILITY_BILL'
  | 'DELIVERY_DOCUMENT'
  | 'SERVICE_DOCUMENT'
  | 'OWNERSHIP_DOCUMENT'
  | 'OTHER'
  | 'VEHICLE_OWNERSHIP'
  | 'COLLEGE_FEE_RECEIPT'
  | 'SCHOOL_FEE_RECEIPT'
  | 'TUITION_FEE_RECEIPT'
  | 'ELECTRICITY_BILL'
  | 'WATER_BILL'
  | 'GAS_BILL'
  | 'INTERNET_BILL'
  | 'MOBILE_BILL'
  | 'WARRANTY_CARD'
  | 'WARRANTY_CERTIFICATE'
  | 'GUARANTEE_CARD'
  | 'GUARANTEE_CERTIFICATE'
  | 'INSURANCE_DOCUMENT';

export type DocumentSubtype = PurchaseItemSubtype | GeneralDocumentSubtype;

export interface DocumentOcrExtraction {
  title?: string | null;
  documentDate?: string | null;
  issuerName?: string | null;
  referenceNumber?: string | null;
  amount?: number | null;
  currency?: string | null;
  expiryDate?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

export interface ItemMatchResult {
  candidateItemId: string | null;
  matchConfidence: number; // 0.0 to 1.0
  matchReason: string;
  matchedItemName?: string | null;
  requiresUserConfirmation: boolean;
}

export interface ExtractedServiceRepair {
  serviceDate: string | null;
  serviceType: string | null;
  title: string | null;
  problemDescription: string | null;
  workPerformed: string | null;
  partsReplaced: string | null;
  technicianNotes: string | null;
  serviceProvider: string | null;
  serviceProviderAddress: string | null;
  serviceProviderPhone: string | null;
  warrantyCovered: 'yes' | 'no' | 'unknown' | null;
  coverageType: string | null;
  coverageReferenceNumber: string | null;
  amountPaid: number | null;
  currency: string | null;
  postServiceWarranty: boolean | null;
  postServiceWarrantyUntil: string | null;
  postServiceGuarantee: boolean | null;
  postServiceGuaranteeUntil: string | null;
  relatedItemCandidates?: string[];
  supportingDocumentCandidates?: string[];
}

export interface DocumentClassificationResult {
  topLevelClassification: TopLevelClassification;
  entityType?: CanonicalVaultEntityType;
  canonicalEntityType?: CanonicalVaultEntityType;
  topLevelType?: TopLevelType;
  category?: DocumentCategoryType | string | null;
  documentCategory?: DocumentCategoryType | string | null;
  documentSubtype: DocumentSubtype | string | null;
  documentType?: string | null;
  confidence: number;
  reason: string;
  isPhysicalItemPurchase: boolean | null;
  shouldCreateItem: boolean;
  itemMatch?: ItemMatchResult | null;
  document?: DocumentOcrExtraction | null;
  serviceRepair?: ExtractedServiceRepair | null;
}

export interface ExtractedReceiptData {
  id: string;
  receiptUri: string;
  receiptImageName: string;
  receiptUriBack?: string | null; // Optional second photo (back side)
  scannedAt: string;
  isReceipt: boolean;
  isDocument?: boolean;
  isServiceRepair?: boolean;
  documentCategory?: string | null;
  documentType?: string | null;
  documentTitle?: string | null;
  issuerName?: string | null;
  referenceNumber?: string | null;
  documentDate?: string | null;
  expiryDate?: string | null;
  dueDate?: string | null; // Semantically distinct from expiryDate
  receiptConfidence?: number | null;
  rejectionReason?: string | null;
  rejectionMessage?: string | null;
  classification?: DocumentClassificationResult;
  entityType?: CanonicalVaultEntityType;
  serviceRepair?: ExtractedServiceRepair | null;
  common: CommonReceiptInfo;
  category: ScannerCategory;
  categoryDetails: {
    electronics?: ElectronicsDetails;
    mobile_laptop?: MobileLaptopDetails;
    vehicle?: VehicleDetails;
    home_appliance?: HomeApplianceDetails;
    furniture?: FurnitureDetails;
    fashion?: FashionDetails;
    sports?: any;
    beauty?: any;
    documents?: DocumentsDetails;
    other?: OtherDetails;
  };
  items?: ReceiptMultiItem[];
  purchase?: {
    purchaseDate?: string | null;
    merchantName?: string | null;
    merchantAddress?: string | null;
    invoiceNumber?: string | null;
    subtotal?: number | null;
    discount?: number | null;
    taxAmount?: number | null;
    grandTotal?: number | null;
    products: Array<{
      id?: string;
      name: string;
      category?: string;
      brand?: string;
      model?: string;
      serialNumber?: string;
      quantity: number;
      unitPrice?: number;
      lineTotal: number;
      warrantyUntil?: string | null;
      returnUntil?: string | null;
      productPhotos?: string[];
    }>;
  };
  rawConfidenceScore: number; // 0 to 100
  overallQuality: 'excellent' | 'good' | 'fair';
  provider?: 'gemini' | 'offline_neural';
}

export interface GeminiReceiptResponse {
  entityType?: CanonicalVaultEntityType;
  serviceRepair?: ExtractedServiceRepair | null;
  purchase?: ExtractedReceiptData['purchase'] | null;
  document?: DocumentOcrExtraction | null;
  isReceipt?: boolean;
  isDocument?: boolean;
  receiptConfidence?: number | null;
  classification?: DocumentClassificationResult;
  rejectionReason?: string | null;
  message?: string | null;

  documentCategory?: string | null;
  documentType?: string | null;
  documentTitle?: string | null;
  issuerName?: ExtractedField<string> | string | null;
  referenceNumber?: ExtractedField<string> | string | null;
  documentDate?: ExtractedField<string> | string | null;
  expiryDate?: ExtractedField<string> | string | null;
  dueDate?: ExtractedField<string> | string | null; // Semantically distinct from expiryDate

  receiptNumber?: ExtractedField<string> | string | null;
  purchaseDate?: ExtractedField<string> | string | null;
  grandTotal?: ExtractedField<number> | number | null;
  taxAmount?: ExtractedField<number> | number | null;
  taxRate?: ExtractedField<number> | number | null;

  merchantName?: ExtractedField<string> | string | null;
  merchantAddress?: ExtractedField<string> | string | null;
  merchantPhone?: ExtractedField<string> | string | null;
  merchantGstin?: ExtractedField<string> | string | null;
  invoiceNumber?: ExtractedField<string> | string | null;
  invoiceDate?: ExtractedField<string> | string | null;
  currency?: ExtractedField<string> | string | null;
  subtotal?: ExtractedField<number> | number | null;
  tax?: ExtractedField<number> | number | null;
  gstRate?: ExtractedField<string> | string | null;
  cgst?: ExtractedField<number> | number | null;
  sgst?: ExtractedField<number> | number | null;
  igst?: ExtractedField<number> | number | null;
  discount?: ExtractedField<number> | number | null;
  total?: ExtractedField<number> | number | null;
  paymentMethod?: ExtractedField<string> | string | null;
  items?: Array<ExtractedLineItem | {
    name?: string | null;
    productName?: string | null;
    category?: CanonicalCategory | string | null;
    productType?: string | null;
    brand?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    quantity?: number | null;
    unitPrice?: number | null;
    lineSubtotal?: number | null;
    lineDiscount?: number | null;
    lineTax?: number | null;
    lineTotal?: number | null;
    price?: number | null;
    totalPrice?: number | null;
    returnUntil?: string | null;
    warrantyUntil?: string | null;
    categorySpecific?: Record<string, string | number | null>;
  }>;
  serialNumber?: ExtractedField<string> | string | null;
  modelNumber?: ExtractedField<string> | string | null;
  warrantyText?: ExtractedField<string> | string | null;

  category?: CanonicalCategory | ExtractedField<CanonicalCategory>;
  categoryConfidence?: number;
  productType?: string | null;
  returnUntil?: string | null;
  warrantyUntil?: string | null;
  common?: {
    productName: string | null;
    brand: string | null;
    storeName: string | null;
    purchaseDate: string | null;
    invoiceNumber: string | null;
    quantity: number | null;
    unitPrice: number | null;
    subtotal: number | null;
    discount: number | null;
    tax: number | null;
    gst: number | null;
    totalAmount: number | null;
    currency: string | null;
    paymentMethod: string | null;
    storeLocation: string | null;
    notes: string | null;
  };
  categorySpecific?: Record<string, string | number | null>;
  confidenceMap?: Record<string, number>;
  source?: {
    receiptImageRequired?: boolean;
    provider?: string;
    model?: string;
    requestId?: string;
  };
}

export type ScannerScreenState =
  | 'scan' // Screen 1: Camera Viewfinder & Capture
  | 'preview' // Screen 2: Image Preview & Confirmation
  | 'processing' // Screen 3: AI Analyzing & 6-Step Checklist
  | 'result' // Screen 4: Review & Edit
  | 'category_select' // Category Selection Modal
  | 'save_confirm' // Screen 5: Save to Keepr Summary
  | 'saved_success' // Screen 6: Saved State & Reminder
  | 'multi_item_review' // Multi-Item Review & Selection Screen
  | 'review_type'; // Review Document Type Modal / View

export interface ProcessingStep {
  id: number;
  label: string;
  completed: boolean;
}
