const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const anunciosPath = path.join(__dirname, 'anuncios.json');

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

function carregarAnuncios() {
  if (!fs.existsSync(anunciosPath)) {
    return [];
  }

  try {
    const conteudo = fs.readFileSync(anunciosPath, 'utf8');
    const dados = JSON.parse(conteudo);
    if (Array.isArray(dados)) {
      const { anunciosNormalizados, alterado } = atribuirIdsAusentes(dados);
      if (alterado) {
        salvarAnuncios(anunciosNormalizados);
      }
      return anunciosNormalizados;
    }

    return [];
  } catch (error) {
    console.error('Erro ao carregar anuncios.json:', error.message);
    return [];
  }
}

function salvarAnuncios(anuncios) {
  fs.writeFileSync(anunciosPath, JSON.stringify(anuncios, null, 2), 'utf8');
}

function obterProximoId(anuncios) {
  const maiorId = anuncios.reduce((maior, anuncio) => {
    return Number.isInteger(anuncio.id) && anuncio.id > maior ? anuncio.id : maior;
  }, 0);

  return maiorId + 1;
}

function atribuirIdsAusentes(anuncios) {
  let proximoId = obterProximoId(anuncios);
  let alterado = false;

  const anunciosNormalizados = anuncios.map((anuncio) => {
    if (Number.isInteger(anuncio.id)) {
      return anuncio;
    }

    alterado = true;
    return {
      id: proximoId++,
      ...anuncio,
    };
  });

  return { anunciosNormalizados, alterado };
}

let anuncios = carregarAnuncios();

// GET
app.get('/anuncios', (req, res) => {
  res.json(anuncios);
});

app.get('/anuncios/:id', (req, res) => {
  const id = Number(req.params.id);
  const anuncio = anuncios.find((item) => item.id === id);

  if (!anuncio) {
    return res.status(404).json({ error: 'Anuncio nao encontrado' });
  }

  res.json(anuncio);
});

// POST
app.post('/anuncios', (req, res) => {
  const { titulo, preco, cidade } = req.body;

  const novoAnuncio = {
    id: obterProximoId(anuncios),
    titulo,
    preco,
    cidade,
  };

  anuncios.push(novoAnuncio);
  salvarAnuncios(anuncios);

  res.json({ message: "ok" });
});

app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});
