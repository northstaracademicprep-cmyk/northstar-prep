-- ============================================================
-- 20260601120000_weekly_reports.sql
-- Phase 1 of the weekly progress-report pipeline.
--
-- Adds:
--   • students.parent_email           — recipient address for the report
--                                       (already used by /api/weekly-report
--                                       generation; future phase will send).
--   • weekly_reports                  — one row per (student, week_start).
--                                       Generated drafts live here until an
--                                       admin promotes status='draft' →
--                                       status='approved' (and later 'sent').
--
-- /api/weekly-report upserts on (student_id, week_start) so rerunning
-- generation refreshes summary/snapshot without duplicating rows or
-- clobbering tutor_note. Hence the unique constraint below — it's the
-- conflict target for PostgREST `Prefer: resolution=merge-duplicates`.
--
-- RLS: disabled to match the project-wide pattern (every existing
-- table in supabase-setup.sql disables RLS; access is gated through
-- server-only service-role endpoints).
-- ============================================================

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS parent_email TEXT;

CREATE TABLE IF NOT EXISTS weekly_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    week_start      DATE NOT NULL,
    week_end        DATE NOT NULL,

    snapshot        JSONB NOT NULL,
    tutor_note      TEXT,
    summary         TEXT,

    status          TEXT NOT NULL DEFAULT 'draft',
    email_sent_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (student_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_student_recent
    ON weekly_reports (student_id, week_start DESC);

ALTER TABLE weekly_reports DISABLE ROW LEVEL SECURITY;

-- Force PostgREST to refresh its schema cache so the new column +
-- table are visible immediately (otherwise the API still 404s).
NOTIFY pgrst, 'reload schema';
