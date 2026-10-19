// sozlar.txt va sozlar_qoshimcha.txt dan public/js/library.js ni yasaydi.
// Ishga tushirish: npm run library
// Har bir "# Nomi" bo'limi — standart to'plam. Uning id si nomidan olinadi, shuning uchun
// nomini o'zgartirsangiz, u foydalanuvchilarga yangi to'plam sifatida yana qo'shiladi.
import { readFileSync, writeFileSync } from 'node:fs';

globalThis.window = {};
const { parseSections } = await import('../public/js/store.js');

const files = ['sozlar.txt', 'sozlar_qoshimcha.txt'];
const decks = [];
for (const file of files) {
  for (const s of parseSections(readFileSync(new URL('../' + file, import.meta.url), 'utf8'))) {
    if (!s.name) continue;
    if (s.bad.length) throw new Error(`${file} / ${s.name}: tushunilmagan qatorlar: ${s.bad.join(' | ')}`);
    const id = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    decks.push({ id, name: s.name, words: s.pairs });
  }
}

const out = `// Avtomatik yaratilgan: scripts/build-library.mjs (qo'lda tahrirlamang)
export const LIBRARY = ${JSON.stringify(decks, null, 0).replace(/\],\[/g, '],\n[').replace(/\},\{/g, '},\n{')};
`;
writeFileSync(new URL('../public/js/library.js', import.meta.url), out);
for (const d of decks) console.log(`${d.words.length.toString().padStart(4)}  ${d.name}  (${d.id})`);
console.log(`${decks.reduce((n, d) => n + d.words.length, 0).toString().padStart(4)}  jami`);
