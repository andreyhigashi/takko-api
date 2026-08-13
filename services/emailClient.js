'use strict';

const https = require('https');

const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || 'andreyhigashi@gmail.com';

async function sendDraftNotification({ id, titulo, preco, cidade, sellerPhone }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY não configurado — email ignorado');
    return;
  }

  const precoFmt = `R$ ${Number(preco).toLocaleString('pt-BR')}`;
  const botNumber = (process.env.TWILIO_WHATSAPP_FROM || '').replace(/\D/g, '');

  const html = `
    <div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#0066cc">🔔 Novo anúncio para revisar (#${id})</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px 0;color:#888;width:80px">Título</td><td><strong>${titulo}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#888">Preço</td><td>${precoFmt}</td></tr>
        <tr><td style="padding:6px 0;color:#888">Cidade</td><td>${cidade || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#888">Seller</td><td>${sellerPhone}</td></tr>
      </table>
      <hr style="margin:20px 0;border:none;border-top:1px solid #eee">
      <p style="color:#444;margin-bottom:8px">Envie para o bot WhatsApp <strong>+${botNumber}</strong>:</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr><td style="padding:4px 0;color:#888;width:140px">Publicar</td><td><code>${id} ok</code></td></tr>
        <tr><td style="padding:4px 0;color:#888">Corrigir título</td><td><code>${id} titulo: Novo Título</code></td></tr>
        <tr><td style="padding:4px 0;color:#888">Corrigir preço</td><td><code>${id} preço: 500</code></td></tr>
        <tr><td style="padding:4px 0;color:#888">Corrigir cidade</td><td><code>${id} cidade: São Paulo</code></td></tr>
      </table>
    </div>
  `;

  const payload = JSON.stringify({
    from: 'Takko Fishing <onboarding@resend.dev>',
    to: [OPERATOR_EMAIL],
    subject: `🔔 Novo anúncio para revisar (#${id}) — ${titulo}`,
    html,
  });

  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`Resend HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  console.log(`[email] notificação enviada para ${OPERATOR_EMAIL} — anúncio #${id}`);
}

module.exports = { sendDraftNotification };
