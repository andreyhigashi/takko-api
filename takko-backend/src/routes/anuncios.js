const express = require('express')
const router = express.Router()
const supabase = require('../supabase')

// ─────────────────────────────────────────
// GET /anuncios
// Lista todos os anúncios aprovados
// ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { categoria, condicao, estado_uf, preco_min, preco_max, busca, whatsapp } = req.query

    let query = supabase
      .from('anuncios')
      .select('*')
      .in('status', ['aprovado', 'vendido'])
      .order('created_at', { ascending: false })

    if (categoria) query = query.eq('categoria', categoria)
    if (condicao) query = query.eq('condicao', condicao)
    if (estado_uf) query = query.eq('estado_uf', estado_uf)
    if (preco_min) query = query.gte('preco', parseFloat(preco_min))
    if (preco_max) query = query.lte('preco', parseFloat(preco_max))
    if (busca) query = query.ilike('titulo', `%${busca}%`)
    if (whatsapp) query = query.eq('whatsapp', whatsapp)

    const { data, error } = await query

    if (error) throw error

    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ─────────────────────────────────────────
// GET /anuncios/:id
// Detalhe de um anúncio
// ─────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('anuncios')
      .select('*')
      .eq('id', req.params.id)
      .in('status', ['aprovado', 'vendido'])
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Anúncio não encontrado' })

    res.json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// ─────────────────────────────────────────
// POST /anuncios
// Vendedor submete novo anúncio
// ─────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      nome_vendedor,
      whatsapp,
      titulo,
      categoria,
      marca,
      modelo,
      condicao,
      defeitos,
      descricao,
      preco,
      cidade,
      estado_uf,
      fotos
    } = req.body

    // Validação dos campos obrigatórios
    const camposObrigatorios = { nome_vendedor, whatsapp, titulo, categoria, condicao, preco, cidade, estado_uf }
    const faltando = Object.entries(camposObrigatorios)
      .filter(([_, v]) => !v)
      .map(([k]) => k)

    if (faltando.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Campos obrigatórios faltando: ${faltando.join(', ')}`
      })
    }

    if (!fotos || fotos.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Pelo menos uma foto é obrigatória'
      })
    }

    const { data, error } = await supabase
      .from('anuncios')
      .insert([{
        nome_vendedor,
        whatsapp,
        titulo,
        categoria,
        marca,
        modelo,
        condicao,
        defeitos,
        descricao,
        preco: parseFloat(preco),
        cidade,
        estado_uf,
        fotos,
        status: 'pendente',
        imagem_instagram: null
      }])
      .select()
      .single()

    if (error) throw error

    res.status(201).json({
      success: true,
      message: 'Anúncio enviado com sucesso! Será publicado após aprovação.',
      data
    })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

module.exports = router
