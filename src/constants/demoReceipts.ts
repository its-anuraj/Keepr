import { ScannerCategory } from '../types/scanner';

export interface DemoReceiptPreset {
  id: string;
  name: string;
  category: ScannerCategory;
  merchant: string;
  amount: number;
  imageUri: string;
  description: string;
}

export const DEMO_RECEIPT_PRESETS: DemoReceiptPreset[] = [
  {
    id: 'demo-macbook',
    name: 'MacBook Air M4 (Apple Store BKC)',
    category: 'mobile_laptop',
    merchant: 'Apple BKC Flagship Store',
    amount: 114900,
    imageUri:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCDyM9eZ9LhyaDVDzhmri88elY5Bd2C2BmTq1zdCgcwSAdi-N2SLhJ-xusG6aElq7RWJaQbZdfc0Jh2qkL8c2OmbgWRy9cmm5YFj0Uv5Q_aIG7eNx7UGECQYBv17ZxMkakqu6aET2tsQYlLS0a2sAX5WtbB3PGF1DlD000YjfIfsS_nroQ9umcr_5RqDc8o8mKCGqdVN0aUS6wu2IlfMmacFUXu2-CQPL7o2puB2Ka-kSzPYjkMGh-jMw',
    description: 'Electronics tax invoice with AppleCare+ & hardware serials',
  },
  {
    id: 'demo-sony-xm5',
    name: 'Sony WH-1000XM5 (Croma)',
    category: 'electronics',
    merchant: 'Croma Retail, Indiranagar',
    amount: 29990,
    imageUri:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDoquUF26XugqOZr73yMfFYNT2kxm3mVtFUw8M7Fj17deYxBC8Vhcm1XuUvz8Or8wtF8k5AWJuAbxSVUc3-_ZuhY3P_THwDvAW3-7pFvWm9Lcq34AOqJVANYgS4i2dj_r78-qGtDAz-EEFMhKZrl2Z85MwiJJZCoo-xqFmQcJ648AXhcfeiEWcVxr_koJW7_wkAVOWXcvjohIc_oezdsIM_DgCrPN2LDbbtgK4jA5lcG_-nwpe-rWR1vA',
    description: 'Retail POS receipt with 1-Year manufacturer warranty card',
  },
  {
    id: 'demo-lg-ac',
    name: 'LG Dual Inverter 1.5T (Reliance)',
    category: 'home_appliance',
    merchant: 'Reliance Digital Megastore',
    amount: 44990,
    imageUri:
      'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=500&auto=format&fit=crop',
    description: 'Appliance invoice with 10-year compressor protection',
  },
  {
    id: 'demo-honda-service',
    name: 'Honda City ZX Service & Parts',
    category: 'vehicle',
    merchant: 'Dakshin Honda Authorized Service',
    amount: 14850,
    imageUri:
      'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=500&auto=format&fit=crop',
    description: 'Automobile dealership maintenance invoice with VIN & ODO',
  },
  {
    id: 'demo-westelm-desk',
    name: 'Walnut Executive Desk (West Elm)',
    category: 'furniture',
    merchant: 'West Elm India',
    amount: 58000,
    imageUri:
      'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=500&auto=format&fit=crop',
    description: 'Furniture showroom invoice with room delivery and assembly note',
  },
  {
    id: 'demo-zara-jacket',
    name: 'Technical Puffer Jacket (Zara)',
    category: 'fashion',
    merchant: 'Zara Palladium Mall, Mumbai',
    amount: 7990,
    imageUri:
      'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=500&auto=format&fit=crop',
    description: 'Store thermal receipt with return window and barcode',
  },
];
