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

async function getCredenciais() {
  const c = await getConfig();
  return { usuario: c.usuario || '', senhaHash: c.senhaHash || '' };
}

async function setCredenciais(usuario, senhaHash) {
  const c = await getConfig();
  c.usuario = usuario;
  c.senhaHash = senhaHash;
  await saveConfig(c);
}

module.exports = { getConfig, saveConfig, getCredenciais, setCredenciais };
