// WhatsApp Cloud API (Meta) — configurado via variáveis de ambiente no Netlify
const NUMERO_DA_LOJA = '5511964824048';

function apiBase() {
  return (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/$/, '');
}
function versao() {
  return process.env.WHATSAPP_API_VERSION || 'v23.0';
}
function destinatarios() {
  const bruto = process.env.WHATSAPP_LOJA || NUMERO_DA_LOJA;
  return bruto.split(',').map((n) => n.replace(/\D/g, '')).filter((n) => n.length >= 12);
}
function configurado() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID && destinatarios().length);
}
function limparParametro(t, max) {
  return String(t == null ? '' : t).replace(/[\r\n\t ]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max || 200) || '-';
}

async function enviarModelo(para, parametros) {
  const resposta = await fetch(`${apiBase()}/${versao()}/${encodeURIComponent(process.env.WHATSAPP_PHONE_ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: para,
      type: 'template',
      template: {
        name: process.env.WHATSAPP_TEMPLATE || 'novo_pedido_pago',
        language: { code: process.env.WHATSAPP_LANG || 'pt_BR' },
        components: [{ type: 'body', parameters: parametros.map((p) => ({ type: 'text', text: limparParametro(p, 300) })) }]
      }
    }),
    signal: AbortSignal.timeout(15000)
  });
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const detalhe = dados && dados.error ? `${dados.error.message}${dados.error.code ? ' (código ' + dados.error.code + ')' : ''}` : `HTTP ${resposta.status}`;
    throw new Error(detalhe);
  }
  return dados;
}

async function avisarLoja(parametros) {
  if (!configurado()) {
    const erro = new Error('WhatsApp não configurado no ambiente do backend.');
    erro.naoConfigurado = true;
    throw erro;
  }
  const falhas = [];
  for (const numero of destinatarios()) {
    try { await enviarModelo(numero, parametros); } catch (e) { falhas.push(`${numero}: ${e.message}`); }
  }
  if (falhas.length) throw new Error(falhas.join(' | '));
}

module.exports = { configurado, destinatarios, avisarLoja, limparParametro };
