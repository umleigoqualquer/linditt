const router = require('express').Router();
const { supabase } = require('../supabase');
const { exigirAuth } = require('../auth');
const { aplicarCupom } = require('../services/cupom.service');
const { supabase: sb } = require('../supabase');

router.get('/', exigirAuth, async (req, res) => {
  try {
    const { data, error } = await supabase()
      .from('vendas_loja')
      .select('dados, cancelada, criado_em')
      .order('criado_em', { ascending: false });
    if (error) throw error;
    res.json((data || []).map((row) => ({ ...row.dados, cancelada: row.cancelada })));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/', exigirAuth, async (req, res) => {
  const body = req.body || {};
  const itens = Array.isArray(body.itens) ? body.itens : [];
  if (!itens.length) return res.status(400).json({ erro: 'Adicione pelo menos uma peça.' });

  try {
    // Verifica estoque para cada item
    const ids = [...new Set(itens.map((it) => it.id))];
    const { data: produtos } = await supabase()
      .from('produtos_com_estoque')
      .select('id, nome, preco, grade')
      .in('id', ids);
    const mapa = Object.fromEntries((produtos || []).map((p) => [p.id, p]));

    for (const it of itens) {
      const p = mapa[it.id];
      if (!p) return res.status(400).json({ erro: `Peça não encontrada: ${it.id}` });
      const tam = it.tamanho || 'Único';
      const livre = Number((p.grade || {})[tam]) || 0;
      if (!(it.qtd > 0) || it.qtd > livre) {
        return res.status(409).json({ erro: `Estoque insuficiente para "${p.nome}" (${tam}).` });
      }
    }

    const subtotal = itens.reduce((s, it) => s + Number(it.preco) * Number(it.qtd), 0);
    let cupom = null;
    let descontoCupom = 0;
    if (body.cupom) {
      const r = await aplicarCupom(body.cupom, subtotal);
      if (r.erro) return res.status(400).json({ erro: r.erro });
      cupom = r.cupom;
      descontoCupom = r.desconto;
    }
    const descontoManual = Math.max(0, Math.min(Number(body.descontoManual) || 0, subtotal - descontoCupom));
    const desconto = descontoCupom + descontoManual;
    const total = subtotal - desconto;
    const agora = new Date().toISOString();

    // Baixa estoque usando devolver com delta negativo via reservar_estoque
    const payload = itens.map((it) => ({ produto_id: it.id, tamanho: it.tamanho || 'Único', qtd: Number(it.qtd) }));
    const { error: eRes } = await supabase().rpc('reservar_estoque', { itens: JSON.stringify(payload) });
    if (eRes) return res.status(409).json({ erro: eRes.message || 'Estoque insuficiente.' });

    const vendaId = 'v' + Date.now();
    const dadosVenda = {
      id: vendaId,
      data: agora,
      itens: itens.map((it) => ({ id: it.id, nome: it.nome || mapa[it.id]?.nome, tamanho: it.tamanho || 'Único', preco: Number(it.preco), qtd: Number(it.qtd) })),
      subtotal,
      desconto,
      total,
      pagamento: body.pagamento || 'Dinheiro',
      parcelas: body.pagamento === 'Crédito' ? Number(body.parcelas) || 1 : 1,
      cliente: (body.cliente || '').trim(),
      cupom: cupom ? cupom.codigo : null,
      descontoCupom,
      cancelada: false,
      pagamentoGateway: null,
      origem: 'loja'
    };

    if (cupom) {
      const { data: cup } = await supabase().from('cupons').select('usos').eq('codigo', cupom.codigo).maybeSingle();
      if (cup) await supabase().from('cupons').update({ usos: (cup.usos || 0) + 1 }).eq('codigo', cupom.codigo);
    }

    const { error: eVenda } = await supabase().from('vendas_loja').insert({ id: vendaId, dados: dadosVenda, cancelada: false });
    if (eVenda) throw eVenda;

    res.status(201).json(dadosVenda);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/:id/cancelar', exigirAuth, async (req, res) => {
  try {
    const { data: row } = await supabase().from('vendas_loja').select('dados, cancelada').eq('id', req.params.id).maybeSingle();
    if (!row) return res.status(404).json({ erro: 'Venda não encontrada.' });
    if (row.cancelada) return res.status(400).json({ erro: 'Esta venda já está cancelada.' });

    const venda = row.dados;
    // Devolve estoque
    const payload = (venda.itens || []).map((it) => ({ produto_id: it.id, tamanho: it.tamanho || 'Único', qtd: it.qtd }));
    if (payload.length) {
      await supabase().rpc('devolver_estoque', { itens: JSON.stringify(payload), motivo: 'venda cancelada' });
    }
    await supabase().from('vendas_loja').update({ cancelada: true }).eq('id', req.params.id);

    res.json({ ...venda, cancelada: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
