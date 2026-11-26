/**
 * KEEPR DIGITAL OWNERSHIP VAULT: Pure Image Metadata, Cryptographic Integrity & Viewer Geometry Utilities
 * Zero React Native native module dependencies so all logic can execute identically in Hermes/Android,
 * Web, and Node automated verification suites.
 */

import { detectFormatFromBytes, DetectedImageFormat } from './imageIntegrity';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface MediaQualityMetadata {
  format: DetectedImageFormat['format'];
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
  megapixels: number;
  qualityTier: 'high' | 'standard' | 'low';
}

export interface ContainedRect {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface PanBounds {
  maxX: number;
  maxY: number;
}

export interface FocalZoomParams {
  currentScale: number;
  nextScale: number;
  currentPanX: number;
  currentPanY: number;
  focalX: number;
  focalY: number;
  containerWidth: number;
  containerHeight: number;
  imageWidth?: number;
  imageHeight?: number;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Computes a deterministic cryptographic SHA-256 hex digest (FIPS 180-4) from raw bytes.
 * Pure TypeScript so image/PDF byte identity can be verified across RN Hermes and Node.
 */
export function computeSha256Hex(bytes: Uint8Array): string {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const len = bytes.length;
  const bitLenHi = Math.floor((len * 8) / 0x100000000);
  const bitLenLo = (len * 8) >>> 0;

  // Total padded length: multiple of 64 bytes with room for 0x80 and 8-byte bit length
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes, 0);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let out = '';
  for (let i = 0; i < 8; i++) {
    out += h[i].toString(16).padStart(8, '0');
  }
  return out;
}

/**
 * Decodes a standard Base64 string to Uint8Array safely without Node Buffer dependency.
 */
export function decodeBase64ToBytes(base64Input: string): Uint8Array {
  const clean = base64Input.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!clean) return new Uint8Array(0);

  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i) & 0xff;
    }
    return out;
  }

  // Pure Node fallback if global atob is unavailable
  const buf = Buffer.from(clean, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Extracts exact pixel dimensions directly from JPEG, PNG, or WebP binary headers.
 * Returns null for non-image payloads (e.g. PDFs) or unreadable headers.
 */
export function extractImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!bytes || bytes.length < 12) return null;

  // 1. PNG (\x89PNG\r\n\x1a\n): IHDR chunk starts at byte 8, width at 16..19, height at 20..23
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  }

  // 2. WebP (RIFF....WEBP)
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
  }

  // 3. JPEG (FF D8 ... SOFn marker)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) {
        offset++;
      }
      if (offset >= bytes.length) break;

      const marker = bytes[offset];
      offset++;

      // Standalone markers without length
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS (scan data)
        continue;
      }

      if (offset + 2 > bytes.length) break;
      const segLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segLength < 2) break;

      const isSofMarker =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);

      if (isSofMarker && offset + 7 <= bytes.length) {
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        if (width > 0 && height > 0) {
          return { width, height };
        }
        return null;
      }

      offset += segLength;
    }
  }

  return null;
}

/**
 * Generates a full quality & cryptographic integrity report from binary file bytes.
 */
export function buildMediaQualityMetadata(
  bytes: Uint8Array,
  overrideDimensions?: ImageDimensions | null
): MediaQualityMetadata {
  const detected = detectFormatFromBytes(bytes);
  const parsedDims =
    detected.format !== 'pdf' ? extractImageDimensions(bytes) : null;
  const width = overrideDimensions?.width || parsedDims?.width || 0;
  const height = overrideDimensions?.height || parsedDims?.height || 0;
  const pixels = width * height;
  const megapixels = pixels > 0 ? Math.round((pixels / 1_000_000) * 100) / 100 : 0;

  let qualityTier: 'high' | 'standard' | 'low' = 'standard';
  if (detected.format === 'pdf') {
    qualityTier = bytes.length >= 1024 ? 'high' : 'low';
  } else if (width >= 1500 || height >= 1500 || megapixels >= 2) {
    qualityTier = 'high';
  } else if (width > 0 && Math.max(width, height) < 600) {
    qualityTier = 'low';
  }

  return {
    format: detected.format,
    mimeType: detected.mimeType,
    extension: detected.extension,
    width,
    height,
    byteSize: bytes.length,
    sha256: computeSha256Hex(bytes),
    megapixels,
    qualityTier,
  };
}

/**
 * Builds a separate non-destructive filename for enhanced images (`invoice_enhanced.png`)
 * so original receipts, bills, and invoices are NEVER overwritten.
 */
export function buildEnhancedFilename(originalFileName: string, targetExtension = '.jpg'): string {
  const cleanName = (originalFileName || 'document').split(/[\\/]/).pop() || 'document';
  const dotIdx = cleanName.lastIndexOf('.');
  const baseRaw = dotIdx > 0 ? cleanName.slice(0, dotIdx) : cleanName;
  const baseNoSuffix = baseRaw.replace(/_enhanced(?:_\d+)?$/i, '');
  const cleanExt = targetExtension.startsWith('.') ? targetExtension : `.${targetExtension}`;
  return `${baseNoSuffix}_enhanced${cleanExt}`;
}

/**
 * Sanitizes a user-visible title/name into an authentic download filename with exact format extension.
 */
export function sanitizeDownloadFilename(
  rawName?: string | null,
  authenticExtension: string = '.jpg',
  fallbackPrefix: string = 'Keepr_File'
): string {
  const ext = authenticExtension.startsWith('.')
    ? authenticExtension.toLowerCase()
    : `.${authenticExtension.toLowerCase()}`;

  const rawTrimmed = (rawName || '').trim();
  const isUriOrUrl = /^(file:|content:|https?:)/i.test(rawTrimmed);
  const queryCleaned = isUriOrUrl ? rawTrimmed.split(/[?#]/)[0] : rawTrimmed;
  const looksLikePath = isUriOrUrl || /^(\/|[a-zA-Z]:[\\/]|vault_)/i.test(queryCleaned);
  const rawLeaf = looksLikePath ? (queryCleaned.split(/[\\/]/).pop() || '') : queryCleaned;
  const strippedExt = rawLeaf.replace(/\.(jpg|jpeg|png|webp|heic|pdf|bin)$/i, '');
  const cleaned = strippedExt
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 72);

  const base = cleaned || `${fallbackPrefix}_${new Date().toISOString().slice(0, 10)}`;
  return `${base}${ext}`;
}

/**
 * Resolves filename collisions cleanly (`Invoice.pdf` -> `Invoice (1).pdf` -> `Invoice (2).pdf`).
 */
export function resolveUniqueDownloadFilename(
  desiredFileName: string,
  existingFileNames: string[]
): string {
  const normalizedExisting = new Set(existingFileNames.map((n) => n.trim().toLowerCase()));
  if (!normalizedExisting.has(desiredFileName.trim().toLowerCase())) {
    return desiredFileName;
  }

  const dotIdx = desiredFileName.lastIndexOf('.');
  const stem = dotIdx > 0 ? desiredFileName.slice(0, dotIdx) : desiredFileName;
  const ext = dotIdx > 0 ? desiredFileName.slice(dotIdx) : '';

  let counter = 1;
  while (counter < 1000) {
    const candidate = `${stem} (${counter})${ext}`;
    if (!normalizedExisting.has(candidate.toLowerCase())) {
      return candidate;
    }
    counter++;
  }

  return `${stem}_${Date.now()}${ext}`;
}

/**
 * Computes the fitted (1x zoom) displayed image rectangle inside a container viewport
 * while preserving exact aspect ratio.
 */
export function computeContainedImageRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth?: number,
  imageHeight?: number
): ContainedRect {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  }
  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) {
    return {
      width: containerWidth,
      height: containerHeight,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const imageAspect = imageWidth / imageHeight;
  const containerAspect = containerWidth / containerHeight;

  if (imageAspect > containerAspect) {
    const width = containerWidth;
    const height = width / imageAspect;
    return {
      width,
      height,
      offsetX: 0,
      offsetY: (containerHeight - height) / 2,
    };
  }

  const height = containerHeight;
  const width = height * imageAspect;
  return {
    width,
    height,
    offsetX: (containerWidth - width) / 2,
    offsetY: 0,
  };
}

/**
 * Adapts maximum zoom level dynamically to image pixel density (always >= 4x, up to 8x for high-res).
 */
export function computeAdaptiveMaxZoom(
  containerWidth: number,
  containerHeight: number,
  imageWidth?: number,
  imageHeight?: number,
  requestedMaxZoom: number = 5
): number {
  const baseFloor = Math.max(4, requestedMaxZoom);
  if (!imageWidth || !imageHeight || containerWidth <= 0 || containerHeight <= 0) {
    return baseFloor;
  }

  const fitted = computeContainedImageRect(containerWidth, containerHeight, imageWidth, imageHeight);
  if (fitted.width <= 0) return baseFloor;

  const nativeDetailRatio = imageWidth / fitted.width;
  const adaptive = Math.max(baseFloor, Math.min(8, Math.ceil(nativeDetailRatio * 2)));
  return adaptive;
}

/**
 * Calculates accurate horizontal and vertical panning bounds at any zoom scale
 * based on the true aspect-fitted image dimensions so edges are fully reachable and centered cleanly.
 */
export function computePanBounds(
  scale: number,
  containerWidth: number,
  containerHeight: number,
  imageWidth?: number,
  imageHeight?: number
): PanBounds {
  if (scale <= 1.001) {
    return { maxX: 0, maxY: 0 };
  }

  const fitted = computeContainedImageRect(
    containerWidth,
    containerHeight,
    imageWidth,
    imageHeight
  );
  const scaledWidth = fitted.width * scale;
  const scaledHeight = fitted.height * scale;

  return {
    maxX: Math.max(0, (scaledWidth - containerWidth) / 2),
    maxY: Math.max(0, (scaledHeight - containerHeight) / 2),
  };
}

/**
 * Clamps pan offsets smoothly to valid aspect-aware image bounds.
 */
export function clampPanOffset(
  panX: number,
  panY: number,
  scale: number,
  containerWidth: number,
  containerHeight: number,
  imageWidth?: number,
  imageHeight?: number
): { x: number; y: number } {
  const { maxX, maxY } = computePanBounds(
    scale,
    containerWidth,
    containerHeight,
    imageWidth,
    imageHeight
  );
  const clampedX = Math.max(-maxX, Math.min(maxX, panX));
  const clampedY = Math.max(-maxY, Math.min(maxY, panY));
  return {
    x: clampedX === 0 ? 0 : clampedX,
    y: clampedY === 0 ? 0 : clampedY,
  };
}

/**
 * Computes new pan offsets when zooming from `currentScale` to `nextScale` around a focal point
 * `(focalX, focalY)` in container coordinates so the inspected region remains anchored under the finger.
 */
export function computeFocalZoomPan(params: FocalZoomParams): { x: number; y: number } {
  const {
    currentScale,
    nextScale,
    currentPanX,
    currentPanY,
    focalX,
    focalY,
    containerWidth,
    containerHeight,
    imageWidth,
    imageHeight,
  } = params;

  if (nextScale <= 1.001 || currentScale <= 0) {
    return { x: 0, y: 0 };
  }

  // Offset from container center to focal point
  const dx = focalX - containerWidth / 2;
  const dy = focalY - containerHeight / 2;
  const ratio = nextScale / currentScale;

  // Preserve the image point under (dx, dy) across scale change
  const rawPanX = dx - (dx - currentPanX) * ratio;
  const rawPanY = dy - (dy - currentPanY) * ratio;

  return clampPanOffset(
    rawPanX,
    rawPanY,
    nextScale,
    containerWidth,
    containerHeight,
    imageWidth,
    imageHeight
  );
}
