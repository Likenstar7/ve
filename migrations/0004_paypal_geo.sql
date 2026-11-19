-- PayPal checkout and seller geolocation for Mushmore.
ALTER TABLE store_sellers ADD COLUMN latitude REAL;
ALTER TABLE store_sellers ADD COLUMN longitude REAL;
CREATE TABLE IF NOT EXISTS store_paypal_payments (
  paypal_order_id TEXT PRIMARY KEY,
  customer_email TEXT NOT NULL,
  items_json TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'created',
  order_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_store_paypal_email ON store_paypal_payments(customer_email);
