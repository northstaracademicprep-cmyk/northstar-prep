/**
 * verify-parent-numbers.mjs
 *
 * Post-reseed check: all 16 rows have non-null parent_question_number, and
 * the mapping is what the user spec demands:
 *   SAQ Q1 (×3) → 1
 *   SAQ Q2 (×3) → 2
 *   SAQ Q3 (×3) → 3
 *   SAQ Q4 (×3) → 4
 *   DBQ         → 5
 *   LEQ #1      → 6
 *   LEQ #2      → 7
 *   LEQ #3      → 8
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from('question_bank')
  .select('question_type, sub_index, parent_question_number')
  .order('parent_question_number', { ascending: true })
  .order('sub_index', { ascending: true, nullsFirst: true });

if (error) { console.error('Query failed:', error.message); process.exit(1); }

const expected = {
  1: { type: 'saq', count: 3 },
  2: { type: 'saq', count: 3 },
  3: { type: 'saq', count: 3 },
  4: { type: 'saq', count: 3 },
  5: { type: 'dbq', count: 1 },
  6: { type: 'leq', count: 1 },
  7: { type: 'leq', count: 1 },
  8: { type: 'leq', count: 1 },
};

const byParent = {};
const nullParent = [];
for (const r of data) {
  if (r.parent_question_number == null) nullParent.push(r);
  const k = r.parent_question_number;
  byParent[k] = byParent[k] || [];
  byParent[k].push(r);
}

console.log(`Total rows: ${data.length}`);
console.log(`Rows with NULL parent_question_number: ${nullParent.length}`);
console.log('');

let allPass = true;
for (const k of Object.keys(expected).map(Number).sort((a, b) => a - b)) {
  const rows = byParent[k] || [];
  const exp = expected[k];
  const actualType = rows[0]?.question_type || '(missing)';
  const subs = rows.map(r => r.sub_index || '-').join(',');
  const ok = rows.length === exp.count && actualType === exp.type;
  if (!ok) allPass = false;
  console.log(`  Parent #${k}: expect ${exp.type}×${exp.count} | got ${actualType}×${rows.length} (sub_index: ${subs}) ${ok ? '✓' : '✗'}`);
}

console.log('');
if (allPass && nullParent.length === 0 && data.length === 16) {
  console.log('✅ All checks passed.');
  process.exit(0);
} else {
  console.log('❌ One or more checks failed.');
  process.exit(1);
}
