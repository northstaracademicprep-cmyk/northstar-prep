# Session notes — 2026-05-24

State at end of session: vault-v2.html shipped end-to-end and **live on origin/main**. Three commits tonight (`78b9301` vault-v2 page, `3597598` portal-auth wiring, `4bc2d6a` portal routing card). APUSH students logging into the portal now see an intro card on the Practice Vault tab that navigates to `vault-v2.html` in the same tab; real `students.id` resolves from sessionStorage and attempts write under that UUID.

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

✅ Four-state auth gating passes:
     no portalCode             → "Not signed in" + portal.html link
     portalRole !== 'student'  → "Students only"
     code in hardcoded STUDENTS dict (no DB row)  → "Real account required"
     real students.code        → "Signed in as <name>" + vault loads
```

## What got built tonight

### Migrations (applied via Supabase SQL Editor)
- `supabase/migrations/20260524120000_vault_v2_attempts_relax.sql`
  - `ALTER student_attempts.is_correct DROP NOT NULL` — rubric-only FRQ flow has no correctness signal at attempt time. Future AI grader populates it.
  - Seeds `students` row id=`00000000-0000-0000-0000-000000000001`, code=`VAULT-V2-TEST` so vault writes don't violate the FK before auth lands.
- `supabase/migrations/20260524130000_question_bank_parent_question_number.sql`
  - `ALTER question_bank ADD COLUMN parent_question_number INT` (nullable, no index — only 16 rows).
  - Reason: bulk-insert in seeder gave all 16 rows the same `created_at`; secondary `sub_index` sort then scatters SAQ parents (Q1-A, Q2-A, Q3-A, Q4-A, Q1-B, …) and breaks client-side grouping. `parent_question_number` is now the authoritative grouping key.

### New page (`vault-v2.html`)
- Single static file at repo root. ~410 lines. Standalone (does NOT import portal.html anything).
- Hardcoded `SUPABASE_URL` + publishable key `sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn` (safe in client code).
- `SUBJECT = 'AP US History'` constant for easy multi-subject extension later.
- Per-page-load `SESSION_ID = crypto.randomUUID()` groups one student's 16 attempts.
- Display-rubric-after-attempt UX. No grading, no AI, no MCQs. Three render modes:
  - SAQ group: shared stimulus once, then Parts A/B/C each with prompt + textarea, single Submit. On submit writes 3 rows to `student_attempts`.
  - DBQ: stimulus (likely null) + `question_text` 8k blob in scrollable max-height 520px container + textarea. Writes 1 row.
  - LEQ: stimulus null + short prompt + textarea. Writes 1 row.
- 8 screens total: 4 SAQ groups + 1 DBQ + 3 LEQs.

### Auth wiring (commit `3597598`)
- `resolveStudent()` reads `sessionStorage.portalCode` + `portalCode → students.id` via `sb.from('students').select('id, name').eq('code', code).maybeSingle()`.
- `init()` calls it before fetching questions; on failure routes to `showAuthError(reason)` with three reason codes (`not-logged-in`, `not-student`, `demo-account`).
- Successful resolution surfaces `Signed in as <name>` in the header banner. `state.studentId` carries the UUID into both insert paths.
- Same-origin same-tab navigation required — sessionStorage doesn't reliably carry across tabs.

### Portal routing card (commit `4bc2d6a`)
- `buildPracticeVault()` in portal.html branches early when `currentStudent.subjects` matches `'apush'` or `'ap us history'` (case-insensitive, both spellings exist in the table).
- APUSH match → renders a `pv-hero` + intro card with a navy "Open Practice Vault →" button linking to `vault-v2.html`. Same-tab navigation.
- Non-APUSH subjects → unchanged Gemini MCQ flow.
- vault-v2 gained a "← Back to portal" link in the header for the return trip.

### Seeder + script updates
- `scripts/seed-apush-2025-set-1.mjs` — populates new `parent_question_number` column.
  - SAQ rows: `parent_question_number = q.number` (1, 2, 3, 4)
  - DBQ + LEQ rows: `parent_question_number = q.number + 4` (Section II offset → 5, 6, 7, 8)
- `scripts/verify-parent-numbers.mjs` — new. Asserts all 16 rows have non-null `parent_question_number` and that the mapping matches the spec.
- `scripts/inspect-attempts.mjs` — new. Groups `student_attempts` by `session_id`, reports per-session count + time_spent stats. **Note:** still hardcodes the placeholder UUID; needs a `--code` flag now that real students are writing (TODO #12).

## Bugs found + fixed this session

| # | Bug | Root cause | Fix |
|---|-----|------------|-----|
| 1 | "No APUSH rows in question_bank" on first load | Vault queried `.eq('subject', 'APUSH')` but seeder writes `'AP US History'` | Hoisted to `const SUBJECT = 'AP US History'` and threaded through query + error msg |
| 2 | First screen showed only Part A and no stimulus | Bulk insert → identical `created_at` → secondary `.order('sub_index')` returned A,A,A,A,B,B,B,B,C,C,C,C. Client-side `groupQuestions` started a new group at every 'A' boundary, then dumped all B's/C's into the last A's group | Added `parent_question_number` column (migration 20260524130000). Vault query now `.order('parent_question_number').order('sub_index', {nullsFirst:true})`. `groupQuestions` rewritten to group by `parent_question_number` |

## DB state right now

- `question_bank`: 16 rows, all with `parent_question_number` populated 1–8.
- `student_attempts`: 16 rows from the smoke-test placeholder run + Arnav Kumar's auth-test pass. Real students writing under their own UUIDs now that auth is wired.
- `students`: existing rows + 1 leftover (`VAULT-V2-TEST`). Safe to delete (TODO #13).
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

Open from 2026-05-24:

| # | TODO | Severity | Notes |
|---|------|----------|-------|
| ~~7~~ | ~~Vault v2 auth~~ | DONE | Commit `3597598`. Resolves via sessionStorage + students table. |
| ~~8~~ | ~~Vault v2 not linked from portal~~ | DONE | Commit `4bc2d6a`. APUSH-conditional intro card with CTA to `vault-v2.html`. |
| 9 | `SUPABASE_KEY` hardcoded in vault-v2.html | low | Publishable key is safe in client code. When/if more pages need it, switch to `<meta name="supabase-anon-key">` pattern and read in JS — single point of update. |
| 10 | DBQ scroll cage is 520px max-height — may push the textarea offscreen on small viewports | low | Smoke test was on desktop. Worth checking on iPad / mobile when student-tested. |
| 11 | Idempotency check (TODO #4 above) now feasible to fix | low | Switch match key to `(source, source_year, parent_question_number, sub_index)`. Stable across parser revisions. |
| 12 | `scripts/inspect-attempts.mjs` hardcodes placeholder UUID | low | Needs a `--code <STUDENT-CODE>` CLI arg now that real students attempt. Trivial. |
| 13 | `VAULT-V2-TEST` placeholder student row no longer needed | trivial | `DELETE FROM students WHERE code='VAULT-V2-TEST'` (cascades to its 16 attempts). |
| 14 | vault-v2 doesn't gate on `student.subjects` | low | A non-APUSH student URL-typing `vault-v2.html` directly still loads the APUSH questions. Auth gates on role only. Future: extend `resolveStudent()` to also check the subject list. |
| 15 | Multi-subject students with APUSH + another lose access to the existing Gemini MCQ vault | low | No such students today. When they exist: show both surfaces, or pick a primary subject. |

## Resume sequence for next session

1. Pick next direction:
   - **DBQ stimulus/prompt split** (TODO #1) — biggest UX improvement; the 8k blob with inline documents is the ugliest thing in the vault right now. Needs image extraction for the 7 source documents.
   - **Period tagging pass** (TODO #2) — `unit='Unassigned'` on all 16 rows. Tag each to a Period (1-9). Enables filtering/recommendations once the bank grows.
   - **Add more APUSH FRQ sets** — pipeline is proven. Seed 2024, 2023, 2022 sets (each is one PDF pair + one node script run). Lets students get reps on more than 8 questions before they exhaust the bank.
   - **AI grader** — closes the loop on the "is_correct nullable" decision. Even a simple Claude/Gemini pass against the rubric would beat self-grade. Bigger project; design first.
   - **Quick cleanups** — TODOs #6, #12, #13 are all sub-30-min and worth a hygiene commit.
2. Roughly in priority order I'd suggest: cleanups → more APUSH sets → DBQ split → Period tagging → AI grader.

## Key file locations (full state as of 2026-05-24)

```
vault-v2.html                                            # standalone vault page, ships
portal.html                                              # MODIFIED — APUSH branch in buildPracticeVault()
supabase/migrations/20260523120000_question_bank.sql            # from 2026-05-23
supabase/migrations/20260523220000_add_sub_index.sql            # from 2026-05-23
supabase/migrations/20260524120000_vault_v2_attempts_relax.sql  # NEW 2026-05-24
supabase/migrations/20260524130000_question_bank_parent_question_number.sql  # NEW 2026-05-24
scripts/seed-apush-2025-set-1.mjs                        # MODIFIED — populates parent_question_number
scripts/verify-parent-numbers.mjs                        # NEW
scripts/inspect-attempts.mjs                             # NEW (hardcodes placeholder UUID — see TODO #12)
```

## Commits shipped this session

```
4bc2d6a Route APUSH students from portal Practice Vault to vault-v2.html
3597598 Wire vault-v2 to portal sessionStorage auth
78b9301 Add vault-v2: standalone APUSH FRQ practice from question_bank
```

All three pushed to `origin/main`.

## How to test the vault locally

```
python3 -m http.server 8000          # from repo root
open http://localhost:8000/portal.html
# log in as AK26 (Arnav Kumar — only student with subjects=['AP US History'])
# click Practice Vault sidebar → see intro card → click Open Practice Vault →
# walk all 8 screens
```

After a real-student run, `scripts/inspect-attempts.mjs` won't pick up the attempts because it hardcodes the placeholder UUID — check Supabase Table Editor directly or wait for TODO #12.
