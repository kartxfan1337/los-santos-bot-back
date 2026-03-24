// /api/setup.js
// Run once to register webhook with Telegram
// GET https://your-bot.vercel.app/api/setup?secret=YOUR_SECRET

const BOT_TOKEN     = process.env.BOT_TOKEN;
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || 'lso_secret_2025';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'BOT_TOKEN is required' });
  }

  if (req.query?.secret !== NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Wrong secret' });
  }

  const host       = req.headers.host;
  const webhookUrl = `https://${host}/api/bot`;

  const r = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        url:             webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        ...(WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {}),
      }),
    }
  );
  const data = await r.json();
  if (!r.ok || data?.ok === false) {
    return res.status(500).json({ error: data?.description || 'setWebhook failed' });
  }

  // Also set bot commands menu
  const cmdResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      commands: [
        { command: 'start',   description: '🚀 Запустить игру' },
        { command: 'stats',   description: '📊 Моя статистика' },
        { command: 'top',     description: '🏆 Топ игроков' },
        { command: 'collect', description: '💰 Собрать доход' },
        { command: 'daily',   description: '🎁 Ежедневный бонус' },
        { command: 'help',    description: '❓ Справка' },
      ],
    }),
  });
  const cmdData = await cmdResp.json();
  if (!cmdResp.ok || cmdData?.ok === false) {
    return res.status(500).json({ error: cmdData?.description || 'setMyCommands failed', webhook: data });
  }

  return res.status(200).json({
    webhook: data,
    url:     webhookUrl,
    note:    'Commands menu also set!',
  });
}
