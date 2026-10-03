-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Storage Security & Multi-User Isolation Hardening
--
-- Enforces strict user-level ownership on all Supabase Storage buckets:
--   1. item-images (PRIVATE)
--   2. item-documents (PRIVATE)
--   3. vault-documents (PRIVATE)
--
-- Security Model:
--   - All 3 buckets are strictly PRIVATE (public = false).
--   - Every object MUST be stored under a user-owned path: {auth.uid()}/{...}
--   - auth.uid()::text = (storage.foldername(name))[1]
--   - Dedicated SELECT, INSERT, UPDATE, DELETE policies per bucket.
--   - Zero cross-user access; zero unauthenticated access.
-- ==============================================================================

-- 1. Ensure all three buckets exist and are marked private
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values 
  ('item-images', 'item-images', false, null, null),
  ('item-documents', 'item-documents', false, null, null),
  ('vault-documents', 'vault-documents', false, null, null)
on conflict (id) do update set public = false;

-- 2. Storage objects RLS is already enabled by default in Supabase

-- 3. Drop all previous / existing policies for these 3 buckets
-- (Both Migration 003 policy names and Migration 004 v2 policy names)

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
