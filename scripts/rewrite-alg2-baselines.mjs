const SUPABASE_URL = 'https://hqqugqfdlcinktsblupu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn';
const ALG_ID = '5377ae70-795c-48be-b5f0-282298f72e87';
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

// ─── 1. Pull APW as the canonical softening reference ─────────────────────
const [apwRow] = await sb(`/rest/v1/students?id=eq.${APW_ID}&select=progress_config`);
const apw = apwRow.progress_config;
console.log('── APW REFERENCE PATTERN ──');
console.log(`  subject:            ${apw.subject}`);
console.log(`  startingGrade:      ${apw.startingGrade}`);
console.log(`  startingGradeLabel: ${apw.startingGradeLabel}`);
console.log(`  targetGradeNum:     ${apw.targetGradeNum}`);
console.log(`  unit score range:   ${Math.min(...apw.units.map(u=>u.score))}-${Math.max(...apw.units.map(u=>u.score))}`);
console.log(`  weeklyProgress:     ${apw.weeklyProgress.map(w=>w.grade).join(' → ')}`);

// ─── 2. Pull current ALG2 and print BEFORE snapshot ───────────────────────
const [algRow] = await sb(`/rest/v1/students?id=eq.${ALG_ID}&select=id,name,progress_config`);
const oldAlg = algRow.progress_config;
console.log(`\n── ALG2 BEFORE (${algRow.name}) ──`);
console.log(`  startingGrade:      ${oldAlg.startingGrade}`);
console.log(`  startingGradeLabel: ${oldAlg.startingGradeLabel}`);
console.log(`  targetGrade:        ${oldAlg.targetGrade}`);
console.log(`  targetGradeNum:     ${oldAlg.targetGradeNum}`);
console.log(`  targetDate:         ${oldAlg.outcomes.targetDate}`);
console.log(`  Phase 1 details (first sentence):`);
console.log(`    "${oldAlg.phases[0].details.split('. ')[0]}."`);
console.log(`  units:`);
for (const u of oldAlg.units) console.log(`    • ${u.name.padEnd(40)} ${u.score}`);

// ─── 3. Build new ALG2 config in the APW softening voice ──────────────────
const newAlg = {
  subject: 'Algebra 2',
  targetGrade: 'A in Class',
  targetGradeNum: 92,
  startingGrade: 74,
  startingGradeLabel: 'Projected Without Prep: C',
  masteryThreshold: 90,
  programWeeks: 10,
  totalHours: 30,
  currentPhase: 1,
  units: [
    { name: 'Algebra 1 Retention (Pre-Audit)', score: 68 },
    { name: 'Polynomial Operations', score: 71 },
    { name: 'Factoring Techniques', score: 70 },
    { name: 'Rational Expressions', score: 72 },
    { name: 'Exponential & Log Functions', score: 73 },
    { name: 'Function Notation & Transformations', score: 74 },
    { name: 'Trigonometry Foundations', score: 76 },
    { name: 'Sequences & Series', score: 78 },
  ],
  phases: [
    {
      num: 1,
      name: 'Algebra 1 Retention Audit & Foundation Lock-In',
      weeks: 'Weeks 1-2',
      status: 'upcoming',
      topics: [
        'Cold Diagnostic Across Algebra 1 Topics',
        'Exponent & Radical Rules Drill',
        'Linear Equations & Inequalities Refresh',
        'Coordinate Geometry & Slope Mastery',
        'Personal Math Error Log Setup',
      ],
      details:
        "Phase 1 of the Northstar Summer Excel program opens with a 40-question cold diagnostic spanning every Algebra 1 skill that Algebra 2 silently assumes — exponent rules, radicals, linear equations, slope, systems of equations, and basic factoring. The average unprepared 9th grader has decayed 30-40% on these foundations over the 12-week summer gap, which is exactly why the typical first Algebra 2 unit test lands in the high 60s to mid 70s — a C that quietly caps the semester grade at a B+ and damages the first-ever GPA event college admissions officers see four years later. Algebra 2 teachers do not slow down to re-teach prerequisites; Chapter 1 uses Algebra 1 fluency as the immediate launchpad into polynomial work. Phase 1 closes that retention gap by working through every missed problem from the diagnostic and installing a personal math error log she keeps for the rest of the year — a system that compounds across Algebra 2, Pre-Calc, and Calc.",
      milestone: 'Score 90%+ on a 25-question Algebra 1 cumulative re-test under timed conditions.',
      description: 'Rebuild the Algebra 1 fluency that Algebra 2 assumes on Day 1 and install a permanent math error log.',
    },
    {
      num: 2,
      name: 'Polynomial & Factoring Mastery',
      weeks: 'Weeks 3-5',
      status: 'upcoming',
      topics: [
        'Polynomial Operations (Add, Subtract, Multiply, Divide)',
        'Factoring: GCF, Difference of Squares, Trinomials',
        'Factoring by Grouping & Sum/Difference of Cubes',
        'Synthetic & Long Division of Polynomials',
        'Rational Root Theorem & Polynomial Graphing',
      ],
      details:
        "Phase 2 is the single most important phase in the entire Summer Excel program. Roughly 35-40% of every Algebra 2 final exam reduces to polynomial manipulation and factoring, and every later topic — rational expressions, exponentials, even trig identities — depends on the student being able to factor a polynomial in under 30 seconds without conscious thought. The same fluency carries forward: Pre-Calc and Calc both assume factoring as a reflex, and a student who hits 9th grade without it will spend the next three math classes paying compound interest on the gap. Monira will drill 100+ factoring problems across the four major techniques (GCF, difference of squares, trinomial factoring, factoring by grouping) plus the two cubic techniques (sum/difference of cubes, rational root theorem). She'll learn synthetic division as a 10-second alternative to long division. By end of Phase 2 she will have a factoring fluency that puts her ahead of the average unprepared 9th grader by a full letter grade — the single biggest predictor of an A in Algebra 2.",
      milestone: 'Factor 20 mixed polynomial problems in under 15 minutes with 95%+ accuracy.',
      description: 'Install the polynomial + factoring fluency that every later Algebra 2 chapter depends on.',
    },
    {
      num: 3,
      name: 'Functions, Exponentials, Logs & Graphing Transformations',
      weeks: 'Weeks 6-8',
      status: 'upcoming',
      topics: [
        'Function Notation, Domain & Range',
        'Function Composition & Inverses',
        'Exponential Growth & Decay Modeling',
        'Logarithm Rules & Equation Solving',
        'Parent Function Library & Transformations (Shift, Stretch, Reflect)',
      ],
      details:
        "Phase 3 attacks the conceptual leap that lands most Algebra 2 students in C territory: moving from 'solve for x' to 'reason about functions as objects.' Monira will build a permanent parent function library (linear, quadratic, cubic, square root, absolute value, rational, exponential, logarithmic) and learn to apply the four transformations (vertical shift, horizontal shift, stretch/compression, reflection) to any of them on sight. She'll learn to read function notation fluently — f(x), f(g(x)), f⁻¹(x) — and to model real-world growth and decay scenarios using exponential and log functions. The tutor will drill 50+ graphing problems where she sketches a transformed function from its equation alone, no calculator. This phase converts Chapters 5-7 — the standard Algebra 2 sequence where the average unprepared 9th grader earns Cs and accepts a midterm collapse as inevitable — into a guaranteed-A section.",
      milestone: 'Sketch any transformed parent function on sight in under 30 seconds and solve log/exp equations with 95%+ accuracy.',
      description: 'Convert function notation, exponentials, logs, and graphing transformations from total mysteries into guaranteed-A territory.',
    },
    {
      num: 4,
      name: 'Trigonometry Intro, Sequences & First-Test Readiness',
      weeks: 'Weeks 9-10',
      status: 'upcoming',
      topics: [
        'Unit Circle Foundations (sin, cos, tan)',
        'Right Triangle Trig & SOH-CAH-TOA Review',
        'Sequences: Arithmetic & Geometric Patterns',
        'Series & Summation Notation',
        'Full Mock Chapter 1-3 Test Under Timed Conditions',
      ],
      details:
        "Phase 4 previews the two topics most Algebra 2 students see for the first time in spring semester — basic trigonometry and sequences/series — and ends with a full mock Chapter 1-3 test under timed conditions so Monira walks into the actual first unit test in late September already having taken it once. Trig intro covers the unit circle (the six key angles in Q1, sin/cos/tan values she should have memorized), SOH-CAH-TOA, and the basic identities. Sequences covers arithmetic vs. geometric patterns, explicit vs. recursive formulas, and summation notation. The phase ends with the tutor building her personal Algebra 2 study calendar for the fall, complete with weekly review checkpoints aligned to standard Algebra 2 unit schedules. By the last session, she has the confidence, the fluency, and the system to walk in on Day 1 and score 92%+ on every test all year — the difference between an A on her permanent 9th-grade transcript and the C the average unprepared 9th grader carries forward into Pre-Calc, Calc, and ultimately into selective college admissions decisions.",
      milestone: 'Score 90%+ on a full mock Chapter 1-3 Algebra 2 test under timed conditions and complete a fall-semester study calendar.',
      description: 'Preview spring-semester topics and run a full mock Chapter 1-3 test so Day 1 of class feels like a review, not a baptism by fire.',
    },
  ],
  outcomes: {
    targetDate: 'First Day of 9th Grade Algebra 2 — September 2026',
    sessionsTotal: 20,
    practiceProblems: 300,
    sessionsCompleted: 0,
  },
  weaknesses: [
    {
      area: 'Algebra 1 Retention Decay (Average Unprepared Baseline)',
      issue:
        "After a 12-week summer gap, the average rising 9th grader retains only 60-70% of their Algebra 1 fluency — exponent rules, radicals, slope, linear equations, and basic factoring all degrade fast without practice. Algebra 2 teachers explicitly assume Day 1 fluency in every one of these skills and use them as the launchpad for Chapter 1 polynomial work. Without the Phase 1 retention audit, Monira walks in cold on prerequisites and lands at the C-range where the average unprepared 9th grader sits — the first unit test projects to a 68-74%, which is enough to anchor her gradebook in the B-/B zone and quietly lock in a fall-semester GPA hit that compounds across Algebra 2, Pre-Calc, and Calc.",
      score: 68,
      impact: 'high',
    },
    {
      area: 'Polynomial & Factoring Foundations (Projected 70%)',
      issue:
        "Polynomial manipulation and factoring are the single most important skill cluster in Algebra 2 — roughly 35-40% of every final exam reduces to factoring, and every later chapter (rational expressions, exponentials, even trig identities) silently assumes the student can factor in seconds. The average unprepared 9th grader scores in the low 70s here because they're learning the four major techniques (GCF, difference of squares, trinomial, grouping) in real time alongside new content — the standard recipe for a 70-78% gradebook through the entire fall semester. That's a B-, not a failure, but it's the single highest-leverage gap between a top-tier and mid-tier college application four years from now, and the foundation crack that compounds straight through Pre-Calc and Calc.",
      score: 70,
      impact: 'high',
    },
    {
      area: 'Function Notation & Graphing Transformations (Projected 74%)',
      issue:
        "Algebra 2 is the course where students are first asked to treat functions as objects rather than 'solve for x' procedures — and the conceptual leap is what knocks most unprepared 9th graders from an A to a C around the Chapter 5 midterm. Without Phase 3 prep, Monira sees f(g(x)), f⁻¹(x), and the eight parent functions for the first time in October at full class pace, with no time to build intuition. Projected outcome: a 70-78% on Chapters 5-7 unit tests and a permanent grade ceiling at B for the semester — exactly the GPA event that follows a student onto every college application four years later.",
      score: 74,
      impact: 'high',
    },
    {
      area: 'Honors-Level Pacing & Study System (Projected 72%)',
      issue:
        "Algebra 2 is, for most students, the first honors-level math class — and the gap between middle-school study habits (do the homework, review the night before) and high-school math fluency (daily problem sets, error logs, weekly cumulative review) is enormous. Without a math-specific study system installed before September, Monira faces the standard average-unprepared-9th-grader pattern: keeps up for 3 weeks, falls behind during the Chapter 2 midterm crunch, recovers partially but never catches the top of the class, and the C+/B-range grade on her 9th-grade transcript becomes the first permanent GPA event college admissions officers see four years from now.",
      score: 72,
      impact: 'high',
    },
  ],
  weeklyProgress: [
    { grade: 74, label: 'Start' },
    { grade: 78, label: 'Week 2' },
    { grade: 82, label: 'Week 4' },
    { grade: 86, label: 'Week 6' },
    { grade: 89, label: 'Week 8' },
    { grade: 92, label: 'Final' },
  ],
};

// Defense-in-depth: confirm no stray AP references slipped into any narrative
const allNarrative = JSON.stringify(newAlg);
const apMatches = allNarrative.match(/\bAP\b/g);
if (apMatches) {
  throw new Error(`Found ${apMatches.length} stray "AP" reference(s) in new config — aborting.`);
}

// ─── 4. PATCH ──────────────────────────────────────────────────────────────
await sb(`/rest/v1/students?id=eq.${ALG_ID}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ progress_config: newAlg }),
});

// ─── 5. Verify ─────────────────────────────────────────────────────────────
const [verified] = await sb(`/rest/v1/students?id=eq.${ALG_ID}&select=name,progress_config`);
const v = verified.progress_config;

console.log(`\n── ALG2 AFTER (re-read from DB) ──`);
console.log(`  startingGrade:      ${v.startingGrade}`);
console.log(`  startingGradeLabel: ${v.startingGradeLabel}`);
console.log(`  targetGrade:        ${v.targetGrade}`);
console.log(`  targetGradeNum:     ${v.targetGradeNum}`);
console.log(`  targetDate:         ${v.outcomes.targetDate}`);
console.log(`  weeklyProgress:     ${v.weeklyProgress.map(w=>w.grade).join(' → ')}`);
console.log(`  phases count:       ${v.phases.length} (unchanged structure: 4)`);
console.log(`\n  Phase 1 details (full, re-read):`);
console.log(`    ${v.phases[0].details}`);
console.log(`\n  units:`);
for (const u of v.units) console.log(`    • ${u.name.padEnd(40)} ${u.score}`);

console.log('\n  Spot-checks:');
console.log(`    No "AP" references in config?         ${!/\bAP\b/.test(JSON.stringify(v))}`);
console.log(`    No "high F" / "F-range" language?     ${!/(high F|F-range|\bfailure\b)/i.test(JSON.stringify(v))}`);
console.log(`    Units in 68-78 range?                 ${v.units.every(u => u.score >= 68 && u.score <= 78)}`);
console.log(`    Algebra 1 Retention lowest?           ${v.units.find(u=>u.name.startsWith('Algebra 1 Retention')).score === Math.min(...v.units.map(u=>u.score))}`);
