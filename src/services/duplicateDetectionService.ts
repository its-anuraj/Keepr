// Unified Duplicate Detection Service for Keepr 3-Entity Vault Architecture
// Phase 27: Prevent accidental duplicates using appropriate evidence across Purchased Items, Documents, and Services.

import { Item, VaultDocument, MaintenanceRecord } from '../types';
import { checkForDuplicateDocument, DuplicateCheckResult, DocumentComparisonData } from './duplicateDocumentService';

export interface ItemComparisonData {
  id?: string;
  name: string;
  brand?: string | null;
  merchant?: string | null;
  invoiceNumber?: string | null;
  serialNumber?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
}

export interface ServiceComparisonData {
  id?: string;
  itemId?: string | null;
  title?: string | null;
  serviceProvider?: string | null;
  serviceDate?: string | null;
  serviceType?: string | null;
  cost?: number | null;
  coverageReferenceNumber?: string | null;
}

export interface DuplicateDetectionMatch<T> {
  isDuplicate: boolean;
  matchedEntity: T | null;
  matchScore: number;
  reasons: string[];
  message: string;
}

function cleanStr(val?: string | null): string {
  if (!val) return '';
  return val.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if a candidate item closely duplicates an existing purchased item.
 */
export function checkForDuplicateItem(
  candidate: ItemComparisonData,
  existingItems: Item[]
): DuplicateDetectionMatch<Item> {
  if (!existingItems || existingItems.length === 0) {
    return {
      isDuplicate: false,
      matchedEntity: null,
      matchScore: 0,
      reasons: [],
      message: 'No existing items.',
    };
  }

  const candInvoice = cleanStr(candidate.invoiceNumber);
  const candMerchant = cleanStr(candidate.merchant);
  const candSerial = cleanStr(candidate.serialNumber);
  const candName = cleanStr(candidate.name);
  const candBrand = cleanStr(candidate.brand);
  const candDate = (candidate.purchaseDate || '').trim();
  const candPrice = candidate.purchasePrice ? Number(candidate.purchasePrice) : null;

  for (const existing of existingItems) {
    if (candidate.id && existing.id === candidate.id) continue;

    const existInvoice = cleanStr(existing.invoiceNumber);
    const existMerchant = cleanStr(existing.merchant);
    const existSerial = cleanStr(existing.serialNumber);
    const existName = cleanStr(existing.name);
    const existBrand = cleanStr(existing.brand);
    const existDate = (existing.purchaseDate || '').trim();
    const existPrice = existing.purchasePrice ? Number(existing.purchasePrice) : null;

    const reasons: string[] = [];
    let score = 0;

    // 1. Same Serial Number on identifiable product (Strongest evidence)
    if (candSerial && existSerial && candSerial.length >= 5 && candSerial === existSerial) {
      score += 0.95;
      reasons.push(`Matching serial number "${existing.serialNumber}"`);
    }

    // 2. Same Invoice Number + Same Merchant (Strong purchase evidence)
    if (candInvoice && existInvoice && candInvoice.length >= 4 && candInvoice === existInvoice) {
      if (!candMerchant || !existMerchant || candMerchant === existMerchant) {
        score = Math.max(score, 0.92);
        reasons.push(`Matching invoice #${existing.invoiceNumber}`);
      }
    }

    // 3. Same Merchant + Same Date + Same Price
    if (
      candMerchant &&
      existMerchant &&
      candMerchant === existMerchant &&
      candDate &&
      existDate &&
      candDate === existDate &&
      candPrice !== null &&
      existPrice !== null &&
      Math.abs(candPrice - existPrice) < 0.01
    ) {
      score = Math.max(score, 0.88);
      reasons.push(`Identical purchase from "${existing.merchant}" on ${existing.purchaseDate} for ${existing.purchasePrice}`);
    }

    // 4. Same Product Name + Brand + Date
    if (
      candName &&
      existName &&
      candName === existName &&
      candBrand &&
      existBrand &&
      candBrand === existBrand &&
      candDate &&
      existDate &&
      candDate === existDate
    ) {
      score = Math.max(score, 0.85);
      reasons.push(`Same product "${existing.name}" purchased on ${existing.purchaseDate}`);
    }

    if (score >= 0.80) {
      return {
        isDuplicate: true,
        matchedEntity: existing,
        matchScore: score,
        reasons,
        message: `This item appears similar to "${existing.name}" in your Vault: ${reasons.join('; ')}.`,
      };
    }
  }

  return {
    isDuplicate: false,
    matchedEntity: null,
    matchScore: 0,
    reasons: [],
    message: 'Item appears unique.',
  };
}

/**
 * Checks if a candidate service record closely duplicates an existing service record.
 */
export function checkForDuplicateService(
  candidate: ServiceComparisonData,
  existingServices: MaintenanceRecord[]
): DuplicateDetectionMatch<MaintenanceRecord> {
  if (!existingServices || existingServices.length === 0) {
    return {
      isDuplicate: false,
      matchedEntity: null,
      matchScore: 0,
      reasons: [],
      message: 'No existing services.',
    };
  }

  const candRef = cleanStr(candidate.coverageReferenceNumber);
  const candProvider = cleanStr(candidate.serviceProvider);
  const candDate = (candidate.serviceDate || '').trim();
  const candType = cleanStr(candidate.serviceType);
  const candItemId = (candidate.itemId || '').trim();
  const candCost = candidate.cost ? Number(candidate.cost) : null;

  for (const existing of existingServices) {
    if (candidate.id && existing.id === candidate.id) continue;

    const existRef = cleanStr(existing.coverageReferenceNumber);
    const existProvider = cleanStr(existing.serviceProvider);
    const existDate = (existing.serviceDate || '').trim();
    const existType = cleanStr(existing.serviceType);
    const existItemId = (existing.itemId || '').trim();
    const existCost = existing.amountPaid != null ? Number(existing.amountPaid) : existing.cost ? Number(existing.cost) : null;

    const reasons: string[] = [];
    let score = 0;

    // 1. Same Service Reference / Job Sheet Number
    if (candRef && existRef && candRef.length >= 4 && candRef === existRef) {
      score = Math.max(score, 0.95);
      reasons.push(`Matching job sheet / service reference #${existing.coverageReferenceNumber}`);
    }

    // 2. Same Provider + Same Date + Same Item + Same Cost
    if (
      candProvider &&
      existProvider &&
      candProvider === existProvider &&
      candDate &&
      existDate &&
      candDate === existDate
    ) {
      let subScore = 0.70;
      if (candItemId && existItemId && candItemId === existItemId) {
        subScore += 0.15;
      }
      if (candCost !== null && existCost !== null && Math.abs(candCost - existCost) < 0.01) {
        subScore += 0.10;
      }
      if (candType && existType && candType === existType) {
        subScore += 0.05;
      }

      if (subScore >= 0.85) {
        score = Math.max(score, subScore);
        reasons.push(`Identical service from "${existing.serviceProvider}" on ${existing.serviceDate}`);
      }
    }

    if (score >= 0.80) {
      return {
        isDuplicate: true,
        matchedEntity: existing,
        matchScore: score,
        reasons,
        message: `This service record appears similar to "${existing.title}" in your records: ${reasons.join('; ')}.`,
      };
    }
  }

  return {
    isDuplicate: false,
    matchedEntity: null,
    matchScore: 0,
    reasons: [],
    message: 'Service record appears unique.',
  };
}

// Re-export document duplicate detection
export { checkForDuplicateDocument };
