const { supabase } = require('../supabase');

async function getConfig() {
  const { data, error } = await supabase().from('config').select('dados').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data?.dados || {};
}

async function saveConfig(dados) {
  const { error } = await supabase().from('config').upsert({ id: 1, dados });
  if (error) throw error;
}

async function getPinHash() {
  const c = await getConfig();
  return c.pinHash || '';
}

async function setPinHash(hash) {
  const c = await getConfig();
  c.pinHash = hash;
  await saveConfig(c);
}

module.exports = { getConfig, saveConfig, getPinHash, setPinHash };
