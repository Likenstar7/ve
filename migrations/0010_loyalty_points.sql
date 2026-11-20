-- Closed-loop Mushmore loyalty points. Points are promotional discounts only:
-- no cash value, transfer, sale, crypto conversion, or withdrawal.
CREATE TABLE IF NOT EXISTS store_loyalty_ledger (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  points INTEGER NOT NULL CHECK(points <> 0),
  entry_type TEXT NOT NULL CHECK(entry_type IN ('purchase_reward','admin_adjustment','redemption','reversal')),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id,entry_type)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_owner ON store_loyalty_ledger(firebase_uid,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_email ON store_loyalty_ledger(customer_email,created_at DESC);
