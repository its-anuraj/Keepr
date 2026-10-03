
import { VaultDocument } from '../types';

export interface DocumentComparisonData {
  id?: string;
  title: string;
  category?: string | null;
  documentType?: string | null;
  referenceNumber?: string | null;
  issuerName?: string | null;
  documentDate?: string | null;
  amount?: number | null;
  expiryDate?: string | null;
  dueDate?: string | null;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  matchedDocument: VaultDocument | null;
  similarityScore: number;
  reason: string;
  message: string;
}

function cleanStr(val?: string | null): string {
  if (!val) return '';
  return val.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if a candidate document closely duplicates an existing vault document.
 */
export function checkForDuplicateDocument(
  candidate: DocumentComparisonData,
  existingDocuments: VaultDocument[]
): DuplicateCheckResult {
  if (!existingDocuments || existingDocuments.length === 0) {
    return {
      isDuplicate: false,
      matchedDocument: null,
      similarityScore: 0,
      reason: 'No existing documents to compare.',
      message: 'No existing documents to compare.',
    };
  }

  const candRef = cleanStr(candidate.referenceNumber);
  const candIssuer = cleanStr(candidate.issuerName);
  const candDate = (candidate.documentDate || '').trim();
  const candTitle = cleanStr(candidate.title);
  const candType = cleanStr(candidate.documentType);
  const candAmount = candidate.amount ? Number(candidate.amount) : null;

  for (const existing of existingDocuments) {
    if (candidate.id && existing.id === candidate.id) continue;

    const existRef = cleanStr(existing.referenceNumber);
    const existIssuer = cleanStr(existing.issuerName);
    const existDate = (existing.documentDate || '').trim();
    const existTitle = cleanStr(existing.title);
    const existType = cleanStr(existing.documentType);
    const existAmount = existing.amount ? Number(existing.amount) : null;

    if (candRef && existRef && candRef.length >= 4 && candRef === existRef) {
      if (candType === existType || candIssuer === existIssuer || !candIssuer || !existIssuer) {
        const msg = `A document with reference number "${existing.referenceNumber}" (${existing.title}) already exists in your vault.`;
        return {
          isDuplicate: true,
          matchedDocument: existing,
          similarityScore: 0.98,
          reason: msg,
          message: msg,
        };
      }
    }

    if (
      candIssuer &&
      existIssuer &&
      candIssuer === existIssuer &&
      candDate &&
      existDate &&
      candDate === existDate &&
      candAmount !== null &&
      existAmount !== null &&
      Math.abs(candAmount - existAmount) < 0.01
    ) {
      const msg = `A ${existing.documentType} from "${existing.issuerName}" on ${existing.documentDate} for the same amount already exists in your vault.`;
      return {
        isDuplicate: true,
        matchedDocument: existing,
        similarityScore: 0.92,
        reason: msg,
        message: msg,
      };
    }

    if (candTitle && existTitle && candTitle.length >= 5 && candTitle === existTitle && candDate && existDate && candDate === existDate) {
      const msg = `A document titled "${existing.title}" dated ${existing.documentDate} already exists.`;
      return {
        isDuplicate: true,
        matchedDocument: existing,
        similarityScore: 0.88,
        reason: msg,
        message: msg,
      };
    }
  }

  return {
    isDuplicate: false,
    matchedDocument: null,
    similarityScore: 0,
    reason: 'Document appears unique.',
    message: 'Document appears unique.',
  };
}
