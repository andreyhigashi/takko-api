const supabase = require('../lib/supabase');

async function listarAnuncios(req, res) {
  const { busca, cidade, preco_min, preco_max } = req.query;

  let query = supabase
    .from('anuncios')
    .select('*')
    .order('id', { ascending: false });

  if (busca) query = query.ilike('titulo', `%${busca}%`);
  if (cidade) query = query.ilike('cidade', `%${cidade}%`);
  if (preco_min) query = query.gte('preco', Number(preco_min));
  if (preco_max) query = query.lte('preco', Number(preco_max));

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function buscarAnuncio(req, res) {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('anuncios')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return res.status(404).json({ error: 'Anúncio não encontrado' });
  res.json(data);
}

async function criarAnuncio(req, res) {
  const { titulo, preco, cidade, whatsapp } = req.body;

  if (!titulo || !preco || !cidade) {
    return res.status(400).json({ error: 'titulo, preco e cidade são obrigatórios' });
  }

  const { data, error } = await supabase
    .from('anuncios')
    .insert([{ titulo, preco, cidade, whatsapp, user_id: req.user.id }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
}

module.exports = { listarAnuncios, buscarAnuncio, criarAnuncio };
