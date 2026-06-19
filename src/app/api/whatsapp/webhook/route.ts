// src/app/api/whatsapp/webhook/route.ts
// Main WhatsApp webhook — handles ALL inbound messages from Meta.
// GET  → Meta webhook verification handshake
// POST → inbound message → state machine → send next template
//
// Register this URL in Meta > WhatsApp > Configuration > Webhooks:
//   Callback URL : https://yourdomain.com/api/whatsapp/webhook
//   Verify token : WEBHOOK_VERIFY_TOKEN (from .env.local)
//   Subscribe to : messages

import { NextRequest, NextResponse } from 'next/server'
import {
  sendWelcomeGreeting,
  sendItemSelected,
  sendAddressRequest,
  sendOrderSummary,
  sendPaymentLink,
  sendWhatsAppText,
} from '../../../../lib/whatsapp'
import {
  getSession,
  setSession,
  updateSession,
  clearSession,
  CartItem,
} from '../../../../lib/whatsappSession'
import { createPaymentLink } from '../../../../lib/razorpay'
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'

const DELIVERY_CHARGE = parseInt(process.env.DELIVERY_CHARGE || '30', 10)

// ─── GET — Meta verification handshake ───────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified')
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

// ─── POST — Inbound message handler ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  // Await so Vercel doesn't terminate the function before the work completes
  await handleInbound(body)

  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

async function handleInbound(body: Record<string, unknown>) {
  try {
    console.log('[WA] Raw body:', JSON.stringify(body))

    const entry = (body?.entry as unknown[])?.[0] as Record<string, unknown>
    const change = (entry?.changes as unknown[])?.[0] as Record<string, unknown>
    const value = change?.value as Record<string, unknown>
    const messages = value?.messages as unknown[]
    const message = messages?.[0] as Record<string, unknown>

    // Ignore status updates (delivered, read receipts)
    if (!message) {
      console.log('[WA] No message found — likely a status update, ignoring')
      return
    }

    const phone = message.from as string
    const contacts = value?.contacts as { profile?: { name?: string } }[]
    const profileName = contacts?.[0]?.profile?.name || ''

    console.log('[WA] Message from:', phone, '| type:', message.type, '| name:', profileName)

    // Extract text or button payload
    let text = ''
    let payload = ''
    if (message.type === 'text') {
      text = ((message.text as Record<string, string>)?.body || '').trim()
    } else if (message.type === 'interactive') {
      const interactive = message.interactive as Record<string, Record<string, string>>
      payload = interactive?.button_reply?.payload || ''
      text = interactive?.button_reply?.title || ''
    } else if (message.type === 'location') {
      const loc = message.location as { latitude: number; longitude: number }
      text = `${loc.latitude}, ${loc.longitude}`
    }

    const input = text.toUpperCase().trim()
    console.log('[WA] Text:', text, '| Input:', input, '| Payload:', payload)

    // HI / HELLO / CANCEL / RESET always restart from the beginning
    if (input === 'HI' || input === 'HELLO' || input === 'CANCEL' || input === 'RESET') {
      await clearSession(phone)
      await setSession(phone, { phone, name: profileName, state: 'AWAITING_ITEM', cart: [] })
      await sendWhatsAppText(phone, await buildMenuText())
      return
    }

    // Load or create session
    let session = await getSession(phone)
    console.log('[WA] Session:', session ? `state=${session.state}` : 'none')

    if (!session) {
      console.log('[WA] New customer — creating session and sending menu')
      await setSession(phone, { phone, name: profileName, state: 'AWAITING_ITEM', cart: [] })
      await sendWhatsAppText(phone, await buildMenuText())
      return
    }

    // ── State machine ──────────────────────────────────────────────────────────
    switch (session.state) {

      case 'AWAITING_MENU': {
        if (input === 'MENU' || payload === 'VIEW_MENU') {
          await updateSession(phone, { state: 'AWAITING_ITEM' })
          await sendMenu(phone, await buildMenuText())
        } else {
          // Any other input (including HI/HELLO) re-sends the welcome
          await sendWelcomeGreeting(phone, session.name || profileName)
        }
        break
      }

      case 'AWAITING_ITEM': {
        if (input === 'MENU' || payload === 'VIEW_MENU') {
          await sendWhatsAppText(phone, await buildMenuText())
          break
        }
        if (input === 'DONE' || input === 'ORDER') {
          const cart = session.cart || []
          if (cart.length === 0) {
            await sendWhatsAppText(phone, 'Your cart is empty. Please select an item.')
            await sendWhatsAppText(phone, await buildMenuText())
            break
          }
          await updateSession(phone, { state: 'AWAITING_ADDRESS' })
          await sendAddressRequest(phone, session.name || profileName)
          break
        }
        const menuItems = await getMenuItems()
        const itemIndex = parseInt(text, 10) - 1
        if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= menuItems.length) {
          await sendWhatsAppText(phone, await buildMenuText())
          break
        }
        const item = menuItems[itemIndex]
        await updateSession(phone, {
          state: 'AWAITING_QTY',
          item_number: itemIndex + 1,
          item_name: item.name,
          item_price: item.price,
        })
        await sendItemSelected(phone, item.name, item.price)
        break
      }

      case 'AWAITING_QTY': {
        const qty = parseInt(text, 10)
        if (isNaN(qty) || qty < 1 || qty > 10) {
          await sendItemSelected(phone, session.item_name || '', session.item_price || 0)
          break
        }
        const newItem: CartItem = {
          name: session.item_name || '',
          price: session.item_price || 0,
          qty,
        }
        const cart = [...(session.cart || []), newItem]
        await updateSession(phone, { state: 'AWAITING_ITEM', cart })
        const cartSummary = cart.map((c) => `• ${c.name} x${c.qty} — ₹${c.price * c.qty}`).join('\n')
        await sendWhatsAppText(
          phone,
          `Added! ✅\n\n*Your cart:*\n${cartSummary}\n\nReply with another item number to add more, or type *DONE* to proceed.`
        )
        break
      }

      case 'AWAITING_ADDRESS': {
        if (!text || text.length < 5) {
          await sendAddressRequest(phone, session.name || profileName)
          break
        }
        const cart = session.cart || []
        const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0)
        const total = subtotal + DELIVERY_CHARGE
        const orderId = `ORD-${Date.now()}`

        const updatedSession = await updateSession(phone, {
          state: 'AWAITING_CONFIRM',
          address: text,
          subtotal,
          delivery_charge: DELIVERY_CHARGE,
          total,
          order_id: orderId,
        })
        await sendOrderSummary(phone, updatedSession)
        break
      }

      case 'AWAITING_CONFIRM': {
        if (payload === 'CONFIRM_ORDER' || input === 'CONFIRM') {
          const paymentUrl = await createPaymentLink({
            orderId: session.order_id || `ORD-${Date.now()}`,
            amount: session.total || 0,
            phone,
            name: session.name || profileName,
          })
          const updatedSession = await updateSession(phone, {
            state: 'AWAITING_PAYMENT',
            payment_link: paymentUrl,
          })
          await sendPaymentLink(phone, updatedSession, paymentUrl)
        } else if (payload === 'EDIT_ORDER' || input === 'EDIT') {
          await updateSession(phone, { state: 'AWAITING_ITEM' })
          await sendMenu(phone, await buildMenuText())
        } else {
          await sendOrderSummary(phone, session)
        }
        break
      }

      case 'AWAITING_PAYMENT': {
        // Resend payment link if customer asks again
        if (session.payment_link) {
          await sendPaymentLink(phone, session, session.payment_link)
        }
        break
      }

      case 'ORDER_CONFIRMED': {
        if (input === 'MENU' || input === 'ORDER' || payload === 'VIEW_MENU') {
          await updateSession(phone, { state: 'AWAITING_ITEM' })
          await sendMenu(phone, await buildMenuText())
        } else {
          await sendWelcomeGreeting(phone, session.name || profileName)
        }
        break
      }

      default: {
        await clearSession(phone)
        await sendWelcomeGreeting(phone, profileName)
      }
    }
  } catch (err: unknown) {
    console.error('[WA] Webhook error:', err instanceof Error ? err.message : err)
    if (err instanceof Error) console.error('[WA] Stack:', err.stack)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface MenuItem {
  name: string
  price: number
  is_veg?: boolean
  is_available?: boolean
}

/** Fetch available products from Supabase and return them as menu items. */
async function getMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('name, price, is_veg, is_available')
    .eq('is_available', true)
    .order('name', { ascending: true })

  if (error || !data || data.length === 0) {
    // Fall back to MENU_ITEMS env var if set (legacy / dev)
    const envItems = process.env.MENU_ITEMS
    if (envItems) {
      try { return JSON.parse(envItems) as MenuItem[] } catch { /* ignore */ }
    }
    return []
  }
  return data as MenuItem[]
}

async function buildMenuText(): Promise<string> {
  const items = await getMenuItems()
  if (items.length === 0) return 'Menu not available. Please call us to order.'
  const lines = items.map((item, i) => `${i + 1}. ${item.name} — ₹${item.price}`)
  return `*Our Menu 🍽️*\n\n${lines.join('\n')}\n\nReply with item number(s) to order. Type *DONE* when finished.`
}
