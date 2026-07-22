const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const EVENTOS_FUNIL = ['LandingVisit', 'CTA_Click', 'SignupStarted', 'SignupCompleted', 'ListingStarted', 'ListingPublished']
const EVENTOS_ENGAJAMENTO = ['LandingDwell', 'LandingScroll', 'LandingCtaSeen']

async function getFunnelEvents(days = 7) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabase
    .from('analytics_events')
    .select('*')
    .gte('created_at', since.toISOString())
    .in('event_name', [...EVENTOS_FUNIL, ...EVENTOS_ENGAJAMENTO])
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Supabase getFunnelEvents: ${error.message}`)
  return data || []
}

async function getInstagramClicks(days = 7) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabase
    .from('analytics_events')
    .select('id, created_at')
    .eq('event_name', 'LandingVisit')
    .eq('utm_source', 'instagram')
    .gte('created_at', since.toISOString())

  if (error) throw new Error(`Supabase getInstagramClicks: ${error.message}`)
  return data || []
}

async function getApprovedListings(days = 7) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabase
    .from('anuncios')
    .select('id, titulo, categoria, preco, created_at')
    .eq('status', 'aprovado')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Supabase getApprovedListings: ${error.message}`)
  return data || []
}

async function getTotalAnuncios() {
  const { count, error } = await supabase
    .from('anuncios')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'aprovado')

  if (error) throw new Error(`Supabase getTotalAnuncios: ${error.message}`)
  return count || 0
}

module.exports = { getFunnelEvents, getInstagramClicks, getApprovedListings, getTotalAnuncios }
