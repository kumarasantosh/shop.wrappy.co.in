import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import {
  verifyCheckoutDraftToken,
  verifyRazorpayCheckoutSignature,
} from '../../../../lib/razorpay'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { ProductAddon } from '../../../../lib/types'

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || ''
const CHECKOUT_DRAFT_SECRET = process.env.CHECKOUT_DRAFT_SECRET || KEY_SECRET

type DraftItem = {
  id: string
  qty: number
  price: number
  addons?: ProductAddon[]
}

type CheckoutDraftPayload = {
  version: 1
  created_at: string
  expires_at: string
  customer_clerk_id: string | null
  items: DraftItem[]
  subtotal: number
  discount: number
  tax: number
  packing_fee: number
  delivery_fee: number
  total: number
  eta: string
  estimated_delivery_minutes: number
  address: string
  phone: string | null
  instructions: string | null
  coupon_code: string | null
  coupon_id: string | null
  payment_method: 'razorpay'
  order_type: 'delivery' | 'pickup'
  pickup_slot: string | null
  pickup_code: string | null
  razorpay_order_id: string
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    const hasSupabase = Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
    )

    const body = (await req.json()) as {
      draftToken?: string
      razorpay_order_id?: string
      razorpay_payment_id?: string
      razorpay_signature?: string
    }

    const draftToken = String(body.draftToken || '').trim()
    const razorpayOrderId = String(body.razorpay_order_id || '').trim()
    const razorpayPaymentId = String(body.razorpay_payment_id || '').trim()
    const razorpaySignature = String(body.razorpay_signature || '').trim()

    if (!draftToken || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return NextResponse.json({ error: 'missing_payment_confirmation_data' }, { status: 400 })
    }

    if (!KEY_SECRET) {
      return NextResponse.json({ error: 'razorpay_not_configured' }, { status: 503 })
    }

    const isSignatureValid = verifyRazorpayCheckoutSignature(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      KEY_SECRET
    )
    if (!isSignatureValid) {
      return NextResponse.json({ error: 'invalid_payment_signature' }, { status: 400 })
    }

    const draft = verifyCheckoutDraftToken<CheckoutDraftPayload>(
      draftToken,
      CHECKOUT_DRAFT_SECRET
    )
    if (!draft || draft.version !== 1) {
      return NextResponse.json({ error: 'invalid_checkout_draft' }, { status: 400 })
    }

    if (draft.razorpay_order_id !== razorpayOrderId) {
      return NextResponse.json({ error: 'payment_order_mismatch' }, { status: 400 })
    }

    if (
      draft.expires_at &&
      Number.isFinite(new Date(draft.expires_at).getTime()) &&
      new Date(draft.expires_at).getTime() < Date.now()
    ) {
      return NextResponse.json({ error: 'checkout_session_expired' }, { status: 400 })
    }

    if ((draft.customer_clerk_id || null) !== (userId || null)) {
      return NextResponse.json({ error: 'checkout_user_mismatch' }, { status: 403 })
    }

    if (!hasSupabase) {
      return NextResponse.json({
        order: {
          id: `mock_${Date.now()}`,
          status: 'placed',
          subtotal: draft.subtotal,
          discount: draft.discount,
          tax: draft.tax,
          packing_fee: draft.packing_fee,
          delivery_fee: draft.delivery_fee,
          total: draft.total,
          eta: draft.eta,
          address: draft.address,
          phone: draft.phone,
          instructions: draft.instructions,
          coupon_code: draft.coupon_code,
          payment_method: draft.payment_method,
          payment_status: 'paid',
          razorpay_order_id: razorpayOrderId,
        },
        pickupCode: draft.pickup_code,
        pickupSlot: draft.pickup_slot,
      })
    }

    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('razorpay_order_id', razorpayOrderId)
      .maybeSingle()

    if (existingOrder) {
      return NextResponse.json({
        order: existingOrder,
        pickupCode: draft.pickup_code,
        pickupSlot: draft.pickup_slot,
      })
    }

    const orderPayload = {
      customer_clerk_id: draft.customer_clerk_id || null,
      status: 'placed',
      subtotal: draft.subtotal,
      discount: draft.discount,
      tax: draft.tax,
      packing_fee: draft.packing_fee,
      delivery_fee: draft.delivery_fee,
      total: draft.total,
      eta: draft.eta,
      estimated_delivery_minutes: draft.estimated_delivery_minutes,
      address: draft.address,
      phone: draft.phone,
      instructions: draft.instructions,
      coupon_code: draft.coupon_code,
      payment_method: draft.payment_method,
      payment_status: 'paid',
      razorpay_order_id: razorpayOrderId,
    }

    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .insert([orderPayload])
      .select('*')
      .single()
    if (orderErr) {
      return NextResponse.json({ error: orderErr.message }, { status: 500 })
    }

    const itemsToInsert = (draft.items || []).map((item) => ({
      order_id: order.id,
      product_id: item.id,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      addons: item.addons || [],
      line_total: Number(item.price || 0) * Number(item.qty || 0),
    }))

    if (itemsToInsert.length > 0) {
      const { error: itemsError } = await supabaseAdmin.from('order_items').insert(itemsToInsert)
      if (itemsError) {
        return NextResponse.json({ error: itemsError.message }, { status: 500 })
      }
    }

    if (draft.coupon_id) {
      const { error: usageError } = await supabaseAdmin.rpc(
        'increment_coupon_usage',
        { coupon_id: draft.coupon_id }
      )
      if (usageError) {
        const { data: couponRow } = await supabaseAdmin
          .from('coupons')
          .select('used_count')
          .eq('id', draft.coupon_id)
          .maybeSingle()
        await supabaseAdmin
          .from('coupons')
          .update({ used_count: Number(couponRow?.used_count || 0) + 1 })
          .eq('id', draft.coupon_id)
      }
    }

    return NextResponse.json({
      order,
      pickupCode: draft.pickup_code,
      pickupSlot: draft.pickup_slot,
    })
  } catch (err: any) {
    return NextResponse.json({ error: (err && err.message) || 'error' }, { status: 500 })
  }
}
