require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { format, startOfWeek, endOfWeek } = require('date-fns')
const { toZonedTime } = require('date-fns-tz')
const { getFunnelEvents, getInstagramClicks, getApprovedListings, getTotalAnuncios } = require('./lib/supabase')
const { getDias, processFunnelByDay, calcTotals } = require('./lib/processar-funil')
const { gerarAnaliseEstrategia } = require('./lib/claude')
const { gerarHTMLEstrategia } = require('./lib/gerar-html')
const { sendEmail } = require('./lib/email')

const TZ = 'America/Sao_Paulo'
const REPO = process.env.GITHUB_REPOSITORY || 'andreyhigashi/takko-api'
const PAGES_URL = `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}`

async function main() {
  console.log('🔭 Agente de Estratégia iniciado')

  const agora = toZonedTime(new Date(), TZ)
  const dataGeracao = format(agora, "dd/MM/yyyy 'às' HH:mm")
  const dias = getDias(7)
  const diasDados = `Semana de ${format(toZonedTime(startOfWeek(new Date(), { weekStartsOn: 1 }), TZ), 'dd/MM')} a ${format(toZonedTime(endOfWeek(new Date(), { weekStartsOn: 1 }), TZ), 'dd/MM/yyyy')}`

  // 1. Buscar dados
  console.log('📊 Buscando dados do Supabase...')
  const [eventos, instagramRaw, anunciosRecentes, totalAnuncios] = await Promise.all([
    getFunnelEvents(7),
    getInstagramClicks(7),
    getApprovedListings(7),
    getTotalAnuncios(),
  ])

  // 2. Processar
  const byDay = processFunnelByDay(eventos)
  const totals = calcTotals(byDay, dias)
  const instagramClicks = instagramRaw.length
  const anunciosAprovados = anunciosRecentes.length

  console.log(`✅ Dados: ${eventos.length} eventos, ${totalAnuncios} anúncios ativos`)

  // 3. Gerar análise estratégica com Claude
  console.log('🤖 Gerando análise estratégica com Claude...')
  let analise = ''
  try {
    analise = await gerarAnaliseEstrategia({ totals, instagramClicks, anunciosAprovados, totalAnuncios, diasDados })
  } catch (err) {
    console.error('Erro Claude:', err.message)
    analise = 'Análise não disponível nesta execução.'
  }

  // 4. Gerar HTML
  console.log('📝 Gerando dashboard HTML...')
  const html = gerarHTMLEstrategia({ totals, instagramClicks, anunciosAprovados, totalAnuncios, analise, dataGeracao, diasDados })

  // 5. Salvar em docs/
  const docsDir = path.join(__dirname, '..', 'docs')
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true })
  fs.writeFileSync(path.join(docsDir, 'estrategia.html'), html, 'utf8')
  console.log('💾 HTML salvo em docs/estrategia.html')

  // 6. Montar resumo WhatsApp
  const convGeral = totals['LandingVisit'] > 0
    ? ((totals['ListingPublished'] / totals['LandingVisit']) * 100).toFixed(2)
    : '0'

  // Extrair "Decisão da Semana" do texto do Claude
  const decisaoMatch = analise.match(/DECISÃO DA SEMANA:\s*([\s\S]+?)(?:\n\n|$)/)
  const decisao = decisaoMatch ? decisaoMatch[1].trim().replace(/\n/g, ' ') : 'Ver dashboard completo'

  const resumo = `🔭 TAKKO FISHING — ESTRATÉGIA
${diasDados}

FUNIL DA SEMANA:
• Sessões: ${totals['LandingVisit'] || 0}
• Cadastros completos: ${totals['SignupCompleted'] || 0}
• Anúncios publicados: ${totals['ListingPublished'] || 0}
• Conv. geral (sessão→pub): ${convGeral}%

Orgânico: ${instagramClicks} cliques Instagram
Total anúncios ativos: ${totalAnuncios}

⚡ DECISÃO DA SEMANA:
${decisao}`

  // 7. Enviar email
  console.log('📧 Enviando email...')
  try {
    await sendEmail({
      subject: `🔭 Estratégia Takko — ${diasDados}`,
      resumo,
      dashboardHtml: html,
      dashboardUrl: `${PAGES_URL}/estrategia.html`,
    })
    console.log('✅ Email enviado')
  } catch (err) {
    console.error('Erro email:', err.message)
  }

  console.log('✅ Agente de Estratégia concluído')
}

main().catch(err => {
  console.error('❌ Erro fatal:', err.message)
  process.exit(1)
})
