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

  const { subject, questionType } = req.body || {};
  if (!subject || typeof subject !== 'string') {
    return res.status(400).json({ error: 'Missing subject' });
  }
  if (questionType === 'dbq') {
    return res.status(400).json({ error: 'DBQ generation is not supported yet' });
  }
  if (questionType !== 'saq' && questionType !== 'leq') {
    return res.status(400).json({ error: `Unsupported questionType: ${questionType}` });
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
  if (!examples.length) {
    return res.status(422).json({ error: `No reference ${questionType.toUpperCase()} questions found for subject "${subject}"` });
  }

  const unit = refUnit && String(refUnit).trim() ? refUnit : 'Unassigned';
  const difficulty = VALID_DIFFICULTY.has(refDifficulty)
    ? refDifficulty
    : (questionType === 'leq' ? 'hard' : 'medium');

  const prompt = questionType === 'saq'
    ? buildSaqGenPrompt(subject, examples)
    : buildLeqGenPrompt(subject, examples);

  // ── Generate with one retry on validation/parse/network failure ──
  let generated;
  try {
    generated = await generateValidated(apiKey, prompt, questionType);
  } catch (firstErr) {
    try {
      generated = await generateValidated(apiKey, prompt, questionType);
    } catch (secondErr) {
      return res.status(502).json({
        error: 'Question generation failed after retry',
        detail: secondErr.message,
      });
    }
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
  } else {
    rows = [{
      ...base,
      question_type: 'leq',
      sub_index: null,
      question_text: generated.question_text,
      correct_answer: generated.correct_answer,
      official_explanation: generated.official_explanation,
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
async function generateValidated(apiKey, prompt, questionType) {
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
  return validateGenerated(obj, questionType);
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateGenerated(obj, questionType) {
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
