require('dotenv').config()
const express = require('express')
const cors = require('cors')

const anunciosRoutes = require('./routes/anuncios')
const adminRoutes = require('./routes/admin')

const app = express()
const PORT = process.env.PORT || 3000

// ─────────────────────────────────────────
// Middlewares
// ─────────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ─────────────────────────────────────────
// Rotas
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🎣 Takko Fishing API está rodando!',
    versao: '1.0.0',
    endpoints: {
      publicos: [
        'GET  /anuncios',
        'GET  /anuncios/:id',
        'POST /anuncios'
      ],
      admin: [
        'GET  /admin/anuncios',
        'GET  /admin/anuncios?status=pendente',
        'PUT  /admin/anuncios/:id/aprovar',
        'PUT  /admin/anuncios/:id/recusar',
        'PUT  /admin/anuncios/:id/pausar',
        'DELETE /admin/anuncios/:id'
      ]
    }
  })
})

app.use('/anuncios', anunciosRoutes)
app.use('/admin', adminRoutes)

// ─────────────────────────────────────────
// POST /upload
// Recebe { base64, filename } e salva no Supabase Storage
// ─────────────────────────────────────────
const supabase = require('./supabase')
const { v4: uuidv4 } = require('uuid')

app.post('/upload', async (req, res) => {
  try {
    const { base64, filename } = req.body
    if (!base64) return res.status(400).json({ success: false, message: 'base64 obrigatório' })

    const ext = (filename || 'foto.jpg').split('.').pop() || 'jpg'
    const storagePath = `${uuidv4().slice(0, 8)}-1.${ext}`
    const buffer = Buffer.from(base64, 'base64')

    const { error } = await supabase.storage
      .from('imagens')
      .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: false })

    if (error) throw error

    const { data: { publicUrl } } = supabase.storage
      .from('imagens')
      .getPublicUrl(storagePath)

    res.json({ success: true, url: publicUrl })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ─────────────────────────────────────────
// 404 handler
// ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Rota não encontrada' })
})

// ─────────────────────────────────────────
// Error handler
// ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ success: false, message: 'Erro interno do servidor' })
})

// ─────────────────────────────────────────
// Inicia o servidor
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎣 Takko Fishing API rodando na porta ${PORT}`)
  console.log(`📡 Acesse: http://localhost:${PORT}`)
})
