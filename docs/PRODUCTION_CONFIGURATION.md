# Mushmore production configuration

Open Cloudflare Dashboard → Workers & Pages → `mushmore-auth` → Settings → Variables and Secrets. Add sensitive values as **Secrets**, not plain text variables. Never put these values in Blogger theme code or send them in chat.

## Required for account registration

- `FIREBASE_API_KEY` — Firebase Web API key used by the Worker to verify ID tokens.
- `OTP_PEPPER` — long random secret used to hash one-time codes.
- `RESEND_API_KEY` — Resend API key.
- `RESEND_FROM_EMAIL` — sender address on a domain verified in Resend, e.g. `Mushmore <no-reply@your-verified-domain>`.
- `RESEND_DOMAIN_VERIFIED` — plain variable `true` only after the sender domain is verified.
- `ADMIN_UIDS` — comma-separated Firebase Auth UID(s) authorized as store administrators. Keep this private.

Without a verified sender domain, the code only allows the configured Resend test recipient via `RESEND_TEST_TO_EMAIL`; it does not permit general public signups.

## Required for PayPal checkout

- `PAYPAL_CLIENT_ID` — PayPal app client ID.
- `PAYPAL_CLIENT_SECRET` — PayPal app secret.
- `PAYPAL_ENVIRONMENT` — plain variable `sandbox` while testing; change to `live` only after successful sandbox tests and account approval.

Do not enable live payments until a complete test purchase, capture, order creation, and refund/reconciliation have been verified.

## Required for Payhip synchronization

- `PAYHIP_ZAPIER_SECRET` — existing shared secret for the Zapier product-sync endpoint.
- `PAYHIP_WEBHOOK_SIGNATURE` — SHA-256 hex digest of the Payhip Developer API key. Follow `docs/PAYHIP_WEBHOOK_SETUP.md`.

Configure the Payhip webhook URL and enable `paid` and `refunded` events in Payhip Developer settings.

## Shipping provider secrets

Carrier secret names are displayed by the Mushmore admin carrier settings. Add each provider's API key under the exact binding name shown there. Adding a carrier URL or secret does not implement a provider adapter by itself.

## Payouts

Do not set `PAYOUTS_ENABLED`, `PAYOUT_COMPLIANCE_CLEARED`, or `PAYOUT_PROVIDER_CONNECTED` to true for USDT or another virtual asset. Payout endpoints are intentionally blocked pending a lawful, approved fiat payout method.

## Deployment

Pushing changes under `src/**` or `migrations/**` to `main` runs D1 migrations and deploys the Worker automatically. Theme XML changes do not deploy to Blogger: download the latest XML and upload it manually through Blogger → Theme → Restore.
