const { createClient } = require('@supabase/supabase-js');

let _client = null;

function supabase() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidos.');
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

module.exports = { supabase };
