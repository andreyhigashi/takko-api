const axios = require('axios')

async function sendWhatsApp(message) {
  const phone = process.env.WHATSAPP_NUMBER
  const apikey = process.env.CALLMEBOT_API_KEY

  if (!phone || !apikey) throw new Error('WHATSAPP_NUMBER ou CALLMEBOT_API_KEY não configurados')

  const encoded = encodeURIComponent(message)
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apikey}`

  const { data } = await axios.get(url)
  return data
}

module.exports = { sendWhatsApp }
