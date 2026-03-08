'use client'
import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: '📊' },
  { href: '/admin/categories', label: 'Categories', icon: '🧾' },
  { href: '/admin/products', label: 'Products', icon: '🍽️' },
  { href: '/admin/coupons', label: 'Coupons', icon: '🎟️' },
  { href: '/admin/orders', label: 'Orders', icon: '📦' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
]

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <Link
          href="/"
          className="text-sm text-gray-500 transition-colors hover:text-white"
        >
          ← Back to Store
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <nav className="md:col-span-1">
          <div className="sticky top-20 space-y-1 rounded-2xl border border-white/10 bg-[#181818] p-3">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  pathname === item.href
                    ? 'bg-white text-black'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="md:col-span-4">{children}</div>
      </div>
    </div>
  )
}

