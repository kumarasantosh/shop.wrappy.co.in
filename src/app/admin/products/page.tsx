'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { CategoryRecord, ProductAddon, ProductRecord } from '../../../lib/types'

type ProductForm = {
  name: string
  description: string
  price: string
  is_veg: boolean
  is_available: boolean
  category_id: string
  image_url: string
  addonsText: string
}

function parseAddons(value: string): ProductAddon[] {
  return value
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row, index) => {
      const [name, priceRaw] = row.split('|')
      return {
        id: `addon_${Date.now()}_${index}`,
        name: name.trim(),
        price: Number(priceRaw || 0),
      }
    })
    .filter((addon) => addon.name && addon.price >= 0)
}

function addonsToText(addons?: ProductAddon[] | null): string {
  if (!Array.isArray(addons) || addons.length === 0) return ''
  return addons.map((addon) => `${addon.name}|${addon.price}`).join('\n')
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function AdminProducts() {
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [uploadingCreateImage, setUploadingCreateImage] = useState(false)
  const [uploadingEditImage, setUploadingEditImage] = useState(false)
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const [form, setForm] = useState<ProductForm>({
    name: '',
    description: '',
    price: '',
    is_veg: false,
    is_available: true,
    category_id: '',
    image_url: '',
    addonsText: '',
  })
  const [editForm, setEditForm] = useState<ProductForm>({
    name: '',
    description: '',
    price: '',
    is_veg: false,
    is_available: true,
    category_id: '',
    image_url: '',
    addonsText: '',
  })

  const productCountText = useMemo(
    () => `${products.length} product${products.length === 1 ? '' : 's'}`,
    [products.length]
  )

  async function fetchData() {
    setLoading(true)
    const [productsRes, categoriesRes] = await Promise.all([
      fetch('/api/products')
        .then((response) => response.json())
        .catch(() => ({ products: [] })),
      fetch('/api/categories')
        .then((response) => response.json())
        .catch(() => ({ categories: [] })),
    ])

    const categoryRows = (categoriesRes.categories || []) as CategoryRecord[]
    setProducts((productsRes.products || []) as ProductRecord[])
    setCategories(categoryRows)

    if (!form.category_id && categoryRows.length) {
      setForm((prev) => ({ ...prev, category_id: categoryRows[0].id }))
    }
    if (!editForm.category_id && categoryRows.length) {
      setEditForm((prev) => ({ ...prev, category_id: categoryRows[0].id }))
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchData().catch(() => setLoading(false))
  }, [])

  async function uploadImage(file: File, mode: 'create' | 'edit') {
    if (mode === 'create') setUploadingCreateImage(true)
    if (mode === 'edit') setUploadingEditImage(true)
    try {
      const data = await fileToDataUrl(file)
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.url) {
        const message = payload?.error || 'Image upload failed'
        alert(message)
        return
      }
      if (mode === 'create') {
        setForm((prev) => ({ ...prev, image_url: payload.url }))
      } else {
        setEditForm((prev) => ({ ...prev, image_url: payload.url }))
      }
    } finally {
      if (mode === 'create') setUploadingCreateImage(false)
      if (mode === 'edit') setUploadingEditImage(false)
    }
  }

  async function createProduct(event: React.FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.price) return

    setCreating(true)
    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          price: Number(form.price),
          is_veg: form.is_veg,
          is_available: form.is_available,
          category_id: form.category_id || null,
          image_url: form.image_url.trim() || null,
          addons: parseAddons(form.addonsText),
        }),
      })
      if (!response.ok) {
        alert('Failed to create product')
        return
      }

      setForm({
        name: '',
        description: '',
        price: '',
        is_veg: false,
        is_available: true,
        category_id: categories[0]?.id || '',
        image_url: '',
        addonsText: '',
      })
      fetchData()
    } catch {
      alert('Failed to create product')
    } finally {
      setCreating(false)
    }
  }

  function startEdit(product: ProductRecord) {
    setEditingProductId(product.id)
    setEditForm({
      name: product.name,
      description: product.description || '',
      price: String(product.price),
      is_veg: Boolean(product.is_veg),
      is_available: product.is_available !== false,
      category_id: product.category_id || categories[0]?.id || '',
      image_url: product.image_url || '',
      addonsText: addonsToText(product.addons),
    })
  }

  function cancelEdit() {
    setEditingProductId(null)
    setSavingEdit(false)
  }

  async function saveEdit() {
    if (!editingProductId || !editForm.name.trim() || !editForm.price) return

    setSavingEdit(true)
    try {
      const response = await fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingProductId,
          name: editForm.name.trim(),
          description: editForm.description.trim() || null,
          price: Number(editForm.price),
          is_veg: editForm.is_veg,
          is_available: editForm.is_available,
          category_id: editForm.category_id || null,
          image_url: editForm.image_url.trim() || null,
          addons: parseAddons(editForm.addonsText),
        }),
      })

      if (!response.ok) {
        alert('Failed to update product')
        return
      }

      cancelEdit()
      fetchData()
    } finally {
      setSavingEdit(false)
    }
  }

  async function deleteProduct(productId: string, productName: string) {
    const confirmed = window.confirm(`Delete "${productName}"?`)
    if (!confirmed) return

    setDeletingProductId(productId)
    try {
      await fetch(`/api/products?id=${productId}`, { method: 'DELETE' })
      if (editingProductId === productId) cancelEdit()
      fetchData()
    } finally {
      setDeletingProductId(null)
    }
  }

  async function toggleAvailability(product: ProductRecord) {
    const response = await fetch('/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: product.id,
        is_available: product.is_available === false,
      }),
    })

    if (!response.ok) {
      alert('Failed to update availability')
      return
    }

    if (editingProductId === product.id) {
      setEditForm((prev) => ({
        ...prev,
        is_available: product.is_available === false,
      }))
    }
    fetchData()
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Products</h2>
        <p className="text-xs text-gray-500">{productCountText}</p>
      </div>

      <form
        onSubmit={createProduct}
        className="mb-6 space-y-3 rounded-2xl border border-white/10 bg-[#181818] p-5"
      >
        <p className="text-sm font-medium text-gray-400">Add New Product</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            placeholder="Product name"
            value={form.name}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, name: event.target.value }))
            }
            className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600 md:col-span-2"
          />
          <input
            placeholder="Price (₹)"
            value={form.price}
            type="number"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, price: event.target.value }))
            }
            className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
          />

          <input
            placeholder="Description"
            value={form.description}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, description: event.target.value }))
            }
            className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600 md:col-span-2"
          />
          <select
            value={form.category_id}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, category_id: event.target.value }))
            }
            className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
          >
            <option value="">Select category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <textarea
            value={form.addonsText}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, addonsText: event.target.value }))
            }
            placeholder={'Add-ons (one per line):\nExtra Cheese|40\nDip|20'}
            className="h-24 rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600 md:col-span-2"
          />

          <div className="space-y-2">
            <input
              value={form.image_url}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, image_url: event.target.value }))
              }
              placeholder="Image URL (optional)"
              className="w-full rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
            />
            <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-[#222] px-3 py-2 text-center text-xs text-gray-400">
              {uploadingCreateImage ? 'Uploading...' : 'Upload image'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) uploadImage(file, 'create')
                }}
              />
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={form.is_veg}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, is_veg: event.target.checked }))
              }
              className="rounded"
            />
            Veg item
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={form.is_available}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  is_available: event.target.checked,
                }))
              }
              className="rounded"
            />
            Available now
          </label>
          <button
            type="submit"
            disabled={creating}
            className="ml-auto rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-gray-200 disabled:opacity-60"
          >
            {creating ? 'Adding...' : 'Add Product'}
          </button>
        </div>
      </form>

      <div className="space-y-2">
        {loading ? (
          <div className="py-8 text-sm text-gray-500">Loading products...</div>
        ) : products.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">No products yet</div>
        ) : (
          products.map((product) => {
            const isEditing = editingProductId === product.id
            return (
              <div
                key={product.id}
                className="rounded-xl border border-white/10 bg-[#181818] p-4"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-14 overflow-hidden rounded-lg bg-[#222]">
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm text-gray-500">
                        ₹{product.price} • {product.category?.name || 'Uncategorized'}
                      </p>
                      {Array.isArray(product.addons) && product.addons.length > 0 && (
                        <p className="text-xs text-gray-600">
                          Add-ons: {product.addons.length}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        product.is_veg
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {product.is_veg ? 'Veg' : 'Non-Veg'}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        product.is_available === false
                          ? 'bg-amber-500/10 text-amber-300'
                          : 'bg-emerald-500/10 text-emerald-300'
                      }`}
                    >
                      {product.is_available === false
                        ? 'Currently not available'
                        : 'Available'}
                    </span>
                    <button
                      onClick={() => toggleAvailability(product)}
                      className="rounded-lg border border-white/10 bg-[#222] px-3 py-1.5 text-xs text-white"
                    >
                      {product.is_available === false ? 'Enable' : 'Disable'}
                    </button>
                    <button
                      onClick={() => startEdit(product)}
                      className="rounded-lg border border-white/10 bg-[#222] px-3 py-1.5 text-xs text-white"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteProduct(product.id, product.name)}
                      disabled={deletingProductId === product.id}
                      className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 disabled:opacity-60"
                    >
                      {deletingProductId === product.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 grid grid-cols-1 gap-3 border-t border-white/10 pt-4 md:grid-cols-3">
                    <input
                      placeholder="Product name"
                      value={editForm.name}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, name: event.target.value }))
                      }
                      className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600 md:col-span-2"
                    />
                    <input
                      placeholder="Price (₹)"
                      type="number"
                      value={editForm.price}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, price: event.target.value }))
                      }
                      className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
                    />
                    <input
                      placeholder="Description"
                      value={editForm.description}
                      onChange={(event) =>
                        setEditForm((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                      className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600 md:col-span-2"
                    />
                    <select
                      value={editForm.category_id}
                      onChange={(event) =>
                        setEditForm((prev) => ({
                          ...prev,
                          category_id: event.target.value,
                        }))
                      }
                      className="rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white"
                    >
                      <option value="">Select category</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={editForm.addonsText}
                      onChange={(event) =>
                        setEditForm((prev) => ({
                          ...prev,
                          addonsText: event.target.value,
                        }))
                      }
                      placeholder={'Add-ons (one per line):\nExtra Cheese|40\nDip|20'}
                      className="h-24 rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600 md:col-span-2"
                    />
                    <div className="space-y-2">
                      <input
                        value={editForm.image_url}
                        onChange={(event) =>
                          setEditForm((prev) => ({
                            ...prev,
                            image_url: event.target.value,
                          }))
                        }
                        placeholder="Image URL (optional)"
                        className="w-full rounded-xl border border-white/10 bg-[#222] p-3 text-sm text-white placeholder:text-gray-600"
                      />
                      <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-[#222] px-3 py-2 text-center text-xs text-gray-400">
                        {uploadingEditImage ? 'Uploading...' : 'Upload image'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (file) uploadImage(file, 'edit')
                          }}
                        />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-400 md:col-span-3">
                      <input
                        type="checkbox"
                        checked={editForm.is_veg}
                        onChange={(event) =>
                          setEditForm((prev) => ({
                            ...prev,
                            is_veg: event.target.checked,
                          }))
                        }
                        className="rounded"
                      />
                      Veg item
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-400 md:col-span-3">
                      <input
                        type="checkbox"
                        checked={editForm.is_available}
                        onChange={(event) =>
                          setEditForm((prev) => ({
                            ...prev,
                            is_available: event.target.checked,
                          }))
                        }
                        className="rounded"
                      />
                      Available now
                    </label>

                    <div className="flex items-center justify-end gap-2 md:col-span-3">
                      <button
                        onClick={cancelEdit}
                        className="rounded-lg border border-white/10 bg-[#222] px-4 py-2 text-sm text-white"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={savingEdit}
                        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                      >
                        {savingEdit ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
