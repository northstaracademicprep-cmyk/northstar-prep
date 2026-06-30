// ============================================================
// /api/weekly-report
// Per-student weekly progress report generator. Phase 1: generation
// + storage only — no email, no cron, no portal UI. Admin eyeballs
// the draft in weekly_reports before anything ships to families.
//
// POST { action, ... }
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
  if (!sbUrl || !sbKey) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server' });

  const { action } = req.body || {};
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
async function sbPatch(sbUrl, sbKey, path, body) {
  const r = await fetch(`${sbUrl}${path}`, {
    method: 'PATCH',
    headers: sbHeaders(sbKey),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase PATCH ${r.status}: ${detail.slice(0, 400)}`);
  }
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
// Exported so /api/cron-weekly-reports can drive the same flow on a
// schedule without duplicating the Gemini/snapshot/upsert/climb-sync
// logic. Vercel only treats the `default` export as the route handler;
// named exports are fine to add.
export async function generateReport(sbUrl, sbKey, apiKey, body) {
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
  // weekIndex: count of STRICTLY-prior reports + 1. Using `lt` (not `lte`)
  // excludes the current week's row, so the result is identical on first-
  // generate vs regenerate of the same week (1, 1) and correctly increments
  // for subsequent weeks (2, 3, …). The label "Week N" written into
  // progress_config.weeklyProgress relies on this being unique per week.
  const priorRowCount = (await sbGet(sbUrl, sbKey,
    `/rest/v1/weekly_reports?select=id&student_id=eq.${studentId}&week_start=lt.${window.startDate}`)).length;
  const weekIndex = priorRowCount + 1;

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

  // 7) Gemini projection — strict JSON: weekGrade + skillGains + summary.
  // These are PROJECTIONS (estimates from brief notes + configured plan),
  // not measured scores. Sanitization clamps weekGrade so it never exceeds
  // target and never regresses below the current grade.
  const subject = cfg.subject || 'their program';
  const projection = await callGeminiForProjection(apiKey, {
    studentName: student.name,
    subject,
    snapshot,
  });
  const summary = projection.summary;
  snapshot.skillGains = projection.skillGains;
  // Echo weekGrade into the snapshot so downstream consumers (the approval
  // email in particular) can read it straight off the report row without
  // back-deriving from progress_config.weeklyProgress, which can drift if
  // a later week has been generated before this one is approved.
  snapshot.weekGrade  = projection.weekGrade;

  // 7b) Sync progress_config so the Progress + Game Plan visuals stay
  // consistent week to week:
  //   - weeklyProgress: append/replace this week's {label,grade} so the
  //     Game Plan trajectory line grows by one realistic point per week.
  //     Idempotent — re-running the same week REPLACES the same label
  //     instead of duplicating.
  //   - currentGrade: bump to weekGrade so the Climb card's "you are here"
  //     marker (which reads cfg.currentGrade) moves in lockstep with the
  //     trajectory. Without this, the climb stays frozen at the start while
  //     the line climbs — visually inconsistent.
  // Wrapped in try/catch so a cfg-PATCH failure doesn't block the report
  // upsert below.
  if (typeof projection.weekGrade === 'number') {
    const wp = Array.isArray(cfg.weeklyProgress) ? [...cfg.weeklyProgress] : [];
    const label = `Week ${weekIndex}`;
    const i = wp.findIndex(p => p && p.label === label);
    const entry = { label, grade: projection.weekGrade };
    if (i >= 0) wp[i] = entry; else wp.push(entry);
    const newCfg = { ...cfg, weeklyProgress: wp, currentGrade: projection.weekGrade };
    try {
      await sbPatch(sbUrl, sbKey,
        `/rest/v1/students?id=eq.${studentId}`,
        { progress_config: newCfg });
    } catch (e) {
      console.warn(`[weekly-report] cfg PATCH failed: ${e.message}`);
    }
  }

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
// Single call returns STRICT JSON: weekGrade + skillGains + summary.
// responseSchema constrains shape; sanitizeProjection clamps values so
// projections can't escape [currentGrade, targetGrade] or invent oversized
// per-topic deltas.
async function callGeminiForProjection(apiKey, { studentName, subject, snapshot }) {
  const prompt = buildProjectionPrompt(studentName, subject, snapshot);
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              weekGrade:  { type: 'NUMBER' },
              skillGains: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    topic: { type: 'STRING' },
                    delta: { type: 'NUMBER' },
                  },
                  required: ['topic', 'delta'],
                },
              },
              summary: { type: 'STRING' },
            },
            required: ['weekGrade', 'skillGains', 'summary'],
          },
        },
      }),
    }
  );
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Gemini API error ${r.status}: ${detail.slice(0, 400)}`);
  }
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`); }
  return sanitizeProjection(parsed, snapshot);
}

// Trust the schema for shape; never trust raw values. weekGrade is clamped
// to [currentGrade, targetGrade] so the climb-sync below can't push the
// student's currentGrade backwards or past the goal. skillGains is capped
// at 4 entries with per-entry delta in [0, 30].
function sanitizeProjection(p, snapshot) {
  const target = snapshot.climb?.gradeTarget;
  const now    = snapshot.climb?.gradeNow;

  let weekGrade = Number(p?.weekGrade);
  if (!Number.isFinite(weekGrade)) weekGrade = typeof now === 'number' ? now : null;
  if (typeof weekGrade === 'number') {
    if (typeof now === 'number'    && weekGrade < now)    weekGrade = now;
    if (typeof target === 'number' && weekGrade > target) weekGrade = target;
    weekGrade = Math.round(weekGrade);
  }

  const rawGains = Array.isArray(p?.skillGains) ? p.skillGains : [];
  const skillGains = rawGains
    .filter(g => g && typeof g.topic === 'string' && g.topic.trim() && Number.isFinite(Number(g.delta)))
    .slice(0, 4)
    .map(g => ({
      topic: g.topic.trim().slice(0, 60),
      delta: Math.max(0, Math.min(30, Math.round(Number(g.delta)))),
    }));

  const summary = typeof p?.summary === 'string' ? p.summary.trim() : '';
  return { weekGrade, skillGains, summary };
}

function buildProjectionPrompt(studentName, subject, snapshot) {
  const firstName = (studentName || 'the student').split(' ')[0];
  const sessions = snapshot.sessions || [];
  const sessionBlock = sessions.length
    ? sessions.map((s, i) =>
        `Session ${i + 1} (${s.date}, ${s.durationHours || '?'} hr):\n  Topic: ${s.topic || '(none)'}\n  Notes: ${s.notes || '(no notes logged)'}`
      ).join('\n\n')
    : '(no sessions this week)';

  const startG  = snapshot.climb?.gradeStart;
  const targetG = snapshot.climb?.gradeTarget;
  const nowG    = snapshot.climb?.gradeNow;
  const phaseStr = snapshot.phase
    ? `Phase ${snapshot.phase.num} — ${snapshot.phase.name}${snapshot.phase.description ? `: ${snapshot.phase.description}` : ''}`
    : '(no current phase configured)';
  const weakStr = (snapshot.weaknesses || []).map(w => w.area || w).filter(Boolean).join(', ') || '(none recorded)';
  const focusTopics = (snapshot.units || []).map(u => u.name).filter(Boolean).join(', ') || '(units not configured)';

  return `You are projecting weekly academic progress for the parent of a Northstar Academic Prep student. The student is ${studentName}, working on ${subject}.

These are ESTIMATED PROJECTIONS, not measured results. Frame the summary in projection language ("projected", "expected", "on pace for"). Never claim a number is a tested or graded score.

THIS WEEK CONTEXT
- Week: ${snapshot.weekStart} to ${snapshot.weekEnd}
- Week index: ${snapshot.weekIndex}${snapshot.programWeeks ? ' of ' + snapshot.programWeeks : ''}
- Starting grade: ${startG != null ? startG + '%' : 'unknown'}
- Current grade (most recent estimate): ${nowG != null ? nowG + '%' : 'unknown'}
- Target grade: ${targetG != null ? targetG + '%' : 'unknown'}
- Current phase: ${phaseStr}
- Configured focus topics (units): ${focusTopics}
- Known weak areas: ${weakStr}

THIS WEEK'S BRIEF TUTORING NOTES
${sessionBlock}

RULES (non-negotiable):
- weekGrade: a SMALL realistic step from the current grade toward the target. Typical step 1–5 points when work happened. Never above the target. Never below the current grade. If there are truly no sessions and no notes, weekGrade equals the current grade (flat).
- skillGains: 2–4 entries when sessions were logged; empty array when no sessions. Each topic MUST be drawn from this week's notes OR the configured focus topics — do not invent unrelated areas. Each delta is a modest projected gain in the 5–25 range, varied across entries.
- summary: ONE parent-facing paragraph, 120–180 words, plain language, warm but not gushing. Use projection phrasing — "projected to climb", "expected gain", "on pace for". Do NOT state numeric percentages other than those already in this JSON. Do NOT claim ${firstName} took a test or got a measured score. Describe direction and meaning, not measurement. No greeting, no sign-off.

Return ONLY the JSON object. No preamble, no markdown fences.`;
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
// Exported so /api/cron-weekly-reports can auto-promote drafts created
// on the Sunday-night cron run without re-implementing the PATCH +
// Resend email + email_sent_at write. Named export only — the route
// handler is still the default export.
export async function approveReport(sbUrl, sbKey, body) {
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

  // Send the parent-facing report email via Resend. Best-effort: the
  // PATCH has already committed status='approved' regardless of what
  // Resend does, so a failure here MUST NOT throw — we just log and
  // return success. sendApprovalEmail also skips itself if
  // email_sent_at is already populated (belt-and-suspenders against
  // hand-edited status flips).
  try {
    await sendApprovalEmail(sbUrl, sbKey, rows[0]);
  } catch (e) {
    console.warn(`[weekly-report] approval email failed for report ${rows[0].id}: ${e.message}`);
  }

  return { approved: rows.length, report: rows[0] };
}

// ── Resend email ─────────────────────────────────────────────────────
// Fired by approveReport on the draft→approved transition. Single
// parent-facing message branded navy/gold, summary + skill-boost rows
// + projected weekly grade + CTA back to the portal. Writes
// email_sent_at on success so re-running approve (or a hand-flipped
// row) can't double-send.
async function sendApprovalEmail(sbUrl, sbKey, report) {
  if (report.email_sent_at) {
    console.log(`[weekly-report] report ${report.id} already emailed at ${report.email_sent_at} — skipping`);
    return;
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn('[weekly-report] RESEND_API_KEY not configured — skipping email send');
    return;
  }

  // Look up parent_email + display name from the student row referenced
  // by the report. parent_email is the column added in
  // 20260601120000_weekly_reports.sql alongside the table itself.
  const studentRows = await sbGet(sbUrl, sbKey,
    `/rest/v1/students?select=id,name,parent_email&id=eq.${report.student_id}`);
  const student = studentRows[0];
  if (!student) {
    console.warn(`[weekly-report] student ${report.student_id} not found — skipping email`);
    return;
  }
  if (!student.parent_email) {
    console.warn(`[weekly-report] no parent_email set for ${student.name} (${student.id}) — skipping email`);
    return;
  }

  const snapshot   = report.snapshot || {};
  const weekN      = snapshot.weekIndex;
  const weekGrade  = typeof snapshot.weekGrade === 'number' ? snapshot.weekGrade : null;
  const skillGains = Array.isArray(snapshot.skillGains) ? snapshot.skillGains : [];
  const summary    = report.summary || '';

  const subjectWeek = weekN != null ? `Week ${weekN} ` : '';
  const subject = `${student.name} — ${subjectWeek}Progress Report`;
  const html = buildApprovalEmailHtml({
    studentName: student.name,
    weekN, weekGrade, skillGains, summary,
  });

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Northstar Academic Prep <reports@send.northstaracademicprep.com>',
      to: student.parent_email,
      reply_to: 'sahibsidhu190@gmail.com',
      subject,
      html,
    }),
  });
  if (!sendRes.ok) {
    const detail = await sendRes.text().catch(() => '');
    throw new Error(`Resend ${sendRes.status}: ${detail.slice(0, 400)}`);
  }

  // Mark sent. Failure to write the timestamp doesn't unsend the email,
  // so just warn — caller (approveReport) catches our throws either way.
  try {
    await sbPatch(sbUrl, sbKey,
      `/rest/v1/weekly_reports?id=eq.${report.id}`,
      { email_sent_at: new Date().toISOString() });
  } catch (e) {
    console.warn(`[weekly-report] email sent but could not write email_sent_at: ${e.message}`);
  }
  console.log(`[weekly-report] emailed report ${report.id} to ${student.parent_email}`);
}

function buildApprovalEmailHtml({ studentName, weekN, weekGrade, skillGains, summary }) {
  // Inline styles only — Gmail/Outlook strip <style> blocks. Colors are
  // the same navy/gold per the spec; the portal uses slightly different
  // shades but these are the on-brand "email-safe" pair.
  const NAVY = '#1B2A4A';
  const GOLD = '#C9A84C';
  const firstName = (studentName || 'Your student').split(' ')[0];
  const safeSummary = escapeHtmlEmail(summary).replace(/\n+/g, '<br><br>');
  const gainsRows = skillGains
    .filter(g => g && g.topic && Number.isFinite(Number(g.delta)) && g.delta > 0)
    .map(g => {
      const pct = Math.max(0, Math.min(30, Math.round(Number(g.delta))));
      return `<tr>
        <td style="padding:10px 14px;font-size:14px;color:${NAVY};font-weight:600;border-bottom:1px solid #eef0f4">${escapeHtmlEmail(g.topic)}</td>
        <td style="padding:10px 14px;font-size:14px;color:${GOLD};font-weight:800;text-align:right;border-bottom:1px solid #eef0f4">+${pct}%</td>
      </tr>`;
    }).join('');

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(27,42,74,.08)">
        <tr>
          <td style="background:${NAVY};padding:28px 32px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${GOLD};margin-bottom:6px">Northstar Academic Prep</div>
            <div style="font-size:22px;font-weight:800;line-height:1.3">${escapeHtmlEmail(firstName)}'s Week ${escapeHtmlEmail(weekN ?? '')} Progress Report</div>
          </td>
        </tr>
        ${typeof weekGrade === 'number' ? `<tr>
          <td style="padding:24px 32px 6px">
            <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;margin-bottom:6px">Projected grade this week</div>
            <div style="font-size:38px;font-weight:800;color:${NAVY};line-height:1">${weekGrade}%</div>
          </td>
        </tr>` : ''}
        <tr>
          <td style="padding:18px 32px 8px;font-size:15px;line-height:1.7;color:#1f2937">
            ${safeSummary}
          </td>
        </tr>
        ${gainsRows ? `<tr>
          <td style="padding:8px 32px 16px">
            <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;margin:8px 0 8px">Projected skill boost</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafbfc;border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate">
              ${gainsRows}
            </table>
          </td>
        </tr>` : ''}
        <tr>
          <td align="center" style="padding:18px 32px 32px">
            <a href="https://portal.northstaracademicprep.com" style="display:inline-block;background:${GOLD};color:${NAVY};text-decoration:none;font-weight:800;font-size:13px;letter-spacing:.08em;text-transform:uppercase;padding:14px 28px;border-radius:9px">Open Student Portal →</a>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #eef0f4;font-size:12px;color:#6b7280;line-height:1.6">
            These figures are projections from this week's session notes and ${escapeHtmlEmail(firstName)}'s plan — not measured test scores. Reply to this email to reach Northstar directly.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtmlEmail(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
