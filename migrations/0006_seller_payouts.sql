-- Mushmore seller earnings, multi-network USDT wallets and controlled payout workflow.
-- No private keys or seed phrases are stored in this database.
CREATE TABLE IF NOT EXISTS store_seller_wallets (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES store_sellers(id) ON DELETE CASCADE,
  asset TEXT NOT NULL DEFAULT 'USDT' CHECK(asset='USDT'),
  network TEXT NOT NULL CHECK(network IN ('TRC20','ERC20','BEP20','POLYGON','ARBITRUM')),
  wallet_address TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','disabled')),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(seller_id,network,wallet_address)
);
CREATE INDEX IF NOT EXISTS idx_seller_wallets_seller ON store_seller_wallets(seller_id,status);

CREATE TABLE IF NOT EXISTS store_seller_ledger (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES store_sellers(id),
  order_id TEXT REFERENCES store_orders(id),
  entry_type TEXT NOT NULL CHECK(entry_type IN ('sale_credit','refund_debit','payout_debit','adjustment_credit','adjustment_debit')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('pending','available','held','reversed')),
  description TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_seller_ledger_balance ON store_seller_ledger(seller_id,status,currency,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_ledger_order_sale ON store_seller_ledger(order_id,seller_id,reference) WHERE entry_type='sale_credit';

CREATE TABLE IF NOT EXISTS store_seller_payouts (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES store_sellers(id),
  wallet_id TEXT NOT NULL REFERENCES store_seller_wallets(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  source_currency TEXT NOT NULL DEFAULT 'EUR',
  payout_asset TEXT NOT NULL DEFAULT 'USDT' CHECK(payout_asset='USDT'),
  network TEXT NOT NULL CHECK(network IN ('TRC20','ERC20','BEP20','POLYGON','ARBITRUM')),
  exchange_rate TEXT NOT NULL DEFAULT '',
  fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(fee_cents >= 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','under_review','approved','processing','paid','rejected','failed','cancelled')),
  compliance_status TEXT NOT NULL DEFAULT 'pending' CHECK(compliance_status IN ('pending','cleared','hold','rejected')),
  compliance_note TEXT NOT NULL DEFAULT '',
  txid TEXT NOT NULL DEFAULT '',
  provider_reference TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_seller_payout_queue ON store_seller_payouts(status,compliance_status,created_at);
CREATE INDEX IF NOT EXISTS idx_seller_payout_seller ON store_seller_payouts(seller_id,created_at);

CREATE TABLE IF NOT EXISTS store_payout_audit (
  id TEXT PRIMARY KEY,
  payout_id TEXT NOT NULL REFERENCES store_seller_payouts(id) ON DELETE CASCADE,
  actor_uid TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
