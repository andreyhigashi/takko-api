require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { format } = require('date-fns')
const { toZonedTime } = require('date-fns-tz')
const { getFunnelEvents, getInstagramClicks, getApprovedListings, getTotalAnuncios } = require('./lib/supabase')
const { getDias, processFunnelByDay, calcTotals, detectAnomalias } = require('./lib/processar-funil')
const { gerarInsightsMarketing } = require('./lib/claude')
const { gerarHTMLMarketing } = require('./lib/gerar-html')
const { sendWhatsApp } = require('./lib/whatsapp')

const TZ = 'America/Sao_Paulo'
const REPO = process.env.GITHUB_REPOSITORY || 'andreyhigashi/takko-api'
const PAGES_URL = `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}`

async function main() {
  console.log('🚀 Agente de Marketing iniciado')

  const agora = toZonedTime(new Date(), TZ)
  const dataGeracao = format(agora, "dd/MM/yyyy 'às' HH:mm")
  const dias = getDias(7)

  // 1. Buscar dados
  console.log('📊 Buscando dados do Supabase...')
  const [eventos, instagramRaw, anunciosRecentes, totalAnuncios] = await Promise.all([
    getFunnelEvents(7),
    getInstagramClicks(7),
    getApprovedListings(7),
    getTotalAnuncios(),
  ])

  // 2. Processar funil
  const byDay = processFunnelByDay(eventos)
  const totals = calcTotals(byDay, dias)
  const anomalias = detectAnomalias(byDay, dias)
  const instagramClicks = instagramRaw.length
  const anunciosAprovados = anunciosRecentes.length

  console.log(`✅ Dados processados: ${eventos.length} eventos, ${instagramClicks} cliques Instagram, ${anunciosAprovados} anúncios`)

  // 3. Gerar insights com Claude
  console.log('🤖 Gerando insights com Claude...')
  let insights = ''
  try {
    insights = await gerarInsightsMarketing({ totals, anomalias, instagramClicks, anunciosAprovados, totalAnuncios })
  } catch (err) {
    console.error('Erro Claude:', err.message)
    insights = 'Insights não disponíveis nesta execução.'
  }

  // 4. Gerar HTML
  console.log('📝 Gerando dashboard HTML...')
  const html = gerarHTMLMarketing({ dias, byDay, totals, anomalias, instagramClicks, anunciosAprovados, totalAnuncios, insights, dataGeracao })

  // 5. Salvar HTML em docs/
  const docsDir = path.join(__dirname, '..', 'docs')
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true })
  fs.writeFileSync(path.join(docsDir, 'marketing.html'), html, 'utf8')
  console.log('💾 HTML salvo em docs/marketing.html')

  // 6. Montar resumo WhatsApp
  const convP1P2 = totals['LandingVisit'] > 0
    ? ((totals['CTA_Click'] / totals['LandingVisit']) * 100).toFixed(1)
    : '0'
  const convP3P4 = totals['SignupStarted'] > 0
    ? ((totals['SignupCompleted'] / totals['SignupStarted']) * 100).toFixed(1)
    : '0'

  const alertasTexto = anomalias.length > 0
    ? anomalias.map(a => `⚠️ ${a.etapa} ${a.direcao} ${Math.abs(a.delta)}%`).join('\n')
    : '✅ Sem anomalias'

  const mensagem = `📊 *TAKKO FISHING — MARKETING*
${dataGeracao} · Últimos 7 dias

*Funil:*
• Sessões (M3): ${totals['LandingVisit'] || 0}
• CTA Click (P2): ${totals['CTA_Click'] || 0} (conv: ${convP1P2}%)
• Cadastros (P4): ${totals['SignupCompleted'] || 0}
• Publicados (P6): ${totals['ListingPublished'] || 0}

*Orgânico (Instagram):*
• Cliques: ${instagramClicks}
• Anúncios aprovados: ${anunciosAprovados}
• Total ativos: ${totalAnuncios}

*Anomalias:*
${alertasTexto}

🔗 Dashboard completo:
${PAGES_URL}/marketing.html`

  // 7. Enviar WhatsApp
  console.log('📱 Enviando WhatsApp...')
  try {
    await sendWhatsApp(mensagem)
    console.log('✅ WhatsApp enviado')
  } catch (err) {
    console.error('Erro WhatsApp:', err.message)
  }

  console.log('✅ Agente de Marketing concluído')
}

main().catch(err => {
  console.error('❌ Erro fatal:', err.message)
  process.exit(1)
})
