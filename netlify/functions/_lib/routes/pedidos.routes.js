const router = require('express').Router();
const { supabase } = require('../supabase');
const { exigirAuth } = require('../auth');
const pedidos = require('../services/pedido.service');
const notificacao = require('../services/notificacao.service');

router.use(exigirAuth);

function paraPainel(p) {
  const { token, ...resto } = p;
  return resto;
}

router.get('/', async (req, res) => {
  try {
    await pedidos.liberarExpirados();
    const { data, error } = await supabase()
      .from('pedidos')
      .select('*')
      .order('criado_em', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(paraPainel));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { data: pedido } = await supabase().from('pedidos').select('*').eq('id', req.params.id).maybeSingle();
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

    const { status, rastreio } = req.body || {};
    const updates = { atualizado_em: new Date().toISOString() };

    if (rastreio !== undefined) updates.rastreio = String(rastreio).trim().slice(0, 60);

    if (status) {
      const permitido = { enviado: ['pago', 'enviado'], entregue: ['enviado', 'entregue'] };
      if (!permitido[status]) return res.status(400).json({ erro: 'Status inválido.' });
      if (!permitido[status].includes(pedido.status)) {
        return res.status(409).json({ erro: status === 'enviado' ? 'Só dá para enviar um pedido já pago.' : 'Marque como enviado antes de entregue.' });
      }
      updates.status = status;
    }

    const { error } = await supabase().from('pedidos').update(updates).eq('id', req.params.id);
    if (error) throw error;

    const { data: atualizado } = await supabase().from('pedidos').select('*').eq('id', req.params.id).maybeSingle();
    res.json(paraPainel(atualizado));

    const statusFinal = updates.status || pedido.status;
    if (statusFinal === 'enviado' && (status === 'enviado' || rastreio !== undefined)) {
      notificacao.notificarEnvio(atualizado).catch((e) => console.error('[aviso] envio:', e.message));
    }
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/:id/cancelar', async (req, res) => {
  try {
    const { data: pedido } = await supabase().from('pedidos').select('*').eq('id', req.params.id).maybeSingle();
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    if (pedido.status === 'cancelado') return res.status(400).json({ erro: 'Este pedido já está cancelado.' });
    const cancelado = await pedidos.cancelarPedido(req.params.id);
    res.json(paraPainel(cancelado));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
