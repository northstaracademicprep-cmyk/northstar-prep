-- ============================================================
-- 20260524130000_question_bank_parent_question_number.sql
-- Practice Vault v2 — restore parent-question grouping signal.
--
-- The original schema relied on (created_at, sub_index) sort order to
-- recover the A/B/C grouping of SAQ parts. That breaks under bulk
-- inserts where all rows share the same created_at: secondary sub_index
-- sort scatters parents (Q1-A, Q2-A, Q3-A, Q4-A, Q1-B, ...) and the
-- client-side grouper sees one parent per "A" boundary.
--
-- This migration adds the missing grouping key. Seeder will populate:
--   • SAQ Q1 (parts A/B/C)    → 1
--   • SAQ Q2 (parts A/B/C)    → 2
--   • SAQ Q3 (parts A/B/C)    → 3
--   • SAQ Q4 (parts A/B/C)    → 4
--   • Section II DBQ           → 5
--   • Section II LEQ #1        → 6
--   • Section II LEQ #2        → 7
--   • Section II LEQ #3        → 8
--
-- Nullable for backward compat with any future rows that don't have a
-- College Board question number (e.g. CED samples, custom drills).
-- ============================================================

ALTER TABLE question_bank
    ADD COLUMN IF NOT EXISTS parent_question_number INT;
