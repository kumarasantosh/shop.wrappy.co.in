import { NextResponse } from 'next/server'

/**
 * GET /api/debug/wa-config
 * Returns which phone number ID is configured, and lists templates
 * from that WABA so you can verify language codes.
 *
 * REMOVE THIS FILE before going to production.
 */
export async function GET() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || ''
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || ''

  if (!phoneNumberId || !accessToken) {
    return NextResponse.json({ error: 'WHATSAPP env vars not set' }, { status: 500 })
  }

  // 1. Fetch phone number details (tells us which WABA it belongs to)
  const phoneRes = await fetch(
    `https://graph.facebook.com/v25.0/${phoneNumberId}?fields=id,display_phone_number,verified_name,account_mode`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const phoneData = await phoneRes.json().catch(() => ({}))

  // 2. Try to list templates — requires knowing the WABA ID
  // The phone number object returns `account_mode` but not waba_id directly;
  // use the whatsapp_business_account edge instead.
  const wabaRes = await fetch(
    `https://graph.facebook.com/v25.0/${phoneNumberId}?fields=whatsapp_business_account`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const wabaData = await wabaRes.json().catch(() => ({}))
  const wabaId = wabaData?.whatsapp_business_account?.id

  let templates = null
  if (wabaId) {
    const tplRes = await fetch(
      `https://graph.facebook.com/v25.0/${wabaId}/message_templates?fields=name,language,status&limit=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    templates = await tplRes.json().catch(() => null)
  }

  // 3. Also fetch phone numbers for the known Wrappy WABA
  const wrappyWabaId = '1964329557628774'
  const wrappyPhonesRes = await fetch(
    `https://graph.facebook.com/v25.0/${wrappyWabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const wrappyPhones = await wrappyPhonesRes.json().catch(() => null)

  return NextResponse.json({
    configuredPhoneNumberId: phoneNumberId,
    tokenLength: accessToken.length,
    phoneDetails: phoneData,
    detectedWabaId: wabaId || 'could not resolve',
    templates,
    wrappyWaba: {
      id: wrappyWabaId,
      phoneNumbers: wrappyPhones,
    },
  })
}
