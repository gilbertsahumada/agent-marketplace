-- Token selected for each Commerce job. Nullable because legacy contract
-- implementations did not expose the per-job getter at historical blocks.
ALTER TABLE commerce_jobs ADD COLUMN paymentToken TEXT;
