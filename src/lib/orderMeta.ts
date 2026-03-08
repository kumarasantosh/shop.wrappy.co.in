export type OrderType = 'delivery' | 'pickup'

const ORDER_TYPE_REGEX = /\[WRAPPY_ORDER_TYPE:(delivery|pickup)\]/i
const PICKUP_SLOT_REGEX = /\[WRAPPY_PICKUP_SLOT:([^\]]+)\]/i
const PICKUP_CODE_REGEX = /\[WRAPPY_PICKUP_CODE:(\d{4}|\d{6})\]/i

export function parseOrderMeta(instructions: string | null | undefined): {
  orderType: OrderType
  pickupSlot: string | null
  pickupCode: string | null
} {
  const source = String(instructions || '')
  const orderTypeMatch = source.match(ORDER_TYPE_REGEX)
  const pickupSlotMatch = source.match(PICKUP_SLOT_REGEX)
  const pickupCodeMatch = source.match(PICKUP_CODE_REGEX)

  const orderType = (orderTypeMatch?.[1]?.toLowerCase() || 'delivery') as OrderType
  const pickupSlot = pickupSlotMatch?.[1] ? String(pickupSlotMatch[1]).trim() : null
  const pickupCode = pickupCodeMatch?.[1] ? String(pickupCodeMatch[1]).trim() : null

  return {
    orderType: orderType === 'pickup' ? 'pickup' : 'delivery',
    pickupSlot: pickupSlot || null,
    pickupCode: pickupCode || null,
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
  return lines.join('\n')
}

export function generatePickupVerificationCode() {
  const length = Math.random() < 0.5 ? 4 : 6
  const max = 10 ** length
  return String(Math.floor(Math.random() * max)).padStart(length, '0')
}

