/**
 * verify-post-fix.mjs
 *
 * Runs the user-spec verification queries after the SAQ-contamination fix +
 * sub_index column addition. Reports pass/fail on four expected properties:
 *
 *   1. question_type counts: saq=12, dbq=1, leq=3
 *   2. Q1's three SAQ rows (A/B/C) all share the Wilentz/Bouton stimulus
 *   3. Q2's three SAQ rows (A/B/C) all share the Webster stimulus
 *   4. Q3 & Q4's six SAQ rows all have null/empty stimulus (No Stimulus type)
 *   + bonus: no question_text leaks the next question's content
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const checks = [];
const fail = (label, detail) => { checks.push({ pass: false, label, detail }); };
const pass = (label) => { checks.push({ pass: true, label }); };

// ── Query 1: GROUP BY question_type ───────────────────────────────────────
const { data: allTypes } = await supabase.from('question_bank').select('question_type');
const counts = {};
for (const r of allTypes) counts[r.question_type] = (counts[r.question_type] || 0) + 1;

console.log('── Query 1: SELECT question_type, count(*) FROM question_bank GROUP BY question_type ──');
for (const [t, c] of Object.entries(counts).sort()) console.log(`  ${t.padEnd(8)} ${c}`);
console.log(`  total    ${allTypes.length}`);

if (counts.saq === 12 && counts.dbq === 1 && counts.leq === 3 && allTypes.length === 16) {
  pass('Property 1: counts saq=12, dbq=1, leq=3');
} else {
  fail('Property 1: counts', JSON.stringify(counts));
}

// ── Query 2: user's literal verification query ────────────────────────────
const { data: saqRows } = await supabase
  .from('question_bank')
  .select('stimulus, question_text, sub_index, created_at')
  .eq('question_type', 'saq')
  .order('created_at', { ascending: true });

console.log(`\n── Query 2: SELECT LEFT(stimulus,80), LEFT(question_text,80), sub_index FROM question_bank WHERE question_type='saq' ORDER BY created_at ──`);
console.log(`  ${'sub_idx'.padEnd(8)}  ${'stimulus[0..80]'.padEnd(82)}  question_text[0..80]`);
console.log(`  ${'─'.padEnd(8, '─')}  ${'─'.padEnd(82, '─')}  ─`.padEnd(180, '─'));
for (const r of saqRows) {
  const stim = (r.stimulus ?? '(null)').replace(/\s+/g, ' ').slice(0, 80).padEnd(80);
  const qt   = (r.question_text ?? '').replace(/\s+/g, ' ').slice(0, 80);
  console.log(`  ${(r.sub_index ?? '?').padEnd(8)}  "${stim}"  "${qt}"`);
}

// ── Property checks: group SAQ rows by stimulus and validate ──────────────
const byStimulus = new Map();
for (const r of saqRows) {
  const key = r.stimulus || '__NULL__';
  if (!byStimulus.has(key)) byStimulus.set(key, []);
  byStimulus.get(key).push(r);
}

// Properties 2 & 3: which stimulus groups exist?
const groups = [...byStimulus.entries()].map(([key, rows]) => ({
  preview: key === '__NULL__' ? '(null)' : key.slice(0, 60).replace(/\s+/g, ' '),
  isNull: key === '__NULL__',
  size: rows.length,
  subIndices: rows.map(r => r.sub_index).sort().join(','),
  containsWilentz: key.includes('Wilentz') && key.includes('Bouton'),
  containsWebster: key.includes('Webster'),
}));

console.log(`\n── SAQ rows grouped by stimulus ──`);
for (const g of groups) {
  console.log(`  size=${g.size}  parts=${g.subIndices}  stimulus="${g.preview}…"`);
}

const wilentzGroup = groups.find(g => g.containsWilentz);
const websterGroup = groups.find(g => g.containsWebster);
const nullGroup    = groups.find(g => g.isNull);

if (wilentzGroup && wilentzGroup.size === 3 && wilentzGroup.subIndices === 'A,B,C') {
  pass('Property 2: Q1 — three SAQ rows (A,B,C) share Wilentz/Bouton stimulus');
} else {
  fail('Property 2', `wilentzGroup=${JSON.stringify(wilentzGroup)}`);
}

if (websterGroup && websterGroup.size === 3 && websterGroup.subIndices === 'A,B,C') {
  pass('Property 3: Q2 — three SAQ rows (A,B,C) share Webster stimulus');
} else {
  fail('Property 3', `websterGroup=${JSON.stringify(websterGroup)}`);
}

if (nullGroup && nullGroup.size === 6) {
  pass('Property 4: Q3+Q4 — six SAQ rows have null stimulus (No Stimulus type)');
} else {
  fail('Property 4', `nullGroup size=${nullGroup?.size ?? 0}, expected 6`);
}

// Bonus check: no question_text contains an opening quote followed by a long
// run of stimulus-like content (the leakage pattern). Allow opening quotes
// in legitimate prompt text but flag if a question_text contains "Source:"
// or "[" + a long passage.
let leakageDetected = false;
for (const r of saqRows) {
  const qt = r.question_text || '';
  // The bug signature was Part C ending with `"[There is a]` (Webster opening)
  // or any source attribution `Source: <name>, <title>` inside the prompt.
  if (/Source: [A-Z]/.test(qt) || /^.*"[\[].*$/.test(qt.split('\n').pop() || '')) {
    leakageDetected = true;
    console.log(`  ⚠ Possible leakage in sub_index=${r.sub_index}: "…${qt.slice(-80)}"`);
  }
}
if (!leakageDetected) {
  pass('Bonus: no question_text shows the stimulus-leakage pattern');
} else {
  fail('Bonus: leakage pattern detected', 'see warnings above');
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n══ Verification summary ══');
for (const c of checks) {
  console.log(`  ${c.pass ? '✅' : '❌'} ${c.label}${c.pass ? '' : ' — ' + c.detail}`);
}
const allPassed = checks.every(c => c.pass);
console.log(`\n${allPassed ? '✅ ALL PROPERTIES PASS' : '❌ FAILURES PRESENT — STOPPING'}`);
process.exit(allPassed ? 0 : 1);
