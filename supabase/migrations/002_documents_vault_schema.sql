-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Document Vault Migration
-- Allows standalone documents (item_id is nullable) and adds canonical metadata
-- ==============================================================================

-- 1. Make item_id nullable on documents table
alter table public.documents alter column item_id drop not null;

-- 2. Add canonical document metadata columns
alter table public.documents
  add column if not exists title text,
  add column if not exists category text,
  add column if not exists document_type text,
  add column if not exists document_date date,
  add column if not exists issuer_name text,
  add column if not exists reference_number text,
  add column if not exists amount numeric(14, 2),
  add column if not exists currency text default 'INR',
  add column if not exists expiry_date date,
  add column if not exists notes text,
  add column if not exists thumbnail_path text,
  add column if not exists updated_at timestamptz default now();

-- 3. Populate title from name where title is null
update public.documents set title = name where title is null;

-- 4. Create performance indexes for search and filter queries
create index if not exists idx_documents_user_id on public.documents(user_id);
create index if not exists idx_documents_item_id on public.documents(item_id);
create index if not exists idx_documents_category on public.documents(category);
create index if not exists idx_documents_document_type on public.documents(document_type);
create index if not exists idx_documents_expiry_date on public.documents(expiry_date);
create index if not exists idx_documents_created_at on public.documents(created_at desc);

-- 5. Dedicated Storage Bucket for Document Vault Files (Private)
insert into storage.buckets (id, name, public)
values ('vault-documents', 'vault-documents', false)
on conflict (id) do nothing;
