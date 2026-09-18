const { createClient } = require('@supabase/supabase-js');

// Server-side only. Uses the service role key, which bypasses Row Level
// Security. This file must NEVER be imported by anything that ships to
// the browser — it only runs inside Vercel's serverless functions.
function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase server credentials are not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

module.exports = { getServiceClient };
