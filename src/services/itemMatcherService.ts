
import { Item } from '../types';
import { ItemMatchResult } from '../types/scanner';

export interface DocumentMatchSignals {
  rawText?: string | null;
  title?: string | null;
  merchantName?: string | null;
  issuerName?: string | null;
  serialNumber?: string | null;
  imei?: string | null;
  registrationNumber?: string | null;
  vinChassisNumber?: string | null;
  engineNumber?: string | null;
  invoiceNumber?: string | null;
  referenceNumber?: string | null;
  documentType?: string | null;
  purchaseDate?: string | null;
  brand?: string | null;
  model?: string | null;
  productName?: string | null;
}

/**
 * Normalizes an alphanumeric string for fuzzy comparison (removes spaces, dashes, dots).
 */
function cleanAlphaNumeric(val?: string | null): string {
  if (!val) return '';
  return val.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Evaluates match quality between a scanned document and existing items in the vault.
 * Strictly adheres to: "NEVER guess an item relationship."
 */
export function matchDocumentToItem(
  signals: DocumentMatchSignals,
  items: Item[]
): ItemMatchResult {
  if (!items || items.length === 0) {
    return {
      candidateItemId: null,
      matchConfidence: 0,
      matchReason: 'No existing items in vault to match against.',
      requiresUserConfirmation: false,
    };
  }

  const combinedSearchText = [
    signals.rawText || '',
    signals.title || '',
    signals.merchantName || '',
    signals.issuerName || '',
    signals.brand || '',
    signals.model || '',
    signals.productName || '',
  ].join(' ').toLowerCase();

  const cleanImei = cleanAlphaNumeric(signals.imei);
  const cleanSerial = cleanAlphaNumeric(signals.serialNumber);
  const cleanRegNo = cleanAlphaNumeric(signals.registrationNumber);
  const cleanVin = cleanAlphaNumeric(signals.vinChassisNumber);
  const cleanEngine = cleanAlphaNumeric(signals.engineNumber);
  const cleanInvoice = cleanAlphaNumeric(signals.invoiceNumber);

  let bestMatchItem: Item | null = null;
  let bestScore = 0;
  let bestReason = '';

  for (const item of items) {
    let score = 0;
    const reasons: string[] = [];

    const itemImei = cleanAlphaNumeric(item.imei);
    const itemSerial = cleanAlphaNumeric(item.serialNumber);
    const itemRegNo = cleanAlphaNumeric(item.registrationNumber);
    const itemVin = cleanAlphaNumeric(item.vinChassisNumber);
    const itemEngine = cleanAlphaNumeric(item.engineNumber);
    const itemInvoice = cleanAlphaNumeric(item.invoiceNumber);

    if (cleanImei && itemImei && cleanImei === itemImei) {
      score += 0.98;
      reasons.push(`Exact IMEI match (${item.imei})`);
    } else if (cleanSerial && itemSerial && cleanSerial === itemSerial) {
      score += 0.95;
      reasons.push(`Exact Serial Number match (${item.serialNumber})`);
    } else if (cleanRegNo && itemRegNo && cleanRegNo === itemRegNo) {
      score += 0.98;
      reasons.push(`Exact Vehicle Registration match (${item.registrationNumber})`);
    } else if (cleanVin && itemVin && cleanVin === itemVin) {
      score += 0.96;
      reasons.push(`Exact VIN/Chassis Number match (${item.vinChassisNumber})`);
    } else if (cleanEngine && itemEngine && cleanEngine === itemEngine) {
      score += 0.92;
      reasons.push(`Exact Engine Number match (${item.engineNumber})`);
    }

    if (cleanInvoice && itemInvoice && cleanInvoice === itemInvoice) {
      score += 0.90;
      reasons.push(`Exact Invoice Number match (${item.invoiceNumber})`);
    }

    if (score < 0.85) {
      if (itemImei && itemImei.length >= 14 && combinedSearchText.includes(itemImei.toLowerCase())) {
        score = Math.max(score, 0.95);
        reasons.push(`Document text contains item IMEI (${item.imei})`);
      }
      if (itemSerial && itemSerial.length >= 6 && combinedSearchText.includes(itemSerial.toLowerCase())) {
        score = Math.max(score, 0.92);
        reasons.push(`Document text contains serial number (${item.serialNumber})`);
      }
      if (itemRegNo && itemRegNo.length >= 6 && combinedSearchText.includes(itemRegNo.toLowerCase())) {
        score = Math.max(score, 0.95);
        reasons.push(`Document text contains vehicle registration (${item.registrationNumber})`);
      }
      if (itemVin && itemVin.length >= 9 && combinedSearchText.includes(itemVin.toLowerCase())) {
        score = Math.max(score, 0.95);
        reasons.push(`Document text contains vehicle VIN/Chassis (${item.vinChassisNumber})`);
      }
    }

    if (score < 0.85) {
      const itemBrand = (item.brand || '').trim().toLowerCase();
      const itemModel = (item.model || '').trim().toLowerCase();
      const itemName = item.name.toLowerCase();

      let brandMatched = false;
      let modelMatched = false;

      if (itemBrand && itemBrand.length > 2 && combinedSearchText.includes(itemBrand)) {
        brandMatched = true;
      }
      if (itemModel && itemModel.length > 2 && combinedSearchText.includes(itemModel)) {
        modelMatched = true;
      }

      if (brandMatched && modelMatched) {
        score = Math.max(score, 0.82);
        reasons.push(`Brand "${item.brand}" and Model "${item.model}" match`);
      } else if (itemName.length > 4 && combinedSearchText.includes(itemName)) {
        score = Math.max(score, 0.75);
        reasons.push(`Item name "${item.name}" found in document text`);
      } else if (modelMatched) {
        score = Math.max(score, 0.65);
        reasons.push(`Model "${item.model}" matches`);
      }
    }

    score = Math.min(0.99, score);

    if (score > bestScore) {
      bestScore = score;
      bestMatchItem = item;
      bestReason = reasons.join(' · ');
    }
  }

  if (bestScore >= 0.60 && bestMatchItem) {
    return {
      candidateItemId: bestMatchItem.id,
      matchConfidence: Number(bestScore.toFixed(2)),
      matchReason: bestReason || 'Product identifiers match existing item in vault.',
      matchedItemName: bestMatchItem.name,
      requiresUserConfirmation: bestScore < 0.85,
    };
  }

  return {
    candidateItemId: null,
    matchConfidence: Number(bestScore.toFixed(2)),
    matchReason: bestScore > 0
      ? 'Insufficient signal to confidently link with an existing item.'
      : 'No matching item found in vault.',
    requiresUserConfirmation: false,
  };
}
