-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Production Readiness Migration
-- Phase: Cloud Persistence + Storage RLS + Receipts Table + Extended Item Columns
-- ==============================================================================

-- ============================================================
-- 1. RECEIPTS TABLE (was local-only state, now cloud-persisted)
-- ============================================================

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_uri text not null,
  storage_path text, -- stable relative path inside storage bucket
  file_name text not null,
  file_size_bytes bigint default 0,
  mime_type text,
  receipt_type text default 'receipt' check (receipt_type in ('receipt', 'invoice')),
  merchant text,
  seller_address text,
  gstin text,
  purchase_date date,
  total_amount numeric(14, 2),
  subtotal numeric(14, 2),
  discount numeric(14, 2),
  gst_tax text,
  invoice_number text,
  item_count int default 1,
  item_ids text[] default array[]::text[],
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_receipts_user_id on public.receipts(user_id);
create index if not exists idx_receipts_purchase_date on public.receipts(purchase_date desc);
create index if not exists idx_receipts_merchant on public.receipts(merchant);

-- RLS for receipts
alter table public.receipts enable row level security;

create policy "Users manage own receipts select" on public.receipts
  for select using (auth.uid() = user_id);
create policy "Users manage own receipts insert" on public.receipts
  for insert with check (auth.uid() = user_id);
create policy "Users manage own receipts update" on public.receipts
  for update using (auth.uid() = user_id);
create policy "Users manage own receipts delete" on public.receipts
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 2. EXTEND items TABLE with additional columns
-- ============================================================

-- Receipt linkage
alter table public.items add column if not exists receipt_id uuid references public.receipts(id) on delete set null;
alter table public.items add column if not exists receipt_uri text;
alter table public.items add column if not exists receipt_path text;
alter table public.items add column if not exists receipt_name text;
alter table public.items add column if not exists receipt_type text check (receipt_type in ('receipt', 'invoice'));

-- Product photos (stored as JSON array of URIs)
alter table public.items add column if not exists product_photos jsonb default '[]'::jsonb;

-- Category intelligence
alter table public.items add column if not exists product_type text;
alter table public.items add column if not exists category_confidence text check (category_confidence in ('high', 'medium', 'low'));

-- Financial details from receipt parsing
alter table public.items add column if not exists subtotal numeric(14, 2);
alter table public.items add column if not exists discount numeric(14, 2);
alter table public.items add column if not exists gst_tax text;
alter table public.items add column if not exists gst_rate text;
alter table public.items add column if not exists cgst text;
alter table public.items add column if not exists sgst text;
alter table public.items add column if not exists igst text;
alter table public.items add column if not exists invoice_number text;
alter table public.items add column if not exists quantity int default 1;
alter table public.items add column if not exists unit_price numeric(14, 2);

-- Seller details
alter table public.items add column if not exists seller_address text;
alter table public.items add column if not exists gstin text;

-- Item lifecycle
alter table public.items add column if not exists return_until date;
alter table public.items add column if not exists warranty_until date;
alter table public.items add column if not exists warranty_provider text;

-- Category-specific vehicle fields
alter table public.items add column if not exists registration_number text;
alter table public.items add column if not exists vin_chassis_number text;
alter table public.items add column if not exists engine_number text;
alter table public.items add column if not exists variant text;
alter table public.items add column if not exists dealer text;
alter table public.items add column if not exists insurance_expiry date;
alter table public.items add column if not exists puc_date date;

-- Electronics specific
alter table public.items add column if not exists imei text;

-- Fashion specific
alter table public.items add column if not exists size text;
alter table public.items add column if not exists color text;
alter table public.items add column if not exists material text;

-- ============================================================
-- 3. EXTEND warranties TABLE with missing columns
-- ============================================================

alter table public.warranties add column if not exists warranty_until date;

-- ============================================================
-- 4. STORAGE RLS POLICIES
-- (Storage.objects policies for user-isolated file access)
-- ============================================================

-- item-images bucket: public read, owner write
create policy "item-images: users upload own" on storage.objects
  for insert with check (
    bucket_id = 'item-images' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-images: users update own" on storage.objects
  for update using (
    bucket_id = 'item-images' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-images: users delete own" on storage.objects
  for delete using (
    bucket_id = 'item-images' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-images: public read" on storage.objects
  for select using (bucket_id = 'item-images');

-- item-documents bucket: private, owner only
create policy "item-documents: users upload own" on storage.objects
  for insert with check (
    bucket_id = 'item-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-documents: users select own" on storage.objects
  for select using (
    bucket_id = 'item-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-documents: users update own" on storage.objects
  for update using (
    bucket_id = 'item-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "item-documents: users delete own" on storage.objects
  for delete using (
    bucket_id = 'item-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- vault-documents bucket: private, owner only
create policy "vault-documents: users upload own" on storage.objects
  for insert with check (
    bucket_id = 'vault-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "vault-documents: users select own" on storage.objects
  for select using (
    bucket_id = 'vault-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "vault-documents: users update own" on storage.objects
  for update using (
    bucket_id = 'vault-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "vault-documents: users delete own" on storage.objects
  for delete using (
    bucket_id = 'vault-documents' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- 5. UPDATED_AT TRIGGER for receipts (keep updated_at current)
-- ============================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger: receipts
drop trigger if exists receipts_set_updated_at on public.receipts;
create trigger receipts_set_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

-- Trigger: items (ensure updated_at is maintained on every row update)
drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- ============================================================
-- 6. Performance indexes for new columns
-- ============================================================

create index if not exists idx_items_receipt_id on public.items(receipt_id);
create index if not exists idx_items_return_until on public.items(return_until);
create index if not exists idx_items_warranty_until on public.items(warranty_until);
create index if not exists idx_items_status on public.items(status);
