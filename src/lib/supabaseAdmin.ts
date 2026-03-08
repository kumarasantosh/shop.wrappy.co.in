import { createClient } from '@supabase/supabase-js'

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role'

if (!url || !serviceRole) {
  // In dev, warn — production must have these set
  console.warn('Supabase admin client missing env config (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)')
}

export const supabaseAdmin = createClient(url, serviceRole, {
  auth: {
    persistSession: false
  }
})

export default supabaseAdmin
