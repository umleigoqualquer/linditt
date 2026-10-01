const MP_API = 'https://api.mercadopago.com';

function configurado() {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

function erroNaoConfigurado() {
  const erro = new Error('Mercado Pago não configurado. Defina MP_ACCESS_TOKEN nas variáveis de ambiente.');
  erro.naoConfigurado = true;
  return erro;
}

async function chamarMP(caminho, opcoes) {
  const resposta = await fetch(MP_API + caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': opcoes && opcoes.idempotencyKey ? opcoes.idempotencyKey : undefined,
      ...(opcoes && opcoes.headers)
    },
    signal: AbortSignal.timeout(15000)
  });
  let dados = null;
  try { dados = await resposta.json(); } catch (e) { /* sem corpo */ }
  if (!resposta.ok) {
    const erro = new Error((dados && (dados.message || dados.error)) || 'Falha ao falar com o Mercado Pago.');
    erro.status = resposta.status;
    erro.detalhes = dados;
    throw erro;
  }
  return dados;
}

async function criarPreferencia({ pedidoId, itens, total, frete, cliente, backUrls }) {
  if (!configurado()) throw erroNaoConfigurado();

  const siteUrl = process.env.SITE_URL || 'https://lindittboutique.com.br';

  const body = {
    external_reference: pedidoId,
    items: itens.map((it) => ({
      id: it.id,
      title: `${it.nome}${it.tamanho && it.tamanho !== 'Único' ? ` (${it.tamanho})` : ''}`,
      quantity: it.qtd,
      unit_price: Number(Number(it.preco).toFixed(2)),
      currency_id: 'BRL'
    })),
    payer: cliente ? {
      name: cliente.nome || '',
      email: cliente.email || ''
    } : undefined,
    shipments: frete && frete.preco > 0 ? {
      cost: Number(Number(frete.preco).toFixed(2)),
      mode: 'not_specified'
    } : undefined,
    back_urls: {
      success: backUrls ? backUrls.success : `${siteUrl}/obrigado.html`,
      failure: backUrls ? backUrls.failure : `${siteUrl}/#pagamento-falhou`,
      pending: backUrls ? backUrls.pending : `${siteUrl}/#pagamento-pendente`
    },
    auto_return: 'approved',
    notification_url: `${siteUrl}/api/pagamentos/webhook`,
    statement_descriptor: 'LINDITT BOUTIQUE',
    binary_mode: true
  };

  return chamarMP('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify(body),
    idempotencyKey: pedidoId
  });
}

async function consultarPagamento(paymentId) {
  if (!configurado()) throw erroNaoConfigurado();
  return chamarMP(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

async function consultarPreferencia(preferenceId) {
  if (!configurado()) throw erroNaoConfigurado();
  return chamarMP(`/checkout/preferences/${encodeURIComponent(preferenceId)}`, { method: 'GET' });
}

// Mapeia status do MP para status interno
function mapearStatus(mpStatus, mpStatusDetail) {
  if (mpStatus === 'approved') return 'PAID';
  if (mpStatus === 'rejected' || mpStatus === 'cancelled') return 'FAILED';
  if (mpStatus === 'refunded' || mpStatus === 'charged_back') return 'REFUNDED';
  return 'PENDING';
}

module.exports = { configurado, criarPreferencia, consultarPagamento, consultarPreferencia, mapearStatus };
