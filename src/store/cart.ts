'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ProductAddon } from '../lib/types'

export type CartItem = {
  lineId: string
  id: string
  name: string
  basePrice: number
  price: number
  qty: number
  image?: string
  isVeg?: boolean
  addons?: ProductAddon[]
  note?: string
}

type CartState = {
  items: CartItem[]
  couponCode: string
  addItem: (item: CartItem) => void
  removeItem: (lineId: string) => void
  updateQty: (lineId: string, qty: number) => void
  clear: () => void
  setCouponCode: (couponCode: string) => void
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      couponCode: '',
      addItem: (item) =>
        set((state) => {
          const existing = state.items.find((entry) => entry.lineId === item.lineId)
          if (existing) {
            return {
              items: state.items.map((entry) =>
                entry.lineId === item.lineId
                  ? { ...entry, qty: entry.qty + item.qty }
                  : entry
              ),
            }
          }
          return { items: [...state.items, item] }
        }),
      removeItem: (lineId) =>
        set((state) => ({ items: state.items.filter((entry) => entry.lineId !== lineId) })),
      updateQty: (lineId, qty) =>
        set((state) => ({
          items:
            qty <= 0
              ? state.items.filter((entry) => entry.lineId !== lineId)
              : state.items.map((entry) =>
                  entry.lineId === lineId ? { ...entry, qty } : entry
                ),
        })),
      clear: () => set({ items: [], couponCode: '' }),
      setCouponCode: (couponCode) => set({ couponCode }),
    }),
    {
      name: 'wrappy-cart',
      version: 2,
      migrate: (persisted: any) => {
        const items = Array.isArray(persisted?.items) ? persisted.items : []
        return {
          couponCode: String(persisted?.couponCode || ''),
          items: items.map((item: any, index: number) => ({
            lineId: String(item.lineId || `${item.id || 'item'}::legacy::${index}`),
            id: String(item.id || ''),
            name: String(item.name || ''),
            basePrice: Number(item.basePrice || item.price || 0),
            price: Number(item.price || 0),
            qty: Number(item.qty || 1),
            image: item.image,
            isVeg: item.isVeg,
            addons: item.addons || [],
            note: item.note,
          })),
        }
      },
    }
  )
)
