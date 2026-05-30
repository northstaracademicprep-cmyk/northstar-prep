export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  if (!sbUrl || !sbKey) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server' });

  // MCQ reuses existing question_bank columns (no schema additions):
  //   stimulus, stimulus_image_url, choices, correct_answer,
  //   official_explanation, wrong_answer_explanations.
  // student_attempts stores MCQ attempts via selected_answer + is_correct.
  const { subject, questionType, unit: requestedUnit } = req.body || {};
  if (!subject || typeof subject !== 'string') {
    return res.status(400).json({ error: 'Missing subject' });
  }
  if (questionType === 'dbq') {
    return res.status(400).json({ error: 'DBQ generation is not supported yet' });
  }
  if (questionType !== 'saq' && questionType !== 'leq' && questionType !== 'mcq') {
    return res.status(400).json({ error: `Unsupported questionType: ${questionType}` });
  }
  if (questionType === 'mcq') {
    if (!requestedUnit || typeof requestedUnit !== 'string') {
      return res.status(400).json({ error: 'MCQ requires a unit string' });
    }
    if (requestedUnit.length > 200) {
      return res.status(400).json({ error: 'MCQ unit too long (max 200 chars)' });
    }
  }

  // ── Pull real (non-AI) reference questions for few-shot style guidance ──
  let examples, refUnit, refDifficulty;
  try {
    const ref = await fetchExamples(sbUrl, sbKey, subject, questionType);
    examples = ref.examples;
    refUnit = ref.unit;
    refDifficulty = ref.difficulty;
  } catch (err) {
    return res.status(502).json({ error: 'Failed to load reference questions', detail: err.message });
  }
  // SAQ/LEQ require ≥1 reference example. MCQ falls back to no-shot generation
  // because the curated bank doesn't ship with seeded MCQs yet.
  if (!examples.length && questionType !== 'mcq') {
    return res.status(422).json({ error: `No reference ${questionType.toUpperCase()} questions found for subject "${subject}"` });
  }

  const unit = questionType === 'mcq'
    ? requestedUnit
    : (refUnit && String(refUnit).trim() ? refUnit : 'Unassigned');
  const difficulty = VALID_DIFFICULTY.has(refDifficulty)
    ? refDifficulty
    : (questionType === 'leq' ? 'hard' : 'medium');

  // Server-side 80/20 stimulus mix for MCQ — random per generation, enforced
  // in validateGenerated so the model can't drift the mix.
  const wantStimulus = questionType === 'mcq' ? Math.random() < 0.8 : null;

  const prompt = questionType === 'saq'
    ? buildSaqGenPrompt(subject, examples)
    : questionType === 'leq'
    ? buildLeqGenPrompt(subject, examples)
    : buildMcqGenPrompt(subject, unit, examples, wantStimulus);

  // ── Generate with one retry on validation/parse/network failure ──
  let generated;
  try {
    generated = await generateValidated(apiKey, prompt, questionType, wantStimulus);
  } catch (firstErr) {
    try {
      generated = await generateValidated(apiKey, prompt, questionType, wantStimulus);
    } catch (secondErr) {
      return res.status(502).json({
        error: 'Question generation failed after retry',
        detail: secondErr.message,
      });
    }
  }

  // Shuffle MCQ choices server-side to kill the model's letter-position bias.
  if (questionType === 'mcq') {
    generated = shuffleMcq(generated);
  }

  // ── Insert into question_bank (tagged ai_generated) and return rows ──
  let parentNumber;
  try {
    parentNumber = await nextParentNumber(sbUrl, sbKey, subject);
  } catch (err) {
    return res.status(502).json({ error: 'Failed to compute question number', detail: err.message });
  }

  const base = {
    subject,
    unit,
    unit_number: null,
    topic: null,
    difficulty,
    stimulus: null,            // v1 is source-free — no fabricated sources
    stimulus_image_url: null,
    choices: null,
    wrong_answer_explanations: null,
    source: 'AI Generated',
    source_year: null,
    tags: ['ai'],
    parent_question_number: parentNumber,
    ai_generated: true,
  };

  let rows;
  if (questionType === 'saq') {
    rows = generated.parts.map((p, i) => ({
      ...base,
      question_type: 'saq',
      sub_index: String.fromCharCode(65 + i), // A / B / C
      question_text: p.question_text,
      correct_answer: p.correct_answer,
      official_explanation: p.official_explanation,
    }));
  } else if (questionType === 'leq') {
    rows = [{
      ...base,
      question_type: 'leq',
      sub_index: null,
      question_text: generated.question_text,
      correct_answer: generated.correct_answer,
      official_explanation: generated.official_explanation,
    }];
  } else {
    // mcq
    rows = [{
      ...base,
      question_type: 'mcq',
      sub_index: null,
      stimulus: generated.stimulus || null,
      question_text: generated.question_text,
      choices: generated.choices,
      correct_answer: generated.correct_answer,
      official_explanation: generated.official_explanation,
      wrong_answer_explanations: generated.wrong_answer_explanations,
    }];
  }

  let inserted;
  try {
    inserted = await insertRows(sbUrl, sbKey, rows);
  } catch (err) {
    return res.status(502).json({ error: 'Failed to save generated question', detail: err.message });
  }

  if (questionType === 'saq') {
    const ordered = inserted.slice().sort((a, b) => (a.sub_index || '').localeCompare(b.sub_index || ''));
    return res.status(200).json({
      questionType: 'saq',
      ai_generated: true,
      stimulus: null,
      parts: ordered.map(r => ({
        id: r.id,
        sub_index: r.sub_index,
        question_text: r.question_text,
        correct_answer: r.correct_answer,
        official_explanation: r.official_explanation,
      })),
    });
  }

  if (questionType === 'mcq') {
    const r = inserted[0];
    return res.status(200).json({
      questionType: 'mcq',
      ai_generated: true,
      row: {
        id: r.id,
        question_type: 'mcq',
        unit: r.unit,
        stimulus: r.stimulus,
        stimulus_image_url: null,
        question_text: r.question_text,
        choices: r.choices,
        correct_answer: r.correct_answer,
        official_explanation: r.official_explanation,
        wrong_answer_explanations: r.wrong_answer_explanations,
      },
    });
  }

  const r = inserted[0];
  return res.status(200).json({
    questionType: 'leq',
    ai_generated: true,
    row: {
      id: r.id,
      question_type: 'leq',
      stimulus: null,
      stimulus_image_url: null,
      question_text: r.question_text,
      correct_answer: r.correct_answer,
      official_explanation: r.official_explanation,
    },
  });
}

const VALID_DIFFICULTY = new Set(['easy', 'medium', 'hard']);

// ── Supabase PostgREST helpers (no SDK — mirrors grade.js's fetch style) ──
function sbHeaders(sbKey) {
  return {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
  };
}

async function fetchExamples(sbUrl, sbKey, subject, questionType) {
  const enc = encodeURIComponent(subject);
  if (questionType === 'saq') {
    const url = `${sbUrl}/rest/v1/question_bank?select=parent_question_number,sub_index,question_text,official_explanation,unit,difficulty`
      + `&subject=eq.${enc}&question_type=eq.saq&ai_generated=eq.false`
      + `&order=parent_question_number.asc,sub_index.asc&limit=12`;
    const rows = await sbGet(url, sbKey);
    // Reconstruct full SAQs by grouping parts under their parent question.
    const groups = new Map();
    for (const row of rows) {
      const key = row.parent_question_number ?? `solo-${row.question_text.slice(0, 20)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const examples = [...groups.values()].slice(0, 2).map(parts => ({
      parts: parts.map(p => ({
        label: p.sub_index || '',
        question_text: p.question_text,
        official_explanation: p.official_explanation,
      })),
    }));
    return { examples, unit: rows[0]?.unit, difficulty: rows[0]?.difficulty };
  }

  if (questionType === 'mcq') {
    const url = `${sbUrl}/rest/v1/question_bank?select=stimulus,question_text,choices,correct_answer,official_explanation,wrong_answer_explanations,unit,difficulty`
      + `&subject=eq.${enc}&question_type=eq.mcq&ai_generated=eq.false`
      + `&order=parent_question_number.asc,created_at.asc&limit=2`;
    const rows = await sbGet(url, sbKey);
    const examples = rows.map(r => ({
      stimulus: r.stimulus,
      question_text: r.question_text,
      choices: r.choices,
      correct_answer: r.correct_answer,
      official_explanation: r.official_explanation,
      wrong_answer_explanations: r.wrong_answer_explanations,
    }));
    return { examples, unit: rows[0]?.unit, difficulty: rows[0]?.difficulty };
  }

  const url = `${sbUrl}/rest/v1/question_bank?select=question_text,official_explanation,unit,difficulty`
    + `&subject=eq.${enc}&question_type=eq.leq&ai_generated=eq.false`
    + `&order=parent_question_number.asc&limit=2`;
  const rows = await sbGet(url, sbKey);
  const examples = rows.map(r => ({
    question_text: r.question_text,
    official_explanation: r.official_explanation,
  }));
  return { examples, unit: rows[0]?.unit, difficulty: rows[0]?.difficulty };
}

// Generated rows live in a reserved 9000+ band so their ordering never
// collides with the curated College Board rows (numbered 1–8).
async function nextParentNumber(sbUrl, sbKey, subject) {
  const enc = encodeURIComponent(subject);
  const url = `${sbUrl}/rest/v1/question_bank?select=parent_question_number`
    + `&subject=eq.${enc}&ai_generated=eq.true`
    + `&order=parent_question_number.desc&limit=1`;
  const rows = await sbGet(url, sbKey);
  const max = rows[0]?.parent_question_number;
  return Math.max(9000, (typeof max === 'number' ? max : 8999) + 1);
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

// ── Gemini call + validation (one attempt; caller retries once) ──
async function generateValidated(apiKey, prompt, questionType, wantStimulus) {
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
      }),
    }
  );
  if (!geminiRes.ok) {
    const detail = await geminiRes.text().catch(() => '');
    throw new Error(`Gemini API error ${geminiRes.status}: ${detail}`);
  }
  const data = await geminiRes.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let obj;
  try {
    obj = JSON.parse(rawText);
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }
  return validateGenerated(obj, questionType, wantStimulus);
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateGenerated(obj, questionType, wantStimulus) {
  if (!obj || typeof obj !== 'object') throw new Error('Generated payload is not an object');

  if (questionType === 'saq') {
    if (!Array.isArray(obj.parts) || obj.parts.length !== 3) {
      throw new Error('SAQ must have exactly 3 parts');
    }
    obj.parts.forEach((p, i) => {
      if (!nonEmpty(p.question_text) || !nonEmpty(p.correct_answer) || !nonEmpty(p.official_explanation)) {
        throw new Error(`SAQ part ${i + 1} has empty fields`);
      }
    });
    return { parts: obj.parts };
  }

  if (questionType === 'mcq') {
    return validateMcq(obj, wantStimulus);
  }

  // leq
  if (!nonEmpty(obj.question_text) || !nonEmpty(obj.correct_answer) || !nonEmpty(obj.official_explanation)) {
    throw new Error('LEQ has empty fields');
  }
  return {
    question_text: obj.question_text,
    correct_answer: obj.correct_answer,
    official_explanation: obj.official_explanation,
  };
}

function validateMcq(obj, wantStimulus) {
  if (!nonEmpty(obj.question_text)) throw new Error('MCQ has empty question_text');
  if (!nonEmpty(obj.official_explanation)) throw new Error('MCQ has empty official_explanation');

  const hasStimulus = nonEmpty(obj.stimulus);
  if (wantStimulus && !hasStimulus) throw new Error('MCQ expected stimulus-based but none provided');
  if (!wantStimulus && hasStimulus) throw new Error('MCQ expected standalone but stimulus provided');

  if (!Array.isArray(obj.choices) || obj.choices.length !== 4) {
    throw new Error('MCQ must have exactly 4 choices');
  }
  const letters = obj.choices.map(c => c?.letter);
  if (!['A','B','C','D'].every(L => letters.includes(L))) {
    throw new Error('MCQ choices must be lettered A, B, C, D');
  }
  obj.choices.forEach((c, i) => {
    if (!nonEmpty(c?.text)) throw new Error(`MCQ choice at index ${i} has empty text`);
  });

  if (!['A','B','C','D'].includes(obj.correct_answer)) {
    throw new Error('MCQ correct_answer must be A, B, C, or D');
  }

  const wrong = obj.wrong_answer_explanations;
  if (!wrong || typeof wrong !== 'object') {
    throw new Error('MCQ wrong_answer_explanations must be an object');
  }
  ['A','B','C','D'].filter(L => L !== obj.correct_answer).forEach(L => {
    if (!nonEmpty(wrong[L])) throw new Error(`MCQ wrong_answer_explanations missing or empty for ${L}`);
  });

  return {
    stimulus: hasStimulus ? obj.stimulus : null,
    question_text: obj.question_text,
    choices: obj.choices,
    correct_answer: obj.correct_answer,
    official_explanation: obj.official_explanation,
    wrong_answer_explanations: wrong,
  };
}

// Fisher-Yates shuffle of the 4 choices, then relabel A-D in new positions,
// recompute correct_answer to the letter the originally-correct option now
// occupies, and remap wrong_answer_explanations keys.
function shuffleMcq(obj) {
  const tagged = obj.choices.map(c => ({ originalLetter: c.letter, text: c.text }));
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  const newChoices = tagged.map((c, i) => ({
    letter: String.fromCharCode(65 + i),
    text: c.text,
  }));
  const correctIdx = tagged.findIndex(c => c.originalLetter === obj.correct_answer);
  const newCorrect = String.fromCharCode(65 + correctIdx);
  const newWrong = {};
  tagged.forEach((c, i) => {
    if (i === correctIdx) return;
    const newLetter = String.fromCharCode(65 + i);
    const exp = obj.wrong_answer_explanations?.[c.originalLetter];
    if (exp) newWrong[newLetter] = exp;
  });
  return {
    ...obj,
    choices: newChoices,
    correct_answer: newCorrect,
    wrong_answer_explanations: newWrong,
  };
}

// ── Prompt builders ──
function truncate(s, n) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n).trim() + '…' : str;
}

function buildSaqGenPrompt(subject, examples) {
  const examplesBlock = examples.map((ex, i) => {
    const parts = ex.parts.map(p =>
      `Part ${p.label} — ${truncate(p.question_text, 400)}\n  Rubric: ${truncate(p.official_explanation, 500)}`
    ).join('\n');
    return `EXAMPLE SAQ ${i + 1}:\n${parts}`;
  }).join('\n\n');

  return `You are an AP ${subject} item writer. Write ONE brand-new Short-Answer Question (SAQ) in the exact style of the College Board.

The questions below are REAL College Board SAQs from this course, provided ONLY as references for style, structure, scope, and difficulty. Do NOT copy them, their topics, or their wording.

${examplesBlock}

Requirements:
- The SAQ must have exactly THREE parts labeled A, B, and C. Each part is worth 1 point and must be independently answerable.
- Match the structure, scope, and difficulty of the examples.
- This is a SOURCE-FREE SAQ: do NOT include or reference any stimulus, passage, image, chart, quotation, or named source/author/document.

Historical accuracy (critical):
- All historical content MUST be factually accurate.
- Do NOT fabricate events, dates, statistics, quotations, people, or sources. Do not invent a primary-source document, author, or attribution that did not exist.
- If you are not certain a detail is real, do not include it.

For each part provide:
- "question_text": the prompt for that part (e.g. "Briefly describe one ...").
- "correct_answer": a single concise sentence summarizing the scoring criteria / what earns the point.
- "official_explanation": the full rubric — "1 point" plus a short bulleted list of acceptable responses, formatted exactly as: "**1 point** — Examples of acceptable responses include:\\n- ...\\n- ..."

Return ONLY valid JSON:
{
  "parts": [
    { "partLabel": "A", "question_text": "...", "correct_answer": "...", "official_explanation": "..." },
    { "partLabel": "B", "question_text": "...", "correct_answer": "...", "official_explanation": "..." },
    { "partLabel": "C", "question_text": "...", "correct_answer": "...", "official_explanation": "..." }
  ]
}`;
}

function buildLeqGenPrompt(subject, examples) {
  const examplesBlock = examples.map((ex, i) =>
    `EXAMPLE LEQ ${i + 1}:\nPrompt: ${truncate(ex.question_text, 500)}\nRubric: ${truncate(ex.official_explanation, 600)}`
  ).join('\n\n');

  return `You are an AP ${subject} item writer. Write ONE brand-new Long Essay Question (LEQ) in the exact style of the College Board.

The questions below are REAL College Board LEQs from this course, provided ONLY as references for style, scope, and difficulty. Do NOT copy them or their wording.

${examplesBlock}

Requirements:
- Produce ONE essay prompt (a single question) using a College Board action stem (e.g. "Evaluate the extent to which ...").
- It must be answerable as a 6-point LEQ (thesis, contextualization, evidence, historical reasoning, complexity).
- This is a SOURCE-FREE prompt: do NOT include or reference any document, passage, image, quotation, or named source.

Historical accuracy (critical):
- All historical content MUST be factually accurate. The time period, region, and theme must be real and correctly scoped for this course.
- Do NOT fabricate events, dates, statistics, quotations, people, or sources.
- If you are not certain a detail is real, do not include it.

Provide:
- "question_text": the essay prompt.
- "correct_answer": a single concise sentence summarizing what a high-scoring response must do.
- "official_explanation": the LEQ rubric describing how the 6 points are earned (Thesis/Claim, Contextualization, Evidence x2, Historical Reasoning, Complexity).

Return ONLY valid JSON:
{
  "question_text": "...",
  "correct_answer": "...",
  "official_explanation": "..."
}`;
}

function buildMcqGenPrompt(subject, unit, examples, wantStimulus) {
  const examplesBlock = examples.length
    ? '\n\nEXAMPLES (real College Board MCQs — use ONLY for style, NEVER copy):\n\n' + examples.map((ex, i) => {
        const choicesStr = (ex.choices || []).map(c => `${c.letter}) ${truncate(c.text, 110)}`).join(' | ');
        return `EXAMPLE ${i + 1}:\n${ex.stimulus ? `Stimulus: ${truncate(ex.stimulus, 400)}\n` : ''}Stem: ${truncate(ex.question_text, 250)}\nChoices: ${choicesStr}\nCorrect: ${ex.correct_answer}\nWhy: ${truncate(ex.official_explanation, 250)}`;
      }).join('\n\n')
    : '';

  const stimulusInstr = wantStimulus
    ? `STIMULUS-BASED: include a "stimulus" field — a 50–110 word analytical passage, primary-source-style excerpt, or contextual description grounded in ${unit}.`
    : `STANDALONE: NO stimulus. Set "stimulus" to null. The stem must be answerable from historical knowledge alone.`;

  const accuracyBlock = wantStimulus
    ? `- The stimulus may be a SYNTHESIZED analytical passage in an unattributed contemporary voice (e.g. "An anonymous Malian merchant, c. 1350, observed:") OR a generic descriptive paragraph.
- Do NOT attribute the stimulus to a real named historian, scholar, author, or any specific living or historical person. Phrases like "According to [real name]" or "[Real historian] argues that..." are FORBIDDEN.
- Do NOT fabricate specific quotes from real people. Do NOT invent a real-sounding document title that doesn't exist.`
    : `- Do NOT cite or quote any real named person; do NOT fabricate sources, documents, or quotations anywhere in the stem or choices.`;

  return `You are an AP ${subject} item writer. Write ONE brand-new College Board–style multiple-choice question for ${unit}.${examplesBlock}

${stimulusInstr}

Structure:
- Stem: typical College Board phrasing — e.g. "The excerpt most strongly suggests...", "The process described most directly contributed to...", "Which of the following best explains..."
- Exactly FOUR answer choices labeled A, B, C, D. Exactly ONE is correct.
- The three distractors must be plausible — each wrong for a specific identifiable reason, not obviously absurd.

HISTORICAL ACCURACY (non-negotiable):
- All historical content (events, dates, regions, processes, demographic claims, named groups, institutions) MUST be factually accurate and correctly scoped to ${unit}.
${accuracyBlock}
- If you cannot meet the accuracy bar on a chosen angle, pick a different angle.

Return ONLY valid JSON:
{
  "stimulus": ${wantStimulus ? '"..."' : 'null'},
  "question_text": "...",
  "choices": [
    {"letter":"A","text":"..."},
    {"letter":"B","text":"..."},
    {"letter":"C","text":"..."},
    {"letter":"D","text":"..."}
  ],
  "correct_answer": "A",
  "official_explanation": "Why the correct answer is correct.",
  "wrong_answer_explanations": {
    "B": "Why B is wrong.",
    "C": "Why C is wrong.",
    "D": "Why D is wrong."
  }
}`;
}
