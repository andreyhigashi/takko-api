const express = require('express');
const router = express.Router();
const { listarAnuncios, buscarAnuncio, criarAnuncio, editarAnuncio, deletarAnuncio, marcarVendido } = require('../controllers/anuncios');
const { requireAuth } = require('../middleware/auth');

router.get('/', listarAnuncios);
router.get('/:id', buscarAnuncio);
router.post('/', requireAuth, criarAnuncio);
router.patch('/:id', requireAuth, editarAnuncio);
router.patch('/:id/vendido', requireAuth, marcarVendido);
router.delete('/:id', requireAuth, deletarAnuncio);

module.exports = router;
