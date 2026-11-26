
import {
  GeminiReceiptResponse,
  GeminiMultimodalInput,
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

    // Controlled batching for multi-page scanned PDFs (> 4 rendered pages)
    if (input.pageImages && input.pageImages.length > 4) {
      const batchSize = 4;
      const batchResults: Array<{ pageNumber: number; extraction: Record<string, unknown> }> = [];

      for (let i = 0; i < input.pageImages.length; i += batchSize) {
        const batch = input.pageImages.slice(i, i + batchSize);
        const batchText = batch
          .filter((p) => p.extractedText && p.extractedText.trim())
          .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.extractedText!.trim()}`)
          .join('\n\n');

        const batchPayload = await this.dispatchBackendScanPayload(
          {
            mimeType: 'application/pdf',
            fileName: input.fileName,
            extractedText: batchText || input.extractedText,
            pdfType: input.pdfType || 'mixed',
            pageCount: input.pageCount || input.pageImages.length,
            pageImages: batch,
            requestId: `${requestId}-b${Math.floor(i / batchSize) + 1}`,
          },
          startTime
        );
        batchResults.push({
          pageNumber: batch[0].pageNumber,
          extraction: batchPayload as unknown as Record<string, unknown>,
        });
      }

      const consolidated = consolidateMultiPageExtractions(batchResults);
      const mergedResponse = {
        ...consolidated.consolidated,
        isReceipt: true,
        merchantName: consolidated.consolidated.storeName,
        merchantAddress: consolidated.consolidated.storeAddress,
        merchantGstin: consolidated.consolidated.gstin,
        taxAmount: consolidated.consolidated.totalGst,
        taxRate: consolidated.consolidated.gstPercentage,
        grandTotal: consolidated.consolidated.finalAmountPaid,
        total: consolidated.consolidated.finalAmountPaid,
        source: {
          receiptImageRequired: true,
          provider: 'keepr-multipage-pdf',
          requestId,
        },
      };
      return this.parseAndValidateResponse(mergedResponse, 'keepr-multipage-pdf');
    }

    // For Type A text-based PDFs with rich searchable text, omit oversized raw binary > 4MB to stay fast and under Edge limits
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

