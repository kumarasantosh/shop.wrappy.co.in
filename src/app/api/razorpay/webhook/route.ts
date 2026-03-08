import { NextResponse } from 'next/server'
import { verifyRazorpaySignature } from '../../../../lib/razorpay'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

export async function POST(req: Request) {
  const secret = process.env.RAZORPAY_KEY_SECRET || ''
  const signature = req.headers.get('x-razorpay-signature') || ''
  const payload = await req.text()

  const verified = verifyRazorpaySignature(payload, signature, secret)
  if (!verified) {
    return NextResponse.json({ ok: false, reason: 'invalid_signature' }, { status: 400 })
  }

  try {
    const event = JSON.parse(payload)
    const eventName = event.event as string

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

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Razorpay webhook parse/update error:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

