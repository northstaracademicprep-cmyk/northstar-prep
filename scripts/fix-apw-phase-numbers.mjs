const SUPABASE_URL = 'https://hqqugqfdlcinktsblupu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn';
const APW_ID = '618a4873-ac70-4f21-aaf9-efc8b5501079';

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

// Fetch current
const [row] = await sb(`/rest/v1/students?id=eq.${APW_ID}&select=id,name,progress_config`);
const cfg = row.progress_config;

// ─── Phase 1: replace the one sentence with the 48% / "high F" reference ──
const p1Old = 'Without this prep, her projected baseline is a 48% — a high F that puts her on track to drown by midterms and tank her 9th grade GPA before college applications even open.';
const p1New = "Without this prep, her projected baseline lands around 73% — a C, exactly where the average unprepared 9th grader ends up, which is enough to lock in a fall-semester GPA hit before college applications even open four years from now.";

if (!cfg.phases[0].details.includes(p1Old)) {
  throw new Error('Phase 1 expected sentence not found — aborting to avoid corrupt edit.');
}
cfg.phases[0].details = cfg.phases[0].details.replace(p1Old, p1New);

// ─── Phase 2: replace the one sentence with the "46% on Period 2" reference ──
const p2Old = 'By end of Phase 2, Monira moves from a projected 46% on Period 2 MCQs to 70%+ on fresh material.';
const p2New = 'By end of Phase 2, Monira moves from a projected 71% on Period 2 MCQs (the average unprepared 9th grader\'s score) to 88%+ on fresh material under timed conditions.';

if (!cfg.phases[1].details.includes(p2Old)) {
  throw new Error('Phase 2 expected sentence not found — aborting to avoid corrupt edit.');
}
cfg.phases[1].details = cfg.phases[1].details.replace(p2Old, p2New);

// Sanity: confirm no other phase still has "48%" / "46%" / " F " baseline language
for (let i = 0; i < cfg.phases.length; i++) {
  const d = cfg.phases[i].details;
  if (/\b48%\b/.test(d) || /\b46%\b/.test(d) || /high F\b/.test(d)) {
    console.warn(`⚠ Phase ${i + 1} still contains stale baseline language — please review.`);
  }
}

// PATCH
await sb(`/rest/v1/students?id=eq.${APW_ID}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ progress_config: cfg }),
});

// Verify
const [verified] = await sb(`/rest/v1/students?id=eq.${APW_ID}&select=progress_config`);
const v = verified.progress_config;

console.log('── VERIFICATION ──\n');
console.log('Phase 1 (full details, re-read from DB):');
console.log(v.phases[0].details);
console.log('\nPhase 2 (full details, re-read from DB):');
console.log(v.phases[1].details);
console.log('\nSpot-checks:');
console.log('  Phase 1 contains "73% — a C"?            ', v.phases[0].details.includes('73% — a C'));
console.log('  Phase 1 still contains "48%"?            ', /\b48%\b/.test(v.phases[0].details));
console.log('  Phase 2 contains "projected 71%"?        ', v.phases[1].details.includes('projected 71%'));
console.log('  Phase 2 still contains "46%"?            ', /\b46%\b/.test(v.phases[1].details));
console.log('  startingGrade unchanged at 74?           ', v.startingGrade === 74);
console.log('  units[0] (Period 1) score unchanged?     ', v.units.find(u => u.name === 'Period 1 MCQ (1200-1450)').score === 73);
