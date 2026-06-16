# Courier Delivery Integration (Porter)

Last-mile courier dispatch for delivery orders via **Porter** (porter.in),
behind a small provider-neutral layer. Pickup orders are never dispatched.

## How it works

1. **Checkout** → `POST /api/delivery/quote` returns Porter's live fare and the
   order summary shows it.
2. **Order creation** (`/api/orders/create`) re-quotes **authoritatively**, sets
   `delivery_fee`, and bakes it into the Razorpay total. Saves the dropoff
   coordinates in the signed draft.
3. **Confirm** (`/api/orders/confirm`) persists `delivery_provider`,
   `courier_fee`, and dropoff coordinates onto the order.
4. **Dispatch** — admin marks an order **Ready** (`out_for_delivery`) →
   `/api/admin/orders/update` creates the Porter order and stores
   `courier_order_id` + `courier_tracking_url`.
5. **Webhooks** → `/api/porter/webhook` advances order status on Porter's
   events (accepted, live, ended, reopened, cancelled).

## Porter specifics (from porter.in/api-integrations)

- API books **2-wheeler** orders only; **prepaid only** (no COD) — fine, the app
  charges via Razorpay before dispatch.
- **Geo-coordinates are required** for pickup and drop. The app already captures
  the customer's lat/lng at checkout and the store's coords come from env.
- One pickup + one drop per order. Get Quote also validates serviceability.
- Create Order returns a `tracking_url` (also SMS'd to sender + receiver).

## Setup

### 1. Get Porter API access

Request API credentials via the form at <https://porter.in/api-integrations>.
Porter shares the full API spec (a Postman collection) on onboarding. **Verify
the exact endpoint paths and request fields against that spec** — this client
follows Porter's documented partner-API structure, and the base URL, auth
header, and fare unit are configurable via env if anything differs.

### 2. Run migrations

Apply in the Supabase SQL editor (in order):
- `supabase/migrations/0001_uber_direct.sql`
- `supabase/migrations/0002_courier_provider.sql` (the provider-neutral columns
  the app uses: `delivery_provider`, `courier_order_id`, `courier_tracking_url`,
  `courier_status`, `courier_fee`, `courier_quote_id`).

### 3. Environment variables

| Variable | Notes |
|---|---|
| `PORTER_TEST_MODE` | `true` = UAT `pfe-apigw-uat.porter.in`; `false` = prod `pfe-apigw.porter.in` |
| `PORTER_API_KEY` | the `X-API-KEY` value from Porter |
| `PORTER_WEBHOOK_SECRET` | optional — only if Porter gives you a signing secret |
| `PORTER_PICKUP_ADDRESS` / `_CITY` / `_STATE` / `_PINCODE` | store address parts |
| `PORTER_PICKUP_PHONE` | store phone, 10-digit |
| `PORTER_PICKUP_LATITUDE` / `_LONGITUDE` | store coordinates (prefilled) |
| `PORTER_API_BASE` | optional base-URL override |
| `PORTER_FARE_IN_PAISE` | optional; `true` (default) treats fares as paise |

### 4. Configure the webhook

In your Porter dashboard set the webhook/callback URL to:

```
https://<your-domain>/api/porter/webhook
```

(Localhost won't work — use your deployed domain or an ngrok tunnel.)

## Testing in UAT

Build against `PORTER_TEST_MODE=true` (UAT), then flip to production once it
works. Place a delivery order, mark it **Ready** in admin, and confirm a
`courier_order_id` + `tracking_url` get stored and the status advances via the
webhook. If Porter is unconfigured or a quote fails, the app falls back to a ₹0
delivery fee and skips dispatch — orders still go through.

## Files

- `src/lib/delivery/types.ts` — provider interface
- `src/lib/delivery/porter.ts` — Porter client (quote, create, track, cancel, webhook)
- `src/lib/delivery/index.ts` — provider selector
- `src/lib/dispatchDelivery.ts` — dispatches a stored order via the active provider
- `src/app/api/delivery/quote/route.ts` — checkout fee quote
- `src/app/api/porter/webhook/route.ts` — Porter status webhook
- `src/app/api/orders/{create,confirm}/route.ts` — authoritative fee + persistence
- `src/app/api/admin/orders/update/route.ts` — dispatch on "Ready"
- `supabase/migrations/0002_courier_provider.sql` — provider-neutral columns
