
import {
  TopLevelClassification,
  TopLevelType,
  DocumentCategoryType,
  PurchaseItemSubtype,
  GeneralDocumentSubtype,
  DocumentSubtype,
  DocumentClassificationResult,
  DocumentOcrExtraction,
  ItemMatchResult,
} from '../types/scanner';
import { Item } from '../types';
import { matchDocumentToItem } from './itemMatcherService';


/**
 * Patterns strongly indicative of restaurant, cafe, and dining food bills.
 * EXCLUSION RULE: Restaurant & food receipts must NEVER become Purchased Items.
 */
const FOOD_RESTAURANT_PATTERNS = [
  /\b(?:restaurant|cafe|coffee|bistro|diner|dhaba|bakery|bar|pub|pizzeria|food\s*court|kitchen|chophouse)\b/i,
  /\b(?:zomato|swiggy|uber\s*eats|door\s*dash|grubhub|deliveroo)\b/i,
  /\b(?:dine-?in|takeaway|take-?out|table\s*(?:no|number)?\s*[:=]?\s*\d+|waiter|steward|covers\s*:\s*\d+)\b/i,
  /\b(?:food\s*bill|restaurant\s*gst|service\s*charge\s*(?:@\s*\d+%)?|fssai|fssai\s*lic|food\s*order)\b/i,
  /\b(?:biryani|pizza|burger|pasta|sandwich|noodles|fried\s*rice|thali|roti|naan|paneer|chicken|mutton|dosa|idli|vada|chai|espresso|cappuccino|latte|dessert|ice\s*cream|beverage|cocktail|mocktail)\b/i,
];

/**
 * Patterns strongly indicative of fee / tuition / educational payments.
 */
const FEE_PATTERNS = [
  /\b(?:college|university|school|institute|tuition|academic|examination|hostel|semester)\s+fee\b/i,
  /\bfee\s+(?:receipt|challan|structure|breakup|voucher|payment)\b/i,
  /\bstudent\s+(?:name|id|roll\s*no|registration)\b/i,
  /\bcourse\s*:\s*[A-Za-z0-9]/i,
  /\btuition\s+fee\b/i,
];

/**
 * Patterns strongly indicative of recurring utility services.
 */
const UTILITY_PATTERNS = [
  /\belectricity\s+(?:bill|charges|board|distribution)\b/i,
  /\bwater\s+(?:bill|charges|supply|tax)\b/i,
  /\bgas\s+(?:bill|charges|connection|consumer|png|lpg)\b/i,
  /\b(?:broadband|internet|fiber|telecom|dth|mobile|postpaid|prepaid)\s+(?:plus\s+)?bill\b/i,
  /\b(?:consumer\s*(?:no|number)|ca\s*no|meter\s*number|kwh|units\s*consumed)\b/i,
  /\bbilling\s*(?:period|cycle)\b/i,
  /\b(?:jio|airtel|vodafone|vi|bsnl|mtnl)\s+(?:postpaid|infocomm|telecom|bill)?\b/i,
  /\bunits\s+consumed\b/i,
];

/**
 * Patterns strongly indicative of motor / general insurance policies.
 */
const INSURANCE_PATTERNS = [
  /\b(?:motor|vehicle|car|two\s*wheeler|commercial|health|life)\s+insurance\b/i,
  /\binsurance\s+(?:policy|certificate|schedule|cover\s*note)\b/i,
  /\bpolicy\s*(?:number|no|period|holder)\b/i,
  /\bidv\b|\binsured\s+declared\s+value\b/i,
  /\bpremium\s+(?:amount|paid|payable|breakup)\b/i,
  /\bncb\b|\bno\s+claim\s+bonus\b/i,
];

/**
 * Patterns strongly indicative of vehicle registration certificate (RC).
 */
const VEHICLE_RC_PATTERNS = [
  /\b(?:registration\s+certificate|certificate\s+of\s+registration|form\s*23|form\s*24)\b/i,
  /\bmotor\s+vehicles?\s+department\b/i,
  /\bregistering\s+authority\b/i,
  /\bvehicle\s+registration\b/i,
  /\brto\s+(?:office|karnataka|delhi|maharashtra|tamil\s*nadu|up|gujarat)\b/i,
  /\bunladen\s+weight\b|\bseating\s+capacity\b/i,
];

/**
 * Patterns strongly indicative of Pollution Under Control (PUC) certificate.
 */
const PUC_PATTERNS = [
  /\b(?:pollution\s+under\s+control|puc\s+certificate|emission\s+test)\b/i,
  /\bcarbon\s+monoxide\b|\bhydrocarbon\b|\bsmoke\s+density\b/i,
];

/**
 * Patterns strongly indicative of extended warranty agreements.
 */
const EXTENDED_WARRANTY_PATTERNS = [
  /\bextended\s+warranty\s*(?:certificate|plan|agreement|policy)?\b/i,
  /\bextended\s+protection\s+plan\b/i,
];

/**
 * Patterns strongly indicative of guarantee certificates.
 */
const GUARANTEE_PATTERNS = [
  /\bguarantee\s+(?:certificate|card|terms|policy)\b/i,
  /\bmoney\s*back\s+guarantee\b/i,
  /\bguarantee\s+period\b/i,
];

/**
 * Patterns strongly indicative of warranty cards without immediate item sale.
 */
const WARRANTY_PATTERNS = [
  /\bwarranty\s+(?:certificate|card|terms|policy|conditions|booklet)\b/i,
  /\bterms\s+and\s+conditions\s+of\s+warranty\b/i,
  /\bmanufacturer\s+warranty\b/i,
];

/**
 * Patterns strongly indicative of pure service or maintenance without physical goods.
 */
const SERVICE_PATTERNS = [
  /\b(?:labour|labor|service|repair|inspection|visiting|installation)\s+charges?\b/i,
  /\b(?:ac|appliance|vehicle|car|bike)\s+(?:servicing|repair|maintenance)\b/i,
  /\bservice\s+(?:report|job\s*card|work\s*order|slip)\b/i,
];

/**
 * Patterns strongly indicative of delivery notes without clear purchase item line items.
 */
const DELIVERY_PATTERNS = [
  /\b(?:delivery\s+(?:challan|note|slip)|consignment\s+note|proof\s+of\s+delivery|pod\b|waybill|bill\s+of\s+lading)\b/i,
];

/**
 * Patterns strongly indicative of ownership, deeds, or government property documents.
 */
const OWNERSHIP_PATTERNS = [
  /\b(?:sale\s+deed|title\s+deed|conveyance\s+deed|possession\s+letter|allotment\s+letter|encumbrance\s+certificate)\b/i,
];

/**
 * Patterns strongly indicative of generic payment confirmations without physical merchandise.
 */
const PAYMENT_PATTERNS = [
  /\bpayment\s+(?:confirmation|advice|voucher|slip)\b/i,
  /\bbank\s+(?:transaction|transfer|counterfoil|pay-in\s*slip)\b/i,
  /\brent\s+(?:receipt|agreement)\b/i,
  /\butr\s*(?:number|no)\b|\btransaction\s*id\b/i,
];

/**
 * High-confidence physical merchandise keywords & product categories.
 */
const PHYSICAL_PRODUCT_INDICATORS = [
  /\b(?:qty|quantity)\s*[:=x]?\s*\d+\b/i,
  /\bunit\s*price\b/i,
  /\brate\s*x\s*qty\b/i,
  /\b(?:hsn|sku|model|serial\s*no|imei)\b/i,
  /\b(?:phone|laptop|macbook|ipad|galaxy|iphone|television|smart\s*tv|refrigerator|fridge|washing\s*machine|air\s*conditioner|microwave|sofa|table|chair|bed|wardrobe|shirt|t-shirt|jeans|jacket|shoes|sneakers|watch|headphones|earbuds|camera|drill|generator|bike|car|scooter)\b/i,
  /\b(?:size\s*:\s*[xsml0-9]+|color\s*:\s*[a-z]+|storage\s*:\s*\d+\s*(?:gb|tb))\b/i,
  /\b(?:ex-showroom\s*price|on-road\s*price|dealership)\b/i,
];


export interface DocumentFeatureSignals {
  hasPhysicalItems: boolean;
  physicalItemCount: number;
  physicalProductEvidenceScore: number; // 0 to 100
  generalDocumentEvidenceScore: number; // 0 to 100
  detectedGeneralSubtype: GeneralDocumentSubtype | null;
  detectedPurchaseSubtype: PurchaseItemSubtype | null;
  dominantReason: string;
  hasMerchant: boolean;
  hasLineItems: boolean;
  hasQuantitiesAndUnitPrices: boolean;
  hasTotalAmount: boolean;
  hasInvoiceOrReceiptNumber: boolean;
  isUnreadableOrInvalid: boolean;
  isFoodReceipt: boolean;
}

/**
 * Analyzes visual/textual document properties to extract deep semantic features.
 */
export function extractDocumentFeatureSignals(input: {
  rawText?: string;
  documentTitle?: string | null;
  merchantName?: string | null;
  issuerName?: string | null;
  invoiceNumber?: string | null;
  items?: any[];
  grandTotal?: number | null;
  fields?: Record<string, any>;
  isReceiptCandidate?: boolean;
  isDocumentCandidate?: boolean;
  status?: string;
}): DocumentFeatureSignals {
  const combinedText = [
    input.rawText || '',
    input.documentTitle || '',
    input.merchantName || '',
    input.issuerName || '',
    input.invoiceNumber || '',
    ...(input.items || []).map((it) => `${it.name || it.productName || ''} ${it.category || ''} ${it.model || ''} ${it.brand || ''}`),
    ...Object.values(input.fields || {}).map((f) => (typeof f === 'object' ? JSON.stringify(f) : String(f))),
  ].join(' ');

  if (!combinedText.trim() && (!input.items || input.items.length === 0)) {
    return {
      hasPhysicalItems: false,
      physicalItemCount: 0,
      physicalProductEvidenceScore: 0,
      generalDocumentEvidenceScore: 0,
      detectedGeneralSubtype: null,
      detectedPurchaseSubtype: null,
      dominantReason: 'Document content is unreadable or empty.',
      hasMerchant: false,
      hasLineItems: false,
      hasQuantitiesAndUnitPrices: false,
      hasTotalAmount: false,
      hasInvoiceOrReceiptNumber: false,
      isUnreadableOrInvalid: true,
      isFoodReceipt: false,
    };
  }

  const isFoodReceipt = FOOD_RESTAURANT_PATTERNS.some((p) => p.test(combinedText));

  const isVehicleSalesInvoice =
    /\b(?:tax\s+invoice|sales\s+invoice|commercial\s+tax\s+invoice)\b/i.test(combinedText) &&
    /\b(?:dealership|honda\s+cars|hyundai|maruti|tata\s+motors|toyota|mahindra|ex-showroom)\b/i.test(combinedText);

  let generalSubtype: GeneralDocumentSubtype | null = null;
  let generalScore = 0;
  let generalReason = '';

  if (isFoodReceipt) {
    generalSubtype = 'OTHER';
    generalScore = 99;
    generalReason = 'Document represents restaurant, dining, or food delivery consumption. Food receipts do not create physical ownership items in Keepr.';
  } else if (FEE_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'FEE_RECEIPT';
    generalScore = 95;
    generalReason = 'Document represents payment of educational, college, or institutional fees rather than purchase of a physical item.';
  } else if (UTILITY_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'UTILITY_BILL';
    generalScore = 96;
    generalReason = 'Document represents recurring utility service consumption (electricity, water, gas, internet) rather than purchase of a physical item.';
  } else if (PUC_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'PUC';
    generalScore = 97;
    generalReason = 'Document represents a vehicle Pollution Under Control (PUC) emission certificate.';
  } else if (!isVehicleSalesInvoice && VEHICLE_RC_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'VEHICLE_RC';
    generalScore = 98;
    generalReason = 'Document represents official government vehicle registration certificate (RC).';
  } else if (INSURANCE_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'VEHICLE_INSURANCE';
    generalScore = 96;
    generalReason = 'Document represents an insurance policy certificate/schedule rather than acquisition of physical goods.';
  } else if (EXTENDED_WARRANTY_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'EXTENDED_WARRANTY';
    generalScore = 92;
    generalReason = 'Document is an extended warranty certificate or protection plan.';
  } else if (GUARANTEE_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'GUARANTEE';
    generalScore = 91;
    generalReason = 'Document is a product guarantee certificate or guarantee policy terms.';
  } else if (WARRANTY_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'WARRANTY';
    generalScore = 90;
    generalReason = 'Document is a warranty certificate, warranty card, or warranty policy terms.';
  } else if (DELIVERY_PATTERNS.some((p) => p.test(combinedText)) && !PHYSICAL_PRODUCT_INDICATORS.some((p) => p.test(combinedText))) {
    generalSubtype = 'DELIVERY_DOCUMENT';
    generalScore = 88;
    generalReason = 'Document is a delivery challan or dispatch slip without full purchase item line pricing.';
  } else if (OWNERSHIP_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'OWNERSHIP_DOCUMENT';
    generalScore = 94;
    generalReason = 'Document represents property ownership deed or allotment certificate.';
  } else if (SERVICE_PATTERNS.some((p) => p.test(combinedText)) && !PHYSICAL_PRODUCT_INDICATORS.some((p) => p.test(combinedText))) {
    generalSubtype = 'SERVICE_DOCUMENT';
    generalScore = 88;
    generalReason = 'Document represents repair or labour service charges without acquisition of physical merchandise.';
  } else if (PAYMENT_PATTERNS.some((p) => p.test(combinedText))) {
    generalSubtype = 'PAYMENT_RECEIPT';
    generalScore = 85;
    generalReason = 'Document is a financial transaction receipt or payment confirmation without specific physical item purchase details.';
  }

  const rawItems = Array.isArray(input.items) ? input.items : [];
  let physicalItemCount = 0;
  let hasQuantities = false;
  let hasUnitPrices = false;

  for (const item of rawItems) {
    const itemName = String(item.name || item.productName || '').trim();
    if (!itemName) continue;

    const isServiceOrFee =
      isFoodReceipt ||
      FEE_PATTERNS.some((p) => p.test(itemName)) ||
      UTILITY_PATTERNS.some((p) => p.test(itemName)) ||
      SERVICE_PATTERNS.some((p) => p.test(itemName)) ||
      FOOD_RESTAURANT_PATTERNS.some((p) => p.test(itemName)) ||
      /^(?:tuition|college|school|exam|labour|service\s*charge|delivery\s*charge|handling|donation|cashback|round\s*off)$/i.test(itemName);

    if (!isServiceOrFee && itemName.length > 2) {
      physicalItemCount++;
    }

    if (item.quantity && Number(item.quantity) > 0) hasQuantities = true;
    if (item.unitPrice && Number(item.unitPrice) > 0) hasUnitPrices = true;
  }

  let physicalScore = 0;
  let physicalReason = '';
  const indicatorMatches = PHYSICAL_PRODUCT_INDICATORS.filter((p) => p.test(combinedText)).length;

  if (isFoodReceipt) {
    physicalScore = 0;
    physicalItemCount = 0;
  } else {
    if (physicalItemCount > 0) {
      physicalScore += 40;
      if (hasQuantities) physicalScore += 15;
      if (hasUnitPrices) physicalScore += 15;
      if (indicatorMatches > 0) physicalScore += Math.min(25, indicatorMatches * 10);
      if (input.merchantName) physicalScore += 10;
      if (input.grandTotal !== null && input.grandTotal !== undefined && input.grandTotal > 0) physicalScore += 10;
    } else if (indicatorMatches >= 2) {
      physicalScore = 65;
    }
    physicalScore = Math.min(99, physicalScore);
  }

  let purchaseSubtype: PurchaseItemSubtype = 'RECEIPT';
  const hasInvoiceWord = /\binvoice\b/i.test(input.documentTitle || '') || /\btax\s+invoice\b|\bbill\s+of\s+supply\b|\bcommercial\s+invoice\b/i.test(combinedText);
  const hasReceiptWord = /\breceipt\b/i.test(input.documentTitle || '') || /\b(?:purchase|store|cash|retail)\s+receipt\b/i.test(combinedText);

  if (hasInvoiceWord && !hasReceiptWord) {
    purchaseSubtype = 'INVOICE';
  } else if (hasReceiptWord && !hasInvoiceWord) {
    purchaseSubtype = 'RECEIPT';
  } else if (hasInvoiceWord && hasReceiptWord) {
    if (/\btax\s+invoice\b|\bbill\s+of\s+supply\b|\bcommercial\s+invoice\b/i.test(combinedText)) {
      purchaseSubtype = 'INVOICE';
    } else {
      purchaseSubtype = 'RECEIPT';
    }
  } else if (input.invoiceNumber && !/\breceipt\b/i.test(combinedText)) {
    purchaseSubtype = 'INVOICE';
  }

  if (physicalScore >= 70 && physicalItemCount > 0) {
    physicalReason = `${purchaseSubtype === 'INVOICE' ? 'Invoice' : 'Receipt'} contains physical product line items (${physicalItemCount} items) with quantities, pricing, and purchase total.`;
  }

  return {
    hasPhysicalItems: physicalItemCount > 0,
    physicalItemCount,
    physicalProductEvidenceScore: physicalScore,
    generalDocumentEvidenceScore: generalScore,
    detectedGeneralSubtype: generalSubtype,
    detectedPurchaseSubtype: purchaseSubtype,
    dominantReason: generalScore >= physicalScore ? generalReason : physicalReason,
    hasMerchant: Boolean(input.merchantName || input.issuerName),
    hasLineItems: rawItems.length > 0,
    hasQuantitiesAndUnitPrices: hasQuantities && hasUnitPrices,
    hasTotalAmount: input.grandTotal !== null && input.grandTotal !== undefined,
    hasInvoiceOrReceiptNumber: Boolean(input.invoiceNumber),
    isUnreadableOrInvalid: false,
    isFoodReceipt,
  };
}


export function mapSubtypeToControlledCategoryAndType(
  topLevel: TopLevelType,
  subtype: string | null,
  combinedText: string
): { category: DocumentCategoryType; documentType: string } {
  if (topLevel === 'PURCHASED_ITEM') {
    if (/\btax\s+invoice\b/i.test(combinedText)) {
      return { category: 'OWNERSHIP_AND_PURCHASE', documentType: 'TAX_INVOICE' };
    }
    if (/\b(?:amazon|flipkart|online\s*order|order\s*#)\b/i.test(combinedText)) {
      return { category: 'OWNERSHIP_AND_PURCHASE', documentType: 'ONLINE_ORDER_INVOICE' };
    }
    if (subtype === 'INVOICE' || /\binvoice\b/i.test(combinedText)) {
      return { category: 'OWNERSHIP_AND_PURCHASE', documentType: 'PURCHASE_INVOICE' };
    }
    return { category: 'OWNERSHIP_AND_PURCHASE', documentType: 'PURCHASE_RECEIPT' };
  }

  switch (subtype) {
    case 'VEHICLE_RC':
      return { category: 'VEHICLE', documentType: 'VEHICLE_RC' };
    case 'VEHICLE_INSURANCE':
      return { category: 'INSURANCE', documentType: 'VEHICLE_INSURANCE' };
    case 'PUC':
      return { category: 'VEHICLE', documentType: 'PUC' };
    case 'FEE_RECEIPT':
      if (/\bcollege\b/i.test(combinedText)) return { category: 'FEES_AND_PAYMENTS', documentType: 'COLLEGE_FEE_RECEIPT' };
      if (/\bschool\b/i.test(combinedText)) return { category: 'FEES_AND_PAYMENTS', documentType: 'SCHOOL_FEE_RECEIPT' };
      if (/\btuition\b/i.test(combinedText)) return { category: 'FEES_AND_PAYMENTS', documentType: 'TUITION_FEE_RECEIPT' };
      return { category: 'FEES_AND_PAYMENTS', documentType: 'COLLEGE_FEE_RECEIPT' };
    case 'UTILITY_BILL':
      if (/\belectricity\b/i.test(combinedText)) return { category: 'BILLS_AND_UTILITIES', documentType: 'ELECTRICITY_BILL' };
      if (/\bwater\b/i.test(combinedText)) return { category: 'BILLS_AND_UTILITIES', documentType: 'WATER_BILL' };
      if (/\bgas\b/i.test(combinedText)) return { category: 'BILLS_AND_UTILITIES', documentType: 'GAS_BILL' };
      if (/\b(?:broadband|internet|fiber|wifi)\b/i.test(combinedText)) return { category: 'BILLS_AND_UTILITIES', documentType: 'INTERNET_BILL' };
      if (/\b(?:mobile|telecom|postpaid)\b/i.test(combinedText)) return { category: 'BILLS_AND_UTILITIES', documentType: 'MOBILE_BILL' };
      return { category: 'BILLS_AND_UTILITIES', documentType: 'UTILITY_BILL' };
    case 'WARRANTY':
      return {
        category: 'WARRANTY_AND_GUARANTEE',
        documentType: /\bcertificate\b/i.test(combinedText) ? 'WARRANTY_CERTIFICATE' : 'WARRANTY_CARD',
      };
    case 'GUARANTEE':
      return {
        category: 'WARRANTY_AND_GUARANTEE',
        documentType: /\bcertificate\b/i.test(combinedText) ? 'GUARANTEE_CERTIFICATE' : 'GUARANTEE_CARD',
      };
    case 'EXTENDED_WARRANTY':
      return { category: 'WARRANTY_AND_GUARANTEE', documentType: 'EXTENDED_WARRANTY' };
    case 'DELIVERY_DOCUMENT':
      return { category: 'OWNERSHIP_AND_PURCHASE', documentType: 'DELIVERY_DOCUMENT' };
    case 'OWNERSHIP_DOCUMENT':
      return { category: 'OWNERSHIP_AND_PURCHASE', documentType: 'OWNERSHIP_DOCUMENT' };
    case 'PAYMENT_RECEIPT':
      return { category: 'FEES_AND_PAYMENTS', documentType: 'PAYMENT_RECEIPT' };
    default:
      return { category: 'OTHER', documentType: 'OTHER' };
  }
}


/**
 * Core Classifier & Post-Model Validator.
 * Guaranteed to execute deterministically without relying on keyword-only shortcuts.
 */
export function classifyDocument(input: {
  modelClassification?: Partial<DocumentClassificationResult> | null;
  rawText?: string;
  documentTitle?: string | null;
  documentCategory?: string | null;
  documentType?: string | null;
  merchantName?: string | null;
  issuerName?: string | null;
  invoiceNumber?: string | null;
  items?: any[];
  grandTotal?: number | null;
  fields?: Record<string, any>;
  isReceiptCandidate?: boolean;
  isDocumentCandidate?: boolean;
  status?: string;
  existingItems?: Item[];
}): DocumentClassificationResult {
  const combinedText = [
    input.rawText || '',
    input.documentTitle || '',
    input.merchantName || '',
    input.issuerName || '',
    input.invoiceNumber || '',
    ...(input.items || []).map((it) => `${it.name || it.productName || ''} ${it.category || ''} ${it.model || ''} ${it.brand || ''}`),
    ...Object.values(input.fields || {}).map((f) => (typeof f === 'object' ? JSON.stringify(f) : String(f))),
  ].join(' ');

  if (
    input.status === 'invalid_document' ||
    (input.modelClassification?.topLevelClassification === 'INVALID_DOCUMENT') ||
    (input.modelClassification?.topLevelType === 'INVALID')
  ) {
    return {
      topLevelClassification: 'INVALID_DOCUMENT',
      topLevelType: 'INVALID',
      category: 'OTHER',
      documentCategory: 'OTHER',
      documentSubtype: null,
      documentType: null,
      confidence: 0.99,
      reason: input.modelClassification?.reason || 'Document is unreadable, corrupted, or not a supported document/receipt.',
      isPhysicalItemPurchase: false,
      shouldCreateItem: false,
      itemMatch: null,
      document: null,
    };
  }

  const features = extractDocumentFeatureSignals(input);

  if (features.isUnreadableOrInvalid) {
    return {
      topLevelClassification: 'INVALID_DOCUMENT',
      topLevelType: 'INVALID',
      category: 'OTHER',
      documentCategory: 'OTHER',
      documentSubtype: null,
      documentType: null,
      confidence: 0.95,
      reason: 'No legible text, line items, or financial details could be extracted.',
      isPhysicalItemPurchase: false,
      shouldCreateItem: false,
      itemMatch: null,
      document: null,
    };
  }

  const extractedDocDate = input.fields?.documentDate || input.fields?.invoiceDate || input.fields?.purchaseDate || null;
  const extractedExpiryDate = input.fields?.expiryDate || input.fields?.warrantyUntil || null;
  const extractedDueDate = input.fields?.dueDate || null;

  const docExtraction: DocumentOcrExtraction = {
    title: input.documentTitle || (features.detectedGeneralSubtype ? `${features.detectedGeneralSubtype}` : 'Document'),
    documentDate: extractedDocDate,
    issuerName: input.issuerName || input.merchantName || null,
    referenceNumber: input.invoiceNumber || input.fields?.referenceNumber || null,
    amount: input.grandTotal || null,
    currency: 'INR',
    expiryDate: extractedExpiryDate,
    dueDate: extractedDueDate,
    notes: null,
  };

  const itemMatch: ItemMatchResult | null = input.existingItems && input.existingItems.length > 0
    ? matchDocumentToItem(
        {
          rawText: input.rawText,
          title: input.documentTitle,
          merchantName: input.merchantName,
          issuerName: input.issuerName,
          invoiceNumber: input.invoiceNumber,
          brand: input.items?.[0]?.brand || null,
          model: input.items?.[0]?.model || null,
          productName: input.items?.[0]?.name || null,
        },
        input.existingItems
      )
    : null;

  // 2. High-Priority Negative Overrides for General Documents & Food Bills
  // Even if the document has "Invoice" or "Receipt" in the title or the model said PURCHASE_ITEM:
  // Fee Receipts, Utility Bills, Motor Insurance, Vehicle RCs, PUCs, and Food Bills are NEVER Purchase Items!
  if (features.generalDocumentEvidenceScore >= 80 && features.detectedGeneralSubtype) {
    const confidence = Math.max(0.90, features.generalDocumentEvidenceScore / 100);
    const { category, documentType } = mapSubtypeToControlledCategoryAndType(
      'DOCUMENT',
      features.detectedGeneralSubtype,
      combinedText
    );

    return {
      topLevelClassification: 'GENERAL_DOCUMENT',
      topLevelType: 'DOCUMENT',
      category,
      documentCategory: category,
      documentSubtype: features.detectedGeneralSubtype,
      documentType,
      confidence,
      reason: features.dominantReason || `Classified as ${features.detectedGeneralSubtype} based on verified document purpose.`,
      isPhysicalItemPurchase: false,
      shouldCreateItem: false,
      itemMatch,
      document: docExtraction,
    };
  }

  const modelClass = input.modelClassification?.topLevelClassification || input.modelClassification?.topLevelType;
  const modelConfidence = typeof input.modelClassification?.confidence === 'number' ? input.modelClassification.confidence : null;

  if (modelClass === 'PURCHASE_ITEM' || modelClass === 'PURCHASED_ITEM') {
    // Deterministic Validation of PURCHASE_ITEM claim:
    // "Classify as PURCHASE_ITEM only when the document contains strong evidence that a physical product/item was purchased."
    if (!features.hasPhysicalItems && features.physicalProductEvidenceScore < 50) {
      // Model claimed PURCHASE_ITEM but failed to produce any physical product evidence
      return {
        topLevelClassification: 'AMBIGUOUS',
        topLevelType: 'AMBIGUOUS',
        category: 'OTHER',
        documentCategory: 'OTHER',
        documentSubtype: null,
        documentType: null,
        confidence: 0.55,
        reason: 'Document contains payment details but lacks verifiable physical product line items or product specifications.',
        isPhysicalItemPurchase: null,
        shouldCreateItem: false,
        itemMatch: null,
        document: docExtraction,
      };
    }

    const conf = Math.max(0.85, modelConfidence ?? (features.physicalProductEvidenceScore / 100));
    const purchaseSub = (input.modelClassification?.documentSubtype as PurchaseItemSubtype) || features.detectedPurchaseSubtype || 'RECEIPT';
    const { category, documentType } = mapSubtypeToControlledCategoryAndType('PURCHASED_ITEM', purchaseSub, combinedText);

    return {
      topLevelClassification: 'PURCHASE_ITEM',
      topLevelType: 'PURCHASED_ITEM',
      category,
      documentCategory: category,
      documentSubtype: purchaseSub,
      documentType,
      confidence: conf,
      reason: input.modelClassification?.reason || features.dominantReason || 'Verified physical item purchase with merchandise line items and payment totals.',
      isPhysicalItemPurchase: true,
      shouldCreateItem: true,
      itemMatch: null,
      document: docExtraction,
    };
  }

  if (
    modelClass === 'SERVICE_REPAIR' ||
    (input.modelClassification as any)?.entityType === 'SERVICE_REPAIR' ||
    features.detectedGeneralSubtype === 'SERVICE_DOCUMENT'
  ) {
    const conf = Math.max(0.85, modelConfidence ?? 0.90);
    return {
      topLevelClassification: 'SERVICE_REPAIR',
      entityType: 'SERVICE_REPAIR',
      topLevelType: 'SERVICE_REPAIR' as any,
      category: 'Service & Repair',
      documentCategory: 'Service & Repair',
      documentSubtype: 'SERVICE_DOCUMENT',
      documentType: 'Service Invoice',
      confidence: conf,
      reason: input.modelClassification?.reason || features.dominantReason || 'Classified as Service & Repair record based on maintenance, repair, and technical service details.',
      isPhysicalItemPurchase: false,
      shouldCreateItem: false,
      itemMatch,
      document: docExtraction,
      serviceRepair: (input.modelClassification as any)?.serviceRepair || null,
    };
  }

  if (modelClass === 'GENERAL_DOCUMENT' || modelClass === 'DOCUMENT') {
    // If model claims GENERAL_DOCUMENT but there is overwhelming physical product evidence:
    if (features.hasPhysicalItems && features.physicalItemCount >= 1 && features.physicalProductEvidenceScore >= 85) {
      return {
        topLevelClassification: 'AMBIGUOUS',
        topLevelType: 'AMBIGUOUS',
        category: 'OTHER',
        documentCategory: 'OTHER',
        documentSubtype: null,
        documentType: null,
        confidence: 0.65,
        reason: 'Document shows physical product line items but was designated as a general document. User review required.',
        isPhysicalItemPurchase: null,
        shouldCreateItem: false,
        itemMatch: null,
        document: docExtraction,
      };
    }

    const conf = Math.max(0.85, modelConfidence ?? 0.90);
    const generalSub = (input.modelClassification?.documentSubtype as GeneralDocumentSubtype) || features.detectedGeneralSubtype || 'OTHER';
    const { category, documentType } = mapSubtypeToControlledCategoryAndType('DOCUMENT', generalSub, combinedText);

    return {
      topLevelClassification: 'GENERAL_DOCUMENT',
      topLevelType: 'DOCUMENT',
      category,
      documentCategory: category,
      documentSubtype: generalSub,
      documentType,
      confidence: conf,
      reason: input.modelClassification?.reason || features.dominantReason || 'Verified document does not represent acquisition of a physical trackable item.',
      isPhysicalItemPurchase: false,
      shouldCreateItem: false,
      itemMatch,
      document: docExtraction,
    };
  }

  // 4. Autonomous Classification when model didn't specify or returned AMBIGUOUS
  if (features.physicalProductEvidenceScore >= 75 && features.hasPhysicalItems) {
    const conf = Math.min(0.98, features.physicalProductEvidenceScore / 100);
    const purchaseSub = features.detectedPurchaseSubtype || 'RECEIPT';
    const { category, documentType } = mapSubtypeToControlledCategoryAndType('PURCHASED_ITEM', purchaseSub, combinedText);

    return {
      topLevelClassification: 'PURCHASE_ITEM',
      topLevelType: 'PURCHASED_ITEM',
      category,
      documentCategory: category,
      documentSubtype: purchaseSub,
      documentType,
      confidence: conf,
      reason: features.dominantReason,
      isPhysicalItemPurchase: true,
      shouldCreateItem: true,
      itemMatch: null,
      document: docExtraction,
    };
  }

  if (features.generalDocumentEvidenceScore >= 70 && features.detectedGeneralSubtype) {
    const conf = Math.min(0.98, features.generalDocumentEvidenceScore / 100);
    const { category, documentType } = mapSubtypeToControlledCategoryAndType('DOCUMENT', features.detectedGeneralSubtype, combinedText);

    return {
      topLevelClassification: 'GENERAL_DOCUMENT',
      topLevelType: 'DOCUMENT',
      category,
      documentCategory: category,
      documentSubtype: features.detectedGeneralSubtype,
      documentType,
      confidence: conf,
      reason: features.dominantReason,
      isPhysicalItemPurchase: false,
      shouldCreateItem: false,
      itemMatch,
      document: docExtraction,
    };
  }

  return {
    topLevelClassification: 'AMBIGUOUS',
    topLevelType: 'AMBIGUOUS',
    category: 'OTHER',
    documentCategory: 'OTHER',
    documentSubtype: null,
    documentType: null,
    confidence: 0.50,
    reason: 'Document purpose cannot be determined with sufficient confidence. Manual review required.',
    isPhysicalItemPurchase: null,
    shouldCreateItem: false,
    itemMatch: null,
    document: docExtraction,
  };
}

/**
 * Maps confidence score to strict routing decision.
 * confidence >= 0.85 -> automatic routing allowed
 * 0.60 - 0.84        -> classify but require user review
 * < 0.60             -> AMBIGUOUS / NEEDS REVIEW
 */
export function evaluateRoutingDecision(classification: DocumentClassificationResult): {
  action: 'AUTO_ROUTE_ITEM' | 'AUTO_ROUTE_DOCUMENT' | 'AUTO_ROUTE_SERVICE' | 'USER_REVIEW' | 'INVALID';
  userFacingHeader: string;
  userFacingPrompt: string;
  allowAutoRoute: boolean;
} {
  const isInvalid =
    classification.topLevelClassification === 'INVALID_DOCUMENT' ||
    classification.topLevelType === 'INVALID';

  if (isInvalid) {
    return {
      action: 'INVALID',
      userFacingHeader: "That doesn't look like a document or receipt",
      userFacingPrompt: 'Please upload a clear photo of your receipt, bill, or ownership document.',
      allowAutoRoute: false,
    };
  }

  const isService =
    classification.topLevelClassification === 'SERVICE_REPAIR' ||
    classification.entityType === 'SERVICE_REPAIR';

  if (isService) {
    if (classification.confidence >= 0.85) {
      return {
        action: 'AUTO_ROUTE_SERVICE',
        userFacingHeader: 'Looks like a Service & Repair record',
        userFacingPrompt: 'Save to Service & Repair',
        allowAutoRoute: true,
      };
    }
    return {
      action: 'USER_REVIEW',
      userFacingHeader: 'Looks like a Service & Repair record',
      userFacingPrompt: 'Review and confirm this Service & Repair record.',
      allowAutoRoute: false,
    };
  }

  const isPurchase =
    classification.topLevelClassification === 'PURCHASE_ITEM' ||
    classification.topLevelType === 'PURCHASED_ITEM' ||
    classification.entityType === 'PURCHASED_ITEM';

  if (isPurchase) {
    if (classification.confidence >= 0.85) {
      return {
        action: 'AUTO_ROUTE_ITEM',
        userFacingHeader: 'Looks like a Purchased Item',
        userFacingPrompt: 'Save as Item',
        allowAutoRoute: true,
      };
    }
    return {
      action: 'USER_REVIEW',
      userFacingHeader: 'Looks like a Purchased Item',
      userFacingPrompt: 'Review and confirm saving as an Item, Document, or Service.',
      allowAutoRoute: false,
    };
  }

  const isGeneralDoc =
    classification.topLevelClassification === 'GENERAL_DOCUMENT' ||
    classification.topLevelType === 'DOCUMENT' ||
    classification.entityType === 'DOCUMENT';

  if (isGeneralDoc) {
    if (classification.confidence >= 0.85) {
      return {
        action: 'AUTO_ROUTE_DOCUMENT',
        userFacingHeader: 'Looks like an Important Document',
        userFacingPrompt: 'Save to Documents',
        allowAutoRoute: true,
      };
    }
    return {
      action: 'USER_REVIEW',
      userFacingHeader: 'Looks like an Important Document',
      userFacingPrompt: 'Review and confirm saving as a Document.',
      allowAutoRoute: false,
    };
  }

  return {
    action: 'USER_REVIEW',
    userFacingHeader: 'Review what this document is',
    userFacingPrompt: 'Choose whether this is a Purchased Item, Document, or Service & Repair record.',
    allowAutoRoute: false,
  };
}
