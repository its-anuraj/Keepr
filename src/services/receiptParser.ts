
import {
  GeminiReceiptResponse,
  ExtractedReceiptData,
  CanonicalVaultEntityType,
  ExtractedServiceRepair,
  CanonicalCategory,
  ScannerCategory,
  ReceiptMultiItem,
  FieldValue,
  CommonReceiptInfo,
  MobileLaptopDetails,
  ElectronicsDetails,
  VehicleDetails,
  HomeApplianceDetails,
  FurnitureDetails,
  FashionDetails,
  DocumentsDetails,
  OtherDetails,
  ExtractionConfidence,
  ExtractedField,
  ConfidenceLevel,
} from '../types/scanner';
import {
  canonicalToScannerCode,
  normalizeToCanonicalCategory,
  scannerCodeToCanonical,
} from './categoryRules';
import {
  detectCategoryAndProductType,
  getCategoryIdFromName,
  getCategoryNameFromId,
} from '../constants/categories';
import {
  normalizeToCanonicalDocumentCategory,
  normalizeToCanonicalDocumentType,
} from '../constants/documentCategories';
import { CanonicalDocumentCategory, CanonicalDocumentType } from '../types';
import { classifyDocument } from './documentClassifier';

/**
 * Normalizes an ExtractionConfidence enum to UI ConfidenceLevel & Score
 */
export function mapRawConfidence(raw?: ExtractionConfidence): {
  confidence: 'high' | 'medium' | 'verify';
  score: number;
} {
  switch (raw) {
    case 'HIGH':
      return { confidence: 'high', score: 0.98 };
    case 'MEDIUM':
      return { confidence: 'medium', score: 0.85 };
    case 'LOW':
      return { confidence: 'verify', score: 0.60 };
    case 'UNKNOWN':
    default:
      return { confidence: 'verify', score: 0.0 };
  }
}

/**
 * Safely converts any value to a string or null (never empty string)
 */
export const toStr = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'value' in v) {
    return toStr(v.value);
  }
  const s = String(v).trim();
  return s === '' ? null : s;
};

/**
 * Safely converts any value (including ExtractedField objects) to a number or null
 */
export const toNum = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'value' in v) {
    return toNum(v.value);
  }
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (typeof v === 'string') {
    const clean = v.replace(/[^0-9.-]+/g, '');
    if (!clean) return null;
    const n = Number(clean);
    return isNaN(n) ? null : n;
  }
  const n = Number(v);
  return isNaN(n) ? null : n;
};

/**
 * Creates a FieldValue while strictly preserving null values and evidence
 */
export function buildFieldValue<T = string | null>(
  rawField: ExtractedField<any> | any,
  fallbackScore?: number,
  isSensitive: boolean = false
): FieldValue<T> {
  if (
    rawField !== null &&
    typeof rawField === 'object' &&
    'value' in rawField &&
    'confidence' in rawField
  ) {
    const ext = rawField as ExtractedField<any>;
    const hasValue = ext.value !== null && ext.value !== undefined && ext.value !== '';
    let confidence: ConfidenceLevel = 'verify';
    let score = 0.0;

    if (ext.confidence === 'HIGH') {
      confidence = 'high';
      score = 0.95;
    } else if (ext.confidence === 'MEDIUM') {
      confidence = 'medium';
      score = 0.80;
    } else {
      confidence = 'verify';
      score = ext.confidence === 'LOW' ? 0.50 : 0.0;
    }

    return {
      value: (hasValue ? ext.value : null) as T,
      confidence: hasValue ? confidence : 'verify',
      confidenceScore: hasValue ? score : 0.0,
      needsVerification: !hasValue || ext.confidence === 'LOW' || ext.confidence === 'UNKNOWN' || (isSensitive && ext.confidence !== 'HIGH'),
      aiSuggested: true,
      evidence: ext.evidence ?? null,
      rawConfidence: ext.confidence,
    };
  }

  const val = (rawField !== undefined ? rawField : null) as T;
  const hasVal = val !== null && val !== undefined && (val as any) !== '';
  const score = hasVal ? (fallbackScore ?? 0.95) : 0.0;
  let level: ConfidenceLevel = 'verify';

  if (hasVal) {
    if (score >= 0.90) level = 'high';
    else if (score >= 0.75) level = 'medium';
  }

  const needsVerify = !hasVal || score < 0.85 || (isSensitive && score < 0.98);

  return {
    value: (hasVal ? val : null) as T,
    confidence: level,
    confidenceScore: score,
    needsVerification: needsVerify,
    aiSuggested: true,
    evidence: null,
    rawConfidence: hasVal ? (score >= 0.9 ? 'HIGH' : score >= 0.75 ? 'MEDIUM' : 'LOW') : 'UNKNOWN',
  };
}

const MONTH_NAME_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

/**
 * Normalizes common receipt date formats (DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, 18 Sep 2026, etc.) to standard ISO (YYYY-MM-DD)
 */
export function normalizeDateToIso(rawDate: any): string | null {
  if (!rawDate) return null;
  const str = (typeof rawDate === 'object' && 'value' in rawDate ? rawDate.value : rawDate);
  if (!str || typeof str !== 'string') return null;

  const trimmed = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const textMonthDmyMatch = trimmed.match(/^(\d{1,2})[\s./-]+([A-Za-z]+)[\s./,-]+(\d{2,4})$/);
  if (textMonthDmyMatch) {
    const day = textMonthDmyMatch[1].padStart(2, '0');
    const monthKey = textMonthDmyMatch[2].toLowerCase();
    let year = textMonthDmyMatch[3];
    if (year.length === 2) {
      year = Number(year) > 50 ? `19${year}` : `20${year}`;
    }
    const month = MONTH_NAME_MAP[monthKey];
    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  const textMonthMdyMatch = trimmed.match(/^([A-Za-z]+)[\s./-]+(\d{1,2})[\s./,-]+(\d{2,4})$/);
  if (textMonthMdyMatch) {
    const monthKey = textMonthMdyMatch[1].toLowerCase();
    const day = textMonthMdyMatch[2].padStart(2, '0');
    let year = textMonthMdyMatch[3];
    if (year.length === 2) {
      year = Number(year) > 50 ? `19${year}` : `20${year}`;
    }
    const month = MONTH_NAME_MAP[monthKey];
    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  // Matches DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY (Indian default DD/MM/YYYY)
  const dmyMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmyMatch) {
    let day = dmyMatch[1].padStart(2, '0');
    let month = dmyMatch[2].padStart(2, '0');
    let year = dmyMatch[3];
    if (year.length === 2) {
      year = Number(year) > 50 ? `19${year}` : `20${year}`;
    }
    // If month > 12 and day <= 12, it was likely MM/DD/YYYY
    if (Number(month) > 12 && Number(day) <= 12) {
      const temp = day;
      day = month;
      month = temp;
    }
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    if (y >= 1990 && y <= 2035) {
      return parsed.toISOString().split('T')[0];
    }
  }

  return trimmed;
}

/**
 * Validates whether a string matches Indian GSTIN 15-character alphanumeric format
 */
export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  const clean = gstin.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 15) return false;
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(clean);
}

/**
 * Validates numerical relationships (subtotal + tax - discount == total)
 * Never silently repairs values with arbitrary numbers. Cross-references against
 * itemized line item sums when available to resolve subtotal vs tender ambiguities.
 */
export function validateNumericalRelationships(
  common: CommonReceiptInfo,
  rawItems?: any[]
): {
  isValid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const subtotal = common.subtotal?.value;
  const tax = common.taxGst?.value;
  const discount = common.discount?.value;
  const total = common.finalAmount?.value;

  let itemsSum: number | null = null;
  if (Array.isArray(rawItems) && rawItems.length > 0) {
    let sum = 0;
    let hasValidItemPrices = false;
    for (const it of rawItems) {
      const price = typeof it.totalPrice === 'object' && it.totalPrice !== null
        ? toNum(it.totalPrice.value)
        : toNum(it.totalPrice ?? it.price);
      if (price !== null && price > 0) {
        sum += price;
        hasValidItemPrices = true;
      }
    }
    if (hasValidItemPrices) {
      itemsSum = sum;
    }
  }

  // 2. Cross-reference subtotal with line items and total
  if (total !== null && total !== undefined && total > 0) {
    const calcTax = tax || 0;
    const calcDiscount = discount || 0;

    // If subtotal is missing but we have itemsSum
    if ((subtotal === null || subtotal === undefined) && itemsSum !== null) {
      const expectedTotal = itemsSum + calcTax - calcDiscount;
      if (Math.abs(expectedTotal - total) <= 1.0) {
        // Line items perfectly reconcile with total!
        common.subtotal = buildFieldValue<number | null>(itemsSum, 0.95);
        if (common.subtotal) {
          common.subtotal.evidence = `Reconciled from ${rawItems?.length} line items`;
        }
      }
    } else if (subtotal !== null && subtotal !== undefined && subtotal > 0) {
      const expectedTotal = subtotal + calcTax - calcDiscount;
      const diff = Math.abs(expectedTotal - total);

      // If there's a discrepancy, see if itemsSum resolves it
      if (diff > 2.0) {
        if (itemsSum !== null && Math.abs((itemsSum + calcTax - calcDiscount) - total) <= 1.0) {
          // The line item sum resolves the discrepancy!
          common.subtotal = buildFieldValue<number | null>(itemsSum, 0.95);
          if (common.subtotal) {
            common.subtotal.evidence = `Reconciled from ${rawItems?.length} line items (original was ${subtotal})`;
          }
        } else {
          warnings.push(
            `Total (${total}) differs from Subtotal (${subtotal}) + Tax (${calcTax}) - Discount (${calcDiscount}) = ${expectedTotal.toFixed(2)}`
          );
          if (common.finalAmount) {
            common.finalAmount.needsVerification = true;
            common.finalAmount.confidence = 'verify';
          }
        }
      }
    }
  }

  // 3. Validate GSTIN structure if present
  const gstinVal = common.gstin?.value;
  if (gstinVal) {
    if (isValidGstin(gstinVal)) {
      if (common.gstin) {
        common.gstin.confidence = 'high';
        common.gstin.needsVerification = false;
      }
    }
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}

/**
 * Checks if a category should NOT have a warranty end date (Fashion, Beauty & Personal Care, Clothing).
 */
export function isNoWarrantyCategory(
  catId?: string | null,
  catName?: string | null,
  pType?: string | null
): boolean {
  const check = `${catId || ''} ${catName || ''} ${pType || ''}`.toLowerCase();
  return (
    check.includes('fashion') ||
    check.includes('beauty') ||
    check.includes('clothing') ||
    check.includes('personal care') ||
    check.includes('apparel') ||
    check.includes('shoes') ||
    check.includes('cosmetics') ||
    check.includes('skincare')
  );
}

/**
 * Checks whether an invoice line item represents a non-physical charge
 * (e.g. shipping, GST/tax, convenience fee, installation, discount, coupon).
 * These must NOT be converted into separate physical Purchased Items.
 */
export function isNonProductCharge(name?: string | null): boolean {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim().toLowerCase();
  const nonProductPattern = /\b(shipping|delivery|delivery fee|freight|courier|convenience fee|platform fee|handling fee|processing fee|packaging fee|packing charge|bag charge|service charge|service fee|installation|installation charge|labour|labor|gst|cgst|sgst|igst|tax|vat|cess|sales tax|round off|rounding|discount|coupon|promo|voucher|gift card|cashback|offer|gift wrap|payment fee|cod charge|card fee|transaction fee)\b/i;
  return nonProductPattern.test(n);
}

/**
 * Parses Gemini structured response into the domain ExtractedReceiptData
 */
export function parseGeminiResponseToExtractedData(
  geminiResponse: GeminiReceiptResponse,
  receiptUri: string,
  fileName?: string
): ExtractedReceiptData {
  const isExplicitInvalid =
    (geminiResponse as any).status === 'invalid_document' ||
    (geminiResponse.isReceipt === false &&
      !geminiResponse.isDocument &&
      !(geminiResponse as any).documentCategory &&
      !(geminiResponse as any).document?.category);

  if (isExplicitInvalid) {
    const emptyCommon: CommonReceiptInfo = {
      productName: buildFieldValue<string | null>(null, 0.0),
      category: buildFieldValue<ScannerCategory>('other', 0.0),
      brand: buildFieldValue<string | null>(null, 0.0),
      merchant: buildFieldValue<string | null>(null, 0.0),
      merchantAddress: buildFieldValue<string | null>(null, 0.0),
      merchantPhone: buildFieldValue<string | null>(null, 0.0),
      gstin: buildFieldValue<string | null>(null, 0.0),
      purchaseDate: buildFieldValue<string | null>(null, 0.0),
      invoiceNumber: buildFieldValue<string | null>(null, 0.0),
      quantity: buildFieldValue<number | null>(null, 0.0),
      unitPrice: buildFieldValue<number | null>(null, 0.0),
      subtotal: buildFieldValue<number | null>(null, 0.0),
      discount: buildFieldValue<number | null>(null, 0.0),
      taxGst: buildFieldValue<number | null>(null, 0.0),
      gstRate: buildFieldValue<string | null>(null, 0.0),
      cgst: buildFieldValue<number | null>(null, 0.0),
      sgst: buildFieldValue<number | null>(null, 0.0),
      igst: buildFieldValue<number | null>(null, 0.0),
      finalAmount: buildFieldValue<number | null>(null, 0.0),
      currency: buildFieldValue<string | null>(null, 0.0),
      paymentMethod: buildFieldValue<string | null>(null, 0.0),
      storeLocation: buildFieldValue<string | null>(null, 0.0),
      notes: buildFieldValue<string | null>(null, 0.0),
      serialNumber: buildFieldValue<string | null>(null, 0.0),
      modelNumber: buildFieldValue<string | null>(null, 0.0),
      warrantyText: buildFieldValue<string | null>(null, 0.0),
    };

    return {
      id: `receipt-${Date.now()}`,
      receiptUri,
      receiptImageName: fileName || 'Non-Receipt.jpg',
      scannedAt: new Date().toISOString(),
      isReceipt: false,
      isDocument: false,
      receiptConfidence: geminiResponse.receiptConfidence ?? 0.0,
      rejectionReason: geminiResponse.rejectionReason || "This image does not appear to be a supported document or receipt.",
      rejectionMessage: geminiResponse.message || "Please upload a clear photo of your receipt, bill, or ownership document.",
      common: emptyCommon,
      category: 'other',
      categoryDetails: {},
      items: [],
      rawConfidenceScore: 0,
      overallQuality: 'fair',
      provider: 'gemini',
    };
  }

  // Support both new document evidence schema and legacy response
  const docFields = ((geminiResponse as any).document?.fields || {}) as Record<string, any>;
  const rawCat = (geminiResponse as any).document?.category || (geminiResponse as any).documentCategory || geminiResponse.category;
  const catString = (typeof rawCat === 'object' && rawCat !== null && 'value' in rawCat)
    ? (rawCat as any).value
    : rawCat;

  const canonicalDocCategory = normalizeToCanonicalDocumentCategory(catString);
  const rawDocType = (geminiResponse as any).document?.documentType || (geminiResponse as any).documentType;
  const canonicalDocType = canonicalDocCategory ? normalizeToCanonicalDocumentType(canonicalDocCategory, rawDocType) : rawDocType;

  const legacyCommon = (geminiResponse.common || {}) as Record<string, any>;
  const legacyCategorySpecific = (geminiResponse.categorySpecific || {}) as Record<string, any>;

  const serviceRepairData = geminiResponse.serviceRepair || (geminiResponse as any).service;

  let merchantField: any =
    docFields.merchantName ??
    docFields.institutionName ??
    docFields.provider ??
    docFields.insurer ??
    docFields.dealer ??
    docFields.seller ??
    geminiResponse.merchantName ??
    (geminiResponse as any).issuerName ??
    (geminiResponse as any).issuer ??
    serviceRepairData?.serviceProvider ??
    legacyCommon.storeName;

  let merchantAddressField = docFields.address ?? geminiResponse.merchantAddress ?? serviceRepairData?.serviceProviderAddress ?? legacyCommon.storeLocation;
  let merchantPhoneField = docFields.phone ?? geminiResponse.merchantPhone ?? serviceRepairData?.serviceProviderPhone;
  let gstinField = docFields.merchantGstin ?? geminiResponse.merchantGstin ?? (geminiResponse as any).gstin ?? legacyCommon.gst;

  let invoiceNumberField: any =
    docFields.receiptNumber ??
    docFields.studentId ??
    docFields.accountNumber ??
    docFields.billNumber ??
    docFields.policyNumber ??
    docFields.vehicleRegistrationNumber ??
    docFields.documentNumber ??
    geminiResponse.receiptNumber ??
    geminiResponse.invoiceNumber ??
    (geminiResponse as any).referenceNumber ??
    serviceRepairData?.coverageReferenceNumber ??
    legacyCommon.invoiceNumber;

  let rawDateField: any =
    docFields.paymentDate ??
    docFields.issueDate ??
    docFields.registrationDate ??
    docFields.warrantyStartDate ??
    geminiResponse.purchaseDate ??
    geminiResponse.invoiceDate ??
    (geminiResponse as any).documentDate ??
    serviceRepairData?.serviceDate ??
    legacyCommon.purchaseDate;
  let invoiceDateField = normalizeDateToIso(rawDateField) ?? rawDateField;

  let currencyField = docFields.currency ?? geminiResponse.currency ?? serviceRepairData?.currency ?? legacyCommon.currency ?? 'INR';
  let subtotalField = docFields.subtotal ?? geminiResponse.subtotal ?? legacyCommon.subtotal;
  let taxField = docFields.taxAmount ?? geminiResponse.taxAmount ?? geminiResponse.tax ?? legacyCommon.tax ?? legacyCommon.gst;
  let discountField = docFields.discount ?? geminiResponse.discount ?? legacyCommon.discount;
  let totalField: any =
    docFields.amount ??
    docFields.grandTotal ??
    docFields.premiumAmount ??
    geminiResponse.grandTotal ??
    geminiResponse.total ??
    serviceRepairData?.amountPaid ??
    legacyCommon.totalAmount;

  let paymentMethodField = docFields.paymentMode ?? geminiResponse.paymentMethod ?? legacyCommon.paymentMethod;
  let serialField = docFields.serialNumber ?? geminiResponse.serialNumber ?? legacyCategorySpecific.serialNumber;
  let modelField = docFields.model ?? docFields.vehicleModel ?? geminiResponse.modelNumber ?? legacyCategorySpecific.modelNumber ?? legacyCategorySpecific.model;
  let warrantyField = docFields.terms ?? geminiResponse.warrantyText ?? legacyCategorySpecific.warrantyPeriod;

  // Run top-level classification and deterministic validation
  const classificationResult = classifyDocument({
    modelClassification: geminiResponse.classification || (geminiResponse.entityType ? { entityType: geminiResponse.entityType, canonicalEntityType: geminiResponse.entityType } : undefined),
    rawText: (geminiResponse as any).rawText,
    documentTitle: (geminiResponse as any).documentTitle || (geminiResponse as any).document?.documentTitle || serviceRepairData?.title,
    documentCategory: catString,
    documentType: rawDocType || serviceRepairData?.serviceType,
    merchantName: typeof merchantField === 'object' && merchantField !== null ? merchantField.value : merchantField,
    issuerName: (geminiResponse as any).issuerName || (geminiResponse as any).issuer || serviceRepairData?.serviceProvider,
    invoiceNumber: typeof invoiceNumberField === 'object' && invoiceNumberField !== null ? invoiceNumberField.value : invoiceNumberField,
    items: geminiResponse.items,
    grandTotal: toNum(totalField),
    fields: docFields,
    status: (geminiResponse as any).status,
  });

  let reconciledDocCategory = canonicalDocCategory;
  let reconciledDocType = canonicalDocType;

  if (classificationResult.topLevelClassification === 'GENERAL_DOCUMENT') {
    switch (classificationResult.documentSubtype) {
      case 'FEE_RECEIPT':
        reconciledDocCategory = 'Fees & Payments';
        reconciledDocType = 'College Fee Receipt';
        break;
      case 'UTILITY_BILL':
        reconciledDocCategory = 'Bills & Utilities';
        reconciledDocType = 'Electricity Bill';
        break;
      case 'VEHICLE_RC':
        reconciledDocCategory = 'Vehicle Documents';
        reconciledDocType = 'RC';
        break;
      case 'VEHICLE_INSURANCE':
        reconciledDocCategory = 'Vehicle Documents';
        reconciledDocType = 'Insurance';
        break;
      case 'PUC':
        reconciledDocCategory = 'Vehicle Documents';
        reconciledDocType = 'PUC';
        break;
      case 'WARRANTY':
      case 'GUARANTEE':
      case 'EXTENDED_WARRANTY':
        reconciledDocCategory = 'Warranty & Guarantee';
        reconciledDocType = classificationResult.documentSubtype === 'GUARANTEE' ? 'Guarantee Certificate' : 'Warranty Certificate';
        break;
      case 'SERVICE_DOCUMENT':
        reconciledDocCategory = 'Other Important Documents';
        reconciledDocType = 'Service Document';
        break;
      case 'PAYMENT_RECEIPT':
        reconciledDocCategory = 'Fees & Payments';
        reconciledDocType = 'Payment Receipt';
        break;
      case 'DELIVERY_DOCUMENT':
      case 'OWNERSHIP_DOCUMENT':
        reconciledDocCategory = 'Ownership & Purchase';
        reconciledDocType = 'Ownership Document';
        break;
      default:
        if (!reconciledDocCategory || reconciledDocCategory === 'Receipts & Invoices') {
          reconciledDocCategory = 'Other Important Documents';
          reconciledDocType = 'Other Important Document';
        }
    }
  } else if (classificationResult.topLevelClassification === 'PURCHASE_ITEM') {
    reconciledDocCategory = 'Receipts & Invoices';
    reconciledDocType = classificationResult.documentSubtype === 'INVOICE' ? 'Invoice' : 'Receipt';
  }

  let primaryItemName: any = null;
  let primaryItemBrand: any = null;
  let primaryItemQty: any = null;
  let primaryItemUnitPrice: any = null;

  if (classificationResult.topLevelClassification === 'GENERAL_DOCUMENT') {
    primaryItemName = null;
    primaryItemBrand = null;
  } else if (classificationResult.topLevelClassification === 'PURCHASE_ITEM') {
    primaryItemName = (geminiResponse as any).documentTitle ?? legacyCommon.productName;
    primaryItemBrand = legacyCommon.brand;

    if (Array.isArray(geminiResponse.items) && geminiResponse.items.length > 0) {
      const firstItem = geminiResponse.items[0];
      if ('name' in firstItem && (firstItem as any).name) {
        primaryItemName = (firstItem as any).name;
      } else if ('productName' in firstItem && (firstItem as any).productName) {
        primaryItemName = (firstItem as any).productName;
      }
      if ('brand' in firstItem && (firstItem as any).brand) {
        primaryItemBrand = (firstItem as any).brand;
      }
      if ('quantity' in firstItem && (firstItem as any).quantity) {
        primaryItemQty = (firstItem as any).quantity;
      }
      if ('unitPrice' in firstItem && (firstItem as any).unitPrice) {
        primaryItemUnitPrice = (firstItem as any).unitPrice;
      }
    }
  }

  // Determine canonical category:
  // Non-receipt document categories are always Documents.
  // Purchase receipts classify based on product name/brand/model using detectCategoryAndProductType.
  let canonical: CanonicalCategory = 'Other';
  let detectedProductType: string | null = null;

  if (classificationResult.topLevelClassification === 'GENERAL_DOCUMENT') {
    canonical = 'Documents';
  } else {
    const candidateName = primaryItemName || docFields.productName || (geminiResponse as any).documentTitle || legacyCommon.productName || '';
    const candidateBrand = primaryItemBrand || docFields.brand || legacyCommon.brand || '';
    const candidateModel = modelField || docFields.model || '';
    const candidateMerchant = merchantField || '';
    const candidateRawText = (geminiResponse as any).rawText || '';

    const detected = detectCategoryAndProductType({
      name: candidateName,
      brand: candidateBrand,
      model: candidateModel,
      merchant: candidateMerchant,
      rawText: candidateRawText,
    });

    if (detected.categoryId && detected.confidence !== 'low') {
      const canonicalName = getCategoryNameFromId(detected.categoryId);
      canonical = normalizeToCanonicalCategory(canonicalName);
      detectedProductType = detected.productType;
    } else {
      canonical = normalizeToCanonicalCategory(
        candidateName || candidateBrand || catString
      );
    }
  }

  const scannerCat = canonicalToScannerCode(canonical);

  const gstRateField = geminiResponse.taxRate ?? geminiResponse.gstRate;
  const cgstField = geminiResponse.cgst;
  const sgstField = geminiResponse.sgst;
  const igstField = geminiResponse.igst;

  const common: CommonReceiptInfo = {
    productName: buildFieldValue<string | null>(primaryItemName, 0.95),
    category: buildFieldValue<ScannerCategory>(scannerCat, 0.95),
    brand: buildFieldValue<string | null>(primaryItemBrand, 0.92),
    merchant: buildFieldValue<string | null>(merchantField, 0.95),
    merchantAddress: buildFieldValue<string | null>(merchantAddressField, 0.85),
    merchantPhone: buildFieldValue<string | null>(merchantPhoneField, 0.85),
    gstin: buildFieldValue<string | null>(gstinField, 0.90, true),
    purchaseDate: buildFieldValue<string | null>(invoiceDateField, 0.95),
    invoiceNumber: buildFieldValue<string | null>(invoiceNumberField, 0.95, true),
    quantity: buildFieldValue<number | null>(toNum(primaryItemQty) ?? toNum(legacyCommon.quantity) ?? 1, 0.95),
    unitPrice: buildFieldValue<number | null>(toNum(primaryItemUnitPrice) ?? toNum(subtotalField) ?? toNum(totalField), 0.95),
    subtotal: buildFieldValue<number | null>(toNum(subtotalField), 0.95),
    discount: buildFieldValue<number | null>(toNum(discountField), 0.95),
    taxGst: buildFieldValue<number | null>(toNum(taxField), 0.92),
    gstRate: buildFieldValue<string | null>(gstRateField ? String(gstRateField) : null, 0.90),
    cgst: buildFieldValue<number | null>(toNum(cgstField), 0.90),
    sgst: buildFieldValue<number | null>(toNum(sgstField), 0.90),
    igst: buildFieldValue<number | null>(toNum(igstField), 0.90),
    finalAmount: buildFieldValue<number | null>(toNum(totalField), 0.98),
    currency: buildFieldValue<string | null>(currencyField, 0.99),
    paymentMethod: buildFieldValue<string | null>(paymentMethodField, 0.90),
    storeLocation: buildFieldValue<string | null>(merchantAddressField, 0.85),
    notes: buildFieldValue<string | null>(legacyCommon.notes ?? null, 0.80),
    serialNumber: buildFieldValue<string | null>(serialField, 0.70, true),
    modelNumber: buildFieldValue<string | null>(modelField, 0.85),
    warrantyText: buildFieldValue<string | null>(warrantyField, 0.85),
  };

  validateNumericalRelationships(common, geminiResponse.items);

  const categoryDetails: ExtractedReceiptData['categoryDetails'] = {};

  let explicitWarrantyMonths: number | null = null;
  const warrantyVal = common.warrantyText?.value;
  if (typeof warrantyVal === 'string' && warrantyVal.length > 0) {
    const yrMatch = warrantyVal.match(/(\d+)\s*(?:year|yr)/i);
    const moMatch = warrantyVal.match(/(\d+)\s*(?:month|mo)/i);
    if (yrMatch) explicitWarrantyMonths = parseInt(yrMatch[1], 10) * 12;
    else if (moMatch) explicitWarrantyMonths = parseInt(moMatch[1], 10);
  }

  switch (canonical) {
    case 'Mobile & Laptop': {
      categoryDetails.mobile_laptop = {
        brand: buildFieldValue<string>(common.brand.value, common.brand.confidenceScore),
        deviceName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        model: buildFieldValue<string>(toStr(modelField), 0.85),
        serialNumber: buildFieldValue<string>(toStr(serialField), 0.70, true),
        imei: buildFieldValue<string>(toStr(legacyCategorySpecific.imei), 0.70, true),
        imei2: legacyCategorySpecific.imei2 ? buildFieldValue<string>(toStr(legacyCategorySpecific.imei2), 0.70, true) : undefined,
        storage: buildFieldValue<string>(toStr(legacyCategorySpecific.storage), 0.85),
        ram: buildFieldValue<string>(toStr(legacyCategorySpecific.ram), 0.85),
        processor: legacyCategorySpecific.processor ? buildFieldValue<string>(toStr(legacyCategorySpecific.processor), 0.85) : undefined,
        gpu: legacyCategorySpecific.gpu ? buildFieldValue<string>(toStr(legacyCategorySpecific.gpu), 0.85) : undefined,
        color: buildFieldValue<string>(toStr(legacyCategorySpecific.color), 0.85),
        purchaseDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        purchasePrice: buildFieldValue<number>(common.finalAmount.value, common.finalAmount.confidenceScore),
        seller: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        invoiceNumber: buildFieldValue<string>(common.invoiceNumber.value, common.invoiceNumber.confidenceScore),
        warrantyPeriod: common.warrantyText?.value ? buildFieldValue<string>(common.warrantyText.value, 0.90) : undefined,
        warrantyExpiry: buildFieldValue<string>(toStr(legacyCategorySpecific.warrantyExpiry), 0.80),
        warrantyDurationMonths: buildFieldValue<number>(explicitWarrantyMonths, explicitWarrantyMonths ? 0.90 : 0.0),
        accessories: buildFieldValue<string>(toStr(legacyCategorySpecific.accessories), 0.80),
        condition: buildFieldValue<string>(toStr(legacyCategorySpecific.condition), 0.50),
      };
      break;
    }

    case 'Electronics': {
      categoryDetails.electronics = {
        brand: buildFieldValue<string>(common.brand.value, common.brand.confidenceScore),
        productName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        model: buildFieldValue<string>(toStr(modelField), 0.85),
        serialNumber: buildFieldValue<string>(toStr(serialField), 0.70, true),
        purchaseDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        purchasePrice: buildFieldValue<number>(common.finalAmount.value, common.finalAmount.confidenceScore),
        seller: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        invoiceNumber: buildFieldValue<string>(common.invoiceNumber.value, common.invoiceNumber.confidenceScore),
        warrantyPeriod: common.warrantyText?.value ? buildFieldValue<string>(common.warrantyText.value, 0.90) : undefined,
        warrantyExpiry: buildFieldValue<string>(toStr(legacyCategorySpecific.warrantyExpiry), 0.80),
        warrantyDurationMonths: buildFieldValue<number>(explicitWarrantyMonths, explicitWarrantyMonths ? 0.90 : 0.0),
        accessories: legacyCategorySpecific.accessories ? buildFieldValue<string>(toStr(legacyCategorySpecific.accessories), 0.80) : undefined,
        condition: buildFieldValue<string>(toStr(legacyCategorySpecific.condition), 0.50),
      };
      break;
    }

    case 'Vehicle': {
      categoryDetails.vehicle = {
        brand: buildFieldValue<string>(common.brand.value, common.brand.confidenceScore),
        vehicleName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        variant: buildFieldValue<string>(toStr(legacyCategorySpecific.variant), 0.85),
        registrationNumber: buildFieldValue<string>(toStr(legacyCategorySpecific.registrationNumber), 0.70, true),
        vin: buildFieldValue<string>(toStr(legacyCategorySpecific.vin ?? legacyCategorySpecific.chassisNumber), 0.70, true),
        engineNumber: buildFieldValue<string>(toStr(legacyCategorySpecific.engineNumber), 0.70, true),
        purchaseDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        purchasePrice: buildFieldValue<number>(common.finalAmount.value, common.finalAmount.confidenceScore),
        dealer: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        invoiceNumber: buildFieldValue<string>(common.invoiceNumber.value, common.invoiceNumber.confidenceScore),
        warrantyPeriod: common.warrantyText?.value ? buildFieldValue<string>(common.warrantyText.value, 0.90) : undefined,
        warrantyExpiry: buildFieldValue<string>(toStr(legacyCategorySpecific.warrantyExpiry), 0.80),
        insuranceExpiry: buildFieldValue<string>(toStr(legacyCategorySpecific.insuranceExpiry), 0.80),
        odometerReading: buildFieldValue<string>(toStr(legacyCategorySpecific.odometerReading), 0.80),
        serviceDueDate: buildFieldValue<string>(toStr(legacyCategorySpecific.serviceDueDate), 0.80),
      };
      break;
    }

    case 'Home & Appliances':
    case 'Home Appliance': {
      categoryDetails.home_appliance = {
        brand: buildFieldValue<string>(common.brand.value, common.brand.confidenceScore),
        productName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        modelNumber: buildFieldValue<string>(toStr(modelField), 0.85),
        serialNumber: buildFieldValue<string>(toStr(serialField), 0.70, true),
        purchaseDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        purchasePrice: buildFieldValue<number>(common.finalAmount.value, common.finalAmount.confidenceScore),
        seller: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        invoiceNumber: buildFieldValue<string>(common.invoiceNumber.value, common.invoiceNumber.confidenceScore),
        warrantyPeriod: common.warrantyText?.value ? buildFieldValue<string>(common.warrantyText.value, 0.90) : undefined,
        warrantyExpiry: buildFieldValue<string>(toStr(legacyCategorySpecific.warrantyExpiry), 0.80),
        warrantyDurationMonths: buildFieldValue<number>(explicitWarrantyMonths, explicitWarrantyMonths ? 0.90 : 0.0),
        installationDate: buildFieldValue<string>(toStr(legacyCategorySpecific.installationDate), 0.80),
        serviceDueDate: buildFieldValue<string>(toStr(legacyCategorySpecific.serviceDueDate), 0.80),
        condition: buildFieldValue<string>(toStr(legacyCategorySpecific.condition), 0.50),
      };
      break;
    }

    case 'Furniture': {
      categoryDetails.furniture = {
        itemName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        brand: buildFieldValue<string>(common.brand.value, common.brand.confidenceScore),
        seller: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        material: buildFieldValue<string>(toStr(legacyCategorySpecific.material), 0.80),
        color: buildFieldValue<string>(toStr(legacyCategorySpecific.color), 0.80),
        dimensions: buildFieldValue<string>(toStr(legacyCategorySpecific.dimensions), 0.75, true),
        room: buildFieldValue<string>(toStr(legacyCategorySpecific.room), 0.75),
        purchaseDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        purchasePrice: buildFieldValue<number>(common.finalAmount.value, common.finalAmount.confidenceScore),
        invoiceNumber: buildFieldValue<string>(common.invoiceNumber.value, common.invoiceNumber.confidenceScore),
        warrantyPeriod: common.warrantyText?.value ? buildFieldValue<string>(common.warrantyText.value, 0.90) : undefined,
        warrantyExpiry: buildFieldValue<string>(toStr(legacyCategorySpecific.warrantyExpiry), 0.80),
        warrantyDurationMonths: buildFieldValue<number>(explicitWarrantyMonths, explicitWarrantyMonths ? 0.90 : 0.0),
        condition: buildFieldValue<string>(toStr(legacyCategorySpecific.condition), 0.50),
      };
      break;
    }

    case 'Fashion': {
      categoryDetails.fashion = {
        brand: buildFieldValue<string>(common.brand.value, common.brand.confidenceScore),
        itemName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        itemType: buildFieldValue<string>(toStr(legacyCategorySpecific.itemType), 0.80),
        size: buildFieldValue<string>(toStr(legacyCategorySpecific.size), 0.75, true),
        color: buildFieldValue<string>(toStr(legacyCategorySpecific.color), 0.80),
        purchaseDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        purchasePrice: buildFieldValue<number>(common.finalAmount.value, common.finalAmount.confidenceScore),
        store: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        invoiceNumber: buildFieldValue<string>(common.invoiceNumber.value, common.invoiceNumber.confidenceScore),
        returnUntil: buildFieldValue<string>(toStr(legacyCategorySpecific.returnUntil), 0.80),
        warrantyPeriod: common.warrantyText?.value ? buildFieldValue<string>(common.warrantyText.value, 0.90) : undefined,
        condition: buildFieldValue<string>(toStr(legacyCategorySpecific.condition), 0.50),
      };
      break;
    }

    case 'Sports & Fitness': {
      categoryDetails.sports = {
        itemName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        brand: buildFieldValue<string>(common.brand.value, common.brand.confidenceScore),
        productType: buildFieldValue<string>(detectedProductType || toStr(legacyCategorySpecific.productType), 0.80),
        purchaseDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        purchasePrice: buildFieldValue<number>(common.finalAmount.value, common.finalAmount.confidenceScore),
        seller: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        invoiceNumber: buildFieldValue<string>(common.invoiceNumber.value, common.invoiceNumber.confidenceScore),
        warrantyPeriod: common.warrantyText?.value ? buildFieldValue<string>(common.warrantyText.value, 0.90) : undefined,
        warrantyExpiry: buildFieldValue<string>(toStr(legacyCategorySpecific.warrantyExpiry), 0.80),
        returnUntil: buildFieldValue<string>(toStr(legacyCategorySpecific.returnUntil), 0.80),
        notes: buildFieldValue<string>(common.notes.value, 0.80),
        condition: buildFieldValue<string>(toStr(legacyCategorySpecific.condition), 0.50),
      };
      break;
    }

    case 'Beauty & Personal Care': {
      categoryDetails.beauty = {
        itemName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        brand: buildFieldValue<string>(common.brand.value, common.brand.confidenceScore),
        productType: buildFieldValue<string>(detectedProductType || toStr(legacyCategorySpecific.productType), 0.80),
        purchaseDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        purchasePrice: buildFieldValue<number>(common.finalAmount.value, common.finalAmount.confidenceScore),
        seller: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        invoiceNumber: buildFieldValue<string>(common.invoiceNumber.value, common.invoiceNumber.confidenceScore),
        returnUntil: buildFieldValue<string>(toStr(legacyCategorySpecific.returnUntil), 0.80),
        notes: buildFieldValue<string>(common.notes.value, 0.80),
      };
      break;
    }

    case 'Documents': {
      categoryDetails.documents = {
        documentName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        documentType: buildFieldValue<string>(toStr(legacyCategorySpecific.documentType), 0.80),
        issuer: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        documentNumber: buildFieldValue<string>(common.invoiceNumber.value, common.invoiceNumber.confidenceScore, true),
        issueDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        expiryDate: buildFieldValue<string>(toStr(legacyCategorySpecific.expiryDate), 0.80),
        associatedItem: buildFieldValue<string>(toStr(legacyCategorySpecific.associatedItem), 0.80),
        notes: buildFieldValue<string>(common.notes.value, 0.80),
      };
      break;
    }

    default: {
      categoryDetails.other = {
        itemName: buildFieldValue<string>(common.productName.value, common.productName.confidenceScore),
        brand: buildFieldValue<string>(common.brand.value, common.brand.confidenceScore),
        categoryDescription: buildFieldValue<string>(toStr(legacyCategorySpecific.categoryDescription), 0.80),
        purchasePrice: buildFieldValue<number>(common.finalAmount.value, common.finalAmount.confidenceScore),
        purchaseDate: buildFieldValue<string>(common.purchaseDate.value, common.purchaseDate.confidenceScore),
        seller: buildFieldValue<string>(common.merchant.value, common.merchant.confidenceScore),
        notes: buildFieldValue<string>(common.notes.value, 0.80),
      };
      break;
    }
  }

  const parsedItems: ReceiptMultiItem[] = [];
  if (classificationResult.topLevelClassification === 'PURCHASE_ITEM') {
    const rawItems = Array.isArray(geminiResponse.items) && geminiResponse.items.length > 0
      ? geminiResponse.items
      : (Array.isArray(docFields.items) && docFields.items.length > 0 ? docFields.items : []);
    if (rawItems.length > 0) {
      rawItems.forEach((item: any, idx: number) => {
        const name = typeof item.name === 'object' && item.name !== null ? item.name.value : (item.name || item.productName || null);
        // Requirement 10 & 11: Distinguish PHYSICAL PURCHASED PRODUCT from NON-PRODUCT CHARGE
        // (shipping, delivery fee, convenience fee, service charge, installation, tax, discount, coupon, etc.)
        if (isNonProductCharge(name)) {
          return;
        }

        const qtyRaw = typeof item.quantity === 'object' && item.quantity !== null ? item.quantity.value : (item.quantity ?? 1);
        const quantity = Math.max(1, Number(qtyRaw) || 1);

        const totalPriceRaw = typeof item.totalPrice === 'object' && item.totalPrice !== null
          ? item.totalPrice.value
          : (item.totalPrice ?? item.price ?? null);
        const unitPriceRaw = typeof item.unitPrice === 'object' && item.unitPrice !== null
          ? item.unitPrice.value
          : (item.unitPrice ?? null);

        let lineTotal = totalPriceRaw !== null && totalPriceRaw !== undefined ? Number(totalPriceRaw) : null;
        let unitPrice = unitPriceRaw !== null && unitPriceRaw !== undefined ? Number(unitPriceRaw) : null;

        if (lineTotal !== null && (unitPrice === null || unitPrice === 0)) {
          unitPrice = lineTotal / quantity;
        } else if (unitPrice !== null && (lineTotal === null || lineTotal === 0)) {
          lineTotal = unitPrice * quantity;
        } else if (lineTotal === null && unitPrice === null) {
          lineTotal = 0;
          unitPrice = 0;
        }

        const brand = typeof item.brand === 'object' && item.brand !== null ? item.brand.value : (item.brand || undefined);
        const model = typeof item.model === 'object' && item.model !== null ? item.model.value : (item.model || undefined);
        const serialNumber = typeof item.serialNumber === 'object' && item.serialNumber !== null ? item.serialNumber.value : (item.serialNumber || undefined);

        const detection = detectCategoryAndProductType({
          name,
          brand,
          model,
          merchant: common.merchant.value,
          rawText: typeof item.description === 'string' ? item.description : undefined,
        });

        const rawCatFromItem = typeof item.category === 'object' && item.category !== null ? item.category.value : item.category;
        const detectedCatId: string = detection.categoryId || (rawCatFromItem ? getCategoryIdFromName(rawCatFromItem) : getCategoryIdFromName(canonical)) || 'other';
        const detectedCatName: string = getCategoryNameFromId(detectedCatId);
        const rawProductType = typeof item.productType === 'object' && item.productType !== null ? item.productType.value : item.productType;
        const detectedProductType: string | undefined = detection.productType || rawProductType || undefined;

        const rawReturn = item.returnDate ?? item.returnUntil;
        const returnUntil = rawReturn ? normalizeDateToIso(rawReturn) || String(rawReturn) : undefined;
        const rawWarranty = item.warrantyUntil ?? item.warrantyExpiry ?? item.warrantyDate ?? item.warrantyText;
        let warrantyUntil = rawWarranty ? normalizeDateToIso(rawWarranty) || String(rawWarranty) : undefined;
        if (isNoWarrantyCategory(detectedCatId, detectedCatName, detectedProductType)) {
          warrantyUntil = undefined;
        }
        const warrantyProvider = item.warrantyProvider || undefined;

        parsedItems.push({
          id: `item-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`,
          productName: name || `Item ${idx + 1}`,
          category: detectedCatName,
          categoryId: detectedCatId,
          productType: detectedProductType,
          categoryConfidence: detection.confidence,
          brand,
          model,
          serialNumber,
          quantity,
          unitPrice: unitPrice || undefined,
          subtotal: toNum(item.lineSubtotal ?? item.subtotal) ?? undefined,
          discount: toNum(item.lineDiscount ?? item.discount) ?? undefined,
          gstin: common.gstin?.value || undefined,
          price: lineTotal ?? 0,
          returnUntil,
          warrantyUntil,
          warrantyProvider,
          selected: true,
        });
      });
    } else if (common.productName.value) {
      const qty = Math.max(1, Number(common.quantity.value) || 1);
      const lineTotal = Number(common.finalAmount.value) || 0;
      const unitPrice = lineTotal / qty;

      const detection = detectCategoryAndProductType({
        name: common.productName.value,
        brand: common.brand.value,
        merchant: common.merchant.value,
      });

      const detectedCatId = detection.categoryId || getCategoryIdFromName(canonical) || 'other';
      const detectedCatName = getCategoryNameFromId(detectedCatId);

      parsedItems.push({
        id: `item-${Date.now()}-0`,
        productName: common.productName.value,
        category: detectedCatName,
        categoryId: detectedCatId,
        productType: detection.productType || undefined,
        categoryConfidence: detection.confidence,
        brand: common.brand.value || undefined,
        quantity: qty,
        unitPrice: qty > 1 ? unitPrice : undefined,
        subtotal: common.subtotal?.value ?? undefined,
        discount: common.discount?.value ?? undefined,
        gstin: common.gstin?.value ?? undefined,
        price: lineTotal,
        selected: true,
      });
    }
  }

  // Semantically distinct dates: Expiry Date vs Payment Due Date
  const rawExpiryDate =
    docFields.expiryDate ??
    docFields.policyExpiryDate ??
    docFields.warrantyEndDate ??
    docFields.guaranteeEndDate ??
    classificationResult.document?.expiryDate ??
    (reconciledDocCategory !== 'Bills & Utilities' ? (geminiResponse as any).expiryDate : null);
  const normalizedExpiryDate = rawExpiryDate ? normalizeDateToIso(rawExpiryDate) || String(rawExpiryDate) : null;

  const rawDueDate =
    docFields.dueDate ??
    docFields.paymentDueDate ??
    docFields.billDueDate ??
    classificationResult.document?.dueDate ??
    (geminiResponse as any).dueDate ??
    (reconciledDocCategory === 'Bills & Utilities' ? (geminiResponse as any).expiryDate : null);
  const normalizedDueDate = rawDueDate ? normalizeDateToIso(rawDueDate) || String(rawDueDate) : null;

  const isService = classificationResult.canonicalEntityType === 'SERVICE_REPAIR';
  const isActualReceipt = !isService && classificationResult.canonicalEntityType === 'PURCHASED_ITEM';
  const isDoc = !isService && !isActualReceipt;

  const entityType: CanonicalVaultEntityType = classificationResult.canonicalEntityType ||
    (isActualReceipt ? 'PURCHASED_ITEM' : (isService ? 'SERVICE_REPAIR' : 'DOCUMENT'));

  const derivedIssuer = typeof merchantField === 'object' && merchantField !== null ? merchantField.value : merchantField;

  const rawService = geminiResponse.serviceRepair || (geminiResponse as any).service;
  const rawServiceTitle = rawService?.title || (geminiResponse as any).documentTitle;

  const docTitle: string | null =
    (geminiResponse as any).document?.documentTitle ||
    (geminiResponse as any).documentTitle ||
    (isService ? (rawServiceTitle || `Service - ${derivedIssuer || 'Provider'}`) : null) ||
    (reconciledDocType ? `${reconciledDocType}${derivedIssuer ? ` - ${derivedIssuer}` : ''}` : null);

  const serviceRepairContract: ExtractedServiceRepair | undefined = (isService || rawService) ? {
    serviceDate: normalizeDateToIso(rawService?.serviceDate) || rawService?.serviceDate || invoiceDateField || null,
    serviceType: rawService?.serviceType || 'Repair',
    title: rawService?.title || docTitle || 'Service & Repair Record',
    problemDescription: rawService?.problemDescription || null,
    workPerformed: rawService?.workPerformed || null,
    partsReplaced: rawService?.partsReplaced || null,
    technicianNotes: rawService?.technicianNotes || null,
    serviceProvider: rawService?.serviceProvider || derivedIssuer || null,
    serviceProviderAddress: rawService?.serviceProviderAddress || (typeof merchantAddressField === 'object' && merchantAddressField !== null ? merchantAddressField.value : merchantAddressField) || null,
    serviceProviderPhone: rawService?.serviceProviderPhone || null,
    warrantyCovered: typeof rawService?.warrantyCovered === 'boolean' ? rawService.warrantyCovered : null,
    coverageType: rawService?.coverageType || null,
    coverageReferenceNumber: rawService?.coverageReferenceNumber || null,
    amountPaid: toNum(rawService?.amountPaid) ?? toNum(totalField) ?? null,
    currency: rawService?.currency || currencyField || 'INR',
    postServiceWarranty: typeof rawService?.postServiceWarranty === 'boolean' ? rawService.postServiceWarranty : null,
    postServiceWarrantyUntil: normalizeDateToIso(rawService?.postServiceWarrantyUntil) || rawService?.postServiceWarrantyUntil || null,
    postServiceGuarantee: typeof rawService?.postServiceGuarantee === 'boolean' ? rawService.postServiceGuarantee : null,
    postServiceGuaranteeUntil: normalizeDateToIso(rawService?.postServiceGuaranteeUntil) || rawService?.postServiceGuaranteeUntil || null,
    relatedItemCandidates: Array.isArray(rawService?.relatedItemCandidates) ? rawService.relatedItemCandidates : [],
    supportingDocumentCandidates: Array.isArray(rawService?.supportingDocumentCandidates) ? rawService.supportingDocumentCandidates : [],
  } : undefined;

  const canonicalProducts = parsedItems.map((pi) => ({
    id: pi.id,
    name: pi.productName,
    category: pi.category,
    brand: pi.brand,
    model: pi.model,
    serialNumber: pi.serialNumber,
    quantity: pi.quantity,
    unitPrice: pi.unitPrice,
    lineTotal: pi.price,
    warrantyUntil: pi.warrantyUntil || null,
    returnUntil: pi.returnUntil || null,
    productPhotos: pi.productPhotos || [],
  }));

  const purchaseContract = isActualReceipt ? {
    purchaseDate: invoiceDateField || null,
    merchantName: derivedIssuer || null,
    merchantAddress: (typeof merchantAddressField === 'object' && merchantAddressField !== null ? merchantAddressField.value : merchantAddressField) || null,
    invoiceNumber: (typeof invoiceNumberField === 'object' && invoiceNumberField !== null ? invoiceNumberField.value : invoiceNumberField) || null,
    subtotal: toNum(subtotalField) ?? null,
    discount: toNum(discountField) ?? null,
    taxAmount: toNum(taxField) ?? null,
    grandTotal: toNum(totalField) ?? null,
    products: canonicalProducts,
  } : undefined;

  return {
    id: `receipt-${Date.now()}`,
    receiptUri,
    receiptImageName: fileName || 'Receipt-Scanned.jpg',
    scannedAt: new Date().toISOString(),
    entityType,
    isReceipt: isActualReceipt,
    isDocument: isDoc,
    isServiceRepair: isService,
    classification: classificationResult,
    documentCategory: reconciledDocCategory || null,
    documentType: reconciledDocType || null,
    documentTitle: docTitle,
    issuerName: derivedIssuer || null,
    referenceNumber: typeof invoiceNumberField === 'object' && invoiceNumberField !== null ? invoiceNumberField.value : invoiceNumberField || null,
    documentDate: invoiceDateField || null,
    expiryDate: normalizedExpiryDate,
    dueDate: normalizedDueDate,
    receiptConfidence: classificationResult.confidence,
    common,
    category: scannerCat,
    categoryDetails,
    items: parsedItems,
    purchase: purchaseContract,
    serviceRepair: serviceRepairContract,
    rawConfidenceScore: Math.round(classificationResult.confidence * 100),
    overallQuality: classificationResult.confidence >= 0.85 ? 'excellent' : 'good',
    provider: 'gemini',
  };
}

/**
 * Recalculates category fields when the user changes category manually in Review & Edit
 */
export function recalculateCategoryFields(
  currentData: ExtractedReceiptData,
  newCanonical: CanonicalCategory
): ExtractedReceiptData {
  const newScannerCode = canonicalToScannerCode(newCanonical);
  const common = currentData.common;

  const updatedData: ExtractedReceiptData = {
    ...currentData,
    category: newScannerCode,
    common: {
      ...common,
      category: buildFieldValue<ScannerCategory>(newScannerCode, 1.0),
    },
    categoryDetails: {},
  };

  const name = common.productName.value;
  const brand = common.brand.value;
  const price = common.finalAmount.value;
  const store = common.merchant.value;
  const date = common.purchaseDate.value;
  const invoice = common.invoiceNumber.value;

  switch (newCanonical) {
    case 'Mobile & Laptop':
      updatedData.categoryDetails.mobile_laptop = {
        brand: buildFieldValue<string>(brand, 0.95),
        deviceName: buildFieldValue<string>(name, 0.95),
        model: buildFieldValue<string>(null, 0.0),
        serialNumber: buildFieldValue<string>(null, 0.0, true),
        imei: buildFieldValue<string>(null, 0.0, true),
        storage: buildFieldValue<string>(null, 0.0),
        ram: buildFieldValue<string>(null, 0.0),
        color: buildFieldValue<string>(null, 0.0),
        purchaseDate: buildFieldValue<string>(date, 0.95),
        purchasePrice: buildFieldValue<number>(price, 0.95),
        seller: buildFieldValue<string>(store, 0.95),
        invoiceNumber: buildFieldValue<string>(invoice, 0.95),
        warrantyExpiry: buildFieldValue<string>(null, 0.0),
        warrantyDurationMonths: buildFieldValue<number>(null, 0.0),
        accessories: buildFieldValue<string>(null, 0.0),
        condition: buildFieldValue<string>(null, 0.0),
      };
      break;

    case 'Electronics':
      updatedData.categoryDetails.electronics = {
        brand: buildFieldValue<string>(brand, 0.95),
        productName: buildFieldValue<string>(name, 0.95),
        model: buildFieldValue<string>(null, 0.0),
        serialNumber: buildFieldValue<string>(null, 0.0, true),
        purchaseDate: buildFieldValue<string>(date, 0.95),
        purchasePrice: buildFieldValue<number>(price, 0.95),
        seller: buildFieldValue<string>(store, 0.95),
        invoiceNumber: buildFieldValue<string>(invoice, 0.95),
        warrantyExpiry: buildFieldValue<string>(null, 0.0),
        warrantyDurationMonths: buildFieldValue<number>(null, 0.0),
        condition: buildFieldValue<string>(null, 0.0),
      };
      break;

    case 'Vehicle':
      updatedData.categoryDetails.vehicle = {
        brand: buildFieldValue<string>(brand, 0.95),
        vehicleName: buildFieldValue<string>(name, 0.95),
        variant: buildFieldValue<string>(null, 0.0),
        registrationNumber: buildFieldValue<string>(null, 0.0, true),
        vin: buildFieldValue<string>(null, 0.0, true),
        engineNumber: buildFieldValue<string>(null, 0.0, true),
        purchaseDate: buildFieldValue<string>(date, 0.95),
        purchasePrice: buildFieldValue<number>(price, 0.95),
        dealer: buildFieldValue<string>(store, 0.95),
        invoiceNumber: buildFieldValue<string>(invoice, 0.95),
        warrantyExpiry: buildFieldValue<string>(null, 0.0),
        insuranceExpiry: buildFieldValue<string>(null, 0.0),
        odometerReading: buildFieldValue<string>(null, 0.0),
        serviceDueDate: buildFieldValue<string>(null, 0.0),
      };
      break;

    case 'Home & Appliances':
    case 'Home Appliance':
      updatedData.categoryDetails.home_appliance = {
        brand: buildFieldValue<string>(brand, 0.95),
        productName: buildFieldValue<string>(name, 0.95),
        modelNumber: buildFieldValue<string>(null, 0.0),
        serialNumber: buildFieldValue<string>(null, 0.0, true),
        purchaseDate: buildFieldValue<string>(date, 0.95),
        purchasePrice: buildFieldValue<number>(price, 0.95),
        seller: buildFieldValue<string>(store, 0.95),
        invoiceNumber: buildFieldValue<string>(invoice, 0.95),
        warrantyExpiry: buildFieldValue<string>(null, 0.0),
        warrantyDurationMonths: buildFieldValue<number>(null, 0.0),
        installationDate: buildFieldValue<string>(null, 0.0),
        serviceDueDate: buildFieldValue<string>(null, 0.0),
        condition: buildFieldValue<string>(null, 0.0),
      };
      break;

    case 'Furniture':
      updatedData.categoryDetails.furniture = {
        itemName: buildFieldValue<string>(name, 0.95),
        brand: buildFieldValue<string>(brand, 0.9),
        seller: buildFieldValue<string>(store, 0.95),
        material: buildFieldValue<string>(null, 0.0),
        color: buildFieldValue<string>(null, 0.0),
        dimensions: buildFieldValue<string>(null, 0.0, true),
        room: buildFieldValue<string>(null, 0.0),
        purchaseDate: buildFieldValue<string>(date, 0.95),
        purchasePrice: buildFieldValue<number>(price, 0.95),
        invoiceNumber: buildFieldValue<string>(invoice, 0.95),
        warrantyExpiry: buildFieldValue<string>(null, 0.0),
        warrantyDurationMonths: buildFieldValue<number>(null, 0.0),
        condition: buildFieldValue<string>(null, 0.0),
      };
      break;

    case 'Fashion':
      updatedData.categoryDetails.fashion = {
        brand: buildFieldValue<string>(brand, 0.95),
        itemName: buildFieldValue<string>(name, 0.95),
        itemType: buildFieldValue<string>(null, 0.0),
        size: buildFieldValue<string>(null, 0.0, true),
        color: buildFieldValue<string>(null, 0.0),
        purchaseDate: buildFieldValue<string>(date, 0.95),
        purchasePrice: buildFieldValue<number>(price, 0.95),
        store: buildFieldValue<string>(store, 0.95),
        invoiceNumber: buildFieldValue<string>(invoice, 0.95),
        returnUntil: buildFieldValue<string>(null, 0.0),
        condition: buildFieldValue<string>(null, 0.0),
      };
      break;

    case 'Sports & Fitness':
      updatedData.categoryDetails.sports = {
        itemName: buildFieldValue<string>(name, 0.95),
        brand: buildFieldValue<string>(brand, 0.95),
        productType: buildFieldValue<string>(null, 0.0),
        purchaseDate: buildFieldValue<string>(date, 0.95),
        purchasePrice: buildFieldValue<number>(price, 0.95),
        seller: buildFieldValue<string>(store, 0.95),
        invoiceNumber: buildFieldValue<string>(invoice, 0.95),
        warrantyExpiry: buildFieldValue<string>(null, 0.0),
        returnUntil: buildFieldValue<string>(null, 0.0),
        notes: buildFieldValue<string>(null, 0.0),
        condition: buildFieldValue<string>(null, 0.0),
      };
      break;

    case 'Beauty & Personal Care':
      updatedData.categoryDetails.beauty = {
        itemName: buildFieldValue<string>(name, 0.95),
        brand: buildFieldValue<string>(brand, 0.95),
        productType: buildFieldValue<string>(null, 0.0),
        purchaseDate: buildFieldValue<string>(date, 0.95),
        purchasePrice: buildFieldValue<number>(price, 0.95),
        seller: buildFieldValue<string>(store, 0.95),
        invoiceNumber: buildFieldValue<string>(invoice, 0.95),
        returnUntil: buildFieldValue<string>(null, 0.0),
        notes: buildFieldValue<string>(null, 0.0),
      };
      break;

    case 'Documents':
      updatedData.categoryDetails.documents = {
        documentName: buildFieldValue<string>(name, 0.95),
        documentType: buildFieldValue<string>(null, 0.0),
        issuer: buildFieldValue<string>(store, 0.95),
        documentNumber: buildFieldValue<string>(invoice, 0.75, true),
        issueDate: buildFieldValue<string>(date, 0.95),
        expiryDate: buildFieldValue<string>(null, 0.0),
        associatedItem: buildFieldValue<string>(name, 0.85),
        notes: buildFieldValue<string>(null, 0.0),
      };
      break;

    default:
      updatedData.categoryDetails.other = {
        itemName: buildFieldValue<string>(name, 0.95),
        brand: buildFieldValue<string>(brand, 0.9),
        categoryDescription: buildFieldValue<string>(null, 0.0),
        purchasePrice: buildFieldValue<number>(price, 0.95),
        purchaseDate: buildFieldValue<string>(date, 0.95),
        seller: buildFieldValue<string>(store, 0.95),
        notes: buildFieldValue<string>(null, 0.0),
      };
      break;
  }

  return updatedData;
}
