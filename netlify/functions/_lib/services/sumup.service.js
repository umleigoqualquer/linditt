const SUMUP_API_BASE = 'https://api.sumup.com';

const modoTeste = () => process.env.SUMUP_MODO_TESTE === '1';
const checkoutsSimulados = new Map();

function configurado() {
  return modoTeste() || Boolean(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE);
}

function erroNaoConfigurado() {
  const erro = new Error('Gateway SumUp não configurado. Defina SUMUP_API_KEY e SUMUP_MERCHANT_CODE nas variáveis de ambiente.');
  erro.naoConfigurado = true;
  return erro;
}

async function chamarSumUp(caminho, opcoes) {
  const resposta = await fetch(SUMUP_API_BASE + caminho, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${process.env.SUMUP_API_KEY}`,
      'Content-Type': 'application/json',
      ...(opcoes && opcoes.headers)
    },
    signal: AbortSignal.timeout(15000)
  });
  let dados = null;
  try { dados = await resposta.json(); } catch (e) { /* resposta sem corpo */ }
  if (!resposta.ok) {
    const erro = new Error((dados && (dados.message || dados.error_description)) || 'Falha ao falar com a SumUp.');
    erro.status = resposta.status;
    erro.detalhes = dados;
    throw erro;
  }
  return dados;
}

async function criarCheckout({ referencia, valor, moeda, descricao, returnUrl, redirectUrl, hospedado }) {
  if (!configurado()) throw erroNaoConfigurado();

  if (modoTeste()) {
    const id = 'teste_' + Math.random().toString(36).slice(2, 12);
    const checkout = {
      id, status: 'PENDING', checkout_reference: referencia, amount: valor, currency: moeda || 'BRL',
      hosted_checkout_url: redirectUrl || null
    };
    checkoutsSimulados.set(id, checkout);
    return { ...checkout };
  }

  return chamarSumUp('/v0.1/checkouts', {
    method: 'POST',
    body: JSON.stringify({
      checkout_reference: referencia,
      amount: valor,
      currency: moeda || 'BRL',
      merchant_code: process.env.SUMUP_MERCHANT_CODE,
      description: descricao || 'Compra Linditt Boutique',
      return_url: returnUrl || process.env.SUMUP_RETURN_URL || undefined,
      redirect_url: redirectUrl || undefined,
      hosted_checkout: hospedado ? { enabled: true } : undefined
    })
  });
}

async function consultarCheckout(id) {
  if (!configurado()) throw erroNaoConfigurado();
  if (modoTeste()) {
    const c = checkoutsSimulados.get(id);
    if (!c) throw Object.assign(new Error('Checkout de teste não encontrado.'), { status: 404 });
    return { ...c };
  }
  return chamarSumUp(`/v0.1/checkouts/${encodeURIComponent(id)}`, { method: 'GET' });
}

function simularStatus(id, status) {
  if (!modoTeste()) return false;
  const c = checkoutsSimulados.get(id);
  if (!c) return false;
  c.status = status;
  return true;
}

module.exports = { configurado, modoTeste, criarCheckout, consultarCheckout, simularStatus };
