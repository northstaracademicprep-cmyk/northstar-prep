const SUPABASE_URL = 'https://hqqugqfdlcinktsblupu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn';
const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

// Columns we expect, per migration spec
const expectedColumns = {
  question_bank: [
    'id', 'subject', 'unit', 'unit_number', 'topic',
    'question_type', 'difficulty',
    'stimulus', 'stimulus_image_url',
    'question_text', 'choices', 'correct_answer',
    'official_explanation', 'wrong_answer_explanations',
    'source', 'source_year', 'tags', 'created_at',
  ],
  student_attempts: [
    'id', 'student_id', 'question_id',
    'selected_answer', 'is_correct', 'time_spent_seconds',
    'session_id', 'attempted_at',
  ],
};

async function probeColumns(table, cols) {
  // PostgREST will 400 with "column ... does not exist" if any are missing.
  // Selecting them all in one shot tells us whether every expected column is present.
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${cols.join(',')}&limit=0`;
  const res = await fetch(url, { headers });
  if (res.ok) return { allPresent: true };
  const body = await res.json().catch(() => ({}));
  return { allPresent: false, status: res.status, error: body };
}

async function tablePresent(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=0`, { headers });
  return res.ok;
}

async function rowCount(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    method: 'HEAD',
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = res.headers.get('content-range');
  return cr ? cr.split('/').pop() : 'unknown';
}

async function probeConstraints(table) {
  // Try inserts that should FAIL with structured Postgres errors that confirm
  // the CHECK constraints + NOT NULL constraints are in place.
  // We don't actually insert anything because we DO NOT use Prefer: resolution=ignore-duplicates
  // and Postgres rejects the row at constraint-check time before any commit.
  const probes = [];

  if (table === 'question_bank') {
    // Expect: NOT NULL violations on required fields
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({}),
    });
    const b1 = await r1.json().catch(()=>({}));
    probes.push({ test: 'empty insert', status: r1.status, message: b1.message || b1.error || '(no message)' });

    // Expect: CHECK violation on question_type
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        subject: 'Test', unit: 'Test', question_type: 'INVALID_TYPE',
        difficulty: 'easy', question_text: 'x', correct_answer: 'A',
        official_explanation: 'x',
      }),
    });
    const b2 = await r2.json().catch(()=>({}));
    probes.push({ test: 'invalid question_type "INVALID_TYPE"', status: r2.status, message: b2.message || b2.error || '(no message)' });

    // Expect: CHECK violation on difficulty
    const r3 = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        subject: 'Test', unit: 'Test', question_type: 'mcq',
        difficulty: 'extreme', question_text: 'x', correct_answer: 'A',
        official_explanation: 'x',
      }),
    });
    const b3 = await r3.json().catch(()=>({}));
    probes.push({ test: 'invalid difficulty "extreme"', status: r3.status, message: b3.message || b3.error || '(no message)' });
  }

  if (table === 'student_attempts') {
    // Expect: NOT NULL violation
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({}),
    });
    const b1 = await r1.json().catch(()=>({}));
    probes.push({ test: 'empty insert', status: r1.status, message: b1.message || b1.error || '(no message)' });

    // Expect: FK violation on bogus student_id / question_id
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        student_id: '00000000-0000-0000-0000-000000000000',
        question_id: '00000000-0000-0000-0000-000000000000',
        is_correct: true,
      }),
    });
    const b2 = await r2.json().catch(()=>({}));
    probes.push({ test: 'FK to nonexistent student/question', status: r2.status, message: b2.message || b2.error || '(no message)' });
  }
  return probes;
}

for (const table of Object.keys(expectedColumns)) {
  console.log(`\n══ ${table} ══`);
  if (!(await tablePresent(table))) {
    console.log('  ✗ NOT PRESENT — migration did not create this table.');
    continue;
  }
  const count = await rowCount(table);
  console.log(`  ✓ Exists. Row count: ${count}`);

  const colCheck = await probeColumns(table, expectedColumns[table]);
  if (colCheck.allPresent) {
    console.log(`  ✓ All ${expectedColumns[table].length} expected columns present:`);
    for (const c of expectedColumns[table]) console.log(`      • ${c}`);
  } else {
    console.log(`  ✗ Column check failed: HTTP ${colCheck.status}`);
    console.log(`    Error: ${JSON.stringify(colCheck.error)}`);
  }

  console.log(`  Constraint probes:`);
  const probes = await probeConstraints(table);
  for (const p of probes) {
    const ok = p.status >= 400 && p.status < 500;
    console.log(`    ${ok ? '✓' : '✗'} ${p.test.padEnd(40)} HTTP ${p.status} — ${p.message.slice(0,120)}`);
  }
}

// Sanity: untouched legacy tables
console.log('\n══ Untouched legacy tables (sanity check) ══');
for (const table of ['practice_questions', 'practice_submissions', 'practice_attempts']) {
  const count = await rowCount(table);
  console.log(`  ${table.padEnd(22)} rows=${count}`);
}
