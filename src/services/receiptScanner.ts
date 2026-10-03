
import {
  ExtractedReceiptData,
  GeminiReceiptResponse,
} from '../types/scanner';
import { parseGeminiResponseToExtractedData } from './receiptParser';

import { Platform } from 'react-native';
import { isSupabaseConfigured } from '../lib/supabase';

// Client-side Gemini API key storage is eliminated for security.
// All Gemini calls and secrets remain strictly server-side (Supabase Edge Functions).
export function getGeminiApiKey(): string | null {
  return null;
}

export function setRuntimeGeminiApiKey(_key: string | null): void {
}

export function isGeminiConfigured(): boolean {
  return Boolean(
    isSupabaseConfigured ||
    process.env.EXPO_PUBLIC_BACKEND_SCAN_URL
  );
}

/**
 * Fast helper to convert a Uint8Array into a Base64 string in memory.
 * Avoids React Native's slow Blob store overhead and FileReader roundtrips.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }
  const maybeBuffer = (globalThis as any).Buffer;
  if (typeof maybeBuffer !== 'undefined') {
    return maybeBuffer.from(bytes).toString('base64');
  }
  return '';
}

/**
 * Universal cross-platform helper to convert any image URI
 * (file://, content://, blob:, data:, https://) into pure base64.
 * Fully compatible with Expo SDK 57 on Android, iOS, and Web.
 */
export async function uriToBase64(uri: string): Promise<string> {
  if (!uri || uri.trim().length === 0) {
    throw new Error('No image URI provided for base64 conversion.');
  }

  if (uri.startsWith('data:')) {
    const commaIndex = uri.indexOf(',');
    return commaIndex !== -1 ? uri.slice(commaIndex + 1) : uri;
  }

  if (Platform.OS !== 'web') {
    try {
      const { File } = require('expo-file-system');
      if (File) {
        const file = new File(uri);
        if (typeof file.base64 === 'function') {
          const b64 = await file.base64();
          if (b64 && b64.length > 0) {
            return b64;
          }
        }
      }
    } catch {
    }

    try {
      const FileSystem = require('expo-file-system/legacy');
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (base64 && base64.length > 0) {
        return base64;
      }
    } catch {
    }
  }

  try {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = uint8ArrayToBase64(new Uint8Array(arrayBuffer));
    if (base64Data && base64Data.length > 0) {
      return base64Data;
    }
  } catch {
  }

  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64Data = result.includes(',') ? result.split(',')[1] : result;
        if (base64Data && base64Data.length > 0) {
          resolve(base64Data);
        } else {
          reject(new Error('FileReader produced an empty base64 string.'));
        }
      };
      reader.onerror = () => reject(new Error('FileReader encountered an error reading image blob.'));
      reader.readAsDataURL(blob);
    });
  } catch (finalErr: any) {
    throw new Error(`Failed to convert image to base64: ${finalErr?.message || finalErr}`);
  }
}

/**
 * Pluggable Provider Interface for AI Receipt Understanding
 */
export interface IReceiptScannerProvider {
  readonly name: string;
  isAvailable(): boolean;
  scanReceipt(
    imageUri: string,
    mimeType?: string,
    onStep?: (stepIndex: number, stepLabel: string) => void
  ): Promise<GeminiReceiptResponse>;
}

/**
 * Production Gemini API Provider
 */
export class GeminiReceiptScannerProvider implements IReceiptScannerProvider {
  readonly name = 'Keepr Receipt Scanner (Secure Backend)';

  isAvailable(): boolean {
    return isGeminiConfigured();
  }

  async scanReceipt(
    imageUri: string,
    mimeType: string = 'image/jpeg',
    onStep?: (stepIndex: number, stepLabel: string) => void
  ): Promise<GeminiReceiptResponse> {
    onStep?.(1, 'Reading receipt');
    const base64Data = await uriToBase64(imageUri);

    onStep?.(2, 'Identifying merchant');
    onStep?.(3, 'Detecting products');

    const { GeminiMultimodalReceiptService } = require('./geminiReceiptService');
    const service = new GeminiMultimodalReceiptService();
    const result = await service.analyzeReceiptWithOcr({
      imageUri,
      base64: base64Data,
      mimeType,
    });

    onStep?.(4, 'Extracting purchase details');
    onStep?.(5, 'Identifying category');
    onStep?.(6, 'Checking warranty information');

    return result;
  }
}

/**
 * Service Orchestrator
 */
export class ReceiptScannerService {
  private geminiProvider = new GeminiReceiptScannerProvider();

  /**
   * Main scan executor. Uses Gemini Vision backend.
   * If unavailable, throws explicit error without fabricating receipt information.
   */
  async scanReceipt(
    imageUri: string,
    imageName?: string,
    presetId?: string,
    onStep?: (stepIndex: number, stepLabel: string) => void
  ): Promise<ExtractedReceiptData> {
    if (!this.geminiProvider.isAvailable()) {
      throw new Error('Receipt scanning is currently unavailable.');
    }

    onStep?.(1, 'Reading receipt image');
    const geminiResp = await this.geminiProvider.scanReceipt(imageUri, 'image/jpeg', onStep);

    return this.transformGeminiResponseToExtractedData(
      geminiResp,
      imageUri,
      imageName || 'Receipt.jpg',
      'gemini'
    );
  }

  /**
   * Transforms Gemini structured response into UI-ready ExtractedReceiptData
   */
  private transformGeminiResponseToExtractedData(
    resp: GeminiReceiptResponse,
    imageUri: string,
    imageName: string,
    _provider: 'gemini' | 'offline_neural'
  ): ExtractedReceiptData {
    return parseGeminiResponseToExtractedData(resp, imageUri, imageName);
  }
}

export const receiptScannerService = new ReceiptScannerService();
