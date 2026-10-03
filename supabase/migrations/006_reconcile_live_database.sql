-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Database Reconciliation Migration
-- Migration: 006_reconcile_live_database.sql
--
-- Purpose:
-- Reconciles the live Supabase PostgreSQL schema with the canonical Keepr
-- data model following a live forensic audit.
--
-- Scope:
-- 1. documents table: Make item_id nullable (enables standalone documents).
-- 2. documents table: Add 13 missing metadata columns.
-- 3. documents table: Backfill title from name where null.
-- 4. documents table: Add missing search and filter performance indexes.
-- 5. documents table: Attach set_updated_at trigger.
-- 6. RLS hardening: Enforce WITH CHECK (auth.uid() = user_id / id) on all
--    user-owned tables' UPDATE policies to prevent ownership tampering.
--
-- Safety Guarantees:
-- - 100% idempotent: safe to execute multiple times without error.
-- - Non-destructive: zero data loss, zero table drops, zero column drops.
-- - Leaves existing working storage configurations and policies untouched.
-- - Preserves historical migration records.
-- ==============================================================================

-- ==============================================================================
-- 1. DOCUMENTS TABLE: NULLABILITY & METADATA RECONCILIATION
-- ==============================================================================

-- 1.1 Allow standalone documents by making item_id nullable
ALTER TABLE public.documents
  ALTER COLUMN item_id DROP NOT NULL;

-- 1.2 Add canonical document metadata columns if not already present
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS document_date date,
  ADD COLUMN IF NOT EXISTS issuer_name text,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS thumbnail_path text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 1.3 Backfill title from name for any existing rows where title is null
UPDATE public.documents
SET title = name
WHERE title IS NULL;

-- 1.4 Create performance and search indexes for documents
CREATE INDEX IF NOT EXISTS idx_documents_category
  ON public.documents (category);

CREATE INDEX IF NOT EXISTS idx_documents_document_type
  ON public.documents (document_type);

CREATE INDEX IF NOT EXISTS idx_documents_expiry_date
  ON public.documents (expiry_date);

CREATE INDEX IF NOT EXISTS idx_documents_created_at
  ON public.documents (created_at DESC);

-- ==============================================================================
-- 2. DOCUMENTS TIMESTAMP AUTOMATION
-- ==============================================================================

-- Ensure reusable updated_at trigger function exists
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  new.updated_at = now();
  return new;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to documents table (idempotent drop & recreate)
DROP TRIGGER IF EXISTS documents_set_updated_at ON public.documents;
CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==============================================================================
-- 3. ROW LEVEL SECURITY (RLS) UPDATE HARDENING
-- Enforces both USING (ownership verification) and WITH CHECK (payload verification)
-- across all user-owned tables to prevent cross-user reassignment attacks.
-- ==============================================================================

-- 3.1 Profiles: user can only update their own profile and cannot reassign id
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 3.2 Items: user can only update their own items and cannot reassign user_id
DROP POLICY IF EXISTS "Users manage own items update" ON public.items;
CREATE POLICY "Users manage own items update" ON public.items
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3.3 Warranties: user can only update their own warranties
DROP POLICY IF EXISTS "Users manage own warranties update" ON public.warranties;
CREATE POLICY "Users manage own warranties update" ON public.warranties
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3.4 Documents: user can only update their own documents
DROP POLICY IF EXISTS "Users manage own documents update" ON public.documents;
CREATE POLICY "Users manage own documents update" ON public.documents
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3.5 Receipts: user can only update their own receipts
DROP POLICY IF EXISTS "Users manage own receipts update" ON public.receipts;
CREATE POLICY "Users manage own receipts update" ON public.receipts
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3.6 Maintenance Records: user can only update their own maintenance logs
DROP POLICY IF EXISTS "Users manage own maintenance update" ON public.maintenance_records;
CREATE POLICY "Users manage own maintenance update" ON public.maintenance_records
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3.7 Expenses: user can only update their own expense entries
DROP POLICY IF EXISTS "Users manage own expenses update" ON public.expenses;
CREATE POLICY "Users manage own expenses update" ON public.expenses
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3.8 Reminder Preferences: user can only update their own reminder settings
DROP POLICY IF EXISTS "Users manage own reminder preferences update" ON public.reminder_preferences;
CREATE POLICY "Users manage own reminder preferences update" ON public.reminder_preferences
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- END OF MIGRATION 006
-- ==============================================================================
