-- Payhip paid/refunded transactions synchronized from verified Payhip webhooks.
CREATE TABLE IF NOT EXISTS payhip_sales (
  transaction_id TEXT PRIMARY KEY,
  customer_email TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK(price_minor >= 0),
  refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_minor >= 0),
  status TEXT NOT NULL CHECK(status IN ('paid','partially_refunded','refunded')),
  items_json TEXT NOT NULL DEFAULT '[]',
  transaction_at INTEGER,
  refunded_at INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payhip_sales_date ON payhip_sales(transaction_at DESC);
CREATE INDEX IF NOT EXISTS idx_payhip_sales_email ON payhip_sales(customer_email);
