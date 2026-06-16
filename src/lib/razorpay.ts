import crypto from 'crypto'

export function verifyRazorpaySignature(payload: string, signature: string, secret: string) {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return expected === signature
}

export function verifyRazorpayCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
  secret: string
) {
  const payload = `${razorpayOrderId}|${razorpayPaymentId}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return expected === signature
}

export function createOrderPayload(amountInRupees: number, receipt = '') {
  return {
    amount: Math.round(amountInRupees * 100),
    currency: 'INR',
    receipt,
    payment_capture: 1
  }
}

function toBase64Url(input: Buffer | string) {
  const value = Buffer.isBuffer(input)
    ? input.toString('base64')
    : Buffer.from(input, 'utf8').toString('base64')
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  return Buffer.from(base64 + padding, 'base64').toString('utf8')
}

export function signCheckoutDraftToken(payload: Record<string, unknown>, secret: string) {
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest()
  const encodedSignature = toBase64Url(signature)
  return `${encodedPayload}.${encodedSignature}`
}

export function verifyCheckoutDraftToken<T = Record<string, unknown>>(
  token: string,
  secret: string
): T | null {
  const [encodedPayload, encodedSignature] = token.split('.')
  if (!encodedPayload || !encodedSignature) return null

  const expectedSignature = toBase64Url(
    crypto.createHmac('sha256', secret).update(encodedPayload).digest()
  )
  if (expectedSignature !== encodedSignature) return null

  try {
    return JSON.parse(fromBase64Url(encodedPayload)) as T
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Food-Order — Razorpay Payment Links
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a Razorpay Payment Link for a WhatsApp food order.
 * Returns the short URL (e.g. https://rzp.io/l/abc123).
 */
export async function createPaymentLink({
  orderId,
  amount,
  phone,
  name,
}: {
  orderId: string
  amount: number
  phone: string
  name: string
}): Promise<string> {
  const credentials = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64')

  // Payment link expires in 15 minutes
  const expireBy = Math.floor(Date.now() / 1000) + 900

  const body = {
    amount: amount * 100, // Razorpay uses paise
    currency: 'INR',
    description: `Order #${orderId} — ${process.env.RESTAURANT_NAME || 'Wrappy'}`,
    customer: {
      name: name || 'Customer',
      contact: phone.startsWith('+') ? phone : `+${phone}`,
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
    expire_by: expireBy,
    notes: {
      order_id: orderId,
      phone, // stored so the webhook can look up the session
    },
    callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/razorpay/webhook`,
    callback_method: 'get',
  }

  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) throw new Error('Razorpay Payment Link error: ' + JSON.stringify(data))

  return data.short_url as string
}
