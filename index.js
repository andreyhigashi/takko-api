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
app.use('/anuncios', anunciosRouter);
app.use('/upload', uploadRouter);
app.use('/webhook/whatsapp', whatsappRouter);

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
