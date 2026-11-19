# Mushmore Auth

Cloudflare Worker API for email one-time passwords (OTP), backed by Cloudflare D1 and Resend.

## Endpoints

- `GET /health` — health check.
- `POST /send-code` — send a six-digit OTP to an email address.
- `POST /verify-code` — verify the OTP.

Both POST endpoints accept JSON.

```json
{ "email": "user@example.com" }
```

```json
{ "email": "user@example.com", "code": "123456" }
```

## Cloudflare setup

1. Confirm the D1 database binding named `DB` points to `mushmore-auth-db`.
2. Add these Worker secrets:
   - `RESEND_API_KEY` — Resend API key.
   - `OTP_PEPPER` — long, random secret (at least 32 random bytes).
3. Add the Worker variable `RESEND_FROM_EMAIL` with a sender address on a domain verified in Resend.
4. Apply the D1 migration:
   `npx wrangler d1 migrations apply mushmore-auth-db --remote`
5. Deploy:
   `npx wrangler deploy`

Do not commit API keys, peppers, Firebase service-account keys, or other credentials.

## Blogger origin

CORS currently permits only `https://mushmoreby.blogspot.com`. Update `ALLOWED_ORIGIN` in `src/index.js` if the Blogger domain changes.

## Important integration note

A successful OTP check confirms control of the email address at verification time. The current Worker does not create Firebase users, issue Firebase custom tokens, or bind an OTP result to a Firebase account. The Blogger client must not treat a browser-only flag as a security boundary. For server-enforced signup, add Firebase Admin verification/user creation on the Worker using a server-side credential stored as a Worker secret, never in Blogger or GitHub.

## Email sender requirement

Resend requires an authorized sender/domain for production delivery. A test sender is restricted and is not suitable for sending arbitrary OTP messages to all visitors.

## Mushmore store API (EUR)

The store API is served by the same Worker and D1 database as the OTP service.

### Required setup

1. Apply migration: `npx wrangler d1 migrations apply mushmore-auth-db --remote`.
2. Add Worker variable `FIREBASE_API_KEY` (the public Web API key for the existing Firebase project).
3. Add Worker variable `ADMIN_UIDS` containing the Firebase UID(s) allowed to manage products and orders, comma-separated. Never use an email address here.
4. Keep the existing `DB` D1 binding. The Blogger origin is restricted to `https://mushmoreby.blogspot.com`.

### Store routes

- `GET /store/products` — public active products; optional `q`, `category`, and `limit`.
- `POST /store/orders` — guest or signed-in customer order; server recalculates prices and stock.
- `GET /store/admin/products` — admin product list.
- `POST /store/admin/products` — create product.
- `PUT /store/admin/products/:id` — update product.
- `DELETE /store/admin/products/:id` — delete product.
- `GET /store/admin/orders` — list latest orders.
- `PATCH /store/admin/orders/:id` — update order and payment status.

Prices are stored as integer euro cents. The first checkout release supports cash on delivery and manual bank transfer. Card payments are intentionally not shown as enabled until a payment provider and merchant account are configured. Product image URLs are accepted; image upload storage is a later R2 integration.

Admin routes verify the Firebase ID token with Firebase Identity Toolkit and then allow only UIDs listed in `ADMIN_UIDS`. The Blogger page must send the current Firebase ID token in the Authorization header.

## Mushmore Marketplace Phase 2

The Blogger storefront UI is in `blogger/mushmore-store-page-v2.html`. Paste its contents into a new Blogger Page using HTML view. It provides a slide-out cart, checkout modal, public order tracking, seller application, and admin panels for products/SKU, orders, sellers, warehouses, and carrier records.

### New D1 migration

Run this after deployment or before using the new endpoints:

```bash
npx wrangler d1 migrations apply mushmore-auth-db --remote
```

Migration `0003_marketplace.sql` adds:
- Seller applications and approval states.
- Multiple warehouses and per-warehouse inventory.
- Product SKU and physical/digital product type.
- Carrier directory, shipment records, tracking events, and digital delivery records.

Checkout now allocates physical inventory across available warehouse records. Existing stock is copied into a default warehouse by the migration. Keep warehouse quantities maintained when adding stock.

### New endpoints

- `POST /store/sellers/apply` — signed-in customer applies to become a seller.
- `GET /store/admin/sellers`, `PATCH /store/admin/sellers/:id` — admin seller approval/status and commission basis points.
- `GET|POST /store/admin/warehouses` — list/create warehouses.
- `PUT /store/admin/warehouses/stock` — set a product's quantity in a warehouse.
- `GET|POST /store/admin/carriers` — list/register carrier records and tracking URL templates.
- `POST /store/admin/shipments` — create a shipment and attach tracking to an order.
- `GET /store/track/:orderNumber` — public tracking summary.
- `GET|POST /store/seller/products` — approved sellers list/create their own products.

### Carrier integration status

The carrier directory accepts manual tracking, direct-API and shipping-aggregator carrier types. Registering a carrier creates its directory/tracking record; it does **not** by itself establish an API connection. Live label purchase, rate quotes, automatic tracking webhooks and carrier credentials still require a configured provider integration (for example, a supported shipping aggregator) and secrets stored in Cloudflare Worker settings. Do not put carrier API keys in Blogger or GitHub.

### Digital products

Products can be marked `digital` in the catalog. The current storefront supports the product type field, but automated secure file delivery, expiring download links and per-order entitlement delivery are not yet wired to checkout. Do not publish private download URLs until that delivery flow is implemented.

### Important deployment steps

1. Apply D1 migration `0003_marketplace.sql` remotely.
2. Confirm Worker variables `FIREBASE_API_KEY` and `ADMIN_UIDS` are configured.
3. Deploy the Worker from the connected GitHub repository.
4. Paste `blogger/mushmore-store-page-v2.html` into a Blogger Page.
5. Test checkout, stock deduction, seller application, admin approval, warehouse stock and manual tracking before accepting live orders.


## PayPal checkout (Mushmore)

The storefront now uses PayPal Orders API with server-side order creation and capture. It defaults to **Sandbox**. Configure these Worker variables in Cloudflare Dashboard → Workers & Pages → mushmore-auth → Settings → Variables and Secrets:

- `PAYPAL_CLIENT_ID` — PayPal REST app client ID (plain variable).
- `PAYPAL_CLIENT_SECRET` — PayPal REST app secret (Secret).
- `PAYPAL_ENVIRONMENT` — set to `sandbox` for testing. Change to `live` only after completing sandbox tests and confirming the merchant account is approved for live checkout.

The browser receives only the client ID. The secret remains in Worker Secrets. Card funding is rendered only when PayPal reports it eligible for the merchant and buyer. Mushmore never collects or stores card numbers.

Buyer location is optional and requested through browser geolocation permission. Seller coordinates are captured when a seller submits their application. Distance labels and radius filtering are approximate straight-line distances, not courier route distances.

Physical delivery still needs a shipping address and a connected carrier/fulfillment workflow before an order can be dispatched. The current minimal checkout records email, SKU/items, payment status and optional buyer coordinates; it does not yet collect a full delivery address or calculate live shipping rates.
