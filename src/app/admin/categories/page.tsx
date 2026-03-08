'use client'
import React, { useEffect, useState } from 'react'
import { CategoryRecord } from '../../../lib/types'

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [name, setName] = useState('')
  const [position, setPosition] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)

  async function fetchCategories() {
    const response = await fetch('/api/categories')
    const payload = await response.json()
    setCategories((payload.categories || []) as CategoryRecord[])
  }

  useEffect(() => {
    fetchCategories().catch(() => {})
  }, [])

  async function createCategory(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          position: Number(position || categories.length + 1),
        }),
      })
      setName('')
      setPosition('')
      fetchCategories()
    } finally {
      setLoading(false)
    }
  }

  async function updateCategory(
    id: string,
    updates: Partial<Pick<CategoryRecord, 'name' | 'position'>>
  ) {
    setSavingCategoryId(id)
    try {
      await fetch('/api/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      })
      fetchCategories()
    } finally {
      setSavingCategoryId(null)
    }
  }

  async function deleteCategory(id: string) {
    const confirmed = window.confirm('Delete this category?')
    if (!confirmed) return

    setDeletingCategoryId(id)
    try {
      await fetch(`/api/categories?id=${id}`, { method: 'DELETE' })
      fetchCategories()
    } finally {
      setDeletingCategoryId(null)
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Categories</h2>

      <form
        onSubmit={createCategory}
        className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-[#181818] p-5 md:grid-cols-3"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Category name"
          className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
        />
        <input
          value={position}
          onChange={(event) => setPosition(event.target.value)}
          placeholder="Position"
          type="number"
          className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-gray-200 disabled:opacity-60"
        >
          {loading ? 'Adding...' : 'Add Category'}
        </button>
      </form>

      <div className="space-y-2">
        {categories.map((category) => (
          <div
            key={category.id}
            className="grid grid-cols-1 items-center gap-3 rounded-xl border border-white/10 bg-[#181818] p-4 md:grid-cols-[1fr_140px_220px]"
          >
            <input
              value={category.name}
              onChange={(event) =>
                setCategories((prev) =>
                  prev.map((entry) =>
                    entry.id === category.id
                      ? { ...entry, name: event.target.value }
                      : entry
                  )
                )
              }
              className="rounded-lg border border-white/10 bg-[#222] px-3 py-2 text-sm text-white"
            />
            <input
              type="number"
              value={category.position}
              onChange={(event) =>
                setCategories((prev) =>
                  prev.map((entry) =>
                    entry.id === category.id
                      ? { ...entry, position: Number(event.target.value || 0) }
                      : entry
                  )
                )
              }
              className="rounded-lg border border-white/10 bg-[#222] px-3 py-2 text-sm text-white"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  updateCategory(category.id, {
                    name: category.name.trim(),
                    position: Number(category.position || 0),
                  })
                }
                disabled={savingCategoryId === category.id}
                className="flex-1 rounded-lg border border-white/10 bg-[#222] px-3 py-2 text-sm text-white disabled:opacity-60"
              >
                {savingCategoryId === category.id ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => deleteCategory(category.id)}
                disabled={deletingCategoryId === category.id}
                className="flex-1 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300 disabled:opacity-60"
              >
                {deletingCategoryId === category.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        ))}

        {!categories.length && (
          <p className="py-8 text-center text-sm text-gray-500">No categories found.</p>
        )}
      </div>
    </div>
  )
}
