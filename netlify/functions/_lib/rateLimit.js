const { supabase } = require('./supabase');

function limitar({ janelaMs, max, mensagem }) {
  return async function (req, res, next) {
    const ip = req.headers['x-forwarded-for']
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.ip || 'unknown';
    const chave = `${ip}:${req.path}`;
    const agora = Date.now();
    const msg = mensagem || 'Muitas tentativas. Aguarde um pouco e tente de novo.';

    try {
      const { data } = await supabase()
        .from('tentativas')
        .select('contagem, bloqueado_ate, ultima')
        .eq('chave', chave)
        .maybeSingle();

      if (data) {
        if (data.bloqueado_ate && new Date(data.bloqueado_ate).getTime() > agora) {
          return res.status(429).json({ erro: msg });
        }
        const dentroJanela = data.ultima && (agora - new Date(data.ultima).getTime()) < janelaMs;
        const novaContagem = dentroJanela ? data.contagem + 1 : 1;

        if (novaContagem > max) {
          await supabase().from('tentativas').update({
            contagem: novaContagem,
            bloqueado_ate: new Date(agora + janelaMs).toISOString(),
            ultima: new Date(agora).toISOString()
          }).eq('chave', chave);
          return res.status(429).json({ erro: msg });
        }

        await supabase().from('tentativas').update({
          contagem: novaContagem,
          bloqueado_ate: null,
          ultima: new Date(agora).toISOString()
        }).eq('chave', chave);
      } else {
        await supabase().from('tentativas').upsert({
          chave,
          contagem: 1,
          ultima: new Date(agora).toISOString(),
          bloqueado_ate: null
        });
      }
    } catch (e) {
      console.error('[rateLimit]', e.message);
      // Falha no rate limit nunca bloqueia a requisição
    }
    next();
  };
}

module.exports = { limitar };
