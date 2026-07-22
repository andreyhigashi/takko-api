// ============================================================
// Takko Fishing — Agente de Marketing (Google Apps Script)
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
    var resultado = gerarDadosMarketing();
    return ContentService
      .createTextOutput(JSON.stringify(resultado))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ erro: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function gerarDadosMarketing() {
  var agora = new Date();
  var seteDiasAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  var dataStr = seteDiasAtras.toISOString();

  // 1. Buscar eventos do funil (últimos 7 dias)
  var eventosFunil = ETAPAS_FUNIL.join(',');
  var urlEventos = SUPABASE_URL + '/rest/v1/analytics_events'
    + '?event_name=in.(' + eventosFunil + ')'
    + '&created_at=gte.' + encodeURIComponent(dataStr)
    + '&select=event_name,created_at'
    + '&order=created_at.asc'
    + '&limit=10000';

  var respEventos = UrlFetchApp.fetch(urlEventos, {
    headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
  });
  var eventos = JSON.parse(respEventos.getContentText());

  // 2. Buscar cliques do Instagram (utm_source=instagram)
  var urlIg = SUPABASE_URL + '/rest/v1/analytics_events'
    + '?event_name=eq.LandingVisit'
    + '&utm_source=eq.instagram'
    + '&created_at=gte.' + encodeURIComponent(dataStr)
    + '&select=id,created_at';

  var igCount = 0;
  try {
    var respIg = UrlFetchApp.fetch(urlIg, {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    });
    igCount = JSON.parse(respIg.getContentText()).length;
  } catch (err) {}

  // 3. Anúncios novos (últimos 7 dias, status=ativo)
  var urlAnunciosRec = SUPABASE_URL + '/rest/v1/anuncios'
    + '?status=eq.ativo'
    + '&created_at=gte.' + encodeURIComponent(dataStr)
    + '&select=id';

  var anunciosRecentes = 0;
  try {
    var respRec = UrlFetchApp.fetch(urlAnunciosRec, {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    });
    anunciosRecentes = JSON.parse(respRec.getContentText()).length;
  } catch (err) {}

  // 4. Total de anúncios ativos
  var urlTotal = SUPABASE_URL + '/rest/v1/anuncios'
    + '?status=eq.ativo'
    + '&select=id'
    + '&limit=1';

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
    var contentRange = respTotal.getHeaders()['Content-Range'] || respTotal.getHeaders()['content-range'] || '';
    var match = contentRange.match(/\/(\d+)/);
    if (match) totalAnuncios = parseInt(match[1]);
  } catch (err) {}

  // 5. Processar funil por dia (BRT)
  var dias = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(agora.getTime() - i * 24 * 60 * 60 * 1000);
    dias.push(Utilities.formatDate(d, TZ, 'yyyy-MM-dd'));
  }

  var byDay = {};
  dias.forEach(function(dia) {
    byDay[dia] = {};
    ETAPAS_FUNIL.forEach(function(e) { byDay[dia][e] = 0; });
  });

  eventos.forEach(function(ev) {
    var dia = Utilities.formatDate(new Date(ev.created_at), TZ, 'yyyy-MM-dd');
    if (byDay[dia] && byDay[dia][ev.event_name] !== undefined) {
      byDay[dia][ev.event_name]++;
    }
  });

  // 6. Totais do período
  var totals = {};
  ETAPAS_FUNIL.forEach(function(e) { totals[e] = 0; });
  dias.forEach(function(dia) {
    ETAPAS_FUNIL.forEach(function(e) {
      totals[e] += byDay[dia][e] || 0;
    });
  });

  // 7. Detectar anomalias (>= 30% variação vs dia anterior)
  var anomalias = [];
  for (var i = 1; i < dias.length; i++) {
    ETAPAS_FUNIL.forEach(function(etapa) {
      var hoje = byDay[dias[i]][etapa] || 0;
      var ontem = byDay[dias[i - 1]][etapa] || 0;
      if (ontem > 0) {
        var delta = Math.round(((hoje - ontem) / ontem) * 100);
        if (Math.abs(delta) >= 30) {
          anomalias.push({
            etapa: etapa,
            dia: dias[i],
            delta: delta,
            direcao: delta > 0 ? '▲' : '▼',
            hoje: hoje,
            ontem: ontem
          });
        }
      }
    });
  }

  // 8. Calcular conversões do período
  var convM3P2 = totals['LandingVisit'] > 0
    ? ((totals['CTA_Click'] / totals['LandingVisit']) * 100).toFixed(1)
    : '0';
  var convP3P4 = totals['SignupStarted'] > 0
    ? ((totals['SignupCompleted'] / totals['SignupStarted']) * 100).toFixed(1)
    : '0';
  var convP5P6 = totals['ListingStarted'] > 0
    ? ((totals['ListingPublished'] / totals['ListingStarted']) * 100).toFixed(1)
    : '0';

  return {
    data: Utilities.formatDate(agora, TZ, 'dd/MM/yyyy HH:mm'),
    periodo: 'Últimos 7 dias',
    dias: dias,
    byDay: byDay,
    totals: totals,
    conversoes: {
      'LandingVisit→CTA_Click': convM3P2 + '%',
      'SignupStarted→SignupCompleted': convP3P4 + '%',
      'ListingStarted→ListingPublished': convP5P6 + '%'
    },
    instagram: {
      cliques: igCount,
      anunciosRecentes: anunciosRecentes
    },
    totalAnuncios: totalAnuncios,
    anomalias: anomalias,
    etapas: ETAPAS_FUNIL
  };
}
