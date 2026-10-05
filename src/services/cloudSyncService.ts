
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  BUCKET_ITEM_DOCUMENTS,
  BUCKET_VAULT_DOCUMENTS,
  BUCKET_ITEM_IMAGES,
} from './storageService';
import type {
  Item,
  PurchasedProduct,
  Warranty,
  VaultDocument,
  Receipt,
  MaintenanceRecord,
  Expense,
  ActivityLog,
} from '../types';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true if the string is a valid RFC 4122 UUID. */
export function isValidUUID(id?: string | null): boolean {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

/** Generates a standard RFC 4122 compliant UUID v4 string for PostgreSQL compatibility. */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {}
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}


/**
 * Maps a raw Supabase items row to the domain Item type.
 * Handles all snake_case → camelCase conversions and extended columns.
 */
export function mapDbRowToItem(row: Record<string, unknown>): Item {
  let products: PurchasedProduct[] | undefined = undefined;
  let cleanNotes = (row.notes as string) || undefined;
  if (cleanNotes && cleanNotes.includes('[KEEPR_PRODUCTS]:')) {
    const parts = cleanNotes.split('[KEEPR_PRODUCTS]:');
    cleanNotes = parts[0].trim() || undefined;
    try {
      products = JSON.parse(parts[1].trim());
    } catch {
      products = undefined;
    }
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    categoryId: (row.category_id as string) || undefined,
    productType: (row.product_type as string) || undefined,
    categoryConfidence: (row.category_confidence as 'high' | 'medium' | 'low') || undefined,
    brand: (row.brand as string) || undefined,
    model: (row.model as string) || undefined,
    serialNumber: (row.serial_number as string) || undefined,
    imei: (row.imei as string) || undefined,
    size: (row.size as string) || undefined,
    color: (row.color as string) || undefined,
    material: (row.material as string) || undefined,
    purchaseDate: (row.purchase_date as string) || undefined,
    purchasePrice: Number(row.purchase_price) || 0,
    unitPrice: row.unit_price ? Number(row.unit_price) : undefined,
    quantity: row.quantity ? Number(row.quantity) : undefined,
    currency: (row.currency as string) || 'INR',
    merchant: (row.merchant as string) || undefined,
    sellerAddress: (row.seller_address as string) || undefined,
    gstin: (row.gstin as string) || undefined,
    subtotal: row.subtotal ? Number(row.subtotal) : undefined,
    discount: row.discount ? Number(row.discount) : undefined,
    gstTax: (row.gst_tax as string) || undefined,
    gstRate: (row.gst_rate as string) || undefined,
    cgst: (row.cgst as string) || undefined,
    sgst: (row.sgst as string) || undefined,
    igst: (row.igst as string) || undefined,
    invoiceNumber: (row.invoice_number as string) || undefined,
    notes: cleanNotes,
    products,
    isMultiProduct: Boolean(products && products.length > 1),
    productCount: products ? products.length : undefined,
    imageUrl: (row.image_url as string) || undefined,
    status: (row.status as Item['status']) || 'active',
    receiptId: (row.receipt_id && typeof row.receipt_id === 'string' && isValidUUID(row.receipt_id))
      ? row.receipt_id
      : undefined,
    receiptUri: (row.receipt_uri as string) || undefined,
    receiptPath: (row.receipt_path as string) || undefined,
    receiptName: (row.receipt_name as string) || undefined,
    receiptType: (row.receipt_type as 'receipt' | 'invoice') || undefined,
    productPhotos: Array.isArray(row.product_photos)
      ? (row.product_photos as string[])
      : typeof row.product_photos === 'string'
      ? JSON.parse(row.product_photos || '[]')
      : [],
    returnUntil: (row.return_until as string) || null,
    warrantyUntil: (row.warranty_until as string) || null,
    warrantyProvider: (row.warranty_provider as string) || undefined,
    registrationNumber: (row.registration_number as string) || undefined,
    vinChassisNumber: (row.vin_chassis_number as string) || undefined,
    engineNumber: (row.engine_number as string) || undefined,
    variant: (row.variant as string) || undefined,
    dealer: (row.dealer as string) || undefined,
    insuranceExpiry: (row.insurance_expiry as string) || undefined,
    pucDate: (row.puc_date as string) || undefined,
    resalePrice: row.resale_price ? Number(row.resale_price) : undefined,
    resaleDate: (row.resale_date as string) || undefined,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

/**
 * Maps a raw Supabase warranties row to the domain Warranty type.
 */
export function mapDbRowToWarranty(row: Record<string, unknown>): Warranty {
  return {
    id: row.id as string,
    itemId: row.item_id as string,
    userId: row.user_id as string,
    provider: (row.provider as string) || undefined,
    policyNumber: (row.policy_number as string) || undefined,
    warrantyType: (row.warranty_type as Warranty['warrantyType']) || 'manufacturer',
    durationMonths: Number(row.duration_months) || 12,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    coverageDetails: (row.coverage_details as string) || undefined,
    reminderEnabled: Boolean(row.reminder_enabled ?? true),
    reminderDaysBefore: Number(row.reminder_days_before) || 30,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

/**
 * Maps a raw Supabase documents row to the domain VaultDocument type.
 */
export function mapDbRowToDocument(row: Record<string, unknown>): VaultDocument {
  const docId = row.id as string;
  const rawItemId = (row.item_id as string) || null;
  const rawReceiptId = (row.receipt_id as string) || undefined;
  return {
    id: docId,
    userId: row.user_id as string,
    itemId: (rawItemId && isValidUUID(rawItemId)) ? rawItemId : null,
    receiptId: (rawReceiptId && isValidUUID(rawReceiptId)) ? rawReceiptId : undefined,
    title: (row.title as string) || (row.name as string) || 'Document',
    name: (row.name as string) || (row.title as string) || 'Document',
    category: (row.category as VaultDocument['category']) || 'Other Important Documents',
    documentType: (row.document_type as string) || 'Other Important Document',
    documentDate: (row.document_date as string) || null,
    issuerName: (row.issuer_name as string) || null,
    referenceNumber: (row.reference_number as string) || null,
    amount: row.amount ? Number(row.amount) : null,
    currency: (row.currency as string) || 'INR',
    expiryDate: (row.expiry_date as string) || null,
    notes: (row.notes as string) || null,
    filePath: row.file_path as string,
    fileUrl: row.file_url as string,
    fileType: (row.file_type as string) || 'pdf',
    fileSizeBytes: Number(row.file_size_bytes) || 0,
    mimeType: (row.mime_type as string) || 'application/octet-stream',
    thumbnailPath: (row.thumbnail_path as string) || null,
    storagePath: (row.storage_path as string) || null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

/**
 * Maps a raw Supabase receipts row to the domain Receipt type.
 */
export function mapDbRowToReceipt(row: Record<string, unknown>): Receipt {
  const rawItemIds = row.item_ids;
  let itemIds: string[] = [];
  if (Array.isArray(rawItemIds)) {
    itemIds = rawItemIds as string[];
  } else if (typeof rawItemIds === 'string') {
    try { itemIds = JSON.parse(rawItemIds); } catch { itemIds = []; }
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    fileUri: row.file_uri as string,
    storagePath: (row.storage_path as string) || undefined,
    fileName: (row.file_name as string) || 'receipt.jpg',
    fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : undefined,
    mimeType: (row.mime_type as string) || undefined,
    type: (row.receipt_type as 'receipt' | 'invoice') || 'receipt',
    merchant: (row.merchant as string) || undefined,
    sellerAddress: (row.seller_address as string) || undefined,
    gstin: (row.gstin as string) || undefined,
    purchaseDate: (row.purchase_date as string) || undefined,
    totalAmount: row.total_amount ? Number(row.total_amount) : undefined,
    subtotal: row.subtotal ? Number(row.subtotal) : undefined,
    discount: row.discount ? Number(row.discount) : undefined,
    gstTax: (row.gst_tax as string) || undefined,
    invoiceNumber: (row.invoice_number as string) || undefined,
    itemCount: Number(row.item_count) || 1,
    itemIds,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

export function mapDbRowToMaintenanceRecord(row: Record<string, unknown>): MaintenanceRecord {
  return {
    id: row.id as string,
    itemId: (row.item_id as string) || null,
    userId: row.user_id as string,
    title: row.title as string,
    serviceType: (row.service_type as string) || undefined,
    description: (row.description as string) || undefined,
    problemDescription: (row.problem_description as string) || undefined,
    workPerformed: (row.work_performed as string) || undefined,
    partsReplaced: (row.parts_replaced as string) || undefined,
    technicianNotes: (row.technician_notes as string) || undefined,
    serviceProvider: (row.service_provider as string) || undefined,
    serviceProviderAddress: (row.service_provider_address as string) || undefined,
    serviceProviderPhone: (row.service_provider_phone as string) || undefined,
    serviceDate: row.service_date as string,
    cost: Number(row.cost || row.amount_paid) || 0,
    amountPaid: row.amount_paid != null ? Number(row.amount_paid) : Number(row.cost) || 0,
    currency: (row.currency as string) || 'INR',
    warrantyCovered: (row.warranty_covered as MaintenanceRecord['warrantyCovered']) || 'unknown',
    coverageType: (row.coverage_type as string) || undefined,
    coverageReferenceNumber: (row.coverage_reference_number as string) || undefined,
    postServiceWarranty: Boolean(row.post_service_warranty),
    postServiceWarrantyUntil: (row.post_service_warranty_until as string) || null,
    postServiceGuarantee: Boolean(row.post_service_guarantee),
    postServiceGuaranteeUntil: (row.post_service_guarantee_until as string) || null,
    nextServiceDate: (row.next_service_date as string) || undefined,
    documentIds: Array.isArray(row.document_ids) ? (row.document_ids as string[]) : [],
    attachments: Array.isArray(row.attachments) ? (row.attachments as string[]) : [],
    status: (row.status as MaintenanceRecord['status']) || 'completed',
    notes: (row.notes as string) || undefined,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

/**
 * Maps a domain MaintenanceRecord to a database row for Supabase.
 */
export function mapMaintenanceToDbRow(
  record: MaintenanceRecord,
  userId: string
): Record<string, unknown> {
  const amt = record.amountPaid != null ? record.amountPaid : (record.cost ?? 0);
  return {
    id: record.id,
    item_id: (record.itemId && isValidUUID(record.itemId)) ? record.itemId : null,
    user_id: userId,
    title: record.title,
    service_type: record.serviceType || 'Service',
    description: record.description || record.problemDescription || null,
    problem_description: record.problemDescription || null,
    work_performed: record.workPerformed || null,
    parts_replaced: record.partsReplaced || null,
    technician_notes: record.technicianNotes || null,
    service_provider: record.serviceProvider || null,
    service_provider_address: record.serviceProviderAddress || null,
    service_provider_phone: record.serviceProviderPhone || null,
    service_date: record.serviceDate,
    cost: amt,
    amount_paid: amt,
    currency: record.currency || 'INR',
    warranty_covered: record.warrantyCovered || 'unknown',
    coverage_type: record.coverageType || null,
    coverage_reference_number: record.coverageReferenceNumber || null,
    post_service_warranty: Boolean(record.postServiceWarranty),
    post_service_warranty_until: record.postServiceWarrantyUntil || null,
    post_service_guarantee: Boolean(record.postServiceGuarantee),
    post_service_guarantee_until: record.postServiceGuaranteeUntil || null,
    next_service_date: record.nextServiceDate || null,
    document_ids: record.documentIds || [],
    attachments: record.attachments || [],
    status: record.status || 'completed',
    notes: record.notes || null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Maps a raw Supabase expenses row to the domain Expense type.
 */
export function mapDbRowToExpense(row: Record<string, unknown>): Expense {
  return {
    id: row.id as string,
    itemId: row.item_id as string,
    userId: row.user_id as string,
    title: row.title as string,
    expenseType: (row.expense_type as Expense['expenseType']) || 'other',
    amount: Number(row.amount) || 0,
    expenseDate: row.expense_date as string,
    notes: (row.notes as string) || undefined,
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

/**
 * Maps a raw Supabase activity_logs row to the domain ActivityLog type.
 */
export function mapDbRowToActivityLog(row: Record<string, unknown>): ActivityLog {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    itemId: (row.item_id as string) || undefined,
    activityType: row.activity_type as ActivityLog['activityType'],
    title: row.title as string,
    description: (row.description as string) || undefined,
    amount: row.amount ? Number(row.amount) : undefined,
    metadata: (row.metadata as Record<string, unknown>) || undefined,
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}


/**
 * Converts a domain Item to a flat Supabase-compatible insert/update payload.
 * All undefined fields are omitted; null is preserved for nullable columns.
 */
export function mapItemToDbRow(item: Item, userId: string): Record<string, unknown> {
  const VALID_CATEGORIES = ['electronics', 'appliances', 'vehicles', 'furniture', 'luxury', 'tools', 'other'];
  const dbCategory = item.categoryId && VALID_CATEGORIES.includes(item.categoryId)
    ? item.categoryId
    : 'other';

  const row: Record<string, unknown> = {
    id: item.id,
    user_id: userId,
    name: item.name,
    category_id: dbCategory,
    brand: item.brand || null,
    model: item.model || null,
    serial_number: item.serialNumber || null,
    purchase_date: item.purchaseDate || null,
    purchase_price: item.purchasePrice,
    unit_price: item.unitPrice ?? null,
    quantity: item.quantity ?? null,
    currency: item.currency || 'INR',
    merchant: item.merchant || null,
    seller_address: item.sellerAddress || null,
    gstin: item.gstin || null,
    subtotal: item.subtotal ?? null,
    discount: item.discount ?? null,
    gst_tax: item.gstTax || null,
    gst_rate: item.gstRate || null,
    cgst: item.cgst || null,
    sgst: item.sgst || null,
    igst: item.igst || null,
    invoice_number: item.invoiceNumber || null,
    notes: (() => {
      let baseNotes = item.notes || null;
      if (item.products && item.products.length > 0) {
        const prodTag = `[KEEPR_PRODUCTS]:${JSON.stringify(item.products)}`;
        return baseNotes ? `${baseNotes}\n\n${prodTag}` : prodTag;
      }
      return baseNotes;
    })(),
    image_url: item.imageUrl || null,
    status: item.status || 'active',
    receipt_id: (item.receiptId && isValidUUID(item.receiptId)) ? item.receiptId : null,
    receipt_uri: (item.receiptUri && !item.receiptUri.startsWith('file:') && !item.receiptUri.startsWith('content:'))
      ? item.receiptUri
      : null,
    receipt_path: (item.receiptPath && !item.receiptPath.startsWith('file:') && !item.receiptPath.startsWith('content:'))
      ? item.receiptPath
      : null,
    receipt_name: item.receiptName || null,
    receipt_type: item.receiptType || null,
    product_photos: item.productPhotos ? JSON.stringify(item.productPhotos) : '[]',
    product_type: item.productType || null,
    category_confidence: item.categoryConfidence || null,
    return_until: item.returnUntil || null,
    warranty_until: item.warrantyUntil || null,
    warranty_provider: item.warrantyProvider || null,
    registration_number: item.registrationNumber || null,
    vin_chassis_number: item.vinChassisNumber || null,
    engine_number: item.engineNumber || null,
    variant: item.variant || null,
    dealer: item.dealer || null,
    insurance_expiry: item.insuranceExpiry || null,
    puc_date: item.pucDate || null,
    imei: item.imei || null,
    size: item.size || null,
    color: item.color || null,
    material: item.material || null,
    resale_price: item.resalePrice ?? null,
    resale_date: item.resaleDate || null,
  };

  return row;
}

/**
 * Converts a domain Warranty to a Supabase insert/update payload.
 */
export function mapWarrantyToDbRow(warranty: Warranty, userId: string): Record<string, unknown> {
  return {
    id: warranty.id,
    item_id: warranty.itemId,
    user_id: userId,
    provider: warranty.provider || null,
    policy_number: warranty.policyNumber || null,
    warranty_type: warranty.warrantyType,
    duration_months: warranty.durationMonths,
    start_date: warranty.startDate,
    end_date: warranty.endDate,
    coverage_details: warranty.coverageDetails || null,
    reminder_enabled: warranty.reminderEnabled,
    reminder_days_before: warranty.reminderDaysBefore,
  };
}

/**
 * Converts a domain VaultDocument to a Supabase insert/update payload.
 */
export function mapDocumentToDbRow(doc: VaultDocument, userId: string): Record<string, unknown> {
  const docId = isValidUUID(doc.id) ? doc.id : generateUUID();
  const itemId = (doc.itemId && isValidUUID(doc.itemId)) ? doc.itemId : null;

  let storagePath: string | null = null;
  if (doc.storagePath && !doc.storagePath.startsWith('file:') && !doc.storagePath.startsWith('content:')) {
    storagePath = doc.storagePath;
  } else if (doc.filePath && !doc.filePath.startsWith('file:') && !doc.filePath.startsWith('content:')) {
    storagePath = doc.filePath;
  }

  return {
    id: docId,
    user_id: userId,
    item_id: itemId,
    name: doc.name || doc.title,
    title: doc.title,
    category: doc.category,
    document_type: doc.documentType,
    document_date: doc.documentDate || null,
    issuer_name: doc.issuerName || null,
    reference_number: doc.referenceNumber || null,
    amount: doc.amount ?? null,
    currency: doc.currency || 'INR',
    expiry_date: doc.expiryDate || null,
    notes: doc.notes || null,
    file_path: doc.filePath,
    file_url: doc.fileUrl,
    file_type: doc.fileType || 'pdf',
    file_size_bytes: doc.fileSizeBytes || 0,
    mime_type: doc.mimeType || 'application/octet-stream',
    thumbnail_path: doc.thumbnailPath || null,
    storage_path: storagePath,
  };
}

/**
 * Converts a domain Receipt to a Supabase insert/update payload.
 */
export function mapReceiptToDbRow(receipt: Receipt, userId: string): Record<string, unknown> {
  return {
    id: receipt.id,
    user_id: userId,
    file_uri: receipt.fileUri,
    storage_path: receipt.storagePath || null,
    file_name: receipt.fileName,
    file_size_bytes: receipt.fileSizeBytes || 0,
    mime_type: receipt.mimeType || null,
    receipt_type: receipt.type || 'receipt',
    merchant: receipt.merchant || null,
    seller_address: receipt.sellerAddress || null,
    gstin: receipt.gstin || null,
    purchase_date: receipt.purchaseDate || null,
    total_amount: receipt.totalAmount ?? null,
    subtotal: receipt.subtotal ?? null,
    discount: receipt.discount ?? null,
    gst_tax: receipt.gstTax || null,
    invoice_number: receipt.invoiceNumber || null,
    item_count: receipt.itemCount || 1,
    item_ids: receipt.itemIds || [],
  };
}


export interface CloudVaultData {
  items: Item[];
  warranties: Warranty[];
  documents: VaultDocument[];
  receipts: Receipt[];
  maintenanceRecords: MaintenanceRecord[];
  expenses: Expense[];
  activityLogs: ActivityLog[];
}

/** In-flight hydration promise guard to prevent duplicate concurrent hydrations for the same user. */
const inFlightCloudHydrations = new Map<string, Promise<CloudVaultData>>();

/**
 * Fetches the entire vault for the authenticated user from Supabase.
 * Returns empty arrays if Supabase is not configured or an error occurs.
 *
 * This is called on every login, session restore, and second-device sync.
 * It is the ONLY function that should read from Supabase into the local store.
 */
export async function hydrateVaultFromCloud(userId: string): Promise<CloudVaultData> {
  const empty: CloudVaultData = {
    items: [],
    warranties: [],
    documents: [],
    receipts: [],
    maintenanceRecords: [],
    expenses: [],
    activityLogs: [],
  };

  if (!isSupabaseConfigured || !userId) {
    console.log('[CloudSync] Supabase not configured or no user — skipping hydration');
    return empty;
  }

  // In-flight guard: If hydration for this user is already running, reuse the pending promise
  const existingInFlight = inFlightCloudHydrations.get(userId);
  if (existingInFlight) {
    console.log(`[CloudSync] Reusing in-flight hydration for user ${userId}`);
    return existingInFlight;
  }

  const hydrationPromise = (async (): Promise<CloudVaultData> => {
    try {
      console.log(`[CloudSync] Hydrating vault for user ${userId}...`);

    const [
      itemsResult,
      warrantiesResult,
      documentsResult,
      receiptsResult,
      maintenanceResult,
      expensesResult,
      activityResult,
    ] = await Promise.allSettled([
      supabase
        .from('items')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('warranties')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('documents')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('receipts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('maintenance_records')
        .select('*')
        .eq('user_id', userId)
        .order('service_date', { ascending: false }),
      supabase
        .from('expenses')
        .select('*')
        .eq('user_id', userId)
        .order('expense_date', { ascending: false }),
      supabase
        .from('activity_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    const items: Item[] = [];
    const warranties: Warranty[] = [];
    const documents: VaultDocument[] = [];
    const receipts: Receipt[] = [];
    const maintenanceRecords: MaintenanceRecord[] = [];
    const expenses: Expense[] = [];
    const activityLogs: ActivityLog[] = [];

    if (itemsResult.status === 'fulfilled' && !itemsResult.value.error) {
      for (const row of itemsResult.value.data || []) {
        try { items.push(mapDbRowToItem(row as Record<string, unknown>)); } catch {}
      }
    } else if (itemsResult.status === 'rejected') {
      console.warn('[CloudSync] Items fetch failed:', itemsResult.reason);
    } else if (itemsResult.status === 'fulfilled' && itemsResult.value.error) {
      console.warn('[CloudSync] Items Supabase error:', itemsResult.value.error.message);
    }

    if (warrantiesResult.status === 'fulfilled' && !warrantiesResult.value.error) {
      for (const row of warrantiesResult.value.data || []) {
        try { warranties.push(mapDbRowToWarranty(row as Record<string, unknown>)); } catch {}
      }
    }

    if (documentsResult.status === 'fulfilled' && !documentsResult.value.error) {
      for (const row of documentsResult.value.data || []) {
        try { documents.push(mapDbRowToDocument(row as Record<string, unknown>)); } catch {}
      }
    }

    if (receiptsResult.status === 'fulfilled' && !receiptsResult.value.error) {
      for (const row of receiptsResult.value.data || []) {
        try { receipts.push(mapDbRowToReceipt(row as Record<string, unknown>)); } catch {}
      }
    }

    if (maintenanceResult.status === 'fulfilled' && !maintenanceResult.value.error) {
      for (const row of maintenanceResult.value.data || []) {
        try { maintenanceRecords.push(mapDbRowToMaintenanceRecord(row as Record<string, unknown>)); } catch {}
      }
    }

    if (expensesResult.status === 'fulfilled' && !expensesResult.value.error) {
      for (const row of expensesResult.value.data || []) {
        try { expenses.push(mapDbRowToExpense(row as Record<string, unknown>)); } catch {}
      }
    }

    if (activityResult.status === 'fulfilled' && !activityResult.value.error) {
      for (const row of activityResult.value.data || []) {
        try { activityLogs.push(mapDbRowToActivityLog(row as Record<string, unknown>)); } catch {}
      }
    }

    console.log(
      `[CloudSync] Hydration complete: ${items.length} items, ${warranties.length} warranties, ` +
      `${documents.length} docs, ${receipts.length} receipts, ${maintenanceRecords.length} maintenance, ` +
      `${expenses.length} expenses, ${activityLogs.length} activity logs`
    );

      return { items, warranties, documents, receipts, maintenanceRecords, expenses, activityLogs };
    } catch (err) {
      console.warn('[CloudSync] Hydration failed with exception:', err);
      return empty;
    } finally {
      inFlightCloudHydrations.delete(userId);
    }
  })();

  inFlightCloudHydrations.set(userId, hydrationPromise);
  return hydrationPromise;
}


/** Upserts an item to Supabase. Returns error string if failed, null if ok. */
export async function cloudUpsertItem(item: Item, userId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const validItemId = isValidUUID(item.id) ? item.id : generateUUID();
    let effectiveReceiptPath = item.receiptPath;

    // Background upload local receipt media to user-scoped private storage if local
    const localUri = item.receiptUri?.startsWith('file:') ? item.receiptUri : null;
    if (localUri && (!effectiveReceiptPath || effectiveReceiptPath.startsWith('file:') || effectiveReceiptPath.startsWith('vault_receipts/'))) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(localUri).catch(() => null);
        if (fileInfo?.exists && !fileInfo.isDirectory) {
          const ext = localUri.toLowerCase().endsWith('.png') ? '.png' : '.jpg';
          const userScopedPath = `${userId}/items/${validItemId}/receipt${ext}`;
          const base64 = await FileSystem.readAsStringAsync(localUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const { error: uploadError } = await supabase.storage
            .from(BUCKET_ITEM_DOCUMENTS)
            .upload(userScopedPath, bytes, { contentType: 'image/jpeg', upsert: true });

          if (!uploadError) {
            effectiveReceiptPath = userScopedPath;
            console.log(`[CloudSync] Item receipt uploaded to ${BUCKET_ITEM_DOCUMENTS}/${userScopedPath}`);
          }
        }
      } catch (uploadErr) {
        console.warn('[CloudSync] Item receipt media upload note:', uploadErr);
      }
    }

    const payload = mapItemToDbRow({ ...item, id: validItemId, receiptPath: effectiveReceiptPath }, userId);
    const { error } = await supabase
      .from('items')
      .upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('[CloudSync] Item upsert error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CloudSync] Item upsert exception:', msg);
    return msg;
  }
}

/** Upserts a warranty to Supabase. */
export async function cloudUpsertWarranty(warranty: Warranty, userId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const validWarId = isValidUUID(warranty.id) ? warranty.id : generateUUID();
    const { error } = await supabase
      .from('warranties')
      .upsert(mapWarrantyToDbRow({ ...warranty, id: validWarId }, userId), { onConflict: 'id' });
    if (error) {
      console.warn('[CloudSync] Warranty upsert error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CloudSync] Warranty upsert exception:', msg);
    return msg;
  }
}

/** Upserts a document to Supabase. */
export async function cloudUpsertDocument(doc: VaultDocument, userId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const validDocId = isValidUUID(doc.id) ? doc.id : generateUUID();
    let effectiveStoragePath = doc.storagePath;

    // Check if we should upload local file to Supabase private storage
    const localUri = doc.filePath?.startsWith('file:')
      ? doc.filePath
      : doc.fileUrl?.startsWith('file:')
      ? doc.fileUrl
      : null;

    if (localUri && (!effectiveStoragePath || effectiveStoragePath.startsWith('file:') || effectiveStoragePath.startsWith('vault_documents/'))) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(localUri).catch(() => null);
        if (fileInfo?.exists && !fileInfo.isDirectory) {
          const ext = localUri.toLowerCase().endsWith('.pdf') ? '.pdf' : '.jpg';
          const bucket = doc.itemId ? BUCKET_ITEM_DOCUMENTS : BUCKET_VAULT_DOCUMENTS;
          const userScopedPath = doc.itemId
            ? `${userId}/items/${doc.itemId}/doc_${validDocId}${ext}`
            : `${userId}/vault/${validDocId}${ext}`;

          const base64 = await FileSystem.readAsStringAsync(localUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const mimeType = doc.mimeType || (ext === '.pdf' ? 'application/pdf' : 'image/jpeg');

          const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(userScopedPath, bytes, { contentType: mimeType, upsert: true });

          if (!uploadError) {
            effectiveStoragePath = userScopedPath;
            console.log(`[CloudSync] Document media uploaded to ${bucket}/${userScopedPath}`);
          }
        }
      } catch (uploadErr) {
        console.warn('[CloudSync] Document background media upload notice:', uploadErr);
      }
    }

    const payload = mapDocumentToDbRow({ ...doc, id: validDocId, storagePath: effectiveStoragePath }, userId);
    const { error } = await supabase
      .from('documents')
      .upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('[CloudSync] Document upsert error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CloudSync] Document upsert exception:', msg);
    return msg;
  }
}

/** Upserts a receipt to Supabase. */
export async function cloudUpsertReceipt(receipt: Receipt, userId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const { error } = await supabase
      .from('receipts')
      .upsert(mapReceiptToDbRow(receipt, userId), { onConflict: 'id' });
    if (error) {
      console.warn('[CloudSync] Receipt upsert error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CloudSync] Receipt upsert exception:', msg);
    return msg;
  }
}

/** Upserts a maintenance record to Supabase. */
export async function cloudUpsertMaintenance(
  record: MaintenanceRecord,
  userId: string
): Promise<string | null> {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const payload = mapMaintenanceToDbRow(record, userId);
    const { error } = await supabase.from('maintenance_records').upsert(
      payload,
      { onConflict: 'id' }
    );
    if (error) {
      console.warn('[CloudSync] Maintenance upsert error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CloudSync] Maintenance upsert exception:', msg);
    return msg;
  }
}

/** Upserts an expense to Supabase. */
export async function cloudUpsertExpense(expense: Expense, userId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const { error } = await supabase.from('expenses').upsert(
      {
        id: expense.id,
        item_id: expense.itemId,
        user_id: userId,
        title: expense.title,
        expense_type: expense.expenseType,
        amount: expense.amount,
        expense_date: expense.expenseDate,
        notes: expense.notes || null,
      },
      { onConflict: 'id' }
    );
    if (error) {
      console.warn('[CloudSync] Expense upsert error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CloudSync] Expense upsert exception:', msg);
    return msg;
  }
}

/** Upserts an activity log entry to Supabase. */
export async function cloudUpsertActivityLog(
  log: ActivityLog,
  userId: string
): Promise<string | null> {
  if (!isSupabaseConfigured || !userId) return null;
  try {
    const { error } = await supabase.from('activity_logs').upsert(
      {
        id: log.id,
        user_id: userId,
        item_id: log.itemId || null,
        activity_type: log.activityType,
        title: log.title,
        description: log.description || null,
        amount: log.amount ?? null,
        metadata: log.metadata || {},
      },
      { onConflict: 'id' }
    );
    if (error) {
      console.warn('[CloudSync] ActivityLog upsert error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[CloudSync] ActivityLog upsert exception:', msg);
    return msg;
  }
}

/** Deletes an item from Supabase (cascade handles warranties/docs). */
export async function cloudDeleteItem(itemId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !isValidUUID(itemId)) return null;
  try {
    const { error } = await supabase.from('items').delete().eq('id', itemId);
    if (error) {
      console.warn('[CloudSync] Item delete error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg;
  }
}

/** Deletes a document from Supabase. */
export async function cloudDeleteDocument(documentId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !isValidUUID(documentId)) return null;
  try {
    const { error } = await supabase.from('documents').delete().eq('id', documentId);
    if (error) {
      console.warn('[CloudSync] Document delete error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg;
  }
}

/** Deletes a maintenance record from Supabase. */
export async function cloudDeleteMaintenance(recordId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !isValidUUID(recordId)) return null;
  try {
    const { error } = await supabase.from('maintenance_records').delete().eq('id', recordId);
    if (error) {
      console.warn('[CloudSync] Maintenance delete error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg;
  }
}

/** Deletes an expense from Supabase. */
export async function cloudDeleteExpense(expenseId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !isValidUUID(expenseId)) return null;
  try {
    const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
    if (error) {
      console.warn('[CloudSync] Expense delete error:', error.message);
      return error.message;
    }
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg;
  }
}
