create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  description text,
  image_url text,
  price_nok int not null,
  currency text not null default 'NOK',
  printful_sync_product_id text,
  printful_variant_id int,
  is_active boolean not null default true
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  email text,
  amount_nok int not null,
  currency text not null default 'NOK',
  status text not null check (status in ('created', 'paid', 'submitted', 'failed')),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  printful_order_id text,
  shipping_name text,
  shipping_address_json jsonb,
  items_json jsonb
);

alter table public.products enable row level security;
alter table public.orders enable row level security;

drop policy if exists "products_active_select" on public.products;
create policy "products_active_select"
  on public.products
  for select
  to anon
  using (is_active = true);

-- orders should not be publicly readable from anon.
drop policy if exists "orders_no_anon" on public.orders;
create policy "orders_no_anon"
  on public.orders
  for select
  to anon
  using (false);
