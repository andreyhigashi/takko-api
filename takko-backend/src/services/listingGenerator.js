const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Twilio media URLs require basic auth — download and convert to base64 before sending to Claude.
async function fetchAsBase64(mediaUrl) {
  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString('base64');

  const response = await axios.get(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
    responseType: 'arraybuffer',
    timeout: 15000,
  });

  return {
    data: Buffer.from(response.data).toString('base64'),
    mediaType: (response.headers['content-type'] || 'image/jpeg').split(';')[0],
  };
}

async function generateListing(photoUrls, description) {
  const imageContents = await Promise.all(
    photoUrls.map(async (url) => {
      const { data, mediaType } = await fetchAsBase64(url);
      return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
    })
  );

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        ...imageContents,
        {
          type: 'text',
          text: `Você é especialista em equipamentos de pesca usados. Analise as fotos e o texto do vendedor e gere os dados do anúncio.

Texto do vendedor: "${description || 'Sem descrição adicional'}"

Responda APENAS com JSON válido, sem markdown:
{
  "titulo": "título conciso do produto (máx 60 chars)",
  "categoria": "Varas" | "Carretilhas" | "Iscas" | "Acessórios" | "Outros",
  "marca": "marca ou null",
  "modelo": "modelo ou null",
  "condicao": "Novo" | "Seminovo" | "Usado" | "Com defeito",
  "descricao": "2-3 linhas destacando características principais",
  "preco_sugerido": número em reais extraído do texto, ou null
}`,
        },
      ],
    }],
  });

  return JSON.parse(message.content[0].text.trim());
}

module.exports = { generateListing };
