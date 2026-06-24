/**
 * Pidge last-mile delivery API client.
 *
 * Environment variables required:
 *   PIDGE_USERNAME         — Username from Pidge dashboard → Settings → Channel Integration
 *   PIDGE_PASSWORD         — Password/token from the same screen (Basic Auth)
 *   PIDGE_API_BASE_URL     — (optional) defaults to https://apiv2.pidge.in
 *
 * Store pickup details:
 *   PIDGE_PICKUP_NAME      — Store / restaurant name
 *   PIDGE_PICKUP_PHONE     — Store contact phone
 *   PIDGE_PICKUP_ADDRESS   — Street address
 *   PIDGE_PICKUP_CITY      — City
 *   PIDGE_PICKUP_PINCODE   — PIN code
 *   STORE_LATITUDE         — Latitude  (also used for delivery fee quoting)
 *   STORE_LONGITUDE        — Longitude
 *
 * Webhook (optional):
 *   PIDGE_WEBHOOK_SECRET   — Shared secret Pidge sends in Authorization header
 */

const PIDGE_API_BASE = (process.env.PIDGE_API_BASE_URL || 'https://apiv2.pidge.in').replace(/\/$/, '')
const PIDGE_USERNAME = process.env.PIDGE_USERNAME || ''
const PIDGE_PASSWORD = process.env.PIDGE_PASSWORD || ''

export type PidgeDropInfo = {
  name: string
  phone: string
  address: string
  city?: string
  pincode?: string
  latitude?: number
  longitude?: number
}

export type PidgePackageInfo = {
  dead_weight?: number   // kg
  breadth?: number       // cm
  height?: number        // cm
  length?: number        // cm
  package_description?: string
  invoice_value?: number // INR
}

export type PidgeCreateOrderPayload = {
  /** Your internal order ID — Pidge echoes this in webhooks as channel_order_id */
  channel_order_id: string
  pickup: PidgeDropInfo
  drop: PidgeDropInfo
  package?: PidgePackageInfo
  payment_mode?: 'prepaid' | 'cod'
}

export type PidgeOrderResponse = {
  order_id?: string
  status?: string
  message?: string
  [key: string]: unknown
}

function pidgeHeaders(): Record<string, string> {
  if (!PIDGE_USERNAME || !PIDGE_PASSWORD) {
    throw new Error('PIDGE_USERNAME and PIDGE_PASSWORD must be set')
  }
  const basic = Buffer.from(`${PIDGE_USERNAME}:${PIDGE_PASSWORD}`).toString('base64')
  return {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Create a new delivery order with Pidge.
 * Returns the Pidge response (contains order_id used for tracking).
 * Throws on API or network errors.
 */
export async function createPidgeOrder(
  payload: PidgeCreateOrderPayload
): Promise<PidgeOrderResponse> {
  if (!PIDGE_USERNAME || !PIDGE_PASSWORD) {
    throw new Error('PIDGE_USERNAME / PIDGE_PASSWORD are not set')
  }

  const res = await fetch(`${PIDGE_API_BASE}/order/create`, {
    method: 'POST',
    headers: pidgeHeaders(),
    body: JSON.stringify(payload),
  })

  const data = (await res.json()) as PidgeOrderResponse
  if (!res.ok) {
    throw new Error(
      String(data?.message || `Pidge API error ${res.status}`)
    )
  }
  return data
}

/**
 * Fetch status of an existing Pidge order.
 */
export async function getPidgeOrderStatus(
  pidgeOrderId: string
): Promise<PidgeOrderResponse> {
  if (!PIDGE_USERNAME || !PIDGE_PASSWORD) {
    throw new Error('PIDGE_USERNAME / PIDGE_PASSWORD are not set')
  }

  const res = await fetch(`${PIDGE_API_BASE}/order/${encodeURIComponent(pidgeOrderId)}`, {
    headers: { Authorization: `Bearer ${PIDGE_API_TOKEN}` },
  })

  const data = (await res.json()) as PidgeOrderResponse
  if (!res.ok) {
    throw new Error(
      String(data?.message || `Pidge API error ${res.status}`)
    )
  }
  return data
}

/**
 * Build the pickup location from env vars (your store).
 */
export function getStorePickupInfo(): PidgeDropInfo {
  return {
    name: process.env.PIDGE_PICKUP_NAME || 'Wrappy Store',
    phone: process.env.PIDGE_PICKUP_PHONE || '',
    address: process.env.PIDGE_PICKUP_ADDRESS || '',
    city: process.env.PIDGE_PICKUP_CITY || '',
    pincode: process.env.PIDGE_PICKUP_PINCODE || '',
    latitude: Number(process.env.STORE_LATITUDE) || undefined,
    longitude: Number(process.env.STORE_LONGITUDE) || undefined,
  }
}
