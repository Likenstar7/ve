-- Customer account features: saved addresses, cloud wishlist and moderated reviews.
CREATE TABLE IF NOT EXISTS store_customer_addresses (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address_line TEXT NOT NULL,
  city TEXT NOT NULL,
  postcode TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL CHECK(length(country_code)=2),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_owner ON store_customer_addresses(firebase_uid,is_default);
CREATE TABLE IF NOT EXISTS store_wishlists (
  firebase_uid TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(firebase_uid,product_id)
);
CREATE TABLE IF NOT EXISTS store_product_reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  firebase_uid TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  verified_purchase INTEGER NOT NULL DEFAULT 0 CHECK(verified_purchase IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id,firebase_uid)
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_public ON store_product_reviews(product_id,status,created_at DESC);
