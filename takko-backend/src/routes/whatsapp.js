const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { sendMessage } = require('../services/whatsappClient');
const { generateListing } = require('../services/listingGenerator');
const { trackEvent } = require('../services/trackEvent');

// In-memory sessions: phone → { state, photos, text, confirmedListing, draftId }
// States: idle → collecting → awaiting_price → confirming → draft_sent
const sessions = new Map();

const OPERATOR = (process.env.OPERATOR_WHATSAPP || '').replace(/\D/g, '');

const CANCEL_KEYWORDS = ['cancelar', 'recomeçar', 'errei', 'esquece', 'reiniciar'];

const SOURCE_MAP = {
  OLX: 'olx_outreach',
  FBM: 'fbm_outreach',
  FACEBOOK: 'fbm_outreach',
  IG: 'instagram_outreach',
  INSTAGRAM: 'instagram_outreach',
  GRUPO: 'wa_group',
  WA: 'wa_group',
};

function detectSource(body) {
  const keyword = (body || '').trim().toUpperCase().split(/\s/)[0];
  return SOURCE_MAP[keyword] || null;
}

const MSG_INTRO = `👋 Olá! Sou da *Takko Fishing* 🎣

Para anunciar seu equipamento *de graça*:
📸 Manda as fotos
💬 Me diz o preço e uma breve descrição

Eu crio o anúncio pra você em segundos. Sem cadastro, sem comissão.

_(Digite *cancelar* a qualquer momento para recomeçar)_`;

// POST /webhook/whatsapp
router.post('/', async (req, res) => {
  res.sendStatus(200); // respond fast so Twilio doesn't retry

  const from = (req.body.From || '').replace('whatsapp:', '');
  const phone = from.replace(/\D/g, '');
  const body = (req.body.Body || '').trim();

  const numMedia = parseInt(req.body.NumMedia || '0', 10);
  const photos = [];
  for (let i = 0; i < numMedia; i++) {
    const url = req.body[`MediaUrl${i}`];
    if (url) photos.push(url);
  }

  try {
    if (phone === OPERATOR) {
      await handleOperator(body);
      return;
    }
    await handleSeller(phone, body, photos);
  } catch (err) {
    console.error('[webhook/whatsapp]', err.message);
  }
});

async function handleSeller(phone, body, photos) {
  const lower = body.toLowerCase();

  if (CANCEL_KEYWORDS.some(kw => lower.includes(kw))) {
    sessions.delete(phone);
    await sendMessage(phone, '🔄 Ok! Começando do zero:\n\n' + MSG_INTRO);
    return;
  }

  let session = sessions.get(phone);

  // First contact
  if (!session || session.state === 'idle') {
    const source = detectSource(body);
    session = { state: 'collecting', photos: [], text: '', source };
    sessions.set(phone, session);
    await trackEvent('WA_ConversationStarted', phone, { source });
    await sendMessage(phone, MSG_INTRO);
    // If they sent content in the first message, process it too
    if (!photos.length && !body) return;
  }

  if (session.state === 'collecting') {
    let replied = false;

    // Accumulate photos
    if (photos.length > 0) {
      const firstBatch = session.photos.length === 0;
      session.photos.push(...photos);
      sessions.set(phone, session);

      if (firstBatch) {
        await trackEvent('WA_PhotosReceived', phone, { photo_count: session.photos.length });
      }

      await sendMessage(
        phone,
        `📸 ${session.photos.length === 1 ? 'Foto recebida!' : `${session.photos.length} fotos recebidas!`} Pode mandar mais, ou me diz o *preço* e uma breve descrição.`
      );
      replied = true;
    }

    // Accumulate text
    if (body && !photos.length) {
      session.text = session.text ? `${session.text}\n${body}` : body;
      sessions.set(phone, session);
    }

    // Try to generate if we have both photos and text
    if (session.photos.length > 0 && session.text && !replied) {
      await tryGenerate(phone, session);
      return;
    }

    // Nudge if they only sent text but no photos yet
    if (body && !photos.length && session.photos.length === 0 && !replied) {
      await sendMessage(phone, '📸 Primeiro me manda as fotos do equipamento!');
    }
    return;
  }

  if (session.state === 'awaiting_price') {
    const preco = parseFloat(body.replace(/[^\d,\.]/g, '').replace(',', '.'));
    if (isNaN(preco) || preco <= 0) {
      await sendMessage(phone, 'Por favor me informe só o número do preço. Ex: *350* ou *1200*');
      return;
    }
    session.confirmedListing.preco_sugerido = preco;
    session.state = 'confirming';
    sessions.set(phone, session);
    await sendConfirmation(phone, session.confirmedListing);
    return;
  }

  if (session.state === 'confirming') {
    if (lower === 'sim' || lower === 's' || lower === 'ok' || lower.startsWith('sim,')) {
      await publishDraft(phone, session);
    } else if (lower === 'não' || lower === 'nao' || lower === 'n' || lower.startsWith('não')) {
      sessions.delete(phone);
      await sendMessage(phone, '🔄 Tudo bem! Vamos recomeçar:\n\n' + MSG_INTRO);
    } else {
      await sendMessage(phone, 'Responda *sim* para publicar ou *não* para recomeçar.');
    }
    return;
  }

  if (session.state === 'draft_sent') {
    await sendMessage(phone, '✅ Seu anúncio já foi enviado para análise. Em breve você receberá a confirmação!');
  }
}

async function tryGenerate(phone, session) {
  await sendMessage(phone, '⏳ Gerando seu anúncio...');
  try {
    const listing = await generateListing(session.photos, session.text);
    session.confirmedListing = { ...listing, photos: session.photos };

    if (!listing.preco_sugerido) {
      session.state = 'awaiting_price';
      sessions.set(phone, session);
      const preview = buildPreviewText(listing, null);
      await sendMessage(phone, preview + '\n\nQual é o *preço* de venda? (Ex: 350)');
      return;
    }

    session.state = 'confirming';
    sessions.set(phone, session);
    await sendConfirmation(phone, listing);
  } catch (err) {
    console.error('[generateListing]', err.message);
    await sendMessage(phone, '⚠️ Não consegui gerar o anúncio. Pode me dar mais detalhes sobre o produto e o preço?');
  }
}

function buildPreviewText(listing, preco) {
  const precoStr = preco
    ? `R$ ${parseFloat(preco).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : '(a definir)';
  return (
    `✅ *Anúncio gerado!*\n\n` +
    `*${listing.titulo}*\n` +
    `${listing.descricao}\n\n` +
    `💰 *Preço:* ${precoStr}\n` +
    `📦 *Condição:* ${listing.condicao}`
  );
}

async function sendConfirmation(phone, listing) {
  const preview = buildPreviewText(listing, listing.preco_sugerido);
  await sendMessage(phone, preview + '\n\nEstá correto?\n• *sim* — publicar\n• *não* — recomeçar');
}

async function publishDraft(phone, session) {
  const listing = session.confirmedListing;
  const { data, error } = await supabase
    .from('anuncios')
    .insert({
      nome_vendedor: 'Concierge',
      whatsapp: phone,
      titulo: listing.titulo,
      categoria: listing.categoria || 'Outros',
      marca: listing.marca || null,
      modelo: listing.modelo || null,
      condicao: listing.condicao || 'Usado',
      descricao: listing.descricao,
      preco: parseFloat(listing.preco_sugerido),
      cidade: 'São Paulo',
      estado_uf: 'SP',
      fotos: listing.photos,
      status: 'draft',
      source: session.source || null,
    })
    .select()
    .single();

  if (error) {
    console.error('[supabase insert]', error.message);
    await sendMessage(phone, '⚠️ Erro ao salvar o anúncio. Tente novamente em instantes.');
    return;
  }

  await trackEvent('ConciergeListingDraft', phone, {
    listing_id: data.id,
    categoria: listing.categoria,
    preco: listing.preco_sugerido,
  });

  session.state = 'draft_sent';
  session.draftId = data.id;
  sessions.set(phone, session);

  await sendMessage(phone, '🎉 *Recebi tudo!*\n\nSeu anúncio está em análise e será publicado em breve. Você receberá uma confirmação aqui. 🎣');

  if (OPERATOR) {
    const shortId = data.id.slice(0, 8);
    await sendMessage(
      OPERATOR,
      `📋 *Novo anúncio para aprovar*\n\n*${listing.titulo}*\nPreço: R$ ${parseFloat(listing.preco_sugerido).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\nVendedor: +${phone}\nID: ${shortId}\n\n• *aprovar ${shortId}* — publicar\n• *recusar ${shortId}* — rejeitar`
    );
  }
}

async function handleOperator(body) {
  if (!OPERATOR) return;

  const lower = body.toLowerCase().trim();
  const aprovarMatch = lower.match(/^aprovar\s+([a-f0-9\-]{6,})/);
  const recusarMatch = lower.match(/^recusar\s+([a-f0-9\-]{6,})/);

  if (!aprovarMatch && !recusarMatch) return;

  const idPrefix = (aprovarMatch || recusarMatch)[1].replace(/-/g, '');

  const { data: drafts } = await supabase
    .from('anuncios')
    .select('id, whatsapp, titulo')
    .eq('status', 'draft');

  const found = (drafts || []).find(d => d.id.replace(/-/g, '').startsWith(idPrefix));
  if (!found) {
    await sendMessage(OPERATOR, `❌ Draft não encontrado: ${idPrefix}`);
    return;
  }

  if (aprovarMatch) {
    await supabase.from('anuncios').update({ status: 'ativo' }).eq('id', found.id);
    await trackEvent('ConciergeListingPublished', found.whatsapp, {
      listing_id: found.id,
      approved_by: 'operator',
    });
    await sendMessage(OPERATOR, `✅ *${found.titulo}* publicado!`);
    await sendMessage(found.whatsapp, `🎉 *Seu anúncio foi publicado na Takko Fishing!*\n\nBoa sorte nas vendas! 🎣`);
  } else {
    await supabase.from('anuncios').delete().eq('id', found.id);
    await sendMessage(OPERATOR, `🗑️ *${found.titulo}* recusado e removido.`);
    await sendMessage(found.whatsapp, `😔 Não conseguimos publicar seu anúncio desta vez. Entre em contato se precisar de ajuda.`);
  }
}

module.exports = router;
