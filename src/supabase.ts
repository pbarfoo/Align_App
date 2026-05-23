import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const localMode = !supabaseUrl || !supabaseKey;

export const supabase: SupabaseClient = localMode
  ? (null as unknown as SupabaseClient)
  : createClient(supabaseUrl, supabaseKey);
