// ============================================================
// Takko Fishing — Agente de Estratégia (Google Apps Script)
// Deploy como Web App: Execute as "Me", Access: "Anyone"
// ============================================================

var SUPABASE_URL = 'https://azvdbthnwbhtfwffmnni.supabase.co';
var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dmRidGhud2JodGZ3ZmZtbm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4OTY0ODksImV4cCI6MjA5MjQ3MjQ4OX0.FY4q5EEjCnWJvdWbUU5osVtDS5Tf0BoUfDuCPXeC7Cc';
var TZ = 'America/Sao_Paulo';

var ETAPAS_FUNIL = [
  'LandingVisit',
  'CTA_Click',
  'SignupStarted',
  'SignupCompleted',
  'ListingStarted',
  'ListingPublished'
];

function doGet(e) {
  try {
    var resultado = gerarDadosEstrategia();
    return ContentService
      .createTextOutput(JSON.stringify(resultado))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ erro: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function gerarDadosEstrategia() {
  var agora = new Date();
  var seteDiasAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  var trintaDiasAtras = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);

  // 1. Eventos dos últimos 30 dias (para tendência)
  var eventosFunil = ETAPAS_FUNIL.join(',');
  var urlEventos30 = SUPABASE_URL + '/rest/v1/analytics_events'
    + '?event_name=in.(' + eventosFunil + ')'
    + '&created_at=gte.' + encodeURIComponent(trintaDiasAtras.toISOString())
    + '&select=event_name,created_at'
    + '&order=created_at.asc'
    + '&limit=50000';

  var respEventos = UrlFetchApp.fetch(urlEventos30, {
    headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
  });
  var todosEventos = JSON.parse(respEventos.getContentText());

  // 2. Separar em 7 dias (atual) e 8-30 dias (anterior)
  var dataCorte7 = seteDiasAtras.getTime();

  var totais7 = {};
  var totaisAnterior = {};
  ETAPAS_FUNIL.forEach(function(e) {
    totais7[e] = 0;
    totaisAnterior[e] = 0;
  });

  todosEventos.forEach(function(ev) {
    var ts = new Date(ev.created_at).getTime();
    var etapa = ev.event_name;
    if (ETAPAS_FUNIL.indexOf(etapa) === -1) return;
    if (ts >= dataCorte7) {
      totais7[etapa]++;
    } else {
      totaisAnterior[etapa]++;
    }
  });

  // Normalizar período anterior para 7 dias (era 23 dias → /23*7)
  var totaisAnt7 = {};
  ETAPAS_FUNIL.forEach(function(e) {
    totaisAnt7[e] = Math.round(totaisAnterior[e] / 23 * 7);
  });

  // 3. Tendências percentuais (semana atual vs semana anterior normalizada)
  var tendencias = {};
  ETAPAS_FUNIL.forEach(function(e) {
    var ant = totaisAnt7[e];
    var atual = totais7[e];
    if (ant > 0) {
      tendencias[e] = Math.round(((atual - ant) / ant) * 100);
    } else {
      tendencias[e] = atual > 0 ? 100 : 0;
    }
  });

  // 4. Funil por semana dos últimos 30 dias (4 semanas)
  var semanas = [];
  for (var s = 3; s >= 0; s--) {
    var inicio = new Date(agora.getTime() - (s + 1) * 7 * 24 * 60 * 60 * 1000);
    var fim = new Date(agora.getTime() - s * 7 * 24 * 60 * 60 * 1000);
    semanas.push({
      label: 'S-' + s,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      totais: {}
    });
    ETAPAS_FUNIL.forEach(function(e) { semanas[semanas.length - 1].totais[e] = 0; });
  }

  todosEventos.forEach(function(ev) {
    var ts = new Date(ev.created_at).getTime();
    semanas.forEach(function(sem) {
      if (ts >= new Date(sem.inicio).getTime() && ts < new Date(sem.fim).getTime()) {
        if (sem.totais[ev.event_name] !== undefined) {
          sem.totais[ev.event_name]++;
        }
      }
    });
  });

  // 5. Total de anúncios ativos
  var urlTotal = SUPABASE_URL + '/rest/v1/anuncios'
    + '?status=eq.ativo&select=id&limit=1';

  var totalAnuncios = 0;
  try {
    var respTotal = UrlFetchApp.fetch(urlTotal, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY,
        'Prefer': 'count=exact',
        'Range': '0-0'
      }
    });
    var cr = respTotal.getHeaders()['Content-Range'] || respTotal.getHeaders()['content-range'] || '';
    var m = cr.match(/\/(\d+)/);
    if (m) totalAnuncios = parseInt(m[1]);
  } catch (err) {}

  // 6. Anúncios novos por semana
  var anunciosPorSemana = semanas.map(function(sem) {
    var urlAnuncios = SUPABASE_URL + '/rest/v1/anuncios'
      + '?status=eq.ativo'
      + '&created_at=gte.' + encodeURIComponent(sem.inicio)
      + '&created_at=lt.' + encodeURIComponent(sem.fim)
      + '&select=id';
    try {
      var resp = UrlFetchApp.fetch(urlAnuncios, {
        headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
      });
      return { semana: sem.label, count: JSON.parse(resp.getContentText()).length };
    } catch (e) {
      return { semana: sem.label, count: 0 };
    }
  });

  // 7. Instagram 7 dias
  var igCount = 0;
  try {
    var urlIg = SUPABASE_URL + '/rest/v1/analytics_events'
      + '?event_name=eq.LandingVisit&utm_source=eq.instagram'
      + '&created_at=gte=' + encodeURIComponent(seteDiasAtras.toISOString())
      + '&select=id';
    var respIg = UrlFetchApp.fetch(urlIg, {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    });
    igCount = JSON.parse(respIg.getContentText()).length;
  } catch (err) {}

  // 8. Conversões da semana atual
  var conv = function(num, den) {
    return den > 0 ? ((num / den) * 100).toFixed(1) + '%' : '—';
  };
  var conversoes7 = {
    'M3→P2 (Sessão→CTA)': conv(totais7['CTA_Click'], totais7['LandingVisit']),
    'P3→P4 (Cadastro iniciado→completo)': conv(totais7['SignupCompleted'], totais7['SignupStarted']),
    'P5→P6 (Anúncio iniciado→publicado)': conv(totais7['ListingPublished'], totais7['ListingStarted']),
    'M3→P6 (Sessão→Publicação)': conv(totais7['ListingPublished'], totais7['LandingVisit'])
  };

  return {
    data: Utilities.formatDate(agora, TZ, 'dd/MM/yyyy HH:mm'),
    periodo7: 'Últimos 7 dias',
    periodo30: 'Últimos 30 dias',
    totais7: totais7,
    totaisAnt7: totaisAnt7,
    tendencias: tendencias,
    conversoes7: conversoes7,
    semanas: semanas,
    anunciosPorSemana: anunciosPorSemana,
    totalAnuncios: totalAnuncios,
    instagramCliques7: igCount,
    etapas: ETAPAS_FUNIL
  };
}
