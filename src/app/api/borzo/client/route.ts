/**
 * GET /api/borzo/client
 *
 * Returns the Borzo account profile and allowed payment methods.
 * Useful for verifying the auth token is working and checking balance/methods.
 */

import { NextResponse } from 'next/server'
import { BorzoError, getClient } from '../../../../lib/borzo'

export async function GET() {
  try {
    const result = await getClient()
    return NextResponse.json(result)
  } catch (err: unknown) {
    if (err instanceof BorzoError) {
      return NextResponse.json(
        { error: err.message, codes: err.errors },
        { status: 422 }
      )
    }
    const message = err instanceof Error ? err.message : 'internal_error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
