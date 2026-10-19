// Ma'lumotlar: Telegram CloudStorage (foydalanuvchining barcha qurilmalarida bir xil).
// Telegram tashqarisida ochilsa (sinov uchun) — brauzerning localStorage'i.
//
// CloudStorage cheklovlari: 1024 ta kalit, har bir qiymat 4096 belgigacha. Shuning uchun:
//   m0, m1, …  — meta (to'plamlar, sozlamalar), satr bo'laklarga bo'lib yoziladi
//   g          — kunlik statistika va streak
//   c0, c1, …  — kartalar bo'laklari; har bir karta o'z bo'lagiga biriktirilgan (card.k),
//                shuning uchun baholashda faqat bitta bo'lak qayta yoziladi.
import { schedule } from './srs.js';

const CHUNK_LIMIT = 3900;   // bo'lakning eng katta hajmi (belgi)
const CHUNK_FILL = 3300;    // yangi kartalar shu hajmgacha qo'shiladi (keyingi o'zgarishlarga zaxira)
const LOG_DAYS = 60;
const STATES = ['new', 'learning', 'review'];
export const MAX_FRONT = 300;
export const MAX_BACK = 1000;
export const LEARN_AHEAD = 20 * 60; // sek: navbat tugasa, shu vaqt ichida qaytadigan kartalar ham ko'rsatiladi

const tg = window.Telegram?.WebApp;
export const usingCloud = !!(tg?.initData && tg.isVersionAtLeast?.('6.9') && tg.CloudStorage);

// ---------- backend ----------

const cs = (method, ...args) => new Promise((resolve, reject) => {
  tg.CloudStorage[method](...args, (err, val) => (err ? reject(new Error(String(err))) : resolve(val)));
});

const cloud = {
  keys: () => cs('getKeys'),
  async getMany(keys) {
    const out = {};
    for (let i = 0; i < keys.length; i += 50) Object.assign(out, await cs('getItems', keys.slice(i, i + 50)));
    return out;
  },
  set: (k, v) => cs('setItem', k, v),
  remove: (keys) => (keys.length ? cs('removeItems', keys) : Promise.resolve()),
};

const LP = 'anki:';
const local = {
  async keys() {
    try { return Object.keys(localStorage).filter((k) => k.startsWith(LP)).map((k) => k.slice(LP.length)); }
    catch { return []; }
  },
  async getMany(keys) {
    const out = {};
    try { for (const k of keys) out[k] = localStorage.getItem(LP + k); } catch {}
    return out;
  },
  async set(k, v) { try { localStorage.setItem(LP + k, v); } catch {} },
  async remove(keys) { try { for (const k of keys) localStorage.removeItem(LP + k); } catch {} },
};

const backend = usingCloud ? cloud : local;

// ---------- holat ----------

export const db = {
  decks: [],      // { id, name, lang }
  cards: [],      // { id, d, f, b, s, st, e, i, r, l, due, c, k }
  settings: { newPerDay: 20, autoSpeak: false, remind: true, fromH: 8, toH: 22 },
  nextId: 1,
  log: {},        // { 'YYYY-MM-DD': { n, ok, nw } }
  streak: { last: null, count: 0 },
};

const dirty = { meta: false, log: false, chunks: new Set() };
const existingChunks = new Set();
let metaParts = 0;
let undoInfo = null;

const pack = (c) => [c.id, c.d, c.f, c.b, STATES.indexOf(c.s), c.st, c.e, c.i, c.r, c.l, c.due, c.c];
const unpack = (a, k) => ({
  id: a[0], d: a[1], f: a[2], b: a[3], s: STATES[a[4]] ?? 'new', st: a[5], e: a[6], i: a[7],
  r: a[8], l: a[9], due: a[10], c: a[11], k,
});

export const now = () => Math.floor(Date.now() / 1000);

export async function load() {
  const keys = await backend.keys();
  const vals = await backend.getMany(keys);

  const mKeys = keys.filter((k) => /^m\d+$/.test(k)).sort((a, b) => a.slice(1) - b.slice(1));
  metaParts = mKeys.length;
  if (mKeys.length) {
    try {
      const meta = JSON.parse(mKeys.map((k) => vals[k] ?? '').join(''));
      db.decks = meta.decks ?? [];
      db.nextId = meta.nextId ?? 1;
      Object.assign(db.settings, meta.settings);
    } catch (e) { console.error('meta buzilgan', e); }
  }
  if (vals.g) {
    try {
      const g = JSON.parse(vals.g);
      db.log = g.log ?? {};
      db.streak = g.streak ?? db.streak;
    } catch (e) { console.error('log buzilgan', e); }
  }
  for (const key of keys) {
    if (!/^c\d+$/.test(key)) continue;
    existingChunks.add(key);
    try {
      const k = Number(key.slice(1));
      for (const row of JSON.parse(vals[key])) db.cards.push(unpack(row, k));
    } catch (e) { console.error('bo\'lak buzilgan', key, e); }
  }
  for (const c of db.cards) db.nextId = Math.max(db.nextId, c.id + 1);
  for (const d of db.decks) db.nextId = Math.max(db.nextId, d.id + 1);
  db.cards.sort((a, b) => a.id - b.id);

  if (!db.decks.length) {
    db.decks.push({ id: db.nextId++, name: 'Asosiy', lang: 'en-US' });
    dirty.meta = true;
    save();
  }
}

// ---------- saqlash ----------

let saving = null;
let again = false;
let onError = () => {};
let onChange = () => {};
export const setSaveErrorHandler = (fn) => { onError = fn; };
export const setChangeHandler = (fn) => { onChange = fn; };

export function save() {
  onChange();
  if (saving) { again = true; return saving; }
  saving = doSave()
    .catch((e) => { console.error(e); onError(e); })
    .finally(() => { saving = null; if (again) { again = false; save(); } });
  return saving;
}

const chunkStr = (k) => JSON.stringify(db.cards.filter((c) => c.k === k).map(pack));
const maxChunk = () => db.cards.reduce((m, c) => Math.max(m, c.k), -1);

// Hajmi oshib ketgan bo'lakdan eng katta kartalarni yangi bo'lakka ko'chiradi.
function rebalance() {
  for (const k of [...dirty.chunks]) {
    let str = chunkStr(k);
    while (str.length > CHUNK_LIMIT) {
      const list = db.cards.filter((c) => c.k === k);
      if (list.length <= 1) break;
      const biggest = list.reduce((a, b) => (JSON.stringify(pack(a)).length >= JSON.stringify(pack(b)).length ? a : b));
      biggest.k = maxChunk() + 1;
      dirty.chunks.add(biggest.k);
      str = chunkStr(k);
    }
  }
}

async function doSave() {
  const writes = [];
  const removes = [];
  const failedChunks = [...dirty.chunks];
  const wasMeta = dirty.meta;
  const wasLog = dirty.log;

  if (dirty.chunks.size) {
    rebalance();
    for (const k of dirty.chunks) {
      const key = 'c' + k;
      const str = chunkStr(k);
      if (str !== '[]') { writes.push([key, str]); existingChunks.add(key); }
      else if (existingChunks.has(key)) { removes.push(key); existingChunks.delete(key); }
    }
    dirty.chunks.clear();
  }
  if (dirty.meta) {
    const str = JSON.stringify({ v: 1, decks: db.decks, settings: db.settings, nextId: db.nextId });
    const parts = str.match(/[\s\S]{1,3900}/g) ?? [''];
    parts.forEach((p, i) => writes.push(['m' + i, p]));
    for (let i = parts.length; i < metaParts; i++) removes.push('m' + i);
    metaParts = parts.length;
    dirty.meta = false;
  }
  if (dirty.log) {
    const keep = Object.keys(db.log).sort().slice(-LOG_DAYS);
    db.log = Object.fromEntries(keep.map((d) => [d, db.log[d]]));
    writes.push(['g', JSON.stringify({ log: db.log, streak: db.streak })]);
    dirty.log = false;
  }

  try {
    await Promise.all(writes.map(([k, v]) => backend.set(k, v)));
    await backend.remove(removes);
  } catch (e) {
    // Keyingi saqlashda qayta urinib ko'ramiz
    failedChunks.forEach((k) => dirty.chunks.add(k));
    dirty.meta ||= wasMeta;
    dirty.log ||= wasLog;
    throw e;
  }
}

// ---------- kun / statistika yordamchilari ----------

const DAY_SHIFT = 4 * 3600 * 1000; // kun ertalab soat 4 da almashadi (Anki kabi)
const pad = (n) => String(n).padStart(2, '0');
export function dayKey(ms = Date.now()) {
  const d = new Date(ms - DAY_SHIFT);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function dayStart(ms = Date.now()) {
  const d = new Date(ms - DAY_SHIFT);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + DAY_SHIFT;
}
export const todayLog = () => db.log[dayKey()] ?? { n: 0, ok: 0, nw: 0 };

export function streak() {
  const { last, count } = db.streak;
  return last === dayKey() || last === dayKey(Date.now() - 86400e3) ? count : 0;
}

// ---------- to'plamlar ----------

export const deckById = (id) => db.decks.find((d) => d.id === id);

export function addDeck(name, lang = 'en-US') {
  const deck = { id: db.nextId++, name, lang };
  db.decks.push(deck);
  dirty.meta = true;
  save();
  return deck;
}

export function updateDeck(id, fields) {
  Object.assign(deckById(id), fields);
  dirty.meta = true;
  save();
}

export function deleteDeck(id) {
  for (const c of db.cards) if (c.d === id) dirty.chunks.add(c.k);
  db.cards = db.cards.filter((c) => c.d !== id);
  db.decks = db.decks.filter((d) => d.id !== id);
  dirty.meta = true;
  undoInfo = null;
  save();
}

export function deckCounts(deckId) {
  const t = now();
  let total = 0, fresh = 0, learning = 0, due = 0, learned = 0;
  for (const c of db.cards) {
    if (deckId && c.d !== deckId) continue;
    total++;
    if (c.s === 'review') learned++;
    if (c.s === 'new') fresh++;
    else if (c.due <= t) c.s === 'learning' ? learning++ : due++;
  }
  return { total, new: fresh, learning, due, learned };
}

// ---------- kartalar ----------

const SEPARATORS = ['\t', ' — ', ' – ', ' - ', '=', '|', ';', ':', ',', '-'];

export function parsePairs(text) {
  const pairs = [], bad = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    let ok = false;
    for (const sep of SEPARATORS) {
      const i = line.indexOf(sep);
      if (i < 0) continue;
      const f = line.slice(0, i).trim(), b = line.slice(i + sep.length).trim();
      if (f && b) { pairs.push([f, b]); ok = true; break; }
    }
    if (!ok) bad.push(line);
  }
  return { pairs, bad };
}

// "# To'plam nomi" qatori bilan bo'lingan ro'yxat: [{ name | null, pairs, bad }]
export function parseSections(text) {
  const sections = [{ name: null, lines: [] }];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*#\s*(.+?)\s*$/);
    if (m) sections.push({ name: m[1].slice(0, 60), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  return sections
    .map((s) => ({ name: s.name, ...parsePairs(s.lines.join('\n')) }))
    .filter((s) => s.pairs.length || s.bad.length);
}

export function addCards(deckId, pairs) {
  const existing = new Set(db.cards.filter((c) => c.d === deckId).map((c) => c.f.toLowerCase()));
  let k = Math.max(0, maxChunk());
  let size = chunkStr(k).length;
  let added = 0, skipped = 0;
  const t = now();
  for (let [f, b] of pairs) {
    f = f.slice(0, MAX_FRONT); b = b.slice(0, MAX_BACK);
    if (existing.has(f.toLowerCase())) { skipped++; continue; }
    existing.add(f.toLowerCase());
    const card = { id: db.nextId++, d: deckId, f, b, s: 'new', st: 0, e: 2.5, i: 0, r: 0, l: 0, due: 0, c: t, k };
    const len = JSON.stringify(pack(card)).length + 1;
    if (size + len > CHUNK_FILL && size > 2) { k++; size = 2; card.k = k; }
    size += len;
    db.cards.push(card);
    dirty.chunks.add(card.k);
    added++;
  }
  if (added) { dirty.meta = true; save(); }
  return { added, skipped };
}

export const cardById = (id) => db.cards.find((c) => c.id === id);

export function updateCard(id, f, b) {
  const c = cardById(id);
  c.f = f.slice(0, MAX_FRONT); c.b = b.slice(0, MAX_BACK);
  dirty.chunks.add(c.k);
  save();
}

export function resetCard(id) {
  const c = cardById(id);
  Object.assign(c, { s: 'new', st: 0, e: 2.5, i: 0, r: 0, l: 0, due: 0 });
  dirty.chunks.add(c.k);
  save();
}

export function deleteCard(id) {
  const c = cardById(id);
  if (!c) return;
  dirty.chunks.add(c.k);
  db.cards = db.cards.filter((x) => x.id !== id);
  if (undoInfo?.card.id === id) undoInfo = null;
  save();
}

// ---------- takrorlash ----------

export function queueCounts(deckId) {
  const c = deckCounts(deckId);
  const newLeft = Math.max(0, db.settings.newPerDay - todayLog().nw);
  return { learning: c.learning, due: c.due, new: Math.min(c.new, newLeft) };
}

export function nextCard(deckId) {
  const t = now();
  const inDeck = (c) => !deckId || c.d === deckId;
  let best = null;
  for (const c of db.cards) {
    if (inDeck(c) && c.s !== 'new' && c.due <= t && (!best || c.due < best.due)) best = c;
  }
  if (best) return best;
  if (todayLog().nw < db.settings.newPerDay) {
    const fresh = db.cards.find((c) => inDeck(c) && c.s === 'new');
    if (fresh) return fresh;
  }
  // Boshqa karta qolmagan bo'lsa, tez orada qaytadigan o'rganilayotgan kartani oldinroq ko'rsatamiz
  for (const c of db.cards) {
    if (inDeck(c) && c.s === 'learning' && c.due <= t + LEARN_AHEAD && (!best || c.due < best.due)) best = c;
  }
  return best;
}

export function nextLearningDue(deckId) {
  let min = null;
  for (const c of db.cards) {
    if ((!deckId || c.d === deckId) && c.s === 'learning' && (min === null || c.due < min)) min = c.due;
  }
  return min;
}

const toSrs = (c) => ({ state: c.s, step: c.st, ease: c.e, interval: c.i, lapses: c.l, reps: c.r });

export function intervalsPreview(card) {
  const t = Date.now() / 1000;
  const out = {};
  for (const g of [1, 2, 3, 4]) out[g] = schedule(toSrs(card), g, t).due - t;
  return out;
}

export function answer(card, grade) {
  const key = dayKey();
  undoInfo = {
    card,
    before: { ...card },
    log: db.log[key] ? { ...db.log[key] } : null,
    streak: { ...db.streak },
  };
  const wasNew = card.s === 'new';
  const v = schedule(toSrs(card), grade);
  Object.assign(card, { s: v.state, st: v.step, e: v.ease, i: v.interval, l: v.lapses, r: v.reps, due: v.due });

  const day = db.log[key] ?? (db.log[key] = { n: 0, ok: 0, nw: 0 });
  day.n++;
  if (grade > 1) day.ok++;
  if (wasNew) day.nw++;

  if (db.streak.last !== key) {
    db.streak.count = db.streak.last === dayKey(Date.now() - 86400e3) ? db.streak.count + 1 : 1;
    db.streak.last = key;
  }
  dirty.chunks.add(card.k);
  dirty.log = true;
  save();
}

export const canUndo = () => !!undoInfo && db.cards.includes(undoInfo.card);

export function undo() {
  if (!canUndo()) return null;
  const { card, before, log, streak: st } = undoInfo;
  Object.assign(card, before);
  const key = dayKey();
  if (log) db.log[key] = log; else delete db.log[key];
  db.streak = st;
  undoInfo = null;
  dirty.chunks.add(card.k);
  dirty.log = true;
  save();
  return card;
}

// ---------- statistika ----------

export function stats() {
  const t = now();
  const res = { total: 0, new: 0, learning: 0, young: 0, mature: 0, dueNow: 0 };
  const forecast = Array(7).fill(0);
  const start = dayStart();
  for (const c of db.cards) {
    res.total++;
    if (c.s === 'new') { res.new++; continue; }
    if (c.s === 'learning') res.learning++;
    else if (c.i < 21) res.young++;
    else res.mature++;
    if (c.due <= t) res.dueNow++;
    const day = Math.max(0, Math.floor((c.due * 1000 - start) / 86400e3));
    if (day < 7) forecast[day]++;
  }
  const activity = [];
  for (let i = 29; i >= 0; i--) {
    const key = dayKey(Date.now() - i * 86400e3);
    activity.push({ key, n: db.log[key]?.n ?? 0 });
  }
  return { ...res, forecast, activity, today: todayLog(), streak: streak() };
}

// Eslatma serveri uchun: o'rganilgan so'zlarning keyingi takrorlash vaqtlari
export function reminderDues(limit = 2000) {
  return db.cards.filter((c) => c.s !== 'new').map((c) => c.due).sort((a, b) => a - b).slice(0, limit);
}

// ---------- sozlamalar / zaxira ----------

export function setSetting(key, value) {
  db.settings[key] = value;
  dirty.meta = true;
  save();
}

export function exportJSON() {
  return JSON.stringify({
    app: 'anki-tg', v: 1,
    decks: db.decks,
    settings: db.settings,
    cards: db.cards.map(({ k, ...c }) => c),
  });
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.decks) || !Array.isArray(data.cards)) throw new Error('Fayl formati noto\'g\'ri');
  wipeLocal();
  db.decks = data.decks.map((d) => ({ id: d.id, name: String(d.name), lang: d.lang ?? 'en-US' }));
  Object.assign(db.settings, data.settings);
  db.nextId = 1;
  for (const d of db.decks) db.nextId = Math.max(db.nextId, d.id + 1);
  let k = 0, size = 2;
  for (const c of data.cards) {
    if (!deckById(c.d)) continue;
    const card = { s: 'new', st: 0, e: 2.5, i: 0, r: 0, l: 0, due: 0, c: now(), ...c, k: 0 };
    card.f = String(card.f).slice(0, MAX_FRONT); card.b = String(card.b).slice(0, MAX_BACK);
    const len = JSON.stringify(pack(card)).length + 1;
    if (size + len > CHUNK_FILL && size > 2) { k++; size = 2; }
    card.k = k; size += len;
    db.cards.push(card);
    dirty.chunks.add(k);
    db.nextId = Math.max(db.nextId, card.id + 1);
  }
  if (!db.decks.length) db.decks.push({ id: db.nextId++, name: 'Asosiy', lang: 'en-US' });
  dirty.meta = true;
  return save();
}

function wipeLocal() {
  for (const key of existingChunks) {
    const k = Number(key.slice(1));
    dirty.chunks.add(k);
  }
  db.cards = [];
  db.decks = [];
  undoInfo = null;
}

export function wipeAll() {
  wipeLocal();
  db.log = {};
  db.streak = { last: null, count: 0 };
  db.decks.push({ id: db.nextId++, name: 'Asosiy', lang: 'en-US' });
  dirty.meta = true;
  dirty.log = true;
  return save();
}
