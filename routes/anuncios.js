const express = require('express');
const router = express.Router();
const { listarAnuncios, buscarAnuncio, criarAnuncio, deletarAnuncio } = require('../controllers/anuncios');
const { requireAuth } = require('../middleware/auth');

router.get('/', listarAnuncios);
router.get('/:id', buscarAnuncio);
router.post('/', requireAuth, criarAnuncio);
router.delete('/:id', requireAuth, deletarAnuncio);

module.exports = router;
