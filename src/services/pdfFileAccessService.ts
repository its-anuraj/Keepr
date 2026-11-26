import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import {
  base64ToUint8Array,
  PdfValidationResult,
  validatePdfBytes,
} from './pdfReceiptProcessor';
import {
  classifyFileAccessError,
  getUriSchemeForLog,
  isUriInsideScopedDirectories,
  logScannerStage,
  normalizeComparableFileUri,
} from './pdfAccessDiagnostics';
import { detectFormatFromBase64Prefix, detectFormatFromBytes, detectFormatFromUriOrName } from '../utils/imageIntegrity';

const PDF_WORK_SUBDIR = 'receipt_pdfs';

export interface PickedDocumentMetadata {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

export interface PreparedPdfAccessResult {
  success: boolean;
  uri: string;
  originalUri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  copiedToAppCache: boolean;
  validation?: PdfValidationResult;
  errorMessage?: string;
}

export interface SafeBinaryReadResult {
  success: boolean;
  uri: string;
  base64: string;
  bytes: Uint8Array;
  sizeBytes: number;
  mimeType: string;
  fileName: string;
  copiedToAppCache: boolean;
  validation?: PdfValidationResult;
  errorMessage?: string;
}

function getScopedRoots(): string[] {
  const roots: string[] = [];
  try {
    if (Paths?.cache?.uri) roots.push(Paths.cache.uri);
  } catch {}
  try {
    if (Paths?.document?.uri) roots.push(Paths.document.uri);
  } catch {}
  if (FileSystem.cacheDirectory) roots.push(FileSystem.cacheDirectory);
  if (FileSystem.documentDirectory) roots.push(FileSystem.documentDirectory);
  return roots;
}

function getAppPdfCacheDirectoryUri(): string {
  let baseDir = '';
  try {
    if (Paths?.cache?.uri) baseDir = Paths.cache.uri;
  } catch {}
  if (!baseDir) {
    baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  }
  if (!baseDir) return '';
  const withSlash = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  return `${withSlash}${PDF_WORK_SUBDIR}/`;
}

async function ensureAppPdfCacheDirectory(): Promise<string> {
  const dirUri = getAppPdfCacheDirectoryUri();
  if (!dirUri) {
    throw new Error('App cache directory is unavailable on this device.');
  }

  try {
    const dir = new Directory(Paths.cache, PDF_WORK_SUBDIR);
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
    }
    if (dir.uri) {
      return dir.uri.endsWith('/') ? dir.uri : `${dir.uri}/`;
    }
  } catch {
    // Fallback to legacy makeDirectoryAsync below
  }

  const info = await FileSystem.getInfoAsync(dirUri).catch(() => null);
  if (!info?.exists) {
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  }
  return dirUri;
}

function buildSafeCacheFilename(
  rawName?: string | null,
  mimeType?: string | null,
  fallbackPrefix = 'receipt_file'
): string {
  const mimeLower = (mimeType || '').toLowerCase();
  const defaultExt = mimeLower.includes('pdf')
    ? '.pdf'
    : mimeLower.includes('png')
    ? '.png'
    : mimeLower.includes('webp')
    ? '.webp'
    : '.jpg';
  const base = (rawName || `${fallbackPrefix}_${Date.now()}${defaultExt}`)
    .split(/[\\/]/)
    .pop()!
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const hasKnownExt = /\.(pdf|png|webp|heic|heif|jpe?g)$/i.test(base);
  const ensuredExt = hasKnownExt ? base : `${base}${defaultExt}`;
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${ensuredExt}`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (!bytes || bytes.byteLength === 0) return '';
  const maybeBuffer = (globalThis as any).Buffer;
  if (typeof maybeBuffer !== 'undefined') {
    return maybeBuffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode(...slice);
  }
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(binary);
  }
  return '';
}

/**
 * Fallback stream reader using React Native fetch / XMLHttpRequest (ArrayBuffer).
 * Critical escape hatch when ExpoFilePermissionService blocks host Expo Go paths
 * such as `file:///data/user/0/host.exp.exponent/cache/DocumentPicker/...` or restricted content URIs.
 */
async function readBytesViaNetworkOrXhr(uri: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(uri);
    if (resp.ok) {
      const ab = await resp.arrayBuffer();
      if (ab && ab.byteLength > 0) {
        return new Uint8Array(ab);
      }
    }
  } catch {
    // Try XHR ArrayBuffer below
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    try {
      const bytes = await new Promise<Uint8Array | null>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', uri, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
          if ((xhr.status === 200 || xhr.status === 0) && xhr.response instanceof ArrayBuffer && xhr.response.byteLength > 0) {
            resolve(new Uint8Array(xhr.response));
          } else {
            resolve(null);
          }
        };
        xhr.onerror = () => resolve(null);
        xhr.ontimeout = () => resolve(null);
        xhr.timeout = 20000;
        xhr.send();
      });
      if (bytes && bytes.byteLength > 0) return bytes;
    } catch {
      // Ignore and let caller handle
    }
  }

  return null;
}

/**
 * Verify that an already-local scoped file URI actually exists, is non-empty,
 * and can be read from disk using Expo FileSystem SDK 57 APIs.
 */
async function verifyScopedFileReadable(
  localUri: string
): Promise<{ readable: boolean; sizeBytes: number; bytesSample?: Uint8Array }> {
  if (!localUri || Platform.OS === 'web') {
    return { readable: Boolean(localUri), sizeBytes: 0 };
  }

  try {
    const modernFile = new File(localUri);
    const info = modernFile.info();
    if (info.exists && typeof info.size === 'number' && info.size > 0) {
      // Probe byte readability using FileHandle (first 16 bytes) or small base64 slice
      try {
        const b64Head = await FileSystem.readAsStringAsync(localUri, {
          encoding: FileSystem.EncodingType.Base64,
          position: 0,
          length: 16,
        });
        const sample = base64ToUint8Array(b64Head);
        if (sample.length > 0) {
          return { readable: true, sizeBytes: info.size, bytesSample: sample };
        }
      } catch {
        // Fallback full read via modern File API if position/length is unsupported
        const allBytes = await modernFile.bytes();
        if (allBytes.byteLength > 0) {
          return {
            readable: true,
            sizeBytes: allBytes.byteLength,
            bytesSample: allBytes.subarray(0, 16),
          };
        }
      }
    }
  } catch {
    // Fall back to legacy verification below
  }

  try {
    const info = await FileSystem.getInfoAsync(localUri);
    if (info.exists && !info.isDirectory) {
      const sizeBytes = 'size' in info && typeof info.size === 'number' ? info.size : 0;
      const b64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: 0,
        length: 16,
      });
      const sample = base64ToUint8Array(b64);
      if (sample.length > 0) {
        return { readable: true, sizeBytes: sizeBytes || sample.length, bytesSample: sample };
      }
    }
  } catch {
    return { readable: false, sizeBytes: 0 };
  }

  return { readable: false, sizeBytes: 0 };
}

/**
 * Copy a picked Android/iOS URI (`content://`, SAF `content://`, or unscoped `file://.../DocumentPicker/...`)
 * into an app-controlled Experience-scoped directory under `FileSystem.cacheDirectory` (`Paths.cache`)
 * and verify the copied file exists, is non-empty, and is readable.
 */
async function copyUriToAppCacheSafely(
  sourceUri: string,
  targetFileName: string,
  mimeType?: string | null
): Promise<{ copiedUri: string; method: string; sizeBytes: number }> {
  const destDirUri = await ensureAppPdfCacheDirectory();
  const safeName = buildSafeCacheFilename(targetFileName, mimeType);
  const destUri = `${destDirUri}${safeName}`;
  const cleanSource = normalizeComparableFileUri(sourceUri);

  // Strategy 1 (Recommended for Android content:// & SAF URIs): legacy FileSystem.copyAsync opens ContentResolver stream once
  if (cleanSource.startsWith('content://') || cleanSource.startsWith('file://')) {
    try {
      await FileSystem.copyAsync({
        from: cleanSource,
        to: destUri,
      });
      const verified = await verifyScopedFileReadable(destUri);
      if (verified.readable && verified.sizeBytes > 0) {
        return { copiedUri: destUri, method: 'legacy-copyAsync', sizeBytes: verified.sizeBytes };
      }
    } catch (copyErr) {
      logScannerStage('FILE_COPIED_TO_CACHE', 'fallback', {
        method: 'legacy-copyAsync',
        scheme: getUriSchemeForLog(cleanSource),
        errorCategory: classifyFileAccessError(copyErr),
        note: (copyErr as any)?.message || 'copyAsync failed, trying modern File.copy',
      });
    }
  }

  // Strategy 2: Modern Expo SDK 57 FileSystem File.copy (supports SAF/ContentProviderFile -> JavaFile)
  try {
    const srcFile = new File(cleanSource);
    const dstFile = new File(destUri);
    await srcFile.copy(dstFile);
    const verified = await verifyScopedFileReadable(destUri);
    if (verified.readable && verified.sizeBytes > 0) {
      return { copiedUri: destUri, method: 'modern-file-copy', sizeBytes: verified.sizeBytes };
    }
  } catch (modernErr) {
    logScannerStage('FILE_COPIED_TO_CACHE', 'fallback', {
      method: 'modern-file-copy',
      scheme: getUriSchemeForLog(cleanSource),
      errorCategory: classifyFileAccessError(modernErr),
      note: (modernErr as any)?.message || 'modern File.copy failed, trying RN fetch/XHR',
    });
  }

  // Strategy 3: RN Networking/XHR byte stream -> write to app-controlled cache File
  // Recovers unscoped Expo Go `DocumentPicker` paths where ExpoFilePermissionService blocks direct FileSystem access.
  const fetchedBytes = await readBytesViaNetworkOrXhr(cleanSource);
  if (fetchedBytes && fetchedBytes.byteLength > 0) {
    try {
      const dstFile = new File(destUri);
      dstFile.create({ overwrite: true, intermediates: true });
      dstFile.write(fetchedBytes);
    } catch {
      const b64 = uint8ArrayToBase64(fetchedBytes);
      await FileSystem.writeAsStringAsync(destUri, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    const verified = await verifyScopedFileReadable(destUri);
    if (verified.readable && verified.sizeBytes > 0) {
      return { copiedUri: destUri, method: 'stream-fetch-write', sizeBytes: verified.sizeBytes };
    }
  }

  throw new Error(
    `Selected document could not be copied into readable app storage (scheme=${getUriSchemeForLog(cleanSource)}). Please re-select the file from Downloads or Files.`
  );
}

/**
 * Prepare any picked or previously-referenced PDF asset so its returned URI is guaranteed
 * to be inside app-controlled readable storage (`receipt_pdfs/`) or verified `vault_*` storage.
 * Never swallows errors silently and never leaves an unreadable `DocumentPicker` path active.
 */
export async function preparePdfForScanning(
  asset: PickedDocumentMetadata,
  options?: { base64Fallback?: string | null }
): Promise<PreparedPdfAccessResult> {
  const start = Date.now();
  const rawUri = asset?.uri?.trim() || '';
  const detectedNameMeta = detectFormatFromUriOrName(asset?.name || rawUri);
  const fileName =
    asset?.name?.trim() ||
    (rawUri ? rawUri.split(/[\\/]/).pop()!.split('?')[0] : '') ||
    `Receipt_${Date.now()}.pdf`;
  const mimeType = asset?.mimeType || 'application/pdf';

  logScannerStage('DOCUMENT_SELECTED', 'ok', {
    scheme: getUriSchemeForLog(rawUri),
    fileExt: detectedNameMeta.extension,
    sizeBytes: typeof asset?.size === 'number' ? asset.size : undefined,
  });

  if (!rawUri && !options?.base64Fallback) {
    logScannerStage('DOCUMENT_VALIDATED', 'fail', {
      errorCategory: 'MISSING_URI',
      note: 'No file URI or base64 data returned by picker',
    });
    return {
      success: false,
      uri: '',
      originalUri: '',
      fileName,
      mimeType,
      sizeBytes: 0,
      copiedToAppCache: false,
      errorMessage: 'No PDF file location was returned. Please choose the file again.',
    };
  }

  if (asset?.size === 0) {
    logScannerStage('DOCUMENT_VALIDATED', 'fail', {
      scheme: getUriSchemeForLog(rawUri),
      errorCategory: 'FILE_EMPTY',
      sizeBytes: 0,
    });
    return {
      success: false,
      uri: rawUri,
      originalUri: rawUri,
      fileName,
      mimeType,
      sizeBytes: 0,
      copiedToAppCache: false,
      errorMessage: 'The selected PDF file is empty (0 bytes). Please choose a valid PDF document.',
    };
  }

  logScannerStage('DOCUMENT_VALIDATED', 'ok', {
    scheme: getUriSchemeForLog(rawUri),
    fileExt: fileName.toLowerCase().endsWith('.pdf') ? '.pdf' : detectedNameMeta.extension,
    sizeBytes: typeof asset?.size === 'number' ? asset.size : undefined,
  });

  if (Platform.OS === 'web' || rawUri.startsWith('http://') || rawUri.startsWith('https://') || rawUri.startsWith('data:')) {
    return {
      success: true,
      uri: rawUri,
      originalUri: rawUri,
      fileName,
      mimeType,
      sizeBytes: asset?.size ?? 0,
      copiedToAppCache: false,
    };
  }

  // Recover directly from base64 fallback into app-controlled cache if supplied and file URI isn't scoped
  const scopedRoots = getScopedRoots();
  const isAlreadyScoped = isUriInsideScopedDirectories(rawUri, scopedRoots);

  logScannerStage('FILE_ACCESS_CHECK', 'ok', {
    scheme: getUriSchemeForLog(rawUri),
    method: isAlreadyScoped ? 'scoped-uri' : 'requires-cache-copy',
  });

  if (isAlreadyScoped) {
    const check = await verifyScopedFileReadable(rawUri);
    if (check.readable && check.sizeBytes > 0) {
      logScannerStage('FILE_ACCESS_CHECK', 'ok', {
        scheme: getUriSchemeForLog(rawUri),
        method: 'verified-readable',
        sizeBytes: check.sizeBytes,
        durationMs: Date.now() - start,
      });
      return {
        success: true,
        uri: rawUri,
        originalUri: rawUri,
        fileName,
        mimeType,
        sizeBytes: check.sizeBytes,
        copiedToAppCache: false,
      };
    }
  }

  try {
    const copied = await copyUriToAppCacheSafely(rawUri, fileName, mimeType);
    logScannerStage('FILE_COPIED_TO_CACHE', 'ok', {
      scheme: 'file',
      fileExt: detectFormatFromUriOrName(copied.copiedUri).extension,
      method: copied.method,
      sizeBytes: copied.sizeBytes,
      durationMs: Date.now() - start,
    });
    return {
      success: true,
      uri: copied.copiedUri,
      originalUri: rawUri,
      fileName,
      mimeType,
      sizeBytes: copied.sizeBytes,
      copiedToAppCache: true,
    };
  } catch (copyErr: any) {
    // Final recovery attempt from base64 if caller had it in memory
    if (options?.base64Fallback && options.base64Fallback.length > 16) {
      try {
        const dirUri = await ensureAppPdfCacheDirectory();
        const destUri = `${dirUri}${buildSafeCacheFilename(fileName, mimeType)}`;
        const cleanB64 = options.base64Fallback.replace(/^data:[^;]+;base64,/, '');
        const bytes = base64ToUint8Array(cleanB64);
        const validation = validatePdfBytes(bytes);
        if (validation.valid) {
          await FileSystem.writeAsStringAsync(destUri, cleanB64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const verified = await verifyScopedFileReadable(destUri);
          if (verified.readable) {
            logScannerStage('FILE_COPIED_TO_CACHE', 'ok', {
              method: 'base64-recovery',
              sizeBytes: verified.sizeBytes,
              durationMs: Date.now() - start,
            });
            return {
              success: true,
              uri: destUri,
              originalUri: rawUri,
              fileName,
              mimeType,
              sizeBytes: verified.sizeBytes,
              copiedToAppCache: true,
              validation,
            };
          }
        }
      } catch {
        // Proceed to failure reporting below
      }
    }

    logScannerStage('FILE_COPIED_TO_CACHE', 'fail', {
      scheme: getUriSchemeForLog(rawUri),
      errorCategory: classifyFileAccessError(copyErr),
      note: copyErr?.message || 'Failed to stabilize PDF to readable cache',
      durationMs: Date.now() - start,
    });
    return {
      success: false,
      uri: rawUri,
      originalUri: rawUri,
      fileName,
      mimeType,
      sizeBytes: asset?.size ?? 0,
      copiedToAppCache: false,
      errorMessage:
        copyErr?.message ||
        'Could not access the selected PDF file. Please select the PDF again from Downloads or Files.',
    };
  }
}

/**
 * Safely read any receipt or document file URI (`content://`, unscoped Expo Go `DocumentPicker` cache URI,
 * scoped `file://`, `data:`, or `http(s)://`) into validated bytes and base64 without calling
 * `ExponentFileSystem.readAsStringAsync` directly on restricted locations.
 */
export async function readUriBytesAndBase64Safely(
  inputUri: string,
  options?: {
    fileName?: string | null;
    mimeType?: string | null;
    base64Fallback?: string | null;
    validateAsPdf?: boolean;
  }
): Promise<SafeBinaryReadResult> {
  const start = Date.now();
  const cleanName = options?.fileName || inputUri.split(/[\\/]/).pop()?.split('?')[0] || 'document';
  const expectedMime =
    options?.mimeType || detectFormatFromUriOrName(cleanName || inputUri).mimeType || 'application/octet-stream';

  if (options?.base64Fallback) {
    const cleanB64 = options.base64Fallback.replace(/^data:[^;]+;base64,/, '');
    const bytes = base64ToUint8Array(cleanB64);
    if (bytes.length > 0) {
      const detected = detectFormatFromBytes(bytes);
      const isPdf = options?.validateAsPdf || detected.mimeType === 'application/pdf';
      const validation = isPdf ? validatePdfBytes(bytes) : undefined;
      if (validation && !validation.valid) {
        logScannerStage('DOCUMENT_VALIDATED', 'fail', {
          errorCategory: (validation.errorCode as any) || 'CORRUPTED_PDF',
          sizeBytes: bytes.length,
          note: validation.errorMessage,
        });
        return {
          success: false,
          uri: inputUri,
          base64: '',
          bytes,
          sizeBytes: bytes.length,
          mimeType: detected.mimeType,
          fileName: cleanName,
          copiedToAppCache: false,
          validation,
          errorMessage: validation.errorMessage,
        };
      }
      logScannerStage('FILE_READ_COMPLETED', 'ok', {
        method: 'in-memory-base64',
        fileExt: detected.extension,
        sizeBytes: bytes.length,
        durationMs: Date.now() - start,
      });
      return {
        success: true,
        uri: inputUri,
        base64: cleanB64,
        bytes,
        sizeBytes: bytes.length,
        mimeType: detected.mimeType !== 'image/jpeg' || expectedMime === 'image/jpeg' ? detected.mimeType : expectedMime,
        fileName: cleanName,
        copiedToAppCache: false,
        validation,
      };
    }
  }

  if (inputUri.startsWith('data:')) {
    const commaIdx = inputUri.indexOf(',');
    const b64 = commaIdx !== -1 ? inputUri.slice(commaIdx + 1) : '';
    const bytes = base64ToUint8Array(b64);
    const detected = detectFormatFromBytes(bytes);
    const isPdf = options?.validateAsPdf || detected.mimeType === 'application/pdf';
    const validation = isPdf ? validatePdfBytes(bytes) : undefined;
    return {
      success: Boolean(bytes.length > 0 && (!validation || validation.valid)),
      uri: inputUri,
      base64: b64,
      bytes,
      sizeBytes: bytes.length,
      mimeType: detectFormatFromBase64Prefix(b64)?.mimeType || expectedMime,
      fileName: cleanName,
      copiedToAppCache: false,
      validation,
      errorMessage: validation && !validation.valid ? validation.errorMessage : undefined,
    };
  }

  let effectiveUri = inputUri;
  let copiedToAppCache = false;

  if (Platform.OS !== 'web' && !inputUri.startsWith('http://') && !inputUri.startsWith('https://')) {
    const prepared = await preparePdfForScanning(
      { uri: inputUri, name: cleanName, mimeType: expectedMime },
      { base64Fallback: options?.base64Fallback }
    );
    if (!prepared.success) {
      logScannerStage('FILE_READ_COMPLETED', 'fail', {
        scheme: getUriSchemeForLog(inputUri),
        errorCategory: classifyFileAccessError(prepared.errorMessage),
        note: prepared.errorMessage,
        durationMs: Date.now() - start,
      });
      return {
        success: false,
        uri: inputUri,
        base64: '',
        bytes: new Uint8Array(0),
        sizeBytes: 0,
        mimeType: expectedMime,
        fileName: cleanName,
        copiedToAppCache: false,
        errorMessage: prepared.errorMessage,
      };
    }
    effectiveUri = prepared.uri;
    copiedToAppCache = prepared.copiedToAppCache;
  }

  let bytes: Uint8Array = new Uint8Array(0);
  let base64 = '';
  let readMethod = 'unknown';

  // Read verified file via modern Expo FileSystem File class first (clean binary access)
  if (Platform.OS !== 'web' && !effectiveUri.startsWith('http://') && !effectiveUri.startsWith('https://')) {
    try {
      const modernFile = new File(effectiveUri);
      bytes = await modernFile.bytes();
      if (bytes.byteLength > 0) {
        base64 = uint8ArrayToBase64(bytes);
        readMethod = 'modern-file-bytes';
      }
    } catch {
      // Fallback below
    }

    if (!base64) {
      try {
        base64 = await FileSystem.readAsStringAsync(effectiveUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (base64) {
          bytes = base64ToUint8Array(base64);
          readMethod = 'legacy-readAsStringAsync';
        }
      } catch (legacyErr) {
        logScannerStage('FILE_READ_COMPLETED', 'fallback', {
          scheme: getUriSchemeForLog(effectiveUri),
          method: 'legacy-readAsStringAsync',
          errorCategory: classifyFileAccessError(legacyErr),
          note: (legacyErr as any)?.message || 'legacy read failed, trying fetch',
        });
      }
    }
  }

  if (bytes.length === 0) {
    const netBytes = await readBytesViaNetworkOrXhr(effectiveUri);
    if (netBytes && netBytes.byteLength > 0) {
      bytes = netBytes;
      base64 = uint8ArrayToBase64(bytes);
      readMethod = 'stream-fetch';
    }
  }

  if (bytes.length === 0 || !base64) {
    logScannerStage('FILE_READ_COMPLETED', 'fail', {
      scheme: getUriSchemeForLog(effectiveUri),
      errorCategory: 'FILE_UNREADABLE',
      durationMs: Date.now() - start,
    });
    return {
      success: false,
      uri: effectiveUri,
      base64: '',
      bytes: new Uint8Array(0),
      sizeBytes: 0,
      mimeType: expectedMime,
      fileName: cleanName,
      copiedToAppCache,
      errorMessage: 'The PDF file could not be read from device storage. Please re-select the file.',
    };
  }

  const detected = detectFormatFromBytes(bytes);
  const resolvedMime =
    detected.format === 'pdf'
      ? 'application/pdf'
      : options?.mimeType || detected.mimeType || expectedMime;

  const isPdfCheck = options?.validateAsPdf || resolvedMime === 'application/pdf';
  const validation = isPdfCheck ? validatePdfBytes(bytes) : undefined;
  if (validation && !validation.valid) {
    logScannerStage('DOCUMENT_VALIDATED', 'fail', {
      scheme: getUriSchemeForLog(effectiveUri),
      errorCategory: (validation.errorCode as any) || 'CORRUPTED_PDF',
      sizeBytes: bytes.length,
      note: validation.errorMessage,
      durationMs: Date.now() - start,
    });
    return {
      success: false,
      uri: effectiveUri,
      base64: '',
      bytes,
      sizeBytes: bytes.length,
      mimeType: resolvedMime,
      fileName: cleanName,
      copiedToAppCache,
      validation,
      errorMessage: validation.errorMessage,
    };
  }

  logScannerStage('FILE_READ_COMPLETED', 'ok', {
    scheme: getUriSchemeForLog(effectiveUri),
    method: readMethod,
    fileExt: detected.extension,
    sizeBytes: bytes.length,
    durationMs: Date.now() - start,
  });

  return {
    success: true,
    uri: effectiveUri,
    base64,
    bytes,
    sizeBytes: bytes.length,
    mimeType: resolvedMime,
    fileName: cleanName,
    copiedToAppCache,
    validation,
  };
}
