/**
 * Pidge last-mile delivery API client.
 *
 * Auth: Bearer token — PIDGE_PASSWORD is used directly as the Bearer token.
 * Base URL: https://api.pidge.in/v1.0/store/channel/vendor  ("vendor" is a literal path segment)
 * Channel name ("API") goes in the request body, not the URL.
 *
 * Environment variables:
 *   PIDGE_PASSWORD         — Bearer token (from Pidge dashboard → Channel Integration)
 *   PIDGE_CHANNEL_NAME     — Channel name you set when generating the token (default: "API")
 *   PIDGE_PICKUP_NAME      — Store name
 *   PIDGE_PICKUP_PHONE     — Store phone
 *   PIDGE_PICKUP_ADDRESS   — Store street address
 *   PIDGE_PICKUP_CITY      — Store city
 *   PIDGE_PICKUP_PINCODE   — Store PIN code
 *   STORE_LATITUDE         — Store latitude
 *   STORE_LONGITUDE        — Store longitude
 *   PIDGE_WEBHOOK_SECRET   — Auth token Pidge sends in webhook Authorization header
 */

const PIDGE_BASE = 'https://api.pidge.in/v1.0/store/channel/vendor'
const PIDGE_TOKEN = (process.env.PIDGE_PASSWORD || '').trim()
const PIDGE_CHANNEL = (process.env.PIDGE_CHANNEL_NAME || 'API').trim()

const STORE_NAME    = process.env.PIDGE_PICKUP_NAME    || 'Wrappy'
const STORE_PHONE   = process.env.PIDGE_PICKUP_PHONE   || ''
const STORE_ADDRESS = process.env.PIDGE_PICKUP_ADDRESS || ''
const STORE_CITY    = process.env.PIDGE_PICKUP_CITY    || 'Hyderabad'
const STORE_PINCODE = process.env.PIDGE_PICKUP_PINCODE || ''
const STORE_LAT     = Number(process.env.STORE_LATITUDE  || '0')
const STORE_LNG     = Number(process.env.STORE_LONGITUDE || '0')

function pidgeHeaders(): Record<string, string> {
  if (!PIDGE_TOKEN) throw new Error('PIDGE_PASSWORD (bearer token) is not set')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${PIDGE_TOKEN}`,
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

type PidgeAddress = {
  address_line_1: string
  address_line_2?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  latitude?: number
  longitude?: number
}

type PidgePersonDetail = {
  address: PidgeAddress
  name: string
  mobile: string
  email?: string
}

type PidgePackage = {
  label?: string
  quantity: number
  dead_weight: number   // kg
  length?: number       // cm
  breadth?: number      // cm
  height?: number       // cm
}

type PidgeTrip = {
  source_order_id: string
  receiver_detail: PidgePersonDetail
  packages: PidgePackage[]
  bill_amount: number
  cod_amount: number
  order_category?: 'food' | 'parcel'
}

type PidgeCreatePayload = {
  channel: string
  sender_detail: PidgePersonDetail
  poc_detail?: { name: string; mobile: string }
  trips: PidgeTrip[]
}

export type PidgeCreateResult = {
  pidgeId: string
}

export type PidgeOrderStatus = {
  id: string
  status: string
  fulfillment?: {
    status: string
    logs?: Array<{ status: string; timestamp: string }>
    rider?: { id: string; name: string; mobile: string }
  }
  [key: string]: unknown
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Create a Pidge delivery order when the admin marks an order "out for delivery".
 * Returns { pidgeId } which should be saved to the order for tracking.
 */
export async function createPidgeOrder(params: {
  orderId: string
  customerName: string
  customerPhone: string
  deliveryAddress: string
  deliveryLat?: number | null
  deliveryLng?: number | null
  billAmount: number
  itemCount?: number
}): Promise<PidgeCreateResult> {
  const weightKg = Math.max(0.3, (params.itemCount ?? 1) * 0.3)

  const payload: PidgeCreatePayload = {
    channel: PIDGE_CHANNEL,
    sender_detail: {
      address: {
        address_line_1: STORE_ADDRESS,
        city: STORE_CITY,
        state: 'Telangana',
        country: 'India',
        pincode: STORE_PINCODE,
        ...(STORE_LAT && STORE_LNG ? { latitude: STORE_LAT, longitude: STORE_LNG } : {}),
      },
      name: STORE_NAME,
      mobile: STORE_PHONE,
    },
    poc_detail: {
      name: STORE_NAME,
      mobile: STORE_PHONE,
    },
    trips: [
      {
        source_order_id: params.orderId,
        receiver_detail: {
          address: {
            address_line_1: params.deliveryAddress,
            ...(params.deliveryLat && params.deliveryLng
              ? { latitude: params.deliveryLat, longitude: params.deliveryLng }
              : {}),
          },
          name: params.customerName || 'Customer',
          mobile: params.customerPhone,
        },
        packages: [
          {
            label: `Wrappy #${params.orderId.slice(0, 8)}`,
            quantity: 1,
            dead_weight: weightKg,
            length: 25,
            breadth: 20,
            height: 15,
          },
        ],
        bill_amount: Math.round(params.billAmount),
        cod_amount: 0,
        order_category: 'food',
      },
    ],
  }

  const res = await fetch(`${PIDGE_BASE}/order`, {
    method: 'POST',
    headers: pidgeHeaders(),
    body: JSON.stringify(payload),
  })

  const json = await res.json() as { data?: Record<string, string>; message?: string }

  if (!res.ok || !json.data) {
    throw new Error(`Pidge ${res.status}: ${json.message || JSON.stringify(json)}`)
  }

  // Response: { data: { [source_order_id]: pidge_id } }
  const pidgeId =
    json.data[params.orderId] ??
    Object.values(json.data)[0] ??
    ''

  if (!pidgeId) throw new Error('Pidge returned no order ID in response')

  return { pidgeId }
}

/**
 * Fetch current status of a Pidge order by its Pidge-assigned ID.
 */
export async function getPidgeOrderStatus(pidgeId: string): Promise<PidgeOrderStatus> {
  const res = await fetch(`${PIDGE_BASE}/order/${encodeURIComponent(pidgeId)}`, {
    headers: pidgeHeaders(),
  })

  const json = await res.json() as { data?: PidgeOrderStatus; message?: string }

  if (!res.ok || !json.data) {
    throw new Error(`Pidge GET ${res.status}: ${json.message || JSON.stringify(json)}`)
  }

  return json.data
}
