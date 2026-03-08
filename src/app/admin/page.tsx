'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '../../components/ui/card'

type DashboardStats = {
  orders: number
  activeOrders: number
  revenue: number
  products: number
  categories: number
  coupons: number
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    orders: 0,
    activeOrders: 0,
    revenue: 0,
    products: 0,
    categories: 0,
    coupons: 0,
  })

  useEffect(() => {
    async function load() {
      const [ordersRes, productsRes, categoriesRes, couponsRes] = await Promise.all([
        fetch('/api/admin/orders')
          .then((response) => response.json())
          .catch(() => ({ orders: [] })),
        fetch('/api/products')
          .then((response) => response.json())
          .catch(() => ({ products: [] })),
        fetch('/api/categories')
          .then((response) => response.json())
          .catch(() => ({ categories: [] })),
        fetch('/api/coupons')
          .then((response) => response.json())
          .catch(() => ({ coupons: [] })),
      ])

      const orders = ordersRes.orders || []
      const revenue = orders.reduce(
        (sum: number, order: any) => sum + Number(order.total || 0),
        0
      )
      const activeOrders = orders.filter(
        (order: any) => !['delivered', 'cancelled'].includes(order.status)
      ).length

      setStats({
        orders: orders.length,
        activeOrders,
        revenue,
        products: productsRes.products?.length || 0,
        categories: categoriesRes.categories?.length || 0,
        coupons: couponsRes.coupons?.length || 0,
      })
    }
    load()
  }, [])

  const cards = useMemo(
    () => [
      {
        label: 'Total Orders',
        value: stats.orders,
        subLabel: `${stats.activeOrders} active`,
        icon: '📦',
      },
      {
        label: 'Revenue',
        value: `₹${Math.round(stats.revenue)}`,
        subLabel: 'Gross sales',
        icon: '💰',
      },
      {
        label: 'Products',
        value: stats.products,
        subLabel: `${stats.categories} categories`,
        icon: '🍽️',
      },
      {
        label: 'Coupons',
        value: stats.coupons,
        subLabel: 'Live campaigns',
        icon: '🎟️',
      },
    ],
    [stats]
  )

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Dashboard</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-6">
            <div className="mb-3 text-3xl">{card.icon}</div>
            <p className="text-3xl font-bold">{card.value}</p>
            <p className="mt-1 text-sm text-gray-500">{card.label}</p>
            <p className="mt-2 text-xs text-gray-600">{card.subLabel}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
