'use client'
import React from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { useCartStore } from '../store/cart'

export default function FloatingCartButton() {
  const items = useCartStore((s) => s.items)
  const count = items.reduce((a, b) => a + b.qty, 0)
  const total = items.reduce((a, b) => a + b.price * b.qty, 0)

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
        >
          <Link
            href="/cart"
            className="flex items-center gap-4 bg-white text-black pl-5 pr-4 py-3 rounded-2xl shadow-2xl shadow-black/50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="font-bold">{count} item{count > 1 ? 's' : ''}</span>
              <span className="text-gray-400">|</span>
              <span className="font-bold">₹{total}</span>
            </div>
            <span className="bg-black text-white px-3 py-1 rounded-xl text-sm font-semibold">
              View Cart →
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
