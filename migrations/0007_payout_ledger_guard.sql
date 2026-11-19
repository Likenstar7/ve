-- Enforce one ledger debit per payout, even if an admin retries a confirmation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_ledger_payout_debit
ON store_seller_ledger(seller_id,reference)
WHERE entry_type='payout_debit';
