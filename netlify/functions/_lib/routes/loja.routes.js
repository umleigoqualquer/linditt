// Rotas PÚBLICAS da sacola de compras (sem login)
const router = require('express').Router();
const { supabase } = require('../supabase');
const { limitar } = require('../rateLimit');
const { aplicarCupom } = require('../services/cupom.service');
const { getConfig } = require('../services/config.service');
const frete = require('../services/frete.service');
const sumup = require('../services/sumup.service');
const pedidos = require('../services/pedido.service');

const limiteGeral = limitar({ janelaMs: 60 * 1000, max: 60 });
const limiteCriarPedido = limitar({ janelaMs: 10 * 60 * 1000, max: 15, mensagem: 'Muitos pedidos em pouco tempo. Tente de novo em alguns minutos.' });

router.use(limiteGeral);

function urlDoSite(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

router.get('/config', async (req, res) => {
  try {
    const config = await getConfig();
    const f = config.frete || {};
    res.json({ gratisAtivo: Boolean(f.gratisAtivo), gratisAcima: Number(f.gratisAcima) || 0, pagamentoOnline: sumup.configurado() });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.get('/cep/:cep', async (req, res) => {
  const cep = frete.limparCep(req.params.cep);
  if (!frete.cepValido(cep)) return res.status(400).json({ erro: 'CEP inválido.' });
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    if (!r.ok || d.erro) return res.status(404).json({ erro: 'CEP não encontrado.' });
    res.json({ cep, rua: d.logradouro || '', bairro: d.bairro || '', cidade: d.localidade || '', uf: d.uf || '' });
  } catch (e) {
    res.status(502).json({ erro: 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.' });
  }
});

router.post('/cupom', async (req, res) => {
  const subtotal = Number((req.body || {}).subtotal) || 0;
  const r = await aplicarCupom((req.body || {}).codigo, subtotal);
  if (r.erro) return res.status(400).json({ erro: r.erro });
  res.json({ codigo: r.cupom.codigo, tipo: r.cupom.tipo, valor: r.cupom.valor });
});

async function calcularSacola(config, body) {
  const r = await pedidos.resolverItens(body.itens);
  if (r.erro) return { status: 409, erro: r.erro };

  const subtotal = pedidos.r2(r.itens.reduce((s, it) => s + it.preco * it.qtd, 0));
  let cupom = null;
  let descontoCupom = 0;
  if (body.cupom) {
    const c = await aplicarCupom(body.cupom, subtotal);
    if (c.erro) return { status: 400, erro: c.erro };
    cupom = c.cupom;
    descontoCupom = pedidos.r2(c.desconto);
  }
  const subtotalComDesconto = pedidos.r2(subtotal - descontoCupom);

  let cotacao;
  try {
    cotacao = await frete.cotar({ config, cepDestino: body.cep, itens: r.itens, subtotalComDesconto });
  } catch (e) {
    return { status: e.status || 502, erro: e.message };
  }
  return { itens: r.itens, subtotal, cupom, descontoCupom, subtotalComDesconto, cotacao };
}

router.post('/frete', async (req, res) => {
  try {
    await pedidos.liberarExpirados();
    const config = await getConfig();
    const s = await calcularSacola(config, req.body || {});
    if (s.erro) return res.status(s.status).json({ erro: s.erro });
    res.json({ subtotal: s.subtotal, descontoCupom: s.descontoCupom, opcoes: s.cotacao.opcoes, modo: s.cotacao.modo, aviso: s.cotacao.aviso || null });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function validarCliente(body) {
  const c = body.cliente || {};
  const e = body.endereco || {};
  const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const cliente = { nome: txt(c.nome, 100), email: txt(c.email, 120).toLowerCase(), telefone: String(c.telefone || '').replace(/\D/g, '').slice(0, 13) };
  const endereco = {
    cep: frete.limparCep(e.cep), rua: txt(e.rua, 120), numero: txt(e.numero, 20),
    complemento: txt(e.complemento, 60), bairro: txt(e.bairro, 80), cidade: txt(e.cidade, 80), uf: txt(e.uf, 2).toUpperCase()
  };
  if (cliente.nome.length < 3) return { erro: 'Informe seu nome completo.' };
  if (!emailOk(cliente.email)) return { erro: 'Informe um e-mail válido.' };
  if (cliente.telefone.length < 10) return { erro: 'Informe um telefone com DDD.' };
  if (!frete.cepValido(endereco.cep)) return { erro: 'Informe um CEP válido.' };
  if (!endereco.rua || !endereco.numero || !endereco.bairro || !endereco.cidade || endereco.uf.length !== 2) {
    return { erro: 'Preencha o endereço completo (rua, número, bairro, cidade e UF).' };
  }
  return { cliente, endereco };
}

router.post('/pedidos', limiteCriarPedido, async (req, res) => {
  const body = req.body || {};
  if (!sumup.configurado()) {
    return res.status(503).json({ semGateway: true, erro: 'O pagamento online ainda não está disponível. Você pode finalizar seu pedido pelo WhatsApp.' });
  }

  try {
    await pedidos.liberarExpirados();
    const config = await getConfig();

    const v = validarCliente(body);
    if (v.erro) return res.status(400).json({ erro: v.erro });

    const s = await calcularSacola(config, { itens: body.itens, cupom: body.cupom, cep: v.endereco.cep });
    if (s.erro) return res.status(s.status).json({ erro: s.erro });

    const opcao = s.cotacao.opcoes.find((o) => o.id === body.freteId);
    if (!opcao) return res.status(409).json({ erro: 'As opções de frete mudaram. Calcule o frete de novo e escolha uma opção.' });

    const total = pedidos.r2(s.subtotalComDesconto + opcao.preco);
    if (!(total > 0)) return res.status(400).json({ erro: 'Valor do pedido inválido.' });

    // Reserva atômica ANTES de falar com a SumUp
    await pedidos.reservar(s.itens);

    const agora = new Date();
    const pedidoId = pedidos.novoId();
    const token = pedidos.novoToken();
    const novoPedido = {
      id: pedidoId,
      token,
      status: 'aguardando_pagamento',
      cliente: v.cliente,
      endereco: v.endereco,
      itens: s.itens.map(({ id, nome, tamanho, preco, qtd }) => ({ id, nome, tamanho, preco, qtd })),
      frete: { id: opcao.id, nome: opcao.nome, empresa: opcao.empresa, preco: opcao.preco, prazo: opcao.prazo },
      subtotal: s.subtotal,
      cupom: s.cupom ? s.cupom.codigo : null,
      desconto_cupom: s.descontoCupom,
      total,
      expira_em: new Date(agora.getTime() + pedidos.VALIDADE_MINUTOS * 60 * 1000).toISOString(),
      pagamento: null,
      rastreio: '',
      avisos: {}
    };

    const { error: ePedido } = await supabase().from('pedidos').insert(novoPedido);
    if (ePedido) {
      // Desfaz reserva se falhar ao salvar o pedido
      await pedidos.devolver(novoPedido.itens, 'falha ao criar pedido');
      throw ePedido;
    }

    const site = urlDoSite(req);
    let checkout;
    try {
      checkout = await sumup.criarCheckout({
        referencia: pedidoId,
        valor: total,
        moeda: 'BRL',
        descricao: `Pedido ${pedidoId} - Linditt Boutique`,
        redirectUrl: `${site}/?pedido=${pedidoId}&t=${token}`,
        returnUrl: process.env.SITE_URL ? `${site}/api/pagamentos/webhook` : undefined,
        hospedado: true
      });
    } catch (e) {
      await pedidos.devolver(novoPedido.itens, 'falha ao criar checkout SumUp');
      await supabase().from('pedidos').update({ status: 'cancelado', alerta: e.message }).eq('id', pedidoId);
      return res.status(502).json({ erro: 'Não conseguimos iniciar o pagamento agora. Tente de novo em instantes ou finalize pelo WhatsApp.' });
    }

    if (!checkout.hosted_checkout_url) {
      await pedidos.devolver(novoPedido.itens, 'checkout sem URL');
      await supabase().from('pedidos').update({ status: 'cancelado' }).eq('id', pedidoId);
      return res.status(502).json({ erro: 'A SumUp não devolveu o link de pagamento.' });
    }

    const pagamento = { provedor: 'sumup', checkoutId: checkout.id, status: checkout.status, url: checkout.hosted_checkout_url };
    await supabase().from('pedidos').update({ pagamento }).eq('id', pedidoId);

    res.status(201).json({ pedidoId, token, pagamentoUrl: checkout.hosted_checkout_url });
  } catch (e) {
    console.error('[pedido]', e.message);
    res.status(500).json({ erro: e.message });
  }
});

router.get('/pedidos/:id', async (req, res) => {
  try {
    await pedidos.liberarExpirados();
    const { data: pedido } = await supabase().from('pedidos').select('*').eq('id', req.params.id).maybeSingle();
    if (!pedido || !req.query.t || pedido.token !== String(req.query.t)) {
      return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    if (pedido.status === 'aguardando_pagamento') {
      try { await pedidos.sincronizarPagamento(pedido); } catch (e) { console.error('[pedido] sincronizar:', e.message); }
    }
    const { data: atualizado } = await supabase().from('pedidos').select('*').eq('id', req.params.id).maybeSingle();
    const p = atualizado || pedido;
    res.json({
      id: p.id, status: p.status, total: p.total,
      itens: (p.itens || []).map(({ nome, tamanho, qtd }) => ({ nome, tamanho, qtd })),
      frete: { nome: p.frete.nome, empresa: p.frete.empresa, prazo: p.frete.prazo, preco: p.frete.preco },
      rastreio: p.rastreio || '',
      pagamentoUrl: p.status === 'aguardando_pagamento' && p.pagamento ? p.pagamento.url : null
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

module.exports = router;
