const SUPABASE_URL = 'https://hqqugqfdlcinktsblupu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn';

async function inspect(table) {
  // Probe for existence + columns by fetching one row
  const probe = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });

  // Get exact row count
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    method: 'HEAD',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });

  if (!probe.ok) {
    const body = await probe.text();
    return { table, exists: false, error: `HTTP ${probe.status}: ${body.slice(0, 200)}` };
  }

  const rows = await probe.json();
  const sample = rows[0];
  let columns = null;
  if (sample) {
    columns = Object.entries(sample).map(([k, v]) => ({
      name: k,
      jsType: v === null ? 'null (unknown)' : Array.isArray(v) ? 'array' : typeof v,
      sample: v === null ? null : (typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60)),
    }));
  }

  const contentRange = countRes.headers.get('content-range');
  const total = contentRange ? contentRange.split('/').pop() : 'unknown';

  return { table, exists: true, rowCount: total, columns };
}

const tables = ['practice_questions', 'practice_submissions', 'practice_attempts'];
for (const t of tables) {
  const info = await inspect(t);
  console.log(`\n══ ${info.table} ══`);
  if (!info.exists) {
    console.log(`  ✗ Does not exist or not accessible: ${info.error}`);
    continue;
  }
  console.log(`  ✓ Exists. Row count: ${info.rowCount}`);
  if (info.columns) {
    console.log(`  Columns (from a sample row):`);
    for (const c of info.columns) {
      console.log(`    • ${c.name.padEnd(24)} ${c.jsType.padEnd(8)} ${c.sample === null ? '(null in sample)' : 'sample: ' + c.sample}`);
    }
  } else {
    console.log(`  Columns: (table empty, cannot infer column shape from data — exists per HEAD probe)`);
  }
}

// Also check whether the new tables already exist (in case of partial prior runs)
console.log('\n══ Checking new target tables (should NOT exist yet) ══');
for (const t of ['question_bank', 'student_attempts']) {
  const probe = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*&limit=0`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  console.log(`  ${t}: ${probe.ok ? '⚠ ALREADY EXISTS' : `✓ not present (HTTP ${probe.status})`}`);
}
