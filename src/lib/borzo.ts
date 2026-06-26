/**
 * Borzo Business API v1.6 — server-side client for Wrappy
 *
 * SECURITY: This file must only be imported inside server components or
 * route handlers. It reads BORZO_AUTH_TOKEN from env — never exposed to
 * the browser.
 *
 * Docs: https://borzodelivery.com/in/business-api/doc
 */

import crypto from 'crypto'

// ─── Config (from env — never hardcoded) ────────────────────────────────────

const BASE_URL =
  process.env.BORZO_BASE_URL ||
  'https://robotapitest-in.borzodelivery.com/api/business/1.6'

// ─── Custom error ────────────────────────────────────────────────────────────

export class BorzoError extends Error {
  public readonly errors: unknown
  public readonly raw: unknown

  constructor(errors: unknown, raw: unknown) {
    super(
      Array.isArray(errors)
        ? (errors as string[]).join(', ')
        : JSON.stringify(errors)
    )
    this.name = 'BorzoError'
    this.errors = errors
    this.raw = raw
  }
}

// ─── Core fetch wrapper ──────────────────────────────────────────────────────

async function borzoFetch<T>(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: object
): Promise<T> {
  const token = process.env.BORZO_AUTH_TOKEN
  if (!token) {
    throw new Error('BORZO_AUTH_TOKEN environment variable is not set')
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-DV-Auth-Token': token,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    // Always fetch fresh data — never serve from cache
    cache: 'no-store',
  })

  const json = (await res.json()) as Record<string, unknown>

  if (!json.is_successful) {
    throw new BorzoError(
      json.errors || json.warnings || ['unknown_error'],
      json
    )
  }

  return json as T
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type BorzoContactPerson = {
  name: string
  phone: string
}

export type BorzoPackage = {
  ware_code?: string | boolean
  items_count: number
  item_payment_amount?: number
  description?: string
}

export type BorzoPoint = {
  address: string
  latitude: number | string
  longitude: number | string
  contact_person: BorzoContactPerson
  client_order_id?: string
  note?: string
  /** COD: amount to collect at this drop-off point (string, e.g. "250.00") */
  taking_amount?: string
  /** COD: must be true on drop-off points that collect cash */
  is_cod_cash_voucher_required?: boolean
  packages?: BorzoPackage[]
  /** Standard orders only — leave unset for endofday orders */
  required_start_datetime?: string
  required_finish_datetime?: string
}

export type BorzoOrderParams = {
  /** 'standard' (default) or 'endofday' (exactly 2 points, no time windows) */
  type?: 'standard' | 'endofday'
  matter?: string
  vehicle_type_id?: number // 8 = bike (India default)
  total_weight_kg?: number | string
  insurance_amount?: number | string
  is_client_notification_enabled?: boolean
  is_contact_person_notification_enabled?: boolean
  /** index 0 = pickup, index 1+ = drop-offs; minimum 2 points */
  points: BorzoPoint[]
}

// ─── API methods ─────────────────────────────────────────────────────────────

/**
 * CALCULATE — get price + warnings before committing.
 * Returns an order preview even when there are warnings; warnings do NOT block
 * the price. Only use the result to show the user the cost.
 */
export function calculateOrder(params: BorzoOrderParams) {
  return borzoFetch<Record<string, unknown>>('POST', '/calculate-order', params)
}

/**
 * CREATE — place the order. All errors at this stage are critical.
 * On success: store order_id and per-point tracking_url(s).
 */
export function createOrder(params: BorzoOrderParams) {
  return borzoFetch<Record<string, unknown>>('POST', '/create-order', params)
}

/**
 * CANCEL — cancel an order.
 * Only allowed while status is: new | available | active | delayed
 * and no courier has visited any address yet.
 */
export function cancelOrder(orderId: number) {
  return borzoFetch<Record<string, unknown>>('POST', '/cancel-order', {
    order_id: orderId,
  })
}

/**
 * ORDERS — fetch order details for status polling.
 * Pass an order_id (or array) to filter; omit to list all account orders.
 */
export function getOrders(orderIds?: number | number[]) {
  if (orderIds === undefined) {
    // GET with no filter returns all orders (sorted by order_id desc)
    return borzoFetch<Record<string, unknown>>('GET', '/orders')
  }
  const ids = (Array.isArray(orderIds) ? orderIds : [orderIds]).map(Number)
  return borzoFetch<Record<string, unknown>>('POST', '/orders', {
    order_ids: ids,
  })
}

/**
 * COURIER — get courier info + live GPS location.
 * Live location is only returned while order status is 'active'.
 */
export function getCourier(orderId: number) {
  return borzoFetch<Record<string, unknown>>(
    'GET',
    `/courier?order_id=${orderId}`
  )
}

/**
 * CLIENT — get account profile and allowed payment methods.
 */
export function getClient() {
  return borzoFetch<Record<string, unknown>>('GET', '/client')
}

// ─── Callback helpers ─────────────────────────────────────────────────────────

/**
 * Verify the HMAC-SHA256 signature Borzo sends in the X-DV-Signature header.
 * Uses BORZO_CALLBACK_TOKEN from env.
 *
 * @param rawBody   Raw request body string (before JSON.parse)
 * @param signature Value of the X-DV-Signature header
 */
export function verifyCallbackSignature(
  rawBody: string,
  signature: string
): boolean {
  const token = process.env.BORZO_CALLBACK_TOKEN
  if (!token) return false
  const expected = crypto
    .createHmac('sha256', token)
    .update(rawBody)
    .digest('hex')
  return expected === signature
}

/**
 * Parse a Borzo callback body into a typed event.
 * Borzo sends two distinct shapes:
 *   - Order callback:    { order: { order_id, status, ... } }
 *   - Delivery callback: { delivery: { delivery_id, status, ... } }
 */
export function parseCallback(body: Record<string, unknown>) {
  if (body.order) return { type: 'order' as const, data: body.order }
  if (body.delivery) return { type: 'delivery' as const, data: body.delivery }
  return { type: 'unknown' as const, data: body }
}

// ─── Point builder helper ────────────────────────────────────────────────────

type SimplePoint = {
  address: string
  latitude: number | string
  longitude: number | string
  name: string
  phone: string
  note?: string
  client_order_id?: string
}

type CODOptions = {
  enabled: boolean
  taking_amount?: string
}

/**
 * Build a Borzo-compatible points array from Wrappy-style pickup/dropoff data.
 *
 * pickup  — index 0 (store location)
 * dropoffs — index 1+ (customer addresses); COD is applied to the last dropoff
 */
export function buildPoints(
  pickup: SimplePoint,
  dropoffs: SimplePoint[],
  cod?: CODOptions
): BorzoPoint[] {
  const toPoint = (p: SimplePoint, isCOD = false): BorzoPoint => ({
    address: p.address,
    latitude: p.latitude,
    longitude: p.longitude,
    contact_person: { name: p.name, phone: p.phone },
    ...(p.client_order_id ? { client_order_id: String(p.client_order_id) } : {}),
    ...(p.note ? { note: p.note } : {}),
    ...(isCOD && cod?.taking_amount
      ? {
          taking_amount: String(cod.taking_amount),
          is_cod_cash_voucher_required: true,
        }
      : {}),
  })

  const lastIdx = dropoffs.length - 1
  return [
    toPoint(pickup),
    ...dropoffs.map((d, i) =>
      toPoint(d, Boolean(cod?.enabled) && i === lastIdx)
    ),
  ]
}
