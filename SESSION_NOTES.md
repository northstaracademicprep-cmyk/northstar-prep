# Session notes — 2026-05-24

State at end of session: `vault-v2.html` exists at repo root, end-to-end verified (renders all 8 question groups from `question_bank`, writes 16 attempt rows per session to `student_attempts`). **NOT committed yet.** Not linked from `portal.html` — by design; v2 is a standalone page until the UX is solid.

## Final verification (all checks pass)

```
✅ Schema delta vs. 2026-05-23:
   - student_attempts.is_correct: NOT NULL → nullable
   - question_bank.parent_question_number: new INT (nullable)
   - students: +1 placeholder row (id=00000000-...-001, code=VAULT-V2-TEST)

✅ 16 rows in question_bank, parent_question_number populated:
     Parent #1: saq×3 (A,B,C)   — Wilentz/Bouton stimulus
     Parent #2: saq×3 (A,B,C)   — Webster stimulus
     Parent #3: saq×3 (A,B,C)   — No Stimulus
     Parent #4: saq×3 (A,B,C)   — No Stimulus
     Parent #5: dbq×1            — Federal Government role
     Parent #6: leq×1            — Native Am/Europeans
     Parent #7: leq×1            — Reform/Industrialization
     Parent #8: leq×1            — US Foreign Policy

✅ Full vault pass writes 16 attempts in 1 session_id, time_spent_seconds
   non-null (one observed run: avg=152s, min=10, max=666).
```

## What got built tonight

### Migrations (applied via Supabase SQL Editor)
- `supabase/migrations/20260524120000_vault_v2_attempts_relax.sql`
  - `ALTER student_attempts.is_correct DROP NOT NULL` — rubric-only FRQ flow has no correctness signal at attempt time. Future AI grader populates it.
  - Seeds `students` row id=`00000000-0000-0000-0000-000000000001`, code=`VAULT-V2-TEST` so vault writes don't violate the FK before auth lands.
- `supabase/migrations/20260524130000_question_bank_parent_question_number.sql`
  - `ALTER question_bank ADD COLUMN parent_question_number INT` (nullable, no index — only 16 rows).
  - Reason: bulk-insert in seeder gave all 16 rows the same `created_at`; secondary `sub_index` sort then scatters SAQ parents (Q1-A, Q2-A, Q3-A, Q4-A, Q1-B, …) and breaks client-side grouping. `parent_question_number` is now the authoritative grouping key.

### New page
- `vault-v2.html` — single static file at repo root. ~360 lines. Standalone (does NOT import portal.html anything).
  - Hardcoded `SUPABASE_URL` + publishable key `sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn`
  - Hardcoded `PLACEHOLDER_STUDENT_ID = '00000000-0000-0000-0000-000000000001'`
  - `SUBJECT = 'AP US History'` constant for easy multi-subject extension later
  - Per-page-load `SESSION_ID = crypto.randomUUID()` groups one student's 16 attempts
  - Display-rubric-after-attempt UX. No grading, no AI, no MCQs. Three render modes:
    - SAQ group: shared stimulus once, then Parts A/B/C each with prompt + textarea, single Submit. On submit writes 3 rows to `student_attempts`.
    - DBQ: stimulus (likely null) + `question_text` 8k blob in scrollable max-height 520px container + textarea. Writes 1 row.
    - LEQ: stimulus null + short prompt + textarea. Writes 1 row.
  - 8 screens total: 4 SAQ groups + 1 DBQ + 3 LEQs.

### Seeder + script updates
- `scripts/seed-apush-2025-set-1.mjs` — populates new `parent_question_number` column.
  - SAQ rows: `parent_question_number = q.number` (1, 2, 3, 4)
  - DBQ + LEQ rows: `parent_question_number = q.number + 4` (Section II offset → 5, 6, 7, 8)
- `scripts/verify-parent-numbers.mjs` — new. Asserts all 16 rows have non-null `parent_question_number` and that the mapping matches the spec.
- `scripts/inspect-attempts.mjs` — new. Groups `student_attempts` by `session_id`, reports per-session count + time_spent stats. Use after vault runs to confirm writes.

## Bugs found + fixed this session

| # | Bug | Root cause | Fix |
|---|-----|------------|-----|
| 1 | "No APUSH rows in question_bank" on first load | Vault queried `.eq('subject', 'APUSH')` but seeder writes `'AP US History'` | Hoisted to `const SUBJECT = 'AP US History'` and threaded through query + error msg |
| 2 | First screen showed only Part A and no stimulus | Bulk insert → identical `created_at` → secondary `.order('sub_index')` returned A,A,A,A,B,B,B,B,C,C,C,C. Client-side `groupQuestions` started a new group at every 'A' boundary, then dumped all B's/C's into the last A's group | Added `parent_question_number` column (migration 20260524130000). Vault query now `.order('parent_question_number').order('sub_index', {nullsFirst:true})`. `groupQuestions` rewritten to group by `parent_question_number` instead of "new group when sub_index === 'A'" |

## DB state right now

- `question_bank`: 16 rows, all with `parent_question_number` populated 1–8.
- `student_attempts`: 16 rows from the verification run (1 session_id, placeholder student). Real-student data will land here once auth wiring happens.
- `students`: existing rows + 1 new (`VAULT-V2-TEST`). No prod-student impact.
- Legacy tables (`practice_questions`, `practice_submissions`, `practice_attempts`): unchanged.

## Deferred TODOs

Carried over from 2026-05-23 (still open):

| # | TODO | Severity | Notes |
|---|------|----------|-------|
| 1 | DBQ `question_text` ~8k chars (7 documents inline) | medium | Needs DBQ stimulus/prompt split + image extraction for the 7 sources. v2 renders the blob as-is in a scroll cage; functional but ugly. |
| 2 | All 16 rows have `unit = "Unassigned"`, `tags = []` | medium | Per-question Period mapping (Period 1-9) for curriculum-location filtering. Vault v2 doesn't filter yet, so not blocking. |
| 3 | DBQ/LEQ `official_explanation` is the raw rubric blob | low | Will matter once we want structured criteria display (Thesis/Contextualization/Evidence/etc.). v2 just dumps the blob in `.rubric-text`. |
| 4 | Idempotency match key uses `question_text` | low | Fragile if parser changes prompt text. Consider switching to `(source, source_year, parent_question_number, sub_index)` — we now have the column to support this. |
| 5 | SAQ Q4 Part C may have Section II header/instructions noise in tail | low | Stimulus-marker fix only catches `Source N` / quote-line cases. Cosmetic. |
| 6 | Seeder init log says `"no DB writes this run"` but it does write | trivial | One-line edit. |

New as of 2026-05-24:

| # | TODO | Severity | Notes |
|---|------|----------|-------|
| 7 | Vault v2 has no auth — all attempts written under placeholder student | high (blocker for real use) | Next big chunk of work. Decide: integrate with existing portal auth (access-code based) or build separate? Affects how students reach the page. |
| 8 | Vault v2 not linked from `portal.html` | medium | Intentional until UX solid. When ready: add link from Practice Vault tab for APUSH-subject students, OR add a new top-level nav entry. |
| 9 | `SUPABASE_KEY` hardcoded in vault-v2.html | low | Publishable key is safe in client code. When/if more pages need it, switch to `<meta name="supabase-anon-key">` pattern and read in JS — single point of update. |
| 10 | DBQ scroll cage is 520px max-height — may push the textarea offscreen on small viewports | low | Smoke test was on desktop. Worth checking on iPad / mobile when student-tested. |
| 11 | Idempotency check (TODO #4 above) now feasible to fix | low | Switch match key to `(source, source_year, parent_question_number, sub_index)`. Stable across parser revisions. |

## Resume sequence for next session

1. **Commit tonight's work.** Six files changed: 2 migrations + `vault-v2.html` + `scripts/seed-apush-2025-set-1.mjs` + `scripts/verify-parent-numbers.mjs` + `scripts/inspect-attempts.mjs`. SESSION_NOTES.md too. Suggest one commit.
2. Pick next direction:
   - **Auth wiring** (TODO #7) — biggest blocker; vault is useless to real students until they can be identified
   - **Portal integration** (TODO #8) — wire vault-v2.html into the existing Practice Vault tab for APUSH students
   - **DBQ stimulus/prompt split** (TODO #1) — biggest UX improvement for the vault itself
   - **Period tagging** (TODO #2) — enables unit/period filters; needed before vault scales past one test set

## Key file locations (delta from 2026-05-23)

```
vault-v2.html                                            # NEW — standalone vault page
supabase/migrations/20260524120000_vault_v2_attempts_relax.sql       # NEW
supabase/migrations/20260524130000_question_bank_parent_question_number.sql  # NEW
scripts/seed-apush-2025-set-1.mjs                        # MODIFIED — parent_question_number populated
scripts/verify-parent-numbers.mjs                        # NEW
scripts/inspect-attempts.mjs                             # NEW
```

## How to test the vault locally

```
python3 -m http.server 8000          # from repo root
open http://localhost:8000/vault-v2.html
```

Walk all 8 screens. Then:

```
node scripts/inspect-attempts.mjs
```

Should report N×16 attempts under N distinct session_ids (one per page-load test pass).
