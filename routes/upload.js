const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadImagem } = require('../controllers/upload');
const { requireAuth } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Apenas imagens são permitidas'));
  },
});

function handleUpload(req, res, next) {
  upload.single('imagem')(req, res, (err) => {
    if (err) {
      console.error('[upload] multer error:', err.code, err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Imagem muito grande (máx 10 MB)' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

router.post('/', requireAuth, handleUpload, uploadImagem);

module.exports = router;
