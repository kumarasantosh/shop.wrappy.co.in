// src/app/api/catalog-feed/route.ts
// Generates a Meta-compatible XML product feed from Supabase.
// Register this URL in Meta Commerce Manager → Data Sources → Data Feed:
//   https://shop.wrappy.co.in/api/catalog-feed
// Set refresh to daily.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://shop.wrappy.co.in'
const BRAND = process.env.RESTAURANT_NAME || 'Wrappy'

export async function GET() {
  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, name, description, price, image_url, is_available, categories(name)')
    .eq('is_available', true)
    .order('name', { ascending: true })

  if (error || !products) {
    return new NextResponse('Failed to load products', { status: 500 })
  }

  const items = (products as any[]).map((p) => {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const url = `${APP_URL}/menu`
    const price = `${p.price}.00 INR`
    const category = p.categories?.name || 'Food'
    const description = p.description || `${p.name} - ${category}`
    const imageUrl = p.image_url || ''

    return `  <item>
    <id>${slug}</id>
    <title>${escapeXml(p.name)}</title>
    <description>${escapeXml(description)}</description>
    <link>${url}</link>
    <image_link>${escapeXml(imageUrl)}</image_link>
    <condition>new</condition>
    <availability>in stock</availability>
    <price>${price}</price>
    <brand>${escapeXml(BRAND)}</brand>
    <google_product_category>Food &amp; Beverages</google_product_category>
  </item>`
  }).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(BRAND)} Menu</title>
    <link>${APP_URL}</link>
    <description>${escapeXml(BRAND)} product catalog</description>
${items}
  </channel>
</rss>`

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

function escapeXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
