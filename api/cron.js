// /api/cron.js
// Runs daily at 9:00 UTC via Vercel Cron
// Sends daily bonus reminders + season warnings

const NOTIFY_SECRET = process.env.NOTIFY_SECRET || 'lso_secret_2025';
const SUPA_URL      = process.env.SUPA_URL || 'https://qymwpvmdcojdvlwnoweg.supabase.co';
const SUPA_KEY      = process.env.SUPA_KEY;
const BOT_TOKEN     = process.env.BOT_TOKEN;
const CHANNEL_ID    = process.env.CHANNEL_ID || '@los_santos_online';
const GAME_URL      = process.env.GAME_URL || 'https://los-santos-online-v2.vercel.app';

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;
const SUPA_HDR = {
  'Content-Type':  'application/json',
  'apikey':        SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
};
function ensureEnv() {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');
  if (!SUPA_KEY) throw new Error('SUPA_KEY is required');
}

async function sbGet(key) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/world?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
    { headers: SUPA_HDR }
  );
  const d = await r.json();
  return d[0]?.value ?? null;
}

async function tgSend(chatId, text) {
  const r = await fetch(`${TG}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      chat_id:      chatId,
      text,
      parse_mode:   'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 Открыть игру', web_app: { url: GAME_URL } }
        ]]
      },
    }),
  });
  const data = await r.json();
  if (!r.ok || data?.ok === false) {
    throw new Error(data?.description || 'Telegram sendMessage failed');
  }
}

async function tgChannel(text) {
  if (!CHANNEL_ID) return;
  const r = await fetch(`${TG}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: CHANNEL_ID, text, parse_mode: 'HTML' }),
  });
  const data = await r.json();
  if (!r.ok || data?.ok === false) {
    throw new Error(data?.description || 'Telegram channel send failed');
  }
}

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

export default async function handler(req, res) {
  ensureEnv();

  // Vercel cron sends GET — allow it, or POST with secret
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret       = req.query?.secret || req.body?.secret;
  if (!isVercelCron && secret !== NOTIFY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = { daily: 0, season: false, channelPost: false };

  try {
    const players = (await sbGet('players')) || {};
    const world   = (await sbGet('world'))   || {};
    const today   = new Date().toDateString();

    // ── 1. Daily bonus reminders ──────────
    const activePlayers = Object.entries(players).filter(([pid, p]) => {
      const tgId = pid.startsWith('p') ? pid.slice(1) : null;
      if (!tgId || isNaN(tgId)) return false;
      if (!p.lastSeen || Date.now() - p.lastSeen > 7 * 86400000) return false;
      if (p.dailyLastDate === today) return false;
      return true;
    });

    for (const [pid, p] of activePlayers) {
      const tgId   = pid.slice(1);
      const streak = p.dailyStreak || 0;
      try {
        await tgSend(tgId,
          `🎁 <b>Ежедневный бонус ждёт!</b>\n` +
          `🔥 Серия: <b>${streak} дней</b>\n\n` +
          `Зайди и забери награду дня ${(streak % 7) + 1}!`
        );
        results.daily++;
        if (results.daily % 25 === 0) await new Promise(r => setTimeout(r, 1100));
      } catch { /* user blocked bot */ }
    }

    // ── 2. Season ending warning ──────────
    if (world.season) {
      const daysLeft = (world.season.end - Date.now()) / 86400000;
      if (daysLeft > 0 && daysLeft <= 1) {
        // Build top orgs
        const orgScores = Object.values(world.orgs || {}).map(o => ({
          name: o.emblem + ' ' + o.name,
          sc:   Object.values(players).filter(p => p.orgId === o.id)
                      .reduce((s, p) => s + (p.score || 0), 0),
        })).sort((a, b) => b.sc - a.sc).slice(0, 3);

        const topText = orgScores.map((o, i) =>
          `${['🥇','🥈','🥉'][i]} ${o.name} — ${fmtNum(o.sc)} очков`
        ).join('\n');

        await tgChannel(
          `🏆 <b>СЕЗОН ${world.season.num} ЗАКАНЧИВАЕТСЯ ЧЕРЕЗ 24 ЧАСА!</b>\n\n` +
          `<b>Текущий топ:</b>\n${topText || '—'}\n\n` +
          `Успей войти в топ-3 и получи награды! 🎯`
        );
        results.season = true;
      }
    }

    // ── 3. Daily channel stat post ────────
    const totalPlayers = Object.keys(players).length;
    const online = Object.values(players)
      .filter(p => p.lastSeen && Date.now() - p.lastSeen < 86400000).length;
    const richest = Object.values(players)
      .sort((a, b) => (b.money || 0) - (a.money || 0))[0];

    if (richest) {
      await tgChannel(
        `📊 <b>Сводка дня — Los Santos Online</b>\n` +
        `━━━━━━━━━━━━━━━\n` +
        `👥 Игроков: <b>${totalPlayers}</b>  |  🟢 Активных: <b>${online}</b>\n` +
        `💰 Богатейший: <b>${richest.name}</b> — ${fmtNum(richest.money || 0)}$\n` +
        `🏢 Организаций: <b>${Object.keys(world.orgs || {}).length}</b>\n` +
        `━━━━━━━━━━━━━━━\n` +
        `🎮 Присоединяйся → @los_santos_online`
      );
      results.channelPost = true;
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
