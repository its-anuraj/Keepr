-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Extend Maintenance Records Schema
-- Migration: 007_extend_maintenance_records.sql
--
-- Purpose:
-- Extends the canonical public.maintenance_records table to fully support
-- Service & Repair History:
-- - Service types (Repair, Maintenance, Servicing, Inspection, Part Replacement, etc.)
-- - Problem description, work performed, parts replaced, technician notes
-- - Service provider address and phone
-- - Warranty coverage (yes / no / unknown), coverage type, reference number
-- - Amount paid & currency
-- - Post-service warranty & guarantee dates
-- - Document references & attachments
-- - Hardened RLS ensuring item_id belongs to the authenticated user
-- ==============================================================================

ALTER TABLE public.maintenance_records
  ADD COLUMN IF NOT EXISTS service_type text DEFAULT 'Service',
  ADD COLUMN IF NOT EXISTS problem_description text,
  ADD COLUMN IF NOT EXISTS work_performed text,
  ADD COLUMN IF NOT EXISTS parts_replaced text,
  ADD COLUMN IF NOT EXISTS technician_notes text,
  ADD COLUMN IF NOT EXISTS service_provider_address text,
  ADD COLUMN IF NOT EXISTS service_provider_phone text,
  ADD COLUMN IF NOT EXISTS warranty_covered text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS coverage_type text,
  ADD COLUMN IF NOT EXISTS coverage_reference_number text,
  ADD COLUMN IF NOT EXISTS amount_paid numeric(14, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS post_service_warranty boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS post_service_warranty_until date,
  ADD COLUMN IF NOT EXISTS post_service_guarantee boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS post_service_guarantee_until date,
  ADD COLUMN IF NOT EXISTS document_ids jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_maintenance_service_type ON public.maintenance_records(service_type);
CREATE INDEX IF NOT EXISTS idx_maintenance_post_warranty ON public.maintenance_records(post_service_warranty_until) WHERE post_service_warranty_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_post_guarantee ON public.maintenance_records(post_service_guarantee_until) WHERE post_service_guarantee_until IS NOT NULL;

-- Harden RLS: Verify item_id belongs to authenticated user
DROP POLICY IF EXISTS "Users manage own maintenance insert" ON public.maintenance_records;
CREATE POLICY "Users manage own maintenance insert" ON public.maintenance_records
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (SELECT 1 FROM public.items WHERE id = item_id AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users manage own maintenance update" ON public.maintenance_records;
CREATE POLICY "Users manage own maintenance update" ON public.maintenance_records
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (SELECT 1 FROM public.items WHERE id = item_id AND user_id = auth.uid())
  );

-- END OF MIGRATION 007
