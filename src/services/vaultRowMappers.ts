import {
  isStoragePath,
  canonicalizeProductPhotos,
  cleanStoragePath,
  isImageDocument,
  isPdfDocument,
} from '../utils/storageUtils';
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
 * Safely parses a PostgreSQL array string literal (e.g. '{item1,item2}' or '{"item 1","item, 2"}').
 * Preserves string entries while handling quotes, escaped characters, and NULLs without throwing.
 */
export function parsePostgresArray(text: string): string[] {
  if (typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];

  const content = trimmed.slice(1, -1).trim();
  if (!content) return [];

  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let escapeNext = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      const val = current.trim();
      if (val && val.toUpperCase() !== 'NULL') {
        result.push(val);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const lastVal = current.trim();
  if (lastVal && lastVal.toUpperCase() !== 'NULL') {
    result.push(lastVal);
  }

  return result;
}

/**
 * Robust, non-throwing normalization for product_photos and other string array columns.
 * Supports:
 * - null / undefined -> []
 * - Array -> validated, trimmed string entries (filtering non-strings and empties)
 * - JSON-encoded array -> parsed and validated
 * - JSON-encoded string -> normalized to [string]
 * - Plain non-empty path or URI -> [path]
 * - PostgreSQL array syntax ('{a,b}' / '{"a","b"}') -> parsed safely
 * - Malformed / unexpected types -> safe fallback to []
 */
export function normalizeProductPhotos(raw: unknown): string[] {
  if (raw === null || raw === undefined) {
    return [];
  }

  let list: string[] = [];

  // 1. Direct array
  if (Array.isArray(raw)) {
    list = raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  } else if (typeof raw !== 'string') {
    // 2. Non-string primitives (numbers, booleans, objects) -> safe fallback []
    return [];
  } else {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }

    // 3. PostgreSQL array syntax: starts with '{' and ends with '}'
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        list = parsePostgresArray(trimmed);
      } catch {
        console.warn('[CloudSync] Non-fatal: failed to parse postgres array in product_photos');
        return [];
      }
    } else if (
      // 4. JSON array or JSON string
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          list = parsed
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
        } else if (typeof parsed === 'string') {
          const clean = parsed.trim();
          list = clean.length > 0 ? [clean] : [];
        }
      } catch {
        list = trimmed.startsWith('[') || trimmed.startsWith('{') ? [] : [trimmed];
      }
    } else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      // 5. Malformed structured syntax -> safe fallback []
      return [];
    } else {
      // 6. Plain non-empty path, URI, or single string
      list = [trimmed];
    }
  }

  return canonicalizeProductPhotos(list);
}

/**
 * Normalizes an array of string identifiers (e.g. receipt item_ids).
 * Never throws, handles PG arrays, JSON arrays, and string formats safely.
 */
export function normalizeStringArray(raw: unknown): string[] {
  return normalizeProductPhotos(raw);
}

/**
 * Maps a raw Supabase items row to the domain Item type safely without throwing.
 */
export function mapDbRowToItem(row: Record<string, unknown>): Item {
  let products: PurchasedProduct[] | undefined = undefined;
  let cleanNotes = (row.notes as string) || undefined;
  if (cleanNotes && cleanNotes.includes('[KEEPR_PRODUCTS]:')) {
    const parts = cleanNotes.split('[KEEPR_PRODUCTS]:');
    cleanNotes = parts[0].trim() || undefined;
    try {
      const parsed = JSON.parse(parts[1].trim());
      if (Array.isArray(parsed)) {
        products = parsed;
      }
    } catch {
      products = undefined;
    }
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: (row.name as string) || 'Unnamed Item',
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
    imageUrl: (() => {
      const dbStorage = cleanStoragePath(row.image_storage_path as string | undefined);
      const dbImg = cleanStoragePath(row.image_url as string | undefined);
      if (dbStorage && isStoragePath(dbStorage)) return dbStorage;
      if (dbImg && isStoragePath(dbImg)) return dbImg;
      const rawPhotos = normalizeProductPhotos(row.product_photos);
      const photoStorage = rawPhotos.map((p) => cleanStoragePath(p) || p).find((p) => isStoragePath(p));
      if (photoStorage) return photoStorage;
      if (dbImg) return dbImg;
      if (rawPhotos[0]) return rawPhotos[0];
      return undefined;
    })(),
    imageStoragePath: (() => {
      const dbStorage = cleanStoragePath(row.image_storage_path as string | undefined);
      const dbImg = cleanStoragePath(row.image_url as string | undefined);
      if (dbStorage && isStoragePath(dbStorage)) return dbStorage;
      if (dbImg && isStoragePath(dbImg)) return dbImg;
      const rawPhotos = normalizeProductPhotos(row.product_photos);
      const photoStorage = rawPhotos.map((p) => cleanStoragePath(p) || p).find((p) => isStoragePath(p));
      if (photoStorage) return photoStorage;
      return undefined;
    })(),
    status: (row.status as Item['status']) || 'active',
    receiptId: (row.receipt_id && typeof row.receipt_id === 'string' && isValidUUID(row.receipt_id))
      ? row.receipt_id
      : undefined,
    receiptUri: (() => {
      const rPath = cleanStoragePath(row.receipt_path as string | undefined) || (row.receipt_path as string | undefined);
      const rUri = cleanStoragePath(row.receipt_uri as string | undefined) || (row.receipt_uri as string | undefined);
      if (rPath && isStoragePath(rPath)) return rPath;
      if (rUri && isStoragePath(rUri)) return rUri;
      return rUri || undefined;
    })(),
    receiptPath: (() => {
      const rPath = cleanStoragePath(row.receipt_path as string | undefined) || (row.receipt_path as string | undefined);
      const rUri = cleanStoragePath(row.receipt_uri as string | undefined) || (row.receipt_uri as string | undefined);
      if (rPath && isStoragePath(rPath)) return rPath;
      if (rUri && isStoragePath(rUri)) return rUri;
      return undefined;
    })(),
    receiptName: (row.receipt_name as string) || undefined,
    receiptType: (row.receipt_type as 'receipt' | 'invoice') || undefined,
    productPhotos: canonicalizeProductPhotos(
      normalizeProductPhotos(row.product_photos).map((p) => cleanStoragePath(p) || p),
      {
        receiptPath: cleanStoragePath(row.receipt_path as string | undefined) || (row.receipt_path as string) || undefined,
        receiptUri: cleanStoragePath(row.receipt_uri as string | undefined) || (row.receipt_uri as string) || undefined,
        imageStoragePath: cleanStoragePath(row.image_storage_path as string | undefined) || (row.image_storage_path as string) || undefined,
      }
    ),
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
    filePath: (() => {
      const sp = row.storage_path as string | undefined;
      const fp = row.file_path as string | undefined;
      const fu = row.file_url as string | undefined;
      if (sp && isStoragePath(sp)) return sp;
      if (fp && isStoragePath(fp)) return fp;
      if (fu && isStoragePath(fu)) return fu;
      return fp || fu || '';
    })(),
    fileUrl: (() => {
      const sp = row.storage_path as string | undefined;
      const fp = row.file_path as string | undefined;
      const fu = row.file_url as string | undefined;
      if (sp && isStoragePath(sp)) return sp;
      if (fu && isStoragePath(fu)) return fu;
      if (fp && isStoragePath(fp)) return fp;
      return fu || fp || '';
    })(),
    fileType: (() => {
      const candidatePaths = [
        row.storage_path as string | undefined,
        row.file_path as string | undefined,
        row.file_url as string | undefined,
        row.thumbnail_path as string | undefined,
      ];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.bmp', '.gif'];
      const hasImageExt = candidatePaths.some((p) => {
        if (!p || typeof p !== 'string') return false;
        const clean = p.trim().split(/[?#]/)[0].toLowerCase();
        return imageExtensions.some((ext) => clean.endsWith(ext));
      });
      const mime = typeof row.mime_type === 'string' ? row.mime_type.toLowerCase() : '';
      if (hasImageExt || mime.startsWith('image/')) {
        return 'image';
      }
      const hasPdfExt = candidatePaths.some((p) => {
        if (!p || typeof p !== 'string') return false;
        const clean = p.trim().split(/[?#]/)[0].toLowerCase();
        return clean.endsWith('.pdf');
      });
      if (hasPdfExt || mime.includes('pdf')) {
        return 'pdf';
      }
      return (row.file_type as string) || 'image';
    })(),
    fileSizeBytes: Number(row.file_size_bytes) || 0,
    mimeType: (() => {
      const rawMime = (row.mime_type as string) || '';
      const candidatePaths = [
        row.storage_path as string | undefined,
        row.file_path as string | undefined,
        row.file_url as string | undefined,
      ];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.bmp', '.gif'];
      const hasImageExt = candidatePaths.some((p) => {
        if (!p || typeof p !== 'string') return false;
        const clean = p.trim().split(/[?#]/)[0].toLowerCase();
        return imageExtensions.some((ext) => clean.endsWith(ext));
      });
      if (hasImageExt) {
        if (!rawMime || rawMime === 'application/octet-stream' || rawMime.includes('pdf')) {
          const matchExt = candidatePaths.find((p) => p && typeof p === 'string')?.trim().split(/[?#]/)[0].toLowerCase();
          if (matchExt?.endsWith('.png')) return 'image/png';
          if (matchExt?.endsWith('.webp')) return 'image/webp';
          return 'image/jpeg';
        }
      }
      return rawMime || 'application/octet-stream';
    })(),
    thumbnailPath: (row.thumbnail_path as string) || null,
    storagePath: (() => {
      const sp = row.storage_path as string | undefined;
      const fp = row.file_path as string | undefined;
      const fu = row.file_url as string | undefined;
      if (sp && isStoragePath(sp)) return sp;
      if (fp && isStoragePath(fp)) return fp;
      if (fu && isStoragePath(fu)) return fu;
      return null;
    })(),
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

export function mapDbRowToReceipt(row: Record<string, unknown>): Receipt {
  const itemIds = normalizeStringArray(row.item_ids);

  return {
    id: row.id as string,
    userId: row.user_id as string,
    fileUri: (() => {
      const sp = row.storage_path as string | undefined;
      const fu = row.file_uri as string | undefined;
      if (sp && isStoragePath(sp)) return sp;
      if (fu && isStoragePath(fu)) return fu;
      return fu || 'receipt.jpg';
    })(),
    storagePath: (() => {
      const sp = row.storage_path as string | undefined;
      const fu = row.file_uri as string | undefined;
      if (sp && isStoragePath(sp)) return sp;
      if (fu && isStoragePath(fu)) return fu;
      return undefined;
    })(),
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
    image_url: (() => {
      const cleanStorage = cleanStoragePath(item.imageStoragePath);
      if (cleanStorage && isStoragePath(cleanStorage)) return cleanStorage;
      const cleanImg = cleanStoragePath(item.imageUrl);
      if (cleanImg && isStoragePath(cleanImg)) return cleanImg;
      if (Array.isArray(item.productPhotos)) {
        for (const p of item.productPhotos) {
          const cp = cleanStoragePath(p) || p;
          if (isStoragePath(cp)) return cp;
        }
      }
      return null;
    })(),
    image_storage_path: (() => {
      const cleanStorage = cleanStoragePath(item.imageStoragePath);
      if (cleanStorage && isStoragePath(cleanStorage)) return cleanStorage;
      const cleanImg = cleanStoragePath(item.imageUrl);
      if (cleanImg && isStoragePath(cleanImg)) return cleanImg;
      if (Array.isArray(item.productPhotos)) {
        for (const p of item.productPhotos) {
          const cp = cleanStoragePath(p) || p;
          if (isStoragePath(cp)) return cp;
        }
      }
      return null;
    })(),
    status: item.status || 'active',
    receipt_id: (item.receiptId && isValidUUID(item.receiptId)) ? item.receiptId : null,
    receipt_uri: (() => {
      const cleanReceiptPath = cleanStoragePath(item.receiptPath);
      if (cleanReceiptPath && isStoragePath(cleanReceiptPath)) return cleanReceiptPath;
      const cleanReceiptUri = cleanStoragePath(item.receiptUri);
      if (cleanReceiptUri && isStoragePath(cleanReceiptUri)) return cleanReceiptUri;
      return null;
    })(),
    receipt_path: (() => {
      const cleanReceiptPath = cleanStoragePath(item.receiptPath);
      if (cleanReceiptPath && isStoragePath(cleanReceiptPath)) return cleanReceiptPath;
      const cleanReceiptUri = cleanStoragePath(item.receiptUri);
      if (cleanReceiptUri && isStoragePath(cleanReceiptUri)) return cleanReceiptUri;
      return null;
    })(),
    receipt_name: item.receiptName || null,
    receipt_type: item.receiptType || null,
    product_photos: canonicalizeProductPhotos(
      Array.isArray(item.productPhotos)
        ? item.productPhotos.map((p) => cleanStoragePath(p) || p)
        : [],
      {
        receiptPath: cleanStoragePath(item.receiptPath) || item.receiptPath,
        receiptUri: cleanStoragePath(item.receiptUri) || item.receiptUri,
        imageStoragePath: cleanStoragePath(item.imageStoragePath) || item.imageStoragePath,
        photoUri: cleanStoragePath(item.photoUri) || item.photoUri,
      }
    ),
    product_type: item.productType || null,
    category_confidence: item.categoryConfidence || null,
    imei: item.imei || null,
    size: item.size || null,
    color: item.color || null,
    material: item.material || null,
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
    resale_price: item.resalePrice ?? null,
    resale_date: item.resaleDate || null,
  };

  return row;
}

export function mapDocumentToDbRow(doc: VaultDocument, userId: string): Record<string, unknown> {
  const docId = isValidUUID(doc.id) ? doc.id : generateUUID();
  const itemId = (doc.itemId && isValidUUID(doc.itemId)) ? doc.itemId : null;

  let storagePath: string | null = null;
  if (doc.storagePath && isStoragePath(doc.storagePath)) {
    storagePath = doc.storagePath;
  } else if (doc.filePath && isStoragePath(doc.filePath)) {
    storagePath = doc.filePath;
  } else if (doc.fileUrl && isStoragePath(doc.fileUrl)) {
    storagePath = doc.fileUrl;
  }

  const effectiveCloudFileRef = storagePath || (doc.fileUrl && (doc.fileUrl.startsWith('http://') || doc.fileUrl.startsWith('https://')) ? doc.fileUrl : null);

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
    file_path: effectiveCloudFileRef,
    file_url: effectiveCloudFileRef,
    file_type: (() => {
      if (doc.fileType && (doc.fileType === 'image' || doc.fileType === 'pdf')) {
        if (doc.fileType === 'pdf' && isImageDocument(doc)) {
          return 'image';
        }
        return doc.fileType;
      }
      if (isImageDocument(doc)) return 'image';
      if (isPdfDocument(doc)) return 'pdf';
      return 'image';
    })(),
    file_size_bytes: doc.fileSizeBytes || 0,
    mime_type: (() => {
      const clean = (doc.storagePath || doc.filePath || doc.fileUrl || '').trim().split(/[?#]/)[0].toLowerCase();
      if (doc.mimeType && doc.mimeType !== 'application/octet-stream') {
        if (doc.mimeType.toLowerCase().includes('pdf') && isImageDocument(doc)) {
          if (clean.endsWith('.png')) return 'image/png';
          if (clean.endsWith('.webp')) return 'image/webp';
          return 'image/jpeg';
        }
        return doc.mimeType;
      }
      if (isImageDocument(doc)) {
        if (clean.endsWith('.png')) return 'image/png';
        if (clean.endsWith('.webp')) return 'image/webp';
        return 'image/jpeg';
      }
      if (isPdfDocument(doc)) return 'application/pdf';
      return 'application/octet-stream';
    })(),
    thumbnail_path: doc.thumbnailPath && isStoragePath(doc.thumbnailPath) ? doc.thumbnailPath : null,
    storage_path: storagePath,
  };
}

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

export function mapReceiptToDbRow(receipt: Receipt, userId: string): Record<string, unknown> {
  const durablePath = (receipt.storagePath && isStoragePath(receipt.storagePath))
    ? receipt.storagePath
    : (receipt.fileUri && isStoragePath(receipt.fileUri))
    ? receipt.fileUri
    : null;

  const effectiveFileUri = durablePath || (receipt.fileUri && (receipt.fileUri.startsWith('http://') || receipt.fileUri.startsWith('https://')) ? receipt.fileUri : null);

  return {
    id: receipt.id,
    user_id: userId,
    file_uri: effectiveFileUri,
    storage_path: durablePath,
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
