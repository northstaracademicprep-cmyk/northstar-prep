/**
 * inspect-question-bank.mjs
 *
 * Quick verification queries for tonight's smoke-test result.
 * Mirrors what you'll see in the Supabase Table Editor tomorrow.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Query 1: group by question_type ───────────────────────────────────────
console.log("── SELECT question_type, count(*) FROM question_bank GROUP BY question_type ──");
const { data: allTypes, error: typeErr } = await supabase
  .from('question_bank')
  .select('question_type');
if (typeErr) throw new Error(typeErr.message);

const counts = {};
for (const r of allTypes) counts[r.question_type] = (counts[r.question_type] || 0) + 1;
for (const [t, c] of Object.entries(counts).sort()) {
  console.log(`  ${t.padEnd(8)} ${c}`);
}
console.log(`  ──────────`);
console.log(`  total    ${allTypes.length}`);

// ── Query 2a: user's literal query (will return 0) ────────────────────────
console.log("\n── SELECT question_text FROM question_bank WHERE question_type LIKE 'frq_saq%' LIMIT 3 ──");
const { data: literalRows, error: litErr } = await supabase
  .from('question_bank')
  .select('question_text')
  .like('question_type', 'frq_saq%')
  .limit(3);
if (litErr) throw new Error(litErr.message);
console.log(literalRows.length === 0
  ? `  (0 rows — we stored question_type as 'saq', not 'frq_saq', to satisfy the schema CHECK constraint)`
  : literalRows.map(r => `  • ${r.question_text.slice(0,200)}`).join('\n')
);

// ── Query 2b: corrected to actual stored value ────────────────────────────
console.log("\n── (Corrected) SELECT question_text FROM question_bank WHERE question_type = 'saq' LIMIT 3 ──");
const { data: saqRows, error: saqErr } = await supabase
  .from('question_bank')
  .select('question_text')
  .eq('question_type', 'saq')
  .limit(3);
if (saqErr) throw new Error(saqErr.message);
saqRows.forEach((r, i) => {
  const t = r.question_text;
  console.log(`  ${i+1}. ${t.length > 200 ? t.slice(0,200) + '…' : t}`);
});
