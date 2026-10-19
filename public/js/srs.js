// Anki uslubidagi oraliqli takrorlash (SM-2 asosida).
// Baholar: 1 = Qayta, 2 = Qiyin, 3 = Yaxshi, 4 = Oson
// Holatlar: new (yangi), learning (o'rganilmoqda), review (takrorlash)

export const MINUTE = 60;
export const DAY = 24 * 60 * MINUTE;

const LEARNING_STEPS = [1 * MINUTE, 10 * MINUTE]; // yangi so'z uchun qadamlar
const GRADUATING_INTERVAL = 1; // kun: o'rganishdan chiqqandagi birinchi interval
const EASY_INTERVAL = 4;       // kun: yangi so'zga "Oson" bosilganda
const MIN_EASE = 1.3;
const MAX_INTERVAL = 365 * 3;  // kun

const round2 = (x) => Math.round(x * 100) / 100;

// Karta va bahoga qarab yangi qiymatlarni qaytaradi (kartani o'zgartirmaydi).
export function schedule(card, grade, now = Date.now() / 1000) {
  let { state, step, ease, interval, lapses } = card;
  let due;

  if (state === 'new' || state === 'learning') {
    if (grade === 1) {
      step = 0;
      state = 'learning';
      due = now + LEARNING_STEPS[0];
    } else if (grade === 2) {
      const delay = step === 0 && LEARNING_STEPS.length > 1
        ? (LEARNING_STEPS[0] + LEARNING_STEPS[1]) / 2
        : LEARNING_STEPS[Math.min(step, LEARNING_STEPS.length - 1)];
      state = 'learning';
      due = now + delay;
    } else if (grade === 3) {
      step += 1;
      if (step >= LEARNING_STEPS.length) {
        state = 'review'; interval = GRADUATING_INTERVAL; step = 0;
        due = now + interval * DAY;
      } else {
        state = 'learning';
        due = now + LEARNING_STEPS[step];
      }
    } else {
      state = 'review'; interval = EASY_INTERVAL; step = 0;
      due = now + interval * DAY;
    }
  } else { // review
    if (grade === 1) {
      lapses += 1;
      ease = Math.max(MIN_EASE, ease - 0.2);
      interval = Math.max(1, interval * 0.5);
      state = 'learning'; step = 0;
      due = now + LEARNING_STEPS[0];
    } else {
      if (grade === 2) {
        ease = Math.max(MIN_EASE, ease - 0.15);
        interval = interval * 1.2;
      } else if (grade === 3) {
        interval = interval * ease;
      } else {
        ease += 0.15;
        interval = interval * ease * 1.3;
      }
      interval = Math.min(MAX_INTERVAL, Math.max(card.interval + 1, interval));
      due = now + interval * DAY;
    }
  }

  return {
    state, step, lapses,
    ease: round2(ease),
    interval: round2(interval),
    due: Math.floor(due),
    reps: card.reps + 1,
  };
}

// Intervalni qisqa matn ko'rinishida: "10 daq", "3 soat", "4 kun", "2 oy", "1.5 yil".
export function humanDelay(seconds) {
  seconds = Math.max(0, seconds);
  const fmt = (x) => String(Math.round(x * 10) / 10);
  if (seconds < 60 * MINUTE) return `${Math.max(1, Math.round(seconds / MINUTE))} daq`;
  if (Math.round(seconds / 3600) < 24) return `${Math.round(seconds / 3600)} soat`;
  const days = seconds / DAY;
  if (days < 30) return `${Math.round(days)} kun`;
  if (days < 365) return `${fmt(days / 30)} oy`;
  return `${fmt(days / 365)} yil`;
}

// Har bir baho tugmasi uchun keyingi takrorlash vaqti.
export function preview(card, now = Date.now() / 1000) {
  const out = {};
  for (const g of [1, 2, 3, 4]) out[g] = humanDelay(schedule(card, g, now).due - now);
  return out;
}
