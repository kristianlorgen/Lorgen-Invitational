const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Temporary debug logs for deployment verification (Vercel / Railway)
console.log('Supabase URL:', supabaseUrl);
console.log('Supabase Key exists:', !!supabaseAnonKey);

let supabase = null;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase client not initialized: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.'
  );
} else {
  // Singleton client instance shared across imports
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

module.exports = { supabase };
