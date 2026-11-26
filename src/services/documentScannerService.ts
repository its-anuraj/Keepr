/**
 * KEEPR DIGITAL OWNERSHIP VAULT: Universal Document Scanner & OCR Engine
 * Institutional-grade document processor for both Images (JPEG, PNG, WebP) and PDFs.
 *
 * Pipeline:
 * 1. Read document binary & inspect magic bytes (JPEG/PNG/WEBP/PDF).
 * 2. If PDF:
 *    a. Attempt native text stream extraction for searchable PDFs.
 *    b. If text layer is sparse/empty (scanned PDF), dispatch to multimodal Gemini OCR.
 * 3. If Image:
 *    a. Prepare high-resolution payload with accurate MIME type.
 *    b. Dispatch to multimodal Gemini OCR.
 * 4. Parse extracted text, confidence, page breakdown, and structured document fields.
 * 5. Persist extracted metadata and full text to VaultDocument.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { VaultDocument } from '../types';
import { detectFormatFromUriOrName, detectFormatFromBytes } from '../utils/imageIntegrity';
import { extractNativePdfText } from '../utils/pdfUtils';
import { GeminiMultimodalReceiptService } from './geminiReceiptService';
import { readUriBytesAndBase64Safely } from './pdfFileAccessService';
import { extractSearchablePdfTextFromBytes } from './pdfReceiptProcessor';
import { useItemStore } from '../store/itemStore';

export { extractNativePdfText };

export interface DocumentScanResult {
  success: boolean;
  docId: string;
  sourceType: 'pdf' | 'image';
  extractedText: string;
  pageCount: number;
  confidence: number;
  metadata: {
    title?: string;
    issuerName?: string;
    referenceNumber?: string;
    documentDate?: string;
    expiryDate?: string;
    amount?: number;
    category?: string;
    documentType?: string;
  };
  pageTexts: { page: number; text: string }[];
  isNativePdfExtraction?: boolean;
  error?: string;
}

function toCleanStr(val: any): string | undefined {
  if (val == null) return undefined;
  if (typeof val === 'object' && 'value' in val) {
    const inner = val.value;
    return typeof inner === 'string' && inner.trim() ? inner.trim() : undefined;
  }
  return typeof val === 'string' && val.trim() ? val.trim() : undefined;
}

function toCleanNum(val: any): number | undefined {
  if (val == null) return undefined;
  if (typeof val === 'object' && 'value' in val) {
    const inner = val.value;
    const num = typeof inner === 'number' ? inner : parseFloat(String(inner));
    return !isNaN(num) ? num : undefined;
  }
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  return !isNaN(num) ? num : undefined;
}

/**
 * Universal document scanning function.
 * Handles both local URIs and remote signed URLs for images and PDFs.
 */
export async function scanVaultDocument(
  doc: VaultDocument,
  directFileUri?: string
): Promise<DocumentScanResult> {
  const docId = doc.id;
  const targetUri = directFileUri || doc.filePath || doc.fileUrl;

  if (!targetUri) {
    return {
      success: false,
      docId,
      sourceType: 'image',
      extractedText: '',
      pageCount: 1,
      confidence: 0,
      metadata: {},
      pageTexts: [],
      error: 'No file path or URL available for this document.',
    };
  }

  try {
    // 1. Resolve local accessible file
    let localUri = targetUri;
    let isTemporaryDownload = false;

    if (targetUri.startsWith('http://') || targetUri.startsWith('https://')) {
      const tempPath = `${FileSystem.cacheDirectory}scan_doc_${docId}_${Date.now()}`;
      const dl = await FileSystem.downloadAsync(targetUri, tempPath);
      if (dl.status !== 200) {
        throw new Error(`Failed to download document for scanning (HTTP ${dl.status})`);
      }
      localUri = dl.uri;
      isTemporaryDownload = true;
    }

    // 2. Format detection
    const formatInfo = detectFormatFromUriOrName(localUri || doc.mimeType);
    const isPdf =
      formatInfo.mimeType === 'application/pdf' ||
      localUri.toLowerCase().includes('.pdf') ||
      doc.fileType === 'pdf';
    const sourceType: 'pdf' | 'image' = isPdf ? 'pdf' : 'image';

    // 3. Safely read document bytes using Expo SDK 57 scoped access service
    const safeRead = await readUriBytesAndBase64Safely(localUri, {
      fileName: `${doc.title || 'document'}.${isPdf ? 'pdf' : 'jpg'}`,
      mimeType: isPdf ? 'application/pdf' : doc.mimeType,
      validateAsPdf: isPdf,
    });
    if (!safeRead.success || !safeRead.base64) {
      throw new Error(safeRead.errorMessage || 'Could not read document bytes from storage.');
    }

    if (isPdf) {
      try {
        const nativeText = extractSearchablePdfTextFromBytes(safeRead.bytes);
        // If high-density searchable text exists (> 80 characters), use native text layer
        if (nativeText && nativeText.length > 80) {
          console.log(`[DocumentScannerService] Native searchable PDF text extracted (${nativeText.length} chars)`);
          const pageCount = safeRead.validation?.estimatedPageCount || 1;

          const result: DocumentScanResult = {
            success: true,
            docId,
            sourceType: 'pdf',
            extractedText: nativeText,
            pageCount,
            confidence: 0.98,
            metadata: {
              title: doc.title,
              category: doc.category,
              documentType: doc.documentType,
            },
            pageTexts: [{ page: 1, text: nativeText }],
            isNativePdfExtraction: true,
          };

          // Persist to document record
          useItemStore.getState().updateDocument(docId, {
            extractedText: nativeText,
            ocrStatus: 'completed',
            pageCount,
          });

          if (isTemporaryDownload) {
            FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
          }

          return result;
        }
      } catch (nativeErr) {
        console.log('[DocumentScannerService] Scanned / image-based PDF detected, proceeding to Multimodal OCR');
      }
    }

    // 4. Multimodal OCR via Gemini Backend (for Images & Scanned/Image-based PDFs)
    const geminiService = new GeminiMultimodalReceiptService();
    const pdfOrImageBase64 = safeRead.base64;

    const aiResponse = await geminiService.analyzeReceiptWithOcr({
      imageUri: safeRead.uri || localUri,
      base64: pdfOrImageBase64,
      mimeType: isPdf ? 'application/pdf' : safeRead.mimeType,
      fileName: `${doc.title || 'document'}.${isPdf ? 'pdf' : 'jpg'}`,
    });

    // 5. Structure OCR results
    const issuerName =
      toCleanStr(aiResponse.document?.issuerName) ||
      toCleanStr(aiResponse.issuerName) ||
      toCleanStr(aiResponse.merchantName) ||
      doc.issuerName ||
      undefined;

    const referenceNumber =
      toCleanStr(aiResponse.document?.referenceNumber) ||
      toCleanStr(aiResponse.referenceNumber) ||
      toCleanStr(aiResponse.invoiceNumber) ||
      doc.referenceNumber ||
      undefined;

    const documentDate =
      toCleanStr(aiResponse.document?.documentDate) ||
      toCleanStr(aiResponse.documentDate) ||
      toCleanStr(aiResponse.purchaseDate) ||
      doc.documentDate ||
      undefined;

    const expiryDate =
      toCleanStr(aiResponse.document?.expiryDate) ||
      toCleanStr(aiResponse.expiryDate) ||
      doc.expiryDate ||
      undefined;

    const amount =
      toCleanNum(aiResponse.document?.amount) ||
      toCleanNum(aiResponse.grandTotal) ||
      doc.amount ||
      undefined;

    const docCategory = aiResponse.documentCategory || doc.category;
    const docType = aiResponse.documentType || doc.documentType;
    const docTitle = aiResponse.documentTitle || aiResponse.document?.title || doc.title;
    const confidence = aiResponse.receiptConfidence || 0.95;

    // Build comprehensive extracted text summary
    const textLines: string[] = [];
    if (docTitle) textLines.push(`Title: ${docTitle}`);
    if (issuerName) textLines.push(`Issuer: ${issuerName}`);
    if (referenceNumber) textLines.push(`Reference #: ${referenceNumber}`);
    if (documentDate) textLines.push(`Date: ${documentDate}`);
    if (expiryDate) textLines.push(`Expiry: ${expiryDate}`);
    if (amount) textLines.push(`Amount: ₹${amount}`);

    if (Array.isArray(aiResponse.items) && aiResponse.items.length > 0) {
      textLines.push('\nLine Items:');
      aiResponse.items.forEach((it, idx) => {
        textLines.push(`  ${idx + 1}. ${it.name} ${it.totalPrice ? `(₹${it.totalPrice})` : ''}`);
      });
    }

    if (doc.notes) {
      textLines.push(`\nNotes: ${doc.notes}`);
    }

    const fullExtractedText = textLines.join('\n');

    const result: DocumentScanResult = {
      success: true,
      docId,
      sourceType,
      extractedText: fullExtractedText,
      pageCount: isPdf ? 1 : 1,
      confidence,
      metadata: {
        title: docTitle,
        issuerName,
        referenceNumber,
        documentDate,
        expiryDate,
        amount,
        category: docCategory,
        documentType: docType,
      },
      pageTexts: [{ page: 1, text: fullExtractedText }],
      isNativePdfExtraction: false,
    };

    // Persist to document record
    useItemStore.getState().updateDocument(docId, {
      extractedText: fullExtractedText,
      ocrStatus: 'completed',
      pageCount: result.pageCount,
      issuerName: issuerName || doc.issuerName,
      referenceNumber: referenceNumber || doc.referenceNumber,
      documentDate: documentDate || doc.documentDate,
      expiryDate: expiryDate || doc.expiryDate,
      amount: amount || doc.amount,
    });

    if (isTemporaryDownload) {
      FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
    }

    return result;
  } catch (err: any) {
    console.error('[DocumentScannerService] Document scan failed:', err);

    // Update document status to failed without losing original document
    useItemStore.getState().updateDocument(docId, {
      ocrStatus: 'failed',
    });

    return {
      success: false,
      docId,
      sourceType: doc.fileType === 'pdf' ? 'pdf' : 'image',
      extractedText: '',
      pageCount: 1,
      confidence: 0,
      metadata: {},
      pageTexts: [],
      error: err?.message || 'Scanning failed. Please check network connectivity and try again.',
    };
  }
}
