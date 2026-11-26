import { z } from 'zod';

/**
 * Coerce string-encoded empty placeholders ("N/A", "null", "undefined", "") to null.
 */
function sanitizeNullableString(val: unknown): string | null | undefined {
  if (val === undefined || val === null) return val === undefined ? undefined : null;
  if (typeof val !== 'string') return String(val).trim() || null;
  const trimmed = val.trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === 'null' ||
    trimmed.toLowerCase() === 'undefined' ||
    trimmed.toLowerCase() === 'n/a' ||
    trimmed.toLowerCase() === 'na' ||
    trimmed === '-' ||
    trimmed === '--'
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Coerce numeric strings (including commas or currency prefixes) into finite numbers or null.
 * Never fabricates numbers from unparseable values.
 */
function sanitizeNullableNumber(val: unknown): number | null | undefined {
  if (val === undefined || val === null || val === '') return val === undefined ? undefined : null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (
      !trimmed ||
      trimmed.toLowerCase() === 'null' ||
      trimmed.toLowerCase() === 'n/a' ||
      trimmed.toLowerCase() === 'na'
    ) {
      return null;
    }
    const cleaned = trimmed.replace(/[₹$€£,\s]/g, '').replace(/%$/, '');
    if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export const NullableStringSchema = z.preprocess(
  sanitizeNullableString,
  z.string().nullable().optional()
);

export const NullableNumberSchema = z.preprocess(
  sanitizeNullableNumber,
  z.number().finite().nullable().optional()
);

export const ExtractedLineItemZodSchema = z.object({
  name: NullableStringSchema,
  description: NullableStringSchema,
  brand: NullableStringSchema,
  model: NullableStringSchema,
  quantity: NullableNumberSchema,
  unitPrice: NullableNumberSchema,
  lineTotal: NullableNumberSchema,
  taxableAmount: NullableNumberSchema,
  gstPercentage: NullableNumberSchema,
  cgst: NullableNumberSchema,
  sgst: NullableNumberSchema,
  igst: NullableNumberSchema,
  taxAmount: NullableNumberSchema,
  category: NullableStringSchema,
  hsnSac: NullableStringSchema,
  serialNumber: NullableStringSchema,
  warrantyPeriodMonths: NullableNumberSchema,
  pageNumber: NullableNumberSchema,
});

export type ValidatedLineItem = z.infer<typeof ExtractedLineItemZodSchema>;

export const ReceiptExtractionZodSchema = z.object({
  // Store / Merchant Details
  storeName: NullableStringSchema,
  merchantName: NullableStringSchema,
  storeAddress: NullableStringSchema,
  storePhone: NullableStringSchema,
  gstin: NullableStringSchema,

  // Invoice & Purchase Dates (kept strictly distinct)
  invoiceNumber: NullableStringSchema,
  invoiceDate: NullableStringSchema,
  purchaseDate: NullableStringSchema,

  // Primary Item Summary (for single-item or primary line item)
  itemName: NullableStringSchema,
  itemDescription: NullableStringSchema,
  brand: NullableStringSchema,
  model: NullableStringSchema,
  serialNumber: NullableStringSchema,
  quantity: NullableNumberSchema,
  unitPrice: NullableNumberSchema,
  category: NullableStringSchema,
  suggestedCategory: NullableStringSchema,
  warrantyPeriodMonths: NullableNumberSchema,

  // Multi-item list
  items: z.array(ExtractedLineItemZodSchema).optional().default([]),

  // Financials & Tax Breakdown
  subtotal: NullableNumberSchema,
  discount: NullableNumberSchema,
  taxableAmount: NullableNumberSchema,
  gstPercentage: NullableNumberSchema,
  gstRate: NullableNumberSchema,
  cgst: NullableNumberSchema,
  sgst: NullableNumberSchema,
  igst: NullableNumberSchema,
  totalGst: NullableNumberSchema,
  taxAmount: NullableNumberSchema,
  shippingCost: NullableNumberSchema,
  finalAmountPaid: NullableNumberSchema,
  totalAmount: NullableNumberSchema,
  paymentMethod: NullableStringSchema,
  currency: NullableStringSchema,

  // Diagnostics & Provenance
  documentType: NullableStringSchema,
  confidence: NullableNumberSchema,
  notes: NullableStringSchema,
  rawTextSummary: NullableStringSchema,
  pageNumber: NullableNumberSchema,
  isSummaryPage: z.boolean().optional(),
  warnings: z.array(z.string()).optional().default([]),
});

export type ValidatedReceiptExtraction = z.infer<typeof ReceiptExtractionZodSchema>;

export interface ZodReceiptValidationResult {
  success: boolean;
  data: ValidatedReceiptExtraction;
  warnings: string[];
  errors: string[];
}

/**
 * Normalize an ISO-like or common invoice date string to YYYY-MM-DD when unambiguous,
 * otherwise return trimmed string or null.
 */
export function normalizeDateString(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // ISO timestamp e.g. 2026-04-12T10:30:00Z
  const isoPrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoPrefix) return isoPrefix[1];

  // DD/MM/YYYY or DD-MM-YYYY (common in India invoices)
  const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    const year = Number(dmy[3]);
    // Treat as DD/MM unless second > 12 (MM/DD)
    const day = second > 12 ? second : first;
    const month = second > 12 ? first : second;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Fallback native Date parse only when month name is explicit (e.g. "12 Apr 2026")
  if (/[a-zA-Z]{3,}/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      if (y >= 1990 && y <= 2100) {
        return `${y}-${m}-${d}`;
      }
    }
  }

  return trimmed;
}

/**
 * Validate and canonicalize raw receipt extraction JSON using Zod without fabricating missing values.
 */
export function validateExtractedReceiptPayload(raw: unknown): ZodReceiptValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const parsed = ReceiptExtractionZodSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join('.') || 'root'}: ${issue.message}`);
    }
    const empty = ReceiptExtractionZodSchema.parse({});
    return {
      success: false,
      data: empty,
      warnings,
      errors,
    };
  }

  const d = { ...parsed.data };

  // Synchronize semantic aliases without overwriting explicit values
  const resolvedStore = d.storeName ?? d.merchantName ?? null;
  d.storeName = resolvedStore;
  d.merchantName = resolvedStore;

  const resolvedInvoiceDate = normalizeDateString(d.invoiceDate);
  const resolvedPurchaseDate = normalizeDateString(d.purchaseDate);
  d.invoiceDate = resolvedInvoiceDate;
  d.purchaseDate = resolvedPurchaseDate;

  const resolvedGstPct = d.gstPercentage ?? d.gstRate ?? null;
  d.gstPercentage = resolvedGstPct;
  d.gstRate = resolvedGstPct;

  // Compute component GST total only when individual taxes exist and totalGst is absent
  const cgst = d.cgst ?? null;
  const sgst = d.sgst ?? null;
  const igst = d.igst ?? null;
  const hasTaxComponents = cgst !== null || sgst !== null || igst !== null;
  const componentSum = hasTaxComponents
    ? Number(((cgst ?? 0) + (sgst ?? 0) + (igst ?? 0)).toFixed(2))
    : null;

  const resolvedTotalGst = d.totalGst ?? d.taxAmount ?? componentSum ?? null;
  d.totalGst = resolvedTotalGst;
  d.taxAmount = resolvedTotalGst;

  const resolvedFinalAmount = d.finalAmountPaid ?? d.totalAmount ?? null;
  d.finalAmountPaid = resolvedFinalAmount;
  d.totalAmount = resolvedFinalAmount;

  const resolvedCategory = d.suggestedCategory ?? d.category ?? null;
  d.suggestedCategory = resolvedCategory;
  d.category = resolvedCategory;

  // Derive taxableAmount only if both final total and tax exist and subtotal/taxable is missing
  if (d.taxableAmount === null || d.taxableAmount === undefined) {
    if (d.subtotal !== null && d.subtotal !== undefined && d.discount !== null && d.discount !== undefined) {
      const candidate = Number((d.subtotal - d.discount).toFixed(2));
      if (candidate >= 0) {
        d.taxableAmount = candidate;
      }
    } else if (
      resolvedFinalAmount !== null &&
      resolvedTotalGst !== null &&
      resolvedFinalAmount >= resolvedTotalGst
    ) {
      d.taxableAmount = Number((resolvedFinalAmount - resolvedTotalGst).toFixed(2));
    }
  }

  // Primary item fallback from first line item ONLY if primary itemName wasn't set
  const items = Array.isArray(d.items) ? d.items : [];
  if (items.length > 0) {
    const first = items[0];
    if (!d.itemName && first.name) d.itemName = first.name;
    if (!d.itemDescription && first.description) d.itemDescription = first.description;
    if ((d.quantity === null || d.quantity === undefined) && first.quantity != null) {
      d.quantity = first.quantity;
    }
    if ((d.unitPrice === null || d.unitPrice === undefined) && first.unitPrice != null) {
      d.unitPrice = first.unitPrice;
    }
    if (!d.brand && first.brand) d.brand = first.brand;
    if (!d.model && first.model) d.model = first.model;
    if (!d.serialNumber && first.serialNumber) d.serialNumber = first.serialNumber;
  }

  // Numerical sanity check (non-destructive warning only)
  if (
    d.taxableAmount != null &&
    d.totalGst != null &&
    d.finalAmountPaid != null &&
    d.finalAmountPaid > 0
  ) {
    const expected = Number((d.taxableAmount + d.totalGst + (d.shippingCost ?? 0)).toFixed(2));
    const diff = Math.abs(expected - d.finalAmountPaid);
    if (diff > Math.max(2, d.finalAmountPaid * 0.03)) {
      warnings.push(
        `Taxable amount (${d.taxableAmount}) + GST (${d.totalGst}) equals ${expected}, which differs from final amount paid (${d.finalAmountPaid}).`
      );
    }
  }

  d.warnings = [...(d.warnings || []), ...warnings];

  return {
    success: true,
    data: d,
    warnings: d.warnings,
    errors,
  };
}
