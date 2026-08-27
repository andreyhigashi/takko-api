require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const anunciosRouter  = require('./routes/anuncios');
const uploadRouter    = require('./routes/upload');
const whatsappRouter  = require('./routes/whatsapp');
const { sendWhatsAppMessage } = require('./services/whatsappClient');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_KEY no .env');
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/sitemap.xml', async (req, res) => {
  const SITE = process.env.SITE_URL || 'https://takko-catch-clean.lovable.app';
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/anuncios?select=id,updated_at&status=in.(ativo,active,aprovado)&order=id.asc`,
      { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
    );
    const rows = await r.json();
    const urls = rows.map(row => {
      const lastmod = row.updated_at ? row.updated_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
      return `  <url><loc>${SITE}/anuncio/${row.id}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
    });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n${urls.join('\n')}\n</urlset>`;
    res.header('Content-Type', 'application/xml').send(xml);
  } catch (err) {
    res.status(500).send('sitemap error');
  }
});
app.use('/anuncios', anunciosRouter);
app.use('/upload', uploadRouter);
app.use('/webhook/whatsapp', whatsappRouter);

// ── links curtos para grupos WA (/r/:id/:grupo → anuncio com UTM) ──────────────
app.get('/r/:id/:grupo', (req, res) => {
  const SITE = process.env.SITE_URL || 'https://takko-catch-clean.lovable.app';
  const { id, grupo } = req.params;
  console.log(`[click] id=${id} grupo=${grupo} ts=${new Date().toISOString()}`);
  const url = `${SITE}/anuncio/${id}?utm_source=wa-grupos&utm_medium=grupo_${grupo}&utm_campaign=lista_carretilhas&utm_content=${id}`;
  res.redirect(301, url);
});

app.post('/admin/send-whatsapp', async (req, res) => {
  if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Não autorizado' });
  }
  const { to, body } = req.body;
  if (!to || !body) {
    return res.status(400).json({ success: false, message: 'Campos obrigatórios: to, body' });
  }
  try {
    await sendWhatsAppMessage(to, body);
    res.json({ success: true, message: `Mensagem enviada para ${to}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);

  // Mantém o servidor acordado no Render (plano gratuito dorme após 15min)
  setInterval(() => {
    http.get(`http://localhost:${PORT}/health`, (res) => {
      res.resume();
    }).on('error', () => {});
  }, 9 * 60 * 1000);
});
