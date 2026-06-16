-- Uber Direct integration columns for the orders table.
-- Safe to run multiple times.

alter table orders add column if not exists uber_quote_id text;
alter table orders add column if not exists uber_delivery_id text;
alter table orders add column if not exists uber_tracking_url text;
alter table orders add column if not exists uber_status text;
-- Fee actually quoted/charged by Uber, stored in rupees (same unit as delivery_fee).
alter table orders add column if not exists uber_fee numeric default 0;
-- Dropoff coordinates captured at checkout, needed to dispatch a courier later.
alter table orders add column if not exists dropoff_latitude numeric;
alter table orders add column if not exists dropoff_longitude numeric;

create index if not exists orders_uber_delivery_id_idx on orders (uber_delivery_id);
