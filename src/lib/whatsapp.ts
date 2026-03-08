import { supabaseAdmin } from './supabaseAdmin'

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || ''
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || ''
const GRAPH_API_VERSION = 'v22.0'

/**
 * Send a WhatsApp template message via Meta Graph API.
 */
export async function sendWhatsAppTemplate(
    to: string,
    templateName: string,
    languageCode = 'en_US'
): Promise<{ success: boolean; error?: string }> {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
        return { success: false, error: 'whatsapp_not_configured' }
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: languageCode },
                },
            }),
        })

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}))
            console.error('[WhatsApp] Template send failed:', payload)
            return { success: false, error: payload?.error?.message || 'send_failed' }
        }

        return { success: true }
    } catch (err: any) {
        console.error('[WhatsApp] Error:', err)
        return { success: false, error: err?.message || 'network_error' }
    }
}

/**
 * Send a plain text WhatsApp message via Meta Graph API.
 */
export async function sendWhatsAppText(
    to: string,
    message: string
): Promise<{ success: boolean; error?: string }> {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
        return { success: false, error: 'whatsapp_not_configured' }
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body: message },
            }),
        })

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}))
            console.error('[WhatsApp] Send failed:', payload)
            return { success: false, error: payload?.error?.message || 'send_failed' }
        }

        return { success: true }
    } catch (err: any) {
        console.error('[WhatsApp] Error:', err)
        return { success: false, error: err?.message || 'network_error' }
    }
}

/**
 * Fetch all active admin phone numbers from the admin_phones table.
 */
export async function getActiveAdminPhones(): Promise<string[]> {
    const { data, error } = await supabaseAdmin
        .from('admin_phones')
        .select('phone')
        .eq('is_active', true)

    if (error) {
        console.error('[WhatsApp] Failed to fetch admin phones:', error)
        return []
    }

    return (data || []).map((row: { phone: string }) => row.phone).filter(Boolean)
}

/**
 * Send WhatsApp notifications to all active admin phone numbers
 * about an unaccepted order.
 */
export async function notifyAdminsUnacceptedOrder(
    orderId: string
): Promise<{ sent: number; failed: number }> {
    // Fetch order details for the message
    const { data: order } = await supabaseAdmin
        .from('orders')
        .select('id, total, created_at, phone')
        .eq('id', orderId)
        .single()

    const shortId = orderId.slice(0, 8)
    const total = order?.total ? `₹${order.total}` : ''
    const minsAgo = order?.created_at
        ? Math.round((Date.now() - new Date(order.created_at).getTime()) / 60_000)
        : 0

    const message =
        `🚨 *Order #${shortId}* (${total}) placed ${minsAgo} min ago has NOT been accepted!\n\n` +
        `Please check your admin panel and accept the order.`

    const phones = await getActiveAdminPhones()
    let sent = 0
    let failed = 0

    for (const phone of phones) {
        const result = await sendWhatsAppText(phone, message)
        if (result.success) {
            sent++
        } else {
            failed++
            console.error(`[WhatsApp] Failed to notify ${phone} for order ${orderId}:`, result.error)
        }
    }

    return { sent, failed }
}
