CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,         -- Telegram user id
  dues          TEXT    NOT NULL DEFAULT '[]', -- takrorlash vaqtlari (unix sek), o'sish tartibida
  next_due      INTEGER,
  tz            INTEGER NOT NULL DEFAULT 300,  -- UTC dan farq, daqiqada (Toshkent = 300)
  remind        INTEGER NOT NULL DEFAULT 1,
  from_h        INTEGER NOT NULL DEFAULT 8,    -- eslatma yuborish oralig'i (mahalliy soat)
  to_h          INTEGER NOT NULL DEFAULT 22,
  synced_at     INTEGER,
  last_notified INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_next_due ON users (next_due) WHERE remind = 1;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
