const express = require('express');
const router = express.Router();
const { listarAnuncios, buscarAnuncio, criarAnuncio } = require('../controllers/anuncios');
const { requireAuth } = require('../middleware/auth');

router.get('/', listarAnuncios);
router.get('/:id', buscarAnuncio);
router.post('/', requireAuth, criarAnuncio);

module.exports = router;
