'use strict';
const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

function markUploaded(whatsapp, pasta, takkoId) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  for (const [convId, v] of Object.entries(state)) {
    if (v && v.whatsapp === whatsapp && v.imported === pasta) {
      state[convId].uploaded = true;
      state[convId].updatedAt = new Date().toISOString();
      if (takkoId != null) state[convId].takkoId = takkoId;
    }
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

const SUPABASE_URL = 'https://azvdbthnwbhtfwffmnni.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dmRidGhud2JodGZ3ZmZtbm5pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg5NjQ4OSwiZXhwIjoyMDkyNDcyNDg5fQ.ic2aWAPubW9oOrTvS8Fd98pB_dmAfFcIRN9Qq1eTrLs';
const BUCKET       = 'imagens';
const BASE         = path.join(__dirname, '..', 'Dados para upload');

const ITENS = [
  { pasta: '19995109842_Vara Hammer + Carretilha Torment 200', titulo: 'Vara Hammer 2,40 + Carretilha Torment 200', preco: 750, cidade: "Santa Bárbara d'Oeste", whatsapp: '19995109842', descricao: 'Vara Hammer 2,40 25-50lb. Carretilha Torment 200. Aceito propostas.' },
];

async function uploadFoto(filePath, idx) {
  const buf  = fs.readFileSync(filePath);
  const slug = `${Date.now()}-${idx}.jpg`;
  const res  = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${slug}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'image/jpeg',
    },
    body: buf,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Upload falhou (${res.status}): ${txt}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${slug}`;
}

async function inserirAnuncio(item, urls) {
  const body = {
    titulo:     item.titulo,
    preco:      item.preco,
    cidade:     item.cidade,
    whatsapp:   item.whatsapp,
    descricao:  item.descricao,
    imagens:    urls,
    status:     'aprovado',
    source_url: item.source_url || null,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/anuncios`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey':        SERVICE_KEY,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Insert falhou (${res.status}): ${txt}`);
  }
  const data = await res.json();
  return data[0]?.id;
}

(async () => {
  for (const item of ITENS) {
    console.log(`\n▶ ${item.titulo}`);
    const folderPath = path.join(BASE, item.pasta);
    const fotos = fs.readdirSync(folderPath)
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .sort()
      .slice(0, 5);

    if (fotos.length === 0) {
      console.log('  ⚠️  Nenhuma foto encontrada — pulando');
      continue;
    }

    const urls = [];
    for (let i = 0; i < fotos.length; i++) {
      process.stdout.write(`  📸 Foto ${i+1}/${fotos.length}... `);
      const url = await uploadFoto(path.join(folderPath, fotos[i]), i);
      urls.push(url);
      console.log('✅');
    }

    const id = await inserirAnuncio(item, urls);
    console.log(`  ✅ Anúncio criado — ID ${id}`);
    markUploaded(item.whatsapp, item.pasta, id);
  }
  console.log('\n🎣 Concluído!');
})().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
