-- Provider-neutral courier columns so the app can use Uber Direct, Borzo, etc.
-- without provider-specific column names. Safe to run multiple times.

alter table orders add column if not exists delivery_provider text;
alter table orders add column if not exists courier_quote_id text;
alter table orders add column if not exists courier_order_id text;
alter table orders add column if not exists courier_tracking_url text;
alter table orders add column if not exists courier_status text;
-- Fee actually quoted/charged by the courier, in rupees (matches delivery_fee).
alter table orders add column if not exists courier_fee numeric default 0;

create index if not exists orders_courier_order_id_idx on orders (courier_order_id);
