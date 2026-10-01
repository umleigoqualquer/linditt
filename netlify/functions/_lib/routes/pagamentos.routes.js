const router = require('express').Router();
const { supabase } = require('../supabase');
const { exigirAuth } = require('../auth');
const mp = require('../services/mercadopago.service');
const pedidos = require('../services/pedido.service');
const { limitar } = require('../rateLimit');

router.get('/status', exigirAuth, (req, res) => {
  res.json({ configurado: mp.configurado(), provedor: 'mercadopago' });
});

// Cria preferência de pagamento para um pedido existente
router.post('/preferencia/:pedidoId', async (req, res) => {
  try {
    const { data: pedido } = await supabase()
      .from('pedidos')
      .select('*')
      .eq('id', req.params.pedidoId)
      .maybeSingle();
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    if (pedido.status !== 'aguardando_pagamento') return res.status(400).json({ erro: 'Este pedido não está aguardando pagamento.' });

    const preferencia = await mp.criarPreferencia({
      pedidoId: pedido.id,
      itens: pedido.itens || [],
      total: pedido.total,
      frete: pedido.frete,
      cliente: pedido.cliente
    });

    // Salva o ID da preferência no pedido
    await supabase().from('pedidos').update({
      pagamento: { ...(pedido.pagamento || {}), preferenceId: preferencia.id, provedor: 'mercadopago' }
    }).eq('id', pedido.id);

    res.json({
      preferenceId: preferencia.id,
      initPoint: preferencia.init_point,
      sandboxInitPoint: preferencia.sandbox_init_point
    });
  } catch (e) {
    if (e.naoConfigurado) return res.status(501).json({ erro: e.message, configurado: false });
    res.status(502).json({ erro: e.message, detalhes: e.detalhes || null });
  }
});

// Webhook do Mercado Pago
router.post('/webhook', limitar({ janelaMs: 60 * 1000, max: 200 }), async (req, res) => {
  res.status(200).end();

  const body = req.body || {};
  const tipo = body.type || body.topic;
  const paymentId = (body.data && body.data.id) || body.id;

  if (tipo !== 'payment' || !paymentId || !mp.configurado()) return;

  try {
    const pagamento = await mp.consultarPagamento(paymentId);
    const pedidoId = pagamento.external_reference;
    if (!pedidoId) return;

    const { data: pedido } = await supabase()
      .from('pedidos')
      .select('*')
      .eq('id', pedidoId)
      .maybeSingle();

    if (!pedido || ['pago', 'enviado', 'entregue'].includes(pedido.status)) return;

    const statusInterno = mp.mapearStatus(pagamento.status, pagamento.status_detail);
    const pagAtual = {
      ...(pedido.pagamento || {}),
      paymentId: String(paymentId),
      status: statusInterno,
      provedor: 'mercadopago',
      mpStatus: pagamento.status,
      metodo: pagamento.payment_type_id
    };

    if (statusInterno === 'PAID') {
      pedido.pagamento = pagAtual;
      await pedidos.confirmarPagamento(pedido);
      const notificacao = require('../services/notificacao.service');
      Promise.resolve().then(() => notificacao.notificarPedidoPago(pedido).catch((e) => console.error('[aviso]', e.message)));
    } else if (statusInterno === 'FAILED') {
      if (Array.isArray(pedido.itens)) await pedidos.devolver(pedido.itens, 'pagamento recusado no Mercado Pago');
      await supabase().from('pedidos').update({
        status: 'expirado',
        atualizado_em: new Date().toISOString(),
        pagamento: pagAtual
      }).eq('id', pedido.id);
    } else {
      await supabase().from('pedidos').update({ pagamento: pagAtual }).eq('id', pedido.id);
    }
  } catch (e) {
    console.error('[webhook MP]', e.message);
  }
});

// Consulta status do pagamento de um pedido
router.get('/pedido/:pedidoId', async (req, res) => {
  try {
    const { data: pedido } = await supabase()
      .from('pedidos')
      .select('id, status, pagamento, total')
      .eq('id', req.params.pedidoId)
      .maybeSingle();
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    res.json({ status: pedido.status, pagamento: pedido.pagamento, total: pedido.total });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
