/**
 * seed-apush-2025-set-1.mjs
 *
 * STATUS: smoke test — parses both PDFs into question_bank-shaped rows,
 * prints SAQ 1 Part A as JSON, prints the row-count summary. NO DB writes.
 *
 * Once eyeball-approved, the smoke-test block becomes a real bulk insert.
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ── 1. Env + Supabase client (constructed but unused this run) ────────────
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
console.log('✓ Supabase client initialized (no DB writes this run)');

// ── 2. Normalize raw extracted text ───────────────────────────────────────
// Strips page noise, fixes the split AP®, collapses tabs/whitespace.
function normalize(raw) {
  return raw
    .replace(/AP\n®/g, 'AP®')
    .replace(/^-- \d+ of \d+ --\s*$/gm, '')
    .replace(/^Visit College Board on the web:.*$/gm, '')
    .replace(/^© \d{4} College Board\.?\s*$/gm, '')
    .replace(/^AP UNITED STATES HISTORY \d{4}.*FREE-RESPONSE QUESTIONS\s*$/gm, '')
    .replace(/^AP® United States History \d{4} Scoring Guidelines\s*$/gm, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 3. Parse the FRQ paper ────────────────────────────────────────────────
// State machine: accumulate stimulus lines until we hit a question header,
// then accumulate part prompts until the next header.

// Bug 1 fix: SAQ Q3/Q4 are "No Stimulus" — and Q1/Q2's stimulus starts at the
// first "Source N" line or opening quotation mark. Anything before that
// (title page, section instructions) is boilerplate that must be stripped.
function extractStimulus(rawLines) {
  let startIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    const startsWithSourceMarker = /^Source \d+\b/.test(t);
    const startsWithQuote = /^["“”]/.test(t);
    if (startsWithSourceMarker || startsWithQuote) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return null;
  return rawLines.slice(startIdx).join('\n').trim();
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
      // Bug 1 fix: extract just the stimulus, not the boilerplate
      currentQ.stimulus = extractStimulus((currentQ._rawStimulusLines || []));
      delete currentQ._rawStimulusLines;
      if (currentQ.fullPrompt) currentQ.fullPrompt = currentQ.fullPrompt.trim();
      questions.push(currentQ);
      currentQ = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // SAQ header: "1. Respond to parts A, B, and C."
    const saqHeader = trimmed.match(/^(\d+)\.\s+Respond to parts\s+(.+?)\.\s*$/);
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

    // DBQ/LEQ header: "1. Evaluate the extent to which ..." (full-prompt style)
    // Bug 4 fix: dropped the bogus parts-length guard. Action-verb prefix
    // is distinctive enough to fire reliably; numbered lines mid-SAQ stimulus
    // don't combine "N." with these verbs.
    const fullPromptHeader = trimmed.match(/^(\d+)\.\s+(Evaluate|Analyze|Compare|Explain|Assess|Discuss|Account|Describe|To what extent)\s+(.+)$/);
    if (fullPromptHeader) {
      flushQuestion();
      currentQ = {
        number: parseInt(fullPromptHeader[1]),
        type: 'long_form',  // resolved to dbq/leq via the scoring file's type label
        _rawStimulusLines: stimulusLines,
        parts: [],
        fullPrompt: `${fullPromptHeader[2]} ${fullPromptHeader[3]}`,
      };
      stimulusLines = [];
      continue;
    }

    // Part letter (only relevant inside a SAQ): "A. Briefly describe ..."
    const partHeader = trimmed.match(/^([A-D])\.\s+(.+)$/);
    if (partHeader && currentQ && currentQ.type === 'saq') {
      flushPart();
      currentPart = { letter: partHeader[1], prompt: partHeader[2].trim() };
      continue;
    }

    // Bug fix #1 (post-smoke-test): if we're mid-part and a stimulus marker
    // arrives ("Source N" line or opening quote), the part is finished —
    // flush the question and accumulate this line as stimulus for the NEXT
    // question. Without this, the last part of each SAQ absorbed the next
    // question's stimulus as part-prompt continuation, AND the next
    // question's stimulus field came out empty.
    const looksLikeStimulusMarker =
      /^Source \d+\b/.test(trimmed) || /^["“”]/.test(trimmed);
    if (currentPart && looksLikeStimulusMarker) {
      flushQuestion();
      stimulusLines.push(line);
      continue;
    }

    // Continuation logic
    if (currentPart) {
      if (trimmed) currentPart.prompt += ' ' + trimmed;
    } else if (currentQ && currentQ.fullPrompt !== undefined) {
      if (trimmed) currentQ.fullPrompt += ' ' + trimmed;
    } else if (!currentQ) {
      // Before first question — accumulate as stimulus for next question
      stimulusLines.push(line);
    } else {
      // Between SAQ header and first part — shouldn't happen in well-formed input
    }
  }
  flushQuestion();
  return questions;
}

// ── 4. Parse the scoring guidelines ───────────────────────────────────────
function parseScoring(text) {
  const out = [];
  const headers = [];
  const headerRegex = /^Question (\d+):\s+(.+?)\s+(\d+)\s+points?\s*$/gm;
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

// Each part starts at `^[A-Z] <non-space>`, contains "1 point" + the
// "Examples of acceptable responses may include the following:" marker,
// and a bullet list of acceptable answers.
function parsePartsFromScoring(chunk) {
  const parts = [];
  const anchors = [];
  const lineStartRegex = /^([A-Z]) \S/gm;
  let m;
  while ((m = lineStartRegex.exec(chunk)) !== null) {
    anchors.push({ start: m.index, letter: m[1] });
  }
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const next = anchors[i + 1];
    const body = chunk.slice(a.start, next ? next.start : chunk.length);
    if (!body.includes('1 point') || !body.includes('Examples of acceptable responses may include the following:')) {
      continue;
    }
    const lettered = body.slice(2); // strip leading "X "
    // Bug 2 fix: "1 point" may appear EITHER on its own line (Q1, Q2 part C)
    // OR on the same line as the prompt (Q2 parts A/B, Q3 parts A/B).
    // Accept any whitespace (space, tab, newline) between prompt and "N point".
    const pointMatch = lettered.match(/^([\s\S]+?)[\s]+(\d+) points?[ \t]*\n+Examples of acceptable responses may include the following:\s*\n+([\s\S]+)$/);
    if (pointMatch) {
      const promptRepeat = pointMatch[1].replace(/\n+/g, ' ').replace(/[ ]+/g, ' ').trim();
      const pointsForPart = parseInt(pointMatch[2]);
      const bullets = pointMatch[3]
        .split(/^•\s+/m)
        .map(b => b.replace(/\n+/g, ' ').replace(/[ ]+/g, ' ').trim())
        .filter(Boolean);
      parts.push({ letter: a.letter, promptRepeat, pointsForPart, bullets });
    }
  }
  return parts;
}

// ── 5. Build question_bank-shaped rows ────────────────────────────────────
function buildSAQRow(q, part, scorePart) {
  const officialExplanation = scorePart
    ? `**${scorePart.pointsForPart} point** — Examples of acceptable responses include:\n\n${scorePart.bullets.map(b => `- ${b}`).join('\n')}`
    : '(rubric not found for this part — needs review)';

  return {
    subject: 'AP US History',
    unit: 'Unassigned',          // TODO: tag per Period after eyeball
    unit_number: null,
    topic: null,
    question_type: 'saq',
    difficulty: 'medium',
    stimulus: q.stimulus,
    stimulus_image_url: null,
    question_text: part.prompt,
    choices: null,
    correct_answer: 'See official_explanation',  // FRQs: rubric, not single answer
    official_explanation: officialExplanation,
    wrong_answer_explanations: null,
    source: 'College Board',
    source_year: 2025,
    tags: [],
    sub_index: part.letter,                       // 'A' | 'B' | 'C' — see migration 20260523220000
  };
}

function buildLongFormRow(q, score, type) {
  return {
    subject: 'AP US History',
    unit: 'Unassigned',
    unit_number: null,
    topic: null,
    question_type: type,                 // 'dbq' or 'leq'
    difficulty: 'hard',
    stimulus: q.stimulus || null,
    stimulus_image_url: null,
    question_text: q.fullPrompt || '(prompt not extracted — needs follow-up parser)',
    choices: null,
    correct_answer: 'See official_explanation',
    official_explanation: score.fullRubric,  // raw rubric — will be split into criteria later
    wrong_answer_explanations: null,
    source: 'College Board',
    source_year: 2025,
    tags: [],
    sub_index: null,                              // long-form questions are one row
  };
}

// Bug 3 fix: SAQ Q1 and DBQ Q1 share number=1. Index scoring by
// (type-family, number) so the join can't collide across sections.
const familyOfScoring = (typeLabel) => {
  if (/Short Answer/i.test(typeLabel))    return 'saq';
  if (/Document-Based/i.test(typeLabel))  return 'dbq';
  if (/Long Essay/i.test(typeLabel))      return 'leq';
  return 'unknown';
};

function buildRows(frqs, scoring) {
  const rows = [];
  // Pre-index scoring by family
  const scoringByFamily = { saq: [], dbq: [], leq: [] };
  for (const s of scoring) {
    const fam = familyOfScoring(s.typeLabel);
    if (scoringByFamily[fam]) scoringByFamily[fam].push(s);
  }

  for (const q of frqs) {
    if (q.type === 'saq') {
      const score = scoringByFamily.saq.find(s => s.number === q.number);
      if (!score) continue;
      for (const part of q.parts) {
        const scorePart = score.parts.find(p => p.letter === part.letter);
        rows.push(buildSAQRow(q, part, scorePart));
      }
    } else if (q.type === 'long_form') {
      // FRQ paper's Section II numbers DBQ as Q1, LEQs as Q2-Q4.
      // Scoring uses the same numbering. Look in non-SAQ families.
      const dbqMatch = scoringByFamily.dbq.find(s => s.number === q.number);
      const leqMatch = scoringByFamily.leq.find(s => s.number === q.number);
      if (dbqMatch)      rows.push(buildLongFormRow(q, dbqMatch, 'dbq'));
      else if (leqMatch) rows.push(buildLongFormRow(q, leqMatch, 'leq'));
    }
  }
  return rows;
}

// ── 6. Run ────────────────────────────────────────────────────────────────
const frqText     = normalize(await readFile('/tmp/2025-set-1-frqs.txt',     'utf8'));
const scoringText = normalize(await readFile('/tmp/2025-set-1-scoring.txt', 'utf8'));

const frqs    = parseFrqs(frqText);
const scoring = parseScoring(scoringText);

console.log(`\n✓ Parsed FRQ paper:    ${frqs.length} questions detected`);
for (const q of frqs) {
  const detail = q.type === 'saq'
    ? `${q.parts.length} parts`
    : `full prompt (${q.fullPrompt?.length || 0} chars)`;
  console.log(`    Q${q.number}: ${q.type} — ${detail}`);
}
console.log(`✓ Parsed scoring guide: ${scoring.length} questions detected`);
for (const s of scoring) {
  console.log(`    Q${s.number}: "${s.typeLabel}" — ${s.totalPoints} pts, ${s.parts.length} parsed parts`);
}

const rows = buildRows(frqs, scoring);

// ── 7. Parse summary ──────────────────────────────────────────────────────
const saqParts = rows.filter(r => r.question_type === 'saq').length;
const dbqCount = rows.filter(r => r.question_type === 'dbq').length;
const leqCount = rows.filter(r => r.question_type === 'leq').length;
console.log(`\n✓ Parsed ${rows.length} total rows to process (${saqParts} SAQ parts, ${dbqCount} DBQ, ${leqCount} LEQs)`);

// ── 8. Insert with idempotency + safety check ─────────────────────────────
// Idempotency: pre-fetch existing rows for this (source, source_year) batch
// and match by question_text. Existing rows get updated, new rows get inserted.
// Safety: first-run delta must be 16; clean re-run (all 16 updated) also OK;
// anything else throws.

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
    .eq('source_year', 2025);
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

const delta = afterCount - beforeCount;
const inserted = toInsert.length;
const updated  = toUpdate.length;

const isFirstRun = (delta === 16 && inserted === 16 && updated === 0);
const isCleanReRun = (delta === 0 && inserted === 0 && updated === 16);
if (!isFirstRun && !isCleanReRun) {
  throw new Error(
    `SAFETY CHECK FAILED: expected either (delta=16, inserted=16, updated=0) ` +
    `or (delta=0, inserted=0, updated=16). Got delta=${delta}, inserted=${inserted}, updated=${updated}.`
  );
}
console.log(isFirstRun
  ? `  ✓ Safety check passed (first run): delta=16, all rows newly inserted.`
  : `  ✓ Safety check passed (clean re-run): delta=0, all 16 rows matched & refreshed in-place.`
);

// ── 9. Post-insert verification SELECTs ───────────────────────────────────
console.log('\n── Verification ──');

const { count: scopedCount, error: scopedErr } = await supabase
  .from('question_bank')
  .select('*', { count: 'exact', head: true })
  .eq('source', 'College Board')
  .eq('source_year', 2025);
if (scopedErr) throw new Error(`Scoped count failed: ${scopedErr.message}`);
console.log(`  SELECT count(*) WHERE source='College Board' AND source_year=2025 → ${scopedCount}`);

const { data: sampleRows, error: sampleErr } = await supabase
  .from('question_bank')
  .select('question_text')
  .eq('source_year', 2025)
  .limit(1);
if (sampleErr) throw new Error(`Sample SELECT failed: ${sampleErr.message}`);
const sampleText = sampleRows?.[0]?.question_text;
console.log(`  Sample question_text: ${sampleText ? sampleText.slice(0, 200) + (sampleText.length > 200 ? '…' : '') : '(none)'}`);

console.log('\n✓ Done. Smoke test complete.');
