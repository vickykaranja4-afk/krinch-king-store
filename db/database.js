const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'store.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS mixes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,
    category TEXT DEFAULT 'Worship',
    cover_filename TEXT,
    audio_filename TEXT NOT NULL,
    preview_filename TEXT,
    duration_label TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    mix_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    intasend_invoice_id TEXT,
    download_token TEXT,
    download_used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    FOREIGN KEY (mix_id) REFERENCES mixes(id)
  );
`);

module.exports = db;
