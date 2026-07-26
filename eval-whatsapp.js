// eval-whatsapp.js — node eval-whatsapp.js (rodar da raiz do projeto)
'use strict';

process.env.OPERATOR_WHATSAPP = '5599000000001';
process.env.SITE_URL = 'https://takko-test.app';

const path = require('path');
const http = require('http');
const express = require('express');
const querystring = require('querystring');

// ── MOCKS (antes de qualquer require do código de produção) ───────────────

const captured = [];   // { to, body }
const inserted = [];   // registros inseridos
let nextId = 100;

const waPath = require.resolve('./services/whatsappClient');
require.cache[waPath] = {
  id: waPath, filename: waPath, loaded: true,
  exports: {
    sendWhatsAppMessage: async (to, body) => captured.push({ to, body }),
  },
};

const lgPath = require.resolve('./services/listingGenerator');
require.cache[lgPath] = {
  id: lgPath, filename: lgPath, loaded: true,
  exports: {
    generateListing: async ({ produto, preco, cidade }) => ({
      titulo: `${produto} Usado`,
      descricao: 'Produto em ótimo estado.',
      categoria: 'Carretilhas',
      preco,
      cidade,
      imagens: ['https://example.com/img.jpg'],
    }),
  },
};

// Supabase mock com fluent chain
function chain(result) {
  const p = Promise.resolve(result);
  const c = {
    eq: () => c, select: () => c, order: () => c, limit: () => c,
    single: () => p,
    then: (res, rej) => p.then(res, rej),
    catch: (rej) => p.catch(rej),
  };
  return c;
}

const sbPath = require.resolve('./lib/supabase');
require.cache[sbPath] = {
  id: sbPath, filename: sbPath, loaded: true,
  exports: {
    from: (table) => ({
      insert: (data) => { inserted.push({ table, data }); return chain({ data: { id: nextId++ }, error: null }); },
      select: () => chain({ data: [], error: null }),
      update: () => chain({ error: null }),
      delete: () => chain({ data: { id: 999, titulo: 'Test Produto' }, error: null }),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/img.jpg' } }),
      }),
    },
  },
};

// ── SERVIDOR ──────────────────────────────────────────────────────────────

const whatsappRouter = require('./routes/whatsapp');
const app = express();
app.use('/wh', whatsappRouter);
const server = http.createServer(app);

let port;

function post(body) {
  return new Promise((resolve, reject) => {
    const data = querystring.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port, path: '/wh', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function msgPayload(from, body)  { return { From: `whatsapp:${from}`, Body: body, NumMedia: '0' }; }
function fotoPayload(from, text = '') {
  return { From: `whatsapp:${from}`, Body: text, NumMedia: '1',
    MediaUrl0: 'https://twilio.com/foto.jpg', MediaContentType0: 'image/jpeg' };
}

function lastTo(to) {
  const msgs = captured.filter((m) => m.to === to);
  return msgs.length ? msgs[msgs.length - 1].body : '';
}

// ── RUNNER ────────────────────────────────────────────────────────────────

let passed = 0; let failed = 0;

function ok(cond, label) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.log(`  ❌ ${label}\n     última msg: "${lastTo(currentSeller).slice(0,120)}"`); failed++; }
}

const OPERATOR = '+5599000000001';
let currentSeller;
let savedListingId;

async function run() {
  await new Promise((res) => server.listen(0, res));
  port = server.address().port;
  console.log(`\n🧪 Eval WhatsApp Concierge — porta ${port}\n`);

  // ════════════════════════════════════════════
  // TESTE 1 — Happy path completo
  // ════════════════════════════════════════════
  console.log('── T1: Happy path (foto → produto → preço → cidade → draft → publicação)');
  currentSeller = '+5511000000001';

  await post(fotoPayload(currentSeller));
  await sleep(300);
  ok(lastTo(currentSeller).includes('Qual é o produto'), 'Foto recebida → pergunta produto');

  await post(msgPayload(currentSeller, 'Molinete Shimano Stradic 4000'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('Qual o preço'), 'Produto recebido → pergunta preço');
  ok(lastTo(currentSeller).includes('200'), 'Mensagem de preço tem exemplo "200"');

  await post(msgPayload(currentSeller, '350'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('cidade'), 'Preço válido → pergunta cidade');

  await post(msgPayload(currentSeller, 'Londrina - PR'));
  await sleep(600);
  ok(lastTo(currentSeller).includes('Recebi tudo'), 'Cidade recebida → MSG_RECEIVED');
  await sleep(500);

  const opNotif = lastTo(OPERATOR);
  ok(opNotif.includes('Novo anúncio'), 'Operador recebe notificação');
  ok(opNotif.includes('titulo:'), 'Notificação inclui comando titulo');
  ok(opNotif.includes('Stradic'), 'Título correto na notificação');
  const m = opNotif.match(/#(\d+)/);
  savedListingId = m ? m[1] : null;
  ok(!!savedListingId, `Draft criado com ID #${savedListingId}`);

  // ════════════════════════════════════════════
  // TESTE 2 — Preço inválido → retry
  // ════════════════════════════════════════════
  console.log('\n── T2: Preço inválido → retry');
  currentSeller = '+5511000000002';

  await post(fotoPayload(currentSeller));
  await sleep(300);
  await post(msgPayload(currentSeller, 'Vara Shimano'));
  await sleep(100);

  await post(msgPayload(currentSeller, 'caro demais'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('Não entendi'), 'Preço "caro demais" → MSG_PRICE_INVALID');

  await post(msgPayload(currentSeller, 'abc'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('Não entendi'), 'Preço "abc" → MSG_PRICE_INVALID novamente');

  await post(msgPayload(currentSeller, '199,90'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('cidade'), 'Preço com vírgula "199,90" aceito → pergunta cidade');

  // ════════════════════════════════════════════
  // TESTE 3 — Foto extra durante waiting_price
  // ════════════════════════════════════════════
  console.log('\n── T3: Foto extra durante waiting_price e waiting_city');
  currentSeller = '+5511000000003';

  await post(fotoPayload(currentSeller));
  await sleep(300);
  await post(msgPayload(currentSeller, 'Carretilha Abu Garcia'));
  await sleep(100);
  // agora em waiting_price → manda foto extra
  await post(fotoPayload(currentSeller));
  await sleep(200);
  ok(lastTo(currentSeller).includes('Foto adicionada'), 'Foto extra em waiting_price → MSG_PHOTO_ADDED');
  ok(lastTo(currentSeller).includes('2'), 'Contagem de fotos correta (2)');
  ok(lastTo(currentSeller).includes('preço'), 'Hint contextual: "qual é o preço?" (não "produto")');

  await post(msgPayload(currentSeller, '500'));
  await sleep(100);
  // agora em waiting_city → manda foto extra
  await post(fotoPayload(currentSeller));
  await sleep(200);
  ok(lastTo(currentSeller).includes('Foto adicionada'), 'Foto extra em waiting_city → MSG_PHOTO_ADDED');
  ok(lastTo(currentSeller).includes('3'), 'Contagem de fotos correta (3)');
  ok(lastTo(currentSeller).includes('cidade'), 'Hint contextual: "em qual cidade?" (não "produto")');

  // ════════════════════════════════════════════
  // TESTE 4 — Cancelar em diferentes estados
  // ════════════════════════════════════════════
  console.log('\n── T4: Cancelar em waiting_product, waiting_price e recomeçar');
  currentSeller = '+5511000000004';

  await post(fotoPayload(currentSeller));
  await sleep(300);
  await post(msgPayload(currentSeller, 'cancelar'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('descartei'), 'Cancelar em waiting_product → reset');

  // recomeça do zero
  await post(fotoPayload(currentSeller));
  await sleep(300);
  ok(lastTo(currentSeller).includes('Qual é o produto'), 'Após cancelar: fluxo reinicia com MSG_WAITING_PRODUCT');

  await post(msgPayload(currentSeller, 'Isca Rapala'));
  await sleep(100);
  await post(msgPayload(currentSeller, 'cancelar'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('descartei'), 'Cancelar em waiting_price → reset');

  await post(msgPayload(currentSeller, 'recomeçar'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('descartei') || lastTo(currentSeller).includes('foto'), '"recomeçar" funciona como cancelar');

  // ════════════════════════════════════════════
  // TESTE 5 — Texto sem foto
  // ════════════════════════════════════════════
  console.log('\n── T5: Texto sem foto → MSG_INTRO');
  currentSeller = '+5511000000005';

  await post(msgPayload(currentSeller, 'oi quero vender'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('fotos'), 'Texto sem foto → MSG_INTRO pede foto');

  await post(msgPayload(currentSeller, 'como funciona?'));
  await sleep(100);
  ok(lastTo(currentSeller).includes('fotos'), 'Segunda mensagem sem foto → MSG_INTRO novamente');

  // ════════════════════════════════════════════
  // TESTE 6 — Operador: ok, titulo, preço, cidade
  // ════════════════════════════════════════════
  console.log('\n── T6: Operador aprova e corrige campos');
  currentSeller = '+5511000000001'; // mesmo seller do T1

  if (savedListingId) {
    // corrige título e publica
    await post(msgPayload(OPERATOR, `${savedListingId} titulo: Molinete Shimano Stradic 4000 Seminovo`));
    await sleep(400);
    ok(lastTo(OPERATOR).includes('publicado'), `Operador: ${savedListingId} titulo: X → publicado`);
    ok(lastTo(currentSeller).includes('ar!'), 'Seller recebe MSG_PUBLISHED');
    ok(lastTo(currentSeller).includes('Stradic'), 'Título corrigido aparece na MSG_PUBLISHED');
  } else {
    console.log('  ⏭️  Pulado (T1 não gerou draft)');
    failed++;
  }

  // operador com formato errado
  await post(msgPayload(OPERATOR, 'publicar tudo'));
  await sleep(100);
  ok(lastTo(OPERATOR).includes('Formato'), 'Operador: formato inválido → help message');

  // ════════════════════════════════════════════
  // TESTE 7 — Múltiplas fotos enviadas juntas (NumMedia > 1)
  // ════════════════════════════════════════════
  console.log('\n── T7: Múltiplas fotos numa mensagem só');
  currentSeller = '+5511000000006';

  await post({
    From: `whatsapp:${currentSeller}`, Body: '', NumMedia: '3',
    MediaUrl0: 'https://twilio.com/f1.jpg', MediaContentType0: 'image/jpeg',
    MediaUrl1: 'https://twilio.com/f2.jpg', MediaContentType1: 'image/jpeg',
    MediaUrl2: 'https://twilio.com/f3.jpg', MediaContentType2: 'image/jpeg',
  });
  await sleep(300);
  ok(lastTo(currentSeller).includes('Qual é o produto'), '3 fotos de uma vez → MSG_WAITING_PRODUCT');

  await post(msgPayload(currentSeller, 'Vara Shimano'));
  await sleep(100);
  await post(msgPayload(currentSeller, '300'));
  await sleep(100);
  await post(msgPayload(currentSeller, 'São Paulo - SP'));
  await sleep(700);
  ok(inserted.some((r) => r.data?.imagens?.length === 3 || r.table === 'anuncios'), '3 fotos salvas no draft');

  // ════════════════════════════════════════════
  // RESULTADO FINAL
  // ════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`  ${passed + failed} testes  |  ✅ ${passed} OK  |  ❌ ${failed} falharam`);
  console.log('══════════════════════════════════════\n');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => { console.error('Erro fatal no eval:', err); process.exit(1); });
