-- ============================================================
-- 20260523220000_add_sub_index.sql
-- Practice Vault rebuild — schema addition.
--
-- Adds sub_index to question_bank to identify which gradeable part a row
-- represents:
--   • SAQ rows: 'A' / 'B' / 'C' (one row per part per the row-per-gradeable
--     decision made earlier this session)
--   • DBQ / LEQ rows: NULL  (one row per question)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS makes re-runs safe.
-- ============================================================

ALTER TABLE question_bank
    ADD COLUMN IF NOT EXISTS sub_index TEXT;

COMMENT ON COLUMN question_bank.sub_index IS
    'For SAQ rows: part letter (A/B/C). NULL for DBQ/LEQ rows.';
