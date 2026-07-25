'use strict';

const axios = require('axios');

const SID  = () => process.env.TWILIO_ACCOUNT_SID;
const AUTH = () => process.env.TWILIO_AUTH_TOKEN;
const FROM = () => process.env.TWILIO_WHATSAPP_FROM; // ex: +14155238886

async function sendWhatsAppMessage(to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID()}/Messages.json`;

  await axios.post(
    url,
    new URLSearchParams({
      From: `whatsapp:${FROM()}`,
      To:   `whatsapp:${to}`,
      Body: body,
    }).toString(),
    {
      auth: { username: SID(), password: AUTH() },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );
}

module.exports = { sendWhatsAppMessage };
