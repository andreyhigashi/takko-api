const { format } = require('date-fns')
const { toZonedTime } = require('date-fns-tz')

const TZ = 'America/Sao_Paulo'

function formatDia(diaStr) {
  const [y, m, d] = diaStr.split('-')
  return `${d}/${m}`
}

function convBadge(val) {
  if (val === null) return '<span class="na">—</span>'
  const n = parseFloat(val)
  const cls = n >= 8 ? 'hi' : n >= 2 ? 'warn' : 'danger'
  return `<span class="${cls}">${val}%</span>`
}

function gerarHTMLMarketing({ dias, byDay, totals, anomalias, instagramClicks, anunciosAprovados, totalAnuncios, insights, dataGeracao }) {
  const ETAPAS = [
    { key: 'LandingVisit', label: 'M3 / P1 — LandingVisit' },
    { key: 'CTA_Click', label: 'P2 — CTA_Click' },
    { key: 'SignupStarted', label: 'P3 — SignupStarted' },
    { key: 'SignupCompleted', label: 'P4 — SignupCompleted' },
    { key: 'ListingStarted', label: 'P5 — ListingStarted' },
    { key: 'ListingPublished', label: 'P6 — ListingPublished' },
  ]

  const linhasFunil = ETAPAS.map(etapa => {
    const cells = dias.map(dia => {
      const val = byDay[dia]?.[etapa.key] || 0
      return `<td>${val || '—'}</td>`
    }).join('')
    const total = totals[etapa.key] || 0
    return `<tr><td class="etapa-label">${etapa.label}</td><td class="total-col"><strong>${total}</strong></td>${cells}</tr>`
  }).join('')

  const anomaliasHTML = anomalias.length === 0
    ? '<p class="ok">✅ Nenhuma anomalia detectada no período.</p>'
    : anomalias.map(a => {
        const cls = parseFloat(a.delta) > 0 ? 'hi' : 'danger'
        const seta = parseFloat(a.delta) > 0 ? '↑' : '↓'
        return `<div class="anomalia ${cls}">${seta} <strong>${a.etapa}</strong> ${a.direcao} ${Math.abs(a.delta)}% vs primeira metade do período</div>`
      }).join('')

  const insightsFormatado = (insights || '')
    .replace(/🔴 CRÍTICO:/g, '<span class="badge danger">🔴 CRÍTICO</span>')
    .replace(/🟡 IMPORTANTE:/g, '<span class="badge warn">🟡 IMPORTANTE</span>')
    .replace(/🟢 PODE ESPERAR:/g, '<span class="badge ok-badge">🟢 PODE ESPERAR</span>')
    .replace(/ANÁLISE:/g, '<h3>📊 Análise</h3>')
    .replace(/ALERTAS:/g, '<h3>⚠️ Alertas</h3>')
    .replace(/PRÓXIMOS PASSOS — TRÁFEGO PAGO:/g, '<h3>🎯 Próximos Passos — Tráfego Pago</h3>')
    .replace(/PRÓXIMOS PASSOS — TRÁFEGO ORGÂNICO:/g, '<h3>🌱 Próximos Passos — Tráfego Orgânico</h3>')
    .replace(/\n/g, '<br>')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard Marketing — Takko Fishing</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 1.4rem; color: #38bdf8; margin-bottom: 4px; }
  .sub { font-size: 0.85rem; color: #64748b; margin-bottom: 24px; }
  .section { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  h2 { font-size: 1rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
  h3 { font-size: 0.95rem; color: #38bdf8; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; overflow-x: auto; display: block; }
  th { background: #0f172a; color: #64748b; padding: 8px 12px; text-align: center; font-weight: 600; white-space: nowrap; }
  td { padding: 8px 12px; text-align: center; border-bottom: 1px solid #0f172a; }
  .etapa-label { text-align: left; color: #cbd5e1; white-space: nowrap; }
  .total-col { font-weight: 700; color: #38bdf8; }
  tr:hover td { background: #263548; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 8px; }
  .card { background: #0f172a; border-radius: 8px; padding: 16px; text-align: center; }
  .card .num { font-size: 2rem; font-weight: 700; color: #38bdf8; }
  .card .label { font-size: 0.75rem; color: #64748b; margin-top: 4px; }
  .anomalia { padding: 10px 14px; border-radius: 8px; margin-bottom: 8px; font-size: 0.9rem; }
  .anomalia.hi { background: #052e16; color: #4ade80; }
  .anomalia.danger { background: #450a0a; color: #f87171; }
  .ok { color: #4ade80; font-size: 0.9rem; }
  .hi { color: #4ade80; }
  .warn { color: #fbbf24; }
  .danger { color: #f87171; }
  .na { color: #475569; }
  .badge { display: inline-block; font-weight: 700; font-size: 0.8rem; padding: 2px 8px; border-radius: 4px; }
  .badge.danger { background: #450a0a; color: #f87171; }
  .badge.warn { background: #422006; color: #fbbf24; }
  .badge.ok-badge { background: #052e16; color: #4ade80; }
  .insights-box { font-size: 0.9rem; line-height: 1.7; color: #cbd5e1; }
  .meta-nota { font-size: 0.78rem; color: #475569; margin-top: 8px; font-style: italic; }
</style>
</head>
<body>
<h1>📊 Dashboard Marketing — Takko Fishing</h1>
<p class="sub">Gerado em ${dataGeracao} · Últimos 7 dias</p>

<div class="section">
  <h2>Cards Rápidos</h2>
  <div class="cards">
    <div class="card"><div class="num">${totals['LandingVisit'] || 0}</div><div class="label">Sessões (M3/P1)</div></div>
    <div class="card"><div class="num">${totals['CTA_Click'] || 0}</div><div class="label">CTA Click (P2)</div></div>
    <div class="card"><div class="num">${totals['SignupCompleted'] || 0}</div><div class="label">Cadastros (P4)</div></div>
    <div class="card"><div class="num">${totals['ListingPublished'] || 0}</div><div class="label">Publicados (P6)</div></div>
    <div class="card"><div class="num">${instagramClicks}</div><div class="label">Cliques Instagram</div></div>
    <div class="card"><div class="num">${totalAnuncios}</div><div class="label">Anúncios Ativos</div></div>
  </div>
</div>

<div class="section">
  <h2>Funil M3 → P6 · Dia a dia</h2>
  <table>
    <thead>
      <tr>
        <th style="text-align:left">Etapa</th>
        <th>Total</th>
        ${dias.map(d => `<th>${formatDia(d)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${linhasFunil}
    </tbody>
  </table>
  <p class="meta-nota">M1 (Impressões) e M2 (Cliques) disponíveis apenas no Meta Ads Manager.</p>
</div>

<div class="section">
  <h2>Tráfego Orgânico — Instagram</h2>
  <div class="cards">
    <div class="card"><div class="num">${instagramClicks}</div><div class="label">Cliques via UTM instagram</div></div>
    <div class="card"><div class="num">${anunciosAprovados}</div><div class="label">Anúncios aprovados no período</div></div>
    <div class="card"><div class="num">${totalAnuncios}</div><div class="label">Total anúncios ativos</div></div>
  </div>
  <p class="meta-nota">Alcance, impressões e engajamento disponíveis via Instagram Insights — integração pendente.</p>
</div>

<div class="section">
  <h2>Anomalias Detectadas</h2>
  ${anomaliasHTML}
</div>

<div class="section">
  <h2>Análise + Próximos Passos</h2>
  <div class="insights-box">${insightsFormatado}</div>
</div>
</body>
</html>`
}

function gerarHTMLEstrategia({ totals, instagramClicks, anunciosAprovados, totalAnuncios, analise, dataGeracao, diasDados }) {
  const analiseFmt = (analise || '')
    .replace(/CRESCIMENTO:/g, '<h3>📈 Crescimento</h3>')
    .replace(/ROI \+ EFICIÊNCIA:/g, '<h3>💰 ROI + Eficiência</h3>')
    .replace(/VISÃO DE LONGO PRAZO:/g, '<h3>🔭 Visão de Longo Prazo</h3>')
    .replace(/DECISÃO DA SEMANA:/g, '<h3 class="decisao">⚡ Decisão da Semana</h3>')
    .replace(/\n/g, '<br>')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard Estratégia — Takko Fishing</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 1.4rem; color: #a78bfa; margin-bottom: 4px; }
  .sub { font-size: 0.85rem; color: #64748b; margin-bottom: 24px; }
  .section { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  h2 { font-size: 1rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
  h3 { font-size: 0.95rem; color: #a78bfa; margin: 20px 0 8px; }
  h3.decisao { color: #fbbf24; font-size: 1.05rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .card { background: #0f172a; border-radius: 8px; padding: 16px; text-align: center; }
  .card .num { font-size: 2rem; font-weight: 700; color: #a78bfa; }
  .card .label { font-size: 0.75rem; color: #64748b; margin-top: 4px; }
  .analise-box { font-size: 0.9rem; line-height: 1.8; color: #cbd5e1; }
</style>
</head>
<body>
<h1>🔭 Dashboard Estratégia — Takko Fishing</h1>
<p class="sub">Gerado em ${dataGeracao} · ${diasDados}</p>

<div class="section">
  <h2>Números da Semana</h2>
  <div class="cards">
    <div class="card"><div class="num">${totals['LandingVisit'] || 0}</div><div class="label">Sessões</div></div>
    <div class="card"><div class="num">${totals['SignupCompleted'] || 0}</div><div class="label">Cadastros</div></div>
    <div class="card"><div class="num">${totals['ListingPublished'] || 0}</div><div class="label">Anúncios Publicados</div></div>
    <div class="card"><div class="num">${instagramClicks}</div><div class="label">Cliques Orgânicos</div></div>
    <div class="card"><div class="num">${anunciosAprovados}</div><div class="label">Aprovados na Semana</div></div>
    <div class="card"><div class="num">${totalAnuncios}</div><div class="label">Total Anúncios Ativos</div></div>
  </div>
</div>

<div class="section">
  <h2>Análise Estratégica</h2>
  <div class="analise-box">${analiseFmt}</div>
</div>
</body>
</html>`
}

module.exports = { gerarHTMLMarketing, gerarHTMLEstrategia }
