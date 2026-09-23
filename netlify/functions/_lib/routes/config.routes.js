const router = require('express').Router();
const { getConfig, saveConfig } = require('../services/config.service');
const { exigirAuth } = require('../auth');
const frete = require('../services/frete.service');
const sumup = require('../services/sumup.service');
const email = require('../services/email.service');
const whatsapp = require('../services/whatsapp.service');
const notificacao = require('../services/notificacao.service');

router.use(exigirAuth);

const CATEGORIAS = ['festa', 'casual', 'complementos'];

router.get('/', async (req, res) => {
  try {
    const config = await getConfig();
    const em = config.email || {};
    res.json({
      frete: config.frete,
      embalagens: config.embalagens,
      email: {
        smtpHost: em.smtpHost || '', smtpPort: em.smtpPort || 587, smtpSecure: Boolean(em.smtpSecure),
        smtpUser: em.smtpUser || '', from: em.from || '', destinatarios: em.destinatarios || [],
        senhaDefinida: Boolean(em.smtpPass)
      },
      status: {
        melhorEnvio: frete.melhorEnvioConfigurado(),
        sumup: sumup.configurado(),
        sumupTeste: sumup.modoTeste(),
        email: await email.configurado(),
        emailDestino: (await email.destinatariosLoja()).join(', '),
        whatsapp: whatsapp.configurado(),
        whatsappDestino: whatsapp.destinatarios().join(', ')
      }
    });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/avisos/testar', async (req, res) => {
  const canal = (req.body || {}).canal === 'whatsapp' ? 'whatsapp' : 'email';
  const emailConf = await email.configurado();
  if (canal === 'whatsapp' && !whatsapp.configurado()) {
    return res.status(501).json({ erro: 'WhatsApp ainda não configurado. Preencha WHATSAPP_TOKEN e WHATSAPP_PHONE_ID nas variáveis de ambiente do Netlify.' });
  }
  if (canal === 'email' && !emailConf) {
    return res.status(501).json({ erro: 'E-mail ainda não configurado. Preencha os dados de SMTP aqui na aba Frete.' });
  }
  try {
    await notificacao.enviarTeste(canal);
    const para = canal === 'whatsapp' ? whatsapp.destinatarios() : await email.destinatariosLoja();
    res.json({ ok: true, para: para.join(', ') });
  } catch (e) {
    res.status(502).json({ erro: 'Não foi possível enviar: ' + e.message });
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.put('/', async (req, res) => {
  try {
    const config = await getConfig();
    const body = req.body || {};

    if (body.frete || body.embalagens) {
      const f = body.frete || {};
      const e = body.embalagens || {};
      const modo = f.modo === 'calculado' ? 'calculado' : 'fixo';
      const valorFixo = Number(f.valorFixo);
      if (!(valorFixo >= 0)) return res.status(400).json({ erro: 'Informe o valor do frete fixo (pode ser 0).' });
      const gratisAtivo = Boolean(f.gratisAtivo);
      const gratisAcima = Number(f.gratisAcima);
      if (gratisAtivo && !(gratisAcima > 0)) return res.status(400).json({ erro: 'Informe a partir de quanto o frete é grátis.' });
      const cepOrigem = frete.limparCep(f.cepOrigem);
      if (!frete.cepValido(cepOrigem)) return res.status(400).json({ erro: 'CEP de origem inválido.' });
      const embalagens = {};
      for (const cat of CATEGORIAS) {
        const x = e[cat] || {};
        const emb = { peso: Number(x.peso), comprimento: Number(x.comprimento), largura: Number(x.largura), altura: Number(x.altura) };
        if (!(emb.peso > 0 && emb.comprimento > 0 && emb.largura > 0 && emb.altura > 0)) {
          return res.status(400).json({ erro: 'Preencha peso e medidas de todas as embalagens.' });
        }
        embalagens[cat] = emb;
      }
      config.frete = {
        modo, valorFixo,
        prazoFixo: String(f.prazoFixo || '').trim().slice(0, 60) || 'prazo a confirmar',
        gratisAtivo, gratisAcima: gratisAcima > 0 ? gratisAcima : (config.frete || {}).gratisAcima,
        cepOrigem
      };
      config.embalagens = embalagens;
    }

    if (body.email) {
      const em = body.email;
      const host = String(em.smtpHost || '').trim();
      if (!host) {
        config.email = { smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '', smtpPass: '', from: '', destinatarios: [] };
      } else {
        const porta = parseInt(em.smtpPort, 10);
        if (!(porta > 0 && porta < 65536)) return res.status(400).json({ erro: 'Porta do SMTP inválida.' });
        const from = String(em.from || '').trim();
        if (!from) return res.status(400).json({ erro: 'Informe o remetente.' });
        const destinatarios = (Array.isArray(em.destinatarios) ? em.destinatarios : String(em.destinatarios || '').split(','))
          .map((x) => String(x).trim()).filter(Boolean);
        if (!destinatarios.length || !destinatarios.every((x) => EMAIL_RE.test(x))) {
          return res.status(400).json({ erro: 'Informe ao menos um e-mail válido para receber os avisos.' });
        }
        const passAtual = (config.email || {}).smtpPass || '';
        config.email = {
          smtpHost: host, smtpPort: porta, smtpSecure: Boolean(em.smtpSecure),
          smtpUser: String(em.smtpUser || '').trim(),
          smtpPass: em.smtpPass === undefined ? passAtual : String(em.smtpPass),
          from, destinatarios
        };
      }
    }

    await saveConfig(config);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

router.post('/frete/testar', async (req, res) => {
  try {
    const config = await getConfig();
    const exemplo = [{ produto: { id: 'teste', cat: 'casual', preco: 100 }, qtd: 1 }];
    const r = await frete.cotar({ config, cepDestino: (req.body || {}).cep, itens: exemplo, subtotalComDesconto: 0 });
    res.json(r);
  } catch (e) { res.status(e.status || 502).json({ erro: e.message }); }
});

module.exports = router;
