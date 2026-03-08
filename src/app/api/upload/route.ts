import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../lib/admin'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

const PRODUCT_IMAGES_BUCKET = 'product-images'

async function ensureProductImagesBucket() {
  const { data: buckets, error: bucketsError } = await supabaseAdmin.storage.listBuckets()
  if (bucketsError) return

  const existing = (buckets || []).find((bucket) => bucket.id === PRODUCT_IMAGES_BUCKET)
  if (!existing) {
    await supabaseAdmin.storage.createBucket(PRODUCT_IMAGES_BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/avif'],
    })
    return
  }

  if (!existing.public) {
    await supabaseAdmin.storage.updateBucket(PRODUCT_IMAGES_BUCKET, {
      public: true,
      fileSizeLimit: existing.file_size_limit ?? 5 * 1024 * 1024,
      allowedMimeTypes:
        existing.allowed_mime_types ?? ['image/png', 'image/jpeg', 'image/webp', 'image/avif'],
    })
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const body = (await req.json()) as { name?: string; data?: string }
    const { name, data } = body
    if (!name || !data) {
      return NextResponse.json({ error: 'missing_name_or_data' }, { status: 400 })
    }

    const matches = String(data).match(/^data:(.+);base64,(.+)$/)
    if (!matches) {
      return NextResponse.json({ error: 'invalid_data' }, { status: 400 })
    }

    const mime = matches[1]
    const b64 = matches[2]
    const buffer = Buffer.from(b64, 'base64')
    const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '_')
    const key = `products/${Date.now()}_${safeName}`

    await ensureProductImagesBucket()

    const { error } = await supabaseAdmin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(key, buffer, {
        contentType: mime,
        upsert: false,
      })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: publicUrlRes } = supabaseAdmin.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .getPublicUrl(key)
    return NextResponse.json({ url: publicUrlRes.publicUrl })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'error' }, { status: 500 })
  }
}
