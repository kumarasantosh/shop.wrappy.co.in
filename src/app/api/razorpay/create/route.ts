import { NextResponse } from 'next/server'
import Razorpay from 'razorpay'
import { createOrderPayload } from '../../../../lib/razorpay'

const KEY_ID = process.env.RAZORPAY_KEY_ID || ''
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || ''

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const amount = body.amount || 0
    const receipt = body.receipt || `rcpt_${Date.now()}`

    const rzp = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET })
    const payload = createOrderPayload(amount, receipt)
    const order = await rzp.orders.create(payload)
    return NextResponse.json({ order })
  } catch (err: any) {
    return NextResponse.json({ error: (err && err.message) || 'error' }, { status: 500 })
  }
}

