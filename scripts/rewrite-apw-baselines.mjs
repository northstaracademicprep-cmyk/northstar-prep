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

// ─── 1. Fetch current config ───────────────────────────────────────────────
const [row] = await sb(`/rest/v1/students?id=eq.${APW_ID}&select=id,name,progress_config`);
if (!row) throw new Error('APW row not found by id');
const cfg = row.progress_config;
if (!cfg) throw new Error('APW row has no progress_config');

console.log('── BEFORE ──');
console.log(`  startingGrade: ${cfg.startingGrade}`);
console.log(`  startingGradeLabel: ${cfg.startingGradeLabel}`);
console.log(`  unit count: ${cfg.units.length} | weakness count: ${cfg.weaknesses.length}`);

// ─── 2. Mutate only the fields the user asked for ─────────────────────────

cfg.startingGrade = 74;
cfg.startingGradeLabel = 'Projected Without Prep: C';

// New unit scores: 68-78 range, ranking preserved (writing < MCQ < geography)
const newUnitScores = {
  'Period 1 MCQ (1200-1450)': 73,
  'Period 2 MCQ (1450-1750)': 71,
  'Period 3 MCQ (1750-1900)': 74,
  'Period 4 MCQ (1900-Present)': 75,
  'SAQ Foundational Skills': 69,
  'LEQ Thesis Construction': 68,
  'DBQ Document Analysis': 70,
  'World Geography & Chronology': 78,
};
cfg.units = cfg.units.map(u => {
  if (!(u.name in newUnitScores)) throw new Error(`Unmapped unit: ${u.name}`);
  return { ...u, score: newUnitScores[u.name] };
});

// New weekly progress: 74 → 92 across 6 checkpoints
cfg.weeklyProgress = [
  { grade: 74, label: 'Start' },
  { grade: 78, label: 'Week 2' },
  { grade: 82, label: 'Week 4' },
  { grade: 86, label: 'Week 6' },
  { grade: 89, label: 'Week 8' },
  { grade: 92, label: 'Final' },
];

// Rewritten weaknesses: same areas, scores matched to new units, framing shifted
// from "projected F / cold-start failure" to "average unprepared 9th grader",
// with all dramatic consequences (GPA, $6k AP retake, college apps, snowball) intact.
cfg.weaknesses = [
  {
    area: 'Zero AP-Format Exposure (Average Unprepared Baseline)',
    issue:
      "Monira has never seen an AP World MCQ, SAQ, LEQ, or DBQ — and neither has the average rising 9th grader walking into this course. On a cold Period 1-4 diagnostic, the typical unprepared student lands around 73% — a C, which is exactly the grade most 9th graders end the fall semester with when AP World is their first AP class. That's not a failure score; it's the gravity well the curriculum drops you into when you walk in without a system. By Week 3 of the actual class the teacher is moving at full AP pace, and a student starting at C+ has no slack to absorb the inevitable bad week — one missed quiz turns into a B-, then a B, and the A she's capable of becomes mathematically out of reach by midterms. This is the single highest-leverage gap on her report and the entire reason this summer program exists.",
    score: 73,
    impact: 'high',
  },
  {
    area: 'AP Writing Skills - SAQ, LEQ & DBQ (Projected 69%)',
    issue:
      "AP World's three written response formats — SAQ, LEQ, DBQ — together account for roughly 60% of the AP exam score and a similar fraction of every in-class unit test. The average unprepared 9th grader scores in the high 60s on this section because they've never been taught the A-B-C SAQ structure, the HAPP framework for LEQs, or the 7-point DBQ rubric — and there is no real-time way to learn them while simultaneously keeping up with content lectures. Without summer prep, projected DBQ score on the May 2027 exam lands at 2-3 out of 7, which alone caps the maximum possible AP score at a 3 and triggers the $6,000+ AP retake cycle in junior or senior year. Class essay grades drift into the 65-72% range across the semester, which is enough to drag a student earning Bs and B+ on MCQs down to a C average overall — the single most common path from 'capable A student' to 'GPA-damaged 9th grader' in advanced tracks.",
    score: 69,
    impact: 'high',
  },
  {
    area: 'World Geography & Chronological Framework (Projected 78%)',
    issue:
      "AP World assumes students walk in already knowing the location of ~40 civilizations, the basic geography of 10 world regions, and the rough chronology of the major world religions — none of which U.S. middle school teaches. The average unprepared 9th grader can fake their way to a 78% on this category because a handful of civilizations are familiar from world history electives — but that gap turns every Period 1-2 stimulus question into partial guesswork because the student can't reliably anchor a source to a place or time. Even otherwise strong students lose 15-20% of available MCQ points purely because they can't place the source. This is the most fixable weakness on the report and the fastest confidence win in Phase 1.",
    score: 78,
    impact: 'medium',
  },
  {
    area: '9th Grade Transition + AP Rigor Double-Whammy',
    issue:
      "AP World as a 9th-grade course is the single most common GPA-killer in advanced high school tracks — not because students fail it (most don't), but because they C it, which is almost worse on a transcript that's supposed to anchor selective college admissions four years later. The average unprepared 9th grader simultaneously faces (1) the jump from middle-school study habits to high-school pacing, (2) their first AP-level class, and (3) their first encounter with college-style writing rubrics — and almost no 9th grader has installed the study system to handle all three at once. Without a study calendar, flashcard system, and error log built before September, Monira is on track to coast into a 73% mid-semester grade — which on a permanent 9th-grade transcript means the difference between top-tier and mid-tier college admissions outcomes. This is precisely the failure mode the summer program is built to prevent.",
    score: 73,
    impact: 'high',
  },
];

// ─── 3. PATCH ──────────────────────────────────────────────────────────────
await sb(`/rest/v1/students?id=eq.${APW_ID}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ progress_config: cfg }),
});

// ─── 4. Re-query and print verification snapshot ───────────────────────────
const [verified] = await sb(`/rest/v1/students?id=eq.${APW_ID}&select=id,name,progress_config`);
const v = verified.progress_config;

console.log('\n── AFTER (re-read from DB) ──');
console.log(`  startingGrade:      ${v.startingGrade}`);
console.log(`  startingGradeLabel: ${v.startingGradeLabel}`);
console.log(`  targetGrade:        ${v.targetGrade}   (should be unchanged)`);
console.log(`  targetGradeNum:     ${v.targetGradeNum}   (should be unchanged)`);
console.log(`  phases count:       ${v.phases.length}   (should be 4, unchanged)`);
console.log(`  outcomes.targetDate:${v.outcomes.targetDate}   (should be unchanged)`);
console.log('\n  units (all scaled to 68-78, ranking preserved):');
for (const u of v.units) console.log(`    • ${u.name.padEnd(40)} ${u.score}`);
console.log('\n  weeklyProgress (74 → 92):');
for (const w of v.weeklyProgress) console.log(`    • ${w.label.padEnd(10)} ${w.grade}`);

console.log('\n  Sample weakness card (first one):');
console.log('  ' + JSON.stringify(v.weaknesses[0], null, 2).split('\n').join('\n  '));
