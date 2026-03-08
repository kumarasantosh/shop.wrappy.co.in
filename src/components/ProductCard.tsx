'use client'
import React, { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ProductAddon } from '../lib/types'
import { useCartStore } from '../store/cart'

export type Product = {
  id: string
  name: string
  description?: string | null
  price: number
  isVeg: boolean
  isAvailable?: boolean
  image?: string | null
  category?: string
  addons?: ProductAddon[]
}

function toLineId(productId: string, addonIds: string[], note: string) {
  const addonsKey = addonIds.sort().join(',')
  const noteKey = note.trim().toLowerCase()
  return `${productId}::${addonsKey}::${noteKey}`
}

export default function ProductCard({
  product,
  disabled,
  disabledTitle,
  disabledReason,
}: {
  product: Product
  disabled?: boolean
  disabledTitle?: string
  disabledReason?: string
}) {
  const addItem = useCartStore((state) => state.addItem)
  const items = useCartStore((state) => state.items)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([])
  const [note, setNote] = useState('')

  const addons = product.addons || []
  const addonTotal = useMemo(
    () =>
      addons
        .filter((addon) => selectedAddonIds.includes(addon.id))
        .reduce((sum, addon) => sum + Number(addon.price), 0),
    [addons, selectedAddonIds]
  )
  const finalPrice = product.price + addonTotal
  const lineId = toLineId(product.id, selectedAddonIds, note)
  const inCart = items.find((item) => item.lineId === lineId)
  const disabledHeading = disabledTitle || 'Currently not available'

  function addSimpleItem() {
    const itemLineId = toLineId(product.id, [], '')
    addItem({
      lineId: itemLineId,
      id: product.id,
      name: product.name,
      basePrice: product.price,
      price: product.price,
      qty: 1,
      image: product.image || undefined,
      isVeg: product.isVeg,
      addons: [],
    })
  }

  function toggleAddon(addonId: string) {
    setSelectedAddonIds((prev) =>
      prev.includes(addonId)
        ? prev.filter((item) => item !== addonId)
        : [...prev, addonId]
    )
  }

  function handleAddCustomItem() {
    const selectedAddons = addons.filter((addon) =>
      selectedAddonIds.includes(addon.id)
    )

    addItem({
      lineId,
      id: product.id,
      name: product.name,
      basePrice: product.price,
      price: finalPrice,
      qty: 1,
      image: product.image || undefined,
      isVeg: product.isVeg,
      addons: selectedAddons,
      note: note.trim() || undefined,
    })

    setIsModalOpen(false)
    setSelectedAddonIds([])
    setNote('')
  }

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[#181818] shadow-[0_20px_50px_-32px_rgba(0,0,0,0.85)] transition-all ${
          disabled ? 'opacity-60' : 'hover:border-white/20'
        }`}
      >
        <div className="relative h-44 overflow-hidden bg-[#111]">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl text-gray-700">
              🍽️
            </div>
          )}

          <div className="absolute left-3 top-3">
            <div
              className={`flex h-5 w-5 items-center justify-center rounded-sm border-2 ${
                product.isVeg ? 'border-green-500' : 'border-red-500'
              }`}
            >
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  product.isVeg ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
            </div>
          </div>

          {disabled && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-4 text-center">
              <div>
                <p className="text-sm font-semibold text-white">{disabledHeading}</p>
                {disabledReason && (
                  <p className="mt-1 text-xs text-gray-200">{disabledReason}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-semibold">{product.name}</h3>
              {product.description && (
                <p className="mt-1 line-clamp-2 text-sm text-gray-400">
                  {product.description}
                </p>
              )}
            </div>
            <span className="whitespace-nowrap text-base font-bold">₹{product.price}</span>
          </div>

          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                product.isVeg
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-red-500/10 text-red-400'
              }`}
            >
              {product.isVeg ? 'Veg' : 'Non-Veg'}
            </span>

            {disabled ? (
              <span className="text-xs text-gray-500">Currently not available</span>
            ) : addons.length > 0 ? (
              <button
                onClick={() => setIsModalOpen(true)}
                className="rounded-lg bg-white px-5 py-1.5 text-sm font-semibold text-black transition-colors hover:bg-gray-200"
              >
                Customize
              </button>
            ) : inCart ? (
              <div className="flex items-center gap-3 rounded-lg bg-white px-1">
                <button
                  onClick={() =>
                    useCartStore.getState().updateQty(inCart.lineId, inCart.qty - 1)
                  }
                  className="flex h-7 w-7 items-center justify-center text-lg font-bold text-black"
                >
                  −
                </button>
                <span className="text-sm font-semibold text-black">{inCart.qty}</span>
                <button
                  onClick={() =>
                    useCartStore.getState().updateQty(inCart.lineId, inCart.qty + 1)
                  }
                  className="flex h-7 w-7 items-center justify-center text-lg font-bold text-black"
                >
                  +
                </button>
              </div>
            ) : (
              <button
                onClick={addSimpleItem}
                className="rounded-lg bg-white px-5 py-1.5 text-sm font-semibold text-black transition-colors hover:bg-gray-200"
              >
                Add
              </button>
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {isModalOpen && !disabled && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 sm:items-center"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121212] p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{product.name}</p>
                  <p className="text-xs text-gray-400">Base price: ₹{product.price}</p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg px-2 py-1 text-sm text-gray-400 hover:bg-white/5 hover:text-white"
                >
                  Close
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Add-ons
                </p>
                {addons.map((addon) => (
                  <label
                    key={addon.id}
                    className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2"
                  >
                    <span className="text-sm">{addon.name}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-sm text-gray-300">+₹{addon.price}</span>
                      <input
                        type="checkbox"
                        checked={selectedAddonIds.includes(addon.id)}
                        onChange={() => toggleAddon(addon.id)}
                        className="h-4 w-4 rounded border-white/30 bg-[#111]"
                      />
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Notes (optional)
                </label>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Less spicy, no onions..."
                  className="w-full rounded-xl border border-white/10 bg-[#1a1a1a] px-3 py-2 text-sm text-white placeholder:text-gray-500"
                />
              </div>

              <button
                onClick={handleAddCustomItem}
                className="mt-5 w-full rounded-xl bg-white py-3 text-sm font-semibold text-black transition-colors hover:bg-gray-200"
              >
                Add for ₹{finalPrice}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
