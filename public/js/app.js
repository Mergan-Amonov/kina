import * as S from './store.js';
import { humanDelay } from './srs.js';

const tg = window.Telegram?.WebApp;
const inTelegram = !!tg?.initData;
const backButton = inTelegram && tg.isVersionAtLeast?.('6.1') ? tg.BackButton : null;
const WEEKDAYS = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const haptic = (type = 'light') => { try { tg?.HapticFeedback?.impactOccurred(type); } catch {} };
const notify = (type) => { try { tg?.HapticFeedback?.notificationOccurred(type); } catch {} };

const svg = (body, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  play: svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  flame: svg('<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.1-1.9-5.2-3.4-6.9-.3 1.6-1.1 2.8-2.3 3.3.3-3.2-1-6.6-4.3-8.8.1 3-1.4 5-3 6.8C4.6 11.4 5 13 5 15.4 5 19.1 7.6 22 12 22z"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  sound: svg('<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  gear: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
};

function ring(p, label) {
  const r = 30, c = 2 * Math.PI * r;
  return `<div class="ring"><svg viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r="${r}" class="ring-bg"/>
      <circle cx="36" cy="36" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/>
    </svg><div class="ring-num">${label}</div></div>`;
}

const LANGS = [
  ['en-US', 'Inglizcha'], ['ru-RU', 'Ruscha'], ['de-DE', 'Nemischa'], ['fr-FR', 'Fransuzcha'],
  ['es-ES', 'Ispancha'], ['tr-TR', 'Turkcha'], ['ar-SA', 'Arabcha'], ['ko-KR', 'Koreyscha'],
  ['ja-JP', 'Yaponcha'], ['zh-CN', 'Xitoycha'], ['', 'Talaffuzsiz'],
];
const canSpeak = 'speechSynthesis' in window;

function speak(text, lang) {
  if (!canSpeak || !lang) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    speechSynthesis.speak(u);
  } catch {}
}

// ---------- toast / modal ----------

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function modal(title, bodyHtml, actions) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>${bodyHtml}
        <div class="actions">${actions.map((a, i) =>
          `<button class="btn ${a.cls ?? ''}" data-i="${i}">${esc(a.text)}</button>`).join('')}</div>
      </div></div>`;
    const bg = $('.modal-bg', root);
    const close = (value) => { root.innerHTML = ''; resolve(value); };
    bg.addEventListener('click', (e) => {
      if (e.target === bg) return close(null);
      const btn = e.target.closest('[data-i]');
      if (!btn) return;
      const a = actions[btn.dataset.i];
      const value = a.value ? a.value(root) : a.text;
      if (value === false) return; // validatsiyadan o'tmadi
      close(value);
    });
    const first = $('input, textarea', root);
    if (first) setTimeout(() => first.focus(), 50);
  });
}

const confirmBox = (title, text, okText = "O'chirish") => modal(title, `<p class="hint">${esc(text)}</p>`, [
  { text: okText, cls: 'primary', value: () => true },
  { text: 'Bekor qilish', value: () => null },
]);

// ---------- navigatsiya ----------

let stack = [{ name: 'home' }];
const current = () => stack[stack.length - 1];

function go(name, params = {}) { stack.push({ name, ...params }); render(); window.scrollTo(0, 0); }
function back() { if (stack.length > 1) { stack.pop(); render(); } }
function tab(name) { stack = [{ name }]; render(); window.scrollTo(0, 0); }

backButton?.onClick(back);
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) { haptic(); tab(b.dataset.tab); }
});

const topbar = (title) => `
  ${!inTelegram && stack.length > 1 ? '<div class="topbar"><button class="back" data-a="back">‹ Orqaga</button></div>' : ''}
  ${title ? `<h1>${esc(title)}</h1>` : ''}`;

let reviewTimer;
function render() {
  clearInterval(reviewTimer);
  const r = current();
  const screens = { home, deck, add, review, cards, stats, settings };
  (screens[r.name] ?? home)(r);

  const tabName = stack[0].name;
  const hideTabs = r.name === 'review';
  $('#tabs').hidden = hideTabs;
  document.body.classList.toggle('no-tabs', hideTabs);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tabName);
  if (backButton) stack.length > 1 ? backButton.show() : backButton.hide();
}

// Barcha tugmalar uchun yagona tinglovchi: data-a="action"
const actions = {};
view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || !actions[el.dataset.a]) return;
  actions[el.dataset.a](el, e);
});
actions.back = back;

// ---------- bosh sahifa ----------

const SAMPLE = [
  ['apple', 'olma'], ['book', 'kitob'], ['water', 'suv'], ['house', 'uy'], ['friend', "do'st"],
  ['to learn', "o'rganmoq"], ['beautiful', 'chiroyli'], ['tomorrow', 'ertaga'], ['always', 'doimo'],
  ['to remember', 'eslamoq'], ['difficult', 'qiyin'], ['window', 'deraza'],
];

function home() {
  const q = S.queueCounts(0);
  const todo = q.learning + q.due + q.new;
  const st = S.stats();
  const done = st.today.n;
  const p = todo + done ? done / (todo + done) : 0;
  const name = tg?.initDataUnsafe?.user?.first_name;
  // Bo'sh "Asosiy" to'plami boshqa to'plamlar bo'lsa ko'rsatilmaydi
  const decks = S.db.decks
    .map((d) => ({ d, c: S.deckCounts(d.id), q: S.queueCounts(d.id) }))
    .filter(({ d, c }) => !(c.total === 0 && d.name === 'Asosiy' && S.db.decks.length > 1));

  view.innerHTML = `
    ${topbar()}
    <section class="hero">
      <div class="hero-text">
        <div class="hello">${name ? `Salom, ${esc(name)}!` : 'Salom!'}</div>
        <div class="hero-title">${
          !st.total ? "Birinchi so'zlaringizni qo'shing"
          : todo ? `Bugun <b>${todo}</b> ta so'z kutmoqda`
          : 'Bugungi reja bajarildi!'}</div>
        ${!st.total
          ? `<button class="hero-btn" data-a="addTab">${ICON.plus}So'z qo'shish</button>`
          : todo ? `<button class="hero-btn" data-a="review" data-deck="0">${ICON.play}Boshlash</button>`
          : `<div class="hero-sub">Ertaga yangi so'zlar kutadi 🌙</div>`}
      </div>
      ${st.total ? ring(p, `${Math.round(p * 100)}%`) : ''}
    </section>

    <div class="stats3">
      <div class="stat"><span class="ic fire">${ICON.flame}</span><b>${st.streak}</b><small>kun ketma-ket</small></div>
      <div class="stat"><span class="ic ok">${ICON.check}</span><b>${done}</b><small>bugun ko'rildi</small></div>
      <div class="stat"><span class="ic lay">${ICON.layers}</span><b>${st.total}</b><small>jami so'z</small></div>
    </div>

    ${!st.total ? `
      <button class="sample-card" data-a="sample">
        <span class="ic">${ICON.sparkle}</span>
        <span><b>Namunaviy to'plam</b><small>12 ta inglizcha so'z bilan sinab ko'ring</small></span>
      </button>` : ''}

    <div class="section-head">
      <h2>To'plamlar</h2>
      <button class="link" data-a="newDeck">${ICON.plus}Yangi</button>
    </div>
    <div class="decks">${decks.map(deckCard).join('')}</div>
  `;
}

function deckCard({ d, c, q }) {
  const todo = q.new + q.learning + q.due;
  const mastery = c.total ? Math.round((100 * c.learned) / c.total) : 0;
  return `
    <div class="deck-card" data-a="openDeck" data-id="${d.id}" role="button" tabindex="0">
      <div class="deck-top">
        <div class="deck-info">
          <div class="deck-name">${esc(d.name)}</div>
          <div class="deck-meta">${c.total ? `${c.total} so'z · ${mastery}% o'zlashtirildi` : "Bo'sh to'plam"}</div>
        </div>
        ${todo ? `<button class="play" data-a="review" data-deck="${d.id}" aria-label="Takrorlash">${ICON.play}</button>` : ''}
      </div>
      ${c.total ? `<div class="bar"><i style="width:${mastery}%"></i></div>` : ''}
      <div class="chips">
        ${q.due ? `<span class="chip due">${q.due} takrorlash</span>` : ''}
        ${q.learning ? `<span class="chip learn">${q.learning} o'rganilmoqda</span>` : ''}
        ${q.new ? `<span class="chip new">${q.new} yangi</span>` : ''}
        ${!todo && c.total ? `<span class="chip ok">${ICON.check}Bugunga tayyor</span>` : ''}
      </div>
    </div>`;
}

actions.review = (el) => { haptic(); go('review', { deckId: Number(el.dataset.deck) }); };
actions.openDeck = (el) => { haptic(); go('deck', { deckId: Number(el.dataset.id) }); };
actions.addTab = () => tab('add');
actions.sample = () => {
  const deck = S.addDeck('Ingliz tili — namuna', 'en-US');
  S.addCards(deck.id, SAMPLE);
  toast(`✅ ${SAMPLE.length} ta so'z qo'shildi`);
  render();
};

async function deckForm(title, deck = { name: '', lang: 'en-US' }) {
  return modal(title, `
    <label class="field"><span>Nomi</span>
      <input class="input" id="m-name" maxlength="60" value="${esc(deck.name)}" placeholder="Masalan: IELTS so'zlari"></label>
    ${canSpeak ? `<label class="field"><span>Talaffuz tili (🔊 tugmasi uchun)</span>
      <select class="input" id="m-lang">${LANGS.map(([v, n]) =>
        `<option value="${v}" ${v === deck.lang ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
  `, [
    { text: 'Saqlash', cls: 'primary', value: (root) => {
      const name = $('#m-name', root).value.trim();
      if (!name) { toast('Nomini kiriting'); return false; }
      return { name, lang: $('#m-lang', root)?.value ?? deck.lang };
    } },
    { text: 'Bekor qilish', value: () => null },
  ]);
}

actions.newDeck = async () => {
  const res = await deckForm("Yangi to'plam");
  if (!res) return;
  const deck = S.addDeck(res.name, res.lang);
  go('add', { deckId: deck.id });
};

// ---------- to'plam ----------

function deck({ deckId }) {
  const d = S.deckById(deckId);
  if (!d) return back();
  const c = S.deckCounts(deckId);
  const q = S.queueCounts(deckId);
  const todo = q.new + q.learning + q.due;
  const mastery = c.total ? c.learned / c.total : 0;
  view.innerHTML = `
    ${topbar()}
    <section class="deck-hero">
      <div class="deck-hero-text">
        <h1>${esc(d.name)}</h1>
        <div class="deck-meta">${c.total} so'z · ${c.learned} tasi o'zlashtirildi</div>
      </div>
      ${ring(mastery, `${Math.round(mastery * 100)}%`)}
    </section>
    <div class="stats3">
      <div class="stat"><b class="c-due">${q.due}</b><small>takrorlash</small></div>
      <div class="stat"><b class="c-learn">${q.learning}</b><small>o'rganilmoqda</small></div>
      <div class="stat"><b class="c-new">${q.new}</b><small>yangi (bugun)</small></div>
    </div>
    <button class="btn primary big" data-a="review" data-deck="${deckId}" ${c.total ? '' : 'disabled'}>
      ${ICON.play}${todo ? `Takrorlash · ${todo}` : 'Takrorlash'}
    </button>
    <div class="btn-row">
      <button class="btn" data-a="addTo" data-id="${deckId}">${ICON.plus}Qo'shish</button>
      <button class="btn" data-a="cardList" data-id="${deckId}">${ICON.list}So'zlar</button>
    </div>
    <div class="list" style="margin-top:20px">
      <button class="row" data-a="editDeck" data-id="${deckId}"><span class="row-ic">${ICON.edit}</span><div class="row-main">Nomi va talaffuz tili</div><span class="chev">›</span></button>
      <button class="row danger" data-a="deleteDeck" data-id="${deckId}"><span class="row-ic">${ICON.trash}</span><div class="row-main">To'plamni o'chirish</div></button>
    </div>
  `;
}

actions.addTo = (el) => go('add', { deckId: Number(el.dataset.id) });
actions.cardList = (el) => go('cards', { deckId: Number(el.dataset.id) });
actions.editDeck = async (el) => {
  const d = S.deckById(Number(el.dataset.id));
  const res = await deckForm("To'plamni tahrirlash", d);
  if (res) { S.updateDeck(d.id, res); render(); }
};
actions.deleteDeck = async (el) => {
  const id = Number(el.dataset.id);
  if (S.db.decks.length <= 1) return toast("Oxirgi to'plamni o'chirib bo'lmaydi");
  const d = S.deckById(id);
  const n = S.deckCounts(id).total;
  if (await confirmBox(`"${d.name}" o'chirilsinmi?`, `To'plam va undagi ${n} ta so'z butunlay o'chiriladi.`)) {
    S.deleteDeck(id);
    toast("O'chirildi");
    back();
  }
};

// ---------- so'z qo'shish ----------

let addMode = 'one';
let lastDeck = null;

function add(r) {
  const deckId = S.deckById(r.deckId)?.id ?? S.deckById(lastDeck)?.id ?? S.db.decks[0].id;
  r.deckId = deckId;
  lastDeck = deckId;
  const recent = S.db.cards.filter((c) => c.d === deckId).slice(-5).reverse();

  view.innerHTML = `
    ${topbar("So'z qo'shish")}
    <label class="field"><span>To'plam</span>
      <select class="input" id="deck-sel">
        ${S.db.decks.map((d) => `<option value="${d.id}" ${d.id === deckId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
      </select></label>
    <div class="seg">
      <button data-a="mode" data-m="one" class="${addMode === 'one' ? 'on' : ''}">Bittalab</button>
      <button data-a="mode" data-m="bulk" class="${addMode === 'bulk' ? 'on' : ''}">Ro'yxat / fayl</button>
    </div>
    ${addMode === 'one' ? `
      <label class="field"><span>So'z</span>
        <input class="input" id="front" maxlength="${S.MAX_FRONT}" placeholder="Masalan: apple" autocomplete="off" enterkeyhint="next"></label>
      <label class="field"><span>Tarjimasi / ma'nosi</span>
        <textarea class="input" id="back" rows="2" maxlength="${S.MAX_BACK}" placeholder="Masalan: olma" enterkeyhint="done"></textarea></label>
      <button class="btn primary" data-a="addOne">Qo'shish</button>
    ` : `
      <p class="hint" style="margin:0 4px 8px">Har qatorga bitta so'z, ajratuvchi: <code>-</code> <code>=</code> <code>|</code> <code>:</code> yoki Tab</p>
      <pre class="sample">apple - olma
to run - yugurmoq
beautiful = chiroyli</pre>
      <p class="hint" style="margin:0 4px 8px"><code># To'plam nomi</code> qatori — keyingi so'zlar shu nomli to'plamga tushadi (bo'lmasa yaratiladi)</p>
      <textarea class="input" id="bulk" rows="8" placeholder="So'zlarni shu yerga yozing yoki joylang…"></textarea>
      <div class="btn-row">
        <label class="btn file-btn">📄 Fayldan<input type="file" id="file" accept=".txt,.csv,.tsv,text/plain,text/csv"></label>
        <button class="btn primary" data-a="addBulk">Qo'shish</button>
      </div>
    `}
    ${recent.length ? `
      <h2 class="section recent">Oxirgi qo'shilganlar</h2>
      <div class="list">${recent.map((c) => `
        <div class="row"><div class="row-main"><div class="row-title">${esc(c.f)}</div><div class="row-sub">${esc(c.b)}</div></div></div>`).join('')}
      </div>` : ''}
  `;

  $('#deck-sel').addEventListener('change', (e) => { r.deckId = Number(e.target.value); render(); });
  if (addMode === 'one') {
    const front = $('#front'), backEl = $('#back');
    front.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); backEl.focus(); } });
    backEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); actions.addOne(); } });
  } else {
    $('#file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2_000_000) return toast('Fayl 2 MB dan katta');
      $('#bulk').value = await file.text();
      toast('Fayl o\'qildi — "Qo\'shish" ni bosing');
    });
  }
}

actions.mode = (el) => { addMode = el.dataset.m; render(); };
actions.addOne = () => {
  const f = $('#front').value.trim(), b = $('#back').value.trim();
  if (!f || !b) return toast("So'z va tarjimani kiriting");
  const { added } = S.addCards(current().deckId, [[f, b]]);
  if (!added) return toast("Bu so'z to'plamda allaqachon bor");
  haptic();
  toast(`✅ "${f}" qo'shildi`);
  render();
  $('#front').focus();
};
actions.addBulk = () => {
  const sections = S.parseSections($('#bulk').value);
  if (!sections.some((s) => s.pairs.length)) return toast("Hech narsa topilmadi. Format: so'z - tarjima");
  let added = 0, skipped = 0, bad = 0, newDecks = 0;
  for (const s of sections) {
    let deckId = current().deckId;
    if (s.name) {
      let deck = S.db.decks.find((d) => d.name.toLowerCase() === s.name.toLowerCase());
      if (!deck) { deck = S.addDeck(s.name, 'en-US'); newDecks++; }
      deckId = deck.id;
    }
    const r = S.addCards(deckId, s.pairs);
    added += r.added;
    skipped += r.skipped;
    bad += s.bad.length;
  }
  notify('success');
  let msg = `✅ ${added} ta so'z qo'shildi`;
  if (newDecks) msg += `, ${newDecks} ta yangi to'plam`;
  if (skipped) msg += `, ${skipped} ta takroriy`;
  if (bad) msg += `, ${bad} qator tushunilmadi`;
  toast(msg);
  if (newDecks) tab('home'); else render();
};

// ---------- takrorlash ----------

const GRADES = [[1, 'Qayta'], [2, 'Qiyin'], [3, 'Yaxshi'], [4, 'Oson']];

function review(r) {
  const card = S.nextCard(r.deckId || 0);
  r.cardId = card?.id;
  r.shown = false;

  if (!card) {
    const next = S.nextLearningDue(r.deckId || 0);
    const st = S.stats();
    const acc = st.today.n ? Math.round((100 * st.today.ok) / st.today.n) : 0;
    view.innerHTML = `
      <div class="done">
        ${next ? `
          <div class="done-emoji">⏳</div>
          <h1>Biroz kuting</h1>
          <p class="hint">O'rganilayotgan so'zlar <b id="wait">${humanDelay(next - S.now())}</b>dan keyin qaytadi.</p>
        ` : `
          <div class="done-emoji">🎉</div>
          <h1>Ajoyib, bugungi takrorlash tugadi!</h1>
          <div class="stats3 done-stats">
            <div class="stat"><b>${st.today.n}</b><small>karta</small></div>
            <div class="stat"><b>${acc}%</b><small>to'g'ri</small></div>
            <div class="stat"><span class="ic fire">${ICON.flame}</span><b>${st.streak}</b><small>kun ketma-ket</small></div>
          </div>
        `}
        <button class="btn primary big" data-a="back">Bosh sahifaga</button>
      </div>`;
    if (next) {
      reviewTimer = setInterval(() => {
        if (S.now() >= next - S.LEARN_AHEAD) render();
        else $('#wait').textContent = humanDelay(next - S.now());
      }, 5000);
    } else notify('success');
    return;
  }

  const deckObj = S.deckById(card.d);
  const q = S.queueCounts(r.deckId || 0);
  const times = S.intervalsPreview(card);
  const left = q.new + q.learning + q.due;
  r.done ??= 0;
  const pct = r.done + left ? (100 * r.done) / (r.done + left) : 0;
  const badge = { new: ['new', 'Yangi'], learning: ['learn', "O'rganilmoqda"], review: ['due', 'Takrorlash'] }[card.s];
  const speakBtn = canSpeak && deckObj?.lang ? `<button class="speak" data-a="speak" aria-label="Tinglash">${ICON.sound}</button>` : '';
  view.innerHTML = `
    <div class="rv">
      <div class="rv-head">
        ${!inTelegram ? `<button class="icon-btn" data-a="back" aria-label="Orqaga">${ICON.back}</button>` : ''}
        <div class="rv-progress"><i style="width:${pct}%"></i></div>
        <span class="rv-left">${left}</span>
        <button class="icon-btn" data-a="undo" aria-label="Ortga qaytarish" ${S.canUndo() ? '' : 'disabled'}>${ICON.undo}</button>
        <button class="icon-btn" data-a="editCurrent" aria-label="Tahrirlash">${ICON.edit}</button>
      </div>
      <div class="rv-counts">
        <span class="chip due ${q.due ? '' : 'zero'}">${q.due} takrorlash</span>
        <span class="chip learn ${q.learning ? '' : 'zero'}">${q.learning} o'rganilmoqda</span>
        <span class="chip new ${q.new ? '' : 'zero'}">${q.new} yangi</span>
      </div>
      <div class="card-wrap" data-a="flip">
        <div class="card3d" id="card">
          <div class="face front">
            <div class="face-top"><span class="chip ${badge[0]}">${badge[1]}</span><span class="deck-name">${esc(deckObj?.name)}</span></div>
            <div class="word">${esc(card.f)}</div>
            ${speakBtn}
            <div class="tap-hint">Javobni eslang va kartaga bosing</div>
          </div>
          <div class="face back">
            <div class="face-top"><span class="chip ${badge[0]}">${badge[1]}</span><span class="deck-name">${esc(deckObj?.name)}</span></div>
            <div class="front-small">${esc(card.f)}</div>
            <hr>
            <div class="answer">${esc(card.b)}</div>
            ${speakBtn}
          </div>
        </div>
      </div>
      <div id="rv-actions">
        <button class="btn primary big" data-a="flip">Javobni ko'rsatish</button>
      </div>
    </div>
  `;
  r.times = times;
  if (S.db.settings.autoSpeak) speak(card.f, deckObj?.lang);
}

function showAnswer() {
  const r = current();
  if (r.name !== 'review' || r.shown || !r.cardId) return;
  r.shown = true;
  haptic();
  $('#card').classList.add('flipped');
  $('#rv-actions').innerHTML = `<div class="grades">${GRADES.map(([g, name]) =>
    `<button class="g${g}" data-a="grade" data-g="${g}">${name}<small>${humanDelay(r.times[g])}</small></button>`).join('')}</div>`;
}

function grade(g) {
  const r = current();
  if (r.name !== 'review' || !r.shown) return;
  const card = S.cardById(r.cardId);
  if (!card) return render();
  S.answer(card, g);
  r.done = (r.done ?? 0) + 1;
  haptic(g === 1 ? 'heavy' : 'light');
  render();
}

actions.flip = (el, e) => {
  if (e.target.closest('[data-a="speak"]')) return;
  showAnswer();
};
actions.grade = (el) => grade(Number(el.dataset.g));
actions.speak = (el, e) => {
  e.stopPropagation();
  const card = S.cardById(current().cardId);
  if (card) speak(card.f, S.deckById(card.d)?.lang);
};
actions.undo = () => {
  if (S.undo()) {
    const r = current();
    if (r.done) r.done--;
    toast('↶ Oxirgi baho bekor qilindi');
    render();
  }
};
actions.editCurrent = () => editCard(current().cardId);

document.addEventListener('keydown', (e) => {
  if (current().name !== 'review' || $('#modal-root').children.length || e.target.matches('input, textarea')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); current().shown ? grade(3) : showAnswer(); }
  else if (['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key));
  else if (e.key === 'z' || e.key === 'Backspace') actions.undo();
});

// ---------- so'zlar ro'yxati ----------

const STATE_NAMES = { new: 'Yangi', learning: "O'rganilmoqda", review: 'Takrorlashda' };

function cards(r) {
  const d = S.deckById(r.deckId);
  if (!d) return back();
  r.limit ??= 100;
  view.innerHTML = `
    ${topbar(d.name)}
    <input class="input" id="search" placeholder="🔍 Qidirish…" value="${esc(r.query ?? '')}" style="margin-bottom:12px">
    <div id="card-list"></div>
  `;
  const draw = () => {
    const q = (r.query ?? '').toLowerCase();
    const all = S.db.cards.filter((c) => c.d === d.id && (!q || c.f.toLowerCase().includes(q) || c.b.toLowerCase().includes(q))).reverse();
    $('#card-list').innerHTML = all.length ? `
      <p class="hint" style="margin:0 4px 8px">${all.length} ta so'z</p>
      <div class="list">${all.slice(0, r.limit).map((c) => `
        <button class="row" data-a="editCard" data-id="${c.id}">
          <span class="dot ${c.s}"></span>
          <div class="row-main"><div class="row-title">${esc(c.f)}</div><div class="row-sub">${esc(c.b)}</div></div>
          <span class="chev">›</span>
        </button>`).join('')}
      </div>
      ${all.length > r.limit ? `<button class="btn" style="margin-top:8px" data-a="more">Yana ko'rsatish</button>` : ''}
    ` : `<div class="empty"><p class="hint">${q ? 'Hech narsa topilmadi' : "Bu to'plamda hali so'z yo'q"}</p></div>`;
  };
  draw();
  $('#search').addEventListener('input', (e) => { r.query = e.target.value; r.limit = 100; draw(); });
}

actions.more = () => { current().limit += 100; render(); };
actions.editCard = (el) => editCard(Number(el.dataset.id));

const pad2 = (n) => String(n).padStart(2, '0');
function fmtDate(sec) {
  const d = new Date(sec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

async function editCard(id) {
  const c = S.cardById(id);
  if (!c) return;
  const due = c.s === 'new' ? '—' : fmtDate(c.due);
  const res = await modal("So'zni tahrirlash", `
    <label class="field"><span>So'z</span><input class="input" id="m-f" maxlength="${S.MAX_FRONT}" value="${esc(c.f)}"></label>
    <label class="field"><span>Tarjimasi</span><textarea class="input" id="m-b" rows="3" maxlength="${S.MAX_BACK}">${esc(c.b)}</textarea></label>
    <p class="hint">Holat: ${STATE_NAMES[c.s]} · Keyingi takrorlash: ${due}<br>
      Takrorlangan: ${c.r} marta · Unutilgan: ${c.l} marta · Interval: ${c.s === 'review' ? Math.round(c.i) + ' kun' : '—'}</p>
  `, [
    { text: 'Saqlash', cls: 'primary', value: (root) => {
      const f = $('#m-f', root).value.trim(), b = $('#m-b', root).value.trim();
      if (!f || !b) { toast("Bo'sh qoldirib bo'lmaydi"); return false; }
      return { act: 'save', f, b };
    } },
    { text: '🔄 Progressni nolga tushirish', value: () => ({ act: 'reset' }) },
    { text: "🗑 O'chirish", cls: 'danger', value: () => ({ act: 'delete' }) },
    { text: 'Yopish', value: () => null },
  ]);
  if (!res) return;
  if (res.act === 'save') { S.updateCard(id, res.f, res.b); toast('Saqlandi'); }
  if (res.act === 'reset') { S.resetCard(id); toast('Karta yangi holatga qaytarildi'); }
  if (res.act === 'delete') {
    if (!(await confirmBox(`"${c.f}" o'chirilsinmi?`, 'Bu amalni ortga qaytarib bo\'lmaydi.'))) return;
    S.deleteCard(id);
    toast("O'chirildi");
  }
  render();
}

// ---------- statistika ----------

function stats() {
  const s = S.stats();
  const acc = s.today.n ? Math.round((100 * s.today.ok) / s.today.n) : 0;
  const pct = (n) => (s.total ? (100 * n) / s.total : 0);
  const maxF = Math.max(1, ...s.forecast);
  const maxA = Math.max(1, ...s.activity.map((a) => a.n));
  const dayNames = ['Bugun', 'Ertaga', ...Array.from({ length: 5 }, (_, i) =>
    WEEKDAYS[new Date(Date.now() + (i + 2) * 86400e3).getDay()])];

  view.innerHTML = `
    ${topbar('Statistika')}
    <div class="pills">
      <div class="pill"><b>${s.today.n}</b><span>bugun ko'rildi</span></div>
      <div class="pill"><b>${acc}%</b><span>to'g'ri javob</span></div>
      <div class="pill"><b>🔥 ${s.streak}</b><span>kun ketma-ket</span></div>
    </div>

    <h2 class="section">Kartalar</h2>
    <div class="stat-card">
      <div class="stack">
        <div style="width:${pct(s.new)}%;background:var(--c-new)"></div>
        <div style="width:${pct(s.learning)}%;background:var(--c-learn)"></div>
        <div style="width:${pct(s.young)}%;background:#7bd389"></div>
        <div style="width:${pct(s.mature)}%;background:var(--c-due)"></div>
      </div>
      <div class="kv"><span><span class="c-new">●</span> Yangi</span><b>${s.new}</b></div>
      <div class="kv"><span><span class="c-learn">●</span> O'rganilmoqda</span><b>${s.learning}</b></div>
      <div class="kv"><span><span style="color:#7bd389">●</span> Yosh (21 kundan kam)</span><b>${s.young}</b></div>
      <div class="kv"><span><span class="c-due">●</span> Pishgan (21+ kun)</span><b>${s.mature}</b></div>
      <div class="kv" style="border-top:1px solid var(--sep);margin-top:6px;padding-top:10px"><span>Jami</span><b>${s.total}</b></div>
    </div>

    <h2 class="section">Keyingi 7 kun prognozi</h2>
    <div class="stat-card">
      <div class="bars">${s.forecast.map((n, i) => `
        <div class="bar"><b>${n}</b><i style="height:${(100 * n) / maxF}%"></i><span>${dayNames[i]}</span></div>`).join('')}
      </div>
    </div>

    <h2 class="section">Oxirgi 30 kun faolligi</h2>
    <div class="stat-card">
      <div class="bars small">${s.activity.map((a) => `
        <div class="bar" title="${a.key}: ${a.n}"><i style="height:${(100 * a.n) / maxA}%"></i></div>`).join('')}
      </div>
      <p class="hint" style="margin:8px 0 0">Bugun yangi so'zlar: ${s.today.nw} / ${S.db.settings.newPerDay}</p>
    </div>
  `;
}

// ---------- sozlamalar ----------

function settings() {
  const st = S.db.settings;
  view.innerHTML = `
    ${topbar('Sozlamalar')}
    <div class="list">
      <div class="row">
        <div class="row-main"><div class="row-title">Kuniga yangi so'zlar</div><div class="row-sub">Bir kunda nechta yangi so'z ko'rsatilsin</div></div>
        <div class="stepper">
          <button data-a="npd" data-d="-5">−</button><b>${st.newPerDay}</b><button data-a="npd" data-d="5">+</button>
        </div>
      </div>
      ${canSpeak ? `
      <label class="row">
        <div class="row-main"><div class="row-title">Avtomatik talaffuz</div><div class="row-sub">Karta ochilganda so'zni o'qib berish</div></div>
        <span class="switch"><input type="checkbox" id="auto-speak" ${st.autoSpeak ? 'checked' : ''}><span></span></span>
      </label>` : ''}
    </div>

    <h2 class="section">🔔 Eslatmalar</h2>
    <div class="list">
      <label class="row">
        <div class="row-main"><div class="row-title">Takrorlash vaqti kelganda xabar</div>
          <div class="row-sub">${inTelegram ? "Bot sizga Telegram'da yozadi" :'Faqat Telegram ichida ishlaydi'}</div></div>
        <span class="switch"><input type="checkbox" id="remind" ${st.remind !== false ? 'checked' : ''}><span></span></span>
      </label>
      ${st.remind !== false ? `
      <div class="row">
        <div class="row-main"><div class="row-title">Qaysi soatdan</div><div class="row-sub">Tunda bezovta qilmaydi</div></div>
        <div class="stepper"><button data-a="hour" data-k="fromH" data-d="-1">−</button><b>${pad2(st.fromH)}:00</b><button data-a="hour" data-k="fromH" data-d="1">+</button></div>
      </div>
      <div class="row">
        <div class="row-main"><div class="row-title">Qaysi soatgacha</div></div>
        <div class="stepper"><button data-a="hour" data-k="toH" data-d="-1">−</button><b>${pad2(st.toH)}:00</b><button data-a="hour" data-k="toH" data-d="1">+</button></div>
      </div>` : ''}
    </div>

    <h2 class="section">Zaxira nusxa</h2>
    <div class="list">
      <button class="row" data-a="export"><div class="row-main"><div class="row-title">📤 Eksport</div><div class="row-sub">Barcha so'zlar va progressni nusxalash</div></div><span class="chev">›</span></button>
      <button class="row" data-a="import"><div class="row-main"><div class="row-title">📥 Import</div><div class="row-sub">Zaxira nusxadan tiklash</div></div><span class="chev">›</span></button>
    </div>

    <h2 class="section">Ma'lumotlar</h2>
    <div class="list">
      <div class="row"><div class="row-main"><div class="row-title">Saqlash joyi</div>
        <div class="row-sub">${S.usingCloud ? "☁️ Telegram buluti — barcha qurilmalaringizda bir xil" : '💻 Brauzer xotirasi (sinov rejimi, Telegram tashqarisida)'}</div></div></div>
      <button class="row" data-a="wipe"><div class="row-main" style="color:var(--danger)">🗑 Barcha ma'lumotlarni o'chirish</div></button>
    </div>
    <p class="hint" style="text-align:center;margin-top:24px">Anki SM-2 algoritmi asosida · v1.0</p>
  `;
  $('#auto-speak')?.addEventListener('change', (e) => S.setSetting('autoSpeak', e.target.checked));
  $('#remind').addEventListener('change', (e) => { S.setSetting('remind', e.target.checked); render(); });
}

actions.hour = (el) => {
  const k = el.dataset.k;
  S.setSetting(k, (S.db.settings[k] + Number(el.dataset.d) + 24) % 24);
  haptic();
  render();
};

actions.npd = (el) => {
  const v = Math.min(200, Math.max(0, S.db.settings.newPerDay + Number(el.dataset.d)));
  S.setSetting('newPerDay', v);
  haptic();
  render();
};

actions.export = async () => {
  const json = S.exportJSON();
  await modal('Eksport', `
    <p class="hint">Bu matnni nusxalab xavfsiz joyga saqlang (masalan, "Saved Messages"ga yuboring).</p>
    <textarea class="input" id="m-json" rows="8" readonly>${esc(json)}</textarea>
  `, [
    { text: '📋 Nusxalash', cls: 'primary', value: (root) => {
      const ta = $('#m-json', root);
      ta.select();
      (navigator.clipboard?.writeText(json) ?? Promise.reject())
        .catch(() => document.execCommand('copy'))
        .then(() => toast('Nusxalandi'), () => toast('Nusxalandi'));
      return false;
    } },
    { text: 'Yopish', value: () => null },
  ]);
};

actions.import = async () => {
  const text = await modal('Import', `
    <p class="hint">Eksport qilingan matnni joylang. <b>Hozirgi barcha ma'lumotlar almashtiriladi.</b></p>
    <textarea class="input" id="m-json" rows="8" placeholder='{"app":"anki-tg",…}'></textarea>
  `, [
    { text: 'Tiklash', cls: 'primary', value: (root) => $('#m-json', root).value.trim() || false },
    { text: 'Bekor qilish', value: () => null },
  ]);
  if (!text) return;
  try {
    await S.importJSON(text);
    toast(`✅ ${S.db.cards.length} ta so'z tiklandi`);
    tab('home');
  } catch (e) {
    toast('Xato: ' + e.message);
  }
};

actions.wipe = async () => {
  if (!(await confirmBox("Hammasi o'chirilsinmi?", "Barcha to'plamlar, so'zlar va statistika butunlay o'chiriladi."))) return;
  await S.wipeAll();
  toast("Ma'lumotlar o'chirildi");
  tab('home');
};

// ---------- eslatmalar serveri bilan sinxronlash ----------

let syncTimer;
function scheduleSync(delay = 3000) {
  if (!inTelegram) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}
function syncNow() {
  clearTimeout(syncTimer);
  if (!inTelegram) return;
  const st = S.db.settings;
  const body = JSON.stringify({
    initData: tg.initData,
    dues: S.reminderDues(),
    tz: -new Date().getTimezoneOffset(),
    remind: st.remind !== false,
    fromH: st.fromH,
    toH: st.toH,
  });
  fetch('api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 })
    .catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.hidden) syncNow(); });

// ---------- ishga tushirish ----------

async function start() {
  if (tg) {
    tg.ready();
    tg.expand();
    if (inTelegram) document.documentElement.classList.add('tg');
    if (tg.isVersionAtLeast?.('7.7')) tg.disableVerticalSwipes();
  }
  S.setSaveErrorHandler(() => toast("⚠️ Saqlashda xato. Internetni tekshiring"));
  S.setChangeHandler(() => scheduleSync());
  try {
    await S.load();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty" style="margin-top:30vh"><p>⚠️ Ma'lumotlarni yuklab bo'lmadi.</p>
      <button class="btn primary" onclick="location.reload()">Qayta urinish</button></div>`;
    return;
  }
  // Ilova ochiq turgan paytda kun almashsa yoki kartalar vaqti kelsa, bosh sahifani yangilab turamiz
  syncNow();
  setInterval(() => { if (['home', 'deck'].includes(current().name) && !$('#modal-root').children.length) render(); }, 60000);
  render();
}

start();
