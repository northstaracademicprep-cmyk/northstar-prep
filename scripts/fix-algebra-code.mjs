const SUPABASE_URL = 'https://hqqugqfdlcinktsblupu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn';

const NEW_CODE = 'SULTANA-ALGEBRA26';

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}: ${await res.text()}`);
  return res.json();
}

// 1. Locate the Algebra 2 row (filter on progress_config->>subject = 'Algebra 2'
//    so we don't accidentally hit the APW row even if names get edited later)
const rows = await sb(
  `/rest/v1/students?or=(name.ilike.*Morina*,name.ilike.*Monira*)&select=id,name,code,progress_config`
);

const algRow = rows.find(r => r.progress_config?.subject === 'Algebra 2');
if (!algRow) {
  console.error('Could not find a Morina/Monira row whose progress_config.subject is "Algebra 2".');
  console.error('Candidates:', rows.map(r => ({ name: r.name, subject: r.progress_config?.subject })));
  process.exit(1);
}

console.log('── BEFORE ──');
console.log(`  id:   ${algRow.id}`);
console.log(`  name: ${algRow.name}`);
console.log(`  code: ${JSON.stringify(algRow.code)}   (chars: ${[...(algRow.code || '')].length})`);

// 2. PATCH the code
const patched = await sb(`/rest/v1/students?id=eq.${algRow.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ code: NEW_CODE }),
});
console.log(`\nPATCH returned ${patched.length} row(s) updated.`);

// 3. Re-query to verify
const [verified] = await sb(
  `/rest/v1/students?id=eq.${algRow.id}&select=id,name,code`
);

console.log('\n── AFTER (re-read from DB) ──');
console.log(`  id:   ${verified.id}`);
console.log(`  name: ${verified.name}`);
console.log(`  code: ${JSON.stringify(verified.code)}   (chars: ${[...(verified.code || '')].length})`);

console.log('\n── LOGIN CHECK ──');
console.log(`  Simulating portal login with user input "sultana-algebra26":`);
const simulatedInput = 'sultana-algebra26'.trim().toUpperCase();
console.log(`  After .trim().toUpperCase() => "${simulatedInput}"`);
console.log(`  Matches DB code? ${simulatedInput === verified.code ? '✅ YES' : '❌ NO'}`);
