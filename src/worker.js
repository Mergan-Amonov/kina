// Cloudflare Worker:
//   /            — Mini App fayllari (public/ papkadan, Cloudflare o'zi beradi)
//   /api/sync    — Mini App foydalanuvchining takrorlash vaqtlarini yuboradi
//   /webhook     — Telegram bot yangilanishlari (/start)
//   /setup?key=… — webhook va menyu tugmasini bir marta sozlash
//   cron         — har 15 daqiqada vaqti kelgan foydalanuvchilarga eslatma yuboradi

const HOUR = 3600;
const MIN_GAP = 4 * HOUR;        // ikki eslatma orasidagi eng kam vaqt
const QUIET_AFTER_USE = 1 * HOUR; // ilovadan foydalangandan keyin shuncha vaqt bezovta qilmaymiz
const MAX_DUES = 2000;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/api/sync' && req.method === 'POST') return await sync(req, env);
      if (url.pathname === '/webhook' && req.method === 'POST') return await webhook(req, env);
      if (url.pathname === '/setup') return await setup(url, env);
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: 'internal' }, 500);
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});
const now = () => Math.floor(Date.now() / 1000);

async function tg(env, method, params) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function appUrl(env) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'app_url'").first();
  return row?.value;
}

// ---------- Mini App init data tekshiruvi ----------
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

const enc = new TextEncoder();

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

export async function verifyInitData(initData, botToken, maxAge = 7 * 24 * HOUR) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const sig = await hmac(secret, checkString);
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  let diff = hex.length ^ hash.length;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff) return null;
  if (now() - Number(params.get('auth_date')) > maxAge) return null;
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

// ---------- /api/sync ----------

const clampInt = (v, min, max, def) => (Number.isInteger(v) && v >= min && v <= max ? v : def);

async function sync(req, env) {
  const body = await req.json().catch(() => null);
  if (!body?.initData) return json({ ok: false, error: 'bad request' }, 400);
  const user = await verifyInitData(body.initData, env.BOT_TOKEN);
  if (!user?.id) return json({ ok: false, error: 'unauthorized' }, 401);

  const dues = (Array.isArray(body.dues) ? body.dues : [])
    .filter((t) => Number.isInteger(t) && t > 0)
    .sort((a, b) => a - b)
    .slice(0, MAX_DUES);
  const tz = clampInt(body.tz, -720, 840, 300);
  const fromH = clampInt(body.fromH, 0, 23, 8);
  const toH = clampInt(body.toH, 0, 24, 22);
  const remind = body.remind === false ? 0 : 1;

  await env.DB.prepare(`
    INSERT INTO users (id, dues, next_due, tz, remind, from_h, to_h, synced_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(id) DO UPDATE SET
      dues = excluded.dues, next_due = excluded.next_due, tz = excluded.tz, remind = excluded.remind,
      from_h = excluded.from_h, to_h = excluded.to_h, synced_at = excluded.synced_at
  `).bind(user.id, JSON.stringify(dues), dues[0] ?? null, tz, remind, fromH, toH, now()).run();

  return json({ ok: true });
}

// ---------- eslatmalar (cron) ----------

function inWindow(hour, fromH, toH) {
  if (fromH === toH) return true;
  return fromH < toH ? hour >= fromH && hour < toH : hour >= fromH || hour < toH;
}

export function shouldRemind(u, t = now()) {
  const dues = JSON.parse(u.dues);
  const count = dues.filter((d) => d <= t).length;
  if (!count) return 0;
  const localHour = new Date((t + u.tz * 60) * 1000).getUTCHours();
  if (!inWindow(localHour, u.from_h, u.to_h)) return 0;
  if (u.last_notified) {
    // Yangi so'zlar vaqti kelgan bo'lsa yoki bir kun o'tgan bo'lsa — yana eslatamiz
    const fresh = dues.some((d) => d > u.last_notified && d <= t);
    if (!fresh && t - u.last_notified < 24 * HOUR) return 0;
  }
  return count;
}

async function sendReminders(env) {
  const t = now();
  const url = await appUrl(env);
  const { results } = await env.DB.prepare(`
    SELECT id, dues, tz, from_h, to_h, last_notified FROM users
    WHERE remind = 1 AND next_due <= ?1
      AND (synced_at IS NULL OR synced_at <= ?2)
      AND (last_notified IS NULL OR last_notified <= ?3)
    LIMIT 1000
  `).bind(t, t - QUIET_AFTER_USE, t - MIN_GAP).all();

  for (const u of results) {
    const count = shouldRemind(u, t);
    if (!count) continue;
    const res = await tg(env, 'sendMessage', {
      chat_id: u.id,
      text: `🔔 Takrorlash vaqti keldi!\n\n<b>${count}</b> ta so'z sizni kutmoqda.`,
      parse_mode: 'HTML',
      reply_markup: url ? { inline_keyboard: [[{ text: '📖 Boshlash', web_app: { url } }]] } : undefined,
    });
    if (res.ok) {
      await env.DB.prepare('UPDATE users SET last_notified = ?1 WHERE id = ?2').bind(t, u.id).run();
    } else if (res.error_code === 403) {
      // Foydalanuvchi botni bloklagan — boshqa yozmaymiz
      await env.DB.prepare('UPDATE users SET remind = 0 WHERE id = ?1').bind(u.id).run();
    } else {
      console.warn('sendMessage', u.id, res.description);
    }
  }
}

// ---------- bot ----------

async function webhook(req, env) {
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await req.json();
  const msg = update.message;
  if (msg?.chat?.type === 'private') {
    const url = await appUrl(env);
    await tg(env, 'sendMessage', {
      chat_id: msg.chat.id,
      text: "Salom! 👋\n\nBu bot Anki usulida so'z yodlashga yordam beradi. "
        + "Ilovani ochib so'z qo'shing va har kuni takrorlang. Takrorlash vaqti kelganda "
        + 'shu yerga eslatma keladi 🔔',
      reply_markup: url ? { inline_keyboard: [[{ text: '📚 Ilovani ochish', web_app: { url } }]] } : undefined,
    });
  }
  return new Response('ok');
}

async function setup(url, env) {
  if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const origin = url.origin;
  const app = origin + '/';
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('app_url', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(app).run();
  const results = {
    webhook: await tg(env, 'setWebhook', {
      url: origin + '/webhook', secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message'],
    }),
    menu: await tg(env, 'setChatMenuButton', {
      menu_button: { type: 'web_app', text: '📚 Ochish', web_app: { url: app } },
    }),
    commands: await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Botni ishga tushirish' }] }),
  };
  return json({ app_url: app, ...results });
}
