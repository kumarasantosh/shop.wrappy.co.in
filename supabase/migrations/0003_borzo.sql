-- Borzo Delivery API integration columns for the orders table.
-- Safe to run multiple times (uses IF NOT EXISTS).
-- Apply in Supabase SQL editor: Database → SQL Editor → New query.

alter table orders add column if not exists borzo_order_id bigint;
alter table orders add column if not exists borzo_status text;         -- new | available | active | completed | canceled | delayed
alter table orders add column if not exists borzo_tracking_url text;   -- first drop-off tracking URL from Borzo
alter table orders add column if not exists borzo_tracking_urls jsonb; -- all per-point tracking URLs [{address, url}]

-- Index for fast callback lookups (Borzo sends borzo_order_id in every callback)
create index if not exists orders_borzo_order_id_idx on orders (borzo_order_id);
