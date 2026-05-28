# Session notes — 2026-05-27/28 (AP World vault)

State at end of session: AP World History practice vault shipped end-to-end and **live on origin/main** (commit `3628730`). `vault-v2.html` now serves both APUSH and AP World via `?subject=` URL param. `portal.html` has an AP World branch in `buildPracticeVault()`. Seeder `scripts/seed-apworld-2025-set-1.mjs` populated 11 new rows; DB now has 27 rows (16 APUSH + 11 AP World).

## What got built this session

### vault-v2.html: subject-param generalization
- Replaced `const SUBJECT = 'AP US History'` with a `SUBJECT_MAP` keyed by `apush` / `apworld`.
- URL param `?subject=apush|apworld` sets `dbSubject`, `label`, and `year` for the page title, subtitle, and DB query.
- Added `id` attributes to `<title>`, `<h1>`, subtitle `<p>`, and done-message elements so JS can update them on load.
- APUSH behaviour is fully unchanged; `?subject=apworld` loads `AP World History` rows from `question_bank`.

### portal.html: AP World branch
- APUSH CTA link updated from `vault-v2.html` → `vault-v2.html?subject=apush`.
- New branch in `buildPracticeVault()` matches `subjects` containing `'apwh'`, `'ap world history'`, or `'ap world'` (case-insensitive).
- Renders a `pv-hero` + 🌍 intro card (5 questions summary, "Opens in this tab") with a navy "Open Practice Vault →" button to `vault-v2.html?subject=apworld`.

### scripts/seed-apworld-2025-set-1.mjs (new file)
Key diffs from the APUSH seeder:
- `SUBJECT='AP World History'`, `SAQ_COUNT=3`, `SECTION_II_OFFSET=3`, `LEQ_Q_NUMBER=2`, `EXPECTED_ROW_COUNT=11`
- `normalize()` strips AP World-specific page headers (`AP WORLD HISTORY: MODERN \d{4}...`, `AP® World History: Modern \d{4} Scoring Guidelines`)
- `extractStimulus()` / `looksLikeStimulusMarker()`: regex uses `“”` Unicode escapes — AP World PDFs use LEFT/RIGHT DOUBLE QUOTATION MARK (U+201C/D), not ASCII `"`
- `parseFrqs()`: SAQ header also matches `Using the .+?,\s+respond to parts` (2024 format); parts regex is case-insensitive; added `leqIntro` detection for `"In the period circa..."` / `"During the ..."` format (AP World LEQs don't start with action verbs like APUSH's)
- `parsePartsFromScoring()`: completely rewritten for AP World's indented format (`         A    prompt   1 point`)
- `buildRows()`: skips SAQ Q4 (`q.number > SAQ_COUNT`) and LEQ Q3/Q4 (`q.number !== LEQ_Q_NUMBER`)

### question_bank rows added
| parent# | type | sub_index | stimulus |
|---------|------|-----------|---------|
| 1 | saq | A, B, C | Primary source stimulus |
| 2 | saq | A, B, C | Primary source stimulus |
| 3 | saq | A, B, C | No stimulus |
| 4 | dbq | (null) | 7-document DBQ blob |
| 5 | leq | (null) | No stimulus |

(11 rows total; subject='AP World History', source_year=2025)

## Bugs fixed this session

| # | Bug | Root cause | Fix |
|---|-----|------------|-----|
| A | `stimulus: null` on all 11 AP World rows after first seed | `extractStimulus` regex `/^["""]/.test(t)` only matched ASCII `"` (U+0022); AP World PDFs use U+201C LEFT DOUBLE QUOTATION MARK | Added `“”` to both `extractStimulus` and `looksLikeStimulusMarker` regexes via Python patch (Edit tool only writes ASCII) |
| B | 11 bad rows left in DB after first seed | Idempotency check passed with wrong data (stimulus=null but rows existed) | Manually deleted the 11 rows in Supabase SQL Editor before re-running the corrected seeder |

## DB state right now (as of 2026-05-28)

- `question_bank`: **27 rows** — 16 APUSH (parent# 1-8, source_year=2025) + 11 AP World (parent# 1-5, source_year=2025).
- `student_attempts`: prior rows from smoke tests + Arnav Kumar's auth-test pass.
- Migrations: no new migrations this session (no schema changes needed — `parent_question_number` already existed).

## Deferred TODOs (AP World additions)

| # | TODO | Severity | Notes |
|---|------|----------|-------|
| 16 | Seed 2024 AP World FRQ set | medium | `seed-apworld-2024-set-1.mjs` not yet written. Pipeline is proven; just needs the 2024 PDF pair. |
| 17 | `year` hardcoded as `'2025'` in SUBJECT_MAP | low | When multi-year data exists, `year` should come from DB or be removed from the subtitle. |
| 18 | vault-v2 subject-gating for AP World (mirrors TODO #14) | low | A non-APWH student URL-typing `vault-v2.html?subject=apworld` loads the AP World questions. Extend `resolveStudent()` to check subjects. |
| 19 | AP World portal branch can't be E2E tested without a real APWH student | low | `currentStudent` is module-scope `let` in portal.html; can't be injected via `window.currentStudent =`. Need a real student row with `subjects` containing `'AP World History'`. |

---

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

## Resume sequence for next session (as of 2026-05-28)

1. Pick next direction:
   - **Add real APWH student** — create a `students` row with `subjects=['AP World History']` so the portal AP World branch can be E2E tested (TODO #19). Trivial Supabase SQL Editor step.
   - **Seed 2024 AP World FRQ set** (TODO #16) — pipeline proven; just need the 2024 PDF pair.
   - **Seed 2024/2023/2022 APUSH sets** — same pipeline. Lets APUSH students get reps beyond 8 questions.
   - **DBQ stimulus/prompt split** (TODO #1) — biggest UX improvement; 8k blob with inline documents is ugly.
   - **Period tagging pass** (TODO #2) — `unit='Unassigned'` on all 27 rows.
   - **Quick cleanups** — TODOs #6, #12, #13 are sub-30-min.
   - **AI grader** — bigger project; design first.
2. Roughly in priority order I'd suggest: APWH student row → more seeds → DBQ split → Period tagging → AI grader.

## Key file locations (full state as of 2026-05-28)

```
vault-v2.html                                            # MODIFIED — subject-param generalization
portal.html                                              # MODIFIED — AP World branch in buildPracticeVault()
supabase/migrations/20260523120000_question_bank.sql            # from 2026-05-23
supabase/migrations/20260523220000_add_sub_index.sql            # from 2026-05-23
supabase/migrations/20260524120000_vault_v2_attempts_relax.sql  # from 2026-05-24
supabase/migrations/20260524130000_question_bank_parent_question_number.sql  # from 2026-05-24
scripts/seed-apush-2025-set-1.mjs                        # MODIFIED 2026-05-24 — populates parent_question_number
scripts/seed-apworld-2025-set-1.mjs                      # NEW 2026-05-28 — 11 AP World rows
scripts/verify-parent-numbers.mjs                        # from 2026-05-24
scripts/inspect-attempts.mjs                             # from 2026-05-24 (hardcodes placeholder UUID — TODO #12)
```

## Commits shipped this session (2026-05-28)

```
3628730 Add AP World History practice vault (vault-v2 + portal branch)
```

Pushed to `origin/main`.

## How to test the AP World vault locally

```
python3 -m http.server 8000          # from repo root
open http://localhost:8000/vault-v2.html?subject=apworld
# no auth needed for a direct URL test — resolveStudent() will show "not signed in" error
# for full portal flow: need a student row with subjects=['AP World History'] (TODO #19)
```

## How to test the vault locally

```
python3 -m http.server 8000          # from repo root
open http://localhost:8000/portal.html
# log in as AK26 (Arnav Kumar — only student with subjects=['AP US History'])
# click Practice Vault sidebar → see intro card → click Open Practice Vault →
# walk all 8 screens
```

After a real-student run, `scripts/inspect-attempts.mjs` won't pick up the attempts because it hardcodes the placeholder UUID — check Supabase Table Editor directly or wait for TODO #12.
