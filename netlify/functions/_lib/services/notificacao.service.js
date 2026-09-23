const { supabase } = require('../supabase');
const email = require('./email.service');
const whatsapp = require('./whatsapp.service');

const WHATSAPP_LOJA = '5511964824048';
const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cepFmt = (c) => String(c).replace(/^(\d{5})(\d{3})$/, '$1-$2');
const site = () => (process.env.SITE_URL || 'http://localhost:3333').replace(/\/$/, '');
const primeiroNome = (p) => String(p.cliente.nome).trim().split(/\s+/)[0];

function telefoneWhats(t) {
  const d = String(t || '').replace(/\D/g, '');
  return d.length >= 12 && d.startsWith('55') ? d : '55' + d;
}
function telefoneBonito(t) {
  const d = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;
}
const nomeItem = (i) => `${i.nome}${i.tamanho !== 'Único' ? ` (${i.tamanho})` : ''}`;
const linkPedido = (p) => `${site()}/?pedido=${p.id}&t=${p.token}`;

function enderecoLinhas(p) {
  const e = p.endereco;
  return [`${e.rua}, ${e.numero}${e.complemento ? ' - ' + e.complemento : ''}`, e.bairro, `${e.cidade}/${e.uf} - CEP ${cepFmt(e.cep)}`];
}

function resumoTexto(p) {
  const l = p.itens.map((i) => `  ${i.qtd}x ${nomeItem(i)} — ${moeda(i.preco * i.qtd)}`);
  l.push('', `  Subtotal: ${moeda(p.subtotal)}`);
  if (p.descontoCupom || p.desconto_cupom) l.push(`  Desconto${p.cupom ? ' (cupom ' + p.cupom + ')' : ''}: -${moeda(p.descontoCupom || p.desconto_cupom)}`);
  const frete = p.frete || {};
  l.push(`  Frete (${frete.nome || ''}${frete.empresa ? ' - ' + frete.empresa : ''}): ${frete.preco ? moeda(frete.preco) : 'grátis'}`);
  l.push(`  TOTAL: ${moeda(p.total)}`);
  return l.join('\n');
}

function resumoHtml(p) {
  const td = 'padding:6px 0;border-bottom:1px solid #eee;';
  const linha = (r, v, f) => `<tr><td style="${td}${f ? 'font-weight:bold;' : ''}">${r}</td><td align="right" style="${td}${f ? 'font-weight:bold;' : ''}">${v}</td></tr>`;
  const frete = p.frete || {};
  const desc = p.descontoCupom || p.desconto_cupom || 0;
  return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;margin:12px 0">' +
    p.itens.map((i) => linha(`${i.qtd}&times; ${esc(nomeItem(i))}`, moeda(i.preco * i.qtd))).join('') +
    linha('Subtotal', moeda(p.subtotal)) +
    (desc ? linha(`Desconto${p.cupom ? ' (cupom ' + esc(p.cupom) + ')' : ''}`, '-' + moeda(desc)) : '') +
    linha(`Frete (${esc(frete.nome || '')}${frete.empresa ? ' - ' + esc(frete.empresa) : ''})`, frete.preco ? moeda(frete.preco) : 'grátis') +
    linha('Total', moeda(p.total), true) + '</table>';
}

function moldura(conteudo) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2B2019;line-height:1.5">' +
    '<h2 style="font-weight:normal;color:#8C6526;border-bottom:1px solid #eee;padding-bottom:8px;margin-bottom:16px">Linditt Boutique</h2>' +
    conteudo + '<p style="font-size:12px;color:#888;margin-top:24px">R. Campos Sales, 69 &mdash; Loja 16, Santo Andr&eacute;/SP</p></div>';
}

function mensagemLoja(p) {
  const e = enderecoLinhas(p);
  const zap = `https://wa.me/${telefoneWhats(p.cliente.telefone)}`;
  const texto = [`Novo pedido PAGO no site: ${p.id}`, '', `Cliente: ${p.cliente.nome}`, `Telefone: ${telefoneBonito(p.cliente.telefone)} (${zap})`, `E-mail: ${p.cliente.email}`, '', 'Itens:', resumoTexto(p), '', 'Enviar para:', ...e.map((x) => '  ' + x), '', `Prazo combinado com o cliente: ${(p.frete || {}).prazo}`, '', 'Abra o painel da loja (aba Pedidos) para postar o código de rastreio.'].join('\n');
  const html = moldura(`<h3 style="margin:0 0 4px">Novo pedido pago: ${esc(p.id)}</h3><p style="margin:0 0 12px;color:#666">${esc(p.cliente.nome)} &middot; ${esc(telefoneBonito(p.cliente.telefone))} &middot; <a href="${zap}">chamar no WhatsApp</a> &middot; ${esc(p.cliente.email)}</p>` + resumoHtml(p) + `<p style="margin:12px 0 4px"><strong>Enviar para:</strong><br>${e.map(esc).join('<br>')}</p><p style="color:#666">Prazo: ${esc((p.frete || {}).prazo)}.</p><p>Abra o painel (aba <strong>Pedidos</strong>) para informar o c&oacute;digo de rastreio.</p>`);
  return { assunto: `Novo pedido pago ${p.id} - ${moeda(p.total)}`, texto, html };
}

function mensagemClientePago(p) {
  const e = enderecoLinhas(p);
  const zap = `https://wa.me/${WHATSAPP_LOJA}?text=${encodeURIComponent('Olá! Tenho uma dúvida sobre o pedido ' + p.id)}`;
  const texto = [`Olá, ${primeiroNome(p)}!`, '', 'Recebemos o seu pagamento e já estamos separando o seu pedido. Obrigada pela compra!', '', `Pedido: ${p.id}`, resumoTexto(p), '', 'Vamos enviar para:', ...e.map((x) => '  ' + x), '', `Prazo de entrega: ${(p.frete || {}).prazo}.`, '', `Acompanhe o pedido: ${linkPedido(p)}`, `Dúvidas? WhatsApp: ${zap}`, '', 'Linditt Boutique'].join('\n');
  const html = moldura(`<p>Ol&aacute;, ${esc(primeiroNome(p))}!</p><p>Recebemos o seu pagamento e j&aacute; estamos separando o seu pedido. <strong>Obrigada pela compra!</strong></p><p style="margin-bottom:0"><strong>Pedido ${esc(p.id)}</strong></p>` + resumoHtml(p) + `<p style="margin:12px 0 4px"><strong>Vamos enviar para:</strong><br>${e.map(esc).join('<br>')}</p><p>Prazo: ${esc((p.frete || {}).prazo)}.</p><p><a href="${esc(linkPedido(p))}">Acompanhar meu pedido</a> &middot; <a href="${zap}">D&uacute;vidas? WhatsApp</a></p>`);
  return { assunto: `Recebemos seu pedido ${p.id} - Linditt Boutique`, texto, html };
}

function mensagemClienteEnvio(p) {
  const zap = `https://wa.me/${WHATSAPP_LOJA}?text=${encodeURIComponent('Olá! Tenho uma dúvida sobre o pedido ' + p.id)}`;
  const transp = (p.frete && p.frete.empresa) ? ` pela ${p.frete.empresa}` : '';
  const texto = [`Olá, ${primeiroNome(p)}!`, '', `Seu pedido ${p.id} foi enviado${transp}.`, p.rastreio ? `Código de rastreio: ${p.rastreio}` : 'O código de rastreio aparecerá na página do pedido.', `Prazo: ${(p.frete || {}).prazo}.`, '', `Acompanhe: ${linkPedido(p)}`, `WhatsApp: ${zap}`, '', 'Linditt Boutique'].join('\n');
  const html = moldura(`<p>Ol&aacute;, ${esc(primeiroNome(p))}!</p><p><strong>Seu pedido ${esc(p.id)} foi enviado${esc(transp)}.</strong></p>` + (p.rastreio ? `<p style="font-size:18px;background:#FBF3E8;padding:10px 14px;border-left:3px solid #B4863F">C&oacute;digo de rastreio: <strong>${esc(p.rastreio)}</strong></p>` : '<p>O c&oacute;digo de rastreio aparecer&aacute; na p&aacute;gina do pedido.</p>') + `<p>Prazo: ${esc((p.frete || {}).prazo)}.</p><p><a href="${esc(linkPedido(p))}">Acompanhar meu pedido</a> &middot; <a href="${zap}">D&uacute;vidas? WhatsApp</a></p>`);
  return { assunto: `Seu pedido ${p.id} foi enviado - Linditt Boutique`, texto, html };
}

function parametrosWhatsApp(p) {
  const e = p.endereco;
  const desc = p.descontoCupom || p.desconto_cupom || 0;
  const frete = p.frete || {};
  return [
    p.id, p.cliente.nome, telefoneBonito(p.cliente.telefone),
    p.itens.map((i) => `${i.qtd}x ${nomeItem(i)}`).join('; '),
    moeda(p.total),
    `${frete.nome || ''}${frete.empresa ? ' ' + frete.empresa : ''} ${frete.preco ? moeda(frete.preco) : 'grátis'}`,
    `${e.rua}, ${e.numero}${e.complemento ? ' ' + e.complemento : ''} - ${e.bairro}, ${e.cidade}/${e.uf} - CEP ${cepFmt(e.cep)}`
  ];
}

async function tentar(pedidoId, chave, ativo, extra, enviarFn) {
  let estado;
  if (!ativo) {
    estado = { status: 'desligado' };
  } else {
    try {
      await enviarFn();
      estado = { status: 'enviado' };
    } catch (e) {
      console.error(`[aviso ${chave}] pedido ${pedidoId}:`, e.message);
      estado = { status: 'erro', erro: String(e.message).slice(0, 200) };
    }
  }
  Object.assign(estado, extra, { em: new Date().toISOString() });
  const { data: pedido } = await supabase().from('pedidos').select('avisos').eq('id', pedidoId).maybeSingle();
  if (pedido) {
    const avisos = { ...(pedido.avisos || {}), [chave]: estado };
    await supabase().from('pedidos').update({ avisos }).eq('id', pedidoId);
  }
}

async function notificarPedidoPago(pedido) {
  if (pedido.avisos && pedido.avisos.loja) return;
  const avisos = { ...(pedido.avisos || {}), loja: { status: 'enviando' }, cliente: { status: 'enviando' }, whatsapp: { status: 'enviando' } };
  await supabase().from('pedidos').update({ avisos }).eq('id', pedido.id);
  pedido.avisos = avisos;

  const m = mensagemLoja(pedido), c = mensagemClientePago(pedido);
  const emailOn = await email.configurado();
  await Promise.all([
    tentar(pedido.id, 'whatsapp', whatsapp.configurado(), {}, () => whatsapp.avisarLoja(parametrosWhatsApp(pedido))),
    tentar(pedido.id, 'loja', emailOn, {}, () => email.enviar({ para: await email.destinatariosLoja(), ...m, responderPara: pedido.cliente.email })),
    tentar(pedido.id, 'cliente', emailOn, {}, () => email.enviar({ para: pedido.cliente.email, ...c }))
  ]);
}

async function notificarEnvio(pedido) {
  const ja = pedido.avisos && pedido.avisos.envio;
  if (ja && (ja.status === 'enviando' || ja.rastreio === (pedido.rastreio || ''))) return;
  const avisos = { ...(pedido.avisos || {}), envio: { status: 'enviando', rastreio: pedido.rastreio || '' } };
  await supabase().from('pedidos').update({ avisos }).eq('id', pedido.id);
  const m = mensagemClienteEnvio(pedido);
  const emailOn = await email.configurado();
  await tentar(pedido.id, 'envio', emailOn, { rastreio: pedido.rastreio || '' }, () => email.enviar({ para: pedido.cliente.email, ...m }));
}

async function enviarTeste(canal) {
  if (canal === 'whatsapp') {
    return whatsapp.avisarLoja(['TESTE-0000', 'Cliente de Teste', '(11) 90000-0000', '1x Peça de exemplo (M)', moeda(199.9), 'Entrega ' + moeda(25), 'Rua Exemplo, 1 - Centro, Santo André/SP - CEP 09015-200']);
  }
  return email.enviar({
    para: await email.destinatariosLoja(),
    assunto: 'Teste de aviso - Linditt Boutique',
    texto: 'Se você recebeu este e-mail, os avisos de novos pedidos estão funcionando.',
    html: moldura('<p>Se voc&ecirc; recebeu este e-mail, os <strong>avisos de novos pedidos</strong> est&atilde;o funcionando.</p>')
  });
}

module.exports = { notificarPedidoPago, notificarEnvio, enviarTeste, mensagemLoja, mensagemClientePago, mensagemClienteEnvio, parametrosWhatsApp };
