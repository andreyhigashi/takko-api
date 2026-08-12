(function () {
  const SUPABASE_URL = 'https://azvdbthnwbhtfwffmnni.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dmRidGhud2JodGZ3ZmZtbm5pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg5NjQ4OSwiZXhwIjoyMDkyNDcyNDg5fQ.ic2aWAPubW9oOrTvS8Fd98pB_dmAfFcIRN9Qq1eTrLs';

  const isChat      = location.hostname === 'chat.olx.com.br';
  const isOLX       = location.hostname.includes('olx.com.br');
  const isFBM       = location.hostname.includes('facebook.com') && location.pathname.startsWith('/marketplace/item/');
  const isMessenger = location.hostname === 'www.messenger.com' && location.pathname.startsWith('/marketplace/t/');

  if (!isChat && !isFBM && !isMessenger && !(isOLX && /\-\d{7,}/.test(location.pathname))) return;

  // ── Extração do DOM ────────────────────────────────────────────────────────

  function extractChat() {
    let seller = '', product = '';

    // Seller: "Ver perfil" fica dentro de um div flex;
    // o div ANTERIOR ao pai desse flex contém "Nome5.0(N)" concatenado
    const verPerfil = [...document.querySelectorAll('a')]
      .find(a => a.textContent.trim() === 'Ver perfil');
    if (verPerfil) {
      const sellerDiv = verPerfil.parentElement?.previousElementSibling;
      if (sellerDiv) {
        // Extrai tudo antes do primeiro dígito: "Oliver5.0(11)" → "Oliver"
        const full = sellerDiv.textContent.trim();
        const m = full.match(/^([^0-9(★\n]+)/);
        seller = m ? m[1].trim() : full.split('\n')[0].trim();
      }
    }

    // Product: alt da imagem de anúncio (mais confiável)
    const adImg = document.querySelector('img[alt^="Imagem do anúncio:"]');
    if (adImg) product = adImg.alt.replace('Imagem do anúncio: ', '').trim().slice(0, 100);

    // Fallbacks via sidebar
    if (!seller || !product) {
      const leaves = [...document.querySelectorAll('[role="complementary"] *')]
        .filter(el => el.children.length === 0 && el.textContent.trim());
      if (!product) {
        const h = document.querySelector('[role="complementary"] h2, [role="complementary"] [role="heading"]');
        if (h) product = h.textContent.trim().slice(0, 100);
      }
      if (!seller) {
        const idx = leaves.findIndex(el => el.textContent.trim() === 'Negociante');
        if (idx !== -1) {
          for (let i = idx + 1; i < Math.min(idx + 5, leaves.length); i++) {
            const t = leaves[i].textContent.trim();
            if (t && t !== 'Conta nova' && !t.includes(' - ') && !t.includes('perfil')) {
              seller = t; break;
            }
          }
        }
      }
    }

    return { seller, product, listingUrl: '' };
  }

  function extractMessenger() {
    let seller = '', product = '';

    // Product: h2 "Conversa intitulada Andrey · PRODUTO"
    const h2 = document.querySelector('h2');
    if (h2) {
      const parts = h2.textContent.trim().split(' · ');
      if (parts.length > 1) product = parts.slice(1).join(' · ').trim();
    }

    // Seller: find first message in current chat NOT sent by "Você"
    // aria-label pattern: "Às HH:MM, NOME: texto da mensagem"
    const chatContainer = document.querySelector('div[aria-label^="Mensagens na conversa"]');
    const scope = chatContainer || document;
    for (const el of scope.querySelectorAll('div[aria-label^="Às "]')) {
      const lbl = el.getAttribute('aria-label');
      if (!lbl.includes(', Você:')) {
        const m = lbl.match(/,\s*([^:]+):/);
        if (m) { seller = m[1].trim(); break; }
      }
    }

    return { seller, product, listingUrl: location.href };
  }

  function extractListing() {
    const product = document.querySelector('h1')?.textContent.trim().slice(0, 100) || '';
    let seller = '';
    const tries = isOLX
      ? [
          () => document.querySelector('[data-ds-component="DS-UserCard"] h2')?.textContent,
          () => document.querySelector('[class*="UserCard"] h2')?.textContent,
          () => {
            const a = document.querySelector('a[href*="/perfil/"], a[href*="/profile/"]');
            return a?.querySelector('h2, strong, span')?.textContent;
          },
        ]
      : [
          () => document.querySelector('a[href*="/marketplace/profile/"] span')?.textContent,
          () => document.querySelector('a[href*="/user/"] span')?.textContent,
        ];
    for (const fn of tries) {
      try { const v = fn()?.trim(); if (v) { seller = v; break; } } catch (_) {}
    }
    return { seller, product, listingUrl: location.href };
  }

  // ── Supabase ───────────────────────────────────────────────────────────────

  async function findContact(sellerName) {
    if (!sellerName) return null;
    const first = encodeURIComponent('*' + sellerName.split(' ')[0] + '*');
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/outreach_contacts' +
      '?seller_name=ilike.' + first +
      '&order=date_contacted.desc&limit=1' +
      '&select=id,status,seller_name,product,message_angle,responded,date_contacted',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const rows = await res.json();
    return rows[0] || null;
  }

  async function saveContact(data) {
    const res = await fetch(SUPABASE_URL + '/rest/v1/outreach_contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text());
  }

  async function updateContact(id, data) {
    const res = await fetch(SUPABASE_URL + '/rest/v1/outreach_contacts?id=eq.' + id, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text());
  }

  // ── Estilos ────────────────────────────────────────────────────────────────

  const STATUS_META = {
    aguardando_retorno: { label: '🕐 Aguardando',  color: '#f59e0b', bg: '#fffbeb', text: '#92400e' },
    em_andamento:       { label: '💬 Em andamento', color: '#3b82f6', bg: '#eff6ff', text: '#1e3a8a' },
    negou:              { label: '❌ Negou',         color: '#ef4444', bg: '#fef2f2', text: '#7f1d1d' },
    confirmou:          { label: '✅ Confirmou!',    color: '#22c55e', bg: '#f0fdf4', text: '#14532d' },
  };

  function injectStyles() {
    if (document.getElementById('tk-styles')) return;
    const s = document.createElement('style');
    s.id = 'tk-styles';
    s.textContent = `
      #tk-chip {
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
        border: none; border-radius: 24px; padding: 11px 18px;
        font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        transition: transform .15s, box-shadow .15s;
      }
      #tk-chip:hover { transform: translateY(-2px); }
      #tk-chip.novo    { background: #0066cc; color: #fff; box-shadow: 0 4px 14px rgba(0,102,204,.4); }
      #tk-chip.novo:hover { box-shadow: 0 6px 18px rgba(0,102,204,.55); }

      .tk-overlay {
        position: fixed; inset: 0; z-index: 2147483646;
        background: rgba(0,0,0,.5);
        display: flex; align-items: flex-end; justify-content: center;
      }
      .tk-modal {
        background: #fff; border-radius: 20px 20px 0 0;
        padding: 22px 20px 34px; width: 100%; max-width: 520px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .tk-modal h2 { font-size: 17px; font-weight: 700; color: #1a1a1a; margin: 0 0 14px; }
      .tk-lbl { display: block; font-size: 11px; font-weight: 600; color: #888;
        text-transform: uppercase; letter-spacing: .4px; margin-bottom: 5px; }
      .tk-input {
        width: 100%; padding: 10px 12px; border: 1.5px solid #e0e0e0; border-radius: 8px;
        font-size: 15px; color: #1a1a1a; background: #fafafa; outline: none;
        box-sizing: border-box; font-family: inherit; margin-bottom: 12px;
      }
      .tk-input:focus { border-color: #0066cc; background: #fff; }
      .tk-sep { border: none; border-top: 1px solid #f0f0f0; margin: 14px 0; }

      /* Status grid */
      .tk-statuses { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
      .tk-sbtn {
        padding: 12px 8px; border: 2px solid #e0e0e0; border-radius: 10px;
        background: #fafafa; cursor: pointer; text-align: center;
        font-size: 13px; font-weight: 600; color: #666; font-family: inherit; line-height: 1.3;
        transition: border-color .1s, background .1s;
      }
      .tk-sbtn:hover { border-color: #aaa; background: #f0f0f0; }
      .tk-sbtn.sel { outline: 3px solid currentColor; }

      /* Ângulos */
      .tk-angles { display: flex; gap: 8px; margin-bottom: 14px; }
      .tk-angle {
        flex: 1; padding: 10px 4px; border: 2px solid #e0e0e0; border-radius: 10px;
        background: #fafafa; cursor: pointer; text-align: center;
        font-size: 15px; font-weight: 700; color: #888; font-family: inherit;
      }
      .tk-angle small { display: block; font-size: 10px; font-weight: 400; color: #bbb; margin-top: 1px; }
      .tk-angle.sel { border-color: #0066cc; background: #e8f0fe; color: #0066cc; }
      .tk-angle.sel small { color: #5a93e8; }

      .tk-save {
        width: 100%; padding: 13px; color: #fff; border: none; border-radius: 10px;
        font-size: 16px; font-weight: 600; cursor: pointer; font-family: inherit;
        background: #0066cc; margin-top: 2px;
      }
      .tk-save:disabled { background: #aaa; cursor: default; }

      .tk-toast {
        position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
        background: #1a1a1a; color: #fff; padding: 12px 24px;
        border-radius: 24px; font-size: 14px; font-weight: 500;
        z-index: 2147483648; white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        animation: tkin .2s ease;
      }
      @keyframes tkin { from { opacity:0; transform: translateX(-50%) translateY(8px); } }
    `;
    document.head.appendChild(s);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'tk-toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function closeOverlay() { document.querySelector('.tk-overlay')?.remove(); }

  // ── Modal de registro (novo contato) ───────────────────────────────────────

  let selAngle = 'B';

  function openRegModal(seller, product, listingUrl) {
    if (document.querySelector('.tk-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'tk-overlay';
    overlay.innerHTML = `
      <div class="tk-modal">
        <h2>📌 Registrar contato</h2>
        <label class="tk-lbl">Nome do vendedor</label>
        <input class="tk-input" id="tk-seller" value="${esc(seller)}" placeholder="Nome..." autocomplete="off">
        <label class="tk-lbl">Produto</label>
        <input class="tk-input" id="tk-product" value="${esc(product)}" placeholder="Produto..." autocomplete="off">
        <label class="tk-lbl" style="margin-bottom:8px">Ângulo</label>
        <div class="tk-angles">
          <div class="tk-angle${selAngle==='A'?' sel':''}" data-a="A">A<small>Visibilidade</small></div>
          <div class="tk-angle${selAngle==='B'?' sel':''}" data-a="B">B<small>Serviço</small></div>
          <div class="tk-angle${selAngle==='C'?' sel':''}" data-a="C">C<small>Espec.</small></div>
        </div>
        <button class="tk-save" id="tk-do-save">Salvar</button>
      </div>`;

    overlay.querySelectorAll('.tk-angle').forEach(btn => {
      btn.addEventListener('click', () => {
        selAngle = btn.dataset.a;
        overlay.querySelectorAll('.tk-angle').forEach(b =>
          b.classList.toggle('sel', b.dataset.a === selAngle));
      });
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });

    overlay.querySelector('#tk-do-save').addEventListener('click', async () => {
      const sv = overlay.querySelector('#tk-seller').value.trim();
      const pv = overlay.querySelector('#tk-product').value.trim();
      if (!sv || !pv) { alert('Preencha nome e produto.'); return; }
      const btn = overlay.querySelector('#tk-do-save');
      btn.disabled = true; btn.textContent = 'Salvando...';
      try {
        await saveContact({
          platform: isOLX || isChat ? 'olx' : 'facebook_marketplace',  // isMessenger → facebook_marketplace
          seller_name: sv, product: pv,
          contact: location.href,
          listing_url: listingUrl || null,
          message_angle: selAngle,
          date_contacted: new Date().toLocaleDateString('sv'),
          responded: false, listing_published: false,
          status: 'aguardando_retorno',
        });
        closeOverlay();
        toast('✓ Salvo! ' + sv);
        // Remonta chip mostrando o novo status
        unmount(); setTimeout(mount, 300);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Salvar';
        alert('Erro: ' + e.message);
      }
    });

    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('#tk-seller').focus(), 50);
  }

  // ── Modal de edição (contato existente) ────────────────────────────────────

  function openEditModal(contact, domSeller, domProduct, listingUrl) {
    if (document.querySelector('.tk-overlay')) return;

    const currentAngle = contact.message_angle || 'B';
    let editAngle = currentAngle;

    const statusBtns = Object.entries(STATUS_META).map(([k, m]) => `
      <button class="tk-sbtn${contact.status === k ? ' sel' : ''}" data-s="${k}"
        style="border-color:${m.color};background:${m.bg};color:${m.text}">
        ${m.label}
      </button>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'tk-overlay';
    overlay.innerHTML = `
      <div class="tk-modal">
        <h2>✏️ Editar contato</h2>

        <label class="tk-lbl">Status</label>
        <div class="tk-statuses">${statusBtns}</div>

        <hr class="tk-sep">

        <label class="tk-lbl">Nome do vendedor</label>
        <input class="tk-input" id="tk-e-seller" value="${esc(contact.seller_name)}" autocomplete="off">
        <label class="tk-lbl">Produto</label>
        <input class="tk-input" id="tk-e-product" value="${esc(contact.product || domProduct)}" autocomplete="off">
        <label class="tk-lbl" style="margin-bottom:8px">Ângulo</label>
        <div class="tk-angles" id="tk-e-angles">
          <div class="tk-angle${editAngle==='A'?' sel':''}" data-a="A">A<small>Visibilidade</small></div>
          <div class="tk-angle${editAngle==='B'?' sel':''}" data-a="B">B<small>Serviço</small></div>
          <div class="tk-angle${editAngle==='C'?' sel':''}" data-a="C">C<small>Espec.</small></div>
        </div>
        <button class="tk-save" id="tk-do-edit">Salvar alterações</button>
      </div>`;

    let selStatus = contact.status;

    overlay.querySelectorAll('.tk-sbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        selStatus = btn.dataset.s;
        overlay.querySelectorAll('.tk-sbtn').forEach(b =>
          b.classList.toggle('sel', b.dataset.s === selStatus));
      });
    });

    overlay.querySelectorAll('.tk-angle').forEach(btn => {
      btn.addEventListener('click', () => {
        editAngle = btn.dataset.a;
        overlay.querySelectorAll('.tk-angle').forEach(b =>
          b.classList.toggle('sel', b.dataset.a === editAngle));
      });
    });

    overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });

    overlay.querySelector('#tk-do-edit').addEventListener('click', async () => {
      const sv = overlay.querySelector('#tk-e-seller').value.trim();
      const pv = overlay.querySelector('#tk-e-product').value.trim();
      if (!sv || !pv) { alert('Preencha nome e produto.'); return; }
      const btn = overlay.querySelector('#tk-do-edit');
      btn.disabled = true; btn.textContent = 'Salvando...';

      const today = new Date().toLocaleDateString('sv');
      const patch = {
        seller_name: sv, product: pv,
        message_angle: editAngle,
        status: selStatus,
      };
      if (['em_andamento','negou','confirmou'].includes(selStatus) && !contact.responded) {
        patch.responded = true; patch.response_date = today;
      }

      try {
        await updateContact(contact.id, patch);
        closeOverlay();
        toast(STATUS_META[selStatus].label + ' — ' + sv);
        unmount(); setTimeout(mount, 300);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Salvar alterações';
        alert('Erro: ' + e.message);
      }
    });

    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('#tk-e-seller').focus(), 50);
  }

  // ── Chip dinâmico ──────────────────────────────────────────────────────────

  function setChip(label, bgColor, textColor, shadowColor, onClick) {
    let chip = document.getElementById('tk-chip');
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'tk-chip';
      document.body.appendChild(chip);
    }
    chip.textContent = label;
    chip.style.cssText = `background:${bgColor};color:${textColor};box-shadow:0 4px 14px ${shadowColor};`;
    chip.onclick = onClick;
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  async function mount(attempt) {
    if (document.getElementById('tk-chip')) return;
    injectStyles();

    const { seller, product, listingUrl } = isChat ? extractChat() : isMessenger ? extractMessenger() : extractListing();

    // Retry se DOM ainda não carregou o nome
    if (!seller && (attempt || 0) < 4) {
      return setTimeout(() => mount((attempt || 0) + 1), 600);
    }

    // Chip de loading enquanto consulta o banco
    setChip('⏳', '#e5e7eb', '#6b7280', 'rgba(0,0,0,.1)', null);

    let contact = null;
    try { contact = await findContact(seller); } catch (_) {}

    if (contact) {
      // Já registrado — mostra status atual
      const m = STATUS_META[contact.status] || STATUS_META.aguardando_retorno;
      setChip(
        m.label,
        m.bg, m.text,
        m.color + '66',
        () => openEditModal(contact, seller, product, listingUrl)
      );
    } else {
      // Não registrado
      setChip(
        '📌 Registrar',
        '#0066cc', '#fff', 'rgba(0,102,204,.4)',
        () => openRegModal(seller, product, listingUrl)
      );
    }
  }

  function unmount() { document.getElementById('tk-chip')?.remove(); }

  // SPA: re-monta quando conversa muda
  if (isChat) {
    let lastId = new URLSearchParams(location.search).get('chat-id');
    new MutationObserver(() => {
      const id = new URLSearchParams(location.search).get('chat-id');
      if (id !== lastId) { lastId = id; unmount(); setTimeout(() => mount(0), 900); }
    }).observe(document.body, { childList: true, subtree: true });
    setTimeout(() => mount(0), 900);
  } else if (isMessenger) {
    let lastPath = location.pathname;
    new MutationObserver(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        unmount();
        setTimeout(() => mount(0), 1200);
      }
    }).observe(document.body, { childList: true, subtree: true });
    setTimeout(() => mount(0), 1200);
  } else {
    mount(0);
  }

})();
