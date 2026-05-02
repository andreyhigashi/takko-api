const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadImagem } = require('../controllers/upload');
const { requireAuth } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Apenas imagens são permitidas'));
  },
});

router.post('/', requireAuth, upload.single('imagem'), uploadImagem);

module.exports = router;
