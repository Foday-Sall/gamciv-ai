import { createClient } from '@supabase/supabase-js'

// Minimal Supabase client for the admin console. Shares the same origin
// (api.pocketsoftware.dev) and storage key convention as the citizen app so
// an admin session from the app login flow works here without a second login.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})
