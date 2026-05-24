# Session notes — 2026-05-23

State at end of session: `question_bank` populated with 16 clean rows from the 2025 APUSH FRQ Set 1. **NOT committed yet** — ready for Supabase Table Editor verification + commit.

## Final verification (all five properties pass)

```
✅ Property 1: counts saq=12, dbq=1, leq=3
✅ Property 2: Q1 — three SAQ rows (A,B,C) share Wilentz/Bouton stimulus
✅ Property 3: Q2 — three SAQ rows (A,B,C) share Webster stimulus
✅ Property 4: Q3+Q4 — six SAQ rows have null stimulus (No Stimulus type)
✅ Bonus:      no question_text shows the stimulus-leakage pattern
```

## What got built

### Schema
- Migration 1: `supabase/migrations/20260523120000_question_bank.sql`
  - `question_bank` (18 cols). CHECK on `question_type` ∈ {mcq, frq, saq, dbq, leq} and `difficulty` ∈ {easy, medium, hard}. 5 indexes. RLS disabled.
  - `student_attempts` (8 cols). FKs to `students` + `question_bank` with ON DELETE CASCADE. 3 indexes.
- Migration 2: `supabase/migrations/20260523220000_add_sub_index.sql`
  - Adds nullable `sub_index TEXT` to `question_bank`. SAQ rows store `'A'`/`'B'`/`'C'`; DBQ/LEQ rows store `NULL`.
- Both migrations applied via Supabase SQL Editor (publishable key can't DDL).
- Legacy tables left alone: `practice_questions` (10 rows), `practice_submissions` (0), `practice_attempts` (0).

### Node tooling
- `package.json`: `name=northstar-prep-scripts`, `type=module`, devDeps `pdf-parse@2.4.5`, `@supabase/supabase-js@2.106.1`, `dotenv`.
- `.gitignore`: `.env*`, `node_modules/`.
- `.env` (gitignored): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — user-managed via TextEdit.

### PDFs
- `data/apush-pdfs/2025-set-1.pdf` — 11 pages, FRQ paper
- `data/apush-pdfs/2025-set-1-scoring.pdf` — 38 pages, scoring guidelines

### Scripts (all in `scripts/`)
- `seed-apush-2025-set-1.mjs` — parses both PDFs, builds 16 `question_bank` rows, inserts with idempotency check
- `inspect-question-bank.mjs` — verification queries (group-by, sample SAQs)
- `verify-post-fix.mjs` — automated post-fix property checks (5 properties)
- `truncate-question-bank.mjs` — one-shot clean-slate delete
- `inspect-practice-tables.mjs`, `verify-question-bank.mjs` — schema diagnostics
- Pre-existing (unrelated to vault rebuild): `fetch-nav-progress.mjs`, `seed-monira-progress.mjs`, `rewrite-apw-baselines.mjs`, `rewrite-alg2-baselines.mjs`, `fix-algebra-code.mjs`, `fix-apw-phase-numbers.mjs`, `set-alg2-programtype-label.mjs`, `check-alg2-program-type.mjs`

## Parser bugs fixed this session

1. **Stimulus contamination from front matter** — `extractStimulus()` skips to first `Source N` line or opening quote
2. **SAQ Q2/Q3/Q4 missing parts** — Q3/Q4 "No Stimulus" rubrics have `1 point` inline; regex now accepts either layout
3. **Question-number collisions across sections** — SAQ Q1 and DBQ Q1 both have `number=1`. Join indexes scoring by `(type_family, number)`
4. **Long-form detection guard** — `currentQ.parts.length >= 2` guard blocked back-to-back LEQs. Dropped, widened action-verb list
5. **SAQ last-part contamination (discovered post-insert, fixed this session)** — when a stimulus marker (`Source N` or opening quote) arrives while `currentPart` is set, parser now flushes the question and accumulates the line as stimulus for the next question. Fixes both the part-prompt bleed AND the resulting empty `stimulus` field on Q2

## DB state right now

- `question_bank`: 16 rows
  - 12 SAQ parts (Q1×3 + Q2×3 + Q3×3 + Q4×3), `sub_index` populated with `A`/`B`/`C`
  - 1 DBQ, `sub_index = NULL`
  - 3 LEQs, `sub_index = NULL`
  - All `source='College Board'`, `source_year=2025`
- `student_attempts`: 0 rows
- Legacy tables: unchanged from start of session

## Deferred TODOs (resume from these)

| # | TODO | Severity | Notes |
|---|------|----------|-------|
| 1 | DBQ `question_text` ~8k chars (7 documents inline) | medium | Needs DBQ stimulus/prompt split. Tied to image-extraction work for the 7 source documents. |
| 2 | All 16 rows have `unit = "Unassigned"`, `tags = []` | medium | Per-question Period mapping (Period 1-9) needs a tagging pass before the new vault UI can filter by curriculum location. |
| 3 | DBQ/LEQ `official_explanation` is the raw rubric blob | low | Need essay grader → split rubric criteria (Thesis/Contextualization/Evidence/etc.) into structured fields. |
| 4 | Idempotency match key uses `question_text` | low | Fragile if parser changes prompt text. Consider switching to `(source, source_year, question_type, sub_index_or_question_number)` for stable matching across parser revisions. |
| 5 | SAQ Q4's Part C may still absorb Section II header/instructions noise (text content, not stimulus) | low | The stimulus-marker fix only catches `Source N` / quote-line cases. Section II's prose instructions don't trigger it, so Q4 Part C's tail can have noise. Cosmetic; doesn't corrupt rendering. |
| 6 | Init log says `"no DB writes this run"` but the script now writes | trivial | One-line edit in `seed-apush-2025-set-1.mjs`. |

## Resume sequence for next session

1. Verify in Supabase Table Editor: 16 rows in `question_bank`, all from College Board 2025, `sub_index` column populated correctly
2. Commit the work: 2 migrations + `package.json` + `.gitignore` + seed script + helpers (decide commit-vs-local per script)
3. Pick next direction: DBQ stimulus extraction (TODO #1), OR Period tagging pass (TODO #2), OR start on Practice Vault UI rewrite to read from `question_bank`

## Key file locations (quick reference)

```
supabase/migrations/20260523120000_question_bank.sql     # initial schema
supabase/migrations/20260523220000_add_sub_index.sql     # sub_index column
scripts/seed-apush-2025-set-1.mjs                        # the seeder
scripts/verify-post-fix.mjs                              # automated property checks
scripts/inspect-question-bank.mjs                        # ad-hoc query script
scripts/truncate-question-bank.mjs                       # clean-slate helper
data/apush-pdfs/2025-set-1.pdf                           # source FRQs
data/apush-pdfs/2025-set-1-scoring.pdf                   # source rubrics
/tmp/2025-set-1-frqs.txt                                 # extracted text (regenerable)
/tmp/2025-set-1-scoring.txt                              # extracted text (regenerable)
.env                                                     # gitignored secrets
```
