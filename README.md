# So'z yodlash — Telegram Mini App + eslatma boti

Anki uslubidagi so'z yodlash ilovasi. U Telegram bot ichida ochiladi. Takrorlash vaqti kelganda bot o'zi
**"🔔 N ta so'zni takrorlash vaqti keldi"** degan xabar yuboradi.

Hammasi **Cloudflare Workers**'ning bepul tarifida ishlaydi:
- `public/` — Mini App (HTML, CSS, JS). So'zlar Telegram CloudStorage'da, ya'ni Telegram'ning o'z bulutida saqlanadi.
- `src/worker.js` — server: Mini App'ni beradi, takrorlash vaqtlarini qabul qiladi, har 15 daqiqada eslatma yuboradi.
- D1 bazasida faqat "kim qachon takrorlashi kerak" degan ma'lumot saqlanadi, so'zlarning o'zi saqlanmaydi.

## Imkoniyatlar
- 🃏 Kartani aylantirib takrorlash, baholar: Qayta / Qiyin / Yaxshi / Oson (SM-2, Anki'dagi kabi)
- ↶ Oxirgi bahoni bekor qilish, ✏️ takrorlash paytida so'zni tahrirlash
- 🗂 To'plamlar, 🔊 talaffuz, ➕ ro'yxat yoki .txt/.csv fayldan qo'shish
- 📊 Statistika: aniqlik, ketma-ket kunlar, 7 kunlik prognoz
- 🔔 Eslatmalar: so'zlarning vaqti kelganda, faqat siz tanlagan soatlarda yuboriladi (standart 08:00–22:00).
  Ilovadan foydalanganingizdan keyin 1 soat ichida, oldingi eslatmadan keyin esa 4 soat ichida xabar kelmaydi.

## O'rnatish (bir marta, taxminan 10 daqiqa)

Kerak bo'ladigan narsalar: [Node.js](https://nodejs.org), bepul [Cloudflare](https://dash.cloudflare.com/sign-up) akkaunti
va @BotFather'dan olingan bot tokeni.

```bash
npm install
npx wrangler login                     # brauzerda Cloudflare'ga kirish

npx wrangler d1 create anki-db         # chiqqan database_id ni wrangler.toml ga yozing
npm run db:init                        # jadvallarni yaratish

npx wrangler secret put BOT_TOKEN      # @BotFather bergan token
npx wrangler secret put WEBHOOK_SECRET # o'zingiz o'ylab topgan maxfiy so'z (harf, raqam, _ va -), masalan: kina_2026_xyz

npm run deploy                         # https://anki-bot.<sizning-nom>.workers.dev manzilini chiqaradi
```

Oxirgi qadam: brauzerda quyidagi manzilni bir marta oching:
```
https://anki-bot.<sizning-nom>.workers.dev/setup?key=<WEBHOOK_SECRET>
```
U bot uchun webhook'ni va menyudagi **"📚 Ochish"** tugmasini o'zi sozlaydi, BotFather'da qo'lda hech narsa qilish shart emas.
Shundan keyin botga `/start` yozing.

Kodni yangilaganda faqat `npm run deploy` buyrug'ini ishga tushirish kifoya.

## Lokal sinov
```bash
npx wrangler dev
```
Telegram tashqarisida ochilganda ma'lumotlar brauzerning o'zida saqlanadi va eslatmalar ishlamaydi.

## Bepul tarif cheklovlari
Workers: kuniga 100 ming so'rov. D1: kuniga 100 ming yozuv. Bu bir necha ming foydalanuvchiga bemalol yetadi.

## Standart so'zlar
Har bir yangi foydalanuvchiga `sozlar.txt` va `sozlar_qoshimcha.txt` dagi to'plamlar avtomatik qo'shiladi
(har biri bir marta; o'chirilgan to'plam qaytib kelmaydi). So'zlarni o'zgartirish uchun:
```bash
# .txt fayllarni tahrirlang (# To'plam nomi, keyin "so'z - tarjima" qatorlari)
npm run library   # public/js/library.js ni qayta yasaydi
npm run deploy
```
Yangi `# To'plam` qo'shsangiz, u mavjud foydalanuvchilarga ham keyingi ochilishda qo'shiladi.
