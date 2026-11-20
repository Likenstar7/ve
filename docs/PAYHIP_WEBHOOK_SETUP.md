# Payhip sales and refund synchronization

Mushmore receives Payhip `paid` and `refunded` events at:

`https://mushmore-auth.lioby198.workers.dev/integrations/payhip/webhook`

## Configure the signing secret

1. In Payhip, open **Account Settings → Developer** and copy the API key. Do not paste it into GitHub, Blogger, Zapier, or a chat.
2. Compute the SHA-256 hex digest of that API key. On Windows PowerShell:

```powershell
$apiKey = Read-Host "Paste Payhip API key"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($apiKey)
$hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
([Convert]::ToHexString($hash)).ToLower()
```

3. In Cloudflare → Workers & Pages → `mushmore-auth` → Settings → Variables and Secrets, add a **Secret** named `PAYHIP_WEBHOOK_SIGNATURE` and set it to the 64-character hash output. Do not use the raw API key.
4. In Payhip → Account Settings → Developer, set the webhook URL above and enable the **paid** and **refunded** events.
5. Make a test sale/refund if available, then open Mushmore admin → **مبيعات Payhip** → **تحديث مبيعات Payhip**.

The webhook verifies Payhip's documented `signature = SHA256(API key)` field. Transaction IDs are unique, so retries do not create duplicate rows. Refund events update the original transaction and retain the refunded amount.

## Important

- This webhook syncs Payhip transactions into the Mushmore admin sales view. Payhip remains the payment processor and handles customer delivery/refunds.
- It does not combine Payhip and local Mushmore products into one checkout.
- Product synchronization through the existing Zapier flow remains separate and continues to use `PAYHIP_ZAPIER_SECRET`.
- Never expose either secret in frontend code.
