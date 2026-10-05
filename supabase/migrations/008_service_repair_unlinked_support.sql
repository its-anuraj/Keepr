-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Unlinked Service Records & Performance Schema
-- Migration: 008_service_repair_unlinked_support.sql
--
-- Purpose:
-- 1. Permits standalone / unlinked Service & Repair records (item_id nullable)
--    so users can track repairs for products not yet in the vault.
-- 2. Preserves strict multi-tenant RLS: if item_id IS provided, it MUST belong
--    to the authenticated user (anti cross-tenant linking attack).
-- 3. Updates foreign key to ON DELETE SET NULL to preserve repair history.
-- 4. Creates optimized compound indexes for scoped searches, sorting, and filters.
-- ==============================================================================

-- 1. Allow item_id to be nullable
ALTER TABLE public.maintenance_records
  ALTER COLUMN item_id DROP NOT NULL;

-- 2. Update Foreign Key to ON DELETE SET NULL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'maintenance_records_item_id_fkey'
      AND table_name = 'maintenance_records'
  ) THEN
    ALTER TABLE public.maintenance_records
      DROP CONSTRAINT maintenance_records_item_id_fkey;
  END IF;
END $$;

ALTER TABLE public.maintenance_records
  ADD CONSTRAINT maintenance_records_item_id_fkey
  FOREIGN KEY (item_id)
  REFERENCES public.items(id)
  ON DELETE SET NULL;

-- 3. Hardened RLS: If item_id is non-null, verify it belongs to current user
DROP POLICY IF EXISTS "Users manage own maintenance insert" ON public.maintenance_records;
CREATE POLICY "Users manage own maintenance insert" ON public.maintenance_records
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    (item_id IS NULL OR EXISTS (SELECT 1 FROM public.items WHERE id = item_id AND user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "Users manage own maintenance update" ON public.maintenance_records;
CREATE POLICY "Users manage own maintenance update" ON public.maintenance_records
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND
    (item_id IS NULL OR EXISTS (SELECT 1 FROM public.items WHERE id = item_id AND user_id = auth.uid()))
  );

-- 4. Compound indexes for high-concurrency listing, sorting, and filtering
CREATE INDEX IF NOT EXISTS idx_maintenance_item_id ON public.maintenance_records(item_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_user_created ON public.maintenance_records(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_user_service_date ON public.maintenance_records(user_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_user_cost ON public.maintenance_records(user_id, cost DESC);

-- END OF MIGRATION 008
