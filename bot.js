// ═══════════════════════════════════════════
// Los Santos Online — Telegram Bot Backend
// Vercel Serverless Function
// ═══════════════════════════════════════════

const BOT_TOKEN   = process.env.BOT_TOKEN;
const SUPA_URL    = process.env.SUPA_URL    || 'https://qymwpvmdcojdvlwnoweg.supabase.co';
const SUPA_KEY    = process.env.SUPA_KEY;
const GAME_URL    = process.env.GAME_URL    || 'https://los-santos-online-v2.vercel.app';
const CHANNEL_ID  = process.env.CHANNEL_ID  || '@los_santos_online';
const ADMIN_ID    = process.env.ADMIN_ID    || '658117827';

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Telegram API helpers ─────────────────
async function tg(method, body) {
  const r = await fetch(`${TG}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function send(chat_id, text, extra = {}) {
  return tg('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });
}

// ── Supabase helpers ─────────────────────
const SUPA_HDR = {
  'Content-Type':  'application/json',
  'apikey':        SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
};

async function sbGet(key) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/world?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
    { headers: SUPA_HDR }
  );
  const d = await r.json();
  return d[0]?.value ?? null;
}

async function sbSet(key, value) {
  await fetch(`${SUPA_URL}/rest/v1/world`, {
    method:  'POST',
    headers: { ...SUPA_HDR, 'Prefer': 'resolution=merge-duplicates' },
    body:    JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}

async function getPlayers() { return (await sbGet('players')) || {}; }
async function getWorld()   { return (await sbGet('world'))   || {}; }

function getPID(tgId) { return 'p' + tgId; }

// ── Inline keyboard builders ─────────────
function btnOpenGame(text = '🎮 Открыть игру') {
  return {
    inline_keyboard: [[
      { text, web_app: { url: GAME_URL } },
    ]],
  };
}

function btnOpenGameAndClose(extraBtn) {
  const row1 = [{ text: '🎮 Открыть игру', web_app: { url: GAME_URL } }];
  return {
    inline_keyboard: extraBtn ? [row1, [extraBtn]] : [row1],
  };
}

// ── Command handlers ─────────────────────

// /start — welcome + ref tracking
async function cmdStart(msg, args) {
  const userId  = String(msg.from.id);
  const name    = msg.from.first_name || 'Игрок';
  const refCode = args?.[0]; // "ref_p123456"

  // Register referral in Supabase if new player
  if (refCode?.startsWith('ref_')) {
    const refPID    = refCode.slice(4); // "p123456"
    const players   = await getPlayers();
    const myPID     = getPID(userId);
    const referrer  = players[refPID];

    if (referrer && !players[myPID]) {
      // Mark pending referral — game will pick it up on next sync
      const pending = (await sbGet('pending_refs')) || [];
      pending.push({ refPID, newPID: myPID, ts: Date.now() });
      await sbSet('pending_refs', pending);
    }
  }

  await send(msg.chat.id,
    `👋 <b>Добро пожаловать в Los Santos Online, ${name}!</b>\n\n` +
    `🏙️ Захватывай районы, создавай организации, строй бизнес и становись крёстным отцом города!\n\n` +
    `<b>Команды:</b>\n` +
    `/stats — твоя статистика\n` +
    `/top — топ игроков\n` +
    `/collect — собрать пассивный доход\n` +
    `/daily — ежедневный бонус\n` +
    `/help — справка`,
    { reply_markup: btnOpenGame('🚀 НАЧАТЬ ИГРАТЬ') }
  );
}

// /stats — player statistics
async function cmdStats(msg) {
  const pid     = getPID(msg.from.id);
  const players = await getPlayers();
  const p       = players[pid];

  if (!p) {
    return send(msg.chat.id,
      '❌ Ты ещё не зарегистрирован в игре. Открой игру чтобы начать!',
      { reply_markup: btnOpenGame() }
    );
  }

  const world   = await getWorld();
  const orgName = p.orgId && world.orgs?.[p.orgId]
    ? world.orgs[p.orgId].emblem + ' ' + world.orgs[p.orgId].name
    : '—';
  const districts = Object.values(world.districts || {})
    .filter(d => d.orgId === p.orgId).length;

  await send(msg.chat.id,
    `${p.avatar || '👤'} <b>${p.name}</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🏆 Уровень: <b>${p.level || 1}</b>  |  ⭐ Репа: <b>${p.rep || 0}</b>\n` +
    `💵 Деньги: <b>${fmtNum(p.money || 0)}$</b>\n` +
    `⚡ Сила: <b>${p.power || 0}</b>  |  🎯 Очки: <b>${p.score || 0}</b>\n` +
    `🔋 Энергия: <b>${p.energy || 0}/${p.energyMax || 10}</b>\n` +
    `🏢 Орга: <b>${orgName}</b>\n` +
    `${districts > 0 ? `🏙️ Районов: <b>${districts}</b>\n` : ''}` +
    `🚔 Розыск: <b>${p.wanted ? '★'.repeat(p.wanted) : '—'}</b>`,
    { reply_markup: btnOpenGame() }
  );
}

// /top — leaderboard
async function cmdTop(msg) {
  const players = await getPlayers();
  const list    = Object.values(players)
    .filter(p => p.name)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10);

  if (!list.length) {
    return send(msg.chat.id, '📊 Пока нет игроков.');
  }

  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  const text   = list.map((p, i) =>
    `${medals[i]} <b>${p.name}</b>  · ${fmtNum(p.score || 0)} очков  · ${fmtNum(p.money || 0)}$`
  ).join('\n');

  await send(msg.chat.id,
    `🏆 <b>Топ игроков Los Santos</b>\n━━━━━━━━━━━━━━━\n${text}`,
    { reply_markup: btnOpenGame('📊 Полный топ') }
  );
}

// /collect — passive income
async function cmdCollect(msg) {
  const pid     = getPID(msg.from.id);
  const players = await getPlayers();
  const p       = players[pid];

  if (!p) {
    return send(msg.chat.id, '❌ Сначала зайди в игру!', { reply_markup: btnOpenGame() });
  }

  const lastCollect = p.lastBotCollect || p.lastSeen || Date.now();
  const now         = Date.now();
  const hoursGone   = Math.min(24, (now - lastCollect) / 3600000);

  if (hoursGone < 0.25) {
    const minLeft = Math.ceil((0.25 - hoursGone) * 60);
    return send(msg.chat.id,
      `⏳ Подожди ещё ${minLeft} мин. перед следующим сбором.`
    );
  }

  // Calculate income from props (simplified)
  const PROP_INCOMES = {
    apt: 50, garage: 80, pharmacy: 120, restaurant: 150, bar: 150,
    taxipark: 200, warehouse: 250, bank: 300, casino_share: 400,
    gameclub: 280, security_co: 350, mansion: 600,
  };
  const baseInc = (p.props || []).reduce((s, id) => s + (PROP_INCOMES[id] || 0), 0);
  const earned  = Math.floor(baseInc * hoursGone);

  if (earned <= 0) {
    return send(msg.chat.id,
      '🏚️ У тебя нет бизнеса — нечего собирать.\nКупи бизнес в игре!',
      { reply_markup: btnOpenGame('🏢 Открыть Бизнес') }
    );
  }

  p.money             = (p.money || 0) + earned;
  p.lastBotCollect    = now;
  players[pid]        = p;
  await sbSet('players', players);

  await send(msg.chat.id,
    `💰 <b>Доход собран!</b>\n\n` +
    `📦 Бизнесов: ${(p.props || []).length}\n` +
    `⏱️ Прошло: ${hoursGone.toFixed(1)}ч\n` +
    `💵 Получено: <b>+${fmtNum(earned)}$</b>\n` +
    `💳 Баланс: <b>${fmtNum(p.money)}$</b>`,
    { reply_markup: btnOpenGame() }
  );
}

// /daily — daily bonus reminder
async function cmdDaily(msg) {
  const pid     = getPID(msg.from.id);
  const players = await getPlayers();
  const p       = players[pid];

  if (!p) {
    return send(msg.chat.id, '❌ Сначала зайди в игру!', { reply_markup: btnOpenGame() });
  }

  const today   = new Date().toDateString();
  const claimed = p.dailyLastDate === today;
  const streak  = p.dailyStreak || 0;

  if (claimed) {
    await send(msg.chat.id,
      `✅ Ежедневный бонус уже забран сегодня!\n🔥 Серия: <b>${streak} дней</b>\n\nПриходи завтра!`,
      { reply_markup: btnOpenGame() }
    );
  } else {
    await send(msg.chat.id,
      `🎁 <b>Ежедневный бонус ждёт тебя!</b>\n\n🔥 Серия: <b>${streak} дней</b>\nЗайди в игру и забери награду дня ${(streak % 7) + 1}!`,
      { reply_markup: btnOpenGame('🎁 ЗАБРАТЬ БОНУС') }
    );
  }
}

// /help
async function cmdHelp(msg) {
  await send(msg.chat.id,
    `🎮 <b>Los Santos Online</b> — мультиплеер RP в Telegram\n\n` +
    `<b>Команды:</b>\n` +
    `/start — главное меню\n` +
    `/stats — твоя статистика\n` +
    `/top — топ 10 игроков\n` +
    `/collect — собрать доход с бизнесов\n` +
    `/daily — ежедневный бонус\n` +
    `/help — эта справка\n\n` +
    `<b>Поддержка:</b> @los_santos_online`,
    { reply_markup: btnOpenGame() }
  );
}

// ── Notification sender (called by /api/notify) ──
async function sendNotification(chatId, type, data) {
  const templates = {
    biz_event: () =>
      `⚡ <b>Событие в бизнесе!</b>\n` +
      `${data.ico} <b>${data.biz}</b>: ${data.event}\n` +
      `Бизнес остановлен — зайди и разберись!`,

    attack: () =>
      `⚔️ <b>Твой район атакован!</b>\n` +
      `🏙️ <b>${data.district}</b> под угрозой!\n` +
      `Враг: <b>${data.attacker}</b>`,

    duel: () =>
      `🥊 <b>Тебя вызвали на дуэль!</b>\n` +
      `Вызов от <b>${data.challenger}</b>\n` +
      `Банк: <b>${fmtNum(data.bet)}$</b> — прими или откажись!`,

    daily_remind: () =>
      `🎁 <b>Ежедневный бонус ждёт!</b>\n` +
      `Не забудь забрать награду и сохранить серию 🔥`,

    season_end: () =>
      `🏆 <b>Сезон заканчивается через 24 часа!</b>\n` +
      `Успей войти в топ и получить награды!`,
  };

  const text = templates[type]?.();
  if (!text) return;

  await send(chatId, text, {
    reply_markup: btnOpenGame('🎮 Открыть игру'),
  });
}

// ── Channel announcements ────────────────
async function postToChannel(text) {
  if (!CHANNEL_ID) return;
  await send(CHANNEL_ID, text);
}

// ── Utils ────────────────────────────────
function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ── Main webhook handler ─────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, info: 'Los Santos Bot running' });
  }

  try {
    const update = req.body;

    // Handle callback queries (inline button taps)
    if (update.callback_query) {
      const cq   = update.callback_query;
      const data = cq.data || '';
      await tg('answerCallbackQuery', { callback_query_id: cq.id });

      if (data === 'open_game') {
        await tg('editMessageReplyMarkup', {
          chat_id:    cq.message.chat.id,
          message_id: cq.message.message_id,
          reply_markup: btnOpenGame(),
        });
      }
      return res.status(200).json({ ok: true });
    }

    // Handle messages
    const msg = update.message;
    if (!msg || !msg.text) return res.status(200).json({ ok: true });

    const [cmd, ...args] = msg.text.split(' ');

    switch (cmd.toLowerCase()) {
      case '/start':   await cmdStart(msg, args);   break;
      case '/stats':   await cmdStats(msg);          break;
      case '/top':     await cmdTop(msg);            break;
      case '/collect': await cmdCollect(msg);        break;
      case '/daily':   await cmdDaily(msg);          break;
      case '/help':    await cmdHelp(msg);           break;
      default:
        // Only reply if it looks like an unknown command
        if (msg.text.startsWith('/')) {
          await send(msg.chat.id,
            '❓ Неизвестная команда. Используй /help',
            { reply_markup: btnOpenGame() }
          );
        }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Bot error:', err);
    return res.status(200).json({ ok: true }); // always 200 to Telegram
  }
}
