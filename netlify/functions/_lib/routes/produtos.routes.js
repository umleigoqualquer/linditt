const router = require('express').Router();
const { exigirAuth } = require('../auth');
const prod = require('../services/produto.service');

router.get('/', async (req, res) => {
  try {
    const lista = await prod.listar(true);
    res.json(lista.map(prod.paraVitrine));
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/admin', exigirAuth, async (req, res) => {
  try { res.json(await prod.listar(false)); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/movimentacoes', exigirAuth, async (req, res) => {
  try { res.json(await prod.listarMovimentacoes()); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/', exigirAuth, async (req, res) => {
  const body = req.body || {};
  const nome = (body.nome || '').trim();
  const preco = Number(body.preco);
  if (!nome) return res.status(400).json({ erro: 'Dê um nome para a peça.' });
  if (!(preco >= 0)) return res.status(400).json({ erro: 'Informe o preço.' });
  try {
    const novo = await prod.criar(body);
    res.status(201).json(novo);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.put('/:id', exigirAuth, async (req, res) => {
  try {
    const atualizado = await prod.atualizar(req.params.id, req.body || {});
    if (!atualizado) return res.status(404).json({ erro: 'Peça não encontrada.' });
    res.json(atualizado);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.patch('/:id/ativo', exigirAuth, async (req, res) => {
  try {
    const p = await prod.alternarAtivo(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Peça não encontrada.' });
    res.json(p);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/:id/mover', exigirAuth, async (req, res) => {
  const body = req.body || {};
  const tamanho = body.tamanho || 'Único';
  const delta = Number(body.delta) || 0;
  if (!delta) return res.status(400).json({ erro: 'Informe o delta.' });
  try {
    const p = await prod.moverEstoque(req.params.id, tamanho, delta, body.motivo);
    if (!p) return res.status(404).json({ erro: 'Peça não encontrada.' });
    res.json(p);
  } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
});

router.delete('/:id', exigirAuth, async (req, res) => {
  try {
    await prod.excluir(req.params.id);
    res.status(204).end();
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
