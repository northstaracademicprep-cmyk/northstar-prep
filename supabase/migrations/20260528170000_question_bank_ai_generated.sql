-- ============================================================
-- 20260528170000_question_bank_ai_generated.sql
-- Practice Vault v2 — unlimited AI-generated questions.
--
-- Adds ai_generated to tag questions produced by /api/generate.
-- The vault's base fetch filters to ai_generated=false so the curated
-- College Board set stays fixed; generated rows load on-demand only,
-- yet still live in question_bank so student_attempts.question_id
-- (FK → question_bank.id) is satisfied for attempt-saving.
--
-- DEFAULT false backfills every existing row, so NOT NULL holds on
-- the existing data immediately. Idempotent via ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE question_bank
    ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN question_bank.ai_generated IS
    'TRUE for questions produced by /api/generate. FALSE for curated/College Board questions.';
