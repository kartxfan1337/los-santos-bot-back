// /api/notify.js
// Game calls this endpoint to trigger push notifications
// POST { type, chatId, data }
// Also used as cron job for daily reminders

const BOT_TOKEN  = process.env.BOT_TOKEN;
const SUPA_URL   = process.env.SUPA_URL || 'https://qymwpvmdcojdvlwnoweg.supabase.co';
const SUPA_KEY   = process.env.SUPA_KEY;
const GAME_URL   = process.env.GAME_URL || 'https://los-santos-online-v2.vercel.app';
const CHANNEL_ID = process.env.CHANNEL_ID || '@los_santos_online';
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || 'lso_secret_2025';

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;
const SUPA_HDR = {
  'Content-Type':  'application/json',
  'apikey':        SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
};

async function tgSend(chatId, text, markup) {
  await fetch(`${TG}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:      chatId,
      text,
      parse_mode:   'HTML',
      reply_markup: markup || {
        inline_keyboard: [[
          { text: '🎮 Открыть игру', web_app: { url: GAME_URL } }
        ]]
      },
    }),
  });
}

async function tgChannel(text) {
  if (!CHANNEL_ID) return;
  await fetch(`${TG}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHANNEL_ID, text, parse_mode: 'HTML' }),
  });
}

async function sbGet(key) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/world?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
    { headers: SUPA_HDR }
  );
  const d = await r.json();
  return d[0]?.value ?? null;
}

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ── Notification templates ───────────────
const templates = {
  // Business event — sent to player
  biz_event: (d) =>
    `⚡ <b>Событие в бизнесе!</b>\n` +
    `${d.ico} <b>${d.biz}</b>\n` +
    `<b>${d.event}</b>\n\n` +
    `Бизнес остановлен и не приносит доход!\n` +
    `Зайди в игру и разберись 👆`,

  // District attack — sent to org members
  attack: (d) =>
    `⚔️ <b>Атака на район!</b>\n` +
    `🏙️ <b>${d.district}</b> атакован!\n` +
    `Враг: <b>${d.attacker}</b>\n\n` +
    `Зайди в игру и защити район!`,

  // Duel challenge — sent to target
  duel: (d) =>
    `🥊 <b>Тебя вызвали на дуэль!</b>\n` +
    `Вызов от <b>${d.challenger}</b>\n` +
    `Ставка: <b>${fmtNum(d.bet)}$</b> с каждого\n\n` +
    `Зайди и прими или откажись!`,

  // Daily reminder — broadcast to all
  daily_remind: () =>
    `🎁 <b>Ежедневный бонус ждёт!</b>\n` +
    `Зайди в игру и забери награду.\n` +
    `Не прерывай серию! 🔥`,

  // Season ending soon — broadcast
  season_end: (d) =>
    `🏆 <b>Сезон заканчивается через ${d.hours} ч!</b>\n` +
    `Текущий топ:\n${d.topOrgs}\n\n` +
    `Успей войти в топ-3 и получить награды!`,

  // New war declared — channel post
  war_declared: (d) =>
    `⚔️ <b>ОБЪЯВЛЕНА ВОЙНА!</b>\n` +
    `<b>${d.attacker}</b> объявил войну <b>${d.defender}</b>!\n` +
    `Район: 🏙️ ${d.district}\n\n` +
    `Ставьте на победителя в разделе Ставки! 💰`,

  // Big casino win — channel post
  casino_win: (d) =>
    `🎰 <b>КРУПНЫЙ ВЫИГРЫШ!</b>\n` +
    `${d.avatar} <b>${d.player}</b> выиграл <b>${fmtNum(d.amount)}$</b> в казино!\n` +
    `Удача улыбается смелым 🍀`,

  // Season results — channel post
  season_results: (d) =>
    `🏆 <b>СЕЗОН ${d.num} ЗАВЕРШЁН!</b>\n\n` +
    `🥇 <b>${d.first}</b> — чемпион!\n` +
    `🥈 <b>${d.second}</b>\n` +
    `🥉 <b>${d.third}</b>\n\n` +
    `Начинается Сезон ${d.num + 1}! 🚀`,
};

// ── Daily reminder cron ──────────────────
async function sendDailyReminders() {
  const players = (await sbGet('players')) || {};
  const today   = new Date().toDateString();
  let sent = 0;

  for (const [pid, p] of Object.entries(players)) {
    // Skip if already claimed today
    if (p.dailyLastDate === today) continue;
    // Only players who have a Telegram ID (PID starts with 'p' + tgId)
    const tgId = pid.startsWith('p') ? pid.slice(1) : null;
    if (!tgId || isNaN(tgId)) continue;
    // Only active players (seen in last 7 days)
    if (!p.lastSeen || Date.now() - p.lastSeen > 7 * 86400000) continue;

    try {
      await tgSend(tgId, templates.daily_remind());
      sent++;
      // Rate limit — max 30 msg/sec on Telegram
      if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1100));
    } catch { /* player blocked bot — skip */ }
  }

  return sent;
}

// ── Main handler ─────────────────────────
export default async function handler(req, res) {
  // Validate secret
  const secret = req.headers['x-notify-secret'] || req.body?.secret;
  if (secret !== NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type, chatId, data, channel } = req.body || {};

  try {
    // Daily reminder cron (no chatId = broadcast)
    if (type === 'daily_remind' && !chatId) {
      const sent = await sendDailyReminders();
      return res.status(200).json({ ok: true, sent });
    }

    // Channel post
    if (channel || ['war_declared','casino_win','season_results'].includes(type)) {
      const text = templates[type]?.(data);
      if (text) await tgChannel(text);
      return res.status(200).json({ ok: true, channel: true });
    }

    // Direct notification to player
    if (chatId && type) {
      const text = templates[type]?.(data);
      if (text) await tgSend(chatId, text);
      return res.status(200).json({ ok: true, sent: true });
    }

    return res.status(400).json({ error: 'Missing type or chatId' });
  } catch (err) {
    console.error('Notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
