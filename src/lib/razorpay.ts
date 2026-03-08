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
