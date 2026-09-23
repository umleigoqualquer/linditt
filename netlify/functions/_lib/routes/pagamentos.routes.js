const router = require('express').Router();
const { supabase } = require('../supabase');
const { exigirAuth } = require('../auth');
const sumup = require('../services/sumup.service');
const pedidos = require('../services/pedido.service');
const { limitar } = require('../rateLimit');

router.get('/status', exigirAuth, (req, res) => {
  res.json({ configurado: sumup.configurado() });
});

router.post('/checkout', exigirAuth, async (req, res) => {
  const { valor, descricao } = req.body || {};
  const montante = Number(valor);
  if (!(montante > 0)) return res.status(400).json({ erro: 'Informe um valor válido para cobrar.' });
  try {
    const checkout = await sumup.criarCheckout({
      referencia: 'avulso-' + Date.now(),
      valor: montante,
      moeda: 'BRL',
      descricao: descricao || 'Compra Linditt Boutique'
    });
    res.status(201).json(checkout);
  } catch (e) {
    if (e.naoConfigurado) return res.status(501).json({ erro: e.message, configurado: false });
    res.status(502).json({ erro: e.message, detalhes: e.detalhes || null });
  }
});

router.get('/checkout/:id', exigirAuth, async (req, res) => {
  try { res.json(await sumup.consultarCheckout(req.params.id)); }
  catch (e) {
    if (e.naoConfigurado) return res.status(501).json({ erro: e.message, configurado: false });
    res.status(502).json({ erro: e.message });
  }
});

router.post('/webhook', limitar({ janelaMs: 60 * 1000, max: 120 }), async (req, res) => {
  const evento = req.body || {};
  const checkoutId = evento.id || evento.checkout_id || (evento.data && evento.data.id) || (evento.payload && evento.payload.checkout_id);
  res.status(200).end();
  if (!checkoutId || !sumup.configurado()) return;

  try {
    const { data: pedido } = await supabase()
      .from('pedidos')
      .select('*')
      .filter('pagamento->>checkoutId', 'eq', checkoutId)
      .maybeSingle();
    if (pedido) {
      await pedidos.sincronizarPagamento(pedido);
    }
  } catch (e) {
    console.error('Erro ao processar webhook da SumUp:', e.message);
  }
});

router.post('/teste/:checkoutId/:status', async (req, res) => {
  const status = req.params.status.toUpperCase();
  if (!['PAID', 'FAILED', 'EXPIRED'].includes(status) || !sumup.simularStatus(req.params.checkoutId, status)) {
    return res.status(404).json({ erro: 'Indisponível.' });
  }
  try {
    const { data: pedido } = await supabase()
      .from('pedidos')
      .select('*')
      .filter('pagamento->>checkoutId', 'eq', req.params.checkoutId)
      .maybeSingle();
    if (pedido) await pedidos.sincronizarPagamento(pedido);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
