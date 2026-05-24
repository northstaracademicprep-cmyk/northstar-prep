/**
 * truncate-question-bank.mjs
 *
 * One-shot: delete all rows from question_bank. PostgREST requires a filter
 * clause for DELETE as a safety guard, so we use `id NEQ all-zeros UUID`
 * which matches every real row.
 *
 * Run only when you want a clean slate.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function count() {
  const { count, error } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count;
}

const before = await count();
console.log(`BEFORE: ${before} rows`);

const { error } = await supabase
  .from('question_bank')
  .delete()
  .neq('id', '00000000-0000-0000-0000-000000000000');
if (error) throw new Error(`Delete failed: ${error.message}`);

const after = await count();
console.log(`AFTER:  ${after} rows`);

if (after !== 0) throw new Error(`Expected 0 rows after truncate, got ${after}`);
console.log('✓ question_bank is empty.');
