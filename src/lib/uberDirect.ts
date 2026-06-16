import crypto from 'crypto'

/**
 * Uber Direct API client.
 *
 * Docs: https://developer.uber.com/docs/deliveries/overview
 * Auth: OAuth2 client-credentials, scope `eats.deliveries`, token cached ~30 days.
 *
 * All Uber money fields are in the smallest currency unit (paise for INR,
 * cents for USD). The rest of this app works in whole rupees, so helpers
 * below convert: rupees = uberMinor / 100, uberMinor = rupees * 100.
 */

const AUTH_URL = process.env.UBER_AUTH_URL || 'https://auth.uber.com/oauth/v2/token'
const API_BASE = (process.env.UBER_API_BASE || 'https://api.uber.com').replace(/\/+$/, '')
const CUSTOMER_ID = process.env.UBER_DIRECT_CUSTOMER_ID || ''
const CLIENT_ID = process.env.UBER_DIRECT_CLIENT_ID || ''
const CLIENT_SECRET = process.env.UBER_DIRECT_CLIENT_SECRET || ''
const WEBHOOK_SECRET = process.env.UBER_DIRECT_WEBHOOK_SECRET || ''
const SCOPE = process.env.UBER_DIRECT_SCOPE || 'eats.deliveries'

// In sandbox, send test_specifications so Uber simulates a courier automatically.
const TEST_MODE = String(process.env.UBER_DIRECT_TEST_MODE || 'true').toLowerCase() === 'true'

// Store / pickup details. These describe where the courier collects the order.
const PICKUP = {
  name: process.env.UBER_PICKUP_NAME || 'Wrappy',
  businessName: process.env.UBER_PICKUP_BUSINESS_NAME || process.env.UBER_PICKUP_NAME || 'Wrappy',
  address: process.env.UBER_PICKUP_ADDRESS || '',
  phone: process.env.UBER_PICKUP_PHONE || '',
  latitude: process.env.UBER_PICKUP_LATITUDE ? Number(process.env.UBER_PICKUP_LATITUDE) : undefined,
  longitude: process.env.UBER_PICKUP_LONGITUDE ? Number(process.env.UBER_PICKUP_LONGITUDE) : undefined,
  notes: process.env.UBER_PICKUP_NOTES || '',
} as const

export function isUberDirectConfigured(): boolean {
  return Boolean(CUSTOMER_ID && CLIENT_ID && CLIENT_SECRET)
}

export function isUberPickupConfigured(): boolean {
  return Boolean(PICKUP.address && PICKUP.phone)
}

export function uberMinorToRupees(minor: number): number {
  return Math.round(Number(minor || 0)) / 100
}

export function rupeesToUberMinor(rupees: number): number {
  return Math.round(Number(rupees || 0) * 100)
}

// ---------------------------------------------------------------------------
// Auth (cached access token)
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (!isUberDirectConfigured()) {
    throw new Error('uber_direct_not_configured')
  }

  // Reuse a cached token until 60s before expiry.
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.token
  }

  const form = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: SCOPE,
  })

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    cache: 'no-store',
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`uber_auth_failed_${res.status}: ${text.slice(0, 300)}`)
  }

  const data = JSON.parse(text) as { access_token: string; expires_in?: number }
  const expiresInMs = (Number(data.expires_in) || 2_592_000) * 1000
  cachedToken = { token: data.access_token, expiresAt: Date.now() + expiresInMs }
  return data.access_token
}

// ---------------------------------------------------------------------------
// Low-level request helper
// ---------------------------------------------------------------------------

async function uberFetch<T = any>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })

  const text = await res.text()
  let parsed: any = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }

  if (!res.ok) {
    const err = new Error(
      `uber_api_error_${res.status}: ${parsed?.message || parsed?.code || text.slice(0, 300)}`
    ) as Error & { status?: number; code?: string; metadata?: unknown }
    err.status = res.status
    err.code = parsed?.code
    err.metadata = parsed?.metadata
    throw err
  }

  return parsed as T
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export type UberQuoteInput = {
  dropoffAddress: string
  dropoffLatitude?: number
  dropoffLongitude?: number
  dropoffPhoneNumber?: string
  /** Order subtotal in rupees, used as manifest_total_value. */
  manifestTotalRupees?: number
  pickupReadyDt?: string
  pickupDeadlineDt?: string
}

export type UberQuote = {
  id: string
  fee: number // minor units (paise)
  currency: string
  feeRupees: number
  dropoffEta?: string
  durationMinutes?: number
  expiresAt?: string
}

export async function createQuote(input: UberQuoteInput): Promise<UberQuote> {
  if (!isUberPickupConfigured()) {
    throw new Error('uber_pickup_not_configured')
  }

  const body: Record<string, unknown> = {
    pickup_address: PICKUP.address,
    dropoff_address: input.dropoffAddress,
  }
  if (PICKUP.latitude !== undefined && PICKUP.longitude !== undefined) {
    body.pickup_latitude = PICKUP.latitude
    body.pickup_longitude = PICKUP.longitude
  }
  if (input.dropoffLatitude !== undefined && input.dropoffLongitude !== undefined) {
    body.dropoff_latitude = input.dropoffLatitude
    body.dropoff_longitude = input.dropoffLongitude
  }
  if (PICKUP.phone) body.pickup_phone_number = PICKUP.phone
  if (input.dropoffPhoneNumber) body.dropoff_phone_number = input.dropoffPhoneNumber
  if (input.manifestTotalRupees !== undefined) {
    body.manifest_total_value = rupeesToUberMinor(input.manifestTotalRupees)
  }
  if (input.pickupReadyDt) body.pickup_ready_dt = input.pickupReadyDt
  if (input.pickupDeadlineDt) body.pickup_deadline_dt = input.pickupDeadlineDt

  const data = await uberFetch<any>(
    `/v1/customers/${CUSTOMER_ID}/delivery_quotes`,
    { method: 'POST', body }
  )

  return {
    id: data.id,
    fee: Number(data.fee || 0),
    currency: data.currency || 'inr',
    feeRupees: uberMinorToRupees(Number(data.fee || 0)),
    dropoffEta: data.dropoff_eta,
    durationMinutes: data.duration,
    expiresAt: data.expires,
  }
}

// ---------------------------------------------------------------------------
// Create delivery
// ---------------------------------------------------------------------------

export type UberManifestItem = {
  name: string
  quantity: number
  price?: number // rupees; converted to minor units below
  size?: 'small' | 'medium' | 'large' | 'xlarge'
}

export type CreateDeliveryInput = {
  quoteId?: string
  dropoffName: string
  dropoffAddress: string
  dropoffPhoneNumber: string
  dropoffLatitude?: number
  dropoffLongitude?: number
  dropoffNotes?: string
  manifestReference?: string // your order id, shown to the courier
  manifestItems: UberManifestItem[]
  manifestTotalRupees?: number
  tipRupees?: number
}

export type UberDelivery = {
  id: string
  status: string
  trackingUrl?: string
  fee?: number
  feeRupees?: number
  currency?: string
  raw: any
}

export async function createDelivery(input: CreateDeliveryInput): Promise<UberDelivery> {
  if (!isUberPickupConfigured()) {
    throw new Error('uber_pickup_not_configured')
  }

  const body: Record<string, unknown> = {
    pickup_name: PICKUP.name,
    pickup_business_name: PICKUP.businessName,
    pickup_address: PICKUP.address,
    pickup_phone_number: PICKUP.phone,
    dropoff_name: input.dropoffName,
    dropoff_address: input.dropoffAddress,
    dropoff_phone_number: input.dropoffPhoneNumber,
    manifest_items: input.manifestItems.map((item) => ({
      name: item.name,
      quantity: Number(item.quantity || 1),
      size: item.size || 'small',
      ...(item.price !== undefined ? { price: rupeesToUberMinor(item.price) } : {}),
    })),
  }

  if (input.quoteId) body.quote_id = input.quoteId
  if (PICKUP.latitude !== undefined && PICKUP.longitude !== undefined) {
    body.pickup_latitude = PICKUP.latitude
    body.pickup_longitude = PICKUP.longitude
  }
  if (input.dropoffLatitude !== undefined && input.dropoffLongitude !== undefined) {
    body.dropoff_latitude = input.dropoffLatitude
    body.dropoff_longitude = input.dropoffLongitude
  }
  if (PICKUP.notes) body.pickup_notes = PICKUP.notes
  if (input.dropoffNotes) body.dropoff_notes = input.dropoffNotes
  if (input.manifestReference) body.manifest_reference = input.manifestReference
  if (input.manifestTotalRupees !== undefined) {
    body.manifest_total_value = rupeesToUberMinor(input.manifestTotalRupees)
  }
  if (input.tipRupees !== undefined) body.tip = rupeesToUberMinor(input.tipRupees)

  // Sandbox: ask Uber to auto-simulate the courier so statuses progress.
  if (TEST_MODE) {
    body.test_specifications = { robo_courier_specification: { mode: 'auto' } }
  }

  const data = await uberFetch<any>(
    `/v1/customers/${CUSTOMER_ID}/deliveries`,
    { method: 'POST', body }
  )

  return normalizeDelivery(data)
}

export async function getDelivery(deliveryId: string): Promise<UberDelivery> {
  const data = await uberFetch<any>(
    `/v1/customers/${CUSTOMER_ID}/deliveries/${deliveryId}`
  )
  return normalizeDelivery(data)
}

export async function cancelDelivery(deliveryId: string): Promise<UberDelivery> {
  const data = await uberFetch<any>(
    `/v1/customers/${CUSTOMER_ID}/deliveries/${deliveryId}/cancel`,
    { method: 'POST', body: {} }
  )
  return normalizeDelivery(data)
}

function normalizeDelivery(data: any): UberDelivery {
  const fee = data?.fee !== undefined ? Number(data.fee) : undefined
  return {
    id: data?.id,
    status: data?.status,
    trackingUrl: data?.tracking_url,
    fee,
    feeRupees: fee !== undefined ? uberMinorToRupees(fee) : undefined,
    currency: data?.currency,
    raw: data,
  }
}

// ---------------------------------------------------------------------------
// Status mapping (Uber delivery status -> app order status)
// ---------------------------------------------------------------------------

export type AppOrderStatus =
  | 'placed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'

/**
 * Maps an Uber delivery status to this app's order_status enum.
 * Returns null when the Uber status shouldn't change the order status.
 * Uber statuses: pending, pickup, pickup_complete, dropoff, delivered,
 * canceled, returned.
 */
export function mapUberStatusToOrderStatus(uberStatus: string): AppOrderStatus | null {
  switch ((uberStatus || '').toLowerCase()) {
    case 'pickup':
    case 'pickup_complete':
    case 'dropoff':
      return 'out_for_delivery'
    case 'delivered':
      return 'delivered'
    case 'canceled':
    case 'cancelled':
    case 'returned':
      return 'cancelled'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Uber signs webhook payloads with HMAC-SHA256 (hex) of the raw request body
 * using your webhook signing secret, sent in the `x-uber-signature` header.
 */
export function verifyUberWebhookSignature(rawBody: string, signature: string): boolean {
  if (!WEBHOOK_SECRET || !signature) return false
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex')
  const expectedBytes = new Uint8Array(Buffer.from(expected))
  const signatureBytes = new Uint8Array(Buffer.from(signature.trim()))
  if (expectedBytes.length !== signatureBytes.length) return false
  try {
    return crypto.timingSafeEqual(expectedBytes, signatureBytes)
  } catch {
    return false
  }
}
