-- ============================================================
-- 20260523120000_question_bank.sql
-- Practice Vault rebuild — Step 1: clean question bank schema.
--
-- Creates two new tables:
--   • question_bank      — server-side, source-of-truth question store
--   • student_attempts   — replaces the legacy practice_attempts table
--
-- LEAVES ALONE: practice_questions, practice_submissions, practice_attempts.
-- Those will be retired/migrated in a later step once the new flow is live.
-- ============================================================

-- ── question_bank ─────────────────────────────────────────────
-- One row per question. Supports MCQ, FRQ, SAQ, DBQ, LEQ.
-- Stimulus can be text and/or an image URL (Supabase storage).
-- choices/wrong_answer_explanations are jsonb so MCQs can carry
-- per-choice text and per-distractor feedback respectively.

CREATE TABLE IF NOT EXISTS question_bank (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Curriculum location
    subject                     TEXT NOT NULL,
    unit                        TEXT NOT NULL,
    unit_number                 INT,
    topic                       TEXT,

    -- Question shape
    question_type               TEXT NOT NULL
                                 CHECK (question_type IN ('mcq','frq','saq','dbq','leq')),
    difficulty                  TEXT NOT NULL
                                 CHECK (difficulty IN ('easy','medium','hard')),

    -- Stimulus (optional — passages, charts, etc.)
    stimulus                    TEXT,
    stimulus_image_url          TEXT,

    -- The question itself
    question_text               TEXT NOT NULL,
    choices                     JSONB,            -- e.g. [{"letter":"A","text":"..."}, ...] for MCQ
    correct_answer              TEXT NOT NULL,    -- letter for MCQ, rubric/points text for FRQ/SAQ/etc.
    official_explanation        TEXT NOT NULL,    -- why the correct answer is right
    wrong_answer_explanations   JSONB,            -- e.g. {"A":"why A is wrong", "C":"...", "D":"..."}

    -- Provenance
    source                      TEXT,             -- e.g. "College Board 2024 FRQ", "CED Sample"
    source_year                 INT,
    tags                        TEXT[] DEFAULT '{}'::TEXT[],

    created_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the obvious browse/filter patterns
CREATE INDEX IF NOT EXISTS idx_question_bank_subject_unit
    ON question_bank (subject, unit_number);
CREATE INDEX IF NOT EXISTS idx_question_bank_subject_topic
    ON question_bank (subject, topic);
CREATE INDEX IF NOT EXISTS idx_question_bank_difficulty
    ON question_bank (difficulty);
CREATE INDEX IF NOT EXISTS idx_question_bank_question_type
    ON question_bank (question_type);
CREATE INDEX IF NOT EXISTS idx_question_bank_tags
    ON question_bank USING GIN (tags);


-- ── student_attempts ──────────────────────────────────────────
-- One row per question attempt. Groups into sessions via session_id.
-- Cascades on student delete (matches sessions/homework convention).
-- Cascades on question delete for now — easy to relax to RESTRICT later
-- if you decide attempt history should outlive its question.

CREATE TABLE IF NOT EXISTS student_attempts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id                  UUID NOT NULL REFERENCES students(id)      ON DELETE CASCADE,
    question_id                 UUID NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,

    selected_answer             TEXT,             -- nullable: student may run out of time
    is_correct                  BOOLEAN NOT NULL,
    time_spent_seconds          INT,

    session_id                  UUID,             -- groups attempts into one practice session
    attempted_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_attempts_student_recent
    ON student_attempts (student_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_attempts_question
    ON student_attempts (question_id);
CREATE INDEX IF NOT EXISTS idx_student_attempts_session
    ON student_attempts (session_id);


-- ── RLS: disabled to match existing project pattern ───────────
-- Every existing table in supabase-setup.sql disables RLS. The portal
-- relies on the publishable/anon key being able to read+write directly.
-- Enabling RLS here without policies would break that flow on Day 1.
-- When the project moves to a backend proxy / service-role pattern,
-- re-enable here at the same time.

ALTER TABLE question_bank    DISABLE ROW LEVEL SECURITY;
ALTER TABLE student_attempts DISABLE ROW LEVEL SECURITY;
