// ==UserScript==
// @name         FBM Scraper — Takko Outreach
// @namespace    takko-outreach-fbm
// @version      1.0
// @description  Rastreia vendedores do Facebook Marketplace para outreach da Takko
// @match        *://*.facebook.com/marketplace*
// @grant        GM_xmlhttpRequest
// @connect      azvdbthnwbhtfwffmnni.supabase.co
// ==/UserScript==

(function () {
  'use strict';

  const SUPABASE_URL = 'https://azvdbthnwbhtfwffmnni.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dmRidGhud2JodGZ3ZmZtbm5pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg5NjQ4OSwiZXhwIjoyMDkyNDcyNDg5fQ.ic2aWAPubW9oOrTvS8Fd98pB_dmAfFcIRN9Qq1eTrLs';
  const LOCAL_KEY = 'takko_fbm_scraper';
  const PLATFORM = 'facebook_marketplace';

  // ─── LocalStorage ─────────────────────────────────────────────────────────────
  function loadState() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveState(s) { localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); }
  function markLocal(id, status) {
    const s = loadState(); s[id] = { status, ts: Date.now() }; saveState(s);
  }
  function getLocalStatus(id) { return loadState()[id]?.status || 'novo'; }

  // ─── Supabase ─────────────────────────────────────────────────────────────────
  function sbFetch(method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: SUPABASE_URL + path,
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer': method === 'POST' ? 'return=minimal' : '',
        },
        data: body ? JSON.stringify(body) : undefined,
        onload: r => { try { resolve(JSON.parse(r.responseText)); } catch { resolve({}); } },
        onerror: reject,
      });
    });
  }

  async function fetchContactedSellers() {
    try {
      const data = await sbFetch('GET',
        `/rest/v1/outreach_contacts?platform=eq.${PLATFORM}&select=seller_name,listing_url`);
      if (!Array.isArray(data)) return { names: new Set(), ids: new Set() };
      const names = new Set(data.map(r => (r.seller_name || '').toLowerCase().trim()).filter(Boolean));
      const ids = new Set(data.map(r => {
        const m = (r.listing_url || '').match(/\/marketplace\/item\/(\d+)/);
        return m ? m[1] : null;
      }).filter(Boolean));
      return { names, ids };
    } catch { return { names: new Set(), ids: new Set() }; }
  }

  async function saveToSupabase(listing) {
    const today = new Date().toISOString().split('T')[0];
    return sbFetch('POST', '/rest/v1/outreach_contacts', {
      platform: PLATFORM,
      seller_name: listing.seller,
      listing_url: listing.url,
      product: listing.title,
      date_contacted: today,
      status: 'aguardando_retorno',
    });
  }

  // ─── Extração de listings (página de busca) ───────────────────────────────────
  function extractListings() {
    const seen = new Set();
    const listings = [];

    const linkEls = [...document.querySelectorAll('a[href*="/marketplace/item/"]')];

    linkEls.forEach(a => {
      const url = a.href.split('?')[0];
      const listId = url.match(/\/marketplace\/item\/(\d+)/)?.[1];
      if (!listId || seen.has(listId)) return;
      seen.add(listId);

      // Subir para o card container
      const card = a.closest('[data-testid], [role="article"]') || a.parentElement?.parentElement || a;

      // Estrutura validada 20/08/2026: span[dir="auto"] na ordem: badge, preço, título, cidade
      const dirSpans = [...card.querySelectorAll('span[dir="auto"]')];
      const priceEl = dirSpans.find(s => s.textContent?.trim().startsWith('R$'));
      const price = priceEl?.textContent?.trim() || '';
      const titleEl = dirSpans.find(s => {
        const t = s.textContent?.trim();
        return t && t.length > 5 && !t.startsWith('R$') && !/^Acabou de ser/i.test(t) && !/^\d+$/.test(t);
      });
      const title = titleEl?.textContent?.trim() || a.getAttribute('aria-label') || '(sem título)';
      const cityEl = dirSpans.find(s => {
        const t = s.textContent?.trim();
        return t && t !== title && t !== price && t.includes(',') && !/^R\$/.test(t);
      });
      const city = cityEl?.textContent?.trim() || '';

      // Seller: não fica visível nos cards de busca — preenchido na página do anúncio
      const seller = '';

      if (!title || title === '(sem título)') return;
      // Filtra carretas/carretinhas (reboque/carga) — não são carretilhas de pesca
      if (/carreta|carretinha/i.test(title) && !/carretilha/i.test(title)) return;
      listings.push({ listId, title, price, city, url, seller });
    });

    return listings;
  }

  // ─── UI ───────────────────────────────────────────────────────────────────────
  const STATUS_COLORS = {
    novo:      { bg: '#f0f9ff', border: '#3b82f6', label: 'Novo',          emoji: '🔵' },
    aberto:    { bg: '#fefce8', border: '#eab308', label: 'Aberto',        emoji: '🟡' },
    mensagem:  { bg: '#f0fdf4', border: '#22c55e', label: 'Enviado',       emoji: '✅' },
    historico: { bg: '#fdf4ff', border: '#a855f7', label: 'Já contatado',  emoji: '🟣' },
    ignorar:   { bg: '#f9fafb', border: '#9ca3af', label: 'Ignorar',       emoji: '⚫' },
  };

  function updateItem(listId) {
    const s = STATUS_COLORS[getLocalStatus(listId)] || STATUS_COLORS.novo;
    const el = document.getElementById('ti-fbm-' + listId);
    if (!el) return;
    el.style.background = s.bg;
    el.style.borderColor = s.border;
    const badge = el.querySelector('.tb');
    if (badge) badge.textContent = s.emoji + ' ' + s.label;
  }

  window.takkoFbmMark = (listId, status, listing) => {
    markLocal(listId, status);
    updateItem(listId);
    if (status === 'mensagem' && listing) {
      const cache = JSON.parse(localStorage.getItem('takko_fbm_seller_cache') || '{}');
      if (!listing.seller) listing.seller = cache[listId]?.seller || '';
      if (!listing.title && cache[listId]?.title) listing.title = cache[listId].title;
      saveToSupabase(listing).catch(console.error);
      showToast('✅ Salvo no Supabase: ' + (listing.seller || listing.title));
    }
  };

  function showToast(msg) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:80px;right:24px;background:#1877f2;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,.2);font-family:system-ui,sans-serif';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function buildPanel(listings, contactedSet) {
    document.getElementById('tkp-fbm')?.remove();

    // Pré-marcar listings cujo seller ou listId já está no Supabase
    const cache = JSON.parse(localStorage.getItem('takko_fbm_seller_cache') || '{}');
    const { names: contactedNames, ids: contactedIds } = contactedSet;
    listings.forEach(l => {
      const sellerName = l.seller || cache[l.listId]?.seller || '';
      const byId   = contactedIds.has(l.listId);
      const byName = sellerName && contactedNames.has(sellerName.toLowerCase().trim());
      if (byId || byName) {
        const cur = getLocalStatus(l.listId);
        if (cur === 'novo' || cur === 'aberto') markLocal(l.listId, 'historico');
      }
    });

    const state = loadState();
    const novos = listings.filter(l => !state[l.listId] || state[l.listId].status === 'novo').length;
    const total = listings.length;

    const p = document.createElement('div');
    p.id = 'tkp-fbm';
    p.style.cssText = 'position:fixed;top:70px;right:16px;width:340px;max-height:80vh;background:#fff;border:2px solid #1877f2;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);z-index:99999;font-family:system-ui,sans-serif;font-size:13px;overflow:hidden;display:flex;flex-direction:column';

    p.innerHTML = `
      <div style="background:#1877f2;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <span style="font-weight:700;font-size:14px">🎣 Takko FBM</span>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:11px;opacity:.85">${novos} novos / ${total}</span>
          <button id="tkfbm-rescan" style="background:rgba(255,255,255,.2);border:none;color:#fff;cursor:pointer;font-size:11px;padding:2px 8px;border-radius:4px">🔄</button>
          <button id="tkfbm-min" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px">−</button>
          <button id="tkfbm-cls" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px">×</button>
        </div>
      </div>
      <div id="tkfbm-body" style="overflow-y:auto;flex:1;padding:8px;display:flex;flex-direction:column">
        <div style="display:flex;gap:6px;padding:4px 0 8px;flex-wrap:wrap">
          <button id="tkfbm-nxt" style="background:#1877f2;color:#fff;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px">▶ Próximo novo</button>
          <button id="tkfbm-clr" style="background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px">🗑 Limpar cache</button>
        </div>
        <div id="tkfbm-list"></div>
      </div>`;

    document.body.appendChild(p);
    const list = p.querySelector('#tkfbm-list');

    listings.forEach(listing => {
      const { listId, title, price, url } = listing;
      const sellerName = listing.seller || cache[listId]?.seller || '';
      const fullListing = { ...listing, seller: sellerName };
      const status = getLocalStatus(listId);
      const s = STATUS_COLORS[status] || STATUS_COLORS.novo;
      const listingJson = JSON.stringify(fullListing).replace(/'/g, "\\'");

      const el = document.createElement('div');
      el.id = 'ti-fbm-' + listId;
      el.style.cssText = `background:${s.bg};border:1px solid ${s.border};border-radius:8px;padding:8px 10px;margin-bottom:6px`;
      el.innerHTML = `
        <div style="font-weight:600;font-size:12px;line-height:1.3;margin-bottom:2px">${title}</div>
        <div style="color:#6b7280;font-size:11px;margin-bottom:4px">${price}${listing.city ? ' · ' + listing.city : ''}${sellerName ? ' · 👤 ' + sellerName : ''}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <a href="${url}" target="_blank"
             style="background:#1877f2;color:#fff;text-decoration:none;border-radius:5px;padding:3px 8px;font-size:11px"
             onclick="(function(){var s=JSON.parse(localStorage.getItem('takko_fbm_scraper')||'{}');s['${listId}']={status:'aberto',ts:Date.now()};localStorage.setItem('takko_fbm_scraper',JSON.stringify(s))})()">
            🔗 Abrir
          </a>
          <button onclick="takkoFbmMark('${listId}','mensagem',${listingJson.replace(/"/g, '&quot;')})"
            style="background:#16a34a;color:#fff;border:none;border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer">✅ Enviado</button>
          <button onclick="takkoFbmMark('${listId}','ignorar',null)"
            style="background:#9ca3af;color:#fff;border:none;border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer">⚫ Ignorar</button>
        </div>
        <div class="tb" style="font-size:10px;color:#9ca3af;margin-top:4px">${s.emoji} ${s.label}</div>`;
      list.appendChild(el);
    });

    p.querySelector('#tkfbm-rescan').onclick = async () => {
      const newListings = extractListings();
      const contacted = await fetchContactedSellers();
      buildPanel(newListings, contacted);
    };

    p.querySelector('#tkfbm-nxt').onclick = () => {
      const nx = listings.find(l => getLocalStatus(l.listId) === 'novo');
      if (!nx) { alert('Nenhum listing novo restante.'); return; }
      markLocal(nx.listId, 'aberto');
      window.open(nx.url, '_blank');
      updateItem(nx.listId);
    };

    p.querySelector('#tkfbm-clr').onclick = () => {
      if (confirm('Limpar cache local? (Histórico no Supabase é mantido)')) {
        localStorage.removeItem(LOCAL_KEY);
        buildPanel(listings, { names: contactedNames, ids: contactedIds });
      }
    };

    let min = false;
    p.querySelector('#tkfbm-min').onclick = () => {
      const b = p.querySelector('#tkfbm-body');
      min = !min;
      b.style.display = min ? 'none' : 'flex';
      p.querySelector('#tkfbm-min').textContent = min ? '+' : '−';
    };

    p.querySelector('#tkfbm-cls').onclick = () => p.remove();
  }

  // ─── Toggle button ─────────────────────────────────────────────────────────────
  function addToggleButton() {
    if (document.getElementById('tkfbm-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'tkfbm-btn';
    btn.textContent = '🎣';
    btn.title = 'Takko FBM Scraper';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;width:48px;height:48px;background:#1877f2;color:#fff;border:none;border-radius:50%;font-size:22px;cursor:pointer;z-index:99998;box-shadow:0 4px 12px rgba(0,0,0,.25)';
    btn.onclick = async () => {
      const existing = document.getElementById('tkp-fbm');
      if (existing) { existing.remove(); return; }
      const listings = extractListings();
      if (!listings.length) { alert('Nenhum listing encontrado. Role a página para carregar mais itens.'); return; }
      btn.textContent = '⏳';
      const contactedSet = await fetchContactedSellers();
      btn.textContent = '🎣';
      buildPanel(listings, contactedSet);
    };
    document.body.appendChild(btn);
  }

  // ─── Página do anúncio individual ─────────────────────────────────────────────
  function extractListingPageSeller() {
    // Validado 20/08/2026: múltiplos links para /marketplace/profile/ com textos variados
    // Pegar o que tem nome real (≠ "Detalhes do vendedor" e ≠ vazio)
    const profileLinks = [...document.querySelectorAll('a[href*="/marketplace/profile/"]')];
    const sellerLink = profileLinks.find(a => {
      const text = a.textContent?.trim();
      return text && text.length > 1 && text !== 'Detalhes do vendedor';
    });
    if (sellerLink) return sellerLink.textContent?.trim();
    return null;
  }

  async function initListingPage() {
    const listId = location.pathname.match(/\/marketplace\/item\/(\d+)/)?.[1];
    if (!listId) return;

    const seller = extractListingPageSeller();
    const title  = document.querySelector('h1')?.textContent?.trim()
      || document.querySelector('[data-testid="marketplace-pdp-title"]')?.textContent?.trim()
      || document.title;

    if (seller) {
      const cache = JSON.parse(localStorage.getItem('takko_fbm_seller_cache') || '{}');
      cache[listId] = { seller, title, url: location.href };
      localStorage.setItem('takko_fbm_seller_cache', JSON.stringify(cache));

      // Verifica se seller já foi contatado no Supabase
      const { names: contactedNames, ids: contactedIds } = await fetchContactedSellers();
      const sellerLower = seller.toLowerCase().trim();
      const alreadyContacted = contactedIds.has(listId)
        || [...contactedNames].some(n => n && (sellerLower.includes(n) || n.includes(sellerLower)));

      if (alreadyContacted) {
        markLocal(listId, 'historico');
        showToast(`🟣 Já contatado: ${seller}`);
        return;
      }
    }

    showToast(`🎣 ${seller ? '👤 ' + seller : 'Vendedor não identificado'}`);

    // Interceptar clique no botão Message/Mensagem → salva no Supabase automaticamente
    function attachMessageSave() {
      // Validado 20/08/2026: aria-label="Enviar mensagem" em pt-BR
      const msgBtn = document.querySelector(
        '[aria-label="Enviar mensagem"], [aria-label="Message seller"], [aria-label="Message"], [aria-label="Mensagem"]'
      ) || [...document.querySelectorAll('div[role="button"], button')]
        .find(b => /^(enviar mensagem|message|mensagem)$/i.test(b.textContent?.trim()));

      if (!msgBtn) return false;

      msgBtn.addEventListener('click', () => {
        const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
        if (saved[listId]?.status === 'mensagem') return;

        const cache = JSON.parse(localStorage.getItem('takko_fbm_seller_cache') || '{}');
        const sellerName = seller || cache[listId]?.seller || '';
        const today = new Date().toISOString().split('T')[0];

        sbFetch('POST', '/rest/v1/outreach_contacts', {
          platform: PLATFORM,
          seller_name: sellerName,
          listing_url: location.href,
          product: title,
          date_contacted: today,
          status: 'aguardando_retorno',
        }).then(() => {
          markLocal(listId, 'mensagem');
          showToast('✅ Salvo no Supabase: ' + (sellerName || title));
        }).catch(console.error);
      }, { once: true });
      return true;
    }

    if (!attachMessageSave()) {
      let tries = 0;
      const interval = setInterval(() => {
        if (attachMessageSave() || ++tries > 20) clearInterval(interval);
      }, 500);
    }
  }

  // ─── Inbox: extrai histórico de conversas ─────────────────────────────────────
  function extractInboxContacts() {
    const contacts = [];
    const seen = new Set();

    // Links de thread do marketplace inbox
    const threadEls = [...document.querySelectorAll(
      'a[href*="/marketplace/t/"], a[href*="facebook.com/t/"]'
    )].filter(a => /\/t\/\d+/.test(a.href));

    threadEls.forEach(a => {
      const threadId = a.href.match(/\/t\/(\d+)/)?.[1];
      if (!threadId || seen.has(threadId)) return;
      seen.add(threadId);

      const container = a.closest('[role="row"], [role="listitem"], [data-testid]') || a.parentElement?.parentElement || a;
      const allSpans = [...container.querySelectorAll('span')].filter(s => !s.querySelector('span') && s.textContent?.trim().length > 1);

      const name = allSpans[0]?.textContent?.trim() || '';
      const item = allSpans.find(s => s !== allSpans[0] && s.textContent?.trim().length > 5)?.textContent?.trim() || '';

      if (!name || name.length < 2) return;
      contacts.push({ threadId, seller_name: name, product: item, listing_url: a.href });
    });

    return contacts;
  }

  // Extrai info da thread atual (página /marketplace/t/THREADID ou /t/THREADID)
  function extractCurrentThread() {
    const threadId = location.pathname.match(/\/(?:marketplace\/)?t\/(\d+)/)?.[1];
    if (!threadId) return null;

    // URL do item linkado na conversa
    const itemLink = [...document.querySelectorAll('a[href*="/marketplace/item/"]')]
      .find(a => /\/marketplace\/item\/\d+/.test(a.href));
    const listingUrl = itemLink?.href?.split('?')[0] || '';

    // Título do item
    const itemTitle = [...(itemLink?.querySelectorAll('span') || [])]
      .map(s => s.textContent?.trim()).filter(Boolean)[0]
      || itemLink?.getAttribute('aria-label') || '';

    // Nome do vendedor: img[alt] é o mais confiável no messenger.com
    const sellerImg = [...document.querySelectorAll('img[alt]')]
      .find(i => {
        const t = i.alt?.trim();
        return t && t.length > 2 && t.length < 60
          && !/^(Messenger|Facebook|Marketplace|Visto|Seen)/i.test(t)
          && !/^\d/.test(t);
      });
    const profileLink = document.querySelector('a[href*="/marketplace/profile/"]');
    const sellerName = (sellerImg?.alt?.trim() || profileLink?.textContent?.trim() || '').replace(/\s+/g, ' ');

    return { threadId, seller_name: sellerName, listing_url: listingUrl || location.href, product: itemTitle };
  }

  const INBOX_ACC_KEY = 'takko_fbm_inbox_acc';

  function loadInboxAcc() {
    try { return JSON.parse(localStorage.getItem(INBOX_ACC_KEY) || '{}'); } catch { return {}; }
  }
  function saveInboxAcc(acc) { localStorage.setItem(INBOX_ACC_KEY, JSON.stringify(acc)); }

  async function initInboxPage() {
    const existing = document.getElementById('tkfbm-inbox');
    if (existing) existing.remove();

    // Acumula contatos entre re-scans (chave = threadId)
    const acc = loadInboxAcc();

    const isThreadPage = /\/(?:marketplace\/)?t\/\d+/.test(location.pathname);
    if (isThreadPage) {
      // Página de thread individual: extrai item URL + vendedor desta conversa
      const thread = extractCurrentThread();
      if (thread) {
        // Enriquece entrada existente se já tinha (adiciona listing_url real)
        acc[thread.threadId] = { ...acc[thread.threadId], ...thread };
        saveInboxAcc(acc);
      }
    } else {
      const freshContacts = extractInboxContacts();
      freshContacts.forEach(c => { if (!acc[c.threadId]) acc[c.threadId] = c; });
      saveInboxAcc(acc);
    }

    const contacts = Object.values(acc);

    const panel = document.createElement('div');
    panel.id = 'tkfbm-inbox';
    panel.style.cssText = 'position:fixed;top:70px;right:16px;width:360px;max-height:80vh;background:#fff;border:2px solid #1877f2;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);z-index:99999;font-family:system-ui,sans-serif;font-size:13px;overflow:hidden;display:flex;flex-direction:column';

    panel.innerHTML = `
      <div style="background:#1877f2;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <span style="font-weight:700">📥 Histórico Inbox FBM</span>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="tkfbm-inbox-rescan" style="background:rgba(255,255,255,.2);border:none;color:#fff;cursor:pointer;font-size:11px;padding:2px 8px;border-radius:4px">🔄 Re-scan</button>
          <button id="tkfbm-inbox-reset" style="background:rgba(255,100,100,.4);border:none;color:#fff;cursor:pointer;font-size:11px;padding:2px 8px;border-radius:4px" title="Limpar acumulador">🗑</button>
          <button id="tkfbm-inbox-cls" style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px">×</button>
        </div>
      </div>
      <div style="padding:10px;overflow-y:auto;flex:1">
        <p style="margin:0 0 8px;color:#6b7280;font-size:12px">${contacts.length} conversa(s) encontrada(s). Role o inbox para carregar mais e clique 🔄 Re-scan.</p>
        <div id="tkfbm-inbox-list" style="margin-bottom:10px;max-height:40vh;overflow-y:auto"></div>
        <button id="tkfbm-inbox-upload" style="width:100%;background:#16a34a;color:#fff;border:none;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:13px">
          ⬆️ Subir ${contacts.length} contatos no Supabase
        </button>
        <div id="tkfbm-inbox-status" style="margin-top:8px;font-size:12px;color:#6b7280;text-align:center"></div>
      </div>`;

    document.body.appendChild(panel);
    panel.querySelector('#tkfbm-inbox-cls').onclick = () => panel.remove();
    panel.querySelector('#tkfbm-inbox-rescan').onclick = () => { panel.remove(); initInboxPage(); };
    panel.querySelector('#tkfbm-inbox-reset').onclick = () => {
      if (confirm('Limpar lista acumulada? (Supabase não é afetado)')) {
        localStorage.removeItem(INBOX_ACC_KEY);
        panel.remove();
        initInboxPage();
      }
    };

    const listEl = panel.querySelector('#tkfbm-inbox-list');
    contacts.forEach(c => {
      const row = document.createElement('div');
      row.style.cssText = 'border:1px solid #e5e7eb;border-radius:6px;padding:6px 8px;margin-bottom:4px;font-size:12px';
      row.innerHTML = `<strong>${c.seller_name}</strong>${c.product ? '<br><span style="color:#6b7280">' + c.product + '</span>' : ''}`;
      listEl.appendChild(row);
    });

    const statusEl = panel.querySelector('#tkfbm-inbox-status');
    panel.querySelector('#tkfbm-inbox-upload').onclick = async () => {
      if (!contacts.length) return;
      statusEl.textContent = 'Enviando...';
      let ok = 0, skip = 0;
      const today = new Date().toISOString().split('T')[0];

      for (const c of contacts) {
        try {
          await sbFetch('POST', '/rest/v1/outreach_contacts', {
            platform: PLATFORM,
            seller_name: c.seller_name,
            listing_url: c.listing_url,
            product: c.product || '',
            date_contacted: today,
            status: 'aguardando_retorno',
          });
          markLocal(c.threadId, 'historico');
          ok++;
        } catch { skip++; }
      }
      statusEl.textContent = `✅ ${ok} subidos${skip ? ' · ' + skip + ' erro(s)' : ''}`;
    };
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    addToggleButton();

    const isListingPage = /\/marketplace\/item\/\d+/.test(location.pathname);
    const isInboxPage   = /\/marketplace\/(inbox|t\/\d+)/.test(location.pathname);

    if (isListingPage) {
      setTimeout(() => initListingPage(), 2500);
      return;
    }

    if (isInboxPage) {
      // No inbox: botão 📥 no lugar do 🎣
      const btn = document.getElementById('tkfbm-btn');
      if (btn) { btn.textContent = '📥'; btn.onclick = () => initInboxPage(); }
      setTimeout(() => initInboxPage(), 3000);
      return;
    }

    // Página de busca: auto-abre o painel
    setTimeout(async () => {
      const listings = extractListings();
      if (!listings.length) return;
      const contactedSet = await fetchContactedSellers();
      buildPanel(listings, contactedSet);
    }, 3000);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : setTimeout(init, 1500);

})();
