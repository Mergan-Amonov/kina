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
  const decks = S.db.decks.map((d) => ({ d, c: S.deckCounts(d.id), q: S.queueCounts(d.id) }));

  view.innerHTML = `
    ${topbar('So\'z yodlash')}
    <div class="pills">
      <div class="pill"><b>🔥 ${st.streak}</b><span>kun ketma-ket</span></div>
      <div class="pill"><b>${st.today.n}</b><span>bugun ko'rildi</span></div>
      <div class="pill"><b>${st.total}</b><span>jami so'z</span></div>
    </div>
    ${st.total ? `
      <button class="btn primary big" data-a="review" data-deck="0">
        📖 Takrorlash ${todo ? `<span class="badge">${todo}</span>` : ''}
      </button>` : `
      <div class="empty">
        <div class="big-emoji">🃏</div>
        <p><b>Hali so'zlar yo'q</b></p>
        <p class="hint">So'z qo'shing yoki namunaviy to'plam bilan sinab ko'ring.</p>
        <div class="btn-row">
          <button class="btn primary" data-a="addTab">➕ So'z qo'shish</button>
          <button class="btn" data-a="sample">✨ Namuna</button>
        </div>
      </div>`}
    <h2 class="section">To'plamlar</h2>
    <div class="list">
      ${decks.map(({ d, c, q }) => `
        <button class="row" data-a="openDeck" data-id="${d.id}">
          <div class="row-main">
            <div class="row-title">${esc(d.name)}</div>
            <div class="row-sub">${c.total} ta so'z</div>
          </div>
          <div class="counts">
            <span class="c-new" title="yangi">${q.new}</span>
            <span class="c-learn" title="o'rganilmoqda">${q.learning}</span>
            <span class="c-due" title="takrorlash">${q.due}</span>
          </div>
          <span class="chev">›</span>
        </button>`).join('')}
    </div>
    <p class="hint" style="margin:8px 4px 12px">
      <span class="c-new">●</span> yangi &nbsp; <span class="c-learn">●</span> o'rganilmoqda &nbsp; <span class="c-due">●</span> takrorlash
    </p>
    <button class="btn" data-a="newDeck">＋ Yangi to'plam</button>
  `;
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
  view.innerHTML = `
    ${topbar(d.name)}
    <div class="pills">
      <div class="pill"><b class="c-new">${q.new}</b><span>yangi (bugun)</span></div>
      <div class="pill"><b class="c-learn">${q.learning}</b><span>o'rganilmoqda</span></div>
      <div class="pill"><b class="c-due">${q.due}</b><span>takrorlash</span></div>
    </div>
    <button class="btn primary big" data-a="review" data-deck="${deckId}" ${c.total ? '' : 'disabled'}>📖 Takrorlash</button>
    <div class="btn-row">
      <button class="btn" data-a="addTo" data-id="${deckId}">➕ Qo'shish</button>
      <button class="btn" data-a="cardList" data-id="${deckId}">📋 Ro'yxat (${c.total})</button>
    </div>
    <h2 class="section">Boshqarish</h2>
    <div class="list">
      <button class="row" data-a="editDeck" data-id="${deckId}"><div class="row-main">✏️ Nomi va talaffuz tili</div><span class="chev">›</span></button>
      <button class="row" data-a="deleteDeck" data-id="${deckId}"><div class="row-main" style="color:var(--danger)">🗑 To'plamni o'chirish</div></button>
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
  const { pairs, bad } = S.parsePairs($('#bulk').value);
  if (!pairs.length) return toast("Hech narsa topilmadi. Format: so'z - tarjima");
  const { added, skipped } = S.addCards(current().deckId, pairs);
  notify('success');
  let msg = `✅ ${added} ta so'z qo'shildi`;
  if (skipped) msg += `, ${skipped} ta takroriy`;
  if (bad.length) msg += `, ${bad.length} qator tushunilmadi`;
  toast(msg);
  render();
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
    view.innerHTML = `
      ${topbar()}
      <div class="done">
        ${next ? `
          <div class="big-emoji">⏳</div>
          <h1>Biroz kuting</h1>
          <p class="hint">O'rganilayotgan so'zlar <b id="wait">${humanDelay(next - S.now())}</b>dan keyin qaytadi.</p>
        ` : `
          <div class="big-emoji">🎉</div>
          <h1>Bugungi takrorlash tugadi!</h1>
          <p class="hint">Bugun ${st.today.n} ta karta ko'rildi · 🔥 ${st.streak} kun ketma-ket</p>
        `}
        <div style="margin-top:24px"><button class="btn primary" data-a="back">Orqaga</button></div>
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
  view.innerHTML = `
    <div class="rv-top">
      ${!inTelegram ? '<button class="icon-btn" data-a="back">‹</button>' : ''}
      <span class="c-new">${q.new}</span><span class="c-learn">${q.learning}</span><span class="c-due">${q.due}</span>
      <span class="spacer"></span>
      <button class="icon-btn" data-a="undo" ${S.canUndo() ? '' : 'disabled'}>↶ Ortga</button>
      <button class="icon-btn" data-a="editCurrent">✏️</button>
    </div>
    <div class="card-wrap" data-a="flip">
      <div class="card3d" id="card">
        <div class="face front">
          <div class="deck-name">${esc(deckObj?.name)}</div>
          <div class="word">${esc(card.f)}</div>
          ${canSpeak && deckObj?.lang ? '<button class="speak" data-a="speak">🔊 Tinglash</button>' : ''}
          <div class="tap-hint">Javobni eslang va kartaga bosing</div>
        </div>
        <div class="face back">
          <div class="deck-name">${esc(deckObj?.name)}</div>
          <div class="front-small">${esc(card.f)}</div>
          <hr>
          <div class="answer">${esc(card.b)}</div>
          ${canSpeak && deckObj?.lang ? '<button class="speak" data-a="speak">🔊 Tinglash</button>' : ''}
        </div>
      </div>
    </div>
    <div id="rv-actions">
      <button class="btn primary big" data-a="flip">Javobni ko'rsatish</button>
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
  if (S.undo()) { toast('↶ Oxirgi baho bekor qilindi'); render(); }
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
