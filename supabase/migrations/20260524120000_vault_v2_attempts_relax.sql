-- ============================================================
-- 20260524120000_vault_v2_attempts_relax.sql
-- Practice Vault v2 — make student_attempts FRQ-friendly.
--
-- 1. student_attempts.is_correct → nullable.
--    v1 vault is display-rubric-only (self-grading), so there is no
--    correctness signal at attempt time. A future AI grader will
--    populate this column on a second pass.
--
-- 2. Seed a placeholder "vault-v2 test" student so the FK on
--    student_attempts.student_id is satisfied before auth integration.
--    Idempotent via ON CONFLICT.
-- ============================================================

ALTER TABLE student_attempts
    ALTER COLUMN is_correct DROP NOT NULL;

INSERT INTO students (id, name, code)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'vault-v2 test',
    'VAULT-V2-TEST'
)
ON CONFLICT (id) DO NOTHING;
