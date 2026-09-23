const router = require('express').Router();
const { supabase } = require('../supabase');
const { exigirAuth } = require('../auth');

const ESTOQUE_MINIMO = 2;

router.get('/', exigirAuth, async (req, res) => {
  try {
    const hoje = new Date();
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).toISOString();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();

    const [{ data: produtos }, { data: vendas }, { data: pedidosPagar }] = await Promise.all([
      supabase().from('produtos_com_estoque').select('qtd, preco, ativo'),
      supabase().from('vendas_loja').select('dados, cancelada, criado_em').gte('criado_em', inicioMes),
      supabase().from('pedidos').select('id').eq('status', 'pago')
    ]);

    let pecas = 0, valorEstoque = 0, baixos = 0;
    for (const p of (produtos || [])) {
      if (!p.ativo) continue;
      pecas += Number(p.qtd) || 0;
      valorEstoque += (Number(p.qtd) || 0) * (Number(p.preco) || 0);
      if ((Number(p.qtd) || 0) <= ESTOQUE_MINIMO) baixos++;
    }

    let faturamentoHoje = 0, faturamentoMes = 0;
    for (const row of (vendas || [])) {
      if (row.cancelada) continue;
      const total = Number((row.dados || {}).total) || 0;
      faturamentoMes += total;
      if (row.criado_em >= inicioHoje) faturamentoHoje += total;
    }

    res.json({
      faturamentoHoje,
      faturamentoMes,
      pecasEmEstoque: pecas,
      produtosCadastrados: (produtos || []).filter((p) => p.ativo).length,
      valorEstoque,
      estoqueBaixo: baixos,
      pedidosParaEnviar: (pedidosPagar || []).length
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
