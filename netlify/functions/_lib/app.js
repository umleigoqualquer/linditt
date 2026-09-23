const express = require('express');

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));

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
