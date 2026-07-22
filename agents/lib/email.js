const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

async function sendEmail({ subject, resumo, dashboardHtml, dashboardUrl }) {
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
  .container { max-width: 600px; margin: 0 auto; }
  .header { background: #0f172a; color: #38bdf8; padding: 20px 24px; border-radius: 12px 12px 0 0; }
  .header h1 { margin: 0; font-size: 1.2rem; }
  .header p { margin: 4px 0 0; color: #64748b; font-size: 0.85rem; }
  .resumo { background: #fff; border: 1px solid #e2e8f0; padding: 20px 24px; }
  .resumo pre { background: #f1f5f9; padding: 16px; border-radius: 8px; font-size: 0.85rem; white-space: pre-wrap; line-height: 1.6; }
  .link-box { background: #0f172a; padding: 20px 24px; border-radius: 0 0 12px 12px; text-align: center; }
  .link-box a { display: inline-block; background: #38bdf8; color: #0f172a; font-weight: 700; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 0.95rem; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${subject}</h1>
    <p>Gerado automaticamente pelos agentes da Takko</p>
  </div>
  <div class="resumo">
    <pre>${resumo}</pre>
  </div>
  <div class="link-box">
    <a href="${dashboardUrl}">📊 Ver Dashboard Completo</a>
  </div>
</div>
</body>
</html>`

  await transporter.sendMail({
    from: `"Takko Agentes" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject,
    html,
  })
}

module.exports = { sendEmail }
