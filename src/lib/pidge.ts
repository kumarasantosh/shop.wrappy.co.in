/**
 * Pidge last-mile delivery API client.
 *
 * Auth flow: POST /vendor/login with username+password → get JWT → use as Bearer token.
 * The JWT is cached in module scope for the lifetime of a serverless invocation.
 * On 401, the client re-logs in once and retries.
 *
 * Base URL: https://api.pidge.in/v1.0/store/channel/vendor  ("vendor" is a literal path segment)
 * Channel name ("API") goes in the request body, not the URL.
 *
 * Environment variables:
 *   PIDGE_USERNAME     — Username from Pidge dashboard → Channel Integration
 *   PIDGE_PASSWORD     — Password from Pidge dashboard → Channel Integration
 *   PIDGE_CHANNEL_NAME — Channel name set when generating token (default: "API")
 *   PIDGE_PICKUP_NAME  — Store name
 *   PIDGE_PICKUP_PHONE — Store phone (10 digits)
 *   PIDGE_PICKUP_ADDRESS — Store street address
 *   PIDGE_PICKUP_CITY  — Store city
 *   PIDGE_PICKUP_PINCODE — Store PIN code
 *   STORE_LATITUDE     — Store latitude
 *   STORE_LONGITUDE    — Store longitude
 *   PIDGE_WEBHOOK_SECRET — Auth token Pidge sends in webhook Authorization header
 */

const PIDGE_BASE     = 'https://api.pidge.in/v1.0/store/channel/vendor'
const PIDGE_USERNAME = (process.env.PIDGE_USERNAME || '').trim()
const PIDGE_PASSWORD = (process.env.PIDGE_PASSWORD || '').trim()
const PIDGE_CHANNEL  = (process.env.PIDGE_CHANNEL_NAME || 'API').trim()

const STORE_NAME    = process.env.PIDGE_PICKUP_NAME    || 'Wrappy'
const STORE_PHONE   = process.env.PIDGE_PICKUP_PHONE   || ''
const STORE_ADDRESS = process.env.PIDGE_PICKUP_ADDRESS || ''
const STORE_CITY    = process.env.PIDGE_PICKUP_CITY    || 'Hyderabad'
const STORE_PINCODE = process.env.PIDGE_PICKUP_PINCODE || ''
const STORE_LAT     = Number(process.env.STORE_LATITUDE  || '0')
const STORE_LNG     = Number(process.env.STORE_LONGITUDE || '0')

// ── Token cache (module-level, valid for the lifetime of a serverless instance) ──
let _cachedToken: string | null = null
let _tokenExpiresAt = 0  // epoch ms

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && _cachedToken && Date.now() < _tokenExpiresAt) {
    return _cachedToken
  }

  if (!PIDGE_USERNAME || !PIDGE_PASSWORD) {
    throw new Error('PIDGE_USERNAME and PIDGE_PASSWORD must be set')
  }

  const res = await fetch(`${PIDGE_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: PIDGE_USERNAME, password: PIDGE_PASSWORD }),
  })

  let json: Record<string, unknown>
  try {
    json = await res.json()
  } catch {
    throw new Error(`Pidge login ${res.status}: non-JSON response`)
  }

  // Log full login response (redact token value) so we can debug field names
  const safeLog = JSON.stringify(json, (k, v) =>
    typeof v === 'string' && v.length > 10 ? v.slice(0, 6) + '…' : v
  )
  console.log(`[Pidge] Login response ${res.status}:`, safeLog)

  // Try common token field names
  const nested = (json.data as Record<string, unknown> | undefined) ?? {}
  const token =
    (nested.token as string) ||
    (nested.access_token as string) ||
    (nested.jwt as string) ||
    (json.token as string) ||
    (json.access_token as string) ||
    ''

  if (!res.ok || !token) {
    throw new Error(
      `Pidge login failed ${res.status}: ${(json.message as string) || JSON.stringify(json)}`
    )
  }

  _cachedToken = token
  // Cache for 23 hours (JWTs are typically 24h)
  _tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000
  return token
}

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

type PidgeAddress = {
  address_line_1: string
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
}

type PidgePackage = {
  label?: string
  quantity: number
  dead_weight: number
  length?: number
  breadth?: number
  height?: number
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

export type PidgeCreateResult = { pidgeId: string }

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

// ── API helpers ──────────────────────────────────────────────────────────────

async function pidgeFetch(
  url: string,
  options: RequestInit,
  retry = true
): Promise<Response> {
  const token = await getToken()
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers as Record<string, string> || {}) },
  })

  // On 401 refresh token once and retry
  if (res.status === 401 && retry) {
    _cachedToken = null
    return pidgeFetch(url, options, false)
  }

  return res
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a Pidge delivery order when admin marks an order "out for delivery".
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
    poc_detail: { name: STORE_NAME, mobile: STORE_PHONE },
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

  const res = await pidgeFetch(`${PIDGE_BASE}/order`, {
    method: 'POST',
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

  console.log(`[Pidge] Order created: source=${params.orderId} pidge_id=${pidgeId}`)
  return { pidgeId }
}

/**
 * Fetch current status of a Pidge order by its Pidge-assigned ID.
 */
export async function getPidgeOrderStatus(pidgeId: string): Promise<PidgeOrderStatus> {
  const res = await pidgeFetch(`${PIDGE_BASE}/order/${encodeURIComponent(pidgeId)}`, {
    method: 'GET',
  })

  const json = await res.json() as { data?: PidgeOrderStatus; message?: string }

  if (!res.ok || !json.data) {
    throw new Error(`Pidge GET ${res.status}: ${json.message || JSON.stringify(json)}`)
  }

  return json.data
}
