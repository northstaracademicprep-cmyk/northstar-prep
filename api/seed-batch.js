// ============================================================
// /api/seed-batch
// One Gemini call → N question_bank rows (approved=false).
//
// Phase 1a of the bank-serving migration. Lets an admin pre-fill the
// question bank with reviewable AI batches so Phase 2's serve path can
// hand questions to students instantly without firing Gemini per Next.
//
// Model: full gemini-2.5-flash, not flash-lite. This is an interactive
// off-hours admin op, well within the daily flash quota, and quality
// matters more than per-request cost since admin reviews every output.
//
// Insert defaults: approved=false, ai_generated=true, source='AI batch
// seed'. The migration's auto-backfill kept curated rows approved=true,
// so legacy ?mode=frq linear flow keeps working unchanged.
// ============================================================

const MAX_BATCH     = 20;
const DEFAULT_BATCH = 10;
const VALID_TYPES   = new Set(['mcq', 'saq', 'leq']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  const sbUrl  = process.env.SUPABASE_URL;
  const sbKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey)          return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  if (!sbUrl || !sbKey) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server' });

  const { subject, questionType, unit, count } = req.body || {};
  if (!subject || typeof subject !== 'string') {
    return res.status(400).json({ error: 'Missing subject' });
  }
  if (!VALID_TYPES.has(questionType)) {
    return res.status(400).json({ error: `Unsupported questionType: ${questionType}` });
  }
  if (questionType === 'mcq') {
    if (!unit || typeof unit !== 'string') return res.status(400).json({ error: 'MCQ batch requires a unit string' });
    if (unit.length > 200) return res.status(400).json({ error: 'MCQ unit too long (max 200 chars)' });
  }
  const N = Math.max(1, Math.min(MAX_BATCH, Number(count) || DEFAULT_BATCH));

  const prompt =
    questionType === 'mcq' ? buildMcqBatchPrompt(subject, unit, N) :
    questionType === 'saq' ? buildSaqBatchPrompt(subject, N) :
                             buildLeqBatchPrompt(subject, N);

  // Single Gemini call, one retry on parse/network failure.
  let items;
  try {
    items = await callGeminiForBatch(apiKey, prompt);
  } catch (firstErr) {
    try {
      items = await callGeminiForBatch(apiKey, prompt);
    } catch (secondErr) {
      return res.status(502).json({ error: 'Batch generation failed after retry', detail: secondErr.message });
    }
  }
  if (!Array.isArray(items)) {
    return res.status(502).json({ error: 'Batch response was not a JSON array' });
  }

  // Per-item validation: items that fail are dropped, not the whole batch.
  // Admin can re-run if they want more.
  const validators = { mcq: validateMcqItem, saq: validateSaqItem, leq: validateLeqItem };
  const valid = [];
  const errors = [];
  items.forEach((item, i) => {
    try { valid.push(validators[questionType](item)); }
    catch (err) { errors.push(`Item ${i + 1}: ${err.message}`); }
  });

  if (questionType === 'mcq') {
    for (let i = 0; i < valid.length; i++) valid[i] = shuffleMcqChoices(valid[i]);
  }

  if (!valid.length) {
    return res.status(502).json({ error: 'All items failed validation', detail: errors.join('; ').slice(0, 800) });
  }

  // parent_question_number for each item (SAQ: shared by 3 parts).
  let nextParent;
  try {
    nextParent = await getNextParentStart(sbUrl, sbKey, subject);
  } catch (err) {
    return res.status(502).json({ error: 'Failed to compute parent_question_number', detail: err.message });
  }

  const baseRow = {
    subject,
    unit: questionType === 'mcq' ? unit : 'Mixed',
    unit_number: null,
    topic: null,
    difficulty: questionType === 'leq' ? 'hard' : 'medium',
    stimulus: null,
    stimulus_image_url: null,
    choices: null,
    wrong_answer_explanations: null,
    source: 'AI batch seed',
    source_year: null,
    tags: ['ai', 'batch'],
    approved: false,
    ai_generated: true,
  };

  const rows = [];
  valid.forEach((v, i) => {
    const parentNum = nextParent + i;
    if (questionType === 'mcq') {
      rows.push({
        ...baseRow,
        question_type: 'mcq',
        sub_index: null,
        stimulus: v.stimulus || null,
        question_text: v.question_text,
        choices: v.choices,
        correct_answer: v.correct_answer,
        official_explanation: v.official_explanation,
        wrong_answer_explanations: v.wrong_answer_explanations,
        parent_question_number: parentNum,
      });
    } else if (questionType === 'leq') {
      rows.push({
        ...baseRow,
        question_type: 'leq',
        sub_index: null,
        question_text: v.question_text,
        correct_answer: v.correct_answer,
        official_explanation: v.official_explanation,
        parent_question_number: parentNum,
      });
    } else {
      // saq: 3 rows per item sharing parent_question_number
      v.parts.forEach((p, pi) => {
        rows.push({
          ...baseRow,
          question_type: 'saq',
          sub_index: String.fromCharCode(65 + pi),
          question_text: p.question_text,
          correct_answer: p.correct_answer,
          official_explanation: p.official_explanation,
          parent_question_number: parentNum,
        });
      });
    }
  });

  let inserted;
  try {
    inserted = await insertRows(sbUrl, sbKey, rows);
  } catch (err) {
    return res.status(502).json({ error: 'Bulk insert failed', detail: err.message });
  }

  console.log(`[seed-batch] subject="${subject}" type=${questionType} unit="${unit || '-'}" requested=${N} validated=${valid.length} inserted=${inserted.length} skipped=${items.length - valid.length}`);

  return res.status(200).json({
    requested: N,
    received: items.length,
    validated: valid.length,
    inserted: inserted.length,
    skipped: items.length - valid.length,
    errors: errors.slice(0, 5),
    parent_start: nextParent,
  });
}

// ── Gemini call ──────────────────────────────────────────────────────
async function callGeminiForBatch(apiKey, prompt) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.95 },
      }),
    }
  );
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Gemini API error ${r.status}: ${detail.slice(0, 400)}`);
  }
  const data = await r.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }
}

// ── Supabase helpers ─────────────────────────────────────────────────
function sbHeaders(sbKey) {
  return { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };
}
async function sbGet(url, sbKey) {
  const r = await fetch(url, { headers: sbHeaders(sbKey) });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase GET ${r.status}: ${detail}`);
  }
  return r.json();
}
async function insertRows(sbUrl, sbKey, rows) {
  const r = await fetch(`${sbUrl}/rest/v1/question_bank`, {
    method: 'POST',
    headers: { ...sbHeaders(sbKey), Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase INSERT ${r.status}: ${detail}`);
  }
  return r.json();
}

// Generated rows live in a reserved 9000+ band so their ordering never
// collides with curated College Board rows (numbered 1–8). Batch reserves
// N consecutive numbers starting at this value.
async function getNextParentStart(sbUrl, sbKey, subject) {
  const url = `${sbUrl}/rest/v1/question_bank?select=parent_question_number`
    + `&subject=eq.${encodeURIComponent(subject)}`
    + `&order=parent_question_number.desc&limit=1`;
  const rows = await sbGet(url, sbKey);
  const max = rows[0]?.parent_question_number;
  return Math.max(9000, (typeof max === 'number' ? max : 8999) + 1);
}

// ── Validators ───────────────────────────────────────────────────────
function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }

function validateMcqItem(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('not an object');
  if (!nonEmpty(obj.question_text)) throw new Error('empty question_text');
  if (!nonEmpty(obj.official_explanation)) throw new Error('empty official_explanation');
  if (obj.stimulus != null && !nonEmpty(obj.stimulus)) throw new Error('empty stimulus when present');
  if (!Array.isArray(obj.choices) || obj.choices.length !== 4) throw new Error('choices must be array of 4');
  const letters = obj.choices.map(c => c?.letter);
  if (!['A','B','C','D'].every(L => letters.includes(L))) throw new Error('choices must be lettered A-D');
  obj.choices.forEach((c, i) => { if (!nonEmpty(c?.text)) throw new Error(`choice ${i} empty`); });
  if (!['A','B','C','D'].includes(obj.correct_answer)) throw new Error('correct_answer must be A-D');
  const wrong = obj.wrong_answer_explanations;
  if (!wrong || typeof wrong !== 'object') throw new Error('wrong_answer_explanations must be object');
  ['A','B','C','D'].filter(L => L !== obj.correct_answer).forEach(L => {
    if (!nonEmpty(wrong[L])) throw new Error(`wrong_answer_explanations missing/empty for ${L}`);
  });
  return {
    stimulus: nonEmpty(obj.stimulus) ? obj.stimulus : null,
    question_text: obj.question_text,
    choices: obj.choices,
    correct_answer: obj.correct_answer,
    official_explanation: obj.official_explanation,
    wrong_answer_explanations: wrong,
  };
}

function validateSaqItem(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('not an object');
  if (!Array.isArray(obj.parts) || obj.parts.length !== 3) throw new Error('SAQ must have 3 parts');
  obj.parts.forEach((p, i) => {
    if (!nonEmpty(p?.question_text) || !nonEmpty(p?.correct_answer) || !nonEmpty(p?.official_explanation)) {
      throw new Error(`part ${i + 1} has empty fields`);
    }
  });
  return { parts: obj.parts.map(p => ({
    question_text: p.question_text,
    correct_answer: p.correct_answer,
    official_explanation: p.official_explanation,
  })) };
}

function validateLeqItem(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('not an object');
  if (!nonEmpty(obj.question_text) || !nonEmpty(obj.correct_answer) || !nonEmpty(obj.official_explanation)) {
    throw new Error('empty fields');
  }
  return {
    question_text: obj.question_text,
    correct_answer: obj.correct_answer,
    official_explanation: obj.official_explanation,
  };
}

// Fisher-Yates shuffle of the 4 choices, then relabel A-D, recompute
// correct_answer, remap wrong_answer_explanations keys. Kills the model's
// letter-position bias. Same pattern as /api/generate.js.
function shuffleMcqChoices(obj) {
  const tagged = obj.choices.map(c => ({ originalLetter: c.letter, text: c.text }));
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  const newChoices = tagged.map((c, i) => ({ letter: String.fromCharCode(65 + i), text: c.text }));
  const correctIdx = tagged.findIndex(c => c.originalLetter === obj.correct_answer);
  const newCorrect = String.fromCharCode(65 + correctIdx);
  const newWrong = {};
  tagged.forEach((c, i) => {
    if (i === correctIdx) return;
    const newLetter = String.fromCharCode(65 + i);
    const exp = obj.wrong_answer_explanations?.[c.originalLetter];
    if (exp) newWrong[newLetter] = exp;
  });
  return { ...obj, choices: newChoices, correct_answer: newCorrect, wrong_answer_explanations: newWrong };
}

// ── Prompts ──────────────────────────────────────────────────────────
function buildMcqBatchPrompt(subject, unit, count) {
  return `You are an AP ${subject} item writer creating ${count} brand-new College Board–style multiple-choice questions for ${unit}.

Each question is independent. Vary topics within ${unit}, stimulus types (synthesized excerpt, contextual paragraph, brief data description), and difficulty (mix easy/medium/hard within the batch).

Format requirements for EACH question:
- About 80% should be stimulus-based (50–110 word passage in the "stimulus" field); about 20% should be standalone (stimulus = null).
- Stem in typical College Board phrasing — "The excerpt most strongly suggests…", "The process described most directly contributed to…", "Which of the following best explains…", etc.
- Exactly 4 answer choices labeled A, B, C, D. Exactly ONE is correct. Distractors must be plausible — wrong for a specific identifiable reason, not absurd.

HISTORICAL ACCURACY (non-negotiable):
- All historical content (events, dates, regions, processes, demographic claims, named groups, institutions) MUST be factually accurate and correctly scoped to ${unit}.
- Stimuli may be SYNTHESIZED in an unattributed contemporary voice (e.g. "An anonymous Malian merchant, c. 1350, observed:") OR a generic third-person descriptive paragraph.
- DO NOT attribute the stimulus to a real named historian, scholar, author, or specific historical person. Phrases like "According to [real name]" or "[Real historian] argues that…" are FORBIDDEN.
- DO NOT fabricate quotes from real people. DO NOT invent real-sounding document titles that don't exist.

Return ONLY valid JSON — an array of exactly ${count} question objects:
[
  {
    "stimulus": "..." or null,
    "question_text": "...",
    "choices": [
      {"letter":"A","text":"..."},
      {"letter":"B","text":"..."},
      {"letter":"C","text":"..."},
      {"letter":"D","text":"..."}
    ],
    "correct_answer": "A",
    "official_explanation": "Why the correct answer is correct.",
    "wrong_answer_explanations": { "B": "Why B is wrong.", "C": "Why C is wrong.", "D": "Why D is wrong." }
  }
]`;
}

function buildSaqBatchPrompt(subject, count) {
  return `You are an AP ${subject} item writer creating ${count} brand-new College Board–style Short-Answer Questions (SAQs).

Each SAQ has exactly 3 parts labeled A, B, C. Each part is worth 1 point and must be independently answerable.

This is SOURCE-FREE: no stimulus, passage, image, chart, quotation, or named source/author/document anywhere in any SAQ.

Vary topics across the ${count} SAQs — different units, themes, time periods, and reasoning types.

HISTORICAL ACCURACY (non-negotiable):
- All historical content MUST be factually accurate.
- DO NOT fabricate events, dates, statistics, quotations, people, or sources.
- DO NOT invent primary-source documents, authors, or attributions.

For EACH part provide:
- "question_text": the prompt (e.g. "Briefly describe one cause of…").
- "correct_answer": a single concise sentence summarizing the scoring criteria.
- "official_explanation": the full rubric — "**1 point** — Examples of acceptable responses include:\\n- ...\\n- ..."

Return ONLY valid JSON — an array of exactly ${count} SAQ objects:
[
  {
    "parts": [
      { "partLabel": "A", "question_text": "...", "correct_answer": "...", "official_explanation": "..." },
      { "partLabel": "B", "question_text": "...", "correct_answer": "...", "official_explanation": "..." },
      { "partLabel": "C", "question_text": "...", "correct_answer": "...", "official_explanation": "..." }
    ]
  }
]`;
}

function buildLeqBatchPrompt(subject, count) {
  return `You are an AP ${subject} item writer creating ${count} brand-new College Board–style Long Essay Question (LEQ) prompts.

Each LEQ is ONE essay prompt using a College Board action stem (e.g. "Evaluate the extent to which…"), answerable as a 6-point LEQ (Thesis/Claim, Contextualization, Evidence ×2, Historical Reasoning, Complexity).

SOURCE-FREE: no documents, passages, images, quotations, or named sources.

Vary themes across the ${count} prompts — different time periods, regions, units, and reasoning processes (causation, comparison, continuity/change over time).

HISTORICAL ACCURACY (non-negotiable):
- All historical content MUST be factually accurate. Time period, region, and theme must be real and correctly scoped to this course.
- DO NOT fabricate events, dates, statistics, quotations, people, or sources.

For each LEQ provide:
- "question_text": the essay prompt.
- "correct_answer": a single concise sentence summarizing what a high-scoring response must do.
- "official_explanation": the LEQ rubric describing how the 6 points are earned (Thesis/Claim, Contextualization, Evidence ×2, Historical Reasoning, Complexity).

Return ONLY valid JSON — an array of exactly ${count} LEQ objects:
[
  {
    "question_text": "...",
    "correct_answer": "...",
    "official_explanation": "..."
  }
]`;
}
