-- Store buyer coordinates captured with consent for distance-aware fulfillment.
ALTER TABLE store_paypal_payments ADD COLUMN buyer_latitude REAL;
ALTER TABLE store_paypal_payments ADD COLUMN buyer_longitude REAL;
ALTER TABLE store_orders ADD COLUMN buyer_latitude REAL;
ALTER TABLE store_orders ADD COLUMN buyer_longitude REAL;
