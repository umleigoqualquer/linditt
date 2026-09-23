const { supabase } = require('../supabase');

// Mapeamento entre tipos no app (legado) e no banco
const tipoParaBanco = (t) => t === 'pct' ? 'percentual' : 'fixo';
const tipoDosBanco = (t) => t === 'percentual' ? 'pct' : 'reais';

function toFrontend(row) {
  return {
    codigo: row.codigo,
    tipo: tipoDosBanco(row.tipo),
    valor: Number(row.valor),
    minimo: Number(row.minimo || 0),
    validade: row.validade ? row.validade.slice(0, 10) : null,
    limite: row.usos_max || null,
    usos: row.usos || 0,
    ativo: row.ativo,
    criado: row.criado_em
  };
}

function statusCupom(c) {
  if (!c.ativo) return 'pausado';
  if (c.validade && new Date(c.validade + 'T23:59:59') < new Date()) return 'vencido';
  if (c.limite && c.usos >= c.limite) return 'esgotado';
  return 'ativo';
}

function valorCupom(c, subtotal) {
  const d = c.tipo === 'pct' ? (subtotal * c.valor) / 100 : c.valor;
  return Math.max(0, Math.min(d, subtotal));
}

async function listar() {
  const { data, error } = await supabase().from('cupons').select('*').order('criado_em', { ascending: false });
  if (error) throw error;
  return (data || []).map(toFrontend);
}

async function buscar(codigo) {
  const { data, error } = await supabase()
    .from('cupons')
    .select('*')
    .eq('codigo', String(codigo || '').trim().toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data ? toFrontend(data) : null;
}

async function criar(body) {
  const codigo = String(body.codigo || '').trim().toUpperCase().replace(/\s+/g, '');
  const valor = Number(body.valor);
  const tipo = body.tipo === 'reais' ? 'fixo' : 'percentual';

  const { error } = await supabase().from('cupons').insert({
    codigo,
    tipo,
    valor,
    minimo: Number(body.minimo) || 0,
    validade: body.validade || null,
    usos_max: body.limite ? Number(body.limite) : null,
    usos: 0,
    ativo: true
  });
  if (error) throw error;
  return buscar(codigo);
}

async function alternarAtivo(codigo) {
  const c = await buscar(codigo);
  if (!c) return null;
  const { error } = await supabase().from('cupons').update({ ativo: !c.ativo }).eq('codigo', codigo.toUpperCase());
  if (error) throw error;
  return buscar(codigo);
}

async function excluir(codigo) {
  const { error } = await supabase().from('cupons').delete().eq('codigo', codigo.toUpperCase());
  if (error) throw error;
}

// Valida e calcula desconto de um cupom — usado no carrinho e na tela de Vendas
async function aplicarCupom(codigo, subtotal) {
  const c = await buscar(codigo);
  if (!c) return { erro: 'Cupom não encontrado.' };
  const status = statusCupom(c);
  if (status !== 'ativo') return { erro: `Este cupom está ${status}.` };
  if (c.minimo && subtotal < c.minimo) {
    return { erro: `Compra mínima de R$ ${c.minimo.toFixed(2).replace('.', ',')} para este cupom.` };
  }
  return { cupom: c, desconto: valorCupom(c, subtotal) };
}

module.exports = { listar, buscar, criar, alternarAtivo, excluir, aplicarCupom, statusCupom, valorCupom, toFrontend };
