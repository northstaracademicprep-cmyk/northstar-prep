// ============================================================
// /api/weekly-report
// Per-student weekly progress report generator. Phase 1: generation
// + storage only — no email, no cron, no portal UI. Admin eyeballs
// the draft in weekly_reports before anything ships to families.
//
// POST { action, adminSecret, ... }
//   action: "generate" → build/refresh the report for one student.
//                        Body: { studentId, weekStart? (ISO date) }.
//                        Defaults weekStart to the most recent Sunday
//                        (UTC). Upserts on (student_id, week_start),
//                        status='draft'. Re-runs overwrite summary +
//                        snapshot but leave tutor_note alone.
//   action: "list"     → recent reports for a student.
//                        Body: { studentId, limit? }
//   action: "approve"  → flip status 'draft' → 'approved'.
//                        Body: { reportId }
//
// Gated by ADMIN_RESET_SECRET (same trust boundary as
// /api/reset-practice, /api/seed-batch, /api/review-queue).
//
// Practice Avg source: matches the portal's My Progress card exactly.
// That card blends legacy practice_attempts (one row per session,
// score/total) with vault student_attempts (one row per question_bank
// part, deduped by parent_question_number, score_percent). See
// portal.html:1849 and :1880–1913. Anything we report here must agree
// with what the student/parent already sees in the portal.
// ============================================================

const VALID_ACTIONS = new Set(['generate', 'list', 'approve']);
const GEMINI_MODEL  = 'gemini-2.5-flash-lite';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sbUrl  = process.env.SUPABASE_URL;
  const sbKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.GEMINI_API_KEY;
  const secret = process.env.ADMIN_RESET_SECRET;
  if (!sbUrl || !sbKey) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server' });
  if (!secret)          return res.status(503).json({ error: 'ADMIN_RESET_SECRET not configured on server — set it in Vercel project settings' });

  const { action, adminSecret } = req.body || {};
  if (typeof adminSecret !== 'string' || adminSecret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!VALID_ACTIONS.has(action)) {
    return res.status(400).json({ error: `Invalid action: ${action}` });
  }
  // Only generate needs Gemini — list/approve are pure Supabase.
  if (action === 'generate' && !apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  try {
    if (action === 'generate') return res.status(200).json(await generateReport(sbUrl, sbKey, apiKey, req.body));
    if (action === 'list')     return res.status(200).json(await listReports(sbUrl, sbKey, req.body));
    if (action === 'approve')  return res.status(200).json(await approveReport(sbUrl, sbKey, req.body));
  } catch (err) {
    return res.status(502).json({ error: `${action} failed`, detail: err.message });
  }
}

// ── Supabase helpers (kept local to this file to match the style of
//    /api/review-queue.js and /api/seed-batch.js) ───────────────────
function sbHeaders(sbKey) {
  return { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' };
}
async function sbGet(sbUrl, sbKey, path) {
  const r = await fetch(`${sbUrl}${path}`, { headers: sbHeaders(sbKey) });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase GET ${r.status}: ${detail.slice(0, 400)}`);
  }
  return r.json();
}

// ── Date helpers ─────────────────────────────────────────────────────
function isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isUuid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
function toIsoDate(d) { return d.toISOString().slice(0, 10); }
function mostRecentSundayUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay: Sun=0
  return d;
}
function weekWindowUtc(weekStartIso) {
  const start = weekStartIso
    ? new Date(`${weekStartIso}T00:00:00Z`)
    : mostRecentSundayUtc();
  const startIso = toIsoDate(start);
  const endDate  = new Date(start);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  return {
    startDate: startIso,
    endDate:   toIsoDate(endDate),
    startTs:   `${startIso}T00:00:00Z`,
    endTs:     `${toIsoDate(endDate)}T23:59:59.999Z`,
  };
}

// ── Generate ─────────────────────────────────────────────────────────
async function generateReport(sbUrl, sbKey, apiKey, body) {
  const { studentId, weekStart } = body || {};
  if (!isUuid(studentId)) throw new Error('studentId must be a UUID');
  if (weekStart != null && !isIsoDate(weekStart)) throw new Error('weekStart must be YYYY-MM-DD');

  const window = weekWindowUtc(weekStart);

  // 1) Student + config
  const studentRows = await sbGet(sbUrl, sbKey,
    `/rest/v1/students?select=id,name,parent_email,progress_config&id=eq.${studentId}`);
  const student = studentRows[0];
  if (!student) throw new Error('Student not found');
  const cfg = student.progress_config || {};

  // 2) Sessions in the week window
  const sessions = await sbGet(sbUrl, sbKey,
    `/rest/v1/sessions?select=session_date,duration_hours,topic,notes`
    + `&student_id=eq.${studentId}`
    + `&session_date=gte.${window.startDate}`
    + `&session_date=lte.${window.endDate}`
    + `&order=session_date.asc`);

  // 3a) Practice — weekly window
  const [legacyWeek, vaultWeek] = await Promise.all([
    sbGet(sbUrl, sbKey,
      `/rest/v1/practice_attempts?select=score,total,attempted_at`
      + `&student_id=eq.${studentId}`
      + `&attempted_at=gte.${encodeURIComponent(window.startTs)}`
      + `&attempted_at=lte.${encodeURIComponent(window.endTs)}`),
    sbGet(sbUrl, sbKey,
      `/rest/v1/student_attempts?select=id,is_correct,score_percent,attempted_at,question_id,question_bank!inner(parent_question_number,question_type,unit)`
      + `&student_id=eq.${studentId}`
      + `&attempted_at=gte.${encodeURIComponent(window.startTs)}`
      + `&attempted_at=lte.${encodeURIComponent(window.endTs)}`),
  ]);

  // 3b) Practice — all-time (capped via order/limit for safety)
  const [legacyAll, vaultAll] = await Promise.all([
    sbGet(sbUrl, sbKey,
      `/rest/v1/practice_attempts?select=score,total,attempted_at`
      + `&student_id=eq.${studentId}`
      + `&order=attempted_at.desc&limit=2000`),
    sbGet(sbUrl, sbKey,
      `/rest/v1/student_attempts?select=id,is_correct,score_percent,attempted_at,question_id,question_bank!inner(parent_question_number,question_type,unit)`
      + `&student_id=eq.${studentId}`
      + `&order=attempted_at.desc&limit=2000`),
  ]);

  const practiceWeek    = computePracticeAvg(legacyWeek, vaultWeek);
  const practiceOverall = computePracticeAvg(legacyAll,  vaultAll);

  // 4) Homework — overall graded avg, same formula the portal uses
  const homework = await sbGet(sbUrl, sbKey,
    `/rest/v1/homework?select=score,max_score,status,due_date&student_id=eq.${studentId}`);
  const gradedHw  = homework.filter(h => h.status === 'graded' && h.score != null);
  const homeworkAvg = gradedHw.length
    ? Math.round(gradedHw.reduce((s, h) => s + Number(h.score), 0) / gradedHw.length)
    : null;

  // 5) Prior snapshot (most recent strictly before this week)
  const priorRows = await sbGet(sbUrl, sbKey,
    `/rest/v1/weekly_reports?select=week_start,snapshot`
    + `&student_id=eq.${studentId}`
    + `&week_start=lt.${window.startDate}`
    + `&order=week_start.desc&limit=1`);
  const priorUnits = (priorRows[0]?.snapshot?.units || []).reduce((m, u) => {
    m[u.name] = u.score;
    return m;
  }, {});

  // 6) Build snapshot
  const units = (cfg.units || []).map(u => {
    const prev = priorUnits[u.name];
    return {
      name:  u.name || '',
      score: typeof u.score === 'number' ? u.score : null,
      prevScore: typeof prev === 'number' ? prev : null,
      delta: (typeof u.score === 'number' && typeof prev === 'number') ? u.score - prev : null,
    };
  });

  const weekly = cfg.weeklyProgress || [];
  const gradeNow   = weekly.length ? Number(weekly[weekly.length - 1].grade) : (cfg.startingGrade ?? null);
  const gradeStart = typeof cfg.startingGrade  === 'number' ? cfg.startingGrade  : null;
  const gradeTarget= typeof cfg.targetGradeNum === 'number' ? cfg.targetGradeNum : null;
  const fraction   = (gradeStart != null && gradeTarget != null && gradeTarget !== gradeStart && gradeNow != null)
    ? Math.max(0, Math.min(1, (gradeNow - gradeStart) / (gradeTarget - gradeStart)))
    : null;

  const programWeeks = typeof cfg.programWeeks === 'number' && cfg.programWeeks > 0 ? cfg.programWeeks : null;
  // weekIndex: 1-based count of weekly_progress points + this week if any practice/sessions exist.
  // Cheap, deterministic, doesn't require a program-start-date field that doesn't exist.
  const priorWeekIndex = (await sbGet(sbUrl, sbKey,
    `/rest/v1/weekly_reports?select=id&student_id=eq.${studentId}&week_start=lte.${window.startDate}`)).length;
  const weekIndex = Math.max(1, priorWeekIndex || 1);

  const phase = (cfg.phases || []).find(p => p.num === cfg.currentPhase) || null;

  const sessionList = sessions.map(s => ({
    date: s.session_date,
    durationHours: s.duration_hours,
    topic: (s.topic || '').trim(),
    notes: (s.notes || '').trim(),
  }));
  const notesPresent = sessionList.some(s => s.notes.length > 0);

  const snapshot = {
    weekStart: window.startDate,
    weekEnd:   window.endDate,
    programWeeks,
    weekIndex,
    climb: { gradeStart, gradeTarget, gradeNow, fraction },
    homeworkAvg,
    practiceAvg: { week: practiceWeek, overall: practiceOverall },
    units,
    weaknesses: cfg.weaknesses || [],
    phase: phase ? { num: phase.num, name: phase.name, status: phase.status, description: phase.description } : null,
    sessions: sessionList,
    sessionCount: sessionList.length,
    notesPresent,
  };

  // 7) Gemini summary (family-facing)
  const subject = cfg.subject || 'their program';
  const summary = await callGeminiForSummary(apiKey, {
    studentName: student.name,
    subject,
    snapshot,
  });

  // 8) Upsert — Prefer: resolution=merge-duplicates against the
  // (student_id, week_start) unique key. PATCH-like behavior: existing
  // rows get summary/snapshot/status='draft' overwritten on rerun.
  // tutor_note is intentionally NOT included so a manually-edited note
  // survives regeneration.
  const upsertBody = [{
    student_id: studentId,
    week_start: window.startDate,
    week_end:   window.endDate,
    snapshot,
    summary,
    status: 'draft',
  }];
  const upsertRes = await fetch(`${sbUrl}/rest/v1/weekly_reports?on_conflict=student_id,week_start`, {
    method: 'POST',
    headers: {
      ...sbHeaders(sbKey),
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(upsertBody),
  });
  if (!upsertRes.ok) {
    const detail = await upsertRes.text().catch(() => '');
    throw new Error(`Supabase UPSERT ${upsertRes.status}: ${detail.slice(0, 400)}`);
  }
  const [report] = await upsertRes.json();

  console.log(`[weekly-report] student=${studentId} week=${window.startDate} sessions=${sessionList.length} notes=${notesPresent} practiceWeek=${practiceWeek} practiceOverall=${practiceOverall}`);

  return { report, regeneratable: !notesPresent };
}

// ── Practice-Avg formula — mirrors portal.html:1849 + :1910–1913 ────
function dedupeStudentAttemptsByParent(rows) {
  const groups = new Map();
  for (const a of rows) {
    const pq = a.question_bank?.parent_question_number;
    const key = pq != null ? `p:${pq}` : `r:${a.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  return [...groups.values()].map(parts => {
    const scoreVals = parts.map(p => p.score_percent).filter(v => typeof v === 'number');
    return {
      score_percent: scoreVals.length ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) : null,
      parts: parts.length,
    };
  });
}

function computePracticeAvg(legacyRows, vaultRows) {
  const legacyScores = legacyRows.map(a => Math.round((a.score / Math.max(a.total, 1)) * 100));
  const vaultScores  = dedupeStudentAttemptsByParent(vaultRows)
    .map(g => g.score_percent)
    .filter(v => typeof v === 'number');
  const all = [...legacyScores, ...vaultScores];
  return all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;
}

// ── Gemini ───────────────────────────────────────────────────────────
async function callGeminiForSummary(apiKey, { studentName, subject, snapshot }) {
  const prompt = buildSummaryPrompt(studentName, subject, snapshot);
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Plain text out (no responseMimeType=application/json — this is a
        // paragraph, not structured data). Low-ish temp because we are
        // strictly forbidden from inventing facts.
        generationConfig: { temperature: 0.55 },
      }),
    }
  );
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Gemini API error ${r.status}: ${detail.slice(0, 400)}`);
  }
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.trim();
}

function buildSummaryPrompt(studentName, subject, snapshot) {
  const firstName = (studentName || 'the student').split(' ')[0];
  const sessions = snapshot.sessions || [];
  const sessionBlock = sessions.length
    ? sessions.map((s, i) =>
        `Session ${i + 1} (${s.date}, ${s.durationHours || '?'} hr):\n  Topic: ${s.topic || '(none)'}\n  Notes: ${s.notes || '(no notes logged)'}`
      ).join('\n\n')
    : '(no sessions this week)';

  const climbStr = snapshot.climb?.fraction != null
    ? `${Math.round(snapshot.climb.fraction * 100)}% of the way from ${snapshot.climb.gradeStart}% → ${snapshot.climb.gradeTarget}%`
    : '(climb data not configured)';
  const phaseStr = snapshot.phase
    ? `Phase ${snapshot.phase.num} — ${snapshot.phase.name}${snapshot.phase.description ? `: ${snapshot.phase.description}` : ''}`
    : '(no current phase configured)';
  const weakStr = (snapshot.weaknesses || []).map(w => w.area || w).filter(Boolean).join(', ') || '(none recorded)';

  // notesPresent gate: when there are no logged notes, the model is
  // boxed into a short forward-looking line tied to the configured
  // phase/topics only. The caller flags `regeneratable=true` in that
  // case so this can be re-run later without dropping a manual edit.
  const guardrails = snapshot.notesPresent
    ? `RULES (non-negotiable):
- Expand on the MEANING and SIGNIFICANCE of what the session notes describe — why this work matters for the parent's understanding of their child's progress.
- DO NOT invent any activity, exercise, score, grade, milestone, or behavioral observation that is not explicitly present in the session notes or the data block. If the notes are vague, keep your sentences vague.
- DO NOT speculate about how ${firstName} felt, performed, or struggled unless the notes say so.
- Cite at most one or two concrete numbers from the data block (e.g. practice avg, week N of M, climb%) and only if they help the parent. Never invent numbers.
- 120–180 words, single paragraph, warm but not gushing, no greeting or sign-off.`
    : `RULES (non-negotiable — NO SESSION NOTES WERE LOGGED THIS WEEK):
- DO NOT describe any activity, outcome, score, behavior, or observation. There is no source material for that.
- Write ONE short paragraph (3–5 sentences max) that is purely forward-looking, grounded in the current phase and the configured plan.
- Use phrasing like "the focus this week is..." or "the plan continues to center on...". Do NOT use the past tense to describe work done.
- No greeting, no sign-off. End with one sentence acknowledging the family will get a fuller picture once this week's sessions are logged.`;

  return `You are writing a brief weekly progress update for the parent of a Northstar Academic Prep student. The student is ${studentName}, working on ${subject}.

CONTEXT (numerical):
- Week: ${snapshot.weekStart} to ${snapshot.weekEnd} (${snapshot.programWeeks ? `week ${snapshot.weekIndex} of ${snapshot.programWeeks}` : 'no program length configured'})
- Climb: ${climbStr}
- Current grade: ${snapshot.climb?.gradeNow != null ? snapshot.climb.gradeNow + '%' : 'unknown'}
- Practice avg this week: ${snapshot.practiceAvg.week != null ? snapshot.practiceAvg.week + '%' : 'no practice logged this week'}
- Practice avg overall: ${snapshot.practiceAvg.overall != null ? snapshot.practiceAvg.overall + '%' : 'none'}
- Homework avg: ${snapshot.homeworkAvg != null ? snapshot.homeworkAvg + '%' : 'none'}
- Current phase: ${phaseStr}
- Known weak areas: ${weakStr}

THIS WEEK'S TUTORING SESSIONS:
${sessionBlock}

${guardrails}

Output: the paragraph ONLY, no preamble, no headings.`;
}

// ── List ─────────────────────────────────────────────────────────────
async function listReports(sbUrl, sbKey, body) {
  const { studentId, limit } = body || {};
  if (!isUuid(studentId)) throw new Error('studentId must be a UUID');
  const cap = Math.max(1, Math.min(50, Number(limit) || 12));
  const rows = await sbGet(sbUrl, sbKey,
    `/rest/v1/weekly_reports?select=*`
    + `&student_id=eq.${studentId}`
    + `&order=week_start.desc&limit=${cap}`);
  return { reports: rows };
}

// ── Approve ──────────────────────────────────────────────────────────
async function approveReport(sbUrl, sbKey, body) {
  const { reportId } = body || {};
  if (!isUuid(reportId)) throw new Error('reportId must be a UUID');

  // Scoped to status=eq.draft so we can't accidentally re-flag an
  // already-sent or already-approved row.
  const r = await fetch(`${sbUrl}/rest/v1/weekly_reports?id=eq.${reportId}&status=eq.draft`, {
    method: 'PATCH',
    headers: { ...sbHeaders(sbKey), Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'approved' }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase PATCH ${r.status}: ${detail.slice(0, 400)}`);
  }
  const rows = await r.json().catch(() => []);
  if (!rows.length) {
    return { approved: 0, message: 'No draft row matched — already approved/sent, or wrong id.' };
  }
  return { approved: rows.length, report: rows[0] };
}
