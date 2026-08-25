'use strict';

const express  = require('express');
const crypto   = require('crypto');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { generateListing }                        = require('../services/listingGenerator');
const { sendWhatsAppMessage }                    = require('../services/whatsappClient');
const { sendDraftNotification, sendSellerReply } = require('../services/emailClient');

// ── estado em memória (cache) — persiste no Supabase ─────────────────────────
// key: E.164 phone string → { step, imageUrls, produto, preco, listingId }
const conversations = new Map();

// key: listingId → { sellerPhone, titulo, preco, cidade }
const pendingApprovals = new Map();

const SITE_URL        = process.env.SITE_URL || 'https://takko-catch-clean.lovable.app';
const OPERATOR_NUMBER = (process.env.OPERATOR_WHATSAPP || '').replace(/\D/g, '');

// ── persistência de sessão ────────────────────────────────────────────────────

async function setConv(phone, state) {
  conversations.set(phone, state);
  try {
    if (!state || state.step === 'new') {
      await supabase.from('bot_sessions').delete().eq('phone', phone);
    } else {
      const { step, ...rest } = state;
      await supabase.from('bot_sessions').upsert(
        { phone, step, state_json: rest, updated_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
    }
  } catch (e) {
    console.warn('[WA session] falha ao persistir sessão:', e.message);
  }
}

async function restoreState() {
  try {
    // Restaura pendingApprovals a partir dos drafts no banco
    const { data: drafts } = await supabase
      .from('anuncios')
      .select('id, titulo, preco, cidade, whatsapp')
      .eq('status', 'draft');

    if (drafts) {
      for (const d of drafts) {
        pendingApprovals.set(d.id, {
          sellerPhone: `+${d.whatsapp}`,
          titulo: d.titulo,
          preco:  d.preco,
          cidade: d.cidade,
        });
      }
    }

    // Restaura conversations a partir do bot_sessions
    const { data: sessions } = await supabase
      .from('bot_sessions')
      .select('phone, step, state_json');

    if (sessions) {
      for (const s of sessions) {
        conversations.set(s.phone, { step: s.step, ...(s.state_json || {}) });
      }
    }

    console.log(`[WA session] restaurado — ${pendingApprovals.size} drafts, ${conversations.size} sessões`);
  } catch (e) {
    console.warn('[WA session] falha ao restaurar estado:', e.message);
  }
}

// Restaura estado logo após o módulo ser carregado
setImmediate(restoreState);

// ── token de aprovação por email ──────────────────────────────────────────────
function approveToken(listingId) {
  return crypto
    .createHmac('sha256', process.env.ADMIN_PASSWORD || 'takko')
    .update(String(listingId))
    .digest('hex')
    .slice(0, 24);
}

function approveUrl(listingId) {
  const base = process.env.API_URL || 'https://takko-api.onrender.com';
  return `${base}/webhook/whatsapp/approve/${listingId}?token=${approveToken(listingId)}`;
}

// ── mensagens seller ──────────────────────────────────────────────────────────

const MSG_INTRO = `Olá! 👋 Aqui é a *Takko Fishing* 🎣

Posso anunciar seu equipamento de pesca de graça, sem cadastro!

É simples: me manda as fotos e eu cuido do resto.

📸 Comece mandando as *fotos* do produto!`;

const MSG_WAITING_PRODUCT = `Recebi as fotos! 📸

Qual é o produto?
(marca e modelo, ex: *Molinete Shimano Stradic 4000*)

💡 Mandou errado? Digite *cancelar* para recomeçar.`;

const MSG_PHOTO_ADDED = (n, step) => {
  const hint = step === 'waiting_price' ? 'qual é o preço? 💰'
             : step === 'waiting_city'  ? 'em qual cidade você está? 📍'
             : 'qual é o produto?';
  return `📸 Foto adicionada! (${n} no total)\nContinue — ${hint}`;
};

const MSG_WAITING_PRICE =
  `Qual o preço? 💰\n\n` +
  `Digite *só o valor* em reais, sem R$ e sem texto:\n` +
  `• Número inteiro → *200*\n` +
  `• Com centavos → *199,90*\n\n` +
  `(Vírgula ou ponto, os dois funcionam)`;

const MSG_PRICE_INVALID =
  `Não entendi o valor. ` +
  `Digite *só o número*, ex: *200* ou *199,90*`;

const MSG_PRICE_CONFIRM = (preco) =>
  `Confirmando: o preço é *R$ ${Number(preco).toLocaleString('pt-BR')}*?\n\n` +
  `Responda *sim* para confirmar ou mande o valor correto.`;

const MSG_WAITING_CITY =
  `Em qual cidade você está? 📍\n` +
  `(ex: *São Paulo - SP*)`;

const MSG_CITY_INVALID =
  `Não entendi a cidade. Mande só o nome, ex: *São Paulo - SP*`;

const MSG_RECEIVED =
  `✅ Recebi tudo! Estou preparando seu anúncio — em breve estará no ar 🎣`;

const MSG_PUBLISHED = (titulo, preco, cidade, url) =>
  `🎉 *Seu anúncio está no ar!*\n\n` +
  `🎣 *${titulo}*\n` +
  `💰 R$ ${Number(preco).toLocaleString('pt-BR')}\n` +
  `📍 ${cidade || '—'}\n\n` +
  `Quando alguém se interessar, a pessoa fala direto com você pelo WhatsApp.\n\n` +
  `🔗 ${url}\n\n` +
  `Aproveite e nos siga no Instagram para acompanhar novidades: @takkofishing 🎣`;

const MSG_ERROR =
  `❌ Tive um problema ao criar seu anúncio. Pode tentar de novo?\n` +
  `É só mandar as fotos outra vez.`;

// ── webhook ───────────────────────────────────────────────────────────────────
router.use(express.urlencoded({ extended: false }));

router.get('/', (_req, res) => res.send('WhatsApp webhook ativo ✅'));

// ── aprovação via link do email ───────────────────────────────────────────────
router.get('/approve/:id', async (req, res) => {
  const listingId = parseInt(req.params.id, 10);
  const token     = req.query.token || '';

  if (token !== approveToken(listingId)) {
    return res.status(401).send('Link inválido ou expirado.');
  }

  // Busca dados do draft no banco (funciona mesmo após restart)
  let approval = pendingApprovals.get(listingId);
  if (!approval) {
    const { data } = await supabase
      .from('anuncios')
      .select('id, titulo, preco, cidade, whatsapp')
      .eq('id', listingId)
      .eq('status', 'draft')
      .single();

    if (!data) {
      return res.send(`<p>Anúncio #${listingId} não encontrado ou já publicado.</p>`);
    }
    approval = { sellerPhone: `+${data.whatsapp}`, titulo: data.titulo, preco: data.preco, cidade: data.cidade };
  }

  await publishListing(listingId, approval, {}, null);

  res.send(`
    <html><body style="font-family:sans-serif;max-width:400px;margin:60px auto;text-align:center">
      <h2 style="color:#0066cc">✅ Anúncio #${listingId} publicado!</h2>
      <p>${approval.titulo}</p>
      <a href="https://takko-catch-clean.lovable.app/anuncio/${listingId}" style="color:#0066cc">Ver anúncio →</a>
    </body></html>
  `);
});

router.post('/', async (req, res) => {
  res.set('Content-Type', 'text/xml').send('<Response></Response>');

  try {
    const from = (req.body.From || '').replace('whatsapp:', '').trim();
    const text = (req.body.Body || '').trim();
    const numMedia = parseInt(req.body.NumMedia || '0', 10);

    const imageUrls = [];
    for (let i = 0; i < numMedia; i++) {
      const url  = req.body[`MediaUrl${i}`];
      const mime = req.body[`MediaContentType${i}`] || '';
      if (url && mime.startsWith('image/')) imageUrls.push(url);
    }

    if (!from) return;

    const fromDigits = from.replace(/\D/g, '');
    if (OPERATOR_NUMBER && isSamePhone(fromDigits, OPERATOR_NUMBER)) {
      await handleOperatorMessage(from, text);
      return;
    }

    await dispatch(from, text, imageUrls);
  } catch (err) {
    console.error('[WA webhook]', err.message);
  }
});

// ── fluxo do operador ─────────────────────────────────────────────────────────
// Formatos: "{id} ok" | "{id} titulo: X" | "{id} preço: X" | "{id} cidade: X"
async function handleOperatorMessage(operatorFrom, text) {
  const idMatch = text.trim().match(/^(\d+)\s+(.+)$/i);
  if (!idMatch) {
    await sendWhatsAppMessage(
      operatorFrom,
      `Formato aceito:\n` +
      `*{id} ok*\n` +
      `*{id} titulo: Novo Título*\n` +
      `*{id} preço: 500*\n` +
      `*{id} cidade: São Paulo*\n\n` +
      `Rascunhos pendentes: ${pendingApprovals.size}`
    );
    return;
  }

  const listingId = parseInt(idMatch[1], 10);
  const command   = idMatch[2].trim();
  const approval  = pendingApprovals.get(listingId);

  if (!approval) {
    await sendWhatsAppMessage(operatorFrom, `Rascunho #${listingId} não encontrado (pode já ter sido publicado).`);
    return;
  }

  const updates = {};
  const tituloMatch = command.match(/t[íi]tulo\s*:\s*(.+)/i);
  const precoMatch  = command.match(/pre[çc]o\s*:\s*([\d.,]+)/i);
  const cidadeMatch = command.match(/cidade\s*:\s*(.+)/i);

  if (tituloMatch) updates.titulo = tituloMatch[1].trim();
  if (precoMatch)  updates.preco  = Math.round(parseFloat(precoMatch[1].replace(/\./g, '').replace(',', '.')));
  if (cidadeMatch) updates.cidade = cidadeMatch[1].trim();

  const isOk = command.toLowerCase() === 'ok' || !!tituloMatch || !!precoMatch || !!cidadeMatch;
  if (!isOk) {
    await sendWhatsAppMessage(
      operatorFrom,
      `Comando não reconhecido. Use:\n` +
      `*${listingId} ok*\n` +
      `*${listingId} titulo: Novo Título*\n` +
      `*${listingId} preço: 500*\n` +
      `*${listingId} cidade: São Paulo*`
    );
    return;
  }

  await publishListing(listingId, approval, updates, operatorFrom);
}

// ── cancelamento pelo seller ──────────────────────────────────────────────────
async function handleCancelCommand(from, state) {
  const whatsapp = from.replace(/\D/g, '');
  const inProgress = ['waiting_product', 'waiting_price', 'waiting_city', 'generating', 'confirming_price'].includes(state.step);

  if (inProgress) {
    await setConv(from, { step: 'new' });
    await sendWhatsAppMessage(from, `Ok, descartei tudo. Quando quiser recomeçar, é só mandar as fotos! 📸`);
    return;
  }

  if (state.step === 'awaiting_approval' && state.listingId) {
    const { data, error } = await supabase
      .from('anuncios')
      .delete()
      .eq('id', state.listingId)
      .eq('whatsapp', whatsapp)
      .eq('status', 'draft')
      .select('id, titulo')
      .single();

    if (!error && data) {
      pendingApprovals.delete(state.listingId);
      await setConv(from, { step: 'new' });
      await sendWhatsAppMessage(from, `✅ Anúncio cancelado.\n\nQuer anunciar outro produto? É só mandar as fotos! 📸`);
      return;
    }
  }

  await setConv(from, { step: 'new' });
  await sendWhatsAppMessage(from, `Ok! Quando quiser anunciar, é só mandar as fotos. 📸`);
}

// ── máquina de estado ─────────────────────────────────────────────────────────
async function dispatch(from, text, imageUrls) {
  const state = conversations.get(from) || { step: 'new' };

  // Cancelar/reset — funciona em qualquer estado
  if (text) {
    const isCancel = /^cancelar(\s+\d+)?$/i.test(text.trim());
    const isReset  = /^(recomeçar|recomecar|errei|esquece)$/i.test(text.trim());
    if (isCancel || isReset) {
      await handleCancelCommand(from, state);
      return;
    }
  }

  // ALERTA — buyer quer ser notificado quando aparecer um produto
  if (text && /^alerta\b/i.test(text.trim())) {
    await handlePriceAlert(from, text.trim());
    return;
  }

  // ── waiting_product: tem fotos, aguarda nome do produto ──
  if (state.step === 'waiting_product') {
    if (imageUrls.length > 0) {
      const accumulated = [...(state.imageUrls || []), ...imageUrls];
      await setConv(from, { ...state, imageUrls: accumulated });
      await sendWhatsAppMessage(from, MSG_PHOTO_ADDED(accumulated.length, 'waiting_product'));
      return;
    }
    if (text) {
      await setConv(from, { step: 'waiting_price', imageUrls: state.imageUrls || [], produto: text });
      await sendWhatsAppMessage(from, MSG_WAITING_PRICE);
      return;
    }
    await sendWhatsAppMessage(from, MSG_WAITING_PRODUCT);
    return;
  }

  // ── waiting_price: tem fotos + produto, aguarda preço ──
  if (state.step === 'waiting_price') {
    if (imageUrls.length > 0) {
      const accumulated = [...(state.imageUrls || []), ...imageUrls];
      await setConv(from, { ...state, imageUrls: accumulated });
      await sendWhatsAppMessage(from, MSG_PHOTO_ADDED(accumulated.length, 'waiting_price'));
      return;
    }
    if (text) {
      const preco = extractPrice(text);
      if (preco) {
        if (preco > 2500) {
          await setConv(from, { ...state, step: 'confirming_price', preco });
          await sendWhatsAppMessage(from, MSG_PRICE_CONFIRM(preco));
        } else {
          await setConv(from, { step: 'waiting_city', imageUrls: state.imageUrls || [], produto: state.produto, preco });
          await sendWhatsAppMessage(from, MSG_WAITING_CITY);
        }
      } else {
        await sendWhatsAppMessage(from, MSG_PRICE_INVALID);
      }
      return;
    }
    return;
  }

  // ── confirming_price: aguarda confirmação de preço alto ──
  if (state.step === 'confirming_price') {
    if (text) {
      if (/^sim$/i.test(text.trim())) {
        await setConv(from, { step: 'waiting_city', imageUrls: state.imageUrls || [], produto: state.produto, preco: state.preco });
        await sendWhatsAppMessage(from, MSG_WAITING_CITY);
      } else {
        const preco = extractPrice(text);
        if (preco) {
          if (preco > 2500) {
            await setConv(from, { ...state, preco });
            await sendWhatsAppMessage(from, MSG_PRICE_CONFIRM(preco));
          } else {
            await setConv(from, { step: 'waiting_city', imageUrls: state.imageUrls || [], produto: state.produto, preco });
            await sendWhatsAppMessage(from, MSG_WAITING_CITY);
          }
        } else {
          await sendWhatsAppMessage(from, MSG_PRICE_INVALID);
        }
      }
      return;
    }
    return;
  }

  // ── waiting_city: tem fotos + produto + preço, aguarda cidade ──
  if (state.step === 'waiting_city') {
    if (imageUrls.length > 0) {
      const accumulated = [...(state.imageUrls || []), ...imageUrls];
      await setConv(from, { ...state, imageUrls: accumulated });
      await sendWhatsAppMessage(from, MSG_PHOTO_ADDED(accumulated.length, 'waiting_city'));
      return;
    }
    if (text) {
      if (text.trim().split(/\s+/).length > 5) {
        await sendWhatsAppMessage(from, MSG_CITY_INVALID);
        return;
      }
      const { imageUrls: imgs, produto, preco } = state;
      await setConv(from, { step: 'generating' });
      await sendWhatsAppMessage(from, MSG_RECEIVED);
      await processSend(from, { imageUrls: imgs || [], produto, preco, cidade: text });
      return;
    }
    return;
  }

  // ── awaiting_approval: seller respondeu após o draft ser criado ──
  if (state.step === 'awaiting_approval') {
    const listingId = state.listingId;
    const approval  = pendingApprovals.get(listingId);
    const msg       = text || (imageUrls.length > 0 ? `[${imageUrls.length} foto(s)]` : null);
    if (msg) {
      try {
        await sendSellerReply({
          listingId,
          titulo:      approval?.titulo || `#${listingId}`,
          sellerPhone: from,
          message:     msg,
        });
      } catch (e) {
        console.warn('[WA concierge] falha ao encaminhar resposta do seller:', e.message);
      }
      await sendWhatsAppMessage(from,
        `✅ Recebemos sua resposta! O operador vai revisar e atualizar seu anúncio em breve.`
      );
      return;
    }
  }

  // ── new / qualquer outro estado: precisa de foto para começar ──
  if (imageUrls.length > 0) {
    await setConv(from, { step: 'waiting_product', imageUrls });
    await sendWhatsAppMessage(from, MSG_WAITING_PRODUCT);
    return;
  }

  // texto sem foto
  await sendWhatsAppMessage(from, MSG_INTRO);
  await setConv(from, { step: 'new' });
}

async function processSend(from, { imageUrls, produto, preco, cidade }) {
  try {
    const listing = await generateListing({
      imageUrls,
      produto,
      preco,
      cidade,
      twilioAuth: {
        user: process.env.TWILIO_ACCOUNT_SID,
        pass: process.env.TWILIO_AUTH_TOKEN,
      },
    });

    await saveAndPublish(from, listing);
  } catch (err) {
    console.error('[WA processSend]', err.message);
    await sendWhatsAppMessage(from, MSG_ERROR);
    await setConv(from, { step: 'new' });
  }
}

async function saveAndPublish(from, listing) {
  const whatsapp = from.replace(/\D/g, '');

  const { data, error } = await supabase
    .from('anuncios')
    .insert({
      titulo:    listing.titulo,
      descricao: listing.descricao || null,
      preco:     listing.preco,
      cidade:    listing.cidade || 'Brasil',
      whatsapp,
      imagens:   listing.imagens || [],
      status:    'aprovado',
      utm_source:   'concierge_whatsapp',
      utm_medium:   'whatsapp',
      utm_campaign: 'concierge',
    })
    .select('id')
    .single();

  if (error) throw error;

  const id  = data.id;
  const url = `${SITE_URL}/anuncio/${id}?utm_source=twilio&utm_medium=whatsapp&utm_campaign=publicacao`;

  await sendWhatsAppMessage(from, MSG_PUBLISHED(listing.titulo, listing.preco, listing.cidade || 'Brasil', url));
  await setConv(from, { step: 'new' });

  // Notifica buyers com alertas que batem com o anúncio
  await notifyPriceAlerts({ id, titulo: listing.titulo, preco: listing.preco, cidade: listing.cidade || 'Brasil' });

  console.log(`[WA concierge] anúncio publicado diretamente id=${id} from=${from}`);
}

async function publishListing(listingId, approval, updates, operatorFrom) {
  const patch = { status: null, ...updates };

  const { error } = await supabase
    .from('anuncios')
    .update(patch)
    .eq('id', listingId);

  if (error) {
    await sendWhatsAppMessage(operatorFrom, `❌ Erro ao publicar #${listingId}: ${error.message}`);
    return;
  }

  const finalTitulo = updates.titulo ?? approval.titulo;
  const finalPreco  = updates.preco  ?? approval.preco;
  const finalCidade = updates.cidade ?? approval.cidade;
  const url = `${SITE_URL}/anuncio/${listingId}?utm_source=twilio&utm_medium=whatsapp&utm_campaign=publicacao`;

  await sendWhatsAppMessage(approval.sellerPhone, MSG_PUBLISHED(finalTitulo, finalPreco, finalCidade, url));
  if (operatorFrom) await sendWhatsAppMessage(operatorFrom, `✅ #${listingId} publicado!\n🔗 ${url}`);

  pendingApprovals.delete(listingId);
  await setConv(approval.sellerPhone, { step: 'new' });

  // Notifica buyers com alertas que batem com o anúncio
  await notifyPriceAlerts({ id: listingId, titulo: finalTitulo, preco: finalPreco, cidade: finalCidade });

  console.log(`[WA concierge] anúncio publicado id=${listingId}`);
}

// Compara dois números BR ignorando o 9º dígito (Twilio às vezes omite)
function isSamePhone(a, b) {
  if (a === b) return true;
  const normalize = n => n.startsWith('55') && n.length === 13
    ? n.slice(0, 4) + n.slice(5)   // remove o 9º dígito após o DDD
    : n;
  return normalize(a) === normalize(b);
}

function extractPrice(text) {
  const m = text.match(/[\d.,]+/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// ── price alerts ─────────────────────────────────────────────────────────────

// Parseia "ALERTA CARRETILHA 500" ou "ALERTA CARRETILHA"
async function handlePriceAlert(from, text) {
  // Remove "ALERTA" e divide o restante
  const parts     = text.replace(/^alerta\s*/i, '').trim().split(/\s+/);
  const lastPart  = parts[parts.length - 1];
  const priceHint = /^\d+$/.test(lastPart) ? parseInt(lastPart, 10) : null;
  const keyword   = priceHint !== null
    ? parts.slice(0, -1).join(' ').toLowerCase()
    : parts.join(' ').toLowerCase();

  if (!keyword) {
    await sendWhatsAppMessage(from,
      `Para criar um alerta, mande: *ALERTA [produto]* ou *ALERTA [produto] [preço máximo]*\n\nExemplos:\n• ALERTA carretilha\n• ALERTA vara 300`
    );
    return;
  }

  const { error } = await supabase.from('price_alerts').insert({
    phone:     from,
    keyword,
    max_price: priceHint,
  });

  if (error) {
    console.error('[WA price_alert] erro ao salvar alerta:', error.message);
    await sendWhatsAppMessage(from, `❌ Não consegui criar o alerta. Tente novamente.`);
    return;
  }

  const priceMsg = priceHint ? ` até R$ ${priceHint.toLocaleString('pt-BR')}` : '';
  await sendWhatsAppMessage(from,
    `✅ Alerta criado! Vou te avisar quando aparecer *${keyword}*${priceMsg} na Takko 🎣`
  );
  console.log(`[WA price_alert] alerta criado phone=${from} keyword="${keyword}" max_price=${priceHint}`);
}

// Notifica buyers com alertas que batem com o anúncio recém-publicado
async function notifyPriceAlerts({ id, titulo, preco, cidade }) {
  try {
    const { data: alerts, error } = await supabase
      .from('price_alerts')
      .select('id, phone, keyword, max_price')
      .eq('active', true)
      .is('notified_at', null);

    if (error || !alerts || alerts.length === 0) return;

    const tituloLower = (titulo || '').toLowerCase();
    const matches     = alerts.filter(a => {
      const keywordMatch = tituloLower.includes(a.keyword.toLowerCase());
      const priceMatch   = a.max_price === null || preco === null || preco <= a.max_price;
      return keywordMatch && priceMatch;
    });

    if (matches.length === 0) return;

    const url = `${SITE_URL}/anuncio/${id}?utm_source=twilio&utm_medium=whatsapp&utm_campaign=price_alert`;
    const msg = (keyword) =>
      `🔔 Apareceu um anúncio que combina com o seu alerta!\n\n` +
      `🎣 *${titulo}*\n` +
      `💰 R$ ${Number(preco).toLocaleString('pt-BR')}\n` +
      `📍 ${cidade || 'Brasil'}\n\n` +
      `🔗 ${url}\n\n` +
      `Fale direto com o dono pelo link.`;

    await Promise.all(matches.map(async (alert) => {
      try {
        await sendWhatsAppMessage(alert.phone, msg(alert.keyword));
        await supabase
          .from('price_alerts')
          .update({ notified_at: new Date().toISOString() })
          .eq('id', alert.id);
        console.log(`[WA price_alert] notificado phone=${alert.phone} keyword="${alert.keyword}" anuncio=${id}`);
      } catch (e) {
        console.error(`[WA price_alert] falha ao notificar phone=${alert.phone}:`, e.message);
      }
    }));
  } catch (e) {
    console.error('[WA price_alert] erro geral em notifyPriceAlerts:', e.message);
  }
}

// endpoint de reset — só ativo em NODE_ENV=test (não chega em produção)
if (process.env.NODE_ENV === 'test') {
  router.post('/_test/reset', (req, res) => {
    const { from } = req.body;
    if (from) { conversations.delete(from); }
    else { conversations.clear(); pendingApprovals.clear(); }
    res.json({ cleared: true, remaining: conversations.size });
  });
}

module.exports = router;
