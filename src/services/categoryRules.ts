
import { CanonicalCategory, ScannerCategory } from '../types/scanner';

export interface CategoryFieldDef {
  key: string;
  label: string;
  placeholder?: string;
  type: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  required?: boolean;
  sensitive?: boolean; // Highlight for user verification (serials, IMEIs, VINs)
  hint?: string;
}

export interface CategoryRuleConfig {
  canonical: CanonicalCategory;
  internalCode: ScannerCategory;
  label: string;
  icon: string;
  description: string;
  fields: CategoryFieldDef[];
}

export const CANONICAL_CATEGORIES: CanonicalCategory[] = [
  'Electronics',
  'Home & Appliances',
  'Fashion',
  'Vehicle',
  'Furniture',
  'Sports & Fitness',
  'Beauty & Personal Care',
  'Other',
  'Mobile & Laptop',
  'Home Appliance',
  'Documents',
];

export const CATEGORY_RULES: Record<CanonicalCategory, CategoryRuleConfig> = {
  Electronics: {
    canonical: 'Electronics',
    internalCode: 'electronics',
    label: 'Electronics',
    icon: 'devices',
    description: 'Laptops, smartphones, audio, TVs, cameras, consoles & personal tech',
    fields: [
      { key: 'productName', label: 'Item Name', placeholder: 'Enter item name', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'Enter brand name', type: 'text' },
      { key: 'model', label: 'Model Number', placeholder: 'Enter model number', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'Enter product type', type: 'text' },
      { key: 'serialNumber', label: 'Serial Number', placeholder: 'Enter serial number', type: 'text', sensitive: true, hint: 'Verify with device chassis, settings, or box' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store', placeholder: 'Enter store or merchant name', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Enter invoice number', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period', placeholder: 'Enter warranty period', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'Add notes (optional)', type: 'text' },
      {
        key: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['Brand New', 'Like New', 'Refurbished', 'Used'],
      },
    ],
  },

  'Home & Appliances': {
    canonical: 'Home & Appliances',
    internalCode: 'home_appliance',
    label: 'Home & Appliances',
    icon: 'kitchen',
    description: 'Refrigerators, washing machines, ACs, microwaves & kitchen appliances',
    fields: [
      { key: 'productName', label: 'Appliance Name', placeholder: 'Enter appliance name', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'Enter brand name', type: 'text' },
      { key: 'modelNumber', label: 'Model Number', placeholder: 'Enter model number', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'Enter product type', type: 'text' },
      { key: 'serialNumber', label: 'Serial Number', placeholder: 'Enter serial number', type: 'text', sensitive: true },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store', placeholder: 'Enter store or merchant name', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Enter invoice number', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period', placeholder: 'Enter warranty period', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'installationDate', label: 'Installation Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'Add notes (optional)', type: 'text' },
      {
        key: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['Brand New', 'Like New', 'Refurbished'],
      },
    ],
  },

  Fashion: {
    canonical: 'Fashion',
    internalCode: 'fashion',
    label: 'Fashion',
    icon: 'checkroom',
    description: 'Clothing, footwear, watches, bags, and luxury apparel',
    fields: [
      { key: 'itemName', label: 'Item Name', placeholder: 'Enter item name', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'Enter brand or label', type: 'text' },
      { key: 'itemType', label: 'Product Type', placeholder: 'Enter product type', type: 'text' },
      { key: 'size', label: 'Size', placeholder: 'Enter size', type: 'text' },
      { key: 'color', label: 'Color', placeholder: 'Enter color', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'store', label: 'Store', placeholder: 'Enter store or merchant name', type: 'text' },
      { key: 'invoiceNumber', label: 'Receipt Number', placeholder: 'Enter invoice or till number', type: 'text' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'Add notes (optional)', type: 'text' },
      {
        key: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['Brand New with Tags', 'Pristine', 'Pre-owned'],
      },
    ],
  },

  Vehicle: {
    canonical: 'Vehicle',
    internalCode: 'vehicle',
    label: 'Vehicle',
    icon: 'directions-car',
    description: 'Cars, motorcycles, EVs, scooters & personal transport',
    fields: [
      { key: 'vehicleName', label: 'Vehicle Name', placeholder: 'Enter vehicle name', type: 'text' },
      { key: 'brand', label: 'Make', placeholder: 'Enter make or brand', type: 'text' },
      { key: 'model', label: 'Model', placeholder: 'Enter model name', type: 'text' },
      { key: 'variant', label: 'Variant', placeholder: 'Enter variant or trim', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'dealer', label: 'Dealership', placeholder: 'Enter dealership name', type: 'text' },
      { key: 'registrationNumber', label: 'Registration Number', placeholder: 'Enter registration number', type: 'text', sensitive: true },
      { key: 'vin', label: 'VIN', placeholder: 'Enter VIN or chassis number', type: 'text', sensitive: true, hint: 'Never invent or approximate VIN' },
      { key: 'engineNumber', label: 'Engine Number', placeholder: 'Enter engine number', type: 'text', sensitive: true },
      { key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Enter invoice number', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period', placeholder: 'Enter warranty period', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'insuranceExpiry', label: 'Insurance Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'odometerReading', label: 'Odometer Reading (km)', placeholder: 'Enter odometer reading', type: 'text' },
      { key: 'serviceDueDate', label: 'Next Service Due', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'Add notes (optional)', type: 'text' },
    ],
  },

  Furniture: {
    canonical: 'Furniture',
    internalCode: 'furniture',
    label: 'Furniture',
    icon: 'chair',
    description: 'Beds, desks, sofas, dining tables, wardrobes & chairs',
    fields: [
      { key: 'itemName', label: 'Item Name', placeholder: 'Enter furniture name', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'Enter brand or maker', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'Enter product type', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store', placeholder: 'Enter store or merchant name', type: 'text' },
      { key: 'material', label: 'Material', placeholder: 'Enter material', type: 'text' },
      { key: 'color', label: 'Finish', placeholder: 'Enter color or finish', type: 'text' },
      { key: 'dimensions', label: 'Dimensions', placeholder: 'Enter dimensions', type: 'text' },
      { key: 'room', label: 'Room', placeholder: 'Enter room or placement', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Enter invoice number', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period', placeholder: 'Enter warranty period', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'Add notes (optional)', type: 'text' },
      {
        key: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['Brand New', 'Like New', 'Floor Sample', 'Vintage'],
      },
    ],
  },

  'Sports & Fitness': {
    canonical: 'Sports & Fitness',
    internalCode: 'sports',
    label: 'Sports & Fitness',
    icon: 'fitness-center',
    description: 'Gym equipment, sports gear, bicycles & outdoor fitness',
    fields: [
      { key: 'itemName', label: 'Item Name', placeholder: 'Enter item name', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'Enter brand name', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'Enter product type', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store', placeholder: 'Enter store or merchant name', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Enter invoice number', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period', placeholder: 'Enter warranty period', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'Add notes (optional)', type: 'text' },
      {
        key: 'condition',
        label: 'Condition',
        type: 'select',
        options: ['Brand New', 'Like New', 'Used'],
      },
    ],
  },

  'Beauty & Personal Care': {
    canonical: 'Beauty & Personal Care',
    internalCode: 'beauty',
    label: 'Beauty & Personal Care',
    icon: 'spa',
    description: 'Personal grooming, skincare, fragrance, styling & wellness',
    fields: [
      { key: 'itemName', label: 'Item Name', placeholder: 'Enter item name', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'Enter brand name', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'Enter product type', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store', placeholder: 'Enter store or merchant name', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Enter invoice number', type: 'text' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'Add notes (optional)', type: 'text' },
    ],
  },

  Other: {
    canonical: 'Other',
    internalCode: 'other',
    label: 'Other Asset',
    icon: 'inventory-2',
    description: 'Miscellaneous purchases, collectibles, tools & valuables',
    fields: [
      { key: 'itemName', label: 'Item Name', placeholder: 'Enter item name', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'Enter brand name', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'Enter product type', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store', placeholder: 'Enter store or merchant name', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Enter invoice number', type: 'text' },
      { key: 'notes', label: 'Notes', placeholder: 'Add notes (optional)', type: 'text' },
    ],
  },

  'Mobile & Laptop': {
    canonical: 'Electronics',
    internalCode: 'electronics',
    label: 'Electronics',
    icon: 'devices',
    description: 'Smartphones, laptops, handheld computers & peripherals',
    fields: [
      { key: 'productName', label: 'Device Name', placeholder: 'Enter device name', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'Enter brand name', type: 'text' },
      { key: 'model', label: 'Model Number', placeholder: 'Enter model number', type: 'text' },
      { key: 'serialNumber', label: 'Serial Number', placeholder: 'Enter serial number', type: 'text', sensitive: true },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'seller', label: 'Store', placeholder: 'Enter store or merchant name', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Enter invoice number', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period', placeholder: 'Enter warranty period', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
    ],
  },

  'Home Appliance': {
    canonical: 'Home & Appliances',
    internalCode: 'home_appliance',
    label: 'Home & Appliances',
    icon: 'kitchen',
    description: 'Refrigerators, washing machines, ACs, microwaves & dishwashers',
    fields: [
      { key: 'productName', label: 'Appliance Name', placeholder: 'Enter appliance name', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'Enter brand name', type: 'text' },
      { key: 'modelNumber', label: 'Model Number', placeholder: 'Enter model number', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'Enter purchase price', type: 'number' },
      { key: 'seller', label: 'Store', placeholder: 'Enter store or merchant name', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice Number', placeholder: 'Enter invoice number', type: 'text' },
    ],
  },

  Documents: {
    canonical: 'Documents',
    internalCode: 'documents',
    label: 'Documents',
    icon: 'description',
    description: 'Ownership deeds, warranties, passports, insurance policies & bills',
    fields: [
      { key: 'documentName', label: 'Document Name', placeholder: 'Enter document title', type: 'text' },
      { key: 'documentType', label: 'Document Type', placeholder: 'Enter document type', type: 'text' },
      { key: 'issuer', label: 'Issuing Authority', placeholder: 'Enter issuer name', type: 'text' },
      { key: 'documentNumber', label: 'Document Number', placeholder: 'Enter reference number', type: 'text', sensitive: true },
      { key: 'issueDate', label: 'Date of Issue', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'expiryDate', label: 'Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'Add notes (optional)', type: 'text' },
    ],
  },
};

/**
 * Normalizes any category string or code to the canonical 8 categories.
 * If uncertain or unrecognized, strictly returns 'Other'. Never invents a category.
 */
export function normalizeToCanonicalCategory(input: any): CanonicalCategory {
  if (!input) return 'Other';
  let strValue = '';
  if (typeof input === 'string') {
    strValue = input;
  } else if (typeof input === 'object' && input !== null) {
    strValue = typeof input.value === 'string' ? input.value : (input.name || input.category || '');
  } else {
    strValue = String(input);
  }
  const clean = strValue.trim().toLowerCase();
  if (!clean) return 'Other';

  if (
    clean.includes('laptop') ||
    clean.includes('mobile') ||
    clean.includes('phone') ||
    clean.includes('smartphone') ||
    clean.includes('macbook') ||
    clean.includes('ideapad') ||
    clean.includes('thinkpad') ||
    clean.includes('zenbook') ||
    clean.includes('tablet') ||
    clean.includes('ipad') ||
    clean.includes('computer') ||
    clean.includes('pc') ||
    clean.includes('desktop') ||
    clean.includes('electronic') ||
    clean.includes('audio') ||
    clean.includes('tv') ||
    clean.includes('television') ||
    clean.includes('speaker') ||
    clean.includes('camera') ||
    clean.includes('headphone') ||
    clean.includes('earphone') ||
    clean.includes('console')
  ) {
    return 'Electronics';
  }

  if (
    clean.includes('appliance') ||
    clean.includes('refrigerator') ||
    clean.includes('fridge') ||
    clean.includes('washing') ||
    clean.includes('ac') ||
    clean.includes('air conditioner') ||
    clean.includes('microwave') ||
    clean.includes('kitchen') ||
    clean.includes('dishwasher') ||
    clean.includes('purifier')
  ) {
    return 'Home & Appliances';
  }

  if (
    clean.includes('vehicle') ||
    clean.includes('car') ||
    clean.includes('bike') ||
    clean.includes('motorcycle') ||
    clean.includes('scooter') ||
    clean.includes('auto') ||
    clean.includes('automobile') ||
    clean.includes('ev')
  ) {
    return 'Vehicle';
  }

  if (
    clean.includes('furniture') ||
    clean.includes('desk') ||
    clean.includes('chair') ||
    clean.includes('sofa') ||
    clean.includes('bed') ||
    clean.includes('table') ||
    clean.includes('wardrobe')
  ) {
    return 'Furniture';
  }

  if (
    clean.includes('fashion') ||
    clean.includes('apparel') ||
    clean.includes('clothing') ||
    clean.includes('shoe') ||
    clean.includes('footwear') ||
    clean.includes('sneaker') ||
    clean.includes('watch') ||
    clean.includes('coat') ||
    clean.includes('dress') ||
    clean.includes('shirt')
  ) {
    return 'Fashion';
  }

  if (
    clean.includes('sport') ||
    clean.includes('fitness') ||
    clean.includes('gym') ||
    clean.includes('treadmill') ||
    clean.includes('dumbbell') ||
    clean.includes('bicycle') ||
    clean.includes('cycle')
  ) {
    return 'Sports & Fitness';
  }

  if (
    clean.includes('beauty') ||
    clean.includes('cosmetic') ||
    clean.includes('skincare') ||
    clean.includes('makeup') ||
    clean.includes('perfume') ||
    clean.includes('fragrance') ||
    clean.includes('grooming')
  ) {
    return 'Beauty & Personal Care';
  }

  if (
    clean.includes('document') ||
    clean.includes('certificate') ||
    clean.includes('insurance') ||
    clean.includes('policy') ||
    clean.includes('warranty card')
  ) {
    return 'Documents';
  }

  for (const cat of CANONICAL_CATEGORIES) {
    if (cat.toLowerCase() === clean) {
      if (cat === 'Mobile & Laptop') return 'Electronics';
      if (cat === 'Home Appliance') return 'Home & Appliances';
      return cat;
    }
  }

  return 'Other';
}

/**
 * Convert canonical category to internal scanner code
 */
export function canonicalToScannerCode(canonical: CanonicalCategory): ScannerCategory {
  return CATEGORY_RULES[canonical]?.internalCode || 'other';
}

/**
 * Convert internal scanner code to canonical category
 */
export function scannerCodeToCanonical(code: ScannerCategory): CanonicalCategory {
  for (const rule of Object.values(CATEGORY_RULES)) {
    if (rule.internalCode === code) {
      return rule.canonical;
    }
  }
  return 'Other';
}
