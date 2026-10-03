
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
      { key: 'productName', label: 'Item / Product Name', placeholder: 'e.g. Lenovo IdeaPad Slim 3', type: 'text' },
      { key: 'brand', label: 'Brand / Manufacturer', placeholder: 'e.g. Lenovo', type: 'text' },
      { key: 'model', label: 'Model Number / Name', placeholder: 'e.g. IdeaPad Slim 3 15IAH8', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'e.g. Laptop', type: 'text' },
      { key: 'serialNumber', label: 'Serial Number (S/N)', placeholder: 'e.g. PF4ABC123456', type: 'text', sensitive: true, hint: 'Verify with device chassis, settings, or box' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'e.g. ₹40,990', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store / Seller', placeholder: 'e.g. Flipkart', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice / Receipt #', placeholder: 'e.g. FK-2026-9812', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period', placeholder: 'e.g. 1 Year Standard + 2 Yr Extended', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes / Included Accessories', placeholder: 'e.g. Includes charger and original box', type: 'text' },
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
      { key: 'productName', label: 'Item / Appliance Name', placeholder: 'e.g. Samsung 8kg Washing Machine', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'e.g. Samsung', type: 'text' },
      { key: 'modelNumber', label: 'Model Number', placeholder: 'e.g. WW80T504DAX', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'e.g. Washing Machine', type: 'text' },
      { key: 'serialNumber', label: 'Serial Number', placeholder: 'e.g. W80T504DAX1234', type: 'text', sensitive: true },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'e.g. ₹35,990', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store / Seller', placeholder: 'e.g. Reliance Digital', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice #', placeholder: 'e.g. RD-2026-8819', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period', placeholder: 'e.g. 2 Yr Comprehensive + 10 Yr Motor', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'installationDate', label: 'Installation Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'e.g. Includes inlet pipe, stand and cover', type: 'text' },
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
      { key: 'itemName', label: 'Item Name', placeholder: 'e.g. Nike Air Max 270', type: 'text' },
      { key: 'brand', label: 'Brand / Label', placeholder: 'e.g. Nike', type: 'text' },
      { key: 'itemType', label: 'Product Type', placeholder: 'e.g. Running Shoes', type: 'text' },
      { key: 'size', label: 'Size', placeholder: 'e.g. UK 9', type: 'text' },
      { key: 'color', label: 'Color / Pattern', placeholder: 'e.g. White / Navy Blue', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'e.g. ₹8,495', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'store', label: 'Store / Seller', placeholder: 'e.g. Myntra', type: 'text' },
      { key: 'invoiceNumber', label: 'Receipt / Till #', placeholder: 'e.g. ZARA-2026-38291', type: 'text' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'e.g. Includes extra laces and original box', type: 'text' },
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
      { key: 'vehicleName', label: 'Vehicle Name', placeholder: 'e.g. Hyundai Creta', type: 'text' },
      { key: 'brand', label: 'Brand / Make', placeholder: 'e.g. Hyundai', type: 'text' },
      { key: 'model', label: 'Model', placeholder: 'e.g. Creta', type: 'text' },
      { key: 'variant', label: 'Variant / Trim', placeholder: 'e.g. SX(O) Diesel', type: 'text' },
      { key: 'purchasePrice', label: 'On-Road / Invoice Price', placeholder: 'e.g. ₹14,50,000', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'dealer', label: 'Authorized Dealer', placeholder: 'e.g. ABC Motors', type: 'text' },
      { key: 'registrationNumber', label: 'Registration #', placeholder: 'e.g. UP16AB1234', type: 'text', sensitive: true },
      { key: 'vin', label: 'VIN / Chassis #', placeholder: 'e.g. MA1XXXXXXXXXXXXXX', type: 'text', sensitive: true, hint: 'Never invent or approximate VIN' },
      { key: 'engineNumber', label: 'Engine Number', placeholder: 'e.g. D4FXXXXXXX', type: 'text', sensitive: true },
      { key: 'invoiceNumber', label: 'Tax Invoice Number', placeholder: 'e.g. HONDA-2026-7712', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period (if known)', placeholder: 'e.g. 3 Years / 100,000 km', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'insuranceExpiry', label: 'Insurance Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'odometerReading', label: 'Odometer Reading (km)', placeholder: 'e.g. 15 km (delivery)', type: 'text' },
      { key: 'serviceDueDate', label: 'First / Next Service Due', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'e.g. Purchased from ABC Motors with extended warranty', type: 'text' },
    ],
  },

  Furniture: {
    canonical: 'Furniture',
    internalCode: 'furniture',
    label: 'Furniture',
    icon: 'chair',
    description: 'Beds, desks, sofas, dining tables, wardrobes & chairs',
    fields: [
      { key: 'itemName', label: 'Item Name', placeholder: 'e.g. 3-Seater Sofa', type: 'text' },
      { key: 'brand', label: 'Brand / Maker', placeholder: 'e.g. Wakefit', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'e.g. Sofa', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'e.g. ₹18,999', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store / Seller', placeholder: 'e.g. Wakefit or IKEA', type: 'text' },
      { key: 'material', label: 'Material & Construction', placeholder: 'e.g. Solid Teak Wood, Foam Cushioning', type: 'text' },
      { key: 'color', label: 'Color / Finish', placeholder: 'e.g. Walnut Brown / Charcoal Grey', type: 'text' },
      { key: 'dimensions', label: 'Dimensions (W x D x H)', placeholder: 'e.g. 185cm x 85cm x 80cm', type: 'text' },
      { key: 'room', label: 'Room / Placement', placeholder: 'e.g. Living Room', type: 'text' },
      { key: 'invoiceNumber', label: 'Order / Invoice #', placeholder: 'e.g. WF-2026-1044', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period (if applicable)', placeholder: 'e.g. 3-Year Structural Warranty', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'e.g. Includes cushions and assembly manual', type: 'text' },
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
      { key: 'itemName', label: 'Item Name', placeholder: 'e.g. Olympic Barbell', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'e.g. Decathlon', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'e.g. Barbell', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'e.g. ₹5,499', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store / Seller', placeholder: 'e.g. Decathlon', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice / Order #', placeholder: 'e.g. DEC-2026-9912', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period (if applicable)', placeholder: 'e.g. 2 Years Frame Warranty', type: 'text' },
      { key: 'warrantyExpiry', label: 'Warranty Expiry Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'e.g. Includes collar clips and knurled grip', type: 'text' },
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
      { key: 'itemName', label: 'Item Name', placeholder: 'e.g. Dyson Supersonic Hair Dryer', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'e.g. Dyson', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'e.g. Hair Dryer', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'e.g. ₹34,900', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store / Seller', placeholder: 'e.g. Nykaa', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice / Receipt #', placeholder: 'e.g. NYK-2026-4412', type: 'text' },
      { key: 'returnUntil', label: 'Return Deadline', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'e.g. Includes magnetic styling attachments', type: 'text' },
    ],
  },

  Other: {
    canonical: 'Other',
    internalCode: 'other',
    label: 'Other Asset',
    icon: 'inventory-2',
    description: 'Miscellaneous purchases, collectibles, tools & valuables',
    fields: [
      { key: 'itemName', label: 'Asset Name', placeholder: 'e.g. DJI Mini 4 Pro', type: 'text' },
      { key: 'brand', label: 'Brand / Manufacturer', placeholder: 'e.g. DJI', type: 'text' },
      { key: 'productType', label: 'Product Type', placeholder: 'e.g. Drone', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'e.g. ₹75,000', type: 'number' },
      { key: 'purchaseDate', label: 'Purchase Date', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'seller', label: 'Store / Seller', placeholder: 'e.g. Amazon', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice #', placeholder: 'e.g. INV-2026-001', type: 'text' },
      { key: 'notes', label: 'Asset Details & Serial', placeholder: 'e.g. Includes Fly More Combo accessories', type: 'text' },
    ],
  },

  'Mobile & Laptop': {
    canonical: 'Electronics',
    internalCode: 'electronics',
    label: 'Electronics',
    icon: 'devices',
    description: 'Smartphones, laptops, handheld computers & peripherals',
    fields: [
      { key: 'productName', label: 'Device / Model Name', placeholder: 'e.g. Lenovo IdeaPad Slim 3', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'e.g. Lenovo', type: 'text' },
      { key: 'model', label: 'Model Number', placeholder: 'e.g. IdeaPad Slim 3 15IAH8', type: 'text' },
      { key: 'serialNumber', label: 'Serial Number (S/N)', placeholder: 'e.g. PF4ABC123456', type: 'text', sensitive: true },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'e.g. ₹40,990', type: 'number' },
      { key: 'seller', label: 'Authorized Seller / Store', placeholder: 'e.g. Flipkart', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice / Receipt #', placeholder: 'e.g. FK-2026-12345', type: 'text' },
      { key: 'warrantyPeriod', label: 'Warranty Period', placeholder: 'e.g. 1 Year Standard + 2 Yr Extended', type: 'text' },
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
      { key: 'productName', label: 'Appliance Name', placeholder: 'e.g. Samsung 8kg Washing Machine', type: 'text' },
      { key: 'brand', label: 'Brand', placeholder: 'e.g. Samsung', type: 'text' },
      { key: 'modelNumber', label: 'Model Number', placeholder: 'e.g. WW80T504DAX', type: 'text' },
      { key: 'purchasePrice', label: 'Purchase Price', placeholder: 'e.g. ₹35,990', type: 'number' },
      { key: 'seller', label: 'Seller / Dealer', placeholder: 'e.g. Reliance Digital', type: 'text' },
      { key: 'invoiceNumber', label: 'Invoice #', placeholder: 'e.g. RD-2026-8819', type: 'text' },
    ],
  },

  Documents: {
    canonical: 'Documents',
    internalCode: 'documents',
    label: 'Documents',
    icon: 'description',
    description: 'Ownership deeds, warranties, passports, insurance policies & bills',
    fields: [
      { key: 'documentName', label: 'Document Name', placeholder: 'e.g. College Fee Receipt — Semester 7', type: 'text' },
      { key: 'documentType', label: 'Document Classification', placeholder: 'e.g. Fee Receipt, Insurance, Warranty', type: 'text' },
      { key: 'issuer', label: 'Issuing Authority / Company', placeholder: 'e.g. KCC Institute of Technology & Management', type: 'text' },
      { key: 'documentNumber', label: 'Certificate / Policy Number', placeholder: 'e.g. RECEIPT-2026-1042', type: 'text', sensitive: true },
      { key: 'issueDate', label: 'Date of Issue', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'expiryDate', label: 'Expiry / Valid Through', placeholder: 'YYYY-MM-DD', type: 'date' },
      { key: 'notes', label: 'Notes', placeholder: 'e.g. Semester 7 tuition fee', type: 'text' },
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
