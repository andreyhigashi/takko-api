const Anthropic = require('@anthropic-ai/sdk')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function gerarInsightsMarketing({ totals, anomalias, instagramClicks, anunciosAprovados, totalAnuncios }) {
  const prompt = `Você é o Agente de Marketing da Takko Fishing, marketplace de equipamentos de pesca.

DADOS DOS ÚLTIMOS 7 DIAS:

Funil (Supabase — M1/M2 não disponíveis, vêm do Meta Ads):
- M3 / P1 — LandingVisit: ${totals['LandingVisit'] || 0}
- P2 — CTA_Click: ${totals['CTA_Click'] || 0}
- P3 — SignupStarted: ${totals['SignupStarted'] || 0}
- P4 — SignupCompleted: ${totals['SignupCompleted'] || 0}
- P5 — ListingStarted: ${totals['ListingStarted'] || 0}
- P6 — ListingPublished: ${totals['ListingPublished'] || 0}

Tráfego orgânico (Instagram):
- Cliques via UTM instagram: ${instagramClicks}
- Anúncios aprovados no período: ${anunciosAprovados}
- Total de anúncios ativos na plataforma: ${totalAnuncios}

Anomalias detectadas (variação ≥30% vs primeira metade do período):
${anomalias.length === 0 ? '- Nenhuma anomalia detectada' : anomalias.map(a => `- ${a.etapa} ${a.direcao} ${Math.abs(a.delta)}% (média recente: ${a.recente}/dia vs ${a.antigo}/dia antes)`).join('\n')}

CONTEXTO:
- Campanha Meta Ads ativa (tráfego pago) captando vendedores
- Experimento A/B ativo: Criativo A vs C × Landing v1 vs v2 × placement RC vs Reels
- Reels confirmado como canal de baixa qualidade (0 CTA_Click)
- RC (Right Column) é o canal com melhor desempenho
- Gargalo principal: P1→P2 (Landing→CTA_Click) com conversão baixa
- Tráfego orgânico ainda sem processo escalável — foco atual é Instagram

TAREFA:
1. Faça uma análise direta e honesta do que os números mostram
2. Destaque os pontos de atenção mais críticos
3. Gere uma lista de próximos passos com nível de criticidade para TRÁFEGO PAGO e TRÁFEGO ORGÂNICO

Formato de resposta (use exatamente este formato):

ANÁLISE:
[2-3 frases diretas sobre o estado atual do funil]

ALERTAS:
[lista com bullet points dos pontos críticos, máximo 4]

PRÓXIMOS PASSOS — TRÁFEGO PAGO:
🔴 CRÍTICO: [ação]
🟡 IMPORTANTE: [ação]
🟢 PODE ESPERAR: [ação]

PRÓXIMOS PASSOS — TRÁFEGO ORGÂNICO:
🔴 CRÍTICO: [ação]
🟡 IMPORTANTE: [ação]
🟢 PODE ESPERAR: [ação]

Seja direto. Sem rodeios. Máximo 300 palavras no total.`

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  return msg.content[0].text
}

async function gerarAnaliseEstrategia({ totals, instagramClicks, anunciosAprovados, totalAnuncios, diasDados }) {
  const prompt = `Você é o Agente de Estratégia da Takko Fishing — seu papel é ser um sócio estratégico honesto e crítico.

A Takko Fishing é um marketplace de equipamentos de pesca usados com o sonho de ser um "one stop shop" de pesca no Brasil.

DADOS DA SEMANA (${diasDados}):

Funil de aquisição de vendedores:
- LandingVisit: ${totals['LandingVisit'] || 0}
- CTA_Click: ${totals['CTA_Click'] || 0}
- SignupStarted: ${totals['SignupStarted'] || 0}
- SignupCompleted: ${totals['SignupCompleted'] || 0}
- ListingStarted: ${totals['ListingStarted'] || 0}
- ListingPublished: ${totals['ListingPublished'] || 0}

Tráfego orgânico:
- Cliques via Instagram: ${instagramClicks}
- Anúncios aprovados na semana: ${anunciosAprovados}
- Total de anúncios ativos: ${totalAnuncios}

CONTEXTO ESTRATÉGICO:
- Estamos investindo em Meta Ads (tráfego pago) para captar vendedores
- Dependência 100% de tráfego pago atualmente — orgânico ainda não escalou
- Experimento A/B em andamento para otimizar conversão na landing
- O marketplace ainda está em fase inicial de tração

TAREFA — analise em 3 dimensões:

1. CRESCIMENTO: A Takko está crescendo? Em que velocidade? O que está travando?

2. ROI + EFICIÊNCIA: O investimento em tráfego pago está se justificando? Estamos sendo eficientes? Onde há desperdício? A dependência de pago está diminuindo ou aumentando?

3. VISÃO DE LONGO PRAZO: O marketplace é o melhor caminho para o "one stop shop de pesca"? Se os números não evoluírem, quais alternativas merecem atenção? (rede social de pescadores, marketplace de pousadas de pesca, etc.)

Formato de resposta (use exatamente este formato):

CRESCIMENTO:
[análise direta com dados concretos — 3-4 frases]

ROI + EFICIÊNCIA:
[análise crítica — o que está funcionando, o que é desperdício — 3-4 frases]

VISÃO DE LONGO PRAZO:
[avaliação honesta do caminho atual + alternativas se necessário — 4-5 frases]

DECISÃO DA SEMANA:
[Uma única recomendação de alta prioridade que o fundador deve tomar esta semana]

Seja brutalmente honesto. Sem eufemismos. Máximo 400 palavras.`

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  })

  return msg.content[0].text
}

module.exports = { gerarInsightsMarketing, gerarAnaliseEstrategia }
