-- Supabase schema for Wrappy Web
-- Run this in Supabase SQL editor.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum (
      'placed',
      'preparing',
      'out_for_delivery',
      'delivered',
      'cancelled'
    );
  end if;
end
$$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique,
  email text unique,
  full_name text,
  created_at timestamptz default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int default 0,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric not null,
  is_veg boolean default false,
  is_available boolean default true,
  category_id uuid references categories(id) on delete set null,
  image_url text,
  addons jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  type text not null, -- percent | flat | first_order
  value numeric not null,
  min_order numeric default 0,
  usage_limit int default 0,
  used_count int default 0,
  expires_at timestamptz,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  customer_clerk_id text,
  status order_status default 'placed',
  subtotal numeric default 0,
  discount numeric default 0,
  tax numeric default 0,
  packing_fee numeric default 0,
  delivery_fee numeric default 0,
  total numeric default 0,
  eta timestamptz,
  estimated_delivery_minutes int default 30,
  delivery_time timestamptz,
  address text,
  phone text,
  instructions text,
  coupon_code text,
  payment_method text default 'razorpay',
  payment_status text default 'pending',
  razorpay_order_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id),
  qty int default 1,
  price numeric default 0,
  addons jsonb default '[]'::jsonb,
  line_total numeric default 0
);

create table if not exists store_settings (
  id uuid primary key default gen_random_uuid(),
  open_time time default '10:00:00',
  close_time time default '22:00:00',
  allow_preorder boolean default false,
  force_closed boolean default false,
  estimated_delivery_minutes int default 30
);

create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  customer_clerk_id text not null,
  label text,
  address_line text not null,
  apartment_name text,
  flat_number text,
  landmark text,
  city text,
  state text,
  pincode text,
  country text,
  latitude double precision,
  longitude double precision,
  is_default boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table users add column if not exists clerk_user_id text unique;
alter table categories add column if not exists created_at timestamptz default now();
alter table products add column if not exists addons jsonb default '[]'::jsonb;
alter table products add column if not exists is_available boolean default true;
alter table coupons add column if not exists is_active boolean default true;
alter table coupons add column if not exists created_at timestamptz default now();
alter table orders add column if not exists customer_clerk_id text;
alter table orders add column if not exists estimated_delivery_minutes int default 30;
alter table orders add column if not exists delivery_time timestamptz;
alter table orders add column if not exists address text;
alter table orders add column if not exists phone text;
alter table orders add column if not exists instructions text;
alter table orders add column if not exists coupon_code text;
alter table orders add column if not exists payment_method text default 'razorpay';
alter table orders add column if not exists payment_status text default 'pending';
alter table orders add column if not exists packing_fee numeric default 0;
alter table orders add column if not exists razorpay_order_id text;
alter table orders add column if not exists updated_at timestamptz default now();
alter table order_items add column if not exists addons jsonb default '[]'::jsonb;
alter table order_items add column if not exists line_total numeric default 0;
alter table store_settings add column if not exists estimated_delivery_minutes int default 30;
alter table store_settings add column if not exists force_closed boolean default false;
alter table addresses add column if not exists customer_clerk_id text;
alter table addresses add column if not exists label text;
alter table addresses add column if not exists address_line text;
alter table addresses add column if not exists apartment_name text;
alter table addresses add column if not exists flat_number text;
alter table addresses add column if not exists landmark text;
alter table addresses add column if not exists city text;
alter table addresses add column if not exists state text;
alter table addresses add column if not exists pincode text;
alter table addresses add column if not exists country text;
alter table addresses add column if not exists latitude double precision;
alter table addresses add column if not exists longitude double precision;
alter table addresses add column if not exists is_default boolean default false;
alter table addresses add column if not exists created_at timestamptz default now();
alter table addresses add column if not exists updated_at timestamptz default now();

create index if not exists idx_products_category_id on products (category_id);
create index if not exists idx_orders_customer_clerk_id on orders (customer_clerk_id);
create index if not exists idx_orders_status on orders (status);
create index if not exists idx_orders_created_at on orders (created_at desc);
create index if not exists idx_coupons_code on coupons (code);
create index if not exists idx_addresses_customer_clerk_id on addresses (customer_clerk_id);
create index if not exists idx_addresses_updated_at on addresses (updated_at desc);
create unique index if not exists idx_addresses_default_per_user
  on addresses (customer_clerk_id)
  where is_default = true;
