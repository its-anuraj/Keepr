-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Item Image Storage Path Migration
-- Migration: 009_item_image_storage_path.sql
--
-- Purpose:
-- Adds an explicit `image_storage_path` column to the `items` table so that
-- durable Supabase Storage references (e.g. `userId/items/itemId/photo_0.jpg`)
-- are permanently stored in the database instead of device-local file paths.
--
-- Safety:
-- 100% idempotent: uses IF NOT EXISTS and non-destructive backfill.
-- ==============================================================================

-- 1. Add image_storage_path column if not already present
alter table public.items
  add column if not exists image_storage_path text;

-- 2. Performance index on image_storage_path
create index if not exists idx_items_image_storage_path
  on public.items (image_storage_path);

-- 3. Backfill image_storage_path from image_url for rows where image_url is a Supabase Storage path
-- (i.e. does not start with file://, content://, or http)
update public.items
set image_storage_path = image_url
where image_url is not null
  and image_storage_path is null
  and image_url not like 'file://%'
  and image_url not like 'content://%'
  and image_url not like 'http://%'
  and image_url not like 'https://%'
  and image_url not like '/%';
