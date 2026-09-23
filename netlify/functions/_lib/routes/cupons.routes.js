const router = require('express').Router();
const { exigirAuth } = require('../auth');
const cupons = require('../services/cupom.service');

router.get('/', exigirAuth, async (req, res) => {
  try {
    const lista = await cupons.listar();
    res.json(lista.map((c) => ({ ...c, status: cupons.statusCupom(c) })));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/', exigirAuth, async (req, res) => {
  const body = req.body || {};
  const codigo = String(body.codigo || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!codigo) return res.status(400).json({ erro: 'Escreva o código.' });
  const valor = Number(body.valor);
  if (!(valor > 0)) return res.status(400).json({ erro: 'Informe o valor do desconto.' });
  const tipo = body.tipo === 'reais' ? 'reais' : 'pct';
  if (tipo === 'pct' && valor > 100) return res.status(400).json({ erro: 'Porcentagem acima de 100%.' });

  const existente = await cupons.buscar(codigo);
  if (existente) return res.status(409).json({ erro: 'Já existe um cupom com esse código.' });

  try {
    const novo = await cupons.criar(body);
    res.status(201).json({ ...novo, status: cupons.statusCupom(novo) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.patch('/:codigo/pausar', exigirAuth, async (req, res) => {
  try {
    const c = await cupons.alternarAtivo(req.params.codigo);
    if (!c) return res.status(404).json({ erro: 'Cupom não encontrado.' });
    res.json({ ...c, status: cupons.statusCupom(c) });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.delete('/:codigo', exigirAuth, async (req, res) => {
  try {
    const c = await cupons.buscar(req.params.codigo);
    if (!c) return res.status(404).json({ erro: 'Cupom não encontrado.' });
    await cupons.excluir(req.params.codigo);
    res.status(204).end();
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/validar', exigirAuth, async (req, res) => {
  const subtotal = Number((req.body || {}).subtotal) || 0;
  const r = await cupons.aplicarCupom((req.body || {}).codigo, subtotal);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ codigo: r.cupom.codigo, tipo: r.cupom.tipo, valor: r.cupom.valor, desconto: r.desconto });
});

module.exports = router;
