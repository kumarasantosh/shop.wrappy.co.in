export type OrderType = 'delivery' | 'pickup'

const ORDER_TYPE_REGEX = /\[WRAPPY_ORDER_TYPE:(delivery|pickup)\]/i
const PICKUP_SLOT_REGEX = /\[WRAPPY_PICKUP_SLOT:([^\]]+)\]/i
const PICKUP_CODE_REGEX = /\[WRAPPY_PICKUP_CODE:(\d{4}|\d{6})\]/i
const DELIVERY_LAT_REGEX = /\[WRAPPY_DELIVERY_LAT:([-\d.]+)\]/i
const DELIVERY_LNG_REGEX = /\[WRAPPY_DELIVERY_LNG:([-\d.]+)\]/i
const PIDGE_ORDER_ID_REGEX = /\[WRAPPY_PIDGE_ORDER_ID:([^\]]+)\]/i

export function parseOrderMeta(instructions: string | null | undefined): {
  orderType: OrderType
  pickupSlot: string | null
  pickupCode: string | null
  deliveryLat: number | null
  deliveryLng: number | null
  pidgeOrderId: string | null
} {
  const source = String(instructions || '')
  const orderTypeMatch = source.match(ORDER_TYPE_REGEX)
  const pickupSlotMatch = source.match(PICKUP_SLOT_REGEX)
  const pickupCodeMatch = source.match(PICKUP_CODE_REGEX)
  const deliveryLatMatch = source.match(DELIVERY_LAT_REGEX)
  const deliveryLngMatch = source.match(DELIVERY_LNG_REGEX)
  const pidgeOrderIdMatch = source.match(PIDGE_ORDER_ID_REGEX)

  const orderType = (orderTypeMatch?.[1]?.toLowerCase() || 'delivery') as OrderType
  const pickupSlot = pickupSlotMatch?.[1] ? String(pickupSlotMatch[1]).trim() : null
  const pickupCode = pickupCodeMatch?.[1] ? String(pickupCodeMatch[1]).trim() : null
  const deliveryLatRaw = deliveryLatMatch?.[1] ? Number(deliveryLatMatch[1]) : null
  const deliveryLngRaw = deliveryLngMatch?.[1] ? Number(deliveryLngMatch[1]) : null
  const pidgeOrderId = pidgeOrderIdMatch?.[1] ? String(pidgeOrderIdMatch[1]).trim() : null

  return {
    orderType: orderType === 'pickup' ? 'pickup' : 'delivery',
    pickupSlot: pickupSlot || null,
    pickupCode: pickupCode || null,
    deliveryLat: deliveryLatRaw !== null && Number.isFinite(deliveryLatRaw) ? deliveryLatRaw : null,
    deliveryLng: deliveryLngRaw !== null && Number.isFinite(deliveryLngRaw) ? deliveryLngRaw : null,
    pidgeOrderId: pidgeOrderId || null,
  }
}

export function stripOrderMeta(instructions: string | null | undefined): string {
  return String(instructions || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('[WRAPPY_'))
    .join('\n')
    .trim()
}

export function appendOrderMeta(
  instructions: string | null | undefined,
  meta: {
    orderType: OrderType
    pickupSlot?: string | null
    pickupCode?: string | null
    deliveryLat?: number | null
    deliveryLng?: number | null
    pidgeOrderId?: string | null
  }
): string {
  const clean = stripOrderMeta(instructions)
  const lines: string[] = []
  if (clean) lines.push(clean)
  lines.push(`[WRAPPY_ORDER_TYPE:${meta.orderType}]`)
  if (meta.pickupSlot) {
    lines.push(`[WRAPPY_PICKUP_SLOT:${meta.pickupSlot}]`)
  }
  if (meta.pickupCode) {
    lines.push(`[WRAPPY_PICKUP_CODE:${meta.pickupCode}]`)
  }
  if (meta.deliveryLat != null && Number.isFinite(meta.deliveryLat)) {
    lines.push(`[WRAPPY_DELIVERY_LAT:${meta.deliveryLat}]`)
  }
  if (meta.deliveryLng != null && Number.isFinite(meta.deliveryLng)) {
    lines.push(`[WRAPPY_DELIVERY_LNG:${meta.deliveryLng}]`)
  }
  if (meta.pidgeOrderId) {
    lines.push(`[WRAPPY_PIDGE_ORDER_ID:${meta.pidgeOrderId}]`)
  }
  return lines.join('\n')
}

export function generatePickupVerificationCode() {
  const length = Math.random() < 0.5 ? 4 : 6
  const max = 10 ** length
  return String(Math.floor(Math.random() * max)).padStart(length, '0')
}
