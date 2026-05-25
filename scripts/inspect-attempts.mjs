import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PLACEHOLDER = '00000000-0000-0000-0000-000000000001';

const { data, error } = await sb
  .from('student_attempts')
  .select('session_id, time_spent_seconds, attempted_at')
  .eq('student_id', PLACEHOLDER)
  .order('attempted_at', { ascending: false });

if (error) { console.error('Query failed:', error.message); process.exit(1); }

console.log(`Total attempts for placeholder student: ${data.length}`);
console.log('');

const bySession = {};
for (const r of data) {
  const k = r.session_id || '(null session)';
  bySession[k] = bySession[k] || { count: 0, times: [], earliest: null, latest: null };
  bySession[k].count++;
  if (r.time_spent_seconds != null) bySession[k].times.push(r.time_spent_seconds);
  if (!bySession[k].earliest || r.attempted_at < bySession[k].earliest) bySession[k].earliest = r.attempted_at;
  if (!bySession[k].latest   || r.attempted_at > bySession[k].latest)   bySession[k].latest   = r.attempted_at;
}

const sessions = Object.entries(bySession)
  .sort((a, b) => (b[1].latest || '').localeCompare(a[1].latest || ''));

console.log(`Sessions: ${sessions.length}`);
console.log('');
for (const [sid, info] of sessions) {
  const avg = info.times.length ? (info.times.reduce((a,b)=>a+b,0) / info.times.length) : 0;
  const min = info.times.length ? Math.min(...info.times) : 0;
  const max = info.times.length ? Math.max(...info.times) : 0;
  console.log(`  session_id: ${sid}`);
  console.log(`    attempts: ${info.count}  (expected 16 for a full run)`);
  console.log(`    time_spent_seconds: avg=${avg.toFixed(1)}  min=${min}  max=${max}`);
  console.log(`    window: ${info.earliest} → ${info.latest}`);
  console.log('');
}
