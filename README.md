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