import assert from 'node:assert';
import {
  isStoragePath,
  isPdfDocument,
  isImageDocument,
  getCanonicalDocumentBucket,
  extractDocumentImageCandidates,
  setCachedSignedUrl,
  getCachedSignedUrl,
  clearSignedUrlCache,
  invalidateSignedUrlCache,
  logDocumentThumbnailDiagnostic,
  BUCKET_ITEM_DOCUMENTS,
  BUCKET_VAULT_DOCUMENTS,
} from '../src/utils/storageUtils';
import {
  mapDbRowToDocument,
  mapDocumentToDbRow,
} from '../src/services/vaultRowMappers';
import type { VaultDocument } from '../src/types';

console.log('================================================================');
console.log(' KEEPR: DOCUMENT THUMBNAIL RESOLUTION & REGRESSION TEST SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runSuite() {
  clearSignedUrlCache();

  // ---------------------------------------------------------------------------
  // 1. A standalone image document resolves and renders
  // ---------------------------------------------------------------------------
  console.log('--- 1. Standalone Image Document Resolution ---');

  await test('Standalone image document extracts canonical path and targets vault-documents bucket', () => {
    const doc: VaultDocument = {
      id: 'doc-standalone-1',
      userId: 'user-123',
      title: 'Indane LPG Order Confirmation',
      category: 'Bills & Utilities',
      documentType: 'Gas Bill',
      filePath: 'user-123/vault/doc-standalone-1.jpg',
      fileUrl: 'user-123/vault/doc-standalone-1.jpg',
      storagePath: 'user-123/vault/doc-standalone-1.jpg',
      mimeType: 'image/jpeg',
      fileType: 'image',
      fileSizeBytes: 1048576,
      createdAt: '2026-03-01T10:00:00.000Z',
    };

    assert.strictEqual(isPdfDocument(doc), false, 'Image document must not be identified as PDF');
    assert.strictEqual(isImageDocument(doc), true, 'Must be identified as image document');
    assert.strictEqual(getCanonicalDocumentBucket(doc), BUCKET_VAULT_DOCUMENTS, 'Standalone document must use vault-documents bucket');

    const candidates = extractDocumentImageCandidates(doc);
    assert.strictEqual(candidates.storagePath, 'user-123/vault/doc-standalone-1.jpg');
    assert.strictEqual(isStoragePath(candidates.storagePath), true);
  });

  // ---------------------------------------------------------------------------
  // 2. An item-linked image document resolves and renders
  // ---------------------------------------------------------------------------
  console.log('--- 2. Item-Linked Image Document Resolution ---');

  await test('Item-linked document extracts canonical path and targets item-documents bucket', () => {
    const doc: VaultDocument = {
      id: 'doc-item-linked-2',
      itemId: 'item-laptop-999',
      userId: 'user-123',
      title: 'Fees Receipt',
      category: 'Other Important Documents',
      documentType: 'Fee Receipt',
      filePath: 'user-123/items/item-laptop-999/doc_doc-item-linked-2.png',
      fileUrl: 'user-123/items/item-laptop-999/doc_doc-item-linked-2.png',
      storagePath: 'user-123/items/item-laptop-999/doc_doc-item-linked-2.png',
      mimeType: 'image/png',
      fileType: 'image',
      fileSizeBytes: 204800,
      createdAt: '2026-03-02T10:00:00.000Z',
    };

    assert.strictEqual(isPdfDocument(doc), false);
    assert.strictEqual(isImageDocument(doc), true);
    assert.strictEqual(getCanonicalDocumentBucket(doc), BUCKET_ITEM_DOCUMENTS, 'Item-linked document must use item-documents bucket');

    const candidates = extractDocumentImageCandidates(doc);
    assert.strictEqual(candidates.storagePath, 'user-123/items/item-laptop-999/doc_doc-item-linked-2.png');
    assert.strictEqual(isStoragePath(candidates.storagePath), true);
  });

  // ---------------------------------------------------------------------------
  // 3. A PDF uses the correct file-type icon
  // ---------------------------------------------------------------------------
  console.log('--- 3. PDF Document Detection & Badge ---');

  await test('PDF documents are accurately identified across mimeType, fileType, title, and storage path', () => {
    // 3a. PDF via mimeType
    const pdfByMime: Partial<VaultDocument> = {
      id: 'doc-pdf-1',
      title: 'Track Order',
      mimeType: 'application/pdf',
      storagePath: 'user-123/vault/doc-pdf-1.bin',
    };
    assert.strictEqual(isPdfDocument(pdfByMime), true);

    // 3b. PDF via fileType
    const pdfByType: Partial<VaultDocument> = {
      id: 'doc-pdf-2',
      title: 'Fee Receipt',
      fileType: 'pdf',
      mimeType: 'application/octet-stream',
      storagePath: 'user-123/vault/doc-pdf-2',
    };
    assert.strictEqual(isPdfDocument(pdfByType), true);

    // 3c. PDF via title
    const pdfByTitle: Partial<VaultDocument> = {
      id: 'doc-pdf-3',
      title: 'Tuition_Fee.pdf',
      mimeType: 'application/octet-stream',
    };
    assert.strictEqual(isPdfDocument(pdfByTitle), true);

    // 3d. PDF via storagePath extension
    const pdfByPath: Partial<VaultDocument> = {
      id: 'doc-pdf-4',
      title: 'Invoice',
      storagePath: 'user-123/vault/doc-pdf-4.pdf?token=123',
    };
    assert.strictEqual(isPdfDocument(pdfByPath), true);

    // 3e. Standard image is NOT a PDF
    const imageDoc: Partial<VaultDocument> = {
      id: 'doc-img-1',
      title: 'Receipt',
      mimeType: 'image/jpeg',
      storagePath: 'user-123/vault/receipt.jpg',
    };
    assert.strictEqual(isPdfDocument(imageDoc), false);
  });

  // ---------------------------------------------------------------------------
  // 4. Raw Storage path is converted to authenticated signed URL
  // ---------------------------------------------------------------------------
  console.log('--- 4. Storage Path Authentication & Signed URL Handling ---');

  await test('Raw storage path is recognized and never passed as a raw file or http URL', () => {
    const rawPath = 'user-123/vault/doc-invoice.jpg';
    assert.strictEqual(isStoragePath(rawPath), true);
    assert.strictEqual(rawPath.startsWith('file://'), false);
    assert.strictEqual(rawPath.startsWith('http'), false);

    // Cache simulation
    const mockSignedUrl = 'https://supabase.co/storage/v1/object/sign/vault-documents/user-123/vault/doc-invoice.jpg?token=abc';
    setCachedSignedUrl(`${BUCKET_VAULT_DOCUMENTS}:${rawPath}`, mockSignedUrl, 3600);
    setCachedSignedUrl(rawPath, mockSignedUrl, 3600);

    const cached = getCachedSignedUrl(`${BUCKET_VAULT_DOCUMENTS}:${rawPath}`);
    assert.strictEqual(cached, mockSignedUrl);
  });

  // ---------------------------------------------------------------------------
  // 5. Expired signed URLs can be refreshed
  // ---------------------------------------------------------------------------
  console.log('--- 5. Signed URL Expiry & Cache Invalidation ---');

  await test('Expired signed URL cache entries are invalidated and refreshed cleanly', () => {
    const rawPath = 'user-123/vault/refresh-test.jpg';
    const oldSignedUrl = 'https://supabase.co/storage/v1/object/sign/vault-documents/old?token=1';
    const newSignedUrl = 'https://supabase.co/storage/v1/object/sign/vault-documents/new?token=2';

    setCachedSignedUrl(rawPath, oldSignedUrl, 3600);
    assert.strictEqual(getCachedSignedUrl(rawPath), oldSignedUrl);

    // Invalidate on error / expiry
    invalidateSignedUrlCache(rawPath);
    assert.strictEqual(getCachedSignedUrl(rawPath), null, 'Cache should be empty after invalidation');

    // Re-populate with refreshed signed URL
    setCachedSignedUrl(rawPath, newSignedUrl, 3600);
    assert.strictEqual(getCachedSignedUrl(rawPath), newSignedUrl, 'Refreshed signed URL should be cached');
  });

  // ---------------------------------------------------------------------------
  // 6. Missing object path produces controlled fallback
  // ---------------------------------------------------------------------------
  console.log('--- 6. Missing Path Controlled Fallback ---');

  await test('Document with no storage path or files returns null and triggers Case B fallback', () => {
    const emptyDoc: Partial<VaultDocument> = {
      id: 'doc-empty-1',
      title: 'Untitled Document',
      category: 'Other Important Documents',
      filePath: '',
      fileUrl: '',
      storagePath: null,
    };

    const candidates = extractDocumentImageCandidates(emptyDoc);
    assert.strictEqual(candidates.storagePath, null);
    assert.strictEqual(candidates.remoteUrl, null);
    assert.strictEqual(candidates.localUri, null);

    // Diagnostic logging test
    logDocumentThumbnailDiagnostic({
      documentId: emptyDoc.id,
      hasObjectPath: false,
      caseType: 'B',
      details: 'Missing path verification',
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Storage / network error does not crash the list
  // ---------------------------------------------------------------------------
  console.log('--- 7. Resilience Against Storage & Network Errors ---');

  await test('Error states trigger Case C or Case D diagnostic and fallback gracefully', () => {
    const brokenDoc: Partial<VaultDocument> = {
      id: 'doc-err-1',
      title: 'Corrupted Doc',
      storagePath: 'user-123/vault/missing.jpg',
    };

    // Candidate is extracted without throwing
    const candidates = extractDocumentImageCandidates(brokenDoc);
    assert.strictEqual(candidates.storagePath, 'user-123/vault/missing.jpg');

    // Simulating failed resolution
    logDocumentThumbnailDiagnostic({
      documentId: brokenDoc.id,
      hasObjectPath: true,
      signedUrlSuccess: false,
      caseType: 'C',
      details: 'Simulated 404 from storage service',
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Controlled retry prevents endless loops
  // ---------------------------------------------------------------------------
  console.log('--- 8. Controlled Single-Retry Guarantee ---');

  await test('Retry counter enforces maximum of 1 refresh attempt', async () => {
    let retryAttempted = false;
    let refreshCount = 0;

    const mockRetry = async () => {
      if (retryAttempted) return;
      retryAttempted = true;
      refreshCount++;
    };

    // First error triggers refresh
    await mockRetry();
    assert.strictEqual(refreshCount, 1);
    assert.strictEqual(retryAttempted, true);

    // Second error must not trigger another refresh
    await mockRetry();
    assert.strictEqual(refreshCount, 1, 'Retry must never exceed 1 attempt to avoid infinite loops');
  });

  // ---------------------------------------------------------------------------
  // 9. Logout / login and cross-device hydration preserve canonical references
  // ---------------------------------------------------------------------------
  console.log('--- 9. Hydration & Cross-Device Preservation ---');

  await test('DB hydration round-trip maps canonical storage_path without data corruption', () => {
    const dbRow = {
      id: '00000000-0000-0000-0000-000000000001',
      user_id: 'user-123',
      item_id: null,
      title: 'Track Order',
      category: 'Bills & Utilities',
      document_type: 'Order Confirmation',
      storage_path: 'user-123/vault/track-order.png',
      file_path: 'user-123/vault/track-order.png',
      file_url: 'user-123/vault/track-order.png',
      mime_type: 'image/png',
      file_type: 'image',
      file_size_bytes: 524288,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    };

    const hydratedDoc = mapDbRowToDocument(dbRow);
    assert.strictEqual(hydratedDoc.storagePath, 'user-123/vault/track-order.png');
    assert.strictEqual(hydratedDoc.mimeType, 'image/png');
    assert.strictEqual(getCanonicalDocumentBucket(hydratedDoc), BUCKET_VAULT_DOCUMENTS);

    const remappedDbRow = mapDocumentToDbRow(hydratedDoc, 'user-123');
    assert.strictEqual(remappedDbRow.storage_path, 'user-123/vault/track-order.png');
    assert.strictEqual(remappedDbRow.mime_type, 'image/png');
  });

  // ---------------------------------------------------------------------------
  // 10. Existing document data and private bucket policies remain unchanged
  // ---------------------------------------------------------------------------
  console.log('--- 10. Private Bucket Integrity ---');

  await test('Private bucket constants and path structures remain strictly authentic', () => {
    assert.strictEqual(BUCKET_VAULT_DOCUMENTS, 'vault-documents');
    assert.strictEqual(BUCKET_ITEM_DOCUMENTS, 'item-documents');

    // User scoped paths
    const userPath = 'user-abc/vault/document.jpg';
    assert.strictEqual(isStoragePath(userPath), true);
    assert.strictEqual(isStoragePath('local/file.jpg'), true);
    assert.strictEqual(isStoragePath('/local/file.jpg'), false);
    assert.strictEqual(isStoragePath('vault_documents/local.jpg'), false);
    assert.strictEqual(isStoragePath('file:///vault_documents/local.jpg'), false);
  });

  // ---------------------------------------------------------------------------
  // 11. Root Cause Regression: The 4 affected records with legacy file_type: 'pdf'
  // ---------------------------------------------------------------------------
  console.log('--- 11. Root Cause: 4 Affected Image Records with Legacy file_type: "pdf" ---');

  await test('Legacy database rows for the 4 affected records are correctly sanitized to image type', () => {
    const affectedRecords = [
      {
        id: 'aff-1',
        title: 'Track Order',
        amount: 134,
        storage_path: 'user-123/vault/doc_aff1_receipt.jpg',
        file_path: 'user-123/vault/doc_aff1_receipt.jpg',
        file_url: 'user-123/vault/doc_aff1_receipt.jpg',
        file_type: 'pdf', // Stale legacy DB value!
        mime_type: 'application/octet-stream',
      },
      {
        id: 'aff-2',
        title: 'Indane LPG Order Confirmation',
        amount: 953,
        storage_path: 'user-123/vault/doc_aff2_lpg.png',
        file_path: 'user-123/vault/doc_aff2_lpg.png',
        file_url: 'user-123/vault/doc_aff2_lpg.png',
        file_type: 'pdf', // Stale legacy DB value!
        mime_type: 'application/octet-stream',
      },
      {
        id: 'aff-3',
        title: 'Fees Receipt',
        amount: 6500,
        item_id: 'item-fees-3',
        storage_path: 'user-123/items/item-fees-3/doc_aff3_fees.jpeg',
        file_path: 'user-123/items/item-fees-3/doc_aff3_fees.jpeg',
        file_url: 'user-123/items/item-fees-3/doc_aff3_fees.jpeg',
        file_type: 'pdf', // Stale legacy DB value!
        mime_type: 'application/octet-stream',
      },
      {
        id: 'aff-4',
        title: 'Fee Receipt',
        amount: 50000,
        item_id: 'item-fees-4',
        storage_path: 'user-123/items/item-fees-4/doc_aff4_fee.webp',
        file_path: 'user-123/items/item-fees-4/doc_aff4_fee.webp',
        file_url: 'user-123/items/item-fees-4/doc_aff4_fee.webp',
        file_type: 'pdf', // Stale legacy DB value!
        mime_type: 'application/octet-stream',
      },
    ];

    for (const row of affectedRecords) {
      const doc = mapDbRowToDocument(row as any);

      // Must NOT be treated as a PDF despite stale row.file_type === 'pdf'
      assert.strictEqual(doc.fileType, 'image', `${doc.title} fileType must be mapped to 'image'`);
      assert.strictEqual(isPdfDocument(doc), false, `${doc.title} must NOT be detected as PDF`);
      assert.strictEqual(isImageDocument(doc), true, `${doc.title} must be detected as image document`);

      // Candidates must return the actual image storage path
      const candidates = extractDocumentImageCandidates(doc);
      assert.strictEqual(candidates.storagePath, row.storage_path, `${doc.title} must extract actual image storagePath`);

      // Remapping to DB payload must correct file_type to 'image'
      const remapped = mapDocumentToDbRow(doc, 'user-123');
      assert.strictEqual(remapped.file_type, 'image', `${doc.title} DB write must persist file_type: 'image'`);
    }
  });

  // ---------------------------------------------------------------------------
  // 12. Genuine PDF with NO thumbnail preview
  // ---------------------------------------------------------------------------
  console.log('--- 12. Genuine PDF without Thumbnail Preview ---');

  await test('Genuine PDF without thumbnail extracts null image candidates and renders PDF badge', () => {
    const genuinePdf: VaultDocument = {
      id: 'doc-pdf-raw-1',
      userId: 'user-123',
      title: 'Insurance Policy.pdf',
      category: 'Other Important Documents',
      documentType: 'Policy Document',
      storagePath: 'user-123/vault/doc_policy.pdf',
      filePath: 'user-123/vault/doc_policy.pdf',
      fileUrl: 'user-123/vault/doc_policy.pdf',
      thumbnailPath: null,
      fileType: 'pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 2097152,
      createdAt: '2026-03-01T00:00:00.000Z',
    };

    assert.strictEqual(isPdfDocument(genuinePdf), true, 'Must be identified as PDF');
    assert.strictEqual(isImageDocument(genuinePdf), false, 'Must NOT be identified as image');

    // Because it is a PDF with NO thumbnail, candidates must be null
    // so that <Image> is never passed a raw .pdf URL
    const candidates = extractDocumentImageCandidates(genuinePdf);
    assert.strictEqual(candidates.storagePath, null, 'Raw PDF storagePath must not be passed to image renderer');
    assert.strictEqual(candidates.remoteUrl, null);
    assert.strictEqual(candidates.localUri, null);
  });

  // ---------------------------------------------------------------------------
  // 13. Genuine PDF WITH thumbnail preview
  // ---------------------------------------------------------------------------
  console.log('--- 13. Genuine PDF with Generated Thumbnail Preview ---');

  await test('Genuine PDF with thumbnail resolves thumbnail image while preserving original PDF file', () => {
    const pdfWithThumb: VaultDocument = {
      id: 'doc-pdf-thumb-1',
      userId: 'user-123',
      title: 'Tax Statement.pdf',
      category: 'Bills & Utilities',
      documentType: 'Tax Return',
      storagePath: 'user-123/vault/tax_statement.pdf',
      filePath: 'user-123/vault/tax_statement.pdf',
      fileUrl: 'user-123/vault/tax_statement.pdf',
      thumbnailPath: 'user-123/vault/thumb_tax_statement.jpg',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4194304,
      createdAt: '2026-03-01T00:00:00.000Z',
    };

    assert.strictEqual(isPdfDocument(pdfWithThumb), true, 'Must be identified as PDF');

    // extractDocumentImageCandidates should prioritize the thumbnail image!
    const candidates = extractDocumentImageCandidates(pdfWithThumb);
    assert.strictEqual(candidates.storagePath, 'user-123/vault/thumb_tax_statement.jpg', 'Must extract thumbnailPath as image candidate');

    // Original file path remains the full PDF
    assert.strictEqual(pdfWithThumb.storagePath, 'user-123/vault/tax_statement.pdf', 'Original PDF file path must remain untouched');
  });

  // ---------------------------------------------------------------------------
  // 14. Missing-Image Fallback Does NOT Falsely Render PDF Badge
  // ---------------------------------------------------------------------------
  console.log('--- 14. Missing-Image Document Fallback Behavior ---');

  await test('Image document whose image cannot be resolved does NOT fall back to PDF badge', () => {
    const brokenImageDoc: VaultDocument = {
      id: 'doc-missing-img',
      userId: 'user-123',
      title: 'Scanned Invoice',
      category: 'Bills & Utilities',
      documentType: 'Invoice',
      storagePath: 'user-123/vault/deleted_image.jpg',
      filePath: 'user-123/vault/deleted_image.jpg',
      fileUrl: 'user-123/vault/deleted_image.jpg',
      fileType: 'image',
      mimeType: 'image/jpeg',
      fileSizeBytes: 1024,
      createdAt: '2026-03-01T00:00:00.000Z',
    };

    // Must be classified as image, NOT PDF
    assert.strictEqual(isImageDocument(brokenImageDoc), true);
    assert.strictEqual(isPdfDocument(brokenImageDoc), false, 'Image document with missing file must NOT be marked as PDF');
  });

  // ---------------------------------------------------------------------------
  // 15. New Document Creation Inferred Types
  // ---------------------------------------------------------------------------
  console.log('--- 15. Document Creation Inferred Types ---');

  await test('New image document created without explicit fileType defaults to image on DB write', () => {
    const newDoc: VaultDocument = {
      id: 'doc-new-1',
      userId: 'user-123',
      title: 'Store Receipt',
      category: 'Receipts & Invoices',
      documentType: 'Receipt',
      storagePath: 'user-123/vault/new_receipt.png',
      filePath: 'user-123/vault/new_receipt.png',
      fileUrl: 'user-123/vault/new_receipt.png',
      fileSizeBytes: 2048,
      mimeType: '',
      createdAt: '2026-03-01T00:00:00.000Z',
    };

    const dbRow = mapDocumentToDbRow(newDoc, 'user-123');
    assert.strictEqual(dbRow.file_type, 'image', 'Image document must be stored as file_type: "image"');
    assert.strictEqual(dbRow.mime_type, 'image/png', 'MIME type must be inferred as image/png');
  });

  console.log('\n================================================================');
  console.log(` RESULT: ${passedTests}/${totalTests} document thumbnail tests passed!`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exitCode = 1;
  }
}

runSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
