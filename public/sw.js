/* Wrappy admin push service worker.
   Receives new-order push messages and shows a notification even when no
   admin tab is open or focused. */

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'New order', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'New order'
  const options = {
    body: data.body || 'You have a new order',
    tag: data.tag || 'wrappy-new-order',
    renotify: true,
    requireInteraction: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/admin/orders' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/admin/orders'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing admin tab if one is open.
      for (const client of clientList) {
        if (client.url.includes('/admin/orders') && 'focus' in client) {
          return client.focus()
        }
      }
      // Otherwise open a new one.
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    })
  )
})
