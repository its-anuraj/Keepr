
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
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

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
      return 'Please sign in to scan receipts.';
    case 'SESSION_EXPIRED':
      return 'Your session has expired. Please sign in again.';
    case 'FORBIDDEN':
      return 'You are not authorized to scan receipts.';
    case 'NETWORK_ERROR':
      return "Couldn't connect to the receipt scanner. Please try again.";
    case 'TIMEOUT':
      return 'The receipt scan timed out. Please try again with a clearer photo.';
    case 'UNREADABLE_RECEIPT':
      return "We couldn't read this receipt clearly. Please upload a clearer photo.";
    case 'SERVICE_UNAVAILABLE':
    case 'SERVER_ERROR':
    default:
      return 'Receipt scanning is temporarily unavailable. Please try again.';
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
    if (!input.imageUri && !input.base64) {
      throw new Error('No receipt image was provided for analysis.');
    }

    // Deduplication key based on image URI or leading base64 signature
    const dedupKey = input.imageUri || (input.base64 ? input.base64.substring(0, 128) : 'default');
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

    const base64Data = input.base64 || (await uriToBase64(input.imageUri!));

    let mimeType = 'image/jpeg';
    const cleanTarget = (input.fileName || input.imageUri || '').toLowerCase();
    if (cleanTarget.endsWith('.png')) mimeType = 'image/png';
    else if (cleanTarget.endsWith('.webp')) mimeType = 'image/webp';
    else if (cleanTarget.endsWith('.heic') || cleanTarget.endsWith('.heif')) mimeType = 'image/heic';

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
          body: JSON.stringify({
            imageBase64: base64Data,
            mimeType,
            fileName: input.fileName,
            requestId,
          }),
          signal: devController.signal,
        });

        clearTimeout(devTimeoutId);

        if (devRes.ok) {
          rawResult = await devRes.json();
          providerName = rawResult.source?.provider || 'local-dev-backend';
          console.log(`[ReceiptScanner] [DEV ONLY] Success via local dev proxy for requestId=${requestId}`);
        }
      } catch (devErr: any) {
        clearTimeout(devTimeoutId);
        console.warn(`[ReceiptScanner] [DEV ONLY] Local dev proxy invocation failed:`, devErr?.message);
      }
    }

    if (!rawResult && isSupabaseConfigured) {
      try {
        console.log(`[ReceiptScanner] Preparing production Edge Function invocation (requestId=${requestId})`);

        // 1. Mitigate startup race conditions: wait briefly if auth store is actively initializing
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

        // 2. Retrieve active Supabase Auth session
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

        // 4. Safe Diagnostic Logging (Section 8 - NEVER log the access token)
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

        // 6. Section 4: Direct fetch with Authorization: Bearer <accessToken>
        const supabaseUrl =
          process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://lqzhfnsxgytwbeudtzks.supabase.co';
        const edgeFunctionUrl = `${supabaseUrl}/functions/v1/scan-receipt`;

        console.log(`[ScannerDiagnostics] backend request started: edgeFunction=${edgeFunctionUrl} requestId=${requestId}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 35000);

        let response: Response;
        try {
          response = await fetch(edgeFunctionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
              'x-request-id': requestId,
            },
            body: JSON.stringify({
              imageBase64: base64Data,
              mimeType,
              fileName: input.fileName,
              requestId,
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        const durationMs = Date.now() - startTime;
        console.log(`[ScannerDiagnostics] backend response received: status=${response.status} duration=${durationMs}ms requestId=${requestId}`);

        // 7. Section 9: Specific Error Code Disambiguation
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
        if (response.status === 422) {
          throw new ScannerError(
            toUserFacingErrorMessage('UNREADABLE_RECEIPT'),
            'UNREADABLE_RECEIPT',
            requestId,
            422
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
            toUserFacingErrorMessage('SERVER_ERROR'),
            'SERVER_ERROR',
            requestId,
            500
          );
        }
      } catch (err: any) {
        if (err instanceof ScannerError) throw err;
        if (err.name === 'AbortError') {
          throw new ScannerError(
            toUserFacingErrorMessage('TIMEOUT'),
            'TIMEOUT',
            requestId,
            408
          );
        }
        const msg = err?.message || String(err);
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

    return this.parseAndValidateResponse(rawResult, providerName);
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
      } catch (e: any) {
        throw new Error('Failed to parse response structure from receipt scanner.');
      }
    } else {
      parsed = rawInput;
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid response structure received from receipt scanner.');
    }

    console.log(`[ScannerDiagnostics] OCR completed: mode=vision-multimodal`);
    console.log(`[ScannerDiagnostics] extraction completed: items=${parsed.items?.length || 0} fieldsCount=${Object.keys(parsed.document?.fields || {}).length}`);
    console.log(`[ScannerDiagnostics] normalization completed`);

    return {
      ...parsed,
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

