function melhorEnvioConfigurado() {
  return Boolean(process.env.MELHORENVIO_TOKEN);
}

function baseUrl() {
  return process.env.MELHORENVIO_SANDBOX === '1'
    ? 'https://sandbox.melhorenvio.com.br'
    : 'https://melhorenvio.com.br';
}

function limparCep(cep) {
  return String(cep || '').replace(/\D/g, '');
}

function cepValido(cep) {
  return /^\d{8}$/.test(limparCep(cep));
}

function embalagemDe(produto, config) {
  const propria = produto.embalagem;
  if (propria && propria.peso > 0 && propria.comprimento > 0 && propria.largura > 0 && propria.altura > 0) return propria;
  const emb = config.embalagens || {};
  return emb[produto.cat] || emb.casual || { peso: 0.5, comprimento: 30, largura: 20, altura: 10 };
}

async function cotarMelhorEnvio({ cepOrigem, cepDestino, itens, config }) {
  const resposta = await fetch(baseUrl() + '/api/v2/me/shipment/calculate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MELHORENVIO_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': `Linditt Boutique (${process.env.MELHORENVIO_EMAIL || 'contato@lindittboutique.com.br'})`
    },
    body: JSON.stringify({
      from: { postal_code: limparCep(cepOrigem) },
      to: { postal_code: limparCep(cepDestino) },
      products: itens.map((it) => {
        const e = embalagemDe(it.produto, config);
        return {
          id: it.produto.id,
          width: e.largura,
          height: e.altura,
          length: e.comprimento,
          weight: e.peso,
          insurance_value: Number(it.produto.preco),
          quantity: it.qtd
        };
      })
    }),
    signal: AbortSignal.timeout(10000)
  });
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !Array.isArray(dados)) {
    throw new Error((dados && dados.message) || `Melhor Envio respondeu ${resposta.status}`);
  }
  return dados
    .filter((s) => !s.error && (s.custom_price || s.price))
    .map((s) => ({
      id: `me-${s.id}`,
      nome: s.name,
      empresa: (s.company && s.company.name) || '',
      preco: Number(s.custom_price || s.price),
      prazo: prazoTexto((s.delivery_range && s.delivery_range.max) || s.delivery_time)
    }))
    .sort((a, b) => a.preco - b.preco);
}

function prazoTexto(dias) {
  const n = Number(dias);
  if (!n) return 'prazo a confirmar';
  return n === 1 ? '1 dia útil' : `até ${n} dias úteis`;
}

async function cotar({ config, cepDestino, itens, subtotalComDesconto }) {
  const f = config.frete || {};
  if (!cepValido(cepDestino)) throw Object.assign(new Error('Informe um CEP válido (8 números).'), { status: 400 });

  const fixo = () => [{
    id: 'fixo',
    nome: 'Entrega',
    empresa: '',
    preco: Number(f.valorFixo) || 0,
    prazo: f.prazoFixo || 'prazo a confirmar'
  }];

  let opcoes;
  let modo = 'fixo';
  let aviso;

  if (f.modo === 'calculado') {
    if (!melhorEnvioConfigurado()) {
      opcoes = fixo();
      aviso = 'cotacao_indisponivel';
    } else {
      try {
        opcoes = await cotarMelhorEnvio({ cepOrigem: f.cepOrigem, cepDestino, itens, config });
        modo = 'calculado';
        if (!opcoes.length) throw new Error('Nenhuma transportadora atende este CEP.');
      } catch (e) {
        console.error('[frete] cotação falhou, usando valor fixo:', e.message);
        opcoes = fixo();
        aviso = 'cotacao_indisponivel';
      }
    }
  } else {
    opcoes = fixo();
  }

  if (f.gratisAtivo && Number(f.gratisAcima) > 0 && subtotalComDesconto >= Number(f.gratisAcima)) {
    const maisBarata = opcoes[0];
    opcoes = [{ id: 'gratis', nome: 'Frete grátis', empresa: maisBarata.empresa, preco: 0, prazo: maisBarata.prazo }];
    modo = 'gratis';
    aviso = undefined;
  }

  return { opcoes, modo, aviso };
}

module.exports = { cotar, cepValido, limparCep, melhorEnvioConfigurado, embalagemDe };
