export type ScannerPipelineStage =
  | 'DOCUMENT_SELECTED'
  | 'DOCUMENT_VALIDATED'
  | 'FILE_ACCESS_CHECK'
  | 'FILE_COPIED_TO_CACHE'
  | 'FILE_READ_COMPLETED'
  | 'PDF_TEXT_EXTRACTION'
  | 'PDF_PAGE_RENDERING'
  | 'OCR_PROCESSING'
  | 'AI_EXTRACTION'
  | 'RESULT_VALIDATION';

export type FileAccessErrorCategory =
  | 'MISSING_URI'
  | 'INVALID_DOCUMENT'
  | 'PERMISSION_DENIED'
  | 'UNSCOPED_CACHE_URI'
  | 'FILE_NOT_FOUND'
  | 'FILE_EMPTY'
  | 'FILE_UNREADABLE'
  | 'COPY_FAILED'
  | 'PASSWORD_PROTECTED_PDF'
  | 'CORRUPTED_PDF'
  | 'PDF_TOO_LARGE'
  | 'UNKNOWN';

export interface PipelineDiagnosticEntry {
  stage: ScannerPipelineStage;
  status: 'ok' | 'fail' | 'fallback';
  durationMs?: number;
  errorCategory?: FileAccessErrorCategory;
  details: string;
  timestamp: string;
}

/**
 * Emit sanitized structured diagnostics for every stage of PDF file access and extraction.
 * Never logs secrets, tokens, auth headers, or raw receipt contents.
 */
export function logScannerStage(
  stage: ScannerPipelineStage,
  status: 'ok' | 'fail' | 'fallback',
  options?: {
    durationMs?: number;
    errorCategory?: FileAccessErrorCategory;
    scheme?: string;
    fileExt?: string;
    sizeBytes?: number;
    method?: string;
    note?: string;
  }
): PipelineDiagnosticEntry {
  const parts: string[] = [`stage=${stage}`, `status=${status}`];
  if (options?.method) parts.push(`method=${options.method}`);
  if (options?.scheme) parts.push(`scheme=${options.scheme}`);
  if (options?.fileExt) parts.push(`ext=${options.fileExt}`);
  if (typeof options?.sizeBytes === 'number') parts.push(`sizeBytes=${options.sizeBytes}`);
  if (typeof options?.durationMs === 'number') parts.push(`durationMs=${options.durationMs}`);
  if (options?.errorCategory) parts.push(`errorCategory=${options.errorCategory}`);
  if (options?.note) parts.push(`note=${sanitizeDiagnosticNote(options.note)}`);

  const line = `[ScannerDiagnostics] ${parts.join(' ')}`;
  if (status === 'fail') {
    console.warn(line);
  } else {
    console.log(line);
  }

  return {
    stage,
    status,
    durationMs: options?.durationMs,
    errorCategory: options?.errorCategory,
    details: line,
    timestamp: new Date().toISOString(),
  };
}

function sanitizeDiagnosticNote(note: string): string {
  return note
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/key=[A-Za-z0-9\-_]+/gi, 'key=[REDACTED]')
    .slice(0, 180);
}

/**
 * Classify a native/JS file access error cleanly without losing the underlying cause.
 */
export function classifyFileAccessError(err: unknown): FileAccessErrorCategory {
  const msg = String((err as any)?.message || err || '').toLowerCase();
  if (msg.includes("isn't readable") || msg.includes('not readable') || msg.includes('permission')) {
    if (msg.includes('/documentpicker/')) return 'UNSCOPED_CACHE_URI';
    return 'PERMISSION_DENIED';
  }
  if (msg.includes('enoent') || msg.includes('not found') || msg.includes('does not exist')) {
    return 'FILE_NOT_FOUND';
  }
  if (msg.includes('empty') || msg.includes('0 byte')) {
    return 'FILE_EMPTY';
  }
  if (msg.includes('password') || msg.includes('encrypt')) {
    return 'PASSWORD_PROTECTED_PDF';
  }
  if (msg.includes('copy')) {
    return 'COPY_FAILED';
  }
  return 'FILE_UNREADABLE';
}

/**
 * Determine if a file:// URI resides strictly inside one of the app's own scoped sandboxed root directories
 * (e.g. ExperienceData/.../cache/ or /files/ in Expo Go, or app sandbox cacheDir/filesDir in standalone builds).
 * Crucially detects unscoped host Expo Go paths such as:
 * file:///data/user/0/host.exp.exponent/cache/DocumentPicker/<uuid>.pdf
 */
export function isUriInsideScopedDirectories(
  uri: string | null | undefined,
  scopedRoots: Array<string | null | undefined>
): boolean {
  if (!uri || typeof uri !== 'string') return false;
  const normalizedTarget = normalizeComparableFileUri(uri);
  if (!normalizedTarget.startsWith('file://')) return false;

  // Explicit guard: DocumentPicker's unscoped host cache dir is NEVER considered safe scoped storage
  if (normalizedTarget.toLowerCase().includes('/cache/documentpicker/')) {
    return false;
  }

  for (const root of scopedRoots) {
    if (!root) continue;
    const normalizedRoot = normalizeComparableFileUri(root);
    if (!normalizedRoot.startsWith('file://')) continue;
    const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
    if (normalizedTarget.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export function normalizeComparableFileUri(uri: string): string {
  const trimmed = uri.trim();
  if (trimmed.startsWith('/')) {
    return `file://${trimmed}`;
  }
  if (trimmed.startsWith('file:/') && !trimmed.startsWith('file:///')) {
    return trimmed.replace(/^file:\/+/, 'file:///');
  }
  return trimmed;
}

export function getUriSchemeForLog(uri?: string | null): string {
  if (!uri) return 'none';
  const idx = uri.indexOf(':');
  return idx > 0 ? uri.slice(0, idx).toLowerCase() : 'path';
}
