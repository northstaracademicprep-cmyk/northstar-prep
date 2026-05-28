export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });

  const { questionType, parts } = req.body || {};
  if (!questionType || !Array.isArray(parts) || !parts.length) {
    return res.status(400).json({ error: 'Missing questionType or parts' });
  }

  let prompt;
  try {
    prompt = buildPrompt(questionType, parts);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let geminiRes;
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    );
  } catch (err) {
    return res.status(500).json({ error: 'Network error calling Gemini', detail: err.message });
  }

  if (!geminiRes.ok) {
    const detail = await geminiRes.text().catch(() => '');
    return res.status(502).json({ error: `Gemini API error ${geminiRes.status}`, detail });
  }

  const geminiData = await geminiRes.json();
  const raw = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  let grade;
  try {
    grade = JSON.parse(raw);
  } catch {
    return res.status(502).json({ error: 'Gemini returned invalid JSON', raw });
  }

  return res.status(200).json(grade);
}

function buildPrompt(questionType, parts) {
  if (questionType === 'saq') return buildSaqPrompt(parts);
  if (questionType === 'dbq') return buildDbqPrompt(parts[0]);
  if (questionType === 'leq') return buildLeqPrompt(parts[0]);
  throw new Error(`Unknown questionType: ${questionType}`);
}

function buildSaqPrompt(parts) {
  const partsBlock = parts.map(p => `
PART ${p.partLabel}
Question: ${p.questionText}
Scoring criteria: ${p.correctAnswer || '(see scoring notes)'}
Scoring notes: ${p.officialExplanation || ''}
Student response: ${p.studentResponse || '(no response provided)'}
`).join('\n---\n');

  return `You are an AP World History exam reader scoring a Short-Answer Question (SAQ).

Score each part against its official rubric. Each part is worth exactly 1 point.

For each part return:
- "earned": 1 if the student earns the point, 0 if not
- "possible": 1
- "feedback": 2-3 sentences in the voice of an AP reader. State what earns credit and — if not earned — what specifically the student must add or change. Cite the rubric criteria.

Return ONLY valid JSON:
{
  "earnedPoints": <total earned across all parts>,
  "totalPoints": ${parts.length},
  "parts": [
    { "partLabel": "A", "earned": 0, "possible": 1, "feedback": "..." }
  ],
  "overallFeedback": "One sentence summary."
}

${partsBlock}`;
}

function buildDbqPrompt(part) {
  // The DBQ question_text blob embeds 7 source documents. The actual essay
  // prompt is at the end — trim to avoid overwhelming the context.
  const rawText = part.questionText || '';
  const essayPrompt = rawText.length > 600
    ? '…' + rawText.slice(-500).trim()
    : rawText;

  return `You are an AP World History exam reader scoring a Document-Based Question (DBQ). Total possible: 7 points.

Score each category below. Be specific — cite what the student did or failed to do against the rubric.

Categories and point values:
- Thesis/Claim: 1 point — must make a historically defensible claim that establishes a line of reasoning
- Contextualization: 1 point — must describe a broader historical context accurately and connect it to the argument
- Evidence — Document Content: 2 points — 1pt for accurately using content from 3+ docs; 2pts for using 6+ docs AND explaining how each supports the argument
- Evidence — Beyond Documents: 1 point — must use specific evidence NOT from the documents
- Analysis and Reasoning — Sourcing: 1 point — must explain how the sourcing (HAPP) of at least 1 document is relevant to the argument
- Complexity: 1 point — must demonstrate complex understanding (e.g. corroboration, qualification, explanation of both similarity and difference, both continuity and change, multiple causes, or effect of scale/time period)

Official rubric:
${part.officialExplanation || part.correctAnswer || '(no rubric available)'}

Essay prompt: ${essayPrompt}

Student response:
${part.studentResponse || '(no response provided)'}

Return ONLY valid JSON:
{
  "earnedPoints": <total>,
  "totalPoints": 7,
  "categories": [
    { "name": "Thesis/Claim", "earned": 0, "possible": 1, "feedback": "..." },
    { "name": "Contextualization", "earned": 0, "possible": 1, "feedback": "..." },
    { "name": "Evidence — Document Content", "earned": 0, "possible": 2, "feedback": "..." },
    { "name": "Evidence — Beyond Documents", "earned": 0, "possible": 1, "feedback": "..." },
    { "name": "Analysis and Reasoning — Sourcing", "earned": 0, "possible": 1, "feedback": "..." },
    { "name": "Complexity", "earned": 0, "possible": 1, "feedback": "..." }
  ],
  "overallFeedback": "2-3 sentences on strengths and the most important improvements needed."
}`;
}

function buildLeqPrompt(part) {
  return `You are an AP World History exam reader scoring a Long Essay Question (LEQ). Total possible: 6 points.

Score each category below. Be specific — cite what the student did or failed to do against the rubric.

Categories and point values:
- Thesis/Claim: 1 point — must make a historically defensible claim that establishes a line of reasoning beyond restating the prompt
- Contextualization: 1 point — must describe a broader historical context and explicitly connect it to the argument (not just mention it)
- Evidence — Specific Examples: 2 points — 1pt for at least one specific piece of evidence relevant to the topic; 2pts for using specific evidence to support the argument
- Analysis and Reasoning — Historical Reasoning: 1 point — must use causation, comparison, or continuity/change over time reasoning to frame the argument
- Complexity: 1 point — must demonstrate complex understanding (e.g. corroboration, qualification, both similarity and difference, multiple causes, or effect of scale)

Official rubric:
${part.officialExplanation || part.correctAnswer || '(no rubric available)'}

Essay prompt:
${part.questionText || ''}

Student response:
${part.studentResponse || '(no response provided)'}

Return ONLY valid JSON:
{
  "earnedPoints": <total>,
  "totalPoints": 6,
  "categories": [
    { "name": "Thesis/Claim", "earned": 0, "possible": 1, "feedback": "..." },
    { "name": "Contextualization", "earned": 0, "possible": 1, "feedback": "..." },
    { "name": "Evidence — Specific Examples", "earned": 0, "possible": 2, "feedback": "..." },
    { "name": "Analysis and Reasoning — Historical Reasoning", "earned": 0, "possible": 1, "feedback": "..." },
    { "name": "Complexity", "earned": 0, "possible": 1, "feedback": "..." }
  ],
  "overallFeedback": "2-3 sentences on strengths and the most important improvements needed."
}`;
}
