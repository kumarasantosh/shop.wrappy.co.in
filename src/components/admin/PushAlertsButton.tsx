'use client'
import React, { useEffect, useState } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

type State = 'unsupported' | 'unconfigured' | 'default' | 'granted' | 'denied' | 'working'

/**
 * Lets an admin enable background push alerts for new orders. Registers the
 * service worker, asks for notification permission, subscribes to push, and
 * stores the subscription on the server so it fires even with no tab open.
 */
export default function PushAlertsButton() {
  const [state, setState] = useState<State>('default')
  const [testResult, setTestResult] = useState('')

  // Fires a real push through the server and reports the precise failure:
  // missing server VAPID keys, no stored subscriptions, or send errors.
  async function sendTestPush() {
    try {
      setTestResult('testing…')
      const res = await fetch('/api/admin/push/test', { method: 'POST' })
      const d = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) setTestResult('test failed')
      else if (!d.configured) setTestResult('server keys missing')
      else if (!d.subscriptions) setTestResult('no devices saved')
      else if (!d.sent) setTestResult('send failed')
      else setTestResult(`sent to ${d.sent} device${Number(d.sent) !== 1 ? 's' : ''}`)
    } catch {
      setTestResult('test failed')
    }
    setTimeout(() => setTestResult(''), 6000)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported')
      return
    }
    if (!VAPID_PUBLIC_KEY) {
      setState('unconfigured')
      return
    }
    // Reflect current permission, and confirm an active subscription exists.
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    // Register on every load: keeps the service worker updated after deploys
    // and makes `.ready` resolve even before the user clicks Enable.
    navigator.serviceWorker.register('/sw.js').catch(() => { })
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (sub && Notification.permission === 'granted') {
          setState('granted')
          // Self-heal: re-upsert the subscription on the server. Covers the
          // case where the browser still holds a subscription but the server
          // row was lost/pruned — which silently kills notifications while
          // the chip still says "Alerts on".
          fetch('/api/admin/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub.toJSON()),
          }).catch(() => { })
        } else {
          setState('default')
        }
      })
      .catch(() => setState('default'))
  }, [])

  async function enable() {
    try {
      setState('working')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'default')
        return
      }

      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        })
      }

      const res = await fetch('/api/admin/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error('subscribe failed')
      setState('granted')
    } catch {
      setState('default')
    }
  }

  if (state === 'unsupported' || state === 'unconfigured') return null

  if (state === 'granted') {
    return (
      <button
        type="button"
        onClick={sendTestPush}
        title="Click to send a test notification"
        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-400 transition-all hover:bg-emerald-500/25 active:scale-[0.97]"
      >
        🔔 {testResult || 'Alerts on'}
      </button>
    )
  }

  if (state === 'denied') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-gray-500/15 px-2.5 py-1 text-[11px] font-medium text-gray-400"
        title="Notifications are blocked in your browser settings. Enable them for this site to receive order alerts."
      >
        🔕 Alerts blocked
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={enable}
      disabled={state === 'working'}
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-300 transition-all hover:bg-amber-500/20 active:scale-[0.97] disabled:opacity-60"
    >
      🔔 {state === 'working' ? 'Enabling…' : 'Enable alerts'}
    </button>
  )
}
