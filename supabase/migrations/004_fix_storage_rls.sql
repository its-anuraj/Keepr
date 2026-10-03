-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Storage Security & User Isolation Hardening
-- Migration: 004_fix_storage_rls.sql
--
-- Replaces previous insecure storage policies with strict, owner-isolated RLS.
--
-- Security Requirements Enforced:
-- 1. All 3 buckets (item-images, item-documents, vault-documents) are PRIVATE.
-- 2. Every cloud object path MUST follow: {auth.uid()}/...
-- 3. Storage RLS strictly enforces: auth.uid()::text = (storage.foldername(name))[1]
-- 4. Dedicated SELECT, INSERT, UPDATE, DELETE policies per bucket.
-- 5. Zero cross-user access; zero unauthenticated access.
-- 6. "authenticated" role alone is NEVER sufficient; user ownership is mandatory.
-- ==============================================================================

-- ============================================================
-- 1. BUCKET CONFIGURATION: Strictly Private (Idempotent)
-- ============================================================

-- Ensure all three buckets exist in storage.buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values 
  ('item-images', 'item-images', false, null, null),
  ('item-documents', 'item-documents', false, null, null),
  ('vault-documents', 'vault-documents', false, null, null)
on conflict (id) do update set public = false;

-- Enforce public = false on all three buckets
update storage.buckets
set public = false
where id in (
  'item-images',
  'item-documents',
  'vault-documents'
);

-- ============================================================
-- 2. EXTEND public.documents WITH storage_path (Idempotent)
-- Explicit cloud storage path column alongside file_path and file_url
-- ============================================================

alter table public.documents add column if not exists storage_path text;

-- ============================================================
-- 3. DROP ALL LEGACY / INSECURE POLICIES ON storage.objects
-- (Drops policies from Migration 003 and any prior drafts)
-- ============================================================

-- item-images
drop policy if exists "item-images: users upload own" on storage.objects;
drop policy if exists "item-images: users select own" on storage.objects;
drop policy if exists "item-images: users insert own" on storage.objects;
drop policy if exists "item-images: users update own" on storage.objects;
drop policy if exists "item-images: users delete own" on storage.objects;
drop policy if exists "item-images: public read" on storage.objects;
drop policy if exists "item-images: public read v2" on storage.objects;
drop policy if exists "item-images: authenticated select v2" on storage.objects;
drop policy if exists "item-images: authenticated insert v2" on storage.objects;
drop policy if exists "item-images: authenticated update v2" on storage.objects;
drop policy if exists "item-images: authenticated delete v2" on storage.objects;

-- item-documents
drop policy if exists "item-documents: users upload own" on storage.objects;
drop policy if exists "item-documents: users select own" on storage.objects;
drop policy if exists "item-documents: users insert own" on storage.objects;
drop policy if exists "item-documents: users update own" on storage.objects;
drop policy if exists "item-documents: users delete own" on storage.objects;
drop policy if exists "item-documents: authenticated select v2" on storage.objects;
drop policy if exists "item-documents: authenticated insert v2" on storage.objects;
drop policy if exists "item-documents: authenticated update v2" on storage.objects;
drop policy if exists "item-documents: authenticated delete v2" on storage.objects;

-- vault-documents
drop policy if exists "vault-documents: users upload own" on storage.objects;
drop policy if exists "vault-documents: users select own" on storage.objects;
drop policy if exists "vault-documents: users insert own" on storage.objects;
drop policy if exists "vault-documents: users update own" on storage.objects;
drop policy if exists "vault-documents: users delete own" on storage.objects;
drop policy if exists "vault-documents: authenticated select v2" on storage.objects;
drop policy if exists "vault-documents: authenticated insert v2" on storage.objects;
drop policy if exists "vault-documents: authenticated update v2" on storage.objects;
drop policy if exists "vault-documents: authenticated delete v2" on storage.objects;

-- ==============================================================================
-- 4. BUCKET: item-images (Private - Owner Only)
-- ==============================================================================

create policy "item-images: users select own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'item-images' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-images: users insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-images' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-images: users update own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'item-images' and
    auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'item-images' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-images: users delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'item-images' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- ==============================================================================
-- 5. BUCKET: item-documents (Private - Owner Only)
-- ==============================================================================

create policy "item-documents: users select own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'item-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-documents: users insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-documents: users update own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'item-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'item-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-documents: users delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'item-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- ==============================================================================
-- 6. BUCKET: vault-documents (Private - Owner Only)
-- ==============================================================================

create policy "vault-documents: users select own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vault-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "vault-documents: users insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vault-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "vault-documents: users update own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vault-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'vault-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "vault-documents: users delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vault-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );
