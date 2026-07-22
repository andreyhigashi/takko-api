const { format, subDays, parseISO } = require('date-fns')
const { toZonedTime } = require('date-fns-tz')

const TZ = 'America/Sao_Paulo'

const ETAPAS = [
  { key: 'M3', label: 'M3 — LandingVisit', evento: 'LandingVisit' },
  { key: 'P1', label: 'P1 — LandingVisit', evento: 'LandingVisit' },
  { key: 'P2', label: 'P2 — CTA_Click', evento: 'CTA_Click' },
  { key: 'P3', label: 'P3 — SignupStarted', evento: 'SignupStarted' },
  { key: 'P4', label: 'P4 — SignupCompleted', evento: 'SignupCompleted' },
  { key: 'P5', label: 'P5 — ListingStarted', evento: 'ListingStarted' },
  { key: 'P6', label: 'P6 — ListingPublished', evento: 'ListingPublished' },
]

function getDias(days = 7) {
  const dias = []
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(new Date(), i)
    dias.push(format(toZonedTime(d, TZ), 'yyyy-MM-dd'))
  }
  return dias
}

function processFunnelByDay(eventos) {
  const byDay = {}

  for (const ev of eventos) {
    const dia = format(toZonedTime(parseISO(ev.created_at), TZ), 'yyyy-MM-dd')
    if (!byDay[dia]) byDay[dia] = {}
    byDay[dia][ev.event_name] = (byDay[dia][ev.event_name] || 0) + 1
  }

  return byDay
}

function calcTotals(byDay, dias) {
  const totals = {}
  for (const etapa of ETAPAS) {
    totals[etapa.evento] = dias.reduce((acc, dia) => acc + (byDay[dia]?.[etapa.evento] || 0), 0)
  }
  return totals
}

function calcConversao(a, b) {
  if (!a || a === 0) return null
  return ((b / a) * 100).toFixed(1)
}

function detectAnomalias(byDay, dias) {
  const anomalias = []
  if (dias.length < 2) return anomalias

  const metade = Math.floor(dias.length / 2)
  const diasRecentes = dias.slice(metade)
  const diasAntigos = dias.slice(0, metade)

  for (const etapa of ETAPAS) {
    const ev = etapa.evento
    const recente = diasRecentes.reduce((a, d) => a + (byDay[d]?.[ev] || 0), 0) / diasRecentes.length
    const antigo = diasAntigos.reduce((a, d) => a + (byDay[d]?.[ev] || 0), 0) / diasAntigos.length

    if (antigo > 0) {
      const delta = ((recente - antigo) / antigo) * 100
      if (Math.abs(delta) >= 30) {
        anomalias.push({
          etapa: etapa.label,
          delta: delta.toFixed(0),
          direcao: delta > 0 ? 'subiu' : 'caiu',
          recente: recente.toFixed(1),
          antigo: antigo.toFixed(1),
        })
      }
    }
  }

  return anomalias
}

module.exports = { getDias, processFunnelByDay, calcTotals, calcConversao, detectAnomalias, ETAPAS }
