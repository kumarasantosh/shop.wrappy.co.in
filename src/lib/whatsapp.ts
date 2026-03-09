import { supabaseAdmin } from './supabaseAdmin'
import { parseOrderMeta } from './orderMeta'

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || ''
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || ''
const GRAPH_API_VERSION = 'v25.0'
const ADMIN_ALERT_TEMPLATE_NAME = process.env.WHATSAPP_ADMIN_ALERT_TEMPLATE || 'hello_world'
const ADMIN_UNACCEPTED_TEMPLATE_NAME =
    process.env.WHATSAPP_ADMIN_UNACCEPTED_TEMPLATE || ADMIN_ALERT_TEMPLATE_NAME
const ADMIN_ALERT_TEMPLATE_LANGUAGE =
    process.env.WHATSAPP_ADMIN_ALERT_TEMPLATE_LANGUAGE || 'en_US'

function normalizeWhatsAppRecipient(raw: string): string {
    const digits = String(raw || '').replace(/\D/g, '')
    if (!digits) return ''
    if (digits.length === 10) return `91${digits}`
    if (digits.startsWith('00')) return digits.slice(2)
    return digits
}

/**
 * Send a WhatsApp template message via Meta Graph API.
 */
export async function sendWhatsAppTemplate(
    to: string,
    templateName: string,
    languageCode = 'en_US',
    bodyParameters: string[] = []
): Promise<{ success: boolean; error?: string }> {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
        return { success: false, error: 'whatsapp_not_configured' }
    }

    const recipient = normalizeWhatsAppRecipient(to)
    if (!recipient) {
        return { success: false, error: 'invalid_recipient' }
    }

    const components =
        bodyParameters.length > 0
            ? [
                  {
                      type: 'body',
                      parameters: bodyParameters.map((value) => ({
                          type: 'text',
                          text: String(value || ''),
                      })),
                  },
              ]
            : undefined

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`

    try {
        console.log('[WhatsApp] Sending template', {
            to: recipient,
            templateName,
            languageCode,
            parameterCount: bodyParameters.length,
        })
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: recipient,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: languageCode },
                    components,
                },
            }),
        })

        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
            console.error('[WhatsApp] Template send failed:', payload)
            return { success: false, error: payload?.error?.message || 'send_failed' }
        }

        console.log('[WhatsApp] Template sent', {
            to: recipient,
            messageId: payload?.messages?.[0]?.id || null,
        })
        return { success: true }
    } catch (err: any) {
        console.error('[WhatsApp] Error:', err)
        return { success: false, error: err?.message || 'network_error' }
    }
}

async function sendTemplateWithFallbacks(
    to: string,
    templateName: string,
    languageCode: string,
    parameterVariants: string[][]
): Promise<{ success: boolean; error?: string; usedParameterCount?: number }> {
    for (const params of parameterVariants) {
        const result = await sendWhatsAppTemplate(to, templateName, languageCode, params)
        if (result.success) {
            return { success: true, usedParameterCount: params.length }
        }
        console.error('[WhatsApp] Template send attempt failed', {
            to,
            templateName,
            parameterCount: params.length,
            error: result.error,
        })
    }
    return { success: false, error: 'all_template_attempts_failed' }
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

    const recipient = normalizeWhatsAppRecipient(to)
    if (!recipient) {
        return { success: false, error: 'invalid_recipient' }
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`

    try {
        console.log('[WhatsApp] Sending text', { to: recipient, chars: message.length })
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: recipient,
                type: 'text',
                text: { body: message },
            }),
        })

        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
            console.error('[WhatsApp] Send failed:', payload)
            return { success: false, error: payload?.error?.message || 'send_failed' }
        }

        console.log('[WhatsApp] Text sent', {
            to: recipient,
            messageId: payload?.messages?.[0]?.id || null,
        })
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

    const phones = (data || []).map((row: { phone: string }) => row.phone).filter(Boolean)
    console.log('[WhatsApp] Active admin phones loaded', { count: phones.length })
    return phones
}

/**
 * Send WhatsApp notifications to all active admin phone numbers
 * about an unaccepted order.
 */
export async function notifyAdminsUnacceptedOrder(
    orderId: string
): Promise<{ sent: number; failed: number }> {
    console.log('[WhatsApp] notifyAdminsUnacceptedOrder start', { orderId })
    const { data: order } = await supabaseAdmin
        .from('orders')
        .select('id, total, created_at, phone, instructions')
        .eq('id', orderId)
        .single()

    const shortId = orderId.slice(0, 8)
    const totalLabel = Number.isFinite(Number(order?.total))
        ? `INR ${Math.round(Number(order?.total || 0))}`
        : 'N/A'
    const minsAgo = order?.created_at
        ? Math.max(
              1,
              Math.round((Date.now() - new Date(order.created_at).getTime()) / 60_000)
          )
        : 0
    const minsAgoLabel = `${minsAgo} min`
    const customerPhone = String(order?.phone || 'N/A')
    const meta = parseOrderMeta(order?.instructions)
    const orderTypeLabel = meta.orderType === 'pickup' ? 'Self Pickup' : 'Delivery'

    const phones = await getActiveAdminPhones()
    let sent = 0
    let failed = 0

    for (const phone of phones) {
        const result = await sendTemplateWithFallbacks(
            phone,
            ADMIN_UNACCEPTED_TEMPLATE_NAME,
            ADMIN_ALERT_TEMPLATE_LANGUAGE,
            [
                [shortId, totalLabel, minsAgoLabel, customerPhone, orderTypeLabel],
                [shortId, totalLabel, minsAgoLabel],
                [shortId],
                [],
            ]
        )
        if (result.success) {
            sent++
            console.log('[WhatsApp] Unaccepted template sent', {
                orderId,
                to: phone,
                templateName: ADMIN_UNACCEPTED_TEMPLATE_NAME,
                usedParameterCount: result.usedParameterCount,
            })
        } else {
            failed++
            console.error(
                `[WhatsApp] Failed to notify ${phone} for order ${orderId}:`,
                result.error
            )
        }
    }

    console.log('[WhatsApp] notifyAdminsUnacceptedOrder complete', { orderId, sent, failed })
    return { sent, failed }
}

export async function notifyAdminsPickupPendingOrder(
    orderId: string,
    thresholdLabel = '5 minutes'
): Promise<{ sent: number; failed: number }> {
    console.log('[WhatsApp] notifyAdminsPickupPendingOrder start', {
        orderId,
        thresholdLabel,
    })
    const { data: order } = await supabaseAdmin
        .from('orders')
        .select('id, total, created_at, phone, instructions')
        .eq('id', orderId)
        .single()

    const meta = parseOrderMeta(order?.instructions)
    const shortId = orderId.slice(0, 8)
    const pickupSlotLabel = meta.pickupSlot
        ? new Date(meta.pickupSlot).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Asia/Kolkata',
          })
        : 'N/A'

    const phones = await getActiveAdminPhones()
    let sent = 0
    let failed = 0

    for (const phone of phones) {
        const result = await sendWhatsAppTemplate(
            phone,
            ADMIN_ALERT_TEMPLATE_NAME,
            ADMIN_ALERT_TEMPLATE_LANGUAGE
        )
        if (result.success) {
            sent++
        } else {
            failed++
            console.error(
                `[WhatsApp] Failed pickup-pending alert to ${phone} for order ${orderId}:`,
                result.error
            )
        }
    }

    console.log('[WhatsApp] notifyAdminsPickupPendingOrder complete', {
        orderId,
        sent,
        failed,
        thresholdLabel,
        pickupSlotLabel,
        shortId,
    })
    return { sent, failed }
}
