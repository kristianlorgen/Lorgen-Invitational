let client;

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  if (!client) {
    let createClient;
    try {
      ({ createClient } = require('@supabase/supabase-js'));
    } catch (error) {
      throw new Error(`Missing dependency @supabase/supabase-js: ${error.message}`);
    }

    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false }
      }
    );
  }

  return client;
}

module.exports = getSupabaseAdmin;
module.exports.getSupabaseAdmin = getSupabaseAdmin;
