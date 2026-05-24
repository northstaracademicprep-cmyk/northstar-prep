const SUPABASE_URL = 'https://hqqugqfdlcinktsblupu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn';
const ALG_ID = '5377ae70-795c-48be-b5f0-282298f72e87';

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

const [row] = await sb(`/rest/v1/students?id=eq.${ALG_ID}&select=program_type,progress_config`);
const cfg = row.progress_config;

console.log('── BEFORE ──');
console.log(`  students.program_type:       ${JSON.stringify(row.program_type)}`);
console.log(`  progress_config.programType: ${JSON.stringify(cfg.programType)}`);

cfg.programType = 'Summer Excel';

await sb(`/rest/v1/students?id=eq.${ALG_ID}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ progress_config: cfg }),
});

const [v] = await sb(`/rest/v1/students?id=eq.${ALG_ID}&select=program_type,progress_config`);
console.log('\n── AFTER (re-read from DB) ──');
console.log(`  students.program_type:       ${JSON.stringify(v.program_type)}   (unchanged, portal renders)`);
console.log(`  progress_config.programType: ${JSON.stringify(v.progress_config.programType)}   (added)`);
console.log(`  progress_config.subject:     ${JSON.stringify(v.progress_config.subject)}   (unchanged)`);
console.log(`  progress_config.startingGrade: ${v.progress_config.startingGrade}   (unchanged from prior soft-rewrite)`);
