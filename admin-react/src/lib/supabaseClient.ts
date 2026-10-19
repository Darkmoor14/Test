import { createClient } from '@supabase/supabase-js';

// Same hosted project and public (anon/publishable) key already committed
// in admin-3.html's own source — safe to reuse as-is, RLS is the real
// boundary. Once this pilot is mounted inside admin-3.html instead of
// running standalone, it will share that page's existing client instance
// rather than creating its own.
const SUPABASE_URL = 'https://ebuigyyjifnjiuzsgpih.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_aXC8Q_v2faRB0uEAlZYFog_JreYGXvq';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
