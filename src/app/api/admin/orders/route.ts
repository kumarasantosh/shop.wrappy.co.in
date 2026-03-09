import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/admin'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { parseOrderMeta } from '../../../../lib/orderMeta'
import {
  notifyAdminsPickupPendingOrder,
  notifyAdminsUnacceptedOrder,
} from '../../../../lib/whatsapp'

const UNACCEPTED_ALERT_MARKER = 'WRAPPY_ALERT_UNACCEPTED_AT'
const PICKUP_PENDING_ALERT_MARKER = 'WRAPPY_ALERT_PICKUP_PENDING_AT'
const ALERT_THRESHOLD_SECONDS = 5 * 60
const ALERT_THRESHOLD_LABEL = '5m'

function hasAlertMarker(instructions: string | null | undefined, marker: string) {
  const source = String(instructions || '')
  const pattern = new RegExp(`\\[${marker}:[^\\]]+\\]`, 'i')
  return pattern.test(source)
}

function appendAlertMarker(
  instructions: string | null | undefined,
  marker: string
) {
  const source = String(instructions || '').trim()
  if (hasAlertMarker(source, marker)) return source

  const tag = `[${marker}:${new Date().toISOString()}]`
  if (!source) return tag
  return `${source}\n${tag}`
}

async function markAlertSent(orderId: string, instructions: string | null | undefined, marker: string) {
  const nextInstructions = appendAlertMarker(instructions, marker)
  await supabaseAdmin
    .from('orders')
    .update({ instructions: nextInstructions })
    .eq('id', orderId)
}

/**
 * Fire-and-forget: check for unaccepted orders older than 5 min
 * and send WhatsApp notifications to admin phones.
 */
async function checkUnacceptedOrders() {
  try {
    console.log('[Admin Orders] checkUnacceptedOrders start', {
      thresholdSeconds: ALERT_THRESHOLD_SECONDS,
    })
    const thresholdDate = new Date(
      Date.now() - ALERT_THRESHOLD_SECONDS * 1000
    ).toISOString()

    const { data: pending, error } = await supabaseAdmin
      .from('orders')
      .select('id,instructions')
      .eq('status', 'placed')
      .lt('created_at', thresholdDate)
      .limit(25)

    if (error) {
      console.error('[Admin Orders] Unaccepted check query failed:', error)
      return
    }

    console.log('[Admin Orders] Unaccepted candidates fetched', {
      count: pending?.length || 0,
      thresholdDate,
    })

    if (!pending || pending.length === 0) return

    for (const order of pending) {
      if (hasAlertMarker(order.instructions, UNACCEPTED_ALERT_MARKER)) continue

      const result = await notifyAdminsUnacceptedOrder(order.id)
      console.log('[Admin Orders] Unaccepted alert send result', {
        orderId: order.id,
        sent: result.sent,
        failed: result.failed,
      })
      if (result.sent > 0) {
        await markAlertSent(order.id, order.instructions, UNACCEPTED_ALERT_MARKER)
        console.log('[Admin Orders] Unaccepted alert marker set', { orderId: order.id })
      }
    }
  } catch (err) {
    console.error('[Admin Orders] WhatsApp notification check failed:', err)
  }
}

/**
 * Fire-and-forget: check for pickup orders that are still not collected
 * 5 minutes after their pickup slot.
 */
async function checkPickupPendingOrders() {
  try {
    console.log('[Admin Orders] checkPickupPendingOrders start', {
      thresholdSeconds: ALERT_THRESHOLD_SECONDS,
    })
    const thresholdTime = Date.now() - ALERT_THRESHOLD_SECONDS * 1000

    const { data: pickupCandidates, error } = await supabaseAdmin
      .from('orders')
      .select('id,created_at,instructions')
      .eq('status', 'out_for_delivery')
      .limit(50)

    if (error) {
      console.error('[Admin Orders] Pickup pending check query failed:', error)
      return
    }

    console.log('[Admin Orders] Pickup candidates fetched', {
      count: pickupCandidates?.length || 0,
      thresholdTimeIso: new Date(thresholdTime).toISOString(),
    })

    if (!pickupCandidates || pickupCandidates.length === 0) return

    for (const order of pickupCandidates) {
      if (hasAlertMarker(order.instructions, PICKUP_PENDING_ALERT_MARKER)) continue

      const meta = parseOrderMeta(order.instructions)
      if (meta.orderType !== 'pickup') continue

      const referenceTime = meta.pickupSlot
        ? new Date(meta.pickupSlot).getTime()
        : new Date(order.created_at).getTime()

      if (!Number.isFinite(referenceTime) || referenceTime > thresholdTime) continue

      const result = await notifyAdminsPickupPendingOrder(
        order.id,
        ALERT_THRESHOLD_LABEL
      )
      console.log('[Admin Orders] Pickup pending alert send result', {
        orderId: order.id,
        sent: result.sent,
        failed: result.failed,
      })
      if (result.sent > 0) {
        await markAlertSent(order.id, order.instructions, PICKUP_PENDING_ALERT_MARKER)
        console.log('[Admin Orders] Pickup pending alert marker set', { orderId: order.id })
      }
    }
  } catch (err) {
    console.error('[Admin Orders] Pickup pending notification check failed:', err)
  }
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const hasSupabase = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
  )
  if (!hasSupabase) return NextResponse.json({ orders: [] })

  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*,order_items(*,product:products(id,name,image_url,is_veg))')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fire-and-forget: check for order alerts & notify admins via WhatsApp
  console.log('[Admin Orders] Triggering alert checks', { ordersCount: data?.length || 0 })
  checkUnacceptedOrders().catch(() => { })
  checkPickupPendingOrders().catch(() => { })

  return NextResponse.json({ orders: data || [] })
}
