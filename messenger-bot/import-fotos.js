'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIES_FILE = path.join(__dirname, 'cookies.json');
const BASE = path.join(__dirname, '..', 'Dados para upload');

const ITENS = [
  { url: 'https://www.facebook.com/marketplace/item/1058289779929734/', pasta: '19995109842_import-temp', whatsapp: '19995109842' },
];

async function downloadImg(ctx, url, dest) {
  const pg = await ctx.newPage();
  try {
    const r = await pg.goto(url, { timeout: 15000 });
    if (!r || !r.ok()) return false;
    const buf = await r.body();
    if (buf.length < 5000) return false; // ignora imagens muito pequenas
    fs.writeFileSync(dest, buf);
    return true;
  } catch { return false; }
  finally { await pg.close(); }
}

(async () => {
  const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies(cookies);

  for (const item of ITENS) {
    const folderPath = path.join(BASE, item.pasta);
    fs.mkdirSync(folderPath, { recursive: true });

    // Limpar fotos antigas
    fs.readdirSync(folderPath).filter(f => f.match(/\.jpg$/i)).forEach(f => fs.unlinkSync(path.join(folderPath, f)));

    // Intercepta respostas de imagem durante o carregamento — captura fotos reais da rede
    const interceptedImgs = [];
    const page = await ctx.newPage();
    page.on('response', async (resp) => {
      try {
        const url = resp.url();
        const ct = resp.headers()['content-type'] || '';
        if (!url.includes('fbcdn') || !ct.startsWith('image/')) return;
        // Filtra apenas fotos do anúncio (t39.30808) — exclui outros tipos (perfil, sidebar, etc.)
        if (!url.includes('/t39.30808-')) return;
        const buf = await resp.body().catch(() => null);
        if (!buf || buf.length < 20000) return; // fotos reais > 20KB
        if (!interceptedImgs.includes(url)) interceptedImgs.push(url);
      } catch {}
    });

    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);

    // Scroll para disparar carregamento de todas as imagens
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(3000);

    // Extrair dados do produto da página
    const dados = await page.evaluate(() => {
      // Meta tags (og)
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
      const ogDesc  = document.querySelector('meta[property="og:description"]')?.content || '';
      const ogImage = document.querySelector('meta[property="og:image"]')?.content || null;

      // Título: h1 da página ou og:title
      const h1 = document.querySelector('h1')?.innerText?.trim() || '';
      const titulo = h1 || ogTitle || '';

      // Preço: procurar padrão "R$" no texto da página
      const bodyText = document.body.innerText;
      const precoMatch = bodyText.match(/R\$\s*([\d.,]+)/);
      let preco = '';
      if (precoMatch) {
        preco = precoMatch[1].replace(/\./g, '').replace(',', '.');
        preco = String(Math.round(parseFloat(preco)));
      }

      // Cidade: span com padrão "CidadeName · No raio de..." ou "CidadeName\n · SP"
      const spans = [...document.querySelectorAll('span')].map(s => s.innerText?.trim()).filter(Boolean);
      const cidadeSpan = spans.find(s => s.match(/^[A-Za-zÀ-ú\s]+\n?\s*·\s*(No raio|SP|São Paulo|[A-Z]{2})/));
      const cidade = cidadeSpan ? cidadeSpan.split('\n')[0].split('·')[0].trim() : '';

      // Descrição: og:description ou texto da seção de descrição
      const descricao = ogDesc || '';

      return { titulo, preco, cidade, descricao, ogImage };
    });

    console.log(`\n  📋 Dados extraídos:`);
    console.log(`     Título:    ${dados.titulo}`);
    console.log(`     Preço:     R$ ${dados.preco}`);
    console.log(`     Cidade:    ${dados.cidade}`);
    console.log(`     Descrição: ${dados.descricao.slice(0, 80)}...`);

    // Estratégia 1: imagens interceptadas da rede (> 50KB) — mais confiável
    let imgs = [...new Set(interceptedImgs)].slice(0, 10);
    console.log(`\n  🌐 Interceptadas da rede: ${imgs.length}`);

    // Estratégia 2: byAlt no DOM
    if (imgs.length < 2) {
      const domImgs = await page.evaluate(() => {
        const ogImage = document.querySelector('meta[property="og:image"]')?.content || null;
        const byAlt = [...document.querySelectorAll('img[alt*="Foto de produto"]')]
          .map(img => img.src)
          .filter(s => s && s.includes('fbcdn') && s.length > 80);
        if (byAlt.length > 0) {
          return [...new Set([...(ogImage ? [ogImage] : []), ...byAlt])].slice(0, 10);
        }
        const border = [...document.querySelectorAll('*')].find(el =>
          el.children.length === 0 &&
          (el.innerText?.includes('Seleções de hoje') || el.innerText?.includes("Today's picks"))
        );
        const allImgs = [...document.querySelectorAll('img[src*="fbcdn"]')];
        const productImgs = border
          ? allImgs.filter(img => border.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING)
          : allImgs.slice(0, 10);
        return [...new Set([
          ...(ogImage ? [ogImage] : []),
          ...productImgs.map(img => img.src).filter(s => s && s.includes('fbcdn') && s.length > 80),
        ])].slice(0, 10);
      });
      console.log(`  🖼️  byAlt/fallback DOM: ${domImgs.length}`);
      imgs = [...new Set([...imgs, ...domImgs])].slice(0, 10);
    }

    // Sempre incluir og:image se tiver e não estiver na lista
    if (dados.ogImage && !imgs.includes(dados.ogImage)) {
      imgs = [dados.ogImage, ...imgs].slice(0, 10);
    }

    await page.close();

    // Criar Dados.txt
    const dadosTxt = [
      `Título: ${dados.titulo}`,
      `Preço: ${dados.preco}`,
      `Cidade: ${dados.cidade}`,
      `WhatsApp: ${item.whatsapp || ''}`,
      `Descrição: ${dados.descricao}`,
      `URL: ${item.url || ''}`,
    ].join('\n');
    fs.writeFileSync(path.join(folderPath, 'Dados.txt'), dadosTxt, 'utf8');
    console.log(`  📄 Dados.txt criado`);

    imgs.forEach((u, i) => console.log(`  [${i+1}] ${u.slice(0, 120)}`));
    console.log(`\n${item.pasta}: ${imgs.length} fotos encontradas`);
    let saved = 0;
    for (let i = 0; i < imgs.length; i++) {
      const ok = await downloadImg(ctx, imgs[i], path.join(folderPath, `${i+1}.jpg`));
      process.stdout.write(ok ? '.' : 'x');
      if (ok) saved++;
    }
    console.log(` (${saved} salvas)`);
  }

  await browser.close();
  console.log('\nConcluído!');
})().catch(console.error);
