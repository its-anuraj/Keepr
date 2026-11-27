
import {
  GeminiReceiptResponse,
  GeminiMultimodalInput,
  PdfPageInputPayload,
} from '../types/scanner';
import {
  uriToBase64,
  isGeminiConfigured,
  getGeminiApiKey,
  setRuntimeGeminiApiKey as setGeminiApiKey,
} from './receiptScanner';
import { supabase, isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { prepareImageForAnalysis } from './receiptFileService';
import {
  base64ToUint8Array,
  consolidateMultiPageExtractions,
  consolidatePdfReceiptGroups,
  detectPageTextBoundaryHints,
  validatePdfBytes,
} from './pdfReceiptProcessor';
import { validateExtractedReceiptPayload } from '../schemas/receiptExtractionSchema';
import { detectFormatFromBase64Prefix, detectFormatFromUriOrName } from '../utils/imageIntegrity';

export { isGeminiConfigured, getGeminiApiKey, setGeminiApiKey };

export interface IGeminiReceiptService {
  analyzeReceiptWithOcr(input: GeminiMultimodalInput): Promise<GeminiReceiptResponse>;
  isAvailable(): boolean;
  getServiceName(): string;
}

export type ScannerErrorCode =
  | 'AUTH_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNREADABLE_RECEIPT'
  | 'PASSWORD_PROTECTED_PDF'
  | 'CORRUPTED_PDF'
  | 'EMPTY_PDF'
  | 'PDF_TOO_LARGE'
  | 'NOT_A_PDF'
  | 'UNREADABLE_PDF'
  | 'SERVICE_UNAVAILABLE'
  | 'SERVER_ERROR';

export class ScannerError extends Error {
  code: ScannerErrorCode;
  requestId: string;
  statusCode?: number | string;

  constructor(message: string, code: ScannerErrorCode, requestId: string, statusCode?: number | string) {
    super(message);
    this.name = 'ScannerError';
    this.code = code;
    this.requestId = requestId;
    this.statusCode = statusCode;
  }
}

/**
 * Maps technical status codes and errors to friendly, understandable user-facing messages.
 * Never exposes JWT, access tokens, Supabase internal errors, Gemini errors, or raw stack traces.
 */
function toUserFacingErrorMessage(code: ScannerErrorCode): string {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 'Please sign in to scan documents.';
    case 'SESSION_EXPIRED':
      return 'Your session has expired. Please sign in again.';
    case 'FORBIDDEN':
      return 'You are not authorized to scan documents.';
    case 'NETWORK_ERROR':
      return "Couldn't connect to the scanner. Please try again.";
    case 'TIMEOUT':
      return 'The scan timed out. Please try again with a clearer file or fewer pages.';
    case 'PASSWORD_PROTECTED_PDF':
      return 'This PDF is password-protected or encrypted. Please unlock it before uploading.';
    case 'CORRUPTED_PDF':
      return 'This PDF file appears corrupted or incomplete and could not be read.';
    case 'EMPTY_PDF':
      return 'This PDF contains no readable text or pages.';
    case 'PDF_TOO_LARGE':
      return 'This PDF exceeds the maximum allowed size (20 MB).';
    case 'NOT_A_PDF':
      return 'The selected file is not a valid PDF document.';
    case 'UNREADABLE_PDF':
      return "We couldn't extract details from this PDF. Please verify the file is clear and unlocked.";
    case 'UNREADABLE_RECEIPT':
      return "We couldn't read this document clearly. Please upload a clearer photo or PDF.";
    case 'SERVICE_UNAVAILABLE':
    case 'SERVER_ERROR':
    default:
      return "Couldn't analyze this document right now. Please try again.";
  }
}

export class GeminiMultimodalReceiptService implements IGeminiReceiptService {
  private inFlightScans = new Map<string, Promise<GeminiReceiptResponse>>();

  getServiceName(): string {
    return 'Keepr Secure Receipt AI Backend';
  }

  isAvailable(): boolean {
    return isGeminiConfigured();
  }

  async analyzeReceiptWithOcr(input: GeminiMultimodalInput): Promise<GeminiReceiptResponse> {
    if (!input.imageUri && !input.base64 && !input.extractedText && (!input.pageImages || input.pageImages.length === 0)) {
      throw new Error('No receipt image or PDF content was provided for analysis.');
    }

    // Deduplication key based on image URI, text signature, or leading base64 signature
    const dedupKey =
      input.imageUri ||
      (input.base64 ? input.base64.substring(0, 128) : undefined) ||
      (input.extractedText ? input.extractedText.substring(0, 128) : 'default');
    const existing = this.inFlightScans.get(dedupKey);
    if (existing) {
      console.log(`[ReceiptScanner] Reusing in-flight scan for key=${dedupKey.substring(0, 32)}...`);
      return existing;
    }

    const scanPromise = this.performAnalysisWithTelemetry(input, dedupKey);
    this.inFlightScans.set(dedupKey, scanPromise);
    try {
      return await scanPromise;
    } finally {
      this.inFlightScans.delete(dedupKey);
    }
  }

  private async performAnalysisWithTelemetry(input: GeminiMultimodalInput, dedupKey: string): Promise<GeminiReceiptResponse> {
    // Generate unique traceable Request ID for end-to-end telemetry
    const scanDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.random().toString(36).substring(2, 8);
    const requestId = `receipt-scan-${scanDate}-${randSuffix}`;
    const startTime = Date.now();

    let base64Data = '';
    let mimeType = input.mimeType || 'image/jpeg';

    if (input.imageUri || input.base64) {
      const prepared = await prepareImageForAnalysis(input.imageUri || '', input.base64, {
        mimeType: input.mimeType,
        fileName: input.fileName,
      });
      base64Data = prepared.base64;
      mimeType = prepared.mimeType || mimeType;
    }

    const isPdfRequest =
      mimeType === 'application/pdf' ||
      input.mimeType === 'application/pdf' ||
      detectFormatFromUriOrName(input.fileName || input.imageUri).mimeType === 'application/pdf' ||
      detectFormatFromBase64Prefix(base64Data)?.mimeType === 'application/pdf';

    if (isPdfRequest) {
      mimeType = 'application/pdf';
      if (base64Data) {
        const pdfBytes = base64ToUint8Array(base64Data);
        const validation = validatePdfBytes(pdfBytes);
        if (!validation.valid) {
          const code = (validation.errorCode || 'CORRUPTED_PDF') as ScannerErrorCode;
          throw new ScannerError(
            validation.errorMessage || toUserFacingErrorMessage(code),
            code,
            requestId,
            422
          );
        }
      }
    }

    // Multi-page & multi-region PDF orchestration:
    // 1. Inspect page count, embedded regions (multiple receipts on 1 page), and text boundaries.
    // 2. Dispatch controlled batches/units cleanly (avoiding blind merging of distinct receipts).
    // 3. Retry failed page units independently without re-scanning succeeded pages.
    // 4. Run consolidatePdfReceiptGroups to merge true multi-page continuations while separating distinct receipts.
    if (isPdfRequest && ((input.pages && input.pages.length > 0) || (input.pageImages && input.pageImages.length > 1))) {
      const orchestrated = await this.analyzeStructuredPdfDocument(input, base64Data, requestId, startTime);
      if (orchestrated) {
        return orchestrated;
      }
    }

    // Standard single-page / image / fallback analysis
    const shouldIncludeRawBinary =
      Boolean(base64Data) &&
      !(
        isPdfRequest &&
        input.pdfType === 'text' &&
        (input.extractedText || '').trim().length >= 45 &&
        base64Data.length > 3_500_000
      ) &&
      !(isPdfRequest && input.pageImages && input.pageImages.length > 0 && base64Data.length > 3_500_000);

    const { rawResult, providerName } = await this.dispatchBackendScanPayloadWithMeta(
      {
        imageBase64: shouldIncludeRawBinary ? base64Data : undefined,
        mimeType,
        fileName: input.fileName,
        extractedText: input.extractedText,
        pdfType: input.pdfType,
        pageCount: input.pageCount,
        pageImages: input.pageImages,
        requestId,
      },
      startTime
    );

    return this.parseAndValidateResponse(rawResult, providerName);
  }

  private async analyzeStructuredPdfDocument(
    input: GeminiMultimodalInput,
    pdfBase64: string,
    requestId: string,
    startTime: number
  ): Promise<GeminiReceiptResponse | null> {
    const pages: PdfPageInputPayload[] = input.pages && input.pages.length > 0
      ? input.pages
      : (input.pageImages || []).map((img) => ({
          pageNumber: img.pageNumber,
          text: img.extractedText || '',
          charCount: (img.extractedText || '').replace(/\s+/g, '').length,
          hasImages: true,
          isScannedCandidate: true,
          renderedImageBase64: img.base64,
          mimeType: img.mimeType,
        }));

    if (pages.length === 0) return null;

    const totalPages = input.pageCount || pages.length;
    const failedPages: Array<{ pageNumber: number; error: string }> = [];

    // Build extraction units:
    // - If a page detected multiple cropped receipt regions (`regions.length >= 2`), extract each region independently!
    // - Otherwise inspect each page (keeping text-only single-invoice short PDFs fast when no boundaries exist).
    type ExtractionUnit = {
      unitId: string;
      pageNumber: number;
      regionIndex?: number;
      text?: string;
      imageBase64?: string;
      mimeType: string;
    };

    const anyMultiRegion = pages.some((p) => p.regions && p.regions.length >= 2);
    const anyVisualPage = pages.some((p) => Boolean(p.renderedImageBase64) || p.isScannedCandidate);
    const textHints = detectPageTextBoundaryHints(
      pages.map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text || '',
        charCount: p.charCount || 0,
        hasImages: Boolean(p.hasImages),
        isScannedCandidate: Boolean(p.isScannedCandidate),
      }))
    );

    // Fast path ONLY for pure 1-page PDF with <= 1 image region: 1 backend request (supports multi-receipt JSON natively too)
    if (pages.length === 1 && !anyMultiRegion) {
      return null;
    }

    // Fast path ONLY when pure text PDF clearly shows single-invoice continuation markers & <= 4 pages
    if (!anyMultiRegion && !anyVisualPage && pages.length <= 4 && !textHints.likelyMultipleReceipts) {
      const { rawResult, providerName } = await this.dispatchBackendScanPayloadWithMeta(
        {
          imageBase64: pdfBase64 && pdfBase64.length <= 3_500_000 ? pdfBase64 : undefined,
          mimeType: 'application/pdf',
          fileName: input.fileName,
          extractedText: input.extractedText,
          pdfType: input.pdfType || 'text',
          pageCount: totalPages,
          requestId,
        },
        startTime
      );
      if (rawResult?.multipleReceiptsDetected && Array.isArray(rawResult.receipts) && rawResult.receipts.length > 1) {
        return this.buildConsolidatedMultiReceiptResponse(
          rawResult.receipts.map((r: any, idx: number) => ({
            pageNumber: Array.isArray(r.sourcePageNumbers) ? r.sourcePageNumbers[0] || 1 : idx + 1,
            regionIndex: r.sourceRegionIndex,
            extraction: r,
          })),
          totalPages,
          pages.length,
          failedPages,
          providerName,
          requestId
        );
      }
      return this.parseAndValidateResponse(rawResult, providerName);
    }

    // Controlled page-by-page / region-by-region extraction units (handles ALL pages & embedded images accurately!)
    const units: ExtractionUnit[] = [];
    for (const p of pages) {
      if (p.error) {
        failedPages.push({ pageNumber: p.pageNumber, error: p.error });
        continue;
      }

      if (p.regions && p.regions.length >= 2) {
        for (const reg of p.regions) {
          units.push({
            unitId: `p${p.pageNumber}_r${reg.regionIndex}`,
            pageNumber: p.pageNumber,
            regionIndex: reg.regionIndex,
            text: p.text || undefined,
            imageBase64: reg.base64,
            mimeType: reg.mimeType || 'image/jpeg',
          });
        }
      } else if (p.renderedImageBase64) {
        units.push({
          unitId: `p${p.pageNumber}`,
          pageNumber: p.pageNumber,
          text: p.text || undefined,
          imageBase64: p.renderedImageBase64,
          mimeType: p.mimeType || 'image/jpeg',
        });
      } else if ((p.text || '').trim().length > 0) {
        units.push({
          unitId: `p${p.pageNumber}`,
          pageNumber: p.pageNumber,
          text: p.text.trim(),
          mimeType: 'application/pdf',
        });
      }
    }

    if (units.length === 0) {
      return null;
    }

    const concurrency = 2;
    const extractedUnits: Array<{
      pageNumber: number;
      regionIndex?: number;
      extraction: Record<string, unknown>;
    }> = [];
    let completedCount = 0;

    const runUnitWithRetry = async (unit: ExtractionUnit): Promise<void> => {
      const payloadForUnit = unit.imageBase64
        ? {
            imageBase64: unit.imageBase64,
            mimeType: unit.mimeType,
            fileName: `${input.fileName || 'receipt'}_page_${unit.pageNumber}${unit.regionIndex ? `_r${unit.regionIndex}` : ''}.jpg`,
            extractedText: unit.text,
            pdfType: input.pdfType || 'scanned',
            pageCount: 1,
            requestId: `${requestId}-${unit.unitId}`,
          }
        : {
            mimeType: 'application/pdf',
            fileName: input.fileName,
            extractedText: unit.text,
            pdfType: 'text',
            pageCount: 1,
            requestId: `${requestId}-${unit.unitId}`,
          };

      let lastErr: any = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const { rawResult } = await this.dispatchBackendScanPayloadWithMeta(payloadForUnit, startTime);
          completedCount++;
          input.onProgress?.({
            stage: `Extracted page ${unit.pageNumber} of ${totalPages}${unit.regionIndex ? ` (Receipt #${unit.regionIndex})` : ''}`,
            currentPage: unit.pageNumber,
            totalPages,
          });

          // If this single page/region itself returned multiple receipts (`receipts: [...]`), expand each!
          if (rawResult?.multipleReceiptsDetected && Array.isArray(rawResult.receipts) && rawResult.receipts.length > 1) {
            rawResult.receipts.forEach((sub: any, sIdx: number) => {
              extractedUnits.push({
                pageNumber: unit.pageNumber,
                regionIndex: sub.sourceRegionIndex ?? (unit.regionIndex ? unit.regionIndex * 10 + sIdx + 1 : sIdx + 1),
                extraction: sub,
              });
            });
          } else {
            extractedUnits.push({
              pageNumber: unit.pageNumber,
              regionIndex: unit.regionIndex,
              extraction: rawResult,
            });
          }
          return;
        } catch (err: any) {
          lastErr = err;
          // Auth or explicit non-retryable rejection shouldn't retry blindly
          if (err instanceof ScannerError && (err.code === 'AUTH_REQUIRED' || err.code === 'SESSION_EXPIRED')) {
            throw err;
          }
          if (attempt === 1) {
            await new Promise((r) => setTimeout(r, 900));
          }
        }
      }

      failedPages.push({
        pageNumber: unit.pageNumber,
        error: lastErr?.message || `Page ${unit.pageNumber} could not be extracted.`,
      });
    };

    for (let i = 0; i < units.length; i += concurrency) {
      const batch = units.slice(i, i + concurrency);
      await Promise.all(batch.map((u) => runUnitWithRetry(u)));
    }

    if (extractedUnits.length === 0) {
      throw new ScannerError(
        failedPages[0]?.error || toUserFacingErrorMessage('UNREADABLE_PDF'),
        'UNREADABLE_PDF',
        requestId,
        422
      );
    }

    return this.buildConsolidatedMultiReceiptResponse(
      extractedUnits,
      totalPages,
      pages.length,
      failedPages,
      'keepr-multipage-pdf',
      requestId
    );
  }

  private buildConsolidatedMultiReceiptResponse(
    extractedUnits: Array<{
      pageNumber: number;
      regionIndex?: number;
      extraction: Record<string, unknown>;
    }>,
    totalPages: number,
    processedPages: number,
    failedPages: Array<{ pageNumber: number; error: string }>,
    providerName: string,
    requestId: string
  ): GeminiReceiptResponse {
    const grouped = consolidatePdfReceiptGroups(extractedUnits);

    if (grouped.receipts.length === 0) {
      return this.parseAndValidateResponse(extractedUnits[0].extraction, providerName);
    }

    const toResponseObj = (grp: (typeof grouped.receipts)[number]): GeminiReceiptResponse => {
      const mergedPayload = {
        ...grp.rawMergedPayload,
        isReceipt: grp.rawMergedPayload.isReceipt !== false,
        merchantName: grp.consolidated.storeName,
        merchantAddress: grp.consolidated.storeAddress,
        merchantGstin: grp.consolidated.gstin,
        taxAmount: grp.consolidated.totalGst,
        taxRate:
          grp.consolidated.gstPercentage != null
            ? `${grp.consolidated.gstPercentage}%`
            : (grp.rawMergedPayload.taxRate as string | undefined),
        grandTotal: grp.consolidated.finalAmountPaid,
        total: grp.consolidated.finalAmountPaid,
        sourcePageNumbers: grp.sourcePageNumbers,
        sourceRegionIndex: grp.sourceRegionIndex,
        warnings: grp.warnings,
        source: {
          receiptImageRequired: true,
          provider: providerName,
          requestId,
        },
      };
      return this.parseAndValidateResponse(mergedPayload, providerName);
    };

    const parsedList = grouped.receipts.map(toResponseObj);
    const primary = parsedList[0];

    return {
      ...primary,
      multipleReceiptsDetected: parsedList.length > 1,
      receipts: parsedList,
      warnings: Array.from(new Set([...(primary.warnings || []), ...grouped.warnings])),
      pageProcessingSummary: {
        totalPages,
        processedPages,
        failedPages,
        detectedReceiptsCount: parsedList.length,
      },
      source: {
        receiptImageRequired: true,
        provider: providerName,
        requestId,
      },
    };
  }

  private async dispatchBackendScanPayload(
    payload: {
      imageBase64?: string;
      mimeType: string;
      fileName?: string;
      extractedText?: string;
      pdfType?: string;
      pageCount?: number;
      pageImages?: GeminiMultimodalInput['pageImages'];
      requestId: string;
    },
    startTime: number
  ): Promise<GeminiReceiptResponse> {
    const { rawResult, providerName } = await this.dispatchBackendScanPayloadWithMeta(payload, startTime);
    return this.parseAndValidateResponse(rawResult, providerName);
  }

  private async dispatchBackendScanPayloadWithMeta(
    payload: {
      imageBase64?: string;
      mimeType: string;
      fileName?: string;
      extractedText?: string;
      pdfType?: string;
      pageCount?: number;
      pageImages?: GeminiMultimodalInput['pageImages'];
      requestId: string;
    },
    startTime: number
  ): Promise<{ rawResult: any; providerName: string }> {
    const { requestId } = payload;
    let rawResult: any = null;
    let providerName = 'supabase-edge-function';

    const isExplicitDevLocal =
      Boolean(__DEV__) &&
      process.env.DEV_RECEIPT_SCANNER_MODE === 'local' &&
      Boolean(process.env.EXPO_PUBLIC_BACKEND_SCAN_URL);

    if (isExplicitDevLocal && process.env.EXPO_PUBLIC_BACKEND_SCAN_URL) {
      const devBackendUrl = process.env.EXPO_PUBLIC_BACKEND_SCAN_URL;
      console.log(`[ReceiptScanner] [DEV ONLY] Invoking configured local dev proxy: ${devBackendUrl}`);

      const devController = new AbortController();
      const devTimeoutId = setTimeout(() => devController.abort(), 35000);

      try {
        let authHeader: string | null = null;
        if (isSupabaseConfigured) {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.access_token) {
            authHeader = `Bearer ${data.session.access_token}`;
          }
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        };
        if (authHeader) headers['Authorization'] = authHeader;

        console.log(`[ScannerDiagnostics] backend request started: proxy=${devBackendUrl} requestId=${requestId}`);

        const devRes = await fetch(devBackendUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: devController.signal,
        });

        clearTimeout(devTimeoutId);

        if (devRes.ok) {
          rawResult = await devRes.json();
          providerName = rawResult.source?.provider || 'local-dev-backend';
          console.log(`[ReceiptScanner] [DEV ONLY] Success via local dev proxy for requestId=${requestId}`);
        } else if (devRes.status === 400 || devRes.status === 422) {
          const errJson = await devRes.json().catch(() => null);
          const code = (errJson?.errorCode as ScannerErrorCode) || 'UNREADABLE_RECEIPT';
          throw new ScannerError(
            errJson?.error || toUserFacingErrorMessage(code),
            code,
            requestId,
            devRes.status
          );
        }
      } catch (devErr: any) {
        clearTimeout(devTimeoutId);
        if (devErr instanceof ScannerError) throw devErr;
        console.warn(`[ReceiptScanner] [DEV ONLY] Local dev proxy invocation failed:`, devErr?.message);
      }
    }

    if (!rawResult && isSupabaseConfigured) {
      try {
        console.log(`[ReceiptScanner] Preparing production Edge Function invocation (requestId=${requestId})`);

        if (!useAuthStore.getState().isInitialized || useAuthStore.getState().isLoading) {
          console.log(`[ReceiptScanner] Waiting for auth store restoration (requestId=${requestId})...`);
          const maxWaitMs = 2500;
          const pollInterval = 100;
          let waited = 0;
          while ((!useAuthStore.getState().isInitialized || useAuthStore.getState().isLoading) && waited < maxWaitMs) {
            await new Promise((r) => setTimeout(r, pollInterval));
            waited += pollInterval;
          }
        }

        let { data: sessionData } = await supabase.auth.getSession();
        let session = sessionData?.session || useAuthStore.getState().session;

        if (!session && !useAuthStore.getState().token) {
          await new Promise((r) => setTimeout(r, 200));
          const retryRes = await supabase.auth.getSession();
          session = retryRes.data?.session || useAuthStore.getState().session;
        }

        if (session?.expires_at) {
          const nowInSec = Math.floor(Date.now() / 1000);
          if (session.expires_at <= nowInSec + 30) {
            console.log(`[ReceiptScanner] Access token near expiry or expired, refreshing session (requestId=${requestId})...`);
            try {
              const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
              if (!refreshError && refreshData.session) {
                session = refreshData.session;
              }
            } catch (refreshErr) {
              console.warn(`[ReceiptScanner] Token refresh attempt failed (requestId=${requestId}):`, refreshErr);
            }
          }
        }

        const accessToken = session?.access_token || useAuthStore.getState().token;
        const currentUserId = session?.user?.id || useAuthStore.getState().user?.id || 'none';

        console.log(
          `[ReceiptScanner] Auth Telemetry: sessionExists=${Boolean(session)} tokenExists=${Boolean(accessToken)} userId=${currentUserId} authInitialized=${useAuthStore.getState().isInitialized} requestId=${requestId}`
        );

        if (!accessToken) {
          console.warn(`[ReceiptScanner] No authenticated session found for requestId=${requestId}. Halting unauthenticated request.`);
          throw new ScannerError(
            toUserFacingErrorMessage('AUTH_REQUIRED'),
            'AUTH_REQUIRED',
            requestId,
            401
          );
        }

        const targetSupabaseUrl =
          supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://lqzhfnsxgytwbeudtzks.supabase.co';
        const edgeFunctionUrl = `${targetSupabaseUrl}/functions/v1/scan-receipt`;

        console.log(`[ScannerDiagnostics] backend request started: edgeFunction=${edgeFunctionUrl} requestId=${requestId}`);

        let response: Response | null = null;
        let lastError: any = null;
        const maxAttempts = 2;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000);

          try {
            const res = await fetch(edgeFunctionUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${accessToken}`,
                'x-request-id': requestId,
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (res.ok || res.status === 401 || res.status === 403 || res.status === 400 || res.status === 422) {
              response = res;
              break;
            }

            if (attempt < maxAttempts && (res.status === 503 || res.status === 429 || res.status === 502 || res.status === 504)) {
              const backoff = attempt === 1 ? 1500 : 3000;
              console.warn(`[ReceiptScanner] Transient status ${res.status}, retrying in ${backoff}ms (attempt ${attempt}/${maxAttempts})...`);
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            }
            response = res;
            break;
          } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            lastError = fetchErr;
            const isCancel =
              fetchErr.name === 'AbortError' ||
              fetchErr.message?.includes('canceled') ||
              fetchErr.message?.includes('cancelled') ||
              fetchErr.message?.includes('aborted');

            if (attempt < maxAttempts && !isCancel) {
              const backoff = attempt === 1 ? 1500 : 3000;
              console.warn(`[ReceiptScanner] Network exception, retrying in ${backoff}ms (attempt ${attempt}/${maxAttempts})...`);
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            }
            throw fetchErr;
          }
        }

        if (!response) {
          throw lastError || new Error('No response from scanner backend');
        }

        const durationMs = Date.now() - startTime;
        console.log(`[ScannerDiagnostics] backend response received: status=${response.status} duration=${durationMs}ms requestId=${requestId}`);

        if (response.status === 401) {
          throw new ScannerError(
            toUserFacingErrorMessage('SESSION_EXPIRED'),
            'SESSION_EXPIRED',
            requestId,
            401
          );
        }
        if (response.status === 403) {
          throw new ScannerError(
            toUserFacingErrorMessage('FORBIDDEN'),
            'FORBIDDEN',
            requestId,
            403
          );
        }
        if (response.status === 408) {
          throw new ScannerError(
            toUserFacingErrorMessage('TIMEOUT'),
            'TIMEOUT',
            requestId,
            408
          );
        }
        if (response.status === 422 || response.status === 400) {
          const errJson = await response.json().catch(() => null);
          const serverCode = errJson?.errorCode as ScannerErrorCode | undefined;
          const mappedCode: ScannerErrorCode =
            serverCode || (response.status === 422 ? 'UNREADABLE_RECEIPT' : 'UNREADABLE_PDF');
          throw new ScannerError(
            errJson?.error || toUserFacingErrorMessage(mappedCode),
            mappedCode,
            requestId,
            response.status
          );
        }
        if (!response.ok) {
          let errorDetail = '';
          try {
            const errJson = await response.json();
            errorDetail = errJson?.error || '';
          } catch {}
          console.error(`[ReceiptScanner] Edge function HTTP ${response.status} error requestId=${requestId}:`, errorDetail);
          throw new ScannerError(
            toUserFacingErrorMessage('SERVER_ERROR'),
            'SERVER_ERROR',
            requestId,
            response.status
          );
        }

        const resJson = await response.json();
        if (resJson && !resJson.error) {
          rawResult = resJson;
          providerName = resJson.source?.provider || 'supabase-edge-function';
          console.log(`[ReceiptScanner] Success requestId=${requestId} duration=${durationMs}ms provider=${providerName}`);
        } else if (resJson?.error) {
          console.error(`[ReceiptScanner] Edge function payload error requestId=${requestId}:`, resJson.error);
          throw new ScannerError(
            resJson.error || toUserFacingErrorMessage('SERVER_ERROR'),
            (resJson.errorCode as ScannerErrorCode) || 'SERVER_ERROR',
            requestId,
            500
          );
        }
      } catch (err: any) {
        if (err instanceof ScannerError) throw err;
        const msg = err?.message || String(err);
        const isTimeoutOrAbort =
          err.name === 'AbortError' ||
          msg.includes('canceled') ||
          msg.includes('cancelled') ||
          msg.includes('aborted') ||
          msg.includes('timeout') ||
          msg.includes('timed out');

        if (isTimeoutOrAbort) {
          console.warn(`[ReceiptScanner] Scan request timeout/aborted requestId=${requestId}`);
          throw new ScannerError(
            toUserFacingErrorMessage('TIMEOUT'),
            'TIMEOUT',
            requestId,
            408
          );
        }

        console.error(`[ReceiptScanner] Client network invocation error requestId=${requestId}:`, msg);
        throw new ScannerError(
          toUserFacingErrorMessage('NETWORK_ERROR'),
          'NETWORK_ERROR',
          requestId,
          0
        );
      }
    }

    if (!rawResult) {
      throw new ScannerError(
        toUserFacingErrorMessage('SERVICE_UNAVAILABLE'),
        'SERVICE_UNAVAILABLE',
        requestId
      );
    }

    return { rawResult, providerName };
  }

  private parseAndValidateResponse(rawInput: any, provider: string): GeminiReceiptResponse {
    let parsed: any;
    if (typeof rawInput === 'string') {
      let cleanJson = rawInput.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      }
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        throw new Error('Failed to parse response structure from receipt scanner.');
      }
    } else {
      parsed = rawInput;
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid response structure received from receipt scanner.');
    }

    // Normalize flat top-level fields with Zod without touching nested docFields or fabricating nulls
    const zodChecked = validateExtractedReceiptPayload(parsed);
    const zData = zodChecked.data;

    console.log(`[ScannerDiagnostics] OCR completed: mode=vision-multimodal`);
    console.log(`[ScannerDiagnostics] extraction completed: items=${parsed.items?.length || 0} fieldsCount=${Object.keys(parsed.document?.fields || {}).length}`);
    console.log(`[ScannerDiagnostics] normalization completed`);

    return {
      ...parsed,
      merchantName: parsed.merchantName ?? zData.merchantName ?? zData.storeName,
      merchantAddress: parsed.merchantAddress ?? zData.storeAddress,
      merchantGstin: parsed.merchantGstin ?? zData.gstin,
      invoiceDate: parsed.invoiceDate ?? zData.invoiceDate,
      purchaseDate: parsed.purchaseDate ?? zData.purchaseDate,
      taxableAmount: parsed.taxableAmount ?? zData.taxableAmount,
      taxAmount: parsed.taxAmount ?? zData.totalGst,
      taxRate: parsed.taxRate ?? zData.gstPercentage,
      cgst: parsed.cgst ?? zData.cgst,
      sgst: parsed.sgst ?? zData.sgst,
      igst: parsed.igst ?? zData.igst,
      grandTotal: parsed.grandTotal ?? zData.finalAmountPaid,
      total: parsed.total ?? zData.finalAmountPaid,
      paymentMethod: parsed.paymentMethod ?? zData.paymentMethod,
      itemDescription: parsed.itemDescription ?? zData.itemDescription,
      isReceipt: parsed.isReceipt !== false,
      source: {
        receiptImageRequired: true,
        provider: parsed.source?.provider || provider,
        model: parsed.source?.model,
        requestId: parsed.source?.requestId,
      },
    };
  }
}

export const geminiReceiptService = new GeminiMultimodalReceiptService();

export async function executeGeminiReceiptAnalysis(
  input: GeminiMultimodalInput
): Promise<GeminiReceiptResponse> {
  return await geminiReceiptService.analyzeReceiptWithOcr(input);
}

