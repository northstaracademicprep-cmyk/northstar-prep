const SUPABASE_URL = 'https://hqqugqfdlcinktsblupu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn';

const url = `${SUPABASE_URL}/rest/v1/students?name=ilike.*Nav*&select=id,name,code,program_type,subjects,progress_config`;

const res = await fetch(url, {
  headers: {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  },
});

if (!res.ok) {
  console.error('HTTP', res.status, await res.text());
  process.exit(1);
}

const rows = await res.json();
console.log(`Matched ${rows.length} student row(s):\n`);
for (const r of rows) {
  console.log(`── ${r.name} (code=${r.code}, program=${r.program_type}) ──`);
  console.log('progress_config:');
  console.log(JSON.stringify(r.progress_config, null, 2));
  console.log();
}
