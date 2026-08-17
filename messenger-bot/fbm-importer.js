'use strict';
/**
 * fbm-importer.js
 * Importa um anúncio do Facebook Marketplace para "Dados para upload".
 *
 * Uso:
 *   node messenger-bot/fbm-importer.js <url-do-anuncio> <whatsapp-do-seller>
 *
 * Exemplo:
 *   node messenger-bot/fbm-importer.js "https://www.facebook.com/marketplace/item/12345/" "5511999999999"
 *
 * O script:
 *   1. Abre o anúncio com sessão autenticada do Facebook (cookies do bot)
 *   2. Extrai título, preço, cidade, descrição e fotos
 *   3. Cria pasta em "Dados para upload" com Dados.txt + fotos baixadas
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const COOKIES_FILE = path.join(__dirname, 'cookies.json');
const DADOS_BASE   = path.resolve(__dirname, '..', 'Dados para upload');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function formatWA(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) {
    const local = digits.slice(2);
    const ddd = local.slice(0, 2);
    const num = local.slice(2);
    const fmt = num.length === 9
      ? `${num.slice(0, 5)}-${num.slice(5)}`
      : `${num.slice(0, 4)}-${num.slice(4)}`;
    return `${ddd} ${fmt}`;
  }
  return digits;
}

const SUPABASE_URL = 'https://azvdbthnwbhtfwffmnni.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dmRidGhud2JodGZ3ZmZtbm5pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg5NjQ4OSwiZXhwIjoyMDkyNDcyNDg5fQ.ic2aWAPubW9oOrTvS8Fd98pB_dmAfFcIRN9Qq1eTrLs';
const BUCKET       = 'imagens';

async function uploadFotoSupabase(filePath, slug) {
  const buf = fs.readFileSync(filePath);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${slug}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'image/jpeg' },
    body: buf,
  });
  if (!res.ok) throw new Error(`Upload Storage falhou (${res.status}): ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${slug}`;
}

async function insertDraftSupabase(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/anuncios`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Insert falhou (${res.status}): ${await res.text()}`);
  const rows = await res.json();
  return rows[0];
}

async function main() {
  const args = process.argv.slice(2);
  const doUpload = args.includes('--upload');
  const posArgs  = args.filter(a => !a.startsWith('--'));
  const [fbmUrl, whatsapp, listingId] = posArgs;

  if (!fbmUrl || !whatsapp) {
    console.error('\n❌ Uso: node messenger-bot/fbm-importer.js <url-marketplace> <whatsapp> [id] [--upload]\n');
    console.error('   Exemplo: node messenger-bot/fbm-importer.js "https://www.facebook.com/marketplace/item/123/" "5511999999999" --upload\n');
    console.error('   --upload  Além da pasta local, faz upload das fotos ao Supabase e insere draft com imagens\n');
    process.exit(1);
  }

  if (!fs.existsSync(COOKIES_FILE)) {
    console.error('❌ Cookies não encontrados. Execute: node messenger-bot/setup.js');
    process.exit(1);
  }

  console.log(`\n📥 Buscando anúncio: ${fbmUrl}`);

  const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx     = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies(cookies);

  const page = await ctx.newPage();

  let titulo = '', preco = '', cidade = '', estado = '', descricao = '';
  let imgUrls = [];

  try {
    // Normaliza URL: /commerce/listing/ID/ → /marketplace/item/ID/
    const idM = fbmUrl.match(/(?:commerce\/listing|marketplace\/item)\/(\d+)/);
    const url = idM
      ? `https://www.facebook.com/marketplace/item/${idM[1]}/`
      : fbmUrl;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('h1, [data-testid="marketplace_pdp_container"]', { timeout: 10000 }).catch(() => null);
    await sleep(3000);

    // Scroll para disparar carregamento lazy das fotos do produto
    await page.evaluate(() => window.scrollTo(0, 400)).catch(() => null);
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => null);
    await sleep(1000);

    // Extrai metadados via og:tags + DOM
    const meta = await page.evaluate(() => {
      const get = sel => document.querySelector(sel)?.content?.trim() || '';
      const ogTitle = get('meta[property="og:title"]');
      const ogDesc  = get('meta[property="og:description"]');
      const ogImage = get('meta[property="og:image"]');

      // og:description do FB Marketplace tem formato:
      // "R$ 130 · Carretilha CW xt · Em estoque · Pinheiro, MA"
      // ou "R$ 130 - descrição - Cidade, UF"
      // Extrai preço e cidade diretamente daqui (mais confiável que bodyText)
      let price = '', cidade = '', estado = '', descricao = '';

      if (ogDesc) {
        const priceM = ogDesc.match(/R\$\s*([\d.,]+)/);
        if (priceM) price = priceM[1].replace(/\./g, '').replace(',', '.');

        // Último segmento separado por · ou - costuma ter "Cidade, UF"
        const parts = ogDesc.split(/[·\-]/).map(p => p.trim()).filter(Boolean);
        const locPart = parts[parts.length - 1] || '';
        const locM = locPart.match(/^(.+),\s*([A-Z]{2})$/);
        if (locM) { cidade = locM[1].trim(); estado = locM[2].trim(); }

        // Descrição: partes do meio (sem preço e sem cidade)
        descricao = parts.filter(p =>
          !p.match(/^R\$/) && p !== locPart && p !== ogTitle
        ).join(' ').trim();
      }

      // Fallback: extrai do contexto do DOM próximo ao elemento de preço
      // (mais confiável que bodyText inteiro, que mistura sidebar com conteúdo)
      if (!price || !cidade) {
        // Sobe 6 níveis a partir do nó de texto com "R$" para pegar o bloco do listing
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let priceContext = '';
        let node;
        while ((node = walker.nextNode())) {
          if (/R\$/.test(node.textContent)) {
            let el = node.parentElement;
            for (let i = 0; i < 6; i++) { if (!el) break; el = el.parentElement; }
            priceContext = el?.innerText || '';
            break;
          }
        }
        if (!priceContext) priceContext = document.body?.innerText || '';

        if (!price) {
          const pm = priceContext.match(/R\$\s*([\d.,]+)/);
          if (pm) price = pm[1].replace(/\./g, '').replace(',', '.');
        }
        if (!cidade) {
          // FB usa "Anunciado há X dias em Cidade, UF" ou "Anunciado hoje em Cidade, UF"
          const lm = priceContext.match(/Anunciado .+? em ([^,\n]+),\s*([A-Z]{2})/);
          if (lm) { cidade = lm[1].trim(); estado = lm[2].trim(); }
        }
        if (!descricao) {
          const SKIP = ['Anunciado', 'Detalhes', 'Condição', 'Marca', 'Enviar mensagem',
            'Informações do vendedor', 'Comente como', 'Escambo', 'Comprar', 'Vender'];
          const isSkip = l => SKIP.some(k => l.startsWith(k)) || /^R\$/.test(l) || /^[A-Z]{2}$/.test(l);
          descricao = priceContext.split('\n').map(l => l.trim()).filter(Boolean)
            .filter(l => l.length > 15 && !isSkip(l) && l !== ogTitle).slice(0, 3).join(' ');
        }
      }

      return { titulo: ogTitle, preco: price, cidade, estado, descricao, ogImage };
    }).catch(() => null);

    if (meta) {
      titulo    = meta.titulo;
      preco     = meta.preco;
      cidade    = meta.cidade;
      estado    = meta.estado;
      descricao = meta.descricao;
    }

    // Fotos: extrai do JSON embutido na página, filtrado pelo listing ID
    // O FB embarca os dados do anúncio como JSON em <script> tags —
    // as fotos do produto aparecem adjacentes ao listing_id no source,
    // muito antes dos anúncios relacionados (que ficam no final do JSON)
    const listingId = (fbmUrl.match(/\/item\/(\d+)/) || [])[1] || '';
    const pageSource = await page.content();

    let jsonPhotos = [];
    if (listingId) {
      const idIdx = pageSource.indexOf(listingId);
      if (idIdx > -1) {
        // Pega até 12000 chars ao redor do listing_id — suficiente para as fotos do produto
        const context = pageSource.slice(Math.max(0, idIdx - 1000), idIdx + 12000);
        const matches = [...context.matchAll(/"uri"\s*:\s*"(https?:[^"]*t39\.30808[^"]*)"/g)];
        jsonPhotos = [...new Set(
          matches.map(m => m[1].replace(/\\\//g, '/').replace(/\\u0025/g, '%'))
        )];
      }
    }

    // og:image sempre primeiro (garantidamente do produto), depois fotos do JSON
    const ogImage = meta?.ogImage || '';
    imgUrls = [...new Set([...(ogImage ? [ogImage] : []), ...jsonPhotos])].slice(0, 10);

  } finally {
    await page.close().catch(() => null);
  }

  console.log(`\n📋 Dados extraídos:`);
  console.log(`   Título:   ${titulo || '(vazio)'}`);
  console.log(`   Preço:    ${preco ? 'R$ ' + preco : '(vazio)'}`);
  console.log(`   Cidade:   ${cidade || '(vazio)'}${estado ? ' - ' + estado : ''}`);
  console.log(`   Imagens:  ${imgUrls.length} foto(s) encontrada(s)`);

  if (!titulo) {
    await browser.close();
    throw new Error('Título não encontrado — verifique se a URL é válida e os cookies estão ativos.');
  }

  // ── Criar pasta em "Dados para upload" ──────────────────────────────────────
  const safeWpp    = whatsapp.replace(/\D/g, '');
  const waFmt      = formatWA(safeWpp);
  const safeName   = titulo.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const idPrefix   = listingId ? `${listingId}_` : '';
  const folderName = `${idPrefix}${waFmt}_${safeName}`;
  const folderPath = path.join(DADOS_BASE, folderName);

  fs.mkdirSync(folderPath, { recursive: true });

  // Criar Dados.txt
  const txt = [
    `Título: ${titulo}`,
    `Preço: ${preco}`,
    `Cidade: ${cidade}`,
    `Estado: ${estado}`,
    `WhatsApp: ${safeWpp}`,
    `Descrição: ${descricao}`,
    `Source URL: ${fbmUrl}`,
  ].join('\n');
  fs.writeFileSync(path.join(folderPath, 'Dados.txt'), txt, 'utf8');

  // Baixar fotos usando sessão autenticada
  let downloaded = 0;
  for (let i = 0; i < imgUrls.length; i++) {
    process.stdout.write(`\n📸 Baixando foto ${i + 1}/${imgUrls.length}...`);
    try {
      const dlPage = await ctx.newPage();
      const resp   = await dlPage.goto(imgUrls[i], { timeout: 15000 });
      if (resp?.ok()) {
        const buf = await resp.body();
        if (buf?.length > 5000) {
          fs.writeFileSync(path.join(folderPath, `${i + 1}.jpg`), buf);
          downloaded++;
          process.stdout.write(' ✅');
        }
      }
      await dlPage.close().catch(() => null);
    } catch (e) {
      process.stdout.write(` ⚠️  (${e.message.slice(0, 40)})`);
    }
  }

  await browser.close();

  // ── Upload ao Supabase (somente com --upload) ────────────────────────────
  let supabaseId = null;
  if (doUpload) {
    console.log('\n☁️  Enviando fotos ao Supabase Storage...');
    const fotos = fs.readdirSync(folderPath).filter(f => f.endsWith('.jpg')).sort();
    const imgUrls = [];
    for (let i = 0; i < fotos.length; i++) {
      process.stdout.write(`   ${fotos[i]}...`);
      const slug = `fbm-${safeWpp}-${Date.now()}-${i + 1}.jpg`;
      const url  = await uploadFotoSupabase(path.join(folderPath, fotos[i]), slug);
      imgUrls.push(url);
      process.stdout.write(' ✅\n');
    }

    console.log('📝 Inserindo draft no Supabase...');
    const row = await insertDraftSupabase({
      titulo,
      descricao:  descricao || null,
      preco:      preco ? Number(preco) : null,
      cidade:     cidade || 'Brasil',
      whatsapp:   safeWpp,
      imagens:    imgUrls,
      status:     'draft',
      utm_source: 'fbm_import',
      utm_medium: 'facebook_marketplace',
    });
    supabaseId = row?.id;

    // Renomeia pasta para incluir o ID real do Supabase
    if (supabaseId && !listingId) {
      const newFolderName = `${supabaseId}_${waFmt}_${safeName}`;
      const newFolderPath = path.join(DADOS_BASE, newFolderName);
      fs.renameSync(folderPath, newFolderPath);
      console.log(`📁 Pasta renomeada → ${newFolderName}`);
    }

    console.log(`✅ Draft criado com ID #${supabaseId} (status: draft — aprove no Supabase para publicar)`);
  }

  console.log(`\n\n✅ Pasta criada com sucesso!`);
  console.log('─'.repeat(50));
  console.log(`   Pasta:      ${folderName}`);
  console.log(`   Título:     ${titulo}`);
  console.log(`   Preço:      ${preco ? 'R$ ' + preco : '(sem preço)'}`);
  console.log(`   Cidade:     ${cidade || '(sem cidade)'}`);
  console.log(`   Fotos:      ${downloaded} baixada(s)`);
  if (supabaseId) console.log(`   Supabase:   #${supabaseId} (draft)`);
  console.log('─'.repeat(50));
  console.log(`\n📁 ${folderPath}\n`);
}

main().catch(err => {
  console.error(`\n❌ Erro: ${err.message}\n`);
  process.exit(1);
});
