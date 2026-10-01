const express = require('express');

const app = express();

app.set('trust proxy', 1);

// Cabeçalhos de segurança HTTP
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// CORS — aceita apenas domínio próprio e localhost
const ORIGEM_OK = /^https:\/\/(lindittboutique\.com\.br|[^.]+--linditt\.netlify\.app)$|^http:\/\/localhost/;
app.use((req, res, next) => {
  const origem = req.headers.origin || '';
  if (ORIGEM_OK.test(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '10mb' })); // 10 MB para upload de imagem em base64

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', require('./routes/auth.routes'));
app.use('/produtos', require('./routes/produtos.routes'));
app.use('/loja', require('./routes/loja.routes'));
app.use('/pedidos', require('./routes/pedidos.routes'));
app.use('/pagamentos', require('./routes/pagamentos.routes'));
app.use('/config', require('./routes/config.routes'));
app.use('/cupons', require('./routes/cupons.routes'));
app.use('/vendas', require('./routes/vendas.routes'));
app.use('/resumo', require('./routes/resumo.routes'));

app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

app.use((err, req, res, next) => {
  console.error('[app]', err.message);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

module.exports = app;
