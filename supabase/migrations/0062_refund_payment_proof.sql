-- ============================================================================
-- D|R|P PMS - 0062 Refunds: the payment receipt
--
-- Whoever pays a refund back (a super admin) can add proof of the payment -
-- the bank transfer's screenshot, a photo of the cash receipt, a PDF - so the
-- person who claimed can see it was paid. It sits beside the claim's own
-- receipt in the private documents bucket (refund/<id>/<file>), staff only,
-- and super admins already have the update rights it needs (0052).
-- ============================================================================

alter table refunds
  add column if not exists payment_proof_path text;

comment on column refunds.payment_proof_path is
  'Proof the refund was paid back (transfer screenshot, receipt): refund/<id>/<file> in the documents bucket.';
