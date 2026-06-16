import webpush from 'web-push'
import { supabaseAdmin } from './supabaseAdmin'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

let configured = false
function ensureConfigured(): boolean {
  if (configured) return true
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[WebPush] Missing VAPID keys — push disabled')
    return false
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  configured = true
  return true
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

type SubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Send a push notification to every stored admin subscription.
 * Dead subscriptions (410 Gone / 404) are pruned automatically.
 */
export async function sendAdminPush(
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!ensureConfigured()) return { sent: 0, failed: 0 }

  const { data, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')

  if (error) {
    console.error('[WebPush] Failed to load subscriptions:', error)
    return { sent: 0, failed: 0 }
  }

  const subs = (data || []) as SubscriptionRow[]
  if (subs.length === 0) return { sent: 0, failed: 0 }

  const body = JSON.stringify(payload)
  const staleIds: string[] = []
  let sent = 0
  let failed = 0

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body
        )
        sent++
      } catch (err) {
        failed++
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(sub.id)
        } else {
          console.error('[WebPush] Send failed:', statusCode, (err as Error)?.message)
        }
      }
    })
  )

  if (staleIds.length > 0) {
    await supabaseAdmin.from('push_subscriptions').delete().in('id', staleIds)
    console.log('[WebPush] Pruned stale subscriptions', { count: staleIds.length })
  }

  console.log('[WebPush] Push complete', { sent, failed })
  return { sent, failed }
}
