'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const supabase = require('../lib/supabase');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é um assistente que gera anúncios para a Takko Fishing, um marketplace de equipamentos de pesca usados no Brasil.

Analise as imagens e/ou a descrição do vendedor e retorne um JSON com o anúncio pronto.

Responda APENAS com JSON válido, sem markdown, sem código de bloco, sem explicação extra:
{
  "titulo": "Título curto e descritivo (máx 80 chars). Use: Marca + Modelo + condição, ex: Carretilha Shimano Curado DC Usada",
  "descricao": "Descrição em 2-3 parágrafos: produto, estado de conservação, o que está incluso no kit (se houver)",
  "categoria": um de: "Carretilhas" | "Varas" | "Iscas" | "Acessórios" | "Outros",
  "preco": número inteiro em reais extraído da mensagem, ou null se não mencionado,
  "cidade": "Cidade extraída da mensagem" ou null
}

Regras:
- Se a marca/modelo for visível nas fotos ou na mensagem, inclua no título
- Mencione o estado de conservação (novo/seminovo/usado/com defeito) na descrição
- Extraia o preço da mensagem do vendedor se mencionado
- Responda em português do Brasil`;

async function downloadToSupabase(url, twilioUser, twilioPass) {
  const config = { responseType: 'arraybuffer' };
  if (twilioUser && twilioPass) {
    config.auth = { username: twilioUser, password: twilioPass };
  }
  const response = await axios.get(url, config);
  const buffer = Buffer.from(response.data);
  const contentType = response.headers['content-type'] || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const fileName = `concierge/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from('imagens')
    .upload(fileName, buffer, { contentType, upsert: false });

  if (error) throw new Error(`Supabase upload: ${error.message}`);

  const { data: pub } = supabase.storage.from('imagens').getPublicUrl(fileName);
  return { publicUrl: pub.publicUrl, base64: buffer.toString('base64'), mediaType: contentType };
}

async function generateListing({ text = '', imageUrls = [], twilioAuth = {} }) {
  const imageContents = [];
  const storedUrls = [];

  for (const url of imageUrls.slice(0, 4)) {
    try {
      const { publicUrl, base64, mediaType } = await downloadToSupabase(
        url, twilioAuth.user, twilioAuth.pass
      );
      storedUrls.push(publicUrl);
      imageContents.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64 },
      });
    } catch (e) {
      console.error('[listingGenerator] erro ao baixar/salvar imagem:', e.message);
    }
  }

  const promptText = text
    ? `Mensagem do vendedor: "${text}"\n\nAnalise as imagens e a mensagem e gere o JSON do anúncio.`
    : 'Analise as imagens e gere o JSON do anúncio.';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [...imageContents, { type: 'text', text: promptText }],
      },
    ],
  });

  const raw = response.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Resposta do Claude sem JSON: ${raw.slice(0, 200)}`);
  const listing = JSON.parse(jsonMatch[0]);
  return { ...listing, imagens: storedUrls };
}

module.exports = { generateListing };
