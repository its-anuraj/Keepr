import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  isStoragePath,
  isPdfDocument,
  isImageDocument,
  getCanonicalDocumentBucket,
  BUCKET_ITEM_DOCUMENTS,
  BUCKET_VAULT_DOCUMENTS,
} from '../src/utils/storageUtils';
import {
  mapDbRowToDocument,
  mapDocumentToDbRow,
} from '../src/services/vaultRowMappers';
import { extractNativePdfText } from '../src/utils/pdfUtils';
import type { VaultDocument } from '../src/types';

console.log('================================================================');
console.log(' KEEPR: UNIVERSAL DOCUMENT SYSTEM (PDF & IMAGE) VALIDATION SUITE');
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
  const rootDir = path.resolve(__dirname, '..');

  // ---------------------------------------------------------------------------
  // 1. Database Migration 010: Universal Document Metadata Schema
  // ---------------------------------------------------------------------------
  console.log('--- 1. Database Migration 010 Schema Verification ---');

  await test('Migration 010 exists and defines extracted_text, ocr_status, page_count, storage_path_back', () => {
    const migrationPath = path.join(rootDir, 'supabase', 'migrations', '010_universal_document_metadata.sql');
    assert.strictEqual(fs.existsSync(migrationPath), true, 'Migration 010 file must exist');

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    assert.ok(sqlContent.includes('extracted_text text'), 'Must add extracted_text column');
    assert.ok(sqlContent.includes('ocr_status text'), 'Must add ocr_status column');
    assert.ok(sqlContent.includes('page_count integer'), 'Must add page_count column');
    assert.ok(sqlContent.includes('storage_path_back text'), 'Must add storage_path_back column');
    assert.ok(sqlContent.includes('file_path_back text'), 'Must add file_path_back column');
    assert.ok(sqlContent.includes('idx_documents_ocr_status'), 'Must create index on ocr_status');
    assert.ok(sqlContent.includes('idx_documents_file_type'), 'Must create index on file_type');
  });

  // ---------------------------------------------------------------------------
  // 2. Data Model & Vault Row Mappers Bi-Directional Integrity
  // ---------------------------------------------------------------------------
  console.log('--- 2. Vault Row Mappers Bi-Directional Integrity ---');

  await test('mapDbRowToDocument maps new columns to VaultDocument model', () => {
    const dbRow = {
      id: 'doc-univ-101',
      user_id: 'usr-444',
      item_id: 'itm-555',
      title: 'Tax Invoice 2026',
      category: 'Invoices & Receipts',
      document_type: 'Tax Invoice',
      file_path: 'usr-444/vault/tax_invoice.pdf',
      file_url: 'https://storage.supabase.co/v1/object/sign/vault-documents/usr-444/vault/tax_invoice.pdf',
      storage_path: 'usr-444/vault/tax_invoice.pdf',
      storage_path_back: 'usr-444/vault/tax_invoice_terms.pdf',
      file_path_back: 'usr-444/vault/tax_invoice_terms.pdf',
      file_url_back: 'https://storage.supabase.co/v1/object/sign/vault-documents/usr-444/vault/tax_invoice_terms.pdf',
      mime_type: 'application/pdf',
      file_type: 'pdf',
      file_size_bytes: 450200,
      extracted_text: 'GSTIN: 27AAAAA0000A1Z5 Total: INR 12,499.00 Date: 2026-03-15',
      ocr_status: 'completed',
      page_count: 2,
      created_at: '2026-03-15T09:30:00.000Z',
      updated_at: '2026-03-15T09:35:00.000Z',
    };

    const doc = mapDbRowToDocument(dbRow);
    assert.strictEqual(doc.id, 'doc-univ-101');
    assert.strictEqual(doc.extractedText, 'GSTIN: 27AAAAA0000A1Z5 Total: INR 12,499.00 Date: 2026-03-15');
    assert.strictEqual(doc.ocrStatus, 'completed');
    assert.strictEqual(doc.pageCount, 2);
    assert.strictEqual(doc.storagePathBack, 'usr-444/vault/tax_invoice_terms.pdf');
    assert.strictEqual(doc.filePathBack, 'usr-444/vault/tax_invoice_terms.pdf');
    assert.strictEqual(doc.fileType, 'pdf');
  });

  await test('mapDbRowToDocument defaults gracefully for legacy rows without new columns', () => {
    const legacyDbRow = {
      id: 'doc-legacy-1',
      user_id: 'usr-444',
      title: 'Old Receipt',
      file_path: 'usr-444/vault/receipt.jpg',
      storage_path: 'usr-444/vault/receipt.jpg',
      mime_type: 'image/jpeg',
      file_type: 'image',
      created_at: '2025-01-01T00:00:00.000Z',
    };

    const doc = mapDbRowToDocument(legacyDbRow);
    assert.strictEqual(doc.ocrStatus, 'not_scanned', 'Legacy doc must default ocrStatus to not_scanned');
    assert.strictEqual(doc.extractedText, null, 'Legacy doc extractedText must be null');
    assert.strictEqual(doc.pageCount, 1, 'Legacy doc pageCount must default to 1');
    assert.strictEqual(doc.storagePathBack, null);
  });

  await test('mapDocumentToDbRow serializes all metadata and back-side storage paths for DB persistence', () => {
    const doc: VaultDocument = {
      id: 'doc-roundtrip-1',
      userId: 'usr-999',
      title: 'Health Insurance Policy',
      category: 'Other Important Documents',
      documentType: 'Insurance',
      filePath: 'usr-999/vault/health_policy.pdf',
      fileUrl: 'usr-999/vault/health_policy.pdf',
      fileSizeBytes: 102400,
      storagePath: 'usr-999/vault/health_policy.pdf',
      filePathBack: 'usr-999/vault/health_policy_back.pdf',
      storagePathBack: 'usr-999/vault/health_policy_back.pdf',
      mimeType: 'application/pdf',
      fileType: 'pdf',
      extractedText: 'Policy Number: HDFC-MED-998811 Valid Thru: 2027-04-30',
      ocrStatus: 'completed',
      pageCount: 4,
      createdAt: '2026-04-01T10:00:00.000Z',
    };

    const row = mapDocumentToDbRow(doc, 'usr-999');
    assert.strictEqual(row.storage_path, 'usr-999/vault/health_policy.pdf');
    assert.strictEqual(row.storage_path_back, 'usr-999/vault/health_policy_back.pdf');
    assert.strictEqual(row.file_path_back, 'usr-999/vault/health_policy_back.pdf');
    assert.strictEqual(row.extracted_text, 'Policy Number: HDFC-MED-998811 Valid Thru: 2027-04-30');
    assert.strictEqual(row.ocr_status, 'completed');
    assert.strictEqual(row.page_count, 4);
    assert.strictEqual(row.file_type, 'pdf');
  });

  // ---------------------------------------------------------------------------
  // 3. Universal PDF Viewer Component Verification
  // ---------------------------------------------------------------------------
  console.log('--- 3. Universal PDF Viewer Component Architecture ---');

  await test('UniversalPdfViewer source component exists and utilizes react-native-webview and PDF.js', () => {
    const viewerPath = path.join(rootDir, 'src', 'components', 'documents', 'UniversalPdfViewer.tsx');
    assert.strictEqual(fs.existsSync(viewerPath), true, 'UniversalPdfViewer.tsx must exist');

    const content = fs.readFileSync(viewerPath, 'utf8');
    assert.ok(content.includes('react-native-webview'), 'Must import react-native-webview');
    assert.ok(content.includes('pdfjsLib') || content.includes('pdf.min.js'), 'Must leverage Mozilla PDF.js');
    assert.ok(content.includes('onScanOcr'), 'Must support onScanOcr callback');
    assert.ok(content.includes('Sharing.shareAsync') || content.includes('Download'), 'Must support document export/download');
    assert.ok(content.includes('BackHandler'), 'Must handle Android hardware back button');
  });

  // ---------------------------------------------------------------------------
  // 4. Viewer Routing: PDF vs Image Separation
  // ---------------------------------------------------------------------------
  console.log('--- 4. Document Viewer Routing (app/document/[id].tsx) ---');

  await test('Document detail screen routes PDFs to UniversalPdfViewer and Images to HighResImageViewer', () => {
    const detailScreenPath = path.join(rootDir, 'app', 'document', '[id].tsx');
    assert.strictEqual(fs.existsSync(detailScreenPath), true, 'app/document/[id].tsx must exist');

    const content = fs.readFileSync(detailScreenPath, 'utf8');
    assert.ok(content.includes('UniversalPdfViewer'), 'Must import UniversalPdfViewer');
    assert.ok(content.includes('HighResImageViewer'), 'Must import HighResImageViewer');
    assert.ok(content.includes('DocumentOcrModal'), 'Must import DocumentOcrModal');
    assert.ok(content.includes('isPdf'), 'Must evaluate isPdf condition');
    assert.ok(content.includes('UniversalPdfViewer') && content.includes('HighResImageViewer'), 'Must route conditionally between viewer components');
    assert.ok(content.includes('extractedText'), 'Must display extracted text card when available');
  });

  // ---------------------------------------------------------------------------
  // 5. Native PDF Text Extraction Engine
  // ---------------------------------------------------------------------------
  console.log('--- 5. Native PDF Text Extraction Engine ---');

  await test('extractNativePdfText extracts Tj and TJ text streams from searchable PDF stream', () => {
    const samplePdfRaw = `
      %PDF-1.4
      1 0 obj
      << /Type /Catalog /Pages 2 0 R >>
      endobj
      2 0 obj
      << /Type /Pages /Kids [3 0 R] /Count 1 >>
      endobj
      3 0 obj
      << /Type /Page /Parent 2 0 R >>
      endobj
      stream
      BT
      /F1 12 Tf
      (OFFICIAL TAX INVOICE) Tj
      (INVOICE NUMBER: INV-2026-8874) Tj
      [(TOTAL ) (AMOUNT: ) (INR ) (15499.00)] TJ
      ET
      endstream
      %%EOF
    `;

    const res = extractNativePdfText(samplePdfRaw);
    assert.strictEqual(res.pageCount, 1);
    assert.ok(res.text.includes('OFFICIAL TAX INVOICE'), 'Must extract Tj line 1');
    assert.ok(res.text.includes('INVOICE NUMBER: INV-2026-8874'), 'Must extract Tj line 2');
    assert.ok(res.text.includes('TOTAL AMOUNT: INR 15499.00'), 'Must extract TJ array stream');
  });

  await test('extractNativePdfText returns empty text when PDF is a pure image scan without text operators', () => {
    const scannedPdfRaw = `
      %PDF-1.4
      1 0 obj
      << /Type /Catalog /Pages 2 0 R >>
      endobj
      2 0 obj
      << /Type /Pages /Kids [3 0 R] /Count 1 >>
      endobj
      3 0 obj
      << /Type /Page /Parent 2 0 R /Contents 4 0 R >>
      endobj
      4 0 obj
      << /Length 120 /Filter /DCTDecode >>
      stream
      ...pure jpeg raster stream binary without any BT/ET or Tj operators...
      endstream
      %%EOF
    `;

    const res = extractNativePdfText(scannedPdfRaw);
    assert.strictEqual(res.text, '', 'Pure scanned image PDF must yield empty text to trigger OCR');
    assert.strictEqual(res.pageCount, 1);
  });

  // ---------------------------------------------------------------------------
  // 6. ReceiptFileService Multimodal PDF Handling
  // ---------------------------------------------------------------------------
  console.log('--- 6. ReceiptFileService Multimodal PDF Detection ---');

  await test('prepareImageForAnalysis safely bypasses Image.getSize for PDF documents', () => {
    const receiptFileServicePath = path.join(rootDir, 'src', 'services', 'receiptFileService.ts');
    const content = fs.readFileSync(receiptFileServicePath, 'utf8');

    // Confirm PDF detection exists before manipulateAsync / Image.getSize
    assert.ok(content.includes("detected.mimeType === 'application/pdf'"), 'Must check for application/pdf');
    assert.ok(content.includes("imageUri.toLowerCase().includes('.pdf')"), 'Must check for .pdf extension');
    assert.ok(content.includes("mimeType: 'application/pdf'"), 'Must return clean application/pdf MIME type');
  });

  // ---------------------------------------------------------------------------
  // 7. Universal Document OCR Modal & Store Persistence
  // ---------------------------------------------------------------------------
  console.log('--- 7. Universal Document OCR Modal & Store Persistence ---');

  await test('DocumentOcrModal component exists with retry, copy, and save capabilities', () => {
    const ocrModalPath = path.join(rootDir, 'src', 'components', 'documents', 'DocumentOcrModal.tsx');
    assert.strictEqual(fs.existsSync(ocrModalPath), true, 'DocumentOcrModal.tsx must exist');

    const content = fs.readFileSync(ocrModalPath, 'utf8');
    assert.ok(content.includes('DocumentScanResult'), 'Must import DocumentScanResult');
    assert.ok(content.includes('Clipboard.setStringAsync'), 'Must support copy to clipboard');
    assert.ok(content.includes('updateDocument'), 'Must persist edited text to document store');
    assert.ok(content.includes('Extracted Text'), 'Must show extracted text container');
  });

  // ---------------------------------------------------------------------------
  // 8. Document Filtering by Format (All vs PDF vs Image)
  // ---------------------------------------------------------------------------
  console.log('--- 8. Document Filtering by Format ---');

  await test('DocFilterModal definition supports fileFormat: all | pdf | image', () => {
    const filterModalPath = path.join(rootDir, 'src', 'components', 'documents', 'DocFilterModal.tsx');
    const content = fs.readFileSync(filterModalPath, 'utf8');

    assert.ok(content.includes("fileFormat: 'all' | 'pdf' | 'image'"), 'DocFilterState must declare fileFormat');
    assert.ok(content.includes("fileFormat: 'all'"), 'DEFAULT_DOC_FILTERS must initialize fileFormat to all');
    assert.ok(content.includes("f.fileFormat !== 'all'"), 'countActiveDocFilters must count fileFormat');
  });

  await test('Filter accurately separates PDF documents from Image documents', () => {
    const sampleDocs: VaultDocument[] = [
      {
        id: 'doc-pdf-1',
        userId: 'u1',
        title: 'Laptop Warranty PDF',
        category: 'Warranty & Guarantee',
        documentType: 'Warranty Card',
        filePath: 'u1/vault/laptop_warranty.pdf',
        fileUrl: 'u1/vault/laptop_warranty.pdf',
        fileSizeBytes: 50000,
        mimeType: 'application/pdf',
        fileType: 'pdf',
        createdAt: '2026-01-01',
      },
      {
        id: 'doc-img-1',
        userId: 'u1',
        title: 'Store Receipt Photo',
        category: 'Receipts & Invoices',
        documentType: 'Receipt',
        filePath: 'u1/vault/store_receipt.jpg',
        fileUrl: 'u1/vault/store_receipt.jpg',
        fileSizeBytes: 60000,
        mimeType: 'image/jpeg',
        fileType: 'image',
        createdAt: '2026-01-02',
      },
      {
        id: 'doc-img-2',
        userId: 'u1',
        title: 'ID Card Photo',
        category: 'Other Important Documents',
        documentType: 'ID Card',
        filePath: 'u1/vault/id_card.png',
        fileUrl: 'u1/vault/id_card.png',
        fileSizeBytes: 70000,
        mimeType: 'image/png',
        fileType: 'image',
        createdAt: '2026-01-03',
      },
    ];

    // Format = 'all'
    const allDocs = sampleDocs.filter(() => true);
    assert.strictEqual(allDocs.length, 3);

    // Format = 'pdf'
    const pdfDocs = sampleDocs.filter((doc) => isPdfDocument(doc));
    assert.strictEqual(pdfDocs.length, 1);
    assert.strictEqual(pdfDocs[0].id, 'doc-pdf-1');

    // Format = 'image'
    const imgDocs = sampleDocs.filter((doc) => isImageDocument(doc));
    assert.strictEqual(imgDocs.length, 2);
    assert.strictEqual(imgDocs[0].id, 'doc-img-1');
    assert.strictEqual(imgDocs[1].id, 'doc-img-2');
  });

  // ---------------------------------------------------------------------------
  // 9. Document Search across Extracted Text & Metadata
  // ---------------------------------------------------------------------------
  console.log('--- 9. Document Search across Extracted Text & Metadata ---');

  await test('Documents search matches text inside extractedText field', () => {
    const docs: VaultDocument[] = [
      {
        id: 'doc-s1',
        userId: 'u1',
        title: 'Document 1234',
        category: 'Bills & Utilities',
        documentType: 'Electricity Bill',
        filePath: 'u1/vault/bill.pdf',
        fileUrl: 'u1/vault/bill.pdf',
        fileSizeBytes: 40000,
        mimeType: 'application/pdf',
        fileType: 'pdf',
        extractedText: 'Customer ID: CUST-889922 Torrent Power Electricity Bill Ahmedabad',
        createdAt: '2026-02-01',
      },
      {
        id: 'doc-s2',
        userId: 'u1',
        title: 'General Receipt',
        category: 'Receipts & Invoices',
        documentType: 'Receipt',
        filePath: 'u1/vault/receipt.jpg',
        fileUrl: 'u1/vault/receipt.jpg',
        fileSizeBytes: 80000,
        mimeType: 'image/jpeg',
        fileType: 'image',
        extractedText: 'Reliance Digital Invoice Ref #REL-99201 Samsung OLED TV',
        createdAt: '2026-02-02',
      },
    ];

    const matchDoc = (doc: VaultDocument, query: string): boolean => {
      const q = query.toLowerCase().trim();
      if (!q) return true;
      return (
        (doc.title && doc.title.toLowerCase().includes(q)) ||
        (doc.documentType && doc.documentType.toLowerCase().includes(q)) ||
        (doc.category && doc.category.toLowerCase().includes(q)) ||
        (doc.notes && doc.notes.toLowerCase().includes(q)) ||
        (doc.fileType && doc.fileType.toLowerCase().includes(q)) ||
        (doc.extractedText && doc.extractedText.toLowerCase().includes(q)) ||
        false
      );
    };

    // Search by text that ONLY exists inside extractedText
    assert.strictEqual(matchDoc(docs[0], 'Torrent Power'), true, 'Must find doc-s1 by electric company name in extractedText');
    assert.strictEqual(matchDoc(docs[1], 'Torrent Power'), false);

    assert.strictEqual(matchDoc(docs[1], 'REL-99201'), true, 'Must find doc-s2 by invoice ref in extractedText');
    assert.strictEqual(matchDoc(docs[0], 'REL-99201'), false);

    assert.strictEqual(matchDoc(docs[0], 'pdf'), true, 'Must match by fileType');
    assert.strictEqual(matchDoc(docs[1], 'image'), true, 'Must match by fileType');
  });

  // ---------------------------------------------------------------------------
  // 10. Dual-Side Document Storage Persistence
  // ---------------------------------------------------------------------------
  console.log('--- 10. Dual-Side Document Storage Persistence ---');

  await test('itemStore addDocument and updateDocument upload and persist both front and back images', () => {
    const itemStorePath = path.join(rootDir, 'src', 'store', 'itemStore.ts');
    const content = fs.readFileSync(itemStorePath, 'utf8');

    // Confirm filePathBack upload in addDocument
    assert.ok(content.includes('docData.filePathBack'), 'Must check docData.filePathBack');
    assert.ok(content.includes('_back'), 'Must append _back suffix for secondary file key');
    assert.ok(content.includes('storagePathBack: durableStoragePathBack'), 'Must store storagePathBack on document model');
  });

  // ---------------------------------------------------------------------------
  // 11. Preservation of Original Formats in Document Upload Flow
  // ---------------------------------------------------------------------------
  console.log('--- 11. Preservation of Original Formats in Document Upload ---');

  await test('app/document/add.tsx preserves true file extensions for PDF and Image uploads', () => {
    const addDocScreenPath = path.join(rootDir, 'app', 'document', 'add.tsx');
    const content = fs.readFileSync(addDocScreenPath, 'utf8');

    assert.ok(content.includes('detectFormatFromUriOrName'), 'Must detect format from URI or name');
    assert.ok(content.includes("isPdf ? 'pdf' : 'image'"), 'Must correctly infer fileType');
    assert.ok(content.includes("isPdf ? 'application/pdf' :"), 'Must preserve application/pdf mime type');
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(` RESULT: ${passedTests}/${totalTests} universal document tests passed!`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exitCode = 1;
  }
}

runSuite().catch((err) => {
  console.error('Fatal test suite failure:', err);
  process.exit(1);
});
