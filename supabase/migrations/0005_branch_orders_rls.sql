-- Realtime / RLS access for branch admins & staff.
--
-- The admin Orders page receives orders live over Supabase Realtime, which is
-- gated by RLS on `orders`. The original policies only authorize:
--   • global admins  — Clerk token claim user_role = 'admin'
--   • customers       — their own orders (customer_clerk_id = sub)
--
-- Branch admins/staff are identified by their sign-in EMAIL in branch_members,
-- so they had no matching policy → the realtime socket could not authorize and
-- the page showed "Reconnecting" forever.
--
-- This migration adds a policy that lets an authenticated branch member read
-- (and therefore stream) ONLY the orders belonging to a branch they're a member
-- of. That both fixes the realtime connection and enforces per-store isolation
-- at the database layer.
--
-- PREREQUISITE (Clerk dashboard → Sessions → Customize session token):
-- the session token must include an `email` claim, e.g.
--   {
--     "user_role": "{{user.public_metadata.role}}",
--     "email":     "{{user.primary_email_address}}"
--   }
-- After editing, affected users must sign out/in so the new token carries it.
--
-- Apply in Supabase SQL editor. Safe to re-run.

alter table orders enable row level security;

drop policy if exists "orders branch member read" on orders;
create policy "orders branch member read"
  on orders for select
  to authenticated
  using (
    orders.branch_id is not null
    and exists (
      select 1
      from branch_members bm
      where bm.is_active
        and bm.branch_id = orders.branch_id
        and lower(bm.email) = lower(auth.jwt() ->> 'email')
    )
  );
