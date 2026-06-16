import crypto from 'crypto'
import type {
  AppOrderStatus,
  CreateDeliveryInput,
  Delivery,
  DeliveryProvider,
  ParsedWebhook,
  Quote,
  QuoteInput,
} from './types'

/**
 * Porter (porter.in) partner API client.
 *
 * Porter exposes its full API spec only to onboarded partners (a Postman
 * collection shared after you request credentials at porter.in/api-integrations).
 * This client follows Porter's documented partner-API structure; the base URL,
 * auth header, and a few field names are configurable via env so you can align
 * them with the exact spec Porter gives you without code changes.
 *
 * Key Porter facts (from porter.in/api-integrations):
 *  - 2-wheeler orders only via API; prepaid only (no COD).
 *  - Get Quote returns a live fare and also validates serviceability.
 *  - Geo-coordinates are required for pickup and drop.
 *  - One pickup + one drop per order.
 *  - Create Order returns a tracking_url.
 *  - Webhooks fire on: accepted, live, ended, reopened, cancelled.
 */

const TEST_MODE = String(process.env.PORTER_TEST_MODE || 'true').toLowerCase() === 'true'
const API_BASE = (
  process.env.PORTER_API_BASE ||
  (TEST_MODE ? 'https://pfe-apigw-uat.porter.in' : 'https://pfe-apigw.porter.in')
).replace(/\/+$/, '')

const API_KEY = process.env.PORTER_API_KEY || ''
const WEBHOOK_SECRET = process.env.PORTER_WEBHOOK_SECRET || ''
// Porter fares come in the smallest currency unit (paise) by default.
const FARE_IN_PAISE = String(process.env.PORTER_FARE_IN_PAISE || 'true').toLowerCase() === 'true'

const PICKUP = {
  name: process.env.PORTER_PICKUP_NAME || 'Wrappy',
  phone: process.env.PORTER_PICKUP_PHONE || '',
  street1: process.env.PORTER_PICKUP_ADDRESS || '',
  street2: process.env.PORTER_PICKUP_STREET2 || '',
  landmark: process.env.PORTER_PICKUP_LANDMARK || '',
  city: process.env.PORTER_PICKUP_CITY || '',
  state: process.env.PORTER_PICKUP_STATE || '',
  pincode: process.env.PORTER_PICKUP_PINCODE || '',
  country: process.env.PORTER_PICKUP_COUNTRY || 'India',
  lat: process.env.PORTER_PICKUP_LATITUDE,
  lng: process.env.PORTER_PICKUP_LONGITUDE,
}

function fareToRupees(raw: any): number {
  if (raw == null) return 0
  if (typeof raw === 'object') {
    const minor = Number(raw.minor_amount ?? raw.amount ?? raw.fare ?? 0)
    return FARE_IN_PAISE ? Math.round(minor) / 100 : minor
  }
  const n = Number(raw)
  return FARE_IN_PAISE ? Math.round(n) / 100 : n
}

function extractPincode(address: string): string | undefined {
  const m = String(address || '').match(/\b(\d{6})\b/)
  return m ? m[1] : undefined
}

async function porterFetch<T = any>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method || 'POST',
    headers: {
      'X-API-KEY': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
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
    const reason =
      parsed?.message || parsed?.error || parsed?.errors || text.slice(0, 300)
    const err = new Error(`porter_api_error_${res.status}: ${reason}`) as Error & {
      status?: number
      body?: unknown
    }
    err.status = res.status
    err.body = parsed
    throw err
  }

  return parsed as T
}

function pickupAddressBlock() {
  const block: Record<string, unknown> = {
    apartment_address: '',
    street_address1: PICKUP.street1,
    street_address2: PICKUP.street2,
    landmark: PICKUP.landmark,
    city: PICKUP.city,
    state: PICKUP.state,
    pincode: PICKUP.pincode || extractPincode(PICKUP.street1) || '',
    country: PICKUP.country,
    contact_details: {
      name: PICKUP.name,
      phone_number: PICKUP.phone,
    },
  }
  if (PICKUP.lat && PICKUP.lng) {
    block.lat = Number(PICKUP.lat)
    block.lng = Number(PICKUP.lng)
  }
  return block
}

function mapPorterStatus(status: string): AppOrderStatus | null {
  switch ((status || '').toLowerCase()) {
    case 'accepted':
    case 'live':
    case 'reopened':
      return 'out_for_delivery'
    case 'ended':
    case 'completed':
    case 'delivered':
      return 'delivered'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return null
  }
}

function pickVehicleFare(data: any): number {
  const vehicles = data?.vehicles || data?.quotes || data?.estimated_fare_details
  if (Array.isArray(vehicles)) {
    // Prefer a two-wheeler; fall back to the cheapest available.
    const twoWheeler = vehicles.find((v: any) =>
      /2.?wheel|two.?wheel|bike|moto/i.test(String(v?.type || v?.vehicle_type || ''))
    )
    const chosen =
      twoWheeler ||
      vehicles
        .slice()
        .sort((a: any, b: any) => fareToRupees(a?.fare ?? a) - fareToRupees(b?.fare ?? b))[0]
    return fareToRupees(chosen?.fare ?? chosen)
  }
  // Single fare object shape.
  return fareToRupees(data?.fare ?? data?.estimated_fare_details ?? data)
}

export const porterProvider: DeliveryProvider = {
  name: 'porter',

  isConfigured() {
    return Boolean(API_KEY)
  },

  isPickupConfigured() {
    return Boolean(PICKUP.street1 && PICKUP.phone && PICKUP.lat && PICKUP.lng)
  },

  async createQuote(input: QuoteInput): Promise<Quote> {
    if (!this.isPickupConfigured()) throw new Error('porter_pickup_not_configured')
    if (input.dropoffLatitude === undefined || input.dropoffLongitude === undefined) {
      // Porter requires coordinates to quote.
      throw new Error('porter_quote_requires_coordinates')
    }

    const data = await porterFetch<any>('/v1/get_quote', {
      method: 'POST',
      body: {
        pickup_details: { lat: Number(PICKUP.lat), lng: Number(PICKUP.lng) },
        drop_details: {
          lat: input.dropoffLatitude,
          lng: input.dropoffLongitude,
        },
        customer: {
          name: PICKUP.name,
          mobile: { country_code: '+91', number: input.dropoffPhoneNumber || PICKUP.phone },
        },
      },
    })

    return {
      quoteId: data?.quote_id != null ? String(data.quote_id) : null,
      feeRupees: pickVehicleFare(data),
      currency: 'INR',
    }
  },

  async createDelivery(input: CreateDeliveryInput): Promise<Delivery> {
    if (!this.isPickupConfigured()) throw new Error('porter_pickup_not_configured')

    const dropAddress: Record<string, unknown> = {
      apartment_address: '',
      street_address1: input.dropoffAddress,
      street_address2: '',
      landmark: '',
      city: PICKUP.city,
      state: PICKUP.state,
      pincode: extractPincode(input.dropoffAddress) || '',
      country: PICKUP.country,
      contact_details: {
        name: input.dropoffName,
        phone_number: input.dropoffPhoneNumber,
      },
    }
    if (input.dropoffLatitude !== undefined && input.dropoffLongitude !== undefined) {
      dropAddress.lat = input.dropoffLatitude
      dropAddress.lng = input.dropoffLongitude
    }

    const body: Record<string, unknown> = {
      request_id: String(input.orderId),
      pickup_details: { address: pickupAddressBlock() },
      drop_details: { address: dropAddress },
    }
    if (input.dropoffNotes) {
      body.delivery_instructions = {
        instructions_list: [{ type: 'text', data: String(input.dropoffNotes).slice(0, 200) }],
      }
    }

    const data = await porterFetch<any>('/v1/orders/create', { method: 'POST', body })

    const fee = data?.estimated_fare_details
      ? fareToRupees(data.estimated_fare_details)
      : undefined
    return {
      id: data?.order_id != null ? String(data.order_id) : '',
      status: data?.status || 'created',
      trackingUrl: data?.tracking_url || undefined,
      feeRupees: fee,
      currency: 'INR',
      raw: data,
    }
  },

  async getDelivery(id: string): Promise<Delivery> {
    const data = await porterFetch<any>(`/v1/orders/${encodeURIComponent(id)}`, {
      method: 'GET',
    })
    return {
      id: data?.order_id != null ? String(data.order_id) : id,
      status: data?.status || '',
      trackingUrl: data?.tracking_url || undefined,
      feeRupees: data?.fare_details ? fareToRupees(data.fare_details) : undefined,
      currency: 'INR',
      raw: data,
    }
  },

  async cancelDelivery(id: string): Promise<Delivery> {
    const data = await porterFetch<any>(`/v1/orders/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: {},
    })
    return {
      id,
      status: data?.status || 'cancelled',
      trackingUrl: data?.tracking_url || undefined,
      raw: data,
    }
  },

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    // Porter does not document a signed-webhook scheme for all accounts. If a
    // shared secret is configured, verify it (HMAC-SHA256 hex in
    // x-porter-signature); otherwise accept and rely on order_id lookup.
    if (!WEBHOOK_SECRET) return true
    const signature = headers.get('x-porter-signature') || headers.get('x-signature') || ''
    if (!signature) return false
    const expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody, 'utf8')
      .digest('hex')
    const a = new Uint8Array(Buffer.from(expected))
    const b = new Uint8Array(Buffer.from(signature.trim()))
    if (a.length !== b.length) return false
    try {
      return crypto.timingSafeEqual(a, b)
    } catch {
      return false
    }
  },

  parseWebhook(event: any): ParsedWebhook {
    const data = event?.data || event?.order || event || {}
    const rawStatus = data?.status || event?.status || event?.event_type || ''
    return {
      deliveryId: data?.order_id != null ? String(data.order_id) : undefined,
      externalId: data?.request_id != null ? String(data.request_id) : undefined,
      rawStatus,
      mappedStatus: mapPorterStatus(rawStatus),
      trackingUrl: data?.tracking_url || undefined,
    }
  },
}
