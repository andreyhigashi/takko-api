const axios = require('axios');

const ENDPOINT = `${process.env.SUPABASE_URL}/functions/v1/track`;

// Writes an analytics event to Supabase via the same Edge Function the frontend uses.
// phone is used to derive a stable session_id so all events from the same WA user correlate.
async function trackEvent(eventName, phone, extraParams = {}) {
  const sessionId = `wa_${phone.replace(/\D/g, '')}`;
  try {
    await axios.post(
      ENDPOINT,
      {
        client_id: sessionId,
        session_id: sessionId,
        user_id: null,
        referrer: null,
        user_agent: 'twilio-concierge/1.0',
        utm: { source: 'whatsapp', medium: 'concierge' },
        events: [{
          name: eventName,
          params: {
            page_location: 'whatsapp://concierge',
            page_title: 'WhatsApp Concierge',
            ...extraParams,
          },
        }],
      },
      { timeout: 5000 }
    );
  } catch (err) {
    console.error(`[trackEvent] ${eventName}:`, err.message);
  }
}

module.exports = { trackEvent };
