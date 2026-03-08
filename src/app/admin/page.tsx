'use client'
import Link from 'next/link'
import React, { useEffect, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import { OrderRecord } from '../../lib/types'

type CountPayload = {
  products: number
  categories: number
  coupons: number
}

type SimpleOrder = Pick<
  OrderRecord,
  'id' | 'status' | 'total' | 'phone' | 'created_at' | 'payment_status'
>

function formatMoney(value: number) {
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

function isSameLocalDay(dateString: string, today: Date) {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return false
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

function orderStatusLabel(status: string) {
  if (status === 'delivered') return 'Delivered'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'out_for_delivery') return 'Out for delivery'
  if (status === 'preparing') return 'Preparing'
  return 'Placed'
}

export default function AdminDashboard() {
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [counts, setCounts] = useState<CountPayload>({
    products: 0,
    categories: 0,
    coupons: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isCancelled = false

    async function load() {
      setLoading(true)
      setError('')

      const [ordersRes, productsRes, categoriesRes, couponsRes] = await Promise.all([
        fetch('/api/admin/orders')
          .then((response) => (response.ok ? response.json() : { orders: [] }))
          .catch(() => ({ orders: [] })),
        fetch('/api/products')
          .then((response) => (response.ok ? response.json() : { products: [] }))
          .catch(() => ({ products: [] })),
        fetch('/api/categories')
          .then((response) =>
            response.ok ? response.json() : { categories: [] }
          )
          .catch(() => ({ categories: [] })),
        fetch('/api/coupons')
          .then((response) => (response.ok ? response.json() : { coupons: [] }))
          .catch(() => ({ coupons: [] })),
      ])

      if (isCancelled) return

      const nextOrders = Array.isArray(ordersRes.orders)
        ? (ordersRes.orders as OrderRecord[])
        : []

      setOrders(nextOrders)
      setCounts({
        products: Array.isArray(productsRes.products) ? productsRes.products.length : 0,
        categories: Array.isArray(categoriesRes.categories)
          ? categoriesRes.categories.length
          : 0,
        coupons: Array.isArray(couponsRes.coupons) ? couponsRes.coupons.length : 0,
      })

      if (!ordersRes.orders) {
        setError('Some dashboard sections could not be loaded.')
      }
      setLoading(false)
    }

    load().catch(() => {
      if (isCancelled) return
      setError('Failed to load dashboard data.')
      setLoading(false)
    })

    return () => {
      isCancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    const today = new Date()
    const activeStatuses = new Set(['placed', 'preparing', 'out_for_delivery'])
    const completedStatuses = new Set(['delivered', 'cancelled'])

    let todaySales = 0
    let totalSales = 0
    let todayOrders = 0
    let activeOrders = 0
    let deliveredOrders = 0
    let cancelledOrders = 0
    let pendingPayments = 0
    let nonCancelledOrders = 0

    for (const order of orders) {
      const total = Number(order.total || 0)
      const isToday = isSameLocalDay(order.created_at, today)
      const isCancelled = order.status === 'cancelled'

      if (activeStatuses.has(order.status)) activeOrders += 1
      if (order.status === 'delivered') deliveredOrders += 1
      if (isCancelled) cancelledOrders += 1
      if (isToday) todayOrders += 1
      if (order.payment_status !== 'paid') pendingPayments += 1

      if (!isCancelled) {
        totalSales += total
        nonCancelledOrders += 1
        if (isToday) todaySales += total
      }
    }

    const averageOrderValue =
      nonCancelledOrders > 0 ? totalSales / nonCancelledOrders : 0

    const previousOrders = orders
      .filter((order) => completedStatuses.has(order.status))
      .slice(0, 7)
      .map((order) => ({
        id: order.id,
        status: order.status,
        total: order.total,
        phone: order.phone,
        created_at: order.created_at,
        payment_status: order.payment_status,
      })) as SimpleOrder[]

    return {
      todaySales,
      totalSales,
      todayOrders,
      totalOrders: orders.length,
      activeOrders,
      deliveredOrders,
      cancelledOrders,
      pendingPayments,
      averageOrderValue,
      previousOrders,
      products: counts.products,
      categories: counts.categories,
      coupons: counts.coupons,
    }
  }, [counts.categories, counts.coupons, counts.products, orders])

  const cards = useMemo(
    () => [
      {
        label: "Today's Sales",
        value: formatMoney(stats.todaySales),
        subLabel: `${stats.todayOrders} order${stats.todayOrders !== 1 ? 's' : ''} today`,
        icon: '📅',
      },
      {
        label: 'Total Sales',
        value: formatMoney(stats.totalSales),
        subLabel: `${stats.deliveredOrders} delivered`,
        icon: '💰',
      },
      {
        label: 'Total Orders',
        value: stats.totalOrders,
        subLabel: `${stats.activeOrders} active now`,
        icon: '📦',
      },
      {
        label: 'Average Order Value',
        value: formatMoney(Math.round(stats.averageOrderValue)),
        subLabel: 'Across non-cancelled orders',
        icon: '🧾',
      },
      {
        label: 'Menu Coverage',
        value: stats.products,
        subLabel: `${stats.categories} categories`,
        icon: '🍽️',
      },
      {
        label: 'More Options',
        value: stats.coupons,
        subLabel: `${stats.pendingPayments} pending payments`,
        icon: '⚙️',
      },
    ],
    [stats]
  )

  const quickActions = [
    {
      href: '/admin/orders',
      title: 'View Live Orders',
      subtitle: 'Accept, reject, and complete orders',
    },
    {
      href: '/admin/products',
      title: 'Manage Products',
      subtitle: 'Update availability and pricing',
    },
    {
      href: '/admin/coupons',
      title: 'Run Campaigns',
      subtitle: 'Create and manage coupon offers',
    },
    {
      href: '/admin/settings',
      title: 'Store Settings',
      subtitle: 'Hours, closure, and delivery timing',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <p className="mt-1 text-xs text-gray-500">
          Track today&apos;s sales, previous orders, and key store actions.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-6">
              <div className="mb-3 text-3xl">{card.icon}</div>
              <p className="text-3xl font-bold">{loading ? '--' : card.value}</p>
              <p className="mt-1 text-sm text-gray-500">{card.label}</p>
              <p className="mt-2 text-xs text-gray-600">{loading ? 'Loading...' : card.subLabel}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Previous Orders</h3>
              <Badge className="bg-white/10 text-gray-300">
                {stats.previousOrders.length} recent
              </Badge>
            </div>

            {stats.previousOrders.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-5 text-sm text-gray-500">
                No previous orders yet.
              </p>
            ) : (
              <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.02]">
                {stats.previousOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-white">#{order.id.slice(0, 8)}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {new Date(order.created_at).toLocaleString([], {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                        {' · '}
                        {order.phone || 'No phone'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={order.status === 'cancelled' ? 'danger' : 'success'}
                        className="capitalize"
                      >
                        {orderStatusLabel(order.status)}
                      </Badge>
                      <p className="text-sm font-semibold text-white">
                        {formatMoney(Number(order.total || 0))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h3 className="text-lg font-semibold">More Options</h3>
            <p className="text-xs text-gray-500">
              Quick access to common admin actions.
            </p>

            <div className="space-y-2">
              {quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.08]"
                >
                  <p className="text-sm font-medium text-white">{action.title}</p>
                  <p className="mt-1 text-xs text-gray-500">{action.subtitle}</p>
                </Link>
              ))}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-gray-400">
              <p>Cancelled orders: {stats.cancelledOrders}</p>
              <p className="mt-1">Pending payments: {stats.pendingPayments}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
