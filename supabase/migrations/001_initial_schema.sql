-- ==============================================================================
-- KEEPR DIGITAL OWNERSHIP VAULT: Initial Schema Migration
-- Database: PostgreSQL (Supabase)
-- ==============================================================================

-- 1. Enable UUID Extension
create extension if not exists "uuid-ossp";

-- 2. User Profiles Table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  currency text default 'INR',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 3. Item Categories Table
create table if not exists public.item_categories (
  id text primary key,
  name text not null,
  icon text not null,
  description text,
  sort_order int default 0
);

-- Seed Default Categories
insert into public.item_categories (id, name, icon, description, sort_order)
values
  ('electronics', 'Electronics & Gadgets', 'laptop_mac', 'Computers, smartphones, audio, and personal devices', 1),
  ('appliances', 'Home Appliances', 'kitchen', 'Refrigerators, air conditioners, washing machines', 2),
  ('vehicles', 'Vehicles', 'directions_car', 'Automobiles, motorcycles, bicycles', 3),
  ('furniture', 'Furniture & Living', 'chair', 'Living room suites, desks, ergonomic chairs', 4),
  ('luxury', 'Personal Luxury', 'watch', 'Watches, jewelry, high-end accessories', 5),
  ('tools', 'Tools & Hardware', 'build', 'Power tools, workshop equipment, garden gear', 6),
  ('other', 'Other Assets', 'inventory_2', 'Miscellaneous personal property', 7)
on conflict (id) do nothing;

-- 4. Items Table
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  category_id text references public.item_categories(id) on delete set null,
  brand text,
  model text,
  serial_number text,
  purchase_date date,
  purchase_price numeric(14, 2) default 0.00 not null,
  currency text default 'INR' not null,
  merchant text,
  image_url text,
  notes text,
  status text default 'active' check (status in ('active', 'archived', 'resold', 'disposed')),
  resale_price numeric(14, 2),
  resale_date date,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_items_user_id on public.items(user_id);
create index if not exists idx_items_category on public.items(category_id);
create index if not exists idx_items_created_at on public.items(created_at desc);

-- 5. Warranties Table
create table if not exists public.warranties (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text, -- e.g. 'AppleCare+', 'LG Electronics Manufacturer Warranty'
  policy_number text,
  warranty_type text default 'manufacturer' check (warranty_type in ('manufacturer', 'extended', 'third_party', 'amc')),
  duration_months int default 12,
  start_date date not null,
  end_date date not null,
  coverage_details text,
  reminder_enabled boolean default true,
  reminder_days_before int default 30,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_warranties_item_id on public.warranties(item_id);
create index if not exists idx_warranties_user_id on public.warranties(user_id);
create index if not exists idx_warranties_end_date on public.warranties(end_date);

-- 6. Documents Table
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  file_path text not null,
  file_url text not null,
  file_type text not null, -- 'pdf', 'image', 'receipt', 'invoice', 'warranty_card', 'certificate'
  file_size_bytes bigint default 0,
  mime_type text,
  created_at timestamptz default now() not null
);

create index if not exists idx_documents_item_id on public.documents(item_id);
create index if not exists idx_documents_user_id on public.documents(user_id);

-- 7. Maintenance Records Table
create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  service_provider text,
  service_date date not null,
  cost numeric(14, 2) default 0.00 not null,
  next_service_date date,
  status text default 'completed' check (status in ('scheduled', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_maintenance_item_id on public.maintenance_records(item_id);
create index if not exists idx_maintenance_user_id on public.maintenance_records(user_id);
create index if not exists idx_maintenance_date on public.maintenance_records(service_date desc);

-- 8. Expenses Table
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  expense_type text not null check (expense_type in ('purchase', 'repair', 'maintenance', 'accessories', 'replacement_parts', 'insurance', 'other')),
  amount numeric(14, 2) not null,
  expense_date date not null,
  notes text,
  created_at timestamptz default now() not null
);

create index if not exists idx_expenses_item_id on public.expenses(item_id);
create index if not exists idx_expenses_user_id on public.expenses(user_id);
create index if not exists idx_expenses_date on public.expenses(expense_date desc);

-- 9. Activity Logs (Audit Ledger) Table
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  activity_type text not null,
  title text not null,
  description text,
  amount numeric(14, 2),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null
);

create index if not exists idx_activity_logs_user_id on public.activity_logs(user_id);
create index if not exists idx_activity_logs_created_at on public.activity_logs(created_at desc);

-- 10. Reminder Preferences Table
create table if not exists public.reminder_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  warranty_reminders boolean default true not null,
  maintenance_reminders boolean default true not null,
  document_reminders boolean default true not null,
  lead_days int[] default array[30, 14, 7, 1] not null,
  updated_at timestamptz default now() not null
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

alter table public.profiles enable row level security;
alter table public.item_categories enable row level security;
alter table public.items enable row level security;
alter table public.warranties enable row level security;
alter table public.documents enable row level security;
alter table public.maintenance_records enable row level security;
alter table public.expenses enable row level security;
alter table public.activity_logs enable row level security;
alter table public.reminder_preferences enable row level security;

-- Profiles: users can select and update their own profile
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- Categories: public readable for authenticated users
create policy "Authenticated users can read categories" on public.item_categories
  for select using (true);

-- Items: strictly scoped to owner
create policy "Users manage own items select" on public.items
  for select using (auth.uid() = user_id);
create policy "Users manage own items insert" on public.items
  for insert with check (auth.uid() = user_id);
create policy "Users manage own items update" on public.items
  for update using (auth.uid() = user_id);
create policy "Users manage own items delete" on public.items
  for delete using (auth.uid() = user_id);

-- Warranties: strictly scoped to owner
create policy "Users manage own warranties select" on public.warranties
  for select using (auth.uid() = user_id);
create policy "Users manage own warranties insert" on public.warranties
  for insert with check (auth.uid() = user_id);
create policy "Users manage own warranties update" on public.warranties
  for update using (auth.uid() = user_id);
create policy "Users manage own warranties delete" on public.warranties
  for delete using (auth.uid() = user_id);

-- Documents: strictly scoped to owner
create policy "Users manage own documents select" on public.documents
  for select using (auth.uid() = user_id);
create policy "Users manage own documents insert" on public.documents
  for insert with check (auth.uid() = user_id);
create policy "Users manage own documents update" on public.documents
  for update using (auth.uid() = user_id);
create policy "Users manage own documents delete" on public.documents
  for delete using (auth.uid() = user_id);

-- Maintenance: strictly scoped to owner
create policy "Users manage own maintenance select" on public.maintenance_records
  for select using (auth.uid() = user_id);
create policy "Users manage own maintenance insert" on public.maintenance_records
  for insert with check (auth.uid() = user_id);
create policy "Users manage own maintenance update" on public.maintenance_records
  for update using (auth.uid() = user_id);
create policy "Users manage own maintenance delete" on public.maintenance_records
  for delete using (auth.uid() = user_id);

-- Expenses: strictly scoped to owner
create policy "Users manage own expenses select" on public.expenses
  for select using (auth.uid() = user_id);
create policy "Users manage own expenses insert" on public.expenses
  for insert with check (auth.uid() = user_id);
create policy "Users manage own expenses update" on public.expenses
  for update using (auth.uid() = user_id);
create policy "Users manage own expenses delete" on public.expenses
  for delete using (auth.uid() = user_id);

-- Activity Logs: strictly scoped to owner
create policy "Users manage own activity select" on public.activity_logs
  for select using (auth.uid() = user_id);
create policy "Users manage own activity insert" on public.activity_logs
  for insert with check (auth.uid() = user_id);

-- Reminder Preferences: strictly scoped to owner
create policy "Users manage own reminder preferences select" on public.reminder_preferences
  for select using (auth.uid() = user_id);
create policy "Users manage own reminder preferences insert" on public.reminder_preferences
  for insert with check (auth.uid() = user_id);
create policy "Users manage own reminder preferences update" on public.reminder_preferences
  for update using (auth.uid() = user_id);

-- ==============================================================================
-- AUTOMATIC PROFILE TRIGGER ON USER SIGNUP
-- ==============================================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url, currency)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Vault Member'),
    new.email,
    new.raw_user_meta_data->>'avatar_url',
    'INR'
  );
  insert into public.reminder_preferences (user_id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if exists and recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==============================================================================
-- STORAGE BUCKETS
-- ==============================================================================
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('item-documents', 'item-documents', false)
on conflict (id) do nothing;
