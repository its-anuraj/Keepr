/**
 * Checks whether a given string is a Supabase Storage path.
 * True for paths like: `${userId}/items/${itemId}/photo_0.jpg` or `user-id/items/item-id/photo.jpg`
 * False for: `file://...`, `content://...`, `http://...`, `data:...`, `/data/...`, `vault_receipts/...`
 */
export function isStoragePath(path?: string | null): boolean {
  if (!path || typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (!trimmed) return false;

  if (
    trimmed.startsWith('file:') ||
    trimmed.startsWith('content:') ||
    trimmed.startsWith('http:') ||
    trimmed.startsWith('https:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('vault_receipts/') ||
    trimmed.startsWith('vault_documents/')
  ) {
    return false;
  }

  // Must contain at least one '/' separating owner segment and file hierarchy
  return trimmed.includes('/');
}
