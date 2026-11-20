-- Persist buyer-provided shipping details for PayPal checkout and order fulfilment.
ALTER TABLE store_paypal_payments ADD COLUMN customer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE store_paypal_payments ADD COLUMN customer_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE store_paypal_payments ADD COLUMN shipping_address TEXT NOT NULL DEFAULT '';
ALTER TABLE store_paypal_payments ADD COLUMN shipping_city TEXT NOT NULL DEFAULT '';
ALTER TABLE store_paypal_payments ADD COLUMN shipping_postcode TEXT NOT NULL DEFAULT '';
ALTER TABLE store_paypal_payments ADD COLUMN shipping_country TEXT NOT NULL DEFAULT '';
