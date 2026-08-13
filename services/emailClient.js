'use strict';

const nodemailer = require('nodemailer');

const OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || 'andreyhigashi@gmail.com';

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendDraftNotification({ id, titulo, preco, cidade, sellerPhone }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[email] SMTP_USER ou SMTP_PASS não configurado — email ignorado');
    return;
  }

  const precoFmt = `R$ ${Number(preco).toLocaleString('pt-BR')}`;
  const botNumber = (process.env.TWILIO_WHATSAPP_FROM || '').replace(/\D/g, '');

  const text = [
    `Novo anúncio aguardando aprovação (#${id})`,
    ``,
    `Título:  ${titulo}`,
    `Preço:   ${precoFmt}`,
    `Cidade:  ${cidade || '—'}`,
    `Seller:  ${sellerPhone}`,
    ``,
    `── Comandos para aprovar/corrigir ──`,
    `Mande para o bot (+${botNumber}):`,
    ``,
    `Publicar:        ${id} ok`,
    `Corrigir título: ${id} titulo: Novo Título`,
    `Corrigir preço:  ${id} preço: 500`,
    `Corrigir cidade: ${id} cidade: São Paulo`,
  ].join('\n');

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

  await createTransport().sendMail({
    from: `Takko Fishing <${process.env.SMTP_USER}>`,
    to: OPERATOR_EMAIL,
    subject: `🔔 Novo anúncio para revisar (#${id}) — ${titulo}`,
    text,
    html,
  });

  console.log(`[email] notificação enviada para ${OPERATOR_EMAIL} — anúncio #${id}`);
}

module.exports = { sendDraftNotification };
