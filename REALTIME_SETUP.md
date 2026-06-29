# Realtime orders — production setup

The admin orders panel and the customer order tracker receive order changes
live over Supabase Realtime (websockets). The feed is **locked down with RLS**:
the browser connects with the public anon key **plus a Clerk session token**
(native Clerk↔Supabase integration), and Postgres Row Level Security decides
who may receive which rows.

- **Admins** (`public_metadata.role = "admin"`) receive **all** orders.
- **Branch admins / staff** (listed in `branch_members` by email) receive
  **only their own branch's** orders. Requires the `email` claim in the session
  token (see step 1.2) and the policy in
  `supabase/migrations/0005_branch_orders_rls.sql`.
- **Customers** receive **only their own** orders.
- Anyone without a valid admin/owner identity receives **nothing** — even
  though the anon key is public, no order data leaks.

Server-side code (API routes) uses the service-role key and bypasses RLS, so
order creation, status updates, etc. are unaffected.

There are two one-time setup steps in dashboards, plus the SQL.

---

## 1. Clerk dashboard

1. **Activate the Supabase integration.**
   Clerk Dashboard → **Integrations** (or **Configure → Integrations**) →
   **Supabase** → *Activate*. Clerk shows you a **Clerk domain** that looks like
   `https://<your-subdomain>.clerk.accounts.dev` (or your production Clerk
   domain). Copy it — you need it in step 2.

   > As of April 2025 the old "JWT template named `supabase`" approach is
   > deprecated. Use this native integration instead.

2. **Add the `user_role` claim to the session token.**
   Clerk Dashboard → **Sessions** → **Customize session token** → edit the
   claims JSON to include:

   ```json
   {
     "user_role": "{{user.public_metadata.role}}",
     "email": "{{user.primary_email_address}}"
   }
   ```

   (Use `user_role`, not `role` — the Supabase integration reserves `role` and
   sets it to `authenticated`. The `email` claim is what matches branch admins /
   staff to their branch in `branch_members`.)

3. **Mark your admin users.**
   Clerk Dashboard → **Users** → pick the admin user → **Metadata** →
   **Public metadata** → set:

   ```json
   { "role": "admin" }
   ```

   Do this for every staff member who should see the live orders panel. After
   editing metadata, that user must sign out / back in (or refresh) so the new
   token carries the claim.

---

## 2. Supabase dashboard

1. **Add Clerk as a third-party auth provider.**
   Supabase Dashboard → **Authentication** → **Sign In / Providers** →
   **Add provider** → **Clerk** → paste the **Clerk domain** from step 1.1 →
   save.

2. **Make sure Realtime is enabled** for the project:
   **Database** → **Replication** → ensure it's on.

---

## 3. Database SQL

Run this once in the Supabase **SQL editor** (it's also baked into
`supabase/schema.sql`). Safe to re-run.

```sql
-- Stream the table over Realtime, with full row data on update/delete
alter table orders replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table orders;
  exception when duplicate_object then null;
  end;
end $$;

-- RLS: authorize the realtime sockets
alter table orders enable row level security;

-- Remove the temporary dev policy that exposed all orders publicly
drop policy if exists "anon read orders (dev)" on orders;

-- Admins read all orders
drop policy if exists "orders admin read" on orders;
create policy "orders admin read"
  on orders for select
  to authenticated
  using ( (auth.jwt() ->> 'user_role') = 'admin' );

-- Customers read only their own orders
drop policy if exists "orders owner read" on orders;
create policy "orders owner read"
  on orders for select
  to authenticated
  using ( customer_clerk_id = (auth.jwt() ->> 'sub') );
```

---

## 4. Verify

1. Open the admin orders page. The header badge should read **● Live**
   (green). If it shows **Reconnecting** (amber), the socket can't authorize —
   re-check steps 1–3.
2. Insert / place a test order. It should appear instantly, with the alert
   sound, no reload.
3. As a customer, place an order and watch the tracker update its status live.

### Quick debug (optional)

In the Supabase SQL editor, confirm the claim is arriving:

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime'; -- orders should be listed
```

If the admin badge is stuck on *Reconnecting*, the most common causes are:
the `user_role` claim isn't in the token (step 1.2), the admin user lacks
`role: "admin"` metadata (step 1.3), or the Clerk provider domain in Supabase
is wrong (step 2.1).
