const crypto = require('crypto');
const { supabase } = require('../supabase');
const sumup = require('./sumup.service');

const VALIDADE_MINUTOS = 40;
const r2 = (n) => Math.round(Number(n) * 100) / 100;

function novoId() {
  return 'PED-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function novoToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Verifica itens do cliente contra estoque REAL no Supabase; preços vêm sempre do banco.
async function resolverItens(pedidoItens) {
  if (!Array.isArray(pedidoItens) || !pedidoItens.length) return { erro: 'Sua sacola está vazia.' };

  const somados = new Map();
  for (const it of pedidoItens) {
    const qtd = Number(it && it.qtd);
    if (!it || !Number.isInteger(qtd) || qtd < 1 || qtd > 50) return { erro: 'Quantidade inválida na sacola.' };
    const chave = it.id + '|' + (it.tamanho || 'Único');
    somados.set(chave, (somados.get(chave) || 0) + qtd);
  }

  const ids = [...new Set([...somados.keys()].map((k) => k.split('|')[0]))];
  const { data: produtos, error } = await supabase()
    .from('produtos_com_estoque')
    .select('id, nome, preco, ativo, grade, tamanhos')
    .in('id', ids);
  if (error) throw error;

  const itens = [];
  for (const [chave, qtd] of somados) {
    const [id, tamanho] = chave.split('|');
    const produto = (produtos || []).find((p) => p.id === id && p.ativo);
    if (!produto) return { erro: 'Uma das peças da sacola não está mais disponível.' };
    const grade = produto.grade || {};
    const livre = Number(grade[tamanho]) || 0;
    if (qtd > livre) {
      return { erro: livre > 0
        ? `Só temos ${livre} de "${produto.nome}" no tamanho ${tamanho}.`
        : `"${produto.nome}" (${tamanho}) acabou de esgotar.` };
    }
    itens.push({ produto, id: produto.id, nome: produto.nome, tamanho, preco: Number(produto.preco), qtd });
  }
  return { itens };
}

// Reserva atômica via função PL/pgSQL (nunca deixa dois clientes comprarem a última peça)
async function reservar(itens) {
  const payload = itens.map((it) => ({ produto_id: it.id, tamanho: it.tamanho, qtd: it.qtd }));
  const { error } = await supabase().rpc('reservar_estoque', { itens: JSON.stringify(payload) });
  if (error) throw Object.assign(new Error(error.message || 'Estoque insuficiente.'), { status: 409 });
}

async function devolver(itensPedido, motivo) {
  const payload = itensPedido.map((it) => ({ produto_id: it.id, tamanho: it.tamanho, qtd: it.qtd }));
  await supabase().rpc('devolver_estoque', { itens: JSON.stringify(payload), motivo: motivo || 'devolução' });
}

// Libera pedidos não pagos que passaram do prazo; chamado no início de rotas relevantes.
async function liberarExpirados() {
  const agora = new Date().toISOString();
  const { data: expirados } = await supabase()
    .from('pedidos')
    .select('id, itens')
    .eq('status', 'aguardando_pagamento')
    .lt('expira_em', agora);

  if (!expirados || !expirados.length) return;
  for (const pedido of expirados) {
    if (Array.isArray(pedido.itens) && pedido.itens.length) {
      await devolver(pedido.itens, 'pedido expirado');
    }
    await supabase().from('pedidos').update({ status: 'expirado', atualizado_em: agora }).eq('id', pedido.id);
  }
}

async function confirmarPagamento(pedido) {
  const agora = new Date().toISOString();
  pedido.status = 'pago';
  pedido.atualizado_em = agora;

  // Registra venda
  const vendaId = 'v' + Date.now() + Math.random().toString(36).slice(2, 5);
  const dadosVenda = {
    id: vendaId,
    data: agora,
    itens: pedido.itens,
    subtotal: pedido.subtotal,
    desconto: pedido.desconto_cupom || 0,
    total: r2(pedido.subtotal - (pedido.desconto_cupom || 0)),
    frete: pedido.frete ? pedido.frete.preco : 0,
    pagamento: 'Online (SumUp)',
    parcelas: 1,
    cliente: pedido.cliente ? pedido.cliente.nome : '',
    cupom: pedido.cupom,
    descontoCupom: pedido.desconto_cupom || 0,
    cancelada: false,
    pagamentoGateway: { provedor: 'sumup', checkoutId: pedido.pagamento && pedido.pagamento.checkoutId, status: 'PAID' },
    origem: 'online',
    pedidoId: pedido.id
  };

  await supabase().from('vendas_loja').insert({ id: vendaId, dados: dadosVenda, cancelada: false });

  if (pedido.cupom) {
    const { data: cup } = await supabase().from('cupons').select('usos').eq('codigo', pedido.cupom).maybeSingle();
    if (cup) await supabase().from('cupons').update({ usos: (cup.usos || 0) + 1 }).eq('codigo', pedido.cupom);
  }

  await supabase().from('pedidos').update({
    status: 'pago',
    venda_id: vendaId,
    atualizado_em: agora,
    'pagamento': pedido.pagamento
  }).eq('id', pedido.id);

  pedido.venda_id = vendaId;
  return pedido;
}

async function cancelarPedido(pedidoId) {
  const { data: pedido } = await supabase().from('pedidos').select('*').eq('id', pedidoId).maybeSingle();
  if (!pedido) return null;

  const estavaPago = ['pago', 'enviado', 'entregue'].includes(pedido.status);
  const podeDevolverEstoque = pedido.status === 'aguardando_pagamento' || estavaPago;

  if (podeDevolverEstoque && Array.isArray(pedido.itens) && pedido.itens.length) {
    await devolver(pedido.itens, 'pedido cancelado');
  }

  if (estavaPago && pedido.venda_id) {
    await supabase().from('vendas_loja').update({ cancelada: true }).eq('id', pedido.venda_id);
  }

  const agora = new Date().toISOString();
  await supabase().from('pedidos').update({ status: 'cancelado', atualizado_em: agora }).eq('id', pedidoId);
  return { ...pedido, status: 'cancelado', atualizado_em: agora };
}

async function sincronizarPagamento(pedido) {
  const checkoutId = pedido.pagamento && pedido.pagamento.checkoutId;
  if (!checkoutId || ['pago', 'enviado', 'entregue'].includes(pedido.status)) return pedido;

  const checkout = await sumup.consultarCheckout(checkoutId);
  if (['pago', 'enviado', 'entregue'].includes(pedido.status)) return pedido;
  if (checkout.checkout_reference && checkout.checkout_reference !== pedido.id) return pedido;
  if (checkout.amount != null && Math.abs(Number(checkout.amount) - pedido.total) > 0.005) {
    console.error(`[pedido ${pedido.id}] valor do checkout (${checkout.amount}) difere do pedido (${pedido.total}); ignorado.`);
    return pedido;
  }

  const status = String(checkout.status || '').toUpperCase();
  const pagAtual = pedido.pagamento || {};
  pagAtual.status = status;
  pedido.pagamento = pagAtual;

  if (status === 'PAID') {
    await confirmarPagamento(pedido);
    const notificacao = require('./notificacao.service');
    Promise.resolve().then(() => notificacao.notificarPedidoPago(pedido).catch((e) => console.error('[aviso]', e.message)));
  } else if (status === 'EXPIRED' && pedido.status === 'aguardando_pagamento') {
    if (Array.isArray(pedido.itens)) await devolver(pedido.itens, 'checkout expirado na SumUp');
    await supabase().from('pedidos').update({
      status: 'expirado',
      atualizado_em: new Date().toISOString(),
      pagamento: pagAtual
    }).eq('id', pedido.id);
    pedido.status = 'expirado';
  } else {
    await supabase().from('pedidos').update({ pagamento: pagAtual }).eq('id', pedido.id);
  }
  return pedido;
}

module.exports = { r2, novoId, novoToken, resolverItens, reservar, devolver, liberarExpirados, confirmarPagamento, cancelarPedido, sincronizarPagamento, VALIDADE_MINUTOS };
