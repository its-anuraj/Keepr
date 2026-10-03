
import { CanonicalDocumentCategory, CanonicalDocumentType } from '../types';

export interface DocumentCategoryMeta {
  id: CanonicalDocumentCategory;
  name: CanonicalDocumentCategory;
  icon: string;
  description: string;
  types: CanonicalDocumentType[];
  supportsExpiry: boolean;
  supportsAmount: boolean;
  supportsItemLink: boolean;
}

export const CANONICAL_DOCUMENT_CATEGORIES: DocumentCategoryMeta[] = [
  {
    id: 'Receipts & Invoices',
    name: 'Receipts & Invoices',
    icon: 'receipt-long',
    description: 'Retail POS receipts, commercial tax invoices, and purchase bills',
    types: ['Receipt', 'Invoice', 'Purchase Bill'],
    supportsExpiry: false,
    supportsAmount: true,
    supportsItemLink: true,
  },
  {
    id: 'Vehicle Documents',
    name: 'Vehicle Documents',
    icon: 'directions-car',
    description: 'RC registration, insurance policy, PUC certificate, and delivery proofs',
    types: ['RC', 'Insurance', 'PUC', 'Vehicle Invoice', 'Delivery Document'],
    supportsExpiry: true,
    supportsAmount: false,
    supportsItemLink: true,
  },
  {
    id: 'Warranty & Guarantee',
    name: 'Warranty & Guarantee',
    icon: 'verified-user',
    description: 'Manufacturer warranty cards, guarantee certificates, and extended plans',
    types: ['Warranty Certificate', 'Guarantee Certificate', 'Extended Warranty'],
    supportsExpiry: true,
    supportsAmount: false,
    supportsItemLink: true,
  },
  {
    id: 'Fees & Payments',
    name: 'Fees & Payments',
    icon: 'payments',
    description: 'College & university tuition receipts, fee challans, and proof of payments',
    types: ['College Fee Receipt', 'Payment Receipt', 'Fee Challan'],
    supportsExpiry: false,
    supportsAmount: true,
    supportsItemLink: false,
  },
  {
    id: 'Bills & Utilities',
    name: 'Bills & Utilities',
    icon: 'bolt',
    description: 'Electricity, water, gas, broadband bills, and service invoices',
    types: [
      'Electricity Bill',
      'Water Bill',
      'Internet Bill',
      'Gas Bill',
      'Other Utility Bill',
    ],
    supportsExpiry: true, // due date
    supportsAmount: true,
    supportsItemLink: false,
  },
  {
    id: 'Ownership & Purchase',
    name: 'Ownership & Purchase',
    icon: 'assignment',
    description: 'Purchase agreements, asset deeds, delivery acknowledgements',
    types: ['Ownership Document', 'Purchase Agreement', 'Delivery Proof'],
    supportsExpiry: false,
    supportsAmount: true,
    supportsItemLink: true,
  },
  {
    id: 'Other Important Documents',
    name: 'Other Important Documents',
    icon: 'folder',
    description: 'Maintenance contracts, AMC documents, and important life records',
    types: ['Other Important Document'],
    supportsExpiry: true,
    supportsAmount: false,
    supportsItemLink: true,
  },
];

export const DOCUMENT_CATEGORY_NAMES: CanonicalDocumentCategory[] =
  CANONICAL_DOCUMENT_CATEGORIES.map((c) => c.name);

export function getDocumentCategoryMeta(
  category?: string | null
): DocumentCategoryMeta {
  if (!category) return CANONICAL_DOCUMENT_CATEGORIES[0];
  const found = CANONICAL_DOCUMENT_CATEGORIES.find(
    (c) => c.name.toLowerCase() === category.toLowerCase() || c.id === category
  );
  return found || CANONICAL_DOCUMENT_CATEGORIES[6]; // default to Other Important Documents
}

export function getDocumentTypesForCategory(
  category?: string | null
): CanonicalDocumentType[] {
  const meta = getDocumentCategoryMeta(category);
  return meta.types;
}

/**
 * Checks whether a given category and type has a genuine expiry or due date
 * for reminder scheduling.
 */
export function doesDocumentSupportExpiry(
  category: CanonicalDocumentCategory,
  docType?: string | null
): boolean {
  if (category === 'Vehicle Documents') {
    return docType === 'Insurance' || docType === 'PUC';
  }
  if (category === 'Warranty & Guarantee') {
    return true;
  }
  if (category === 'Bills & Utilities') {
    return true; // Bill Due Date
  }
  return false;
}

/**
 * Evidence-based category normalizer.
 * Returns null if no strong evidence is found, preventing hallucinated categories.
 */
export function normalizeToCanonicalDocumentCategory(
  rawInput?: string | null
): CanonicalDocumentCategory | null {
  if (!rawInput) return null;
  const clean = rawInput.trim().toLowerCase();
  if (!clean) return null;

  for (const cat of DOCUMENT_CATEGORY_NAMES) {
    if (cat.toLowerCase() === clean) {
      return cat;
    }
  }

  if (
    clean === 'fees_payments' ||
    clean === 'fees-payments' ||
    clean === 'fees & payments' ||
    clean === 'fees' ||
    clean === 'payments' ||
    clean === 'college fee' ||
    clean === 'college fee receipt' ||
    clean === 'fee receipt' ||
    clean === 'tuition' ||
    clean === 'education'
  ) {
    return 'Fees & Payments';
  }

  if (
    clean === 'receipts_invoices' ||
    clean === 'receipts-invoices' ||
    clean === 'receipts & invoices' ||
    clean === 'receipt' ||
    clean === 'receipts' ||
    clean === 'invoice' ||
    clean === 'invoices' ||
    clean === 'purchase bill' ||
    clean === 'purchase_bill' ||
    clean === 'tax invoice' ||
    clean === 'cash memo' ||
    clean === 'store bill'
  ) {
    return 'Receipts & Invoices';
  }

  if (
    clean === 'vehicle_documents' ||
    clean === 'vehicle-documents' ||
    clean === 'vehicle documents' ||
    clean === 'vehicle' ||
    clean === 'vehicles' ||
    clean === 'motor' ||
    clean === 'automobile' ||
    clean === 'car' ||
    clean === 'bike'
  ) {
    return 'Vehicle Documents';
  }

  if (
    clean === 'warranty_guarantee' ||
    clean === 'warranty-guarantee' ||
    clean === 'warranty & guarantee' ||
    clean === 'warranty' ||
    clean === 'guarantee' ||
    clean === 'warranties'
  ) {
    return 'Warranty & Guarantee';
  }

  if (
    clean === 'bills_utilities' ||
    clean === 'bills-utilities' ||
    clean === 'bills & utilities' ||
    clean === 'bill' ||
    clean === 'bills' ||
    clean === 'utility' ||
    clean === 'utilities' ||
    clean === 'utility bill' ||
    clean === 'utility bills'
  ) {
    return 'Bills & Utilities';
  }

  if (
    clean === 'ownership_purchase' ||
    clean === 'ownership-purchase' ||
    clean === 'ownership & purchase' ||
    clean === 'ownership' ||
    clean === 'purchase agreement' ||
    clean === 'delivery proof'
  ) {
    return 'Ownership & Purchase';
  }

  if (
    clean === 'other_important' ||
    clean === 'other-important' ||
    clean === 'other_important_documents' ||
    clean === 'other important documents' ||
    clean === 'other' ||
    clean === 'important documents'
  ) {
    return 'Other Important Documents';
  }

  const normalized = clean.replace(/[_\\-]+/g, ' ');

  if (
    /\b(insurance|policy|puc|pollution|rc|registration certificate|chassis|vin|motor insurance|vehicle invoice|car delivery|two wheeler|four wheeler)\b/.test(
      normalized
    )
  ) {
    return 'Vehicle Documents';
  }

  if (
    /\b(college|university|tuition|fee|fees|challan|semester|admission|student|examination fee|school fee|institute)\b/.test(
      normalized
    )
  ) {
    return 'Fees & Payments';
  }

  if (
    /\b(electricity|electric|power|bescom|bses|tneb|water bill|gas bill|broadband|wifi|internet bill|utility|consumer number|meter number)\b/.test(
      normalized
    )
  ) {
    return 'Bills & Utilities';
  }

  if (
    /\b(warranty certificate|guarantee certificate|extended warranty|amc|service contract|applecare|warranty card)\b/.test(
      normalized
    )
  ) {
    return 'Warranty & Guarantee';
  }

  if (
    /\b(purchase agreement|sale deed|ownership deed|delivery proof|possession|title deed|sales agreement)\b/.test(
      normalized
    )
  ) {
    return 'Ownership & Purchase';
  }

  if (
    /\b(tax invoice|cash memo|retail invoice|bill of supply|sales receipt|pos receipt|invoice #|receipt #|gstin|store receipt)\b/.test(
      normalized
    )
  ) {
    return 'Receipts & Invoices';
  }

  return null;
}

/**
 * Normalizes document type given a category and raw text/signals.
 */
export function normalizeToCanonicalDocumentType(
  category: CanonicalDocumentCategory,
  rawType?: string | null
): CanonicalDocumentType {
  const clean = (rawType || '').trim().toLowerCase();

  switch (category) {
    case 'Vehicle Documents':
      if (clean.includes('insurance') || clean.includes('policy')) return 'Insurance';
      if (clean.includes('puc') || clean.includes('pollution')) return 'PUC';
      if (clean.includes('rc') || clean.includes('registration')) return 'RC';
      if (clean.includes('invoice')) return 'Vehicle Invoice';
      if (clean.includes('delivery')) return 'Delivery Document';
      return 'Insurance';

    case 'Fees & Payments':
      if (clean.includes('college') || clean.includes('university') || clean.includes('tuition')) {
        return 'College Fee Receipt';
      }
      if (clean.includes('challan')) return 'Fee Challan';
      return 'Payment Receipt';

    case 'Bills & Utilities':
      if (clean.includes('electric') || clean.includes('power') || clean.includes('energy')) {
        return 'Electricity Bill';
      }
      if (clean.includes('water')) return 'Water Bill';
      if (clean.includes('internet') || clean.includes('wifi') || clean.includes('broadband')) {
        return 'Internet Bill';
      }
      if (clean.includes('gas')) return 'Gas Bill';
      return 'Other Utility Bill';

    case 'Warranty & Guarantee':
      if (clean.includes('extended')) return 'Extended Warranty';
      if (clean.includes('guarantee')) return 'Guarantee Certificate';
      return 'Warranty Certificate';

    case 'Ownership & Purchase':
      if (clean.includes('agreement') || clean.includes('contract')) return 'Purchase Agreement';
      if (clean.includes('delivery')) return 'Delivery Proof';
      return 'Ownership Document';

    case 'Receipts & Invoices':
      if (clean.includes('invoice')) return 'Invoice';
      if (clean.includes('purchase bill') || clean.includes('bill')) return 'Purchase Bill';
      return 'Receipt';

    case 'Other Important Documents':
    default:
      return 'Other Important Document';
  }
}


export const DOCUMENT_CATEGORIES = CANONICAL_DOCUMENT_CATEGORIES.map((cat) => ({
  ...cat,
  category: cat.id,
}));

export const getDocumentCategoryConfig = (categoryOrName?: string | null): DocumentCategoryMeta => {
  return getDocumentCategoryMeta(categoryOrName);
};

export const normalizeDocumentCategory = (rawCategory?: string | null): CanonicalDocumentCategory => {
  return normalizeToCanonicalDocumentCategory(rawCategory) || 'Other Important Documents';
};

export const normalizeDocumentType = (
  category: CanonicalDocumentCategory,
  rawType?: string | null
): CanonicalDocumentType => {
  return normalizeToCanonicalDocumentType(category, rawType);
};

export const DOCUMENT_TYPES_BY_CATEGORY: Record<string, { type: CanonicalDocumentType; name: string }[]> = {
  'Receipts & Invoices': [
    { type: 'Receipt', name: 'Receipt' },
    { type: 'Invoice', name: 'Invoice' },
    { type: 'Purchase Bill', name: 'Purchase Bill' },
  ],
  receipts_invoices: [
    { type: 'Receipt', name: 'Receipt' },
    { type: 'Invoice', name: 'Invoice' },
    { type: 'Purchase Bill', name: 'Purchase Bill' },
  ],
  'Vehicle Documents': [
    { type: 'RC', name: 'Registration Certificate (RC)' },
    { type: 'Insurance', name: 'Motor Insurance Policy' },
    { type: 'PUC', name: 'Pollution Certificate (PUC)' },
    { type: 'Vehicle Invoice', name: 'Vehicle Invoice' },
    { type: 'Delivery Document', name: 'Delivery Proof' },
  ],
  vehicle_documents: [
    { type: 'RC', name: 'Registration Certificate (RC)' },
    { type: 'Insurance', name: 'Motor Insurance Policy' },
    { type: 'PUC', name: 'Pollution Certificate (PUC)' },
    { type: 'Vehicle Invoice', name: 'Vehicle Invoice' },
    { type: 'Delivery Document', name: 'Delivery Proof' },
  ],
  'Warranty & Guarantee': [
    { type: 'Warranty Certificate', name: 'Warranty Certificate' },
    { type: 'Guarantee Certificate', name: 'Guarantee Certificate' },
    { type: 'Extended Warranty', name: 'Extended Warranty' },
  ],
  warranty_guarantee: [
    { type: 'Warranty Certificate', name: 'Warranty Certificate' },
    { type: 'Guarantee Certificate', name: 'Guarantee Certificate' },
    { type: 'Extended Warranty', name: 'Extended Warranty' },
  ],
  'Fees & Payments': [
    { type: 'College Fee Receipt', name: 'College / Tuition Fee Receipt' },
    { type: 'Payment Receipt', name: 'Payment Receipt' },
    { type: 'Fee Challan', name: 'Fee Challan' },
  ],
  fees_payments: [
    { type: 'College Fee Receipt', name: 'College / Tuition Fee Receipt' },
    { type: 'Payment Receipt', name: 'Payment Receipt' },
    { type: 'Fee Challan', name: 'Fee Challan' },
  ],
  'Bills & Utilities': [
    { type: 'Electricity Bill', name: 'Electricity Bill' },
    { type: 'Water Bill', name: 'Water Bill' },
    { type: 'Internet Bill', name: 'Internet / Broadband Bill' },
    { type: 'Gas Bill', name: 'Piped Gas Bill' },
    { type: 'Other Utility Bill', name: 'Other Utility Bill' },
  ],
  bills_utilities: [
    { type: 'Electricity Bill', name: 'Electricity Bill' },
    { type: 'Water Bill', name: 'Water Bill' },
    { type: 'Internet Bill', name: 'Internet / Broadband Bill' },
    { type: 'Gas Bill', name: 'Piped Gas Bill' },
    { type: 'Other Utility Bill', name: 'Other Utility Bill' },
  ],
  'Ownership & Purchase': [
    { type: 'Ownership Document', name: 'Ownership Document' },
    { type: 'Purchase Agreement', name: 'Purchase Agreement' },
    { type: 'Delivery Proof', name: 'Proof of Delivery' },
  ],
  ownership_purchase: [
    { type: 'Ownership Document', name: 'Ownership Document' },
    { type: 'Purchase Agreement', name: 'Purchase Agreement' },
    { type: 'Delivery Proof', name: 'Proof of Delivery' },
  ],
  'Other Important Documents': [
    { type: 'Other Important Document', name: 'Other Important Document' },
  ],
  other_important: [
    { type: 'Other Important Document', name: 'Other Important Document' },
  ],
};

export function getDocumentTypeConfig(
  category?: string | null,
  docType?: string | null
): { name: string } {
  const normCat = normalizeToCanonicalDocumentCategory(category);
  const types: { type: CanonicalDocumentType; name: string }[] = normCat
    ? DOCUMENT_TYPES_BY_CATEGORY[normCat] || []
    : [];
  const found = types.find((t: { type: CanonicalDocumentType; name: string }) => t.type === docType || t.name === docType);
  return { name: found?.name || docType || 'Document' };
}
