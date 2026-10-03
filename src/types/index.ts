
export type WarrantyStatus = 'active' | 'expiring_soon' | 'expired' | 'none' | 'unknown';

export type ReturnStatus = 'active' | 'expiring_soon' | 'expired' | 'none';

export type WarrantyType = 'manufacturer' | 'extended' | 'third_party' | 'amc';

export type ExpenseType =
  | 'purchase'
  | 'repair'
  | 'maintenance'
  | 'accessories'
  | 'replacement_parts'
  | 'insurance'
  | 'other';

export type MaintenanceStatus = 'scheduled' | 'completed' | 'cancelled';

export type ItemStatus = 'active' | 'archived' | 'resold' | 'disposed';

export type DocumentType =
  | 'pdf'
  | 'image'
  | 'receipt'
  | 'invoice'
  | 'warranty_card'
  | 'certificate'
  | 'other';

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  avatarUrl?: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface ItemCategory {
  id: string;
  name: string;
  icon: string;
  description?: string;
  sortOrder: number;
}

export interface Item {
  id: string;
  userId: string;
  name: string;
  categoryId?: string;
  category?: string | ItemCategory;
  productType?: string; // Subcategory: e.g. Mobile, Laptop, TV, Shoes, Refrigerator
  categoryConfidence?: 'high' | 'medium' | 'low';
  purchaseDate?: string; // ISO YYYY-MM-DD
  purchasePrice: number;
  currency: string;
  merchant?: string; // Platform / Shop / Seller Name
  sellerAddress?: string; // Seller / Shop Address (optional)
  gstin?: string; // Merchant GSTIN identification number (optional)
  subtotal?: number; // Subtotal before discount and tax
  discount?: number; // Discount amount
  gstTax?: string; // GST / Tax amount or percentage (optional)
  gstRate?: string; // e.g. 18% (optional)
  cgst?: string; // Central GST amount (optional)
  sgst?: string; // State GST amount (optional)
  igst?: string; // Integrated GST amount (optional)
  invoiceNumber?: string;
  returnUntil?: string | null; // Last Return Date (optional)
  receiptId?: string; // Link to the shared Receipt entity
  receiptUri?: string; // Proof of purchase receipt/invoice attachment
  receiptPath?: string; // Stable relative storage path (e.g. vault_receipts/filename.jpg)
  receiptName?: string;
  receiptType?: 'receipt' | 'invoice';
  quantity?: number; // Preserves quantity if > 1 (e.g. 2)
  unitPrice?: number; // Price per unit before quantity
  photoUri?: string; // Product / Item photo (visual representation)
  imageUrl?: string; // Compatible alias for photoUri
  productPhotos?: string[]; // Multiple product photos (camera/gallery)
  notes?: string;
  status: ItemStatus;

  brand?: string;
  model?: string;
  serialNumber?: string;
  imei?: string; // Mobile phones
  size?: string; // Fashion
  color?: string; // Fashion
  material?: string; // Furniture
  registrationNumber?: string; // Vehicle
  vinChassisNumber?: string; // Vehicle VIN / Chassis Number
  engineNumber?: string; // Vehicle Engine Number
  variant?: string; // Vehicle Variant (e.g. ZX, VXi)
  dealer?: string; // Vehicle Dealership / Dealer
  insuranceExpiry?: string; // Vehicle
  pucDate?: string; // Vehicle

  warrantyUntil?: string | null;
  warrantyProvider?: string;

  resalePrice?: number;
  resaleDate?: string;

  products?: PurchasedProduct[];
  isMultiProduct?: boolean;
  productCount?: number;

  createdAt: string;
  updatedAt: string;
}

export interface PurchasedProduct {
  id: string; // valid UUID
  name: string;
  category?: string | ItemCategory;
  categoryId?: string;
  productType?: string;
  categoryConfidence?: 'high' | 'medium' | 'low';
  brand?: string;
  model?: string;
  serialNumber?: string;
  quantity: number;
  unitPrice?: number;
  lineTotal: number;
  warrantyUntil?: string | null;
  warrantyProvider?: string;
  returnUntil?: string | null;
  productPhotos: string[]; // At least 1 product image strictly required!
  notes?: string;
}

export interface Warranty {
  id: string;
  itemId: string;
  userId: string;
  provider?: string;
  policyNumber?: string;
  warrantyType: WarrantyType;
  durationMonths: number;
  startDate: string; // ISO YYYY-MM-DD
  endDate: string; // ISO YYYY-MM-DD
  coverageDetails?: string;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
  createdAt: string;
  updatedAt: string;
}

export type CanonicalDocumentCategory =
  | 'Receipts & Invoices'
  | 'Vehicle Documents'
  | 'Warranty & Guarantee'
  | 'Fees & Payments'
  | 'Bills & Utilities'
  | 'Ownership & Purchase'
  | 'Other Important Documents';

export type CanonicalDocumentType =
  | 'Receipt'
  | 'Invoice'
  | 'Purchase Bill'
  | 'RC'
  | 'Insurance'
  | 'PUC'
  | 'Vehicle Invoice'
  | 'Delivery Document'
  | 'Warranty Certificate'
  | 'Guarantee Certificate'
  | 'Extended Warranty'
  | 'College Fee Receipt'
  | 'Payment Receipt'
  | 'Fee Challan'
  | 'Electricity Bill'
  | 'Water Bill'
  | 'Internet Bill'
  | 'Gas Bill'
  | 'Other Utility Bill'
  | 'Ownership Document'
  | 'Purchase Agreement'
  | 'Delivery Proof'
  | 'Other Important Document';

export interface VaultDocument {
  id: string;
  userId: string;
  itemId?: string | null; // Nullable! Standalone documents do not require an Item
  receiptId?: string;
  title: string;
  name?: string; // Compatible alias for title
  category: CanonicalDocumentCategory;
  documentType: CanonicalDocumentType | string;
  documentDate?: string | null; // ISO YYYY-MM-DD
  issuerName?: string | null; // Merchant / University / Insurer / Provider / Agency
  referenceNumber?: string | null; // Invoice #, Policy #, Registration #, Receipt #, Consumer #
  amount?: number | null; // Financial transaction value where applicable
  currency?: string; // Default 'INR'
  expiryDate?: string | null; // Policy expiry, PUC expiry, Warranty end date (real dates only)
  dueDate?: string | null; // Utility bill payment due date (semantically distinct from expiryDate)
  notes?: string | null;
  filePath: string;
  fileUrl: string;
  filePathBack?: string | null; // Second photo / back side
  fileUrlBack?: string | null; // Second photo URL
  fileType?: DocumentType | string;
  fileSizeBytes: number;
  mimeType: string;
  thumbnailPath?: string | null;
  storagePath?: string | null; // Canonical cloud storage object path ({userId}/vault/{docId}/photo_1.jpg)
  storagePathBack?: string | null; // Canonical cloud storage object path for second photo ({userId}/vault/{docId}/photo_2.jpg)
  createdAt: string;
  updatedAt?: string;
}

export interface Receipt {
  id: string;
  userId: string;
  fileUri: string;
  storagePath?: string; // Stable relative storage path (e.g. vault_receipts/filename.jpg)
  fileName: string;
  fileSizeBytes?: number;
  mimeType?: string;
  type?: 'receipt' | 'invoice';
  merchant?: string;
  sellerAddress?: string;
  gstin?: string;
  purchaseDate?: string;
  totalAmount?: number;
  subtotal?: number;
  discount?: number;
  gstTax?: string;
  invoiceNumber?: string;
  itemCount: number;
  itemIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRecord {
  id: string;
  itemId: string;
  userId: string;
  title: string;
  description?: string;
  serviceProvider?: string;
  serviceDate: string; // ISO YYYY-MM-DD
  cost: number;
  nextServiceDate?: string; // ISO YYYY-MM-DD
  status: MaintenanceStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  itemId: string;
  userId: string;
  title: string;
  expenseType: ExpenseType;
  amount: number;
  expenseDate: string; // ISO YYYY-MM-DD
  notes?: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  itemId?: string;
  activityType:
    | 'item_added'
    | 'warranty_added'
    | 'document_uploaded'
    | 'maintenance_scheduled'
    | 'maintenance_completed'
    | 'expense_added'
    | 'item_updated'
    | 'item_deleted';
  title: string;
  description?: string;
  amount?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ReminderPreferences {
  userId: string;
  warrantyReminders: boolean;
  maintenanceReminders: boolean;
  documentReminders: boolean;
  leadDays: number[];
  updatedAt: string;
}

export interface VaultMetrics {
  totalItems: number;
  totalDocuments: number;
  returnsEndingSoon: number;
  warrantiesEndingSoon: number;
  totalReplacementValue: number;
  itemsTrackedCount: number;
  activeWarrantiesCount: number;
  expiringWarrantiesCount: number;
  upcomingMaintenanceCount: number;
  totalOwnershipExpenses: number;
  totalEventsThisMonth: number;
}

export interface ItemWithOwnerContext extends Item {
  category?: ItemCategory;
  warranty?: Warranty;
  documents: VaultDocument[];
  maintenanceRecords: MaintenanceRecord[];
  expenses: Expense[];
  tco: number;
  warrantyStatus: WarrantyStatus;
  remainingWarrantyDays: number;
  warrantyProgressPercent: number;
  returnStatus?: ReturnStatus;
  remainingReturnDays?: number;
}

export type RecentlyAddedEntityType = 'PURCHASED_ITEM' | 'DOCUMENT';

export interface RecentlyAddedEntry {
  id: string;
  entityType: RecentlyAddedEntityType;
  title: string;
  subtitle?: string;
  category: string;
  categoryName?: string;
  createdAt: string;
  price?: number;
  amount?: number | null;
  currency?: string;
  thumbnail?: string | null;
  date?: string | null;
  expiryDate?: string | null;
  dueDate?: string | null;
  relatedItemId?: string | null;
  relatedItemName?: string | null;
  item?: Item;
  document?: VaultDocument;
}
