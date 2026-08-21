'use strict';
const { chromium } = require('../messenger-bot/node_modules/playwright');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

const SUPABASE_URL = 'https://azvdbthnwbhtfwffmnni.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dmRidGhud2JodGZ3ZmZtbm5pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg5NjQ4OSwiZXhwIjoyMDkyNDcyNDg5fQ.ic2aWAPubW9oOrTvS8Fd98pB_dmAfFcIRN9Qq1eTrLs';
const BASE   = path.join(__dirname, '..', 'Dados para upload');

const ITENS = [
  { url: 'https://sp.olx.com.br/regiao-de-ribeirao-preto/esportes-e-lazer/esportes-aquaticos/lote-carretilhas-e-molinetes-shimano-abu-garcia-daiwa-1516489932', whatsapp: '16999872007' },
  { url: 'https://sp.olx.com.br/regiao-de-ribeirao-preto/esportes-e-lazer/esportes-aquaticos/molinete-shimano-sidestab-1000-1526313695', whatsapp: '16999872007' },
  { url: 'https://sp.olx.com.br/regiao-de-ribeirao-preto/esportes-e-lazer/esportes-aquaticos/carretilha-perfil-alto-sueca-abu-garcia-ambassedeur-series-c5501-c3-1501293651', whatsapp: '16999872007' },
  { url: 'https://sp.olx.com.br/regiao-de-ribeirao-preto/esportes-e-lazer/esportes-aquaticos/carretilha-sueca-abu-garcia-ambassedeur-revo-beast-x-1492850467', whatsapp: '16999872007' },
];

async function uploadFoto(buf, idx) {
  const slug = Date.now() + '-olx' + idx + '.jpg';
  const res  = await fetch(`${SUPABASE_URL}/storage/v1/object/imagens/${slug}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'image/jpeg' },
    body: buf,
  });
  if (!res.ok) throw new Error('Upload falhou: ' + await res.text());
  return `${SUPABASE_URL}/storage/v1/object/public/imagens/${slug}`;
}

async function criarAnuncio(d) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/anuncios`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ titulo: d.titulo, preco: d.preco, cidade: d.cidade, whatsapp: d.whatsapp, descricao: d.descricao, imagens: d.imagens, status: 'aprovado', source: 'olx_outreach', source_url: d.source_url || null }),
  });
  if (!res.ok) throw new Error('Insert falhou: ' + await res.text());
  const rows = await res.json();
  return rows[0]?.id;
}

function findAdData(obj, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return null;
  if (obj.title && obj.description && obj.price !== undefined) return obj;
  for (const val of Object.values(obj)) {
    const found = findAdData(val, depth + 1);
    if (found) return found;
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  for (const item of ITENS) {
    console.log('\n━━━ ' + item.url.split('/').slice(-1)[0].slice(0, 60));
    const ctx  = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const ad = await page.evaluate(() => {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
      const ogDesc  = document.querySelector('meta[property="og:description"]')?.content || '';
      const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';

      // Preço — buscar no texto completo da página
      const bodyText = document.body.innerText;
      const precoMatch = bodyText.match(/R\$\s*([\d.,]+)/);
      let preco = 0;
      if (precoMatch) {
        const raw = precoMatch[1].replace(/\./g,'').replace(',','.');
        preco = Math.round(parseFloat(raw)) || 0;
      }

      // Cidade — padrão no title da página ou body
      const pageTitle = document.title || '';
      const cidadeMatch = pageTitle.match(/,\s*([^,|]+?)\s*\d{10,}\s*\|/) ||
                          bodyText.match(/(?:São Paulo|Campinas|[A-Z][a-záéíóúàêõç]+(?:\s+[A-Z][a-záéíóúàêõç]+)*)\s*-\s*SP/);
      const cidade = cidadeMatch ? cidadeMatch[1].trim() :
                     (pageTitle.includes('São Paulo') ? 'São Paulo' : '');

      // Imagens — img src do domínio olx
      const imgs = [...document.querySelectorAll('img[src*="olx.com.br"]')]
        .map(i => i.src)
        .filter(s => s.length > 50 && !s.includes('logo') && !s.includes('icon'))
        .filter((v,i,a) => a.indexOf(v) === i)
        .slice(0, 8);

      if (ogImage && !imgs.includes(ogImage)) imgs.unshift(ogImage);

      return { titulo: ogTitle, descricao: ogDesc, preco, cidade, imgs };
    });
    await ctx.close();

    const titulo    = ad.titulo;
    const descricao = ad.descricao;
    const preco     = ad.preco;
    const cidade    = ad.cidade;
    const imgs      = ad.imgs;

    console.log('  Título:  ' + titulo);
    console.log('  Preço:   R$ ' + preco);
    console.log('  Cidade:  ' + cidade);
    console.log('  Imagens: ' + imgs.length);
    if (!titulo) { console.log('  ❌ Título não encontrado'); continue; }

    // Pasta Dados para upload
    const safe      = titulo.replace(/[/\\:*?"<>|]/g, ' ').trim().slice(0, 50);
    const nomePasta = item.whatsapp + '_' + safe;
    const pastaPath = path.join(BASE, nomePasta);
    fs.mkdirSync(pastaPath, { recursive: true });
    fs.writeFileSync(path.join(pastaPath, 'Dados.txt'),
      ['Título: ' + titulo, 'Preço: ' + preco, 'Cidade: ' + cidade, 'WhatsApp: ' + item.whatsapp, 'Descrição: ' + descricao].join('\n'),
      'utf8');

    // Download + upload + salvar local
    const urlsSupa = [];
    for (let i = 0; i < Math.min(imgs.length, 6); i++) {
      try {
        const r = await axios.get(imgs[i], { responseType: 'arraybuffer', timeout: 15000 });
        const buf = Buffer.from(r.data);
        // Salvar localmente
        fs.writeFileSync(path.join(pastaPath, (i + 1) + '.jpg'), buf);
        // Upload para Supabase
        const url = await uploadFoto(buf, i);
        urlsSupa.push(url);
        process.stdout.write('  📸 foto ' + (i + 1) + ' ✅\n');
      } catch (e) {
        process.stdout.write('  📸 foto ' + (i + 1) + ' ❌ ' + e.message.slice(0, 60) + '\n');
      }
    }

    // Criar anúncio
    const id = await criarAnuncio({ titulo, preco, cidade, whatsapp: item.whatsapp, descricao, imagens: urlsSupa, source_url: item.url });
    console.log(`  ✅ Anúncio #${id} criado — ${urlsSupa.length} foto(s)`);
    console.log(`  📁 Pasta: ${nomePasta}`);
  }

  await browser.close();
  console.log('\n🎣 Concluído!');
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
