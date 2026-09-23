const { supabase } = require('../supabase');
const { uploadBase64 } = require('../r2');

// Supabase → formato do frontend (mantém compatibilidade com o painel e o site)
function toFrontend(row) {
  return {
    id: row.id,
    nome: row.nome,
    cat: row.categoria || 'casual',
    preco: Number(row.preco),
    precoAntes: row.preco_antes ? Number(row.preco_antes) : null,
    etiqueta: row.etiqueta || '',
    codigo: row.codigo || '',
    obs: row.descricao || '',
    embalagem: row.embalagem || null,
    foto: (row.fotos && row.fotos[0]) || '',
    svg: row.svg || '',
    ativo: row.ativo,
    qtd: Number(row.qtd || 0),
    grade: row.grade || {},
    tamanhos: row.tamanhos || [],
    criado: row.criado_em
  };
}

function paraVitrine(p) {
  return {
    id: p.id, nome: p.nome, cat: p.cat, preco: p.preco, precoAntes: p.precoAntes,
    etiqueta: p.etiqueta, qtd: p.qtd, tamanhos: p.tamanhos, grade: p.grade,
    foto: p.foto, svg: p.svg
  };
}

async function listar(apenasAtivos) {
  let q = supabase().from('produtos_com_estoque').select('*').order('criado_em', { ascending: false });
  if (apenasAtivos) q = q.eq('ativo', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(toFrontend);
}

async function buscar(id) {
  const { data, error } = await supabase()
    .from('produtos_com_estoque')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? toFrontend(data) : null;
}

async function criar(body) {
  const foto = await uploadBase64(body.foto);
  const id = 'p' + Date.now();

  const { error: eprod } = await supabase().from('produtos').insert({
    id,
    nome: (body.nome || '').trim(),
    categoria: body.cat || 'casual',
    preco: Number(body.preco),
    preco_antes: body.precoAntes ? Number(body.precoAntes) : null,
    etiqueta: (body.etiqueta || '').trim(),
    codigo: (body.codigo || '').trim(),
    descricao: (body.obs || '').trim(),
    embalagem: body.embalagem || null,
    fotos: foto ? [foto] : [],
    svg: '',
    ativo: true
  });
  if (eprod) throw eprod;

  const grade = body.grade && Object.keys(body.grade).length ? body.grade : { Único: 0 };
  await salvarGrade(id, grade);

  return buscar(id);
}

async function atualizar(id, body) {
  const updates = {};
  if (body.nome != null) updates.nome = String(body.nome).trim();
  if (body.cat != null) updates.categoria = body.cat;
  if (body.preco != null) updates.preco = Number(body.preco);
  updates.preco_antes = body.precoAntes ? Number(body.precoAntes) : null;
  if (body.etiqueta != null) updates.etiqueta = String(body.etiqueta).trim();
  if (body.codigo != null) updates.codigo = String(body.codigo).trim();
  if (body.obs != null) updates.descricao = String(body.obs).trim();
  if (body.embalagem !== undefined) updates.embalagem = body.embalagem || null;
  updates.atualizado_em = new Date().toISOString();

  if (body.foto !== undefined) {
    const novaFoto = await uploadBase64(body.foto);
    updates.fotos = novaFoto ? [novaFoto] : [];
  }

  const { error } = await supabase().from('produtos').update(updates).eq('id', id);
  if (error) throw error;

  if (body.grade) await salvarGrade(id, body.grade);

  return buscar(id);
}

async function alternarAtivo(id) {
  const p = await buscar(id);
  if (!p) return null;
  const { error } = await supabase().from('produtos').update({ ativo: !p.ativo }).eq('id', id);
  if (error) throw error;
  return buscar(id);
}

async function excluir(id) {
  const { error } = await supabase().from('produtos').delete().eq('id', id);
  if (error) throw error;
}

async function moverEstoque(id, tamanho, delta, motivo) {
  const { error } = await supabase().rpc('devolver_estoque', {
    itens: JSON.stringify([{ produto_id: id, tamanho, qtd: Math.abs(delta) }]),
    motivo: motivo || (delta > 0 ? 'entrada manual' : 'saída manual')
  });
  if (delta < 0) {
    // reservar (decremento): usa reservar_estoque para não passar de zero
    const { error: er } = await supabase().rpc('reservar_estoque', {
      itens: JSON.stringify([{ produto_id: id, tamanho, qtd: Math.abs(delta) }])
    });
    if (er) throw er;
  } else {
    if (error) throw error;
  }
  return buscar(id);
}

async function salvarGrade(produtoId, grade) {
  const rows = Object.entries(grade).map(([tamanho, quantidade]) => ({
    produto_id: produtoId,
    tamanho,
    quantidade: Math.max(0, Number(quantidade) || 0)
  }));
  await supabase().from('produto_tamanhos').delete().eq('produto_id', produtoId);
  if (rows.length) {
    const { error } = await supabase().from('produto_tamanhos').insert(rows);
    if (error) throw error;
  }
}

async function listarMovimentacoes() {
  const { data, error } = await supabase()
    .from('movimentacoes')
    .select('produto_id, tamanho, delta, motivo, em')
    .order('em', { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data || []).map((m) => ({
    data: m.em,
    nome: `${m.produto_id} (${m.tamanho})`,
    delta: m.delta,
    motivo: m.motivo
  }));
}

module.exports = { listar, buscar, criar, atualizar, alternarAtivo, excluir, moverEstoque, toFrontend, paraVitrine };
