// /api/setup.js
// Run once to register webhook with Telegram
// GET https://your-bot.vercel.app/api/setup?secret=YOUR_SECRET

const BOT_TOKEN     = process.env.BOT_TOKEN;
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || 'lso_notify_2025';

export default async function handler(req, res) {
  if (req.query.secret !== NOTIFY_SECRET) {
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
      }),
    }
  );
  const data = await r.json();

  // Also set bot commands menu
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
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

  return res.status(200).json({
    webhook: data,
    url:     webhookUrl,
    note:    'Commands menu also set!',
  });
}
