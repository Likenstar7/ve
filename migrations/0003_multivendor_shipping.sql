-- Mushmore multi-vendor, inventory, digital delivery and shipping foundation
ALTER TABLE store_products ADD COLUMN sku TEXT;
ALTER TABLE store_products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'physical' CHECK(product_type IN ('physical','digital'));
ALTER TABLE store_products ADD COLUMN seller_id TEXT;
ALTER TABLE store_products ADD COLUMN warehouse_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_products_sku ON store_products(sku) WHERE sku IS NOT NULL AND sku <> '';
CREATE INDEX IF NOT EXISTS idx_store_products_seller ON store_products(seller_id, warehouse_id);

CREATE TABLE IF NOT EXISTS store_sellers (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_store_sellers_status ON store_sellers(status);

CREATE TABLE IF NOT EXISTS store_warehouses (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  postcode TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(seller_id) REFERENCES store_sellers(id)
);
CREATE INDEX IF NOT EXISTS idx_store_warehouses_seller ON store_warehouses(seller_id, active);

CREATE TABLE IF NOT EXISTS store_carriers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  api_base_url TEXT NOT NULL DEFAULT '',
  integration_type TEXT NOT NULL DEFAULT 'manual' CHECK(integration_type IN ('manual','api','webhook')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS store_shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  seller_id TEXT,
  warehouse_id TEXT,
  carrier_id TEXT,
  carrier_name TEXT NOT NULL DEFAULT '',
  tracking_number TEXT NOT NULL DEFAULT '',
  tracking_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','label_created','picked_up','in_transit','out_for_delivery','delivered','failed','returned','cancelled')),
  shipping_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(shipping_fee_cents >= 0),
  external_shipment_id TEXT NOT NULL DEFAULT '',
  last_event_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_orders(id),
  FOREIGN KEY(seller_id) REFERENCES store_sellers(id),
  FOREIGN KEY(warehouse_id) REFERENCES store_warehouses(id),
  FOREIGN KEY(carrier_id) REFERENCES store_carriers(id)
);
CREATE INDEX IF NOT EXISTS idx_store_shipments_order ON store_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_store_shipments_tracking ON store_shipments(tracking_number);

CREATE TABLE IF NOT EXISTS store_tracking_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  event_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'manual',
  FOREIGN KEY(shipment_id) REFERENCES store_shipments(id)
);
CREATE INDEX IF NOT EXISTS idx_store_tracking_events_shipment ON store_tracking_events(shipment_id,event_time DESC);

CREATE TABLE IF NOT EXISTS store_digital_deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  delivery_type TEXT NOT NULL DEFAULT 'link' CHECK(delivery_type IN ('link','license','text')),
  delivery_payload TEXT NOT NULL,
  expires_at TEXT,
  redeemed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_orders(id),
  FOREIGN KEY(product_id) REFERENCES store_products(id)
);
CREATE INDEX IF NOT EXISTS idx_store_digital_customer ON store_digital_deliveries(customer_email);

CREATE TABLE IF NOT EXISTS store_carrier_webhook_tokens (
  carrier_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(carrier_id) REFERENCES store_carriers(id)
);
