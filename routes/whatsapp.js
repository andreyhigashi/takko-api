'use strict';

const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { generateListing }      = require('../services/listingGenerator');
const { sendWhatsAppMessage }  = require('../services/whatsappClient');

// In-memory state (MVP). Survive process restarts via Supabase if needed later.
// key: E.164 phone string (e.g. "+5511999999999")
const conversations = new Map();

// key: listingId (number) → { sellerPhone, titulo, preco, cidade }
const pendingApprovals = new Map();

const SITE_URL        = process.env.SITE_URL || 'https://takko-catch-clean.lovable.app';
const OPERATOR_NUMBER = (process.env.OPERATOR_WHATSAPP || '').replace(/\D/g, '');

// ── mensagens seller ─────────────────────────────────────────────────────────
const MSG_INTRO = `Olá! 👋 Aqui é a *Takko Fishing* 🎣

Posso anunciar seu equipamento de pesca de graça, sem cadastro!

É simples:
📸 Me manda as *fotos* do produto
📝 Me conta o *preço* e a *cidade*
✅ Publicamos o anúncio por você

Quando alguém se interessar, a pessoa fala direto com você pelo WhatsApp — sem intermediário e sem taxa.

💡 Mandou errado? Digite *cancelar* a qualquer momento para recomeçar.`;

const MSG_WAITING_INFO = `Recebi as fotos! 📸 Agora me conta:
• Qual é o produto? (marca/modelo se souber)
• Qual o preço?
• Em qual cidade você está?`;

const MSG_WAITING_PHOTOS = `Recebi a descrição! Agora manda as *fotos* do produto para eu criar o anúncio. 📸`;

const MSG_WAITING_PRICE = (titulo) =>
  `Quase lá! 🎣 Identifiquei: *${titulo}*\n\nSó falta o preço — quanto você quer cobrar? (ex: 500 ou R$500)`;

const MSG_RECEIVED = `✅ Recebi tudo! Estou preparando seu anúncio — em breve estará no ar 🎣`;

const MSG_PUBLISHED = (titulo, preco, cidade, url) =>
  `🎉 *Seu anúncio está no ar!*\n\n` +
  `🎣 *${titulo}*\n` +
  `💰 R$ ${Number(preco).toLocaleString('pt-BR')}\n` +
  `📍 ${cidade || '—'}\n\n` +
  `Quando alguém se interessar, a pessoa fala direto com você pelo WhatsApp.\n\n` +
  `🔗 ${url}`;

const MSG_ERROR = `❌ Tive um problema ao criar seu anúncio. Pode tentar de novo?\nManda as fotos e a descrição outra vez.`;

// ── webhook ──────────────────────────────────────────────────────────────────
router.use(express.urlencoded({ extended: false }));

router.get('/', (_req, res) => res.send('WhatsApp webhook ativo ✅'));

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

    // Mensagens do operador têm fluxo separado
    const fromDigits = from.replace(/\D/g, '');
    if (OPERATOR_NUMBER && fromDigits === OPERATOR_NUMBER) {
      await handleOperatorMessage(from, text);
      return;
    }

    await dispatch(from, text, imageUrls);
  } catch (err) {
    console.error('[WA webhook]', err.message);
  }
});

// ── fluxo do operador ────────────────────────────────────────────────────────
// Formatos aceitos (case-insensitive):
//   "{id} ok"           → publica como está
//   "{id} preço: {val}" → corrige preço e publica
//   "{id} cidade: {val}" → corrige cidade e publica
async function handleOperatorMessage(operatorFrom, text) {
  const lower = text.toLowerCase().trim();

  // Extrai o ID no início da mensagem
  const idMatch = lower.match(/^(\d+)\s+(.+)$/);
  if (!idMatch) {
    await sendWhatsAppMessage(operatorFrom, `Formato: *{id} ok* ou *{id} preço: 500*\n\nRascunhos pendentes: ${pendingApprovals.size}`);
    return;
  }

  const listingId  = parseInt(idMatch[1], 10);
  const command    = idMatch[2].trim();
  const approval   = pendingApprovals.get(listingId);

  if (!approval) {
    await sendWhatsAppMessage(operatorFrom, `Rascunho #${listingId} não encontrado (pode já ter sido publicado).`);
    return;
  }

  // Correções antes de publicar
  const updates = {};
  const precoMatch = command.match(/pre[çc]o\s*:\s*([\d.,]+)/i);
  const cidadeMatch = command.match(/cidade\s*:\s*(.+)/i);

  if (precoMatch) updates.preco = Math.round(parseFloat(precoMatch[1].replace(/\./g, '').replace(',', '.')));
  if (cidadeMatch) updates.cidade = cidadeMatch[1].trim();

  const isOk = command === 'ok' || !!precoMatch || !!cidadeMatch;
  if (!isOk) {
    await sendWhatsAppMessage(operatorFrom, `Comando não reconhecido. Use:\n*${listingId} ok*\n*${listingId} preço: 500*\n*${listingId} cidade: São Paulo*`);
    return;
  }

  await publishListing(listingId, approval, updates, operatorFrom);
}

// ── cancelamento pelo seller ─────────────────────────────────────────────────
async function handleCancelCommand(from, state, targetId) {
  const whatsapp = from.replace(/\D/g, '');
  const inProgress = ['has_photos', 'has_text', 'generating', 'waiting_price'].includes(state.step);

  // "cancelar {id}" — cancela draft específico no Supabase
  if (targetId) {
    const { data, error } = await supabase
      .from('anuncios')
      .delete()
      .eq('id', targetId)
      .eq('whatsapp', whatsapp)
      .eq('status', 'draft')
      .select('id')
      .single();

    if (error || !data) {
      await sendWhatsAppMessage(from, `Anúncio #${targetId} não encontrado ou já foi publicado.`);
      return;
    }

    pendingApprovals.delete(targetId);
    conversations.set(from, { step: 'new' });
    await sendWhatsAppMessage(from, `✅ Anúncio #${targetId} cancelado.\n\nQuer anunciar outro produto? É só mandar as fotos! 📸`);
    return;
  }

  // "cancelar" sem ID — reseta fluxo atual se houver algo em andamento
  if (inProgress) {
    conversations.set(from, { step: 'new' });
    await sendWhatsAppMessage(from, `Ok, descartei tudo. Quando quiser recomeçar, é só mandar as fotos! 📸`);
    return;
  }

  // "cancelar" sem ID — lista drafts pendentes no Supabase
  const { data: drafts } = await supabase
    .from('anuncios')
    .select('id, titulo, preco, cidade')
    .eq('whatsapp', whatsapp)
    .eq('status', 'draft')
    .order('id', { ascending: false })
    .limit(5);

  if (!drafts?.length) {
    await sendWhatsAppMessage(from, `Você não tem anúncios aguardando aprovação no momento.`);
    return;
  }

  const lista = drafts.map(d =>
    `• *#${d.id}* — ${d.titulo ?? '?'} | R$ ${d.preco ?? '?'} | ${d.cidade ?? '?'}`
  ).join('\n');

  await sendWhatsAppMessage(from,
    `Seus anúncios aguardando aprovação:\n\n${lista}\n\nPara cancelar um deles: *cancelar {número}*\nEx: cancelar ${drafts[0].id}`
  );
}

// ── máquina de estado (sellers) ──────────────────────────────────────────────
async function dispatch(from, text, imageUrls) {
  const state = conversations.get(from) || { step: 'new' };

  // Comandos de cancelamento (qualquer estado)
  if (text) {
    const cancelMatch = text.match(/^cancelar\s*(\d+)?$/i);
    const reset = /^(recomeçar|recomecar|errei|esquece)$/i.test(text.trim());

    if (cancelMatch || reset) {
      const targetId = cancelMatch?.[1] ? parseInt(cancelMatch[1]) : null;
      await handleCancelCommand(from, state, targetId);
      return;
    }
  }

  if (state.step === 'waiting_price') {
    const preco = extractPrice(text);
    if (preco) {
      await saveDraftAndNotify(from, { ...state.listing, preco, imagens: state.imagens });
    } else {
      await sendWhatsAppMessage(from, `Não entendi o valor. Me manda só o número, ex: *500*`);
    }
    return;
  }

  if (imageUrls.length > 0 && text) {
    const accumulated = [...(state.imageUrls || []), ...imageUrls];
    await processSend(from, text, accumulated);
    return;
  }

  if (imageUrls.length > 0 && !text) {
    const accumulated = [...(state.imageUrls || []), ...imageUrls];
    conversations.set(from, { step: 'has_photos', imageUrls: accumulated });
    if (state.step !== 'has_photos') {
      await sendWhatsAppMessage(from, MSG_WAITING_INFO);
    }
    return;
  }

  if (text && state.step === 'has_photos' && state.imageUrls?.length) {
    await processSend(from, text, state.imageUrls);
    return;
  }

  if (text && !imageUrls.length) {
    conversations.set(from, { step: 'has_text', text });
    await sendWhatsAppMessage(from, MSG_WAITING_PHOTOS);
    return;
  }

  await sendWhatsAppMessage(from, MSG_INTRO);
  conversations.set(from, { step: 'intro_sent' });
}

async function processSend(from, text, imageUrls) {
  conversations.set(from, { step: 'generating' });
  await sendWhatsAppMessage(from, MSG_RECEIVED); // confirmação imediata ao seller

  try {
    const listing = await generateListing({
      text,
      imageUrls,
      twilioAuth: {
        user: process.env.TWILIO_ACCOUNT_SID,
        pass: process.env.TWILIO_AUTH_TOKEN,
      },
    });

    if (!listing.preco) {
      conversations.set(from, { step: 'waiting_price', listing, imagens: listing.imagens });
      await sendWhatsAppMessage(from, MSG_WAITING_PRICE(listing.titulo));
      return;
    }

    await saveDraftAndNotify(from, listing);
  } catch (err) {
    console.error('[WA processSend]', err.message);
    await sendWhatsAppMessage(from, MSG_ERROR);
    conversations.set(from, { step: 'error' });
  }
}

async function saveDraftAndNotify(from, listing) {
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
      status:    'draft',
      utm_source:   'concierge_whatsapp',
      utm_medium:   'whatsapp',
      utm_campaign: 'concierge',
    })
    .select('id')
    .single();

  if (error) throw error;

  const id       = data.id;
  const precoFmt = `R$ ${Number(listing.preco).toLocaleString('pt-BR')}`;

  pendingApprovals.set(id, {
    sellerPhone: from,
    titulo:  listing.titulo,
    preco:   listing.preco,
    cidade:  listing.cidade || 'Brasil',
  });

  conversations.set(from, { step: 'awaiting_approval', listingId: id });

  // Notifica operador
  if (OPERATOR_NUMBER) {
    await sendWhatsAppMessage(
      `+${OPERATOR_NUMBER}`,
      `🔔 *Novo anúncio para revisar* (#${id})\n\n` +
      `🎣 *${listing.titulo}*\n` +
      `💰 ${precoFmt}\n` +
      `📍 ${listing.cidade || '—'}\n` +
      `📱 Seller: ${from}\n\n` +
      `Para publicar: *${id} ok*\n` +
      `Para corrigir: *${id} preço: 700* ou *${id} cidade: São Paulo*`
    );
  }

  console.log(`[WA concierge] rascunho criado id=${id} from=${from}`);
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

  const finalPreco  = updates.preco  ?? approval.preco;
  const finalCidade = updates.cidade ?? approval.cidade;
  const url = `${SITE_URL}/anuncio/${listingId}`;

  // Notifica seller
  await sendWhatsAppMessage(
    approval.sellerPhone,
    MSG_PUBLISHED(approval.titulo, finalPreco, finalCidade, url)
  );

  // Confirma ao operador
  await sendWhatsAppMessage(operatorFrom, `✅ #${listingId} publicado!\n🔗 ${url}`);

  pendingApprovals.delete(listingId);
  console.log(`[WA concierge] anúncio publicado id=${listingId}`);
}

function extractPrice(text) {
  const m = text.match(/[\d.,]+/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

module.exports = router;
