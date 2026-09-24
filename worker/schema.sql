-- D1 schema for the contact form (M3). Apply with:
--   npx wrangler d1 execute <your_database_name> --file=worker/schema.sql          (local)
--   npx wrangler d1 execute <your_database_name> --remote --file=worker/schema.sql (production)
-- See docs/contact-form.md for the full setup.

CREATE TABLE IF NOT EXISTS contact_submissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  locale     TEXT    NOT NULL DEFAULT 'en',
  first_name TEXT    NOT NULL,
  last_name  TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  mail_sent  INTEGER NOT NULL DEFAULT 0
);

-- Supports the per-IP rate-limit lookup (ip + recent created_at).
CREATE INDEX IF NOT EXISTS idx_contact_ip_time ON contact_submissions (ip, created_at);
