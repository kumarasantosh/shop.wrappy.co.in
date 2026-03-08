'use client'
import React from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  return <React.Fragment>{children}</React.Fragment>
}

export default supabase
