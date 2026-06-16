# Uber Direct Integration

Last-mile courier dispatch via [Uber Direct](https://direct.uber.com) for delivery
orders. Pickup orders are unaffected.

## How it works

1. **Checkout** — when a customer enters an in-range delivery address, the app
   calls `POST /api/uber/quote` and shows the live Uber delivery fee in the
   order summary.
2. **Order creation** (`POST /api/orders/create`) — the server re-quotes Uber
   **authoritatively**, sets `delivery_fee` to the real amount, and bakes it
   into the Razorpay total so the customer pays the correct price. The quote id
   and dropoff coordinates are saved in the signed checkout draft.
3. **Order confirm** (`POST /api/orders/confirm`) — persists `uber_quote_id`,
   `uber_fee`, and dropoff coordinates onto the order.
4. **Dispatch** — when an admin marks an order **Ready** (`out_for_delivery`)
   in the admin panel, `POST /api/admin/orders/update` creates the Uber
   delivery and stores `uber_delivery_id` + `uber_tracking_url`.
5. **Webhooks** (`POST /api/uber/webhook`) — Uber pushes status updates; the
   order status advances automatically (`out_for_delivery` → `delivered`, etc.).

## One-time setup

### 1. Run the database migration

Apply `supabase/migrations/0001_uber_direct.sql` (adds `uber_*` and
`dropoff_*` columns to `orders`). In the Supabase SQL editor, paste and run it,
or use the CLI.

### 2. Fill in environment variables

In `.env.local` (and your production host), set the values from the Uber Direct
dashboard's **Developer** tab:

| Variable | Where to find it |
|---|---|
| `UBER_DIRECT_CUSTOMER_ID` | The UUID in your deliveries URL: `.../customers/<THIS>/deliveries` |
| `UBER_DIRECT_CLIENT_ID` | Developer tab |
| `UBER_DIRECT_CLIENT_SECRET` | Developer tab (treat as a password) |
| `UBER_DIRECT_WEBHOOK_SECRET` | Webhooks settings — used to verify incoming events |
| `UBER_DIRECT_TEST_MODE` | `true` for sandbox (simulated courier), `false` for live |
| `UBER_PICKUP_ADDRESS` | Your store's full single-line address |
| `UBER_PICKUP_PHONE` | Store phone in E.164, e.g. `+919999999999` |
| `UBER_PICKUP_LATITUDE` / `UBER_PICKUP_LONGITUDE` | Store coordinates (prefilled from `deliveryRadius.ts`) |

### 3. Configure the webhook

In the Uber Direct dashboard set the webhook URL to:

```
https://<your-domain>/api/uber/webhook
```

Copy the signing secret into `UBER_DIRECT_WEBHOOK_SECRET`.

## Testing in sandbox

With `UBER_DIRECT_TEST_MODE=true`, created deliveries include a robo-courier
specification so Uber simulates pickup → dropoff and fires the same webhooks a
real courier would. Place a delivery order, mark it **Ready** in the admin
panel, and watch the order status progress to `delivered`.

## Money units

Uber returns fees in the smallest currency unit (paise for INR). The app works
in whole rupees, so `uberDirect.ts` converts: `rupees = minor / 100`.

## ⚠️ Coverage note

Uber Direct operates couriers in the US, Canada, Australia, Mexico, Japan, and
parts of Europe — **not India** as of this writing. Sandbox mode works anywhere
for end-to-end testing, but **live dispatch requires a city Uber Direct serves**.
Confirm coverage for your store's location with Uber before switching
`UBER_DIRECT_TEST_MODE=false`. If Uber isn't configured or a quote fails, the
app safely falls back to a ₹0 delivery fee and skips dispatch — orders still go
through.

## Files

- `src/lib/uberDirect.ts` — API client (auth, quote, create/get/cancel, webhook verify)
- `src/lib/uberDispatch.ts` — server helper that dispatches a stored order
- `src/app/api/uber/quote/route.ts` — checkout fee quote
- `src/app/api/uber/webhook/route.ts` — status webhook receiver
- `src/app/api/orders/create/route.ts` — authoritative fee at checkout
- `src/app/api/orders/confirm/route.ts` — persists Uber fields
- `src/app/api/admin/orders/update/route.ts` — dispatch on "Ready"
- `supabase/migrations/0001_uber_direct.sql` — schema changes
