# Background order alerts — setup

This adds two always-on alert channels so you never miss an order, even when
no browser tab is open:

1. **Web Push** — a desktop/Android notification (with sound) fired the moment
   an order is placed, even if the browser is closed.
2. **WhatsApp** — a message to every active admin phone on every new order.

Both fire server-side from `/api/orders/confirm` the instant an order is
confirmed, so they do not depend on the realtime socket or any open tab.

---

## 1. Install the new dependency

```bash
npm install
```

(`web-push` and `@types/web-push` were added to `package.json`.)

## 2. Generate VAPID keys (one time)

VAPID keys identify your server to the browser push services. Generate a pair:

```bash
npx web-push generate-vapid-keys
```

It prints a **Public Key** and a **Private Key**.

## 3. Add environment variables

Add these to `.env.local` (and to your Vercel project's Environment Variables
for production):

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<the Public Key from step 2>
VAPID_PRIVATE_KEY=<the Private Key from step 2>
VAPID_SUBJECT=mailto:you@yourdomain.com
```

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is safe to expose (it ships to the browser).
- `VAPID_PRIVATE_KEY` is secret — never commit it or expose it client-side.
- `VAPID_SUBJECT` must be a `mailto:` or `https:` URL identifying you.

Restart `npm run dev` after editing env vars.

## 4. Run the database migration

In the Supabase SQL editor, run (also in `supabase/schema.sql`):

```sql
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_push_subscriptions_clerk_user_id
  on push_subscriptions (clerk_user_id);
```

## 5. (Optional) notification icon

The service worker references `/icon-192.png` for the notification icon. Drop a
192×192 PNG at `public/icon-192.png`. If absent, the browser uses a default.

## 6. WhatsApp template

New-order WhatsApp alerts reuse your existing approved admin template. To use a
dedicated one, create/approve it in Meta and set:

```
WHATSAPP_ADMIN_NEW_ORDER_TEMPLATE=<your_template_name>
```

If unset, it falls back to `WHATSAPP_ADMIN_UNACCEPTED_TEMPLATE` / `hello_world`.
Admin phones come from the `admin_phones` table (`is_active = true`), same as
your existing alerts.

---

## Enabling & testing

1. Open `/admin/orders`. In the header you'll see a **🔔 Enable alerts** chip.
   Click it and accept the browser permission prompt. It becomes **🔔 Alerts on**.
2. Place a test order through checkout. Within a second or two you should get:
   - a system notification ("🛎️ New order received …") even if the tab is in the
     background or closed, and
   - a WhatsApp message to each active admin phone.
3. Clicking the notification focuses (or opens) the admin orders page.

### Notes & limits

- **Desktop Chrome/Edge/Firefox and Android:** push works with the browser
  closed (the OS push service wakes the service worker).
- **iOS (iPhone/iPad):** Web Push only works if the site is installed as a PWA
  (open in Safari → Share → **Add to Home Screen**, then enable alerts from the
  installed app). This is an Apple restriction, not a bug.
- If a device's subscription expires, the server prunes it automatically on the
  next send (410/404 responses).
- For a kitchen tablet you also want the screen to stay awake — keep the orders
  tab foreground; the realtime feed's watchdog keeps that connection alive.
