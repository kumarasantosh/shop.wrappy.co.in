import { NextResponse } from 'next/server'
import { verifyRazorpaySignature } from '../../../../lib/razorpay'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { getSession, updateSession } from '../../../../lib/whatsappSession'
import { sendOrderConfirmed } from '../../../../lib/whatsapp'

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || ''
  const signature = req.headers.get('x-razorpay-signature') || ''
  const payload = await req.text()

  const verified = verifyRazorpaySignature(payload, signature, secret)
  if (!verified) {
    return NextResponse.json({ ok: false, reason: 'invalid_signature' }, { status: 400 })
  }

  try {
    const event = JSON.parse(payload)
    const eventName = event.event as string

    // ── Razorpay Orders (website checkout) ─────────────────────────────────
    if (eventName === 'payment.captured') {
      const payment = event.payload?.payment?.entity
      const razorpayOrderId = payment?.order_id
      if (razorpayOrderId) {
        await supabaseAdmin
          .from('orders')
          .update({ status: 'preparing', payment_status: 'paid' })
          .eq('razorpay_order_id', razorpayOrderId)
      }
    }

    if (eventName === 'payment.failed') {
      const payment = event.payload?.payment?.entity
      const razorpayOrderId = payment?.order_id
      if (razorpayOrderId) {
        await supabaseAdmin
          .from('orders')
          .update({ status: 'cancelled', payment_status: 'failed' })
          .eq('razorpay_order_id', razorpayOrderId)
      }
    }

    // ── Razorpay Payment Links (WhatsApp food-order flow) ───────────────────
    if (eventName === 'payment_link.paid') {
      const paymentLink = event.payload?.payment_link?.entity
      const payment = event.payload?.payment?.entity

      // phone and order_id were stored in Razorpay notes when the link was created
      const phone: string | undefined = paymentLink?.notes?.phone
      const orderId: string | undefined = paymentLink?.notes?.order_id

      if (!phone) {
        console.error('[Razorpay] payment_link.paid: no phone in notes')
        return NextResponse.json({ ok: true, status: 'no_phone' })
      }

      const session = await getSession(phone)
      if (!session) {
        console.error('[Razorpay] payment_link.paid: session not found for', phone)
        return NextResponse.json({ ok: true, status: 'no_session' })
      }

      const finalOrderId = orderId || session.order_id || `ORD-${Date.now()}`

      // Save confirmed order to whatsapp_orders table
      await supabaseAdmin.from('whatsapp_orders').insert({
        order_id: finalOrderId,
        phone,
        customer_name: session.name,
        item_name: session.item_name,
        item_price: session.item_price,
        qty: session.qty,
        subtotal: session.subtotal,
        delivery_charge: session.delivery_charge,
        total: session.total,
        address: session.address,
        payment_link: session.payment_link,
        razorpay_payment_id: payment?.id,
        status: 'confirmed',
        eta_minutes: 30,
      })

      // Advance session state
      await updateSession(phone, { state: 'ORDER_CONFIRMED' })

      // Send confirmation WhatsApp template to customer
      await sendOrderConfirmed(phone, { ...session, order_id: finalOrderId })

      console.log(`[Razorpay] WhatsApp order confirmed: ${finalOrderId} for ${phone}`)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Razorpay webhook parse/update error:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

