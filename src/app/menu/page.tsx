'use client'
import React, { useEffect, useMemo, useState } from 'react'
import FloatingCartButton from '../../components/CartButton'
import ProductCard, { Product } from '../../components/ProductCard'
import {
  getDefaultStoreSettings,
  getNextOpeningTime,
  isStoreOpenNow,
  normalizeStoreSettings,
} from '../../lib/storeStatus'
import { CategoryRecord, ProductRecord, StoreSettingsRecord } from '../../lib/types'

function mapProduct(record: ProductRecord): Product {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    price: Number(record.price),
    isVeg: Boolean(record.is_veg),
    isAvailable: record.is_available !== false,
    image: record.image_url,
    category: record.category?.name || '',
    addons: record.addons || [],
  }
}

export default function MenuPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [activeCategory, setActiveCategory] = useState('')
  const [vegOnly, setVegOnly] = useState(false)
  const [settings, setSettings] = useState<StoreSettingsRecord>(
    getDefaultStoreSettings()
  )
  const [storeOpen, setStoreOpen] = useState(true)

  useEffect(() => {
    async function loadData() {
      const [productsRes, categoriesRes, settingsRes] = await Promise.all([
        fetch('/api/products').then((response) => response.json()),
        fetch('/api/categories').then((response) => response.json()),
        fetch('/api/store-settings').then((response) => response.json()),
      ])

      const mappedProducts = (productsRes.products || []).map((record: ProductRecord) =>
        mapProduct(record)
      )
      const categoryRows = (categoriesRes.categories || []) as CategoryRecord[]

      setProducts(mappedProducts)
      setCategories(categoryRows)
      const normalizedSettings = normalizeStoreSettings(
        settingsRes as Partial<StoreSettingsRecord>
      )
      setSettings(normalizedSettings)
      setStoreOpen(isStoreOpenNow(normalizedSettings))
    }

    loadData().catch(() => {})
  }, [])

  useEffect(() => {
    const interval = setInterval(
      () => setStoreOpen(isStoreOpenNow(settings)),
      30_000
    )
    return () => clearInterval(interval)
  }, [settings])

  const dedupedProducts = useMemo(() => {
    const byKey = new Map<string, Product>()

    for (const product of products) {
      const key = `${product.name.trim().toLowerCase()}::${(
        product.category || ''
      )
        .trim()
        .toLowerCase()}`
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, product)
        continue
      }

      const existingScore =
        (existing.image ? 3 : 0) +
        (existing.description?.length || 0) +
        (existing.addons?.length || 0)
      const incomingScore =
        (product.image ? 3 : 0) +
        (product.description?.length || 0) +
        (product.addons?.length || 0)
      if (incomingScore > existingScore) {
        byKey.set(key, product)
      }
    }

    return Array.from(byKey.values())
  }, [products])

  const dedupedCategories = useMemo(() => {
    const byName = new Map<string, CategoryRecord>()
    for (const entry of categories) {
      const key = entry.name.trim().toLowerCase()
      if (!key || byName.has(key)) continue
      byName.set(key, entry)
    }
    return Array.from(byName.values())
  }, [categories])

  useEffect(() => {
    if (!activeCategory && dedupedCategories.length) {
      setActiveCategory(dedupedCategories[0].name)
    }
  }, [activeCategory, dedupedCategories])

  useEffect(() => {
    if (
      activeCategory &&
      !dedupedCategories.some((entry) => entry.name === activeCategory)
    ) {
      setActiveCategory('')
    }
  }, [activeCategory, dedupedCategories])

  const canOrder = !settings.force_closed && (storeOpen || settings.allow_preorder)
  const closedMessage = getNextOpeningTime(settings)

  const filteredProducts = useMemo(
    () =>
      dedupedProducts.filter((product) => {
        if (activeCategory && product.category !== activeCategory) return false
        if (vegOnly && !product.isVeg) return false
        return true
      }),
    [dedupedProducts, activeCategory, vegOnly]
  )

  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Our Menu</h1>
        <button
          onClick={() => setVegOnly((value) => !value)}
          className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
            vegOnly
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : 'border-white/10 bg-[#181818] text-gray-400'
          }`}
        >
          <span className="h-3 w-3 rounded-full bg-green-500" />
          Pure Veg
        </button>
      </div>

      {!storeOpen && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          Store is currently closed. {closedMessage}
          {!settings.force_closed && settings.allow_preorder
            ? ' You can still place a pre-order.'
            : ' Add to cart is disabled.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <nav className="md:col-span-1">
          <div className="sticky top-20 space-y-1 rounded-2xl border border-white/10 bg-[#181818] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Categories
            </p>
            {dedupedCategories.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.name)}
                className={`w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeCategory === category.name
                    ? 'bg-white text-black'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </nav>

        <div className="md:col-span-3">
          <h2 className="mb-4 text-lg font-semibold">
            {activeCategory || 'Menu'}
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({filteredProducts.length})
            </span>
          </h2>

          {filteredProducts.length === 0 ? (
            <p className="py-8 text-center text-gray-500">No dishes in this section.</p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  disabled={!canOrder || product.isAvailable === false}
                  disabledTitle={
                    !canOrder ? 'Store Closed' : 'Currently not available'
                  }
                  disabledReason={!canOrder ? closedMessage : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <FloatingCartButton />
    </div>
  )
}
