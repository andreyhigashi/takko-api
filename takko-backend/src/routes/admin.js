const express = require('express')
const router = express.Router()
const supabase = require('../supabase')
const { gerarImagemInstagram } = require('../services/hcti')

// ─────────────────────────────────────────
// Middleware de autenticação do admin
// ─────────────────────────────────────────
function adminAuth(req, res, next) {
  const senha = req.headers['x-admin-password']
  if (senha !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Não autorizado' })
  }
  next()
}

// ─────────────────────────────────────────
// GET /admin/anuncios
// Lista todos os anúncios (todas as situações)
// ─────────────────────────────────────────
router.get('/anuncios', adminAuth, async (req, res) => {
  try {
    const { status } = req.query

    let query = supabase
      .from('anuncios')
      .select('*')
      .order('created_at', { ascending: false })

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error

    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ─────────────────────────────────────────
// GET /admin/anuncios/reportados
// Lista anúncios com reports de "item vendido", ordenados por mais reports
// ─────────────────────────────────────────
router.get('/anuncios/reportados', adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('anuncios')
      .select('id, titulo, status, preco, whatsapp, reportes_vendido, created_at')
      .gt('reportes_vendido', 0)
      .neq('status', 'vendido')
      .order('reportes_vendido', { ascending: false })

    if (error) throw error

    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ─────────────────────────────────────────
// PUT /admin/anuncios/:id/aprovar
// Aprova anúncio e gera imagem Instagram
// ─────────────────────────────────────────
router.put('/anuncios/:id/aprovar', adminAuth, async (req, res) => {
  try {
    // Busca o anúncio
    const { data: anuncio, error: fetchError } = await supabase
      .from('anuncios')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (fetchError) throw fetchError
    if (!anuncio) return res.status(404).json({ success: false, message: 'Anúncio não encontrado' })

    // Gera imagem do Instagram via htmlcsstoimage
    let imagem_instagram = null
    try {
      imagem_instagram = await gerarImagemInstagram(anuncio)
    } catch (imgError) {
      console.error('Erro ao gerar imagem:', imgError.message)
      // Continua mesmo se falhar — aprova sem imagem
    }

    // Atualiza status para aprovado
    const { data, error } = await supabase
      .from('anuncios')
      .update({ status: 'aprovado', imagem_instagram })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    res.json({
      success: true,
      message: 'Anúncio aprovado com sucesso!',
      data,
      imagem_instagram
    })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ─────────────────────────────────────────
// PUT /admin/anuncios/:id/recusar
// Recusa anúncio
// ─────────────────────────────────────────
router.put('/anuncios/:id/recusar', adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('anuncios')
      .update({ status: 'recusado' })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    res.json({ success: true, message: 'Anúncio recusado.', data })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ─────────────────────────────────────────
// PUT /admin/anuncios/:id/pausar
// Pausa anúncio aprovado
// ─────────────────────────────────────────
router.put('/anuncios/:id/pausar', adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('anuncios')
      .update({ status: 'pausado' })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    res.json({ success: true, message: 'Anúncio pausado.', data })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ─────────────────────────────────────────
// PUT /admin/anuncios/:id/vendido
// Marca anúncio como vendido
// ─────────────────────────────────────────
router.put('/anuncios/:id/vendido', adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('anuncios')
      .update({ status: 'vendido' })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    res.json({ success: true, message: 'Anúncio marcado como vendido.', data })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ─────────────────────────────────────────
// DELETE /admin/anuncios/:id
// Remove anúncio permanentemente
// ─────────────────────────────────────────
router.delete('/anuncios/:id', adminAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('anuncios')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error

    res.json({ success: true, message: 'Anúncio removido.' })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

module.exports = router
