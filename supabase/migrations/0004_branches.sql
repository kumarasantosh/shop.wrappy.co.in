-- Multi-branch support.
-- Adds branches, branch members (admins/staff), per-branch menu overrides,
-- and links orders to the branch that should fulfil them.
-- Safe to run multiple times (uses IF NOT EXISTS / ON CONFLICT).
-- Apply in Supabase SQL editor: Database → SQL Editor → New query.

create extension if not exists "pgcrypto";

-- ── Branches ────────────────────────────────────────────────────────────────
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  address text,
  city text,
  phone text,
  latitude numeric,
  longitude numeric,
  open_time time not null default '10:00',
  close_time time not null default '22:00',
  allow_preorder boolean not null default false,
  force_closed boolean not null default false,
  estimated_delivery_minutes integer not null default 30,
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- ── Branch members (admins / staff) keyed by email ──────────────────────────
create table if not exists branch_members (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  email text not null,
  role text not null default 'staff' check (role in ('admin','staff')),
  name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (branch_id, email)
);
create index if not exists branch_members_email_idx on branch_members (lower(email));

-- ── Per-branch menu (availability + optional price override) ────────────────
create table if not exists branch_products (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  is_available boolean not null default true,
  price_override numeric,
  created_at timestamptz not null default now(),
  unique (branch_id, product_id)
);
create index if not exists branch_products_branch_idx on branch_products (branch_id);
create index if not exists branch_products_product_idx on branch_products (product_id);

-- ── Order → branch link ─────────────────────────────────────────────────────
alter table orders add column if not exists branch_id uuid references branches(id);
create index if not exists orders_branch_id_idx on orders (branch_id);

-- ── Seed: JNTU & KBHB branches ──────────────────────────────────────────────
-- Coordinates are approximate placeholders (Kukatpally / Hyderabad).
-- Update the exact latitude/longitude from Admin → Branches.
insert into branches (name, slug, address, city, phone, latitude, longitude, position)
values
  ('Wrappy JNTU', 'jntu', 'JNTU, Kukatpally, Hyderabad', 'Hyderabad', '9182285342', 17.49330, 78.39100, 1),
  ('Wrappy KBHB', 'kbhb', 'KPHB / KBHB, Kukatpally, Hyderabad', 'Hyderabad', '9182285342', 17.49480, 78.39960, 2)
on conflict (slug) do nothing;

-- ── Seed: members — 1 admin + 2 staff per branch ────────────────────────────
-- Placeholder emails — edit these to the real Clerk account emails in
-- Admin → Branches. A user is matched to a branch by their sign-in email.
insert into branch_members (branch_id, email, role, name)
select b.id, m.email, m.role, m.name
from branches b
join (
  values
    ('jntu', 'admin.jntu@wrappy.local',  'admin', 'JNTU Admin'),
    ('jntu', 'staff1.jntu@wrappy.local', 'staff', 'JNTU Staff 1'),
    ('jntu', 'staff2.jntu@wrappy.local', 'staff', 'JNTU Staff 2'),
    ('kbhb', 'admin.kbhb@wrappy.local',  'admin', 'KBHB Admin'),
    ('kbhb', 'staff1.kbhb@wrappy.local', 'staff', 'KBHB Staff 1'),
    ('kbhb', 'staff2.kbhb@wrappy.local', 'staff', 'KBHB Staff 2')
) as m(slug, email, role, name) on m.slug = b.slug
on conflict (branch_id, email) do nothing;

-- ── Seed: per-branch menu from the existing catalogue ───────────────────────
-- Every current product becomes available at both branches. Branch admins can
-- toggle availability / set price overrides afterwards.
insert into branch_products (branch_id, product_id, is_available)
select b.id, p.id, true
from branches b
cross join products p
where b.slug in ('jntu', 'kbhb')
on conflict (branch_id, product_id) do nothing;
