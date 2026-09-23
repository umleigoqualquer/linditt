const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'linditt-dev-secret-troque-isso';

function exigirAuth(req, res, next) {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Não autenticado.' });
  try {
    req.admin = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    res.status(401).json({ erro: 'Sessão inválida ou expirada. Entre novamente.' });
  }
}

module.exports = { exigirAuth, SECRET };
