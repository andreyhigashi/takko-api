const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = (() => {
  const raw = process.env.TWILIO_WHATSAPP_FROM || '';
  return raw.startsWith('whatsapp:') ? raw : `whatsapp:${raw}`;
})();

async function sendMessage(to, body) {
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  return client.messages.create({ from: FROM, to: toFormatted, body });
}

module.exports = { sendMessage };
