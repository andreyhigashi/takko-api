const supabase = require('../lib/supabase');

async function uploadImagem(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  }

  const ext = req.file.originalname.split('.').pop();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from('imagens')
    .upload(filename, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false,
    });

  if (error) {
    console.error('[upload] storage error:', error.message, '| user:', req.user?.id, '| file:', filename);
    return res.status(500).json({ error: error.message });
  }

  const { data } = supabase.storage.from('imagens').getPublicUrl(filename);
  console.log('[upload] ok:', filename, '| user:', req.user?.id);
  res.status(201).json({ url: data.publicUrl });
}

module.exports = { uploadImagem };
