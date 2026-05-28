/**
 * seed-apworld-2025-set-1.mjs
 *
 * Parses the 2025 AP World History: Modern FRQ + scoring PDFs (already
 * converted to .txt) and inserts into question_bank.
 *
 * Expected row count: 11
 *   - 3 SAQ questions (Q1-Q3) × 3 parts each = 9 rows
 *   - 1 DBQ (Section II Q1)                   = 1 row
 *   - 1 LEQ (Section II Q2)                   = 1 row
 *
 * Seeding only Q1-Q3 SAQ (Q4 is the exam's alternate choice for Q3; students
 * answer exactly one of them on test day, so we seed Q3 as the "canonical" one).
 * Seeding only LEQ Q2 (first listed choice).
 *
 * parent_question_number scheme:
 *   SAQ Q1 → 1, SAQ Q2 → 2, SAQ Q3 → 3
 *   DBQ (Section II Q1) → 1 + 3 = 4
 *   LEQ (Section II Q2) → 2 + 3 = 5
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ── Constants ────────────────────────────────────────────────────────────────
const SUBJECT            = 'AP World History';
const SOURCE_YEAR        = 2025;
const SAQ_COUNT          = 3;   // seed Q1-Q3; Q4 is the alternate-choice SAQ
const LEQ_Q_NUMBER       = 2;   // seed LEQ Q2 only (first listed LEQ choice)
const SECTION_II_OFFSET  = 3;   // parent_question_number = q.number + offset for DBQ/LEQ
const EXPECTED_ROW_COUNT = 11;

// ── 1. Env + Supabase client ──────────────────────────────────────────────────
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
console.log('✓ Supabase client initialized');

// ── 2. Normalize raw extracted text ───────────────────────────────────────────
function normalize(raw) {
  return raw
    // Fix split AP® across lines
    .replace(/AP\n®/g, 'AP®')
    // Strip pdfplumber page markers
    .replace(/^-- \d+ of \d+ --\s*$/gm, '')
    // Strip College Board boilerplate
    .replace(/^Visit College Board on the web:.*$/gm, '')
    .replace(/^AP Central is the official.*$/gm, '')
    .replace(/^© \d{4} College Board\..*$/gm, '')
    // Strip AP World FRQ paper page headers
    .replace(/^AP WORLD HISTORY: MODERN \d{4}.*FREE-RESPONSE QUESTIONS\s*$/gim, '')
    // Strip AP World scoring guide page headers
    .replace(/^AP® World History: Modern \d{4} Scoring Guidelines\s*$/gm, '')
    // Strip section/timing headers
    .replace(/^WORLD\s+HISTORY:\s+MODERN\s*$/gm, '')
    .replace(/^SECTION\s+I[,\s]+Part\s+B.*$/gim, '')
    .replace(/^Time[—–-]\s*\d+\s+minutes?\s*$/gim, '')
    .replace(/^TIME\s*[—–-]\s*\d+\s+MINUTES?\s*$/gim, '')
    .replace(/^SECTION\s+II\s*$/gim, '')
    .replace(/^Total Time[—–-].*$/gim, '')
    // Strip "Answer either Question N or Question M" instruction lines
    .replace(/^Answer (?:Question \d+|either Question \d+ or Question \d+)\.\s*$/gim, '')
    .replace(/^Answer Question \d+ or Question \d+ or Question \d+\.\s*$/gim, '')
    // Strip "Question N, 3, or 4 (Long Essay)" heading lines
    .replace(/^Question \d+,\s*\d+,\s*or\s*\d+\s*\(Long Essay\)\s*$/gim, '')
    // Strip suggested timing lines
    .replace(/^Suggested (?:reading and )?writing time:.*$/gim, '')
    .replace(/^It is suggested that you spend.*$/gim, '')
    // Strip exam administration note
    .replace(/^Note: This exam was originally administered.*$/gim, '')
    .replace(/^teacher and student use in the classroom\.\s*$/gim, '')
    // Strip "END OF" lines
    .replace(/^(?:STOP|END OF EXAM|END OF SECTION I|END OF DOCUMENTS FOR QUESTION \d+)\s*$/gim, '')
    .replace(/^GO\s+ON TO THE NEXT PAGE\.\s*$/gim, '')
    // Strip standalone question/section direction headings
    .replace(/^Question \d+ \(Document-Based Question\)\s*$/gim, '')
    .replace(/^Question \d+, \d+ or \d+ \(Long Essay\)\s*$/gim, '')
    // Strip numbered page markers at line end
    .replace(/\bcollegeboard\.org\b.*\d+\s*$/gm, '')
    // Collapse whitespace
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 3. Parse the FRQ paper ────────────────────────────────────────────────────
// Handles both 2025 (uppercase "A. B. C.") and 2024 ("a. b. c.") part formats.
// Handles both "Respond to parts A, B, and C." and "Using the X, respond to parts a, b, c."
// Detects LEQ prompts via "N. In the period..." / "N. During the..." in Section II.

function extractStimulus(rawLines) {
  let startIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    // Stimuli in AP World start with a quote (ASCII or curly left/right U+201C/D), or “Source N”
    if (/^["\u201C\u201D]/.test(t) || /^Source \d+\b/.test(t)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return null;
  return rawLines.slice(startIdx).join('\n').trim() || null;
}

function parseFrqs(text) {
  const lines = text.split('\n');
  const questions = [];
  let stimulusLines = [];
  let currentQ = null;
  let currentPart = null;

  const flushPart = () => {
    if (currentPart && currentQ) {
      currentPart.prompt = currentPart.prompt.trim();
      currentQ.parts.push(currentPart);
      currentPart = null;
    }
  };
  const flushQuestion = () => {
    flushPart();
    if (currentQ) {
      currentQ.stimulus = extractStimulus(currentQ._rawStimulusLines || []);
      delete currentQ._rawStimulusLines;
      if (currentQ.fullPrompt) currentQ.fullPrompt = currentQ.fullPrompt.trim();
      questions.push(currentQ);
      currentQ = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // ── SAQ header: "1. Respond to parts A, B, and C."
    //               "1. Using the excerpt, respond to parts a, b, and c."
    const saqHeader = trimmed.match(/^(\d+)\.\s+(?:Using the .+?,\s+)?[Rr]espond to parts\s+(.+?)\.\s*$/);
    if (saqHeader) {
      flushQuestion();
      currentQ = {
        number: parseInt(saqHeader[1]),
        type: 'saq',
        _rawStimulusLines: stimulusLines,
        parts: [],
      };
      stimulusLines = [];
      continue;
    }

    // ── DBQ header: "1. Evaluate the extent to which..." (action verb style)
    const dbqHeader = trimmed.match(
      /^(\d+)\.\s+(Evaluate|Analyze|Compare|Explain|Assess|Discuss|Account|Describe|To what extent)\s+(.+)$/
    );
    if (dbqHeader) {
      flushQuestion();
      currentQ = {
        number: parseInt(dbqHeader[1]),
        type: 'long_form',
        _rawStimulusLines: stimulusLines,
        parts: [],
        fullPrompt: `${dbqHeader[2]} ${dbqHeader[3]}`,
      };
      stimulusLines = [];
      continue;
    }

    // ── LEQ intro header: "2. In the period circa 1200..." / "4. During the twentieth century..."
    // AP World LEQs start with a context sentence, not an action verb.
    const leqIntro = trimmed.match(/^(\d+)\.\s+(In the (?:period|twentieth|nineteenth|twenty|1[0-9])|During the )\s*(.+)$/i);
    if (leqIntro && !currentPart) {
      flushQuestion();
      currentQ = {
        number: parseInt(leqIntro[1]),
        type: 'long_form',
        _rawStimulusLines: stimulusLines,
        parts: [],
        fullPrompt: trimmed.slice(trimmed.indexOf('.') + 1).trim(),
      };
      stimulusLines = [];
      continue;
    }

    // ── Part letter (SAQ only): "A. Briefly describe..." or "a. Identify ONE..."
    const partHeader = trimmed.match(/^([A-Da-d])\.\s+(.+)$/);
    if (partHeader && currentQ && currentQ.type === 'saq') {
      flushPart();
      currentPart = { letter: partHeader[1].toUpperCase(), prompt: partHeader[2].trim() };
      continue;
    }

    // ── Stimulus-boundary detection: opening quote starts next question's stimulus
    const looksLikeStimulusMarker =
      /^["\u201C\u201D]/.test(trimmed) || /^Source \d+\b/.test(trimmed);
    if (currentPart && looksLikeStimulusMarker) {
      flushQuestion();
      stimulusLines.push(line);
      continue;
    }

    // ── Continuation logic
    if (currentPart) {
      if (trimmed) currentPart.prompt += ' ' + trimmed;
    } else if (currentQ && currentQ.fullPrompt !== undefined) {
      if (trimmed) currentQ.fullPrompt += ' ' + trimmed;
    } else if (!currentQ) {
      stimulusLines.push(line);
    }
  }
  flushQuestion();
  return questions;
}

// ── 4. Parse the scoring guidelines ───────────────────────────────────────────
function parseScoring(text) {
  const out = [];
  const headers = [];
  // AP World scoring headers have leading whitespace and many spaces between label and points
  const headerRegex = /^\s*Question (\d+):\s+(.+?)\s+(\d+)\s+points?\s*$/gm;
  let m;
  while ((m = headerRegex.exec(text)) !== null) {
    headers.push({
      index: m.index,
      end: m.index + m[0].length,
      number: parseInt(m[1]),
      typeLabel: m[2].trim(),
      totalPoints: parseInt(m[3]),
    });
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const next = headers[i + 1];
    const chunk = text.slice(h.end, next ? next.index : text.length).trim();
    out.push({
      number: h.number,
      typeLabel: h.typeLabel,
      totalPoints: h.totalPoints,
      parts: parsePartsFromScoring(chunk),
      fullRubric: chunk,
    });
  }
  return out;
}

// AP World scoring guide part format (after normalize collapses spaces):
//   " A Identify one claim... 1 point"
//   " discovery of the Americas on Africa."
//   ""
//   " Examples of acceptable responses may include the following:"
//   " • The African gold markets were destroyed."
//
// We find parts by looking for lines starting with a single uppercase letter
// followed by a space and non-whitespace, with "1 point" in the surrounding context.
function parsePartsFromScoring(chunk) {
  const parts = [];
  const lines = chunk.split('\n');
  const anchors = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    // Part-start: single A/B/C letter, spaces, then content, ends with (or nearby has) "1 point"
    if (/^[A-C]\s+\S/.test(t) && t.includes('1 point')) {
      anchors.push({ lineIndex: i, letter: t[0] });
    }
  }

  for (let i = 0; i < anchors.length; i++) {
    const startLine = anchors[i].lineIndex;
    const endLine   = anchors[i + 1] ? anchors[i + 1].lineIndex : lines.length;
    const section   = lines.slice(startLine, endLine).join('\n');

    const examplesMarker = 'Examples of acceptable responses may include the following:';
    const examplesIdx = section.indexOf(examplesMarker);
    if (examplesIdx < 0) continue;

    const bulletText = section.slice(examplesIdx + examplesMarker.length);
    const bullets = bulletText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('•'))
      .map(l => l.slice(1).trim())
      .filter(Boolean);

    if (bullets.length > 0) {
      parts.push({ letter: anchors[i].letter, bullets });
    }
  }
  return parts;
}

// ── 5. Build question_bank-shaped rows ────────────────────────────────────────
function buildSAQRow(q, part, scorePart) {
  const officialExplanation = scorePart
    ? `**1 point** — Examples of acceptable responses include:\n\n${scorePart.bullets.map(b => `- ${b}`).join('\n')}`
    : '(rubric not found for this part — needs review)';

  return {
    subject:                   SUBJECT,
    unit:                      'Unassigned',
    unit_number:               null,
    topic:                     null,
    question_type:             'saq',
    difficulty:                'medium',
    stimulus:                  q.stimulus || null,
    stimulus_image_url:        null,
    question_text:             part.prompt,
    choices:                   null,
    correct_answer:            'See official_explanation',
    official_explanation:      officialExplanation,
    wrong_answer_explanations: null,
    source:                    'College Board',
    source_year:               SOURCE_YEAR,
    tags:                      [],
    sub_index:                 part.letter,           // 'A' | 'B' | 'C'
    parent_question_number:    q.number,              // 1, 2, 3
  };
}

function buildLongFormRow(q, score, type) {
  return {
    subject:                   SUBJECT,
    unit:                      'Unassigned',
    unit_number:               null,
    topic:                     null,
    question_type:             type,                  // 'dbq' or 'leq'
    difficulty:                'hard',
    stimulus:                  q.stimulus || null,
    stimulus_image_url:        null,
    question_text:             q.fullPrompt || '(prompt not extracted — needs follow-up parser)',
    choices:                   null,
    correct_answer:            'See official_explanation',
    official_explanation:      score.fullRubric,
    wrong_answer_explanations: null,
    source:                    'College Board',
    source_year:               SOURCE_YEAR,
    tags:                      [],
    sub_index:                 null,
    parent_question_number:    q.number + SECTION_II_OFFSET,
  };
}

// Map scoring typeLabel → family key for join
const familyOfScoring = (typeLabel) => {
  if (/Short Answer/i.test(typeLabel))    return 'saq';
  if (/Document-Based/i.test(typeLabel))  return 'dbq';
  if (/Long Essay/i.test(typeLabel))      return 'leq';
  return 'unknown';
};

function buildRows(frqs, scoring) {
  const rows = [];
  const scoringByFamily = { saq: [], dbq: [], leq: [] };
  for (const s of scoring) {
    const fam = familyOfScoring(s.typeLabel);
    if (scoringByFamily[fam]) scoringByFamily[fam].push(s);
  }

  for (const q of frqs) {
    if (q.type === 'saq') {
      // Skip Q4 — it's the alternate choice paired with Q3 on the actual exam.
      if (q.number > SAQ_COUNT) continue;
      const score = scoringByFamily.saq.find(s => s.number === q.number);
      if (!score) { console.warn(`  ⚠ No SAQ scoring found for Q${q.number}`); continue; }
      for (const part of q.parts) {
        const scorePart = score.parts.find(p => p.letter === part.letter);
        rows.push(buildSAQRow(q, part, scorePart));
      }
    } else if (q.type === 'long_form') {
      const dbqMatch = scoringByFamily.dbq.find(s => s.number === q.number);
      const leqMatch = scoringByFamily.leq.find(s => s.number === q.number);
      if (dbqMatch) {
        rows.push(buildLongFormRow(q, dbqMatch, 'dbq'));
      } else if (leqMatch) {
        if (q.number !== LEQ_Q_NUMBER) continue; // seed only LEQ Q2
        rows.push(buildLongFormRow(q, leqMatch, 'leq'));
      }
    }
  }
  return rows;
}

// ── 6. Run ────────────────────────────────────────────────────────────────────
const frqText     = normalize(await readFile('/tmp/apworld-2025-set-1-frqs.txt',     'utf8'));
const scoringText = normalize(await readFile('/tmp/apworld-2025-set-1-scoring.txt', 'utf8'));

const frqs    = parseFrqs(frqText);
const scoring = parseScoring(scoringText);

console.log(`\n✓ Parsed FRQ paper:    ${frqs.length} questions detected`);
for (const q of frqs) {
  const detail = q.type === 'saq'
    ? `${q.parts.length} parts  stimulus=${q.stimulus ? q.stimulus.slice(0,40).replace(/\n/g,' ')+'…' : 'none'}`
    : `full prompt (${q.fullPrompt?.length || 0} chars)`;
  console.log(`    Q${q.number}: ${q.type} — ${detail}`);
}
console.log(`✓ Parsed scoring guide: ${scoring.length} entries detected`);
for (const s of scoring) {
  console.log(`    Q${s.number}: "${s.typeLabel}" — ${s.totalPoints} pts, ${s.parts.length} parsed parts`);
}

const rows = buildRows(frqs, scoring);

// Summary
const saqCount = rows.filter(r => r.question_type === 'saq').length;
const dbqCount = rows.filter(r => r.question_type === 'dbq').length;
const leqCount = rows.filter(r => r.question_type === 'leq').length;
console.log(`\n✓ Built ${rows.length} total rows (${saqCount} SAQ parts, ${dbqCount} DBQ, ${leqCount} LEQ)`);

// Print sample for eyeball check
if (rows.length > 0) {
  const sample = rows[0];
  console.log('\n── Sample row (Q1 Part A) ──');
  console.log('  question_type:', sample.question_type);
  console.log('  question_text:', sample.question_text?.slice(0, 120));
  console.log('  stimulus:', sample.stimulus ? sample.stimulus.slice(0, 80).replace(/\n/g,' ')+'…' : 'null');
  console.log('  official_explanation:', sample.official_explanation?.slice(0, 120));
  console.log('  parent_question_number:', sample.parent_question_number);
  console.log('  sub_index:', sample.sub_index);
}

// ── 7. Insert with idempotency + safety check ─────────────────────────────────
async function totalRowCount() {
  const { count, error } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Count failed: ${error.message}`);
  return count;
}

async function fetchExistingBatch() {
  const { data, error } = await supabase
    .from('question_bank')
    .select('id, question_text')
    .eq('source', 'College Board')
    .eq('source_year', SOURCE_YEAR)
    .eq('subject', SUBJECT);
  if (error) throw new Error(`Pre-fetch failed: ${error.message}`);
  return data || [];
}

console.log('\n── Insert phase ──');
const beforeCount = await totalRowCount();
console.log(`  Rows in question_bank BEFORE: ${beforeCount}`);

const existing = await fetchExistingBatch();
const existingByText = new Map(existing.map(r => [r.question_text, r.id]));

const toInsert = [];
const toUpdate = [];
for (const r of rows) {
  if (existingByText.has(r.question_text)) {
    toUpdate.push({ id: existingByText.get(r.question_text), data: r });
  } else {
    toInsert.push(r);
  }
}
console.log(`  Plan: ${toInsert.length} new insert(s), ${toUpdate.length} existing match(es) to refresh`);

if (toInsert.length) {
  const { error } = await supabase.from('question_bank').insert(toInsert);
  if (error) throw new Error(`Bulk insert failed: ${error.message}`);
}
for (const u of toUpdate) {
  const { error } = await supabase.from('question_bank').update(u.data).eq('id', u.id);
  if (error) throw new Error(`Update of id=${u.id} failed: ${error.message}`);
}

const afterCount = await totalRowCount();
console.log(`  Rows in question_bank AFTER:  ${afterCount}`);

const delta    = afterCount - beforeCount;
const inserted = toInsert.length;
const updated  = toUpdate.length;

const isFirstRun   = (delta === EXPECTED_ROW_COUNT && inserted === EXPECTED_ROW_COUNT && updated === 0);
const isCleanReRun = (delta === 0 && inserted === 0 && updated === EXPECTED_ROW_COUNT);
if (!isFirstRun && !isCleanReRun) {
  throw new Error(
    `SAFETY CHECK FAILED: expected (delta=${EXPECTED_ROW_COUNT}, inserted=${EXPECTED_ROW_COUNT}, updated=0) ` +
    `OR (delta=0, inserted=0, updated=${EXPECTED_ROW_COUNT}). ` +
    `Got delta=${delta}, inserted=${inserted}, updated=${updated}.`
  );
}
console.log(isFirstRun
  ? `  ✓ Safety check passed (first run): delta=${EXPECTED_ROW_COUNT}, all rows newly inserted.`
  : `  ✓ Safety check passed (clean re-run): delta=0, all ${EXPECTED_ROW_COUNT} rows matched & refreshed.`
);

// ── 8. Post-insert verification ───────────────────────────────────────────────
console.log('\n── Verification ──');
const { count: scopedCount, error: scopedErr } = await supabase
  .from('question_bank')
  .select('*', { count: 'exact', head: true })
  .eq('source', 'College Board')
  .eq('source_year', SOURCE_YEAR)
  .eq('subject', SUBJECT);
if (scopedErr) throw new Error(`Scoped count failed: ${scopedErr.message}`);
console.log(`  SELECT count(*) WHERE subject='${SUBJECT}' AND source_year=${SOURCE_YEAR} → ${scopedCount}`);

const { data: sampleRows, error: sampleErr } = await supabase
  .from('question_bank')
  .select('question_text, parent_question_number, sub_index')
  .eq('source_year', SOURCE_YEAR)
  .eq('subject', SUBJECT)
  .order('parent_question_number', { ascending: true })
  .order('sub_index', { ascending: true, nullsFirst: false });
if (sampleErr) throw new Error(`Sample SELECT failed: ${sampleErr.message}`);
console.log('  Rows by parent_question_number + sub_index:');
for (const r of (sampleRows || [])) {
  const label = `Q${r.parent_question_number}${r.sub_index ? '-' + r.sub_index : ''}`;
  console.log(`    ${label}: ${r.question_text?.slice(0, 80).replace(/\n/g,' ')}…`);
}

console.log('\n✓ Done.');
