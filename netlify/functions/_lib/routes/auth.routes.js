const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPinHash, setPinHash } = require('../services/config.service');
const { exigirAuth, SECRET } = require('../auth');
const { limitar } = require('../rateLimit');

const limiteLogin = limitar({ janelaMs: 15 * 60 * 1000, max: 8, mensagem: 'Muitas tentativas de login. Aguarde 15 minutos.' });

router.post('/login', limiteLogin, async (req, res) => {
  try {
    const { pin } = req.body || {};
    const hash = await getPinHash();
    if (!pin || !bcrypt.compareSync(String(pin), hash)) {
      return res.status(401).json({ erro: 'Código incorreto.' });
    }
    const token = jwt.sign({ loja: 'linditt' }, SECRET, { expiresIn: '12h' });
    res.json({ token });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

router.post('/trocar-pin', exigirAuth, async (req, res) => {
  const novo = String((req.body || {}).novoPin || '').replace(/\D/g, '');
  if (novo.length < 4 || novo.length > 8) return res.status(400).json({ erro: 'Use de 4 a 8 números.' });
  try {
    await setPinHash(bcrypt.hashSync(novo, 10));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: 'Não foi possível trocar o PIN.' });
  }
});

module.exports = router;
