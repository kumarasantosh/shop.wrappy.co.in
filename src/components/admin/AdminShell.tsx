'use client'
import React, { useEffect, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

type Role = 'super' | 'admin' | 'staff' | null

type NavItem = { href: string; label: string; icon: string; roles: Role[] }

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: '📊', roles: ['super'] },
  { href: '/admin/categories', label: 'Categories', icon: '🧾', roles: ['super'] },
  { href: '/admin/products', label: 'Products', icon: '🍽️', roles: ['super'] },
  { href: '/admin/branches', label: 'Branches', icon: '🏬', roles: ['super', 'admin'] },
  { href: '/admin/menu', label: 'Branch Menu', icon: '🍔', roles: ['super', 'admin', 'staff'] },
  { href: '/admin/coupons', label: 'Coupons', icon: '🎟️', roles: ['super'] },
  { href: '/admin/orders', label: 'Orders', icon: '📦', roles: ['super', 'admin', 'staff'] },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️', roles: ['super'] },
]

// Find the nav entry that owns a given path (exact for '/admin', prefix for the rest).
function navItemForPath(pathname: string): NavItem | undefined {
  if (pathname === '/admin') return NAV.find((i) => i.href === '/admin')
  return NAV.find((i) => i.href !== '/admin' && (pathname === i.href || pathname.startsWith(i.href + '/')))
}

export default function AdminShell({
  children,
  role = 'super',
  isSuperAdmin = true,
}: {
  children: React.ReactNode
  role?: Role
  isSuperAdmin?: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const effectiveRole: Role = isSuperAdmin ? 'super' : role
  const nav = useMemo(() => NAV.filter((item) => item.roles.includes(effectiveRole)), [effectiveRole])

  // Landing page for this role: owners → Dashboard, branch staff/admins → Orders.
  const homeHref = effectiveRole === 'super' ? '/admin' : '/admin/orders'

  // Is the current page permitted for this role?
  const currentItem = navItemForPath(pathname)
  const allowed = !currentItem || currentItem.roles.includes(effectiveRole)

  // Hard-guard direct URL access: bounce a staff/branch user off any page their
  // role can't see (e.g. Products, Settings) to their own landing page.
  useEffect(() => {
    if (!allowed) router.replace(homeHref)
  }, [allowed, homeHref, router])

  if (!allowed) {
    return (
      <div className="py-20 text-center text-sm text-gray-500">Redirecting…</div>
    )
  }

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
            {nav.map((item) => (
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

