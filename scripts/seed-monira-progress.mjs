const SUPABASE_URL = 'https://hqqugqfdlcinktsblupu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eHbuUITIGOZ5ckLI03fXjQ_9h_915Hn';

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${path}: ${await res.text()}`);
  }
  return res.json();
}

// ─── 1. Locate both profiles ───────────────────────────────────────────────
const rows = await sb(
  `/rest/v1/students?or=(name.ilike.*Morina*,name.ilike.*Monira*)&select=id,name,code,program_type,subjects,progress_config`
);

console.log(`\n── PRE-FLIGHT: matched ${rows.length} student row(s) ──`);
for (const r of rows) {
  const existing = r.progress_config ? `EXISTING (will overwrite)` : 'null';
  console.log(`  • ${r.name} | code=${r.code} | program=${r.program_type} | progress_config: ${existing}`);
}

const apwRow = rows.find(r => /APW/i.test(r.name) || /APW/i.test(r.code || ''));
const algRow = rows.find(r => /ALG/i.test(r.name) || /ALG/i.test(r.code || ''));
if (!apwRow) throw new Error('Could not find APW profile (expected "Morina Sultana APW")');
if (!algRow) throw new Error('Could not find ALG profile (expected "Morina Sultana ALG")');

// ─── 2. AP World History config ────────────────────────────────────────────
const apwConfig = {
  subject: 'AP World History: Modern',
  targetGrade: '5 on AP Exam + A in Class',
  targetGradeNum: 92,
  startingGrade: 48,
  startingGradeLabel: 'F',
  masteryThreshold: 90,
  programWeeks: 10,
  totalHours: 30,
  currentPhase: 1,
  units: [
    { name: 'Period 1 MCQ (1200-1450)', score: 48 },
    { name: 'Period 2 MCQ (1450-1750)', score: 46 },
    { name: 'Period 3 MCQ (1750-1900)', score: 49 },
    { name: 'Period 4 MCQ (1900-Present)', score: 51 },
    { name: 'SAQ Foundational Skills', score: 45 },
    { name: 'LEQ Thesis Construction', score: 45 },
    { name: 'DBQ Document Analysis', score: 47 },
    { name: 'World Geography & Chronology', score: 54 },
  ],
  phases: [
    {
      num: 1,
      name: 'Diagnostic Baseline & AP Exam Decoding',
      weeks: 'Weeks 1-2',
      status: 'upcoming',
      topics: [
        'Cold Diagnostic MCQ Set',
        'AP World Exam Format Walkthrough',
        'World Map & Region Literacy',
        'Major World Religions Overview',
        'Personal Study System Build',
      ],
      details:
        "Phase 1 opens with a brutally honest cold-baseline diagnostic — a full 25-question AP World MCQ set with no prep, no hints, and a full debrief afterward so Monira sees exactly what walking into class blind on Day 1 would look like. Without this prep, her projected baseline is a 48% — a high F that puts her on track to drown by midterms and tank her 9th grade GPA before college applications even open. The Northstar tutor will then walk her through the entire AP World: Modern exam structure (55 MCQs in 55 min, 3 SAQs in 40 min, 1 DBQ in 60 min, 1 LEQ in 40 min), the four time periods (1200-1450, 1450-1750, 1750-1900, 1900-Present), and the six historical thinking skills the College Board actually tests. She'll spend the second session installing two foundations most students don't have until November: a working world map (10 regions, ~40 key civilizations) and a working religious literacy chart (origin, geography, and core beliefs of Hinduism, Buddhism, Christianity, Islam, Judaism, Confucianism, and Daoism). A personal study system — calendar, flashcard app, error log — gets installed by the end of week 2.",
      milestone: 'Cold baseline scored, AP exam structure mastered, world map and religious literacy locked in.',
      description: 'Establish baseline, decode the AP exam, and install the geographic + religious literacy that every later unit depends on.',
    },
    {
      num: 2,
      name: 'Periods 1-2 Mastery (1200-1750) + Stimulus Deconstruction',
      weeks: 'Weeks 3-5',
      status: 'upcoming',
      topics: [
        'Period 1: Networks of Exchange (1200-1450)',
        'Period 2: Transoceanic Connections (1450-1750)',
        'Silk Road, Indian Ocean & Trans-Saharan Trade',
        'Columbian Exchange & Maritime Empires',
        'Stimulus Sourcing & POV Analysis Framework',
      ],
      details:
        "Phase 2 attacks the first two AP World time periods — which together make up roughly 35% of every released AP exam — using the Northstar Stimulus Deconstruction Framework. Every MCQ in AP World is anchored to a primary source stimulus (a quote, image, map, or chart), and most 9th graders get destroyed because they've never been taught to source a document under time pressure. Monira will drill 60 timed College Board-released MCQs across Periods 1 and 2 with same-day error analysis on every wrong answer. The content arc covers Afro-Eurasian trade networks (Silk Road, Indian Ocean, Trans-Saharan), state-building in Song China, Dar al-Islam, the Mongol Empire, the Renaissance and Reformation, the Columbian Exchange, and the four maritime empires (Portugal, Spain, the Dutch, the British). The tutor introduces the four-move stimulus drill: (1) identify the source, (2) identify the POV, (3) locate the period, (4) eliminate two answer choices using context. By end of Phase 2, Monira moves from a projected 46% on Period 2 MCQs to 70%+ on fresh material.",
      milestone: 'Score 70%+ on a fresh 25-question Period 1-2 MCQ set under timed conditions.',
      description: 'Rebuild Periods 1-2 (1200-1750) from scratch and install the stimulus-analysis skill that drives every MCQ point.',
    },
    {
      num: 3,
      name: 'Periods 3-4 + AP Writing Skills (SAQ, LEQ, DBQ)',
      weeks: 'Weeks 6-8',
      status: 'upcoming',
      topics: [
        'Period 3: Revolutions & Industrialization (1750-1900)',
        'Period 4: Global Conflicts & Decolonization (1900-Present)',
        'SAQ A-B-C Task Verb Framework',
        'LEQ Thesis & HAPP Method',
        'DBQ 7-Point Rubric Walkthrough',
      ],
      details:
        "Phase 3 covers the densest half of the AP World curriculum (Periods 3 and 4 — roughly 40% of the exam) while simultaneously building out the three written response formats. Content arc: the Atlantic Revolutions (American, French, Haitian, Latin American), the Industrial Revolution, 19th century imperialism, World Wars I and II, the Cold War, decolonization, and globalization. Writing arc: Monira learns Northstar's A-B-C Task Verb Framework for SAQs (every response is 3-4 sentences per part, leads with a direct claim, and cites one specific piece of evidence). For the LEQ she learns the HAPP framework (Historical Argument, evidence, Periodization, Perspective) and writes 4 timed LEQs over the phase. For the DBQ she learns to (1) contextualize, (2) source the documents, (3) integrate outside evidence, and (4) demonstrate complex understanding — the single point that separates a 4 from a 5. Without this phase, the DBQ alone — worth 25% of the entire exam — projects to a 1/7 on test day.",
      milestone: 'Earn 3/3 on two consecutive timed SAQs and score 5+/7 on a full timed DBQ.',
      description: 'Lock in Periods 3-4 and convert SAQ/LEQ/DBQ from total unknowns into guaranteed-point sections.',
    },
    {
      num: 4,
      name: 'Full Exam Simulation & First-Day-of-9th-Grade Lock-In',
      weeks: 'Weeks 9-10',
      status: 'upcoming',
      topics: [
        'Full Practice AP Exam Simulation',
        'Pacing & Skip Strategy',
        'Period-Specific Final Review',
        'Unit 1 Preview for Fall Semester',
        'Study Habits, Calendar & Confidence Lock-In',
      ],
      details:
        "Phase 4 is pure simulation and confidence-installation. Monira takes a full-length AP World practice exam under exact 2027 AP conditions — 55 MCQs in 55 min, 3 SAQs in 40 min, 1 DBQ in 60 min, 1 LEQ in 40 min — graded section-by-section against the official AP curve. The tutor then runs targeted remediation on any periods or question types where she lost points. Crucially, the last two sessions also preview the exact Unit 1 content her teacher will cover in the first 3 weeks of 9th grade so she walks in already familiar with the material — flipping the dynamic from 'lost by week 3' to 'ahead of every classmate.' She leaves the program with a fully built fall-semester study calendar, a personal AP exam-day script (pacing checkpoints, when to skip, the 5-minute LEQ outline), and a confirmed projected exam score in the 4-5 range. Without this phase, the alternative is the $6,000+ AP retake cost in junior or senior year — assuming she even retakes it.",
      milestone: 'Score a projected 4-5 on a full-length AP World practice exam and complete a guided Unit 1 preview.',
      description: 'Two full-length proctored simulations and a Unit 1 preview that converts summer prep into Day 1 dominance.',
    },
  ],
  outcomes: {
    targetDate: 'May 14, 2027 AP Exam',
    sessionsTotal: 20,
    practiceProblems: 250,
    sessionsCompleted: 0,
  },
  weaknesses: [
    {
      area: 'Zero AP-Format Exposure (Cold-Start Risk)',
      issue:
        'Monira has never seen an AP World MCQ, SAQ, LEQ, or DBQ. Without prep, she walks into 9th grade on Day 1 with zero familiarity with stimulus-based questions, the six historical thinking skills the College Board tests, or the four-period framework the entire course is organized around. Projected baseline on a cold Period 1-4 MCQ set: 48% — a high F. By Week 3 of the actual class, her teacher will be moving at full AP pace and she will be 4-6 weeks behind on foundational skills with no realistic path to catch up before the first unit test. This is the single highest-leverage gap on her report and the entire reason this summer program exists.',
      score: 48,
      impact: 'high',
    },
    {
      area: 'AP Writing Skills - SAQ, LEQ & DBQ (Projected 45%)',
      issue:
        "AP World's three written response formats together account for 60% of the AP exam score and a similar fraction of every in-class unit test. A student walking in cold has never learned the A-B-C SAQ structure, the HAPP framework for LEQs, or the 7-point DBQ rubric — and there is no real-time way to learn them while keeping up with content lectures. Without summer prep, projected DBQ score on the May 2027 exam is 1-2 out of 7, which alone caps the maximum possible AP score at a 3. Class essay grades would land in the 50-60% range all year, dragging the semester grade from a target A down to a C or worse and locking in a GPA hit that follows her into college applications.",
      score: 45,
      impact: 'high',
    },
    {
      area: 'World Geography & Chronological Framework (Projected 54%)',
      issue:
        "AP World assumes students walk in already knowing the location of ~40 civilizations, the basic geography of 10 world regions, and the rough chronology of the major world religions — none of which Monira has had a chance to learn in middle school. Without this foundation, every Period 1-2 stimulus question becomes a guess because she can't anchor the source to a place or time. Even a strong student loses 15-20% of available MCQ points purely because they can't place the source. This is the most fixable weakness on the report and the fastest confidence win in Phase 1.",
      score: 54,
      impact: 'medium',
    },
    {
      area: '9th Grade Transition + AP Rigor Double-Whammy',
      issue:
        "AP World as a 9th-grade course is the single most common GPA-killer in advanced high school tracks. Students simultaneously face (1) the jump from middle-school study habits to high-school pacing, (2) their first AP-level class, and (3) their first encounter with college-style writing rubrics — and almost no 9th grader has installed the study system to handle all three at once. Without a study calendar, flashcard system, and error log built before September, Monira is on track to be 'drowning by midterms' in October, which is exactly the failure mode this summer program is designed to prevent.",
      score: 50,
      impact: 'high',
    },
  ],
  weeklyProgress: [
    { grade: 48, label: 'Start' },
    { grade: 56, label: 'Week 2' },
    { grade: 66, label: 'Week 4' },
    { grade: 75, label: 'Week 6' },
    { grade: 84, label: 'Week 8' },
    { grade: 91, label: 'Final' },
  ],
};

// ─── 3. Algebra 2 config ───────────────────────────────────────────────────
const algConfig = {
  subject: 'Algebra 2',
  targetGrade: 'A in Algebra 2 (95%+)',
  targetGradeNum: 95,
  startingGrade: 50,
  startingGradeLabel: 'F',
  masteryThreshold: 90,
  programWeeks: 10,
  totalHours: 30,
  currentPhase: 1,
  units: [
    { name: 'Algebra 1 Retention (Pre-Audit)', score: 53 },
    { name: 'Polynomial Operations', score: 49 },
    { name: 'Factoring Techniques', score: 47 },
    { name: 'Rational Expressions', score: 45 },
    { name: 'Exponential & Log Functions', score: 46 },
    { name: 'Function Notation & Transformations', score: 50 },
    { name: 'Trigonometry Foundations', score: 45 },
    { name: 'Sequences & Series', score: 51 },
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
        "Phase 1 opens with a 40-question cold diagnostic spanning every Algebra 1 skill that Algebra 2 silently assumes — exponent rules, radicals, linear equations, slope, systems of equations, and basic factoring. Most 9th graders have lost 30-40% of these skills over the 12-week summer gap, and Algebra 2 teachers do not slow down to re-teach them. Without this audit, Monira walks in on Day 1 cold on prerequisites, gets buried in Chapter 1 (which uses Algebra 1 fluency as a launchpad into polynomials), and her first unit test lands in the 50-60% range — a high F. The tutor will work through every missed problem from the diagnostic and build a personal error log she keeps for the rest of the year. By end of Phase 1, she will have full Algebra 1 fluency back, plus an installed habit of logging and reviewing every math error she ever makes — a system that compounds for the next 4 years of math.",
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
        "Phase 2 is the single most important phase in the entire Algebra 2 course. Roughly 35-40% of every Algebra 2 final exam reduces to polynomial manipulation and factoring, and every later topic — rational expressions, exponentials, even trig identities — depends on the student being able to factor a polynomial in under 30 seconds without conscious thought. Monira will drill 100+ factoring problems across the four major techniques (GCF, difference of squares, trinomial factoring, factoring by grouping) plus the two cubic techniques (sum/difference of cubes, rational root theorem). She'll learn synthetic division as a 10-second alternative to long division. By end of Phase 2 she will have a factoring fluency that puts her ahead of 90% of her future classmates — the single biggest predictor of an A in Algebra 2.",
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
        "Phase 3 attacks the conceptual leap that destroys most Algebra 2 students: moving from 'solve for x' to 'reason about functions as objects.' Monira will build a permanent parent function library (linear, quadratic, cubic, square root, absolute value, rational, exponential, logarithmic) and learn to apply the four transformations (vertical shift, horizontal shift, stretch/compression, reflection) to any of them on sight. She'll learn to read function notation fluently — f(x), f(g(x)), f⁻¹(x) — and to model real-world growth and decay scenarios using exponential and log functions. The tutor will drill 50+ graphing problems where she sketches a transformed function from its equation alone, no calculator. This phase converts the textbook chapters that most students fail (Chapters 5-7 in standard Algebra 2 sequences) into a guaranteed-A section.",
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
        'Phase 4 previews the two topics most Algebra 2 students see for the first time in spring semester — basic trigonometry and sequences/series — and ends with a full mock Chapter 1-3 test under timed conditions so Monira walks into the actual first unit test in late September already having taken it once. Trig intro covers the unit circle (the six key angles in Q1, sin/cos/tan values she should have memorized), SOH-CAH-TOA, and the basic identities. Sequences covers arithmetic vs. geometric patterns, explicit vs. recursive formulas, and summation notation. The phase ends with the tutor building her personal Algebra 2 study calendar for the fall, complete with weekly review checkpoints aligned to standard Algebra 2 unit schedules. By the last session, she has the confidence, the fluency, and the system to walk in on Day 1 and score 95%+ on every test all year — the difference between an A on her permanent transcript and a C that follows her into college admissions.',
      milestone: 'Score 90%+ on a full mock Chapter 1-3 Algebra 2 test under timed conditions and complete a fall-semester study calendar.',
      description: 'Preview spring-semester topics and run a full mock Chapter 1-3 test so Day 1 of class feels like a review, not a baptism by fire.',
    },
  ],
  outcomes: {
    targetDate: 'End of Algebra 2 - June 2027',
    sessionsTotal: 20,
    practiceProblems: 300,
    sessionsCompleted: 0,
  },
  weaknesses: [
    {
      area: 'Algebra 1 Retention Decay (Projected 53%)',
      issue:
        "After a 12-week summer gap, the average 9th grader retains only 60-70% of their Algebra 1 fluency — exponent rules, radicals, slope, linear equations, and basic factoring all degrade fast without practice. Algebra 2 teachers explicitly assume Day 1 fluency in every one of these skills and use them as the launchpad for Chapter 1 polynomial work. Without the Phase 1 retention audit, Monira walks in cold on prerequisites and is buried in Chapter 1 within the first 5 class days. Her first unit test projects to a 50-60% — a high F that's nearly impossible to recover from once the gradebook locks it in.",
      score: 53,
      impact: 'high',
    },
    {
      area: 'Polynomial & Factoring Foundations (Projected 47-49%)',
      issue:
        'Polynomial manipulation and factoring are the single most important skill cluster in Algebra 2 — roughly 35-40% of every final exam reduces to factoring, and every later chapter (rational expressions, exponentials, even trig identities) silently assumes the student can factor in seconds. Without this prep, Monira would be learning the four major factoring techniques (GCF, difference of squares, trinomial, grouping) in real time alongside new content, which is the standard recipe for a 50-65% gradebook through the entire fall semester. This is the single highest-leverage technical weakness on the report.',
      score: 47,
      impact: 'high',
    },
    {
      area: 'Function Notation & Graphing Transformations (Projected 50%)',
      issue:
        "Algebra 2 is the course where students are first asked to treat functions as objects rather than 'solve for x' procedures — and the conceptual leap kills students who haven't seen function notation, composition, inverses, or parent-function transformations before. Without Phase 3 prep, Monira sees f(g(x)), f⁻¹(x), and the eight parent functions for the first time in October at full class pace, with no time to build intuition. Projected outcome: a 50-60% on Chapters 5-7 unit tests and a permanent grade ceiling at C+ for the semester.",
      score: 50,
      impact: 'high',
    },
    {
      area: 'Honors-Level Pacing & Study System (Projected 50%)',
      issue:
        'Algebra 2 is, for most students, the first honors-level math class — and the gap between middle-school study habits (do the homework, review the night before) and high-school math fluency (daily problem sets, error logs, weekly cumulative review) is enormous. Without a math-specific study system installed before September, Monira would face the standard 9th-grade pattern: keeps up for 3 weeks, falls behind in Chapter 2, never recovers, and the C on her 9th-grade transcript becomes the first GPA event college admissions officers see four years later.',
      score: 50,
      impact: 'high',
    },
  ],
  weeklyProgress: [
    { grade: 50, label: 'Start' },
    { grade: 60, label: 'Week 2' },
    { grade: 71, label: 'Week 4' },
    { grade: 80, label: 'Week 6' },
    { grade: 88, label: 'Week 8' },
    { grade: 94, label: 'Final' },
  ],
};

// ─── 4. PATCH both rows ────────────────────────────────────────────────────
async function patchProgressConfig(id, name, config) {
  console.log(`\n── PATCH ${name} (id=${id}) ──`);
  const result = await sb(`/rest/v1/students?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ progress_config: config }),
  });
  console.log(`  PATCH returned ${result.length} row(s) updated.`);
}

await patchProgressConfig(apwRow.id, apwRow.name, apwConfig);
await patchProgressConfig(algRow.id, algRow.name, algConfig);

// ─── 5. Verify by re-querying ──────────────────────────────────────────────
const verifyRows = await sb(
  `/rest/v1/students?id=in.(${apwRow.id},${algRow.id})&select=id,name,code,progress_config`
);

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  VERIFICATION: re-read from database');
console.log('══════════════════════════════════════════════════════════════');
for (const r of verifyRows) {
  console.log(`\n┌─ ${r.name} (code=${r.code}, id=${r.id}) ─┐\n`);
  console.log(JSON.stringify(r.progress_config, null, 2));
}
