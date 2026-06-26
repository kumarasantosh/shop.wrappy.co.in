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
  sendMenu,
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
    } else if (message.type === 'button') {
      // Template quick-reply button taps (e.g. "View Menu" on the welcome template)
      const btn = message.button as Record<string, string>
      payload = btn?.payload || ''
      text = btn?.text || ''
    } else if (message.type === 'location') {
      const loc = message.location as { latitude: number; longitude: number }
      text = `${loc.latitude}, ${loc.longitude}`
    } else if (message.type === 'order') {
      // Customer placed an order via the WhatsApp catalog
      payload = 'CATALOG_ORDER'
    }

    const input = text.toUpperCase().trim()
    const payloadNorm = payload.toUpperCase().replace(/[\s_-]+/g, '_')
    console.log('[WA] Text:', text, '| Input:', input, '| Payload:', payload)

    // HI / HELLO / CANCEL / RESET always restart from the beginning
    if (input === 'HI' || input === 'HELLO' || input === 'CANCEL' || input === 'RESET') {
      await clearSession(phone)
      await setSession(phone, { phone, name: profileName, state: 'AWAITING_MENU', cart: [] })
      await sendWelcomeGreeting(phone, profileName)
      return
    }

    // Load or create session
    let session = await getSession(phone)
    console.log('[WA] Session:', session ? `state=${session.state}` : 'none')

    if (!session) {
      console.log('[WA] New customer — creating session and sending welcome')
      await setSession(phone, { phone, name: profileName, state: 'AWAITING_MENU', cart: [] })
      await sendWelcomeGreeting(phone, profileName)
      return
    }

    // ── State machine ──────────────────────────────────────────────────────────
    switch (session.state) {

      case 'AWAITING_MENU': {
        if (input === 'MENU' || input === 'VIEW MENU' || payloadNorm === 'VIEW_MENU') {
          await updateSession(phone, { state: 'AWAITING_ITEM' })
          await sendMenu(phone)
        } else {
          // Any other input (including HI/HELLO) re-sends the welcome
          await sendWelcomeGreeting(phone, session.name || profileName)
        }
        break
      }

      case 'AWAITING_ITEM': {
        if (input === 'MENU' || input === 'VIEW MENU' || payloadNorm === 'VIEW_MENU') {
          await sendMenu(phone)
          break
        }
        // Customer selected items from the WhatsApp catalog
        if (payload === 'CATALOG_ORDER') {
          const orderMsg = message.order as {
            catalog_id?: string
            product_items?: { product_retailer_id: string; quantity: number; item_price: number; currency: string }[]
          }
          const items = orderMsg?.product_items || []
          if (items.length === 0) {
            await sendMenu(phone)
            break
          }
          const cart: CartItem[] = items.map((p) => ({
            name: p.product_retailer_id,
            price: p.item_price,
            qty: p.quantity,
          }))
          const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0)
          const total = subtotal + DELIVERY_CHARGE
          const orderId = `ORD-${Date.now()}`
          await updateSession(phone, {
            state: 'AWAITING_LOCATION',
            cart,
            subtotal,
            delivery_charge: DELIVERY_CHARGE,
            total,
            order_id: orderId,
          })
          await sendWhatsAppText(
            phone,
            `Perfect! Kindly provide us with the WhatsApp location where our services are required? 📍\n\nTap on "Attachment" icon or "+" Symbol → Location → Send the exact Location where service is required`
          )
          break
        }
        if (input === 'DONE' || input === 'ORDER') {
          const cart = session.cart || []
          if (cart.length === 0) {
            await sendWhatsAppText(phone, 'Your cart is empty. Please select an item.')
            await sendMenu(phone)
            break
          }
          await updateSession(phone, { state: 'AWAITING_LOCATION' })
          await sendWhatsAppText(
            phone,
            `Perfect! Kindly provide us with the WhatsApp location where our services are required? 📍\n\nTap on "Attachment" icon or "+" Symbol → Location → Send the exact Location where service is required`
          )
          break
        }
        const menuItems = await getOrderedMenuItems()
        const itemIndex = parseInt(text, 10) - 1
        if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= menuItems.length) {
          await sendMenu(phone)
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

      case 'AWAITING_LOCATION': {
        if (message.type !== 'location') {
          // Remind them to share location pin, not text
          await sendWhatsAppText(
            phone,
            `Please share your *WhatsApp location* 📍\n\nTap on "Attachment" icon or "+" Symbol → Location → Send the exact Location where service is required`
          )
          break
        }
        const loc = message.location as { latitude: number; longitude: number }
        const locationStr = `${loc.latitude},${loc.longitude}`
        await updateSession(phone, { state: 'AWAITING_ADDRESS', location: locationStr })
        await sendWhatsAppText(
          phone,
          `Now, kindly provide us with your complete address for a seamless service experience! 🏠\n\n(Building name, flat number, landmark, etc.)`
        )
        break
      }

      case 'AWAITING_ADDRESS': {
        if (!text || text.length < 5) {
          await sendWhatsAppText(
            phone,
            `Please share your complete address (building name, flat number, landmark, etc.) 🏠`
          )
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
          await sendMenu(phone)
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
        if (input === 'MENU' || input === 'VIEW MENU' || input === 'ORDER' || payloadNorm === 'VIEW_MENU') {
          await updateSession(phone, { state: 'AWAITING_ITEM' })
          await sendMenu(phone)
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
  category?: string | null
  category_position?: number | null
}

const CATEGORY_EMOJI: Record<string, string> = {
  wraps: '🌯',
  fries: '🍟',
  ufo: '🛸',
  thickshakes: '🥤',
  thickshake: '🥤',
  mojitos: '🍹',
  mojito: '🍹',
  burgers: '🍔',
  burger: '🍔',
  brownies: '🍫',
  brownie: '🍫',
  'ice cream': '🍦',
  'ice creams': '🍦',
  icecream: '🍦',
  sandwiches: '🥪',
  sandwich: '🥪',
  nuggets: '🍗',
  strips: '🍗',
}

function categoryEmoji(name: string): string {
  const key = name.toLowerCase().trim()
  return CATEGORY_EMOJI[key] || '🍽️'
}

/** Fetch available products from Supabase with their category. */
async function getMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('name, price, is_veg, is_available, categories(name, position)')
    .eq('is_available', true)
    .order('name', { ascending: true })

  if (error || !data || data.length === 0) {
    const envItems = process.env.MENU_ITEMS
    if (envItems) {
      try { return JSON.parse(envItems) as MenuItem[] } catch { /* ignore */ }
    }
    return []
  }

  return (data as any[]).map((row) => ({
    name: row.name,
    price: row.price,
    is_veg: row.is_veg,
    is_available: row.is_available,
    category: row.categories?.name ?? null,
    category_position: row.categories?.position ?? 999,
  }))
}

/**
 * Returns items in the exact same order they appear in the menu text
 * (sorted by category position, then alphabetically within each category).
 * Use this whenever you need to map a user's number selection to an item.
 */
async function getOrderedMenuItems(): Promise<MenuItem[]> {
  const items = await getMenuItems()

  const categoryMap = new Map<string, { position: number; items: MenuItem[] }>()
  for (const item of items) {
    const cat = item.category || 'Other'
    const pos = item.category_position ?? 999
    if (!categoryMap.has(cat)) categoryMap.set(cat, { position: pos, items: [] })
    categoryMap.get(cat)!.items.push(item)
  }

  const sortedCategories = [...categoryMap.entries()].sort((a, b) => a[1].position - b[1].position)
  return sortedCategories.flatMap(([, { items: catItems }]) => catItems)
}

async function buildMenuText(): Promise<string> {
  const items = await getMenuItems()
  if (items.length === 0) return 'Menu not available. Please call us to order.'

  const categoryMap = new Map<string, { position: number; items: MenuItem[] }>()
  for (const item of items) {
    const cat = item.category || 'Other'
    const pos = item.category_position ?? 999
    if (!categoryMap.has(cat)) categoryMap.set(cat, { position: pos, items: [] })
    categoryMap.get(cat)!.items.push(item)
  }

  const sortedCategories = [...categoryMap.entries()].sort((a, b) => a[1].position - b[1].position)

  let counter = 1
  const sections: string[] = []

  for (const [catName, { items: catItems }] of sortedCategories) {
    const emoji = categoryEmoji(catName)
    const lines = catItems.map((item) => `${counter++}. ${item.name} — ₹${item.price}`)
    sections.push(`*${emoji} ${catName}*\n${lines.join('\n')}`)
  }

  return `*Our Menu 🍽️*\n\n${sections.join('\n\n')}\n\nReply with item number to order. Type *DONE* when finished.`
}
