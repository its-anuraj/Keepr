-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Universal Document Metadata Migration
-- Adds extracted OCR text, OCR status, page count, and back-side photo support
-- ==============================================================================

-- 1. Add non-destructive columns to public.documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS ocr_status text DEFAULT 'not_scanned',
  ADD COLUMN IF NOT EXISTS page_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS storage_path_back text,
  ADD COLUMN IF NOT EXISTS file_path_back text;

-- 2. Indexes for search and query performance
CREATE INDEX IF NOT EXISTS idx_documents_ocr_status
  ON public.documents (ocr_status);

CREATE INDEX IF NOT EXISTS idx_documents_file_type
  ON public.documents (file_type);
