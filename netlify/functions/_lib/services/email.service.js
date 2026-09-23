const nodemailer = require('nodemailer');
const { supabase } = require('../supabase');

async function origem() {
  // Tenta primeiro a configuração salva no painel (tabela config no Supabase)
  try {
    const { data } = await supabase().from('config').select('dados').eq('id', 1).maybeSingle();
    const cfgEmail = (data?.dados || {}).email || {};
    if (cfgEmail.smtpHost) {
      return {
        host: cfgEmail.smtpHost,
        port: Number(cfgEmail.smtpPort) || 587,
        secure: Boolean(cfgEmail.smtpSecure),
        user: cfgEmail.smtpUser || '',
        pass: cfgEmail.smtpPass || '',
        from: cfgEmail.from || cfgEmail.smtpUser || '',
        destinatarios: Array.isArray(cfgEmail.destinatarios) ? cfgEmail.destinatarios : []
      };
    }
  } catch (e) { /* se o Supabase falhar, cai no .env */ }

  // Fallback: variáveis de ambiente
  const porta = Number(process.env.SMTP_PORT) || 587;
  return {
    host: process.env.SMTP_HOST || '',
    port: porta,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : porta === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || '',
    destinatarios: String(process.env.EMAIL_LOJA || '').split(',').map((e) => e.trim()).filter(Boolean)
  };
}

async function destinatariosLoja() {
  return (await origem()).destinatarios;
}

async function configurado() {
  const o = await origem();
  return Boolean(o.host && o.from && o.destinatarios.length);
}

async function enviar({ para, assunto, texto, html, responderPara }) {
  const o = await origem();
  if (!o.host || !o.from || !o.destinatarios.length) {
    const erro = new Error('E-mail não configurado. Preencha os dados de SMTP na aba Frete do painel.');
    erro.naoConfigurado = true;
    throw erro;
  }
  const transporte = nodemailer.createTransport({
    host: o.host,
    port: o.port,
    secure: o.secure,
    auth: o.user ? { user: o.user, pass: o.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });
  return transporte.sendMail({ from: o.from, to: para, subject: assunto, text: texto, html, replyTo: responderPara || undefined });
}

module.exports = { configurado, destinatariosLoja, enviar };
