// ============================================================
// /api/review-queue
// Phase 1b of the bank-serving migration. Drives the in-portal
// Review Queue admin UI so a human can approve AI-seeded questions
// without leaving the portal.
//
// POST { action, adminSecret, ... }
//   action: "list"     → returns unapproved AI questions, SAQ parts
//                        collapsed into a single item per parent.
//   action: "approve"  → flips approved=true, reviewed_at=now(),
//                        reviewed_by='NAP-ADMIN' on every row matching
//                        (subject, parent_question_number).
//   action: "reject"   → DELETEs every row matching the same key.
//
// Gated by ADMIN_RESET_SECRET (reused — same admin trust boundary as
// /api/reset-practice and /api/seed-batch). Writes are scoped to
// ai_generated=true AND approved=false so the curated College Board
// set is unreachable even with a wrong parent_question_number.
// ============================================================

const VALID_ACTIONS = new Set(['list', 'approve', 'reject']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sbUrl  = process.env.SUPABASE_URL;
  const sbKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.ADMIN_RESET_SECRET;
  if (!sbUrl || !sbKey) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server' });
  if (!secret)          return res.status(503).json({ error: 'ADMIN_RESET_SECRET not configured on server — set it in Vercel project settings' });

  const { action, adminSecret, parentNumber, subject } = req.body || {};
  if (typeof adminSecret !== 'string' || adminSecret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!VALID_ACTIONS.has(action)) {
    return res.status(400).json({ error: `Invalid action: ${action}` });
  }

  try {
    if (action === 'list')    return res.status(200).json(await listQueue(sbUrl, sbKey));
    if (action === 'approve') return res.status(200).json(await approveItem(sbUrl, sbKey, parentNumber, subject));
    if (action === 'reject')  return res.status(200).json(await rejectItem(sbUrl, sbKey, parentNumber, subject));
  } catch (err) {
    return res.status(502).json({ error: `${action} failed`, detail: err.message });
  }
}

// ── Supabase helpers ─────────────────────────────────────────────────
function sbHeaders(sbKey) {
  return { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };
}

async function listQueue(sbUrl, sbKey) {
  const url = `${sbUrl}/rest/v1/question_bank?select=*`
    + `&approved=eq.false&ai_generated=eq.true`
    + `&order=subject.asc,parent_question_number.asc,sub_index.asc`;
  const r = await fetch(url, { headers: sbHeaders(sbKey) });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase GET ${r.status}: ${detail}`);
  }
  const rows = await r.json();

  // Group by (subject, parent_question_number) — SAQ's 3 parts collapse
  // into one queue item; MCQ/LEQ groups will only have one row each.
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.subject}::${row.parent_question_number}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const items = [];
  for (const group of groups.values()) {
    const first = group[0];
    const base = {
      parentNumber: first.parent_question_number,
      subject: first.subject,
      unit: first.unit,
      questionType: first.question_type,
    };
    if (first.question_type === 'mcq') {
      items.push({
        ...base,
        stimulus: first.stimulus,
        question_text: first.question_text,
        choices: first.choices,
        correct_answer: first.correct_answer,
        official_explanation: first.official_explanation,
        wrong_answer_explanations: first.wrong_answer_explanations,
      });
    } else if (first.question_type === 'leq') {
      items.push({
        ...base,
        question_text: first.question_text,
        correct_answer: first.correct_answer,
        official_explanation: first.official_explanation,
      });
    } else if (first.question_type === 'saq') {
      group.sort((a, b) => (a.sub_index || '').localeCompare(b.sub_index || ''));
      items.push({
        ...base,
        parts: group.map(p => ({
          sub_index: p.sub_index,
          question_text: p.question_text,
          correct_answer: p.correct_answer,
          official_explanation: p.official_explanation,
        })),
      });
    }
  }

  items.sort((a, b) => {
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
    return a.parentNumber - b.parentNumber;
  });

  const byType = items.reduce((acc, it) => {
    acc[it.questionType] = (acc[it.questionType] || 0) + 1;
    return acc;
  }, {});

  return { total: items.length, byType, items };
}

async function approveItem(sbUrl, sbKey, parentNumber, subject) {
  if (typeof parentNumber !== 'number' || !Number.isFinite(parentNumber)) {
    throw new Error('parentNumber must be a finite number');
  }
  if (typeof subject !== 'string' || !subject) throw new Error('subject required');

  const url = `${sbUrl}/rest/v1/question_bank`
    + `?subject=eq.${encodeURIComponent(subject)}`
    + `&parent_question_number=eq.${parentNumber}`
    + `&approved=eq.false&ai_generated=eq.true`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { ...sbHeaders(sbKey), Prefer: 'return=representation' },
    body: JSON.stringify({
      approved: true,
      reviewed_at: new Date().toISOString(),
      reviewed_by: 'NAP-ADMIN',
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase PATCH ${r.status}: ${detail}`);
  }
  const rows = await r.json().catch(() => []);
  return { approved: Array.isArray(rows) ? rows.length : 0 };
}

async function rejectItem(sbUrl, sbKey, parentNumber, subject) {
  if (typeof parentNumber !== 'number' || !Number.isFinite(parentNumber)) {
    throw new Error('parentNumber must be a finite number');
  }
  if (typeof subject !== 'string' || !subject) throw new Error('subject required');

  const url = `${sbUrl}/rest/v1/question_bank`
    + `?subject=eq.${encodeURIComponent(subject)}`
    + `&parent_question_number=eq.${parentNumber}`
    + `&approved=eq.false&ai_generated=eq.true`;
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { ...sbHeaders(sbKey), Prefer: 'return=representation' },
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase DELETE ${r.status}: ${detail}`);
  }
  const rows = await r.json().catch(() => []);
  return { deleted: Array.isArray(rows) ? rows.length : 0 };
}
