require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// 🔑 Variáveis de ambiente
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_ANON_KEY no .env');
}

// 🔌 Cliente Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

// 🟢 GET - listar anúncios
app.get('/anuncios', async (req, res) => {
  const { data, error } = await supabase
    .from('anuncios')
    .select('*')
    .order('id', { ascending: false });

  if (error) {
    console.log("SUPABASE SELECT ERROR:", error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// 🟢 POST - criar anúncio
app.post('/anuncios', async (req, res) => {
  console.log("BODY:", req.body);
  const { titulo, preco, cidade, whatsapp } = req.body;

  // validação básica
  if (!titulo || !preco || !cidade) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  const { data, error } = await supabase
    .from('anuncios')
    .insert([{ titulo, preco, cidade, whatsapp }])
    .select();

  if (error) {
    console.log("SUPABASE INSERT ERROR:", error);
    return res.status(500).json({ error: error.message });
  }

  res.json(data[0]);
});

// 🚀 iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});