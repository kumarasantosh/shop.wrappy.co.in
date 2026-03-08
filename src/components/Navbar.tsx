'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCartStore } from '../store/cart'
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from '@clerk/nextjs'

export default function Navbar() {
  const { user, isLoaded } = useUser()
  const items = useCartStore((s) => s.items)
  const count = items.reduce((a, b) => a + b.qty, 0)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function checkAdminAccess() {
      if (!isLoaded || !user?.id) {
        setIsAdmin(false)
        return
      }

      try {
        const response = await fetch('/api/admin/access', { cache: 'no-store' })
        if (cancelled) return
        if (!response.ok) {
          setIsAdmin(false)
          return
        }
        const payload = await response.json()
        if (cancelled) return
        setIsAdmin(Boolean(payload?.admin))
      } catch {
        if (!cancelled) {
          setIsAdmin(false)
        }
      }
    }

    checkAdminAccess().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isLoaded, user?.id])

  function closeMobileMenu() {
    setMobileOpen(false)
  }

  return (
    <header className="sticky top-0 z-50 bg-[#0F0F0F]/80 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Wrappy
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-gray-400">
          <Link href="/" className="hover:text-white transition-colors">Home</Link>
          <Link href="/menu" className="hover:text-white transition-colors">Menu</Link>
          <Link href="/orders" className="hover:text-white transition-colors">Orders</Link>
          {isAdmin ? (
            <Link href="/admin" className="hover:text-white transition-colors">Admin</Link>
          ) : null}
        </nav>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen((previous) => !previous)}
            className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#181818] text-white"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {mobileOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>

          <Link
            href="/cart"
            onClick={closeMobileMenu}
            className="relative rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-gray-200"
          >
            Cart
            {count > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                {count}
              </span>
            )}
          </Link>

          <SignedOut>
            <SignInButton mode="modal">
              <button
                type="button"
                className="rounded-full border border-white/10 px-4 py-2 text-xs text-gray-300"
              >
                Sign In
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-white/10 bg-[#121212]">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-2 text-sm text-gray-300">
            <Link
              href="/"
              onClick={closeMobileMenu}
              className="rounded-lg px-3 py-2 transition-colors hover:bg-white/5 hover:text-white"
            >
              Home
            </Link>
            <Link
              href="/menu"
              onClick={closeMobileMenu}
              className="rounded-lg px-3 py-2 transition-colors hover:bg-white/5 hover:text-white"
            >
              Menu
            </Link>
            <Link
              href="/orders"
              onClick={closeMobileMenu}
              className="rounded-lg px-3 py-2 transition-colors hover:bg-white/5 hover:text-white"
            >
              Orders
            </Link>
            {isAdmin ? (
              <Link
                href="/admin"
                onClick={closeMobileMenu}
                className="rounded-lg px-3 py-2 transition-colors hover:bg-white/5 hover:text-white"
              >
                Admin
              </Link>
            ) : null}
          </nav>
        </div>
      )}
    </header>
  )
}
