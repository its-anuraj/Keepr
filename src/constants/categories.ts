import { ItemCategory } from '../types';

export const DEFAULT_CATEGORIES: ItemCategory[] = [
  {
    id: 'electronics',
    name: 'Electronics',
    icon: 'devices',
    description: 'Computers, smartphones, audio gear, and personal devices',
    sortOrder: 1,
  },
  {
    id: 'appliances',
    name: 'Home & Appliances',
    icon: 'kitchen',
    description: 'Refrigerators, air conditioners, washing machines, kitchen equipment',
    sortOrder: 2,
  },
  {
    id: 'fashion',
    name: 'Fashion',
    icon: 'checkroom',
    description: 'Clothing, shoes, bags, and apparel',
    sortOrder: 3,
  },
  {
    id: 'vehicles',
    name: 'Vehicle',
    icon: 'directions-car',
    description: 'Automobiles, motorcycles, bicycles, and personal transport',
    sortOrder: 4,
  },
  {
    id: 'furniture',
    name: 'Furniture',
    icon: 'chair',
    description: 'Desks, chairs, tables, sofas, and interior furniture',
    sortOrder: 5,
  },
  {
    id: 'sports',
    name: 'Sports & Fitness',
    icon: 'fitness-center',
    description: 'Gym gear, sports equipment, outdoor and fitness items',
    sortOrder: 6,
  },
  {
    id: 'beauty',
    name: 'Beauty & Personal Care',
    icon: 'spa',
    description: 'Personal grooming, skincare, fragrance, and wellness',
    sortOrder: 7,
  },
  {
    id: 'other',
    name: 'Other',
    icon: 'inventory-2',
    description: 'Miscellaneous purchases and personal property',
    sortOrder: 8,
  },
];

export const CATEGORY_PRODUCT_TYPES: Record<string, string[]> = {
  electronics: [
    'Mobile',
    'Laptop',
    'PC',
    'Tablet',
    'TV',
    'Headphones',
    'Audio & Speakers',
    'Camera',
    'Gaming',
    'Smartwatch',
    'Other',
  ],
  appliances: [
    'Refrigerator',
    'Washing Machine',
    'Air Conditioner',
    'Microwave',
    'Vacuum Cleaner',
    'Kitchen Appliance',
    'Water Purifier',
    'Geyser',
    'Other',
  ],
  fashion: [
    'Clothing',
    'Shoes',
    'Bags',
    'Accessories',
    'Watch',
    'Eyewear',
    'Other',
  ],
  vehicles: [
    'Car',
    'Motorcycle',
    'Scooter',
    'Bicycle',
    'Parts & Accessories',
    'Service',
    'Other',
  ],
  furniture: [
    'Desk',
    'Chair',
    'Table',
    'Sofa',
    'Bed',
    'Storage & Wardrobe',
    'Other',
  ],
  sports: [
    'Gym Equipment',
    'Bicycle',
    'Sports Gear',
    'Outdoor & Camping',
    'Yoga & Fitness',
    'Other',
  ],
  beauty: [
    'Skincare',
    'Haircare',
    'Fragrance',
    'Makeup',
    'Grooming Device',
    'Other',
  ],
  other: [
    'General',
    'Tools & Hardware',
    'Books & Media',
    'Toys',
    'Other',
  ],
};

export function getProductTypesForCategory(categoryId?: string | null): string[] {
  if (!categoryId) return [];
  return CATEGORY_PRODUCT_TYPES[categoryId] || [];
}

export interface CategoryDetectionContext {
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  merchant?: string | null;
  rawText?: string | null;
}

export interface CategoryDetectionResult {
  categoryId: string | null;
  productType: string | null;
  confidence: 'high' | 'medium' | 'low';
  score: number;
}

/**
 * Multi-signal contextual intelligence for category and product type classification.
 * Strictly adheres to NO-FABRICATION rule: if signals are weak or ambiguous, returns low confidence
 * and null categoryId so the user can choose manually.
 */
export function detectCategoryAndProductType(
  ctx: CategoryDetectionContext
): CategoryDetectionResult {
  const combined = [
    ctx.name || '',
    ctx.brand || '',
    ctx.model || '',
    ctx.merchant || '',
    ctx.rawText || '',
  ]
    .join(' ')
    .toLowerCase();

  if (!combined.trim()) {
    return { categoryId: null, productType: null, confidence: 'low', score: 0 };
  }

  if (
    /\b(iphone|galaxy s\d+|pixel \d+|oneplus|smartphone|mobile|android phone|ios phone)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'Mobile', confidence: 'high', score: 0.96 };
  }
  if (
    /\b(macbook|thinkpad|zenbook|laptop|notebook|chromebook|ideapad|pavilion|xps \d+)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'Laptop', confidence: 'high', score: 0.96 };
  }
  if (
    /\b(desktop pc|gaming pc|imac|workstation|motherboard|graphics card|rtx \d+|ryzen|intel core|cpu cabinet)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'PC', confidence: 'high', score: 0.94 };
  }
  if (
    /\b(ipad|tablet|galaxy tab|kindle fire)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'Tablet', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(oled tv|qled tv|smart tv|bravia|television|4k uhd tv|led tv|\btv\b)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'TV', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(headphones|wh-1000|airpods|earbuds|earphones|headset|soundbar|bluetooth speaker|bose|jbl|sennheiser)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'Headphones', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(dslr|mirrorless camera|canon eos|sony alpha|nikon z|gopro)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'Camera', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(playstation|ps5|xbox|nintendo switch|gaming console)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'Gaming', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(apple watch|galaxy watch|smartwatch|fitness tracker|garmin)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'Smartwatch', confidence: 'high', score: 0.94 };
  }
  if (
    /\b(hdmi|hdmi cable|usb cable|type-c|lightning cable|charging cable|aux cable|ethernet|power cord|adapter|charger|power bank|pendrive|flash drive|ssd|external hdd|mouse|keyboard|monitor)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'Other', confidence: 'high', score: 0.92 };
  }
  if (
    /\b(croma|reliance digital|apple store|sony center|electronics)\b/.test(combined) &&
    /\b(gadget|device|monitor|display|charger|adapter)\b/.test(combined)
  ) {
    return { categoryId: 'electronics', productType: 'Other', confidence: 'medium', score: 0.80 };
  }

  if (
    /\b(refrigerator|fridge|freezer|frost free|double door fridge)\b/.test(combined)
  ) {
    return { categoryId: 'appliances', productType: 'Refrigerator', confidence: 'high', score: 0.96 };
  }
  if (
    /\b(washing machine|front load washer|top load washer|dryer)\b/.test(combined)
  ) {
    return { categoryId: 'appliances', productType: 'Washing Machine', confidence: 'high', score: 0.96 };
  }
  if (
    /\b(air conditioner|split ac|inverter ac|window ac|daikin|voltas|blue star)\b/.test(combined)
  ) {
    return { categoryId: 'appliances', productType: 'Air Conditioner', confidence: 'high', score: 0.96 };
  }
  if (
    /\b(microwave|convection oven|otg oven|air fryer)\b/.test(combined)
  ) {
    return { categoryId: 'appliances', productType: 'Microwave', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(vacuum cleaner|roomba|robot vacuum|dyson v\d+)\b/.test(combined)
  ) {
    return { categoryId: 'appliances', productType: 'Vacuum Cleaner', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(mixer grinder|blender|food processor|juicer|toaster|kettle|induction cooktop)\b/.test(combined)
  ) {
    return { categoryId: 'appliances', productType: 'Kitchen Appliance', confidence: 'high', score: 0.94 };
  }
  if (
    /\b(water purifier|ro purifier|kent ro|aquaguard)\b/.test(combined)
  ) {
    return { categoryId: 'appliances', productType: 'Water Purifier', confidence: 'high', score: 0.95 };
  }

  if (
    /\b(sneakers|shoes|running shoes|boots|loafers|sandals|air max|ultraboost|jordan|crocs)\b/.test(combined)
  ) {
    return { categoryId: 'fashion', productType: 'Shoes', confidence: 'high', score: 0.96 };
  }
  if (
    /\b(t-shirt|shirt|jeans|trousers|jacket|hoodie|sweater|blazer|dress|skirt|kurta|suit|denim)\b/.test(combined)
  ) {
    return { categoryId: 'fashion', productType: 'Clothing', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(handbag|backpack|tote bag|wallet|purse|duffel bag|luggage|samsonite)\b/.test(combined)
  ) {
    return { categoryId: 'fashion', productType: 'Bags', confidence: 'high', score: 0.94 };
  }
  if (
    /\b(sunglasses|eyeglasses|ray-ban|oakley|frames)\b/.test(combined)
  ) {
    return { categoryId: 'fashion', productType: 'Eyewear', confidence: 'high', score: 0.94 };
  }
  if (
    /\b(watch|chronograph|analogue watch|fossil|titan|seiko|tissot|rolex)\b/.test(combined) &&
    !/\b(smartwatch|apple watch)\b/.test(combined)
  ) {
    return { categoryId: 'fashion', productType: 'Watch', confidence: 'high', score: 0.93 };
  }
  if (
    /\b(zara|h&m|uniqlo|levi's|mango|marks & spencer)\b/.test(combined)
  ) {
    return { categoryId: 'fashion', productType: 'Clothing', confidence: 'medium', score: 0.85 };
  }

  if (
    /\b(car|sedan|suv|hatchback|hyundai|maruti|toyota|tata motors|mahindra|honda city|creta)\b/.test(combined)
  ) {
    return { categoryId: 'vehicles', productType: 'Car', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(motorcycle|motorbike|royal enfield|classic 350|honda cb350|ktm duke|yamaha r15|bullet)\b/.test(combined)
  ) {
    return { categoryId: 'vehicles', productType: 'Motorcycle', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(scooter|activa|jupiter|vespa|ather|ola electric|chetak)\b/.test(combined)
  ) {
    return { categoryId: 'vehicles', productType: 'Scooter', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(bicycle|mountain bike|road bike|hybrid cycle|giant|trek|firefox)\b/.test(combined)
  ) {
    return { categoryId: 'vehicles', productType: 'Bicycle', confidence: 'high', score: 0.94 };
  }
  if (
    /\b(engine oil|tires|tyres|brake pads|car battery|michelin|mrf|castrol|servicing|puc)\b/.test(combined)
  ) {
    return { categoryId: 'vehicles', productType: 'Parts & Accessories', confidence: 'high', score: 0.93 };
  }

  if (
    /\b(desk|standing desk|computer table|workstation desk)\b/.test(combined)
  ) {
    return { categoryId: 'furniture', productType: 'Desk', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(office chair|ergonomic chair|markus chair|gaming chair|armchair)\b/.test(combined)
  ) {
    return { categoryId: 'furniture', productType: 'Chair', confidence: 'high', score: 0.96 };
  }
  if (
    /\b(dining table|coffee table|side table|study table)\b/.test(combined)
  ) {
    return { categoryId: 'furniture', productType: 'Table', confidence: 'high', score: 0.94 };
  }
  if (
    /\b(sofa|couch|recliner|section sofa|sofa bed)\b/.test(combined)
  ) {
    return { categoryId: 'furniture', productType: 'Sofa', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(bed|mattress|king size bed|queen size bed|wakefit|sleepwell)\b/.test(combined)
  ) {
    return { categoryId: 'furniture', productType: 'Bed', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(ikea|pepperfry|urban ladder|west elm)\b/.test(combined)
  ) {
    return { categoryId: 'furniture', productType: 'Other', confidence: 'medium', score: 0.82 };
  }

  if (
    /\b(dumbbells?|barbells?|kettlebells?|weights?|weight plates?|bench press|treadmills?|exercise bikes?|ellipticals?|gym equipments?)\b/.test(combined)
  ) {
    return { categoryId: 'sports', productType: 'Gym Equipment', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(yoga mat|resistance band|foam roller|pull up bar)\b/.test(combined)
  ) {
    return { categoryId: 'sports', productType: 'Yoga & Fitness', confidence: 'high', score: 0.94 };
  }
  if (
    /\b(badminton racket|tennis racket|cricket bat|football|basketball|yonex|wilson)\b/.test(combined)
  ) {
    return { categoryId: 'sports', productType: 'Sports Gear', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(camping tent|sleeping bag|trekking pole|hiking backpack|quechua|decathlon)\b/.test(combined)
  ) {
    return { categoryId: 'sports', productType: 'Outdoor & Camping', confidence: 'high', score: 0.94 };
  }

  if (
    /\b(skincare|moisturizer|face serum|cleanser|sunscreen|face cream|toner|retinol|hyaluronic)\b/.test(combined)
  ) {
    return { categoryId: 'beauty', productType: 'Skincare', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(perfume|eau de parfum|cologne|fragrance|deodorant|dior sauvage|bleu de chanel)\b/.test(combined)
  ) {
    return { categoryId: 'beauty', productType: 'Fragrance', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(hair dryer|airwrap|hair straightener|trimmer|shaver|philips oneblade|dyson supersonic)\b/.test(combined)
  ) {
    return { categoryId: 'beauty', productType: 'Grooming Device', confidence: 'high', score: 0.95 };
  }
  if (
    /\b(shampoo|conditioner|hair oil|hair serum|kerastase|olaplex)\b/.test(combined)
  ) {
    return { categoryId: 'beauty', productType: 'Haircare', confidence: 'high', score: 0.94 };
  }
  if (
    /\b(lipstick|foundation|mascara|eyeliner|palette|sephora|nykaa|mac cosmetics)\b/.test(combined)
  ) {
    return { categoryId: 'beauty', productType: 'Makeup', confidence: 'high', score: 0.94 };
  }

  return {
    categoryId: null,
    productType: null,
    confidence: 'low',
    score: 0.35,
  };
}

export function getCategoryNameFromId(categoryId?: string | null): string {
  if (!categoryId) return 'Other';
  const cat = DEFAULT_CATEGORIES.find((c) => c.id === categoryId);
  return cat ? cat.name : 'Other';
}

export function getCategoryIdFromName(categoryName?: string | null): string {
  if (!categoryName) return 'other';
  const clean = categoryName.trim().toLowerCase();
  const cat = DEFAULT_CATEGORIES.find(
    (c) => c.name.toLowerCase() === clean || c.id.toLowerCase() === clean
  );
  if (cat) return cat.id;
  if (clean.includes('electr')) return 'electronics';
  if (clean.includes('applian') || clean.includes('home')) return 'appliances';
  if (clean.includes('fash') || clean.includes('cloth')) return 'fashion';
  if (clean.includes('vehic') || clean.includes('car') || clean.includes('bike')) return 'vehicles';
  if (clean.includes('furn')) return 'furniture';
  if (clean.includes('sport') || clean.includes('fitn')) return 'sports';
  if (clean.includes('beaut') || clean.includes('person')) return 'beauty';
  return 'other';
}

export function normalizeToDbCategoryId(categoryOrId?: string | null): string {
  if (!categoryOrId) return 'other';
  const clean = categoryOrId.trim().toLowerCase();
  if (clean === 'electronics' || clean === 'mobile_laptop' || clean === 'mobile & laptop') return 'electronics';
  if (
    clean === 'appliances' ||
    clean === 'home_appliances' ||
    clean === 'home_appliance' ||
    clean === 'home & appliances' ||
    clean === 'home appliance'
  ) {
    return 'appliances';
  }
  if (clean === 'fashion' || clean === 'clothing') return 'fashion';
  if (clean === 'vehicles' || clean === 'vehicle') return 'vehicles';
  if (clean === 'furniture') return 'furniture';
  if (clean === 'sports' || clean === 'sports & fitness') return 'sports';
  if (clean === 'beauty' || clean === 'beauty & personal care') return 'beauty';
  return getCategoryIdFromName(categoryOrId);
}

/**
 * Canonical resolution of scanner, raw, or alternate category IDs to valid DB category IDs.
 */
export interface ItemCategoryConfig {
  id: string;
  name: string;
  label?: string;
  icon: string;
  description: string;
  productTypes: string[];
  nameLabel: string;
  namePlaceholder: string;
  brandLabel: string;
  brandPlaceholder: string;
  modelPlaceholder?: string;
  priceLabel: string;
  pricePlaceholder: string;
  sellerLabel: string;
  sellerFieldLabel?: string;
  sellerPlaceholder: string;
  supportsModel: boolean;
  supportsSerial: boolean;
  supportsVariant: boolean;
  supportsVehicleDetails: boolean;
  supportsFashionDetails: boolean;
  supportsFurnitureDetails: boolean;
  supportsWarranty: boolean;
  defaultWarrantyEnabled: boolean;
  supportsReturn: boolean;
  defaultReturnEnabled: boolean;
}

export const ITEM_CATEGORY_CONFIGS: Record<string, ItemCategoryConfig> = {
  electronics: {
    id: 'electronics',
    name: 'Electronics',
    icon: 'devices',
    description: 'Smartphones, laptops, TVs, audio gear, and personal devices',
    productTypes: CATEGORY_PRODUCT_TYPES.electronics,
    nameLabel: 'Item Name',
    namePlaceholder: 'e.g. Lenovo IdeaPad Slim 3',
    brandLabel: 'Brand',
    brandPlaceholder: 'e.g. Lenovo',
    modelPlaceholder: 'e.g. IdeaPad Slim 3 15IAH8',
    priceLabel: 'Purchase Price',
    pricePlaceholder: 'e.g. ₹40,990',
    sellerLabel: 'Store / Seller',
    sellerPlaceholder: 'e.g. Flipkart',
    supportsModel: true,
    supportsSerial: true,
    supportsVariant: false,
    supportsVehicleDetails: false,
    supportsFashionDetails: false,
    supportsFurnitureDetails: false,
    supportsWarranty: true,
    defaultWarrantyEnabled: true,
    supportsReturn: true,
    defaultReturnEnabled: true,
  },
  appliances: {
    id: 'appliances',
    name: 'Home & Appliances',
    icon: 'kitchen',
    description: 'Refrigerators, washing machines, ACs, microwaves & kitchen gear',
    productTypes: CATEGORY_PRODUCT_TYPES.appliances,
    nameLabel: 'Item Name',
    namePlaceholder: 'e.g. Samsung 8kg Washing Machine',
    brandLabel: 'Brand',
    brandPlaceholder: 'e.g. Samsung',
    modelPlaceholder: 'e.g. WW80T504DAX',
    priceLabel: 'Purchase Price',
    pricePlaceholder: 'e.g. ₹35,990',
    sellerLabel: 'Store / Seller',
    sellerPlaceholder: 'e.g. Reliance Digital',
    supportsModel: true,
    supportsSerial: true,
    supportsVariant: false,
    supportsVehicleDetails: false,
    supportsFashionDetails: false,
    supportsFurnitureDetails: false,
    supportsWarranty: true,
    defaultWarrantyEnabled: true,
    supportsReturn: true,
    defaultReturnEnabled: true,
  },
  fashion: {
    id: 'fashion',
    name: 'Fashion',
    icon: 'checkroom',
    description: 'Clothing, footwear, watches, bags, and luxury apparel',
    productTypes: CATEGORY_PRODUCT_TYPES.fashion,
    nameLabel: 'Item Name',
    namePlaceholder: 'e.g. Nike Air Max 270',
    brandLabel: 'Brand',
    brandPlaceholder: 'e.g. Nike',
    modelPlaceholder: 'e.g. Air Max 270',
    priceLabel: 'Purchase Price',
    pricePlaceholder: 'e.g. ₹8,495',
    sellerLabel: 'Store / Seller',
    sellerPlaceholder: 'e.g. Myntra',
    supportsModel: false,
    supportsSerial: false,
    supportsVariant: false,
    supportsVehicleDetails: false,
    supportsFashionDetails: true,
    supportsFurnitureDetails: false,
    supportsWarranty: false,
    defaultWarrantyEnabled: false,
    supportsReturn: true,
    defaultReturnEnabled: true,
  },
  vehicles: {
    id: 'vehicles',
    name: 'Vehicle',
    icon: 'directions-car',
    description: 'Automobiles, motorcycles, scooters, and personal transport',
    productTypes: CATEGORY_PRODUCT_TYPES.vehicles,
    nameLabel: 'Vehicle Name',
    namePlaceholder: 'e.g. Hyundai Creta',
    brandLabel: 'Brand / Manufacturer',
    brandPlaceholder: 'e.g. Hyundai',
    modelPlaceholder: 'e.g. Creta',
    priceLabel: 'Purchase Price',
    pricePlaceholder: 'e.g. ₹14,50,000',
    sellerLabel: 'Dealer / Seller',
    sellerPlaceholder: 'e.g. ABC Motors',
    supportsModel: true,
    supportsSerial: false,
    supportsVariant: true,
    supportsVehicleDetails: true,
    supportsFashionDetails: false,
    supportsFurnitureDetails: false,
    supportsWarranty: true,
    defaultWarrantyEnabled: false,
    supportsReturn: false,
    defaultReturnEnabled: false,
  },
  furniture: {
    id: 'furniture',
    name: 'Furniture',
    icon: 'chair',
    description: 'Desks, chairs, tables, sofas, beds, and interior furniture',
    productTypes: CATEGORY_PRODUCT_TYPES.furniture,
    nameLabel: 'Item Name',
    namePlaceholder: 'e.g. 3-Seater Sofa',
    brandLabel: 'Brand',
    brandPlaceholder: 'e.g. Wakefit',
    modelPlaceholder: 'e.g. Napper Pro',
    priceLabel: 'Purchase Price',
    pricePlaceholder: 'e.g. ₹18,999',
    sellerLabel: 'Store / Seller',
    sellerPlaceholder: 'e.g. Wakefit or IKEA',
    supportsModel: false,
    supportsSerial: false,
    supportsVariant: false,
    supportsVehicleDetails: false,
    supportsFashionDetails: false,
    supportsFurnitureDetails: true,
    supportsWarranty: true,
    defaultWarrantyEnabled: false,
    supportsReturn: true,
    defaultReturnEnabled: false,
  },
  sports: {
    id: 'sports',
    name: 'Sports & Fitness',
    icon: 'fitness-center',
    description: 'Gym equipment, sports gear, bicycles & outdoor gear',
    productTypes: CATEGORY_PRODUCT_TYPES.sports,
    nameLabel: 'Item Name',
    namePlaceholder: 'e.g. Olympic Barbell',
    brandLabel: 'Brand',
    brandPlaceholder: 'e.g. Decathlon',
    modelPlaceholder: 'e.g. Domyos 20kg',
    priceLabel: 'Purchase Price',
    pricePlaceholder: 'e.g. ₹5,499',
    sellerLabel: 'Store / Seller',
    sellerPlaceholder: 'e.g. Decathlon',
    supportsModel: false,
    supportsSerial: false,
    supportsVariant: false,
    supportsVehicleDetails: false,
    supportsFashionDetails: false,
    supportsFurnitureDetails: false,
    supportsWarranty: true,
    defaultWarrantyEnabled: false,
    supportsReturn: true,
    defaultReturnEnabled: false,
  },
  beauty: {
    id: 'beauty',
    name: 'Beauty & Personal Care',
    icon: 'spa',
    description: 'Personal grooming, skincare, fragrance, and wellness',
    productTypes: CATEGORY_PRODUCT_TYPES.beauty,
    nameLabel: 'Item Name',
    namePlaceholder: 'e.g. Dyson Supersonic Hair Dryer',
    brandLabel: 'Brand',
    brandPlaceholder: 'e.g. Dyson',
    modelPlaceholder: 'e.g. HD08',
    priceLabel: 'Purchase Price',
    pricePlaceholder: 'e.g. ₹34,900',
    sellerLabel: 'Store / Seller',
    sellerPlaceholder: 'e.g. Nykaa',
    supportsModel: false,
    supportsSerial: false,
    supportsVariant: false,
    supportsVehicleDetails: false,
    supportsFashionDetails: false,
    supportsFurnitureDetails: false,
    supportsWarranty: false,
    defaultWarrantyEnabled: false,
    supportsReturn: false,
    defaultReturnEnabled: false,
  },
  other: {
    id: 'other',
    name: 'Other',
    icon: 'inventory-2',
    description: 'Miscellaneous purchases and valuable personal property',
    productTypes: CATEGORY_PRODUCT_TYPES.other,
    nameLabel: 'Item Name',
    namePlaceholder: 'e.g. DJI Mini 4 Pro',
    brandLabel: 'Brand / Manufacturer',
    brandPlaceholder: 'e.g. DJI',
    modelPlaceholder: 'e.g. Fly More Combo',
    priceLabel: 'Purchase Price',
    pricePlaceholder: 'e.g. ₹75,000',
    sellerLabel: 'Store / Seller',
    sellerPlaceholder: 'e.g. Amazon',
    supportsModel: false,
    supportsSerial: false,
    supportsVariant: false,
    supportsVehicleDetails: false,
    supportsFashionDetails: false,
    supportsFurnitureDetails: false,
    supportsWarranty: true,
    defaultWarrantyEnabled: false,
    supportsReturn: false,
    defaultReturnEnabled: false,
  },
};

export function getItemCategoryConfig(categoryOrId?: string | null): ItemCategoryConfig & { label: string; sellerFieldLabel: string } {
  const dbId = normalizeToDbCategoryId(categoryOrId);
  const cfg = ITEM_CATEGORY_CONFIGS[dbId] || ITEM_CATEGORY_CONFIGS.other;
  return {
    ...cfg,
    label: cfg.label || cfg.name,
    sellerFieldLabel: cfg.sellerFieldLabel || cfg.sellerLabel,
    modelPlaceholder: cfg.modelPlaceholder || 'e.g. Model Number / Spec',
  };
}

