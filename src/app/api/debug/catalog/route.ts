import { NextResponse } from 'next/server'

/**
 * GET /api/debug/catalog
 *
 * Tests the Meta Graph "product_sets" call for your commerce catalog:
 *   GET https://graph.facebook.com/v19.0/{catalog_id}/product_sets?fields=id,name,products
 *
 * Resolving the catalog id (first match wins):
 *   1. ?catalogId=<id>   query param
 *   2. WHATSAPP_CATALOG_ID env var
 *   3. auto-discovered from the WABA's owned product catalogs
 *      (?wabaId=<id> or WHATSAPP_WABA_ID, else the known Wrappy WABA)
 *
 * Optional: ?v=v19.0 to override the Graph API version.
 *
 * REMOVE THIS FILE before going to production.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const version = searchParams.get('v') || 'v19.0'
  // Prefer a dedicated catalog token (System User w/ catalog_management); allow a
  // one-off ?accessToken= for testing; fall back to the WhatsApp token.
  const accessToken =
    searchParams.get('accessToken') ||
    process.env.CATALOG_ACCESS_TOKEN ||
    process.env.WHATSAPP_ACCESS_TOKEN ||
    ''
  if (!accessToken) {
    return NextResponse.json(
      { error: 'No token. Set CATALOG_ACCESS_TOKEN (or WHATSAPP_ACCESS_TOKEN), or pass ?accessToken=' },
      { status: 500 }
    )
  }

  const auth = { headers: { Authorization: `Bearer ${accessToken}` } }
  const graph = (path: string) => fetch(`https://graph.facebook.com/${version}/${path}`, auth)

  // 1) Resolve a catalog id, trying several discovery paths since catalogs are
  //    usually owned at the Business level, not connected to the WABA edge.
  let catalogId = searchParams.get('catalogId') || process.env.WHATSAPP_CATALOG_ID || ''
  const wabaId =
    searchParams.get('wabaId') || process.env.WHATSAPP_WABA_ID || '1964329557628774'
  const diagnostics: Record<string, unknown> = {}

  const jsonOf = async (path: string) => {
    const r = await graph(path)
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  const firstCatalogId = (body: any): string =>
    body?.data?.[0]?.id || ''

  if (!catalogId) {
    // a) Catalog connected directly to the WABA.
    const wabaCatalogs = await jsonOf(`${wabaId}/product_catalogs?fields=id,name`)
    diagnostics.wabaProductCatalogs = wabaCatalogs.body
    catalogId = firstCatalogId(wabaCatalogs.body)

    // b) Owner business → owned product catalogs.
    if (!catalogId) {
      let businessId = searchParams.get('businessId') || process.env.WHATSAPP_BUSINESS_ID || ''
      if (!businessId) {
        const owner = await jsonOf(`${wabaId}?fields=owner_business_info,on_behalf_of_business_info`)
        diagnostics.wabaOwner = owner.body
        businessId =
          (owner.body as any)?.owner_business_info?.id ||
          (owner.body as any)?.on_behalf_of_business_info?.id ||
          ''
      }
      if (businessId) {
        const owned = await jsonOf(`${businessId}/owned_product_catalogs?fields=id,name`)
        diagnostics.ownedProductCatalogs = owned.body
        catalogId = firstCatalogId(owned.body)
      }
    }

    // c) Catalogs visible to the token's user/system user.
    if (!catalogId) {
      const me = await jsonOf(`me/businesses?fields=id,name,owned_product_catalogs{id,name}`)
      diagnostics.meBusinesses = me.body
      const biz = (me.body as any)?.data || []
      for (const b of biz) {
        const id = b?.owned_product_catalogs?.data?.[0]?.id
        if (id) { catalogId = id; break }
      }
    }
  }

  if (!catalogId) {
    return NextResponse.json(
      {
        error: 'no_catalog_id',
        hint: 'Catalog not found via WABA, owner business, or /me/businesses. Pass ?catalogId=<id> or ?businessId=<id>, or check the token has catalog_management + business_management. The diagnostics below show each Graph response.',
        wabaId,
        diagnostics,
      },
      { status: 400 }
    )
  }

  // 1b) What scopes / identity does this token actually have?
  const whoRes = await graph(`me?fields=id,name`)
  const tokenIdentity = await whoRes.json().catch(() => null)
  const permsRes = await graph(`me/permissions`)
  const permsBody = await permsRes.json().catch(() => null)
  const grantedScopes = Array.isArray((permsBody as any)?.data)
    ? (permsBody as any).data.filter((p: any) => p.status === 'granted').map((p: any) => p.permission)
    : permsBody

  // 2) The call under test: list product sets for the catalog.
  const setsRes = await graph(`${catalogId}/product_sets?fields=id,name,products`)
  const productSets = await setsRes.json().catch(() => null)

  return NextResponse.json({
    version,
    catalogId,
    httpStatus: setsRes.status,
    ok: setsRes.ok,
    tokenIdentity,
    grantedScopes,
    hasCatalogManagement: Array.isArray(grantedScopes)
      ? grantedScopes.includes('catalog_management')
      : 'unknown',
    diagnostics,
    productSets,
  })
}
