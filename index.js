require('dotenv').config();

const express = require('express');
const cors = require('cors');
const anunciosRouter = require('./routes/anuncios');
const uploadRouter = require('./routes/upload');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_KEY no .env');
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/anuncios', anunciosRouter);
app.use('/upload', uploadRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
