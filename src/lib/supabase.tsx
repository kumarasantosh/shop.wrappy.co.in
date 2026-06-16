'use client'
import React, { useRef } from 'react'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { useSession } from '@clerk/nextjs'

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

/**
 * Plain anonymous client (no user identity). Retained for any public,
 * unauthenticated use. Do NOT use this for Realtime on RLS-protected tables
 * such as `orders` — it has no Clerk identity and RLS will deliver nothing.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Authenticated browser client.
 *
 * Uses the native Clerk <-> Supabase integration: the `accessToken` callback
 * hands Supabase the current Clerk session token for every REST request and,
 * importantly, for the Realtime websocket. realtime-js re-invokes this callback
 * on each heartbeat, so the short-lived Clerk token is refreshed automatically
 * and the socket stays authorized without any manual refresh loop.
 *
 * RLS policies can then authorize via auth.jwt():
 *   - admins:    (auth.jwt() ->> 'user_role') = 'admin'
 *   - customers: customer_clerk_id = (auth.jwt() ->> 'sub')
 */
export function useClerkSupabaseClient(): SupabaseClient {
  const { session } = useSession()

  // Keep the latest Clerk session in a ref so the accessToken callback always
  // reads a fresh token WITHOUT recreating the client. The client is created
  // exactly once and stays stable for the lifetime of the component — so the
  // Realtime socket is never torn down just because Clerk rotated the session.
  const sessionRef = useRef(session)
  sessionRef.current = session

  const clientRef = useRef<SupabaseClient | null>(null)
  if (!clientRef.current) {
    clientRef.current = createClient(supabaseUrl, supabaseAnonKey, {
      async accessToken() {
        return (await sessionRef.current?.getToken()) ?? null
      },
    })
  }
  return clientRef.current
}

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  return <React.Fragment>{children}</React.Fragment>
}

export default supabase
