/**
 * KEEPR DIGITAL OWNERSHIP VAULT: Binary Image Integrity & MIME Detection
 * Inspects magic bytes from file binary data to identify exact MIME types and file extensions.
 * Prevents forced .jpg re-encoding and preserves PNG transparency, WebP, and original fidelity.
 */

export interface DetectedImageFormat {
  mimeType: string;
  extension: string;
  format: 'jpeg' | 'png' | 'webp' | 'heic' | 'pdf' | 'unknown';
}

/**
 * Inspects a binary byte array (Uint8Array) to determine the exact image format.
 */
export function detectFormatFromBytes(bytes: Uint8Array): DetectedImageFormat {
  if (!bytes || bytes.length < 4) {
    return { mimeType: 'application/octet-stream', extension: '.bin', format: 'unknown' };
  }

  // 1. JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: '.jpg', format: 'jpeg' };
  }

  // 2. PNG: 89 50 4E 47 (\x89PNG)
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { mimeType: 'image/png', extension: '.png', format: 'png' };
  }

  // 3. PDF: 25 50 44 46 (%PDF)
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return { mimeType: 'application/pdf', extension: '.pdf', format: 'pdf' };
  }

  // 4. WebP: RIFF ... WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return { mimeType: 'image/webp', extension: '.webp', format: 'webp' };
  }

  // 5. HEIC / HEIF: ....ftyp (offset 4 is 0x66 0x74 0x79 0x70)
  if (bytes.length >= 12) {
    const isFtyp =
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70;

    if (isFtyp) {
      const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
      if (
        brand.includes('heic') ||
        brand.includes('heix') ||
        brand.includes('mif1') ||
        brand.includes('msf1')
      ) {
        return { mimeType: 'image/heic', extension: '.heic', format: 'heic' };
      }
    }
  }

  // Default fallback
  return { mimeType: 'image/jpeg', extension: '.jpg', format: 'jpeg' };
}

/**
 * Detects format from data URI or filename when bytes are not immediately accessible.
 */
export function detectFormatFromUriOrName(uriOrName?: string | null): DetectedImageFormat {
  if (!uriOrName) {
    return { mimeType: 'image/jpeg', extension: '.jpg', format: 'jpeg' };
  }

  const clean = uriOrName.trim().toLowerCase().split('?')[0];

  if (clean.startsWith('data:')) {
    if (clean.startsWith('data:image/png')) {
      return { mimeType: 'image/png', extension: '.png', format: 'png' };
    }
    if (clean.startsWith('data:image/webp')) {
      return { mimeType: 'image/webp', extension: '.webp', format: 'webp' };
    }
    if (clean.startsWith('data:application/pdf')) {
      return { mimeType: 'application/pdf', extension: '.pdf', format: 'pdf' };
    }
    if (clean.startsWith('data:image/heic')) {
      return { mimeType: 'image/heic', extension: '.heic', format: 'heic' };
    }
    return { mimeType: 'image/jpeg', extension: '.jpg', format: 'jpeg' };
  }

  if (clean.endsWith('.png')) {
    return { mimeType: 'image/png', extension: '.png', format: 'png' };
  }
  if (clean.endsWith('.webp')) {
    return { mimeType: 'image/webp', extension: '.webp', format: 'webp' };
  }
  if (clean.endsWith('.pdf')) {
    return { mimeType: 'application/pdf', extension: '.pdf', format: 'pdf' };
  }
  if (clean.endsWith('.heic')) {
    return { mimeType: 'image/heic', extension: '.heic', format: 'heic' };
  }

  return { mimeType: 'image/jpeg', extension: '.jpg', format: 'jpeg' };
}
