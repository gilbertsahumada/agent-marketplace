-- Keep the self-healing payment-token backfill bounded. The partial index
-- shrinks as rows are repaired and disappears from the hot path once done.
CREATE INDEX idx_commerce_jobs_missing_payment_token
  ON commerce_jobs (chainId, jobId DESC)
  WHERE paymentToken IS NULL;
