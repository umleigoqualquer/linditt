const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getCredenciais, setCredenciais } = require('../services/config.service');
const { exigirAuth, SECRET } = require('../auth');
const { limitar } = require('../rateLimit');

const limiteLogin = limitar({ janelaMs: 15 * 60 * 1000, max: 8, mensagem: 'Muitas tentativas de login. Aguarde 15 minutos.' });

router.post('/login', limiteLogin, async (req, res) => {
  try {
    const { usuario, senha } = req.body || {};
    if (!usuario || !senha) return res.status(401).json({ erro: 'Usuário e senha são obrigatórios.' });
    const cred = await getCredenciais();
    if (!cred.senhaHash || usuario.trim() !== cred.usuario || !bcrypt.compareSync(String(senha), cred.senhaHash)) {
      return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    }
    const token = jwt.sign({ loja: 'linditt' }, SECRET, { expiresIn: '12h' });
    res.json({ token });
  } catch (e) {
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

router.post('/trocar-senha', exigirAuth, async (req, res) => {
  const { usuario, novaSenha } = req.body || {};
  if (!usuario || String(usuario).trim().length < 3) return res.status(400).json({ erro: 'Usuário deve ter pelo menos 3 caracteres.' });
  if (!novaSenha || String(novaSenha).length < 6) return res.status(400).json({ erro: 'Senha deve ter pelo menos 6 caracteres.' });
  try {
    await setCredenciais(String(usuario).trim(), bcrypt.hashSync(String(novaSenha), 10));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: 'Não foi possível trocar as credenciais.' });
  }
});

module.exports = router;
