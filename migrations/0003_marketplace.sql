-- Mushmore marketplace expansion: sellers, multi-warehouse inventory, SKU, carriers and tracking.
ALTER TABLE store_products ADD COLUMN sku TEXT;
ALTER TABLE store_products ADD COLUMN seller_id TEXT;
ALTER TABLE store_products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'physical' CHECK(product_type IN ('physical','digital'));
ALTER TABLE store_products ADD COLUMN digital_delivery_text TEXT NOT NULL DEFAULT '';
ALTER TABLE store_products ADD COLUMN digital_file_url TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_products_sku ON store_products(sku) WHERE sku IS NOT NULL AND sku <> '';
CREATE INDEX IF NOT EXISTS idx_store_products_seller ON store_products(seller_id);

ALTER TABLE store_orders ADD COLUMN shipping_method TEXT NOT NULL DEFAULT '';
ALTER TABLE store_orders ADD COLUMN carrier_id TEXT;
ALTER TABLE store_orders ADD COLUMN tracking_number TEXT NOT NULL DEFAULT '';
ALTER TABLE store_orders ADD COLUMN tracking_url TEXT NOT NULL DEFAULT '';
ALTER TABLE store_orders ADD COLUMN shipped_at TEXT;
ALTER TABLE store_orders ADD COLUMN delivered_at TEXT;

CREATE TABLE IF NOT EXISTS store_sellers (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','suspended')),
  commission_bps INTEGER NOT NULL DEFAULT 1000 CHECK(commission_bps BETWEEN 0 AND 5000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_store_sellers_status ON store_sellers(status);

CREATE TABLE IF NOT EXISTS store_warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS store_warehouse_stock (
  product_id TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES store_warehouses(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= quantity),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS store_shipping_carriers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  tracking_url_template TEXT NOT NULL DEFAULT '',
  integration_type TEXT NOT NULL DEFAULT 'manual' CHECK(integration_type IN ('manual','aggregator','direct_api')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS store_shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  carrier_id TEXT REFERENCES store_shipping_carriers(id),
  warehouse_id TEXT REFERENCES store_warehouses(id),
  tracking_number TEXT NOT NULL DEFAULT '',
  tracking_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'label_created',
  shipped_at TEXT,
  delivered_at TEXT,
  last_event_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_store_shipments_order ON store_shipments(order_id);
CREATE TABLE IF NOT EXISTS store_shipment_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES store_shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_store_shipment_events ON store_shipment_events(shipment_id,event_at);

CREATE TABLE IF NOT EXISTS store_digital_deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES store_products(id),
  customer_email TEXT NOT NULL,
  delivery_payload TEXT NOT NULL DEFAULT '',
  access_token_hash TEXT NOT NULL DEFAULT '',
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id,product_id)
);

-- Seed a default warehouse and preserve current stock counts.
INSERT OR IGNORE INTO store_warehouses (id,code,name,country,city,address)
VALUES ('wh-default','DEFAULT','Main Warehouse','','','');
INSERT OR IGNORE INTO store_warehouse_stock (product_id,warehouse_id,quantity,reserved)
SELECT id,'wh-default',stock,0 FROM store_products;
