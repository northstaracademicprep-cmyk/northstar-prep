// ============================================================
// /api/cron-weekly-reports
// Sunday 16:00 UTC cron (configured in vercel.json) that auto-
// generates draft weekly reports for every active student who
//   (a) had at least one session in the past 7 days, AND
//   (b) doesn't already have a draft- or approved-status row
//       for the just-ended week.
// Never auto-approves — the admin still has to promote
// draft → approved via the Weekly Reports admin tool before
// anything surfaces on a student's Progress tab. This matches
// the trust boundary already enforced by /api/weekly-report.
//
// Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`
// when CRON_SECRET is set in project env. Any other caller
// (manual curl without the header) gets 401. CRON_SECRET is
// SEPARATE from ADMIN_RESET_SECRET — this endpoint is only
// callable by the scheduled cron, not the admin portal UI.
//
// Returns { generated, skipped, weekStart }. `skipped` lumps
// together "no recent sessions", "row already exists", and
// per-student generate errors — granular detail lives in the
// Vercel function logs (one console.log per branch).
//
// Reuses generateReport() from /api/weekly-report.js so the
// Gemini call, snapshot build, weekly_reports upsert, and
// progress_config climb-sync stay in one place.
// ============================================================

import { generateReport } from './weekly-report.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  // Vercel cron defaults to GET; allow POST too for manual triggering.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(503).json({ error: 'CRON_SECRET not configured on server' });
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sbUrl  = process.env.SUPABASE_URL;
  const sbKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!sbUrl || !sbKey) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server' });
  if (!apiKey)          return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });

  try {
    // Target week = the one that just ended.
    // Cron schedule is `0 16 * * 0` (Sunday 16:00 UTC); on that firing
    // previousCompletedSundayUtc(now) is the previous Sunday — i.e. the
    // start of the seven days we're reporting on. On any other day this
    // still resolves to the most recent Sunday strictly before today.
    const weekStartDate = previousCompletedSundayUtc(new Date());
    const weekStartIso  = toIsoDate(weekStartDate);

    // "Past 7 days" of sessions, evaluated as a sliding window relative
    // to NOW. On the scheduled Sunday firing this aligns naturally with
    // the report's week_start (previous Sunday).
    const sevenDaysAgoIso = toIsoDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    // 1) Active students (mirrors the filter used by the admin Weekly
    //    Reports tool in portal.html).
    const students = await sbGet(sbUrl, sbKey,
      `/rest/v1/students?select=id,name,status&status=neq.completed&order=name.asc`);

    // 2) Students with at least one session in the past 7 days. Single
    //    batched query so we don't do N round-trips against sessions.
    //    No `approved` filter — matches generateReport, which counts
    //    unapproved sessions in its snapshot too.
    const recentSessions = await sbGet(sbUrl, sbKey,
      `/rest/v1/sessions?select=student_id&session_date=gte.${sevenDaysAgoIso}`);
    const studentsWithSessions = new Set(recentSessions.map(s => s.student_id));

    // 3) Students who already have a draft or approved row for this
    //    week. Skip them so the cron never overwrites an existing
    //    summary — only the admin's explicit Regenerate should do that.
    //    `status=in.(draft,approved)` is a literal of the spec: any
    //    future status (e.g. 'sent') is NOT a skip reason on purpose.
    const existing = await sbGet(sbUrl, sbKey,
      `/rest/v1/weekly_reports?select=student_id&week_start=eq.${weekStartIso}&status=in.(draft,approved)`);
    const studentsWithRow = new Set(existing.map(r => r.student_id));

    let generated = 0;
    let skipped   = 0;
    for (const s of students) {
      if (!studentsWithSessions.has(s.id)) {
        console.log(`[cron-weekly-reports] skip ${s.id} (${s.name}) — no sessions in past 7 days`);
        skipped++;
        continue;
      }
      if (studentsWithRow.has(s.id)) {
        console.log(`[cron-weekly-reports] skip ${s.id} (${s.name}) — draft/approved row already exists for ${weekStartIso}`);
        skipped++;
        continue;
      }
      try {
        await generateReport(sbUrl, sbKey, apiKey, {
          studentId: s.id,
          weekStart: weekStartIso,
        });
        generated++;
      } catch (e) {
        // One bad student shouldn't stop the rest of the run — log and
        // count as skipped so the response totals stay accurate.
        console.warn(`[cron-weekly-reports] generate failed for ${s.id} (${s.name}): ${e.message}`);
        skipped++;
      }
    }

    console.log(`[cron-weekly-reports] week=${weekStartIso} generated=${generated} skipped=${skipped} total=${students.length}`);
    return res.status(200).json({ generated, skipped, weekStart: weekStartIso });
  } catch (err) {
    console.error(`[cron-weekly-reports] fatal: ${err.message}`);
    return res.status(502).json({ error: 'Cron failed', detail: err.message });
  }
}

// ── Supabase helpers (inlined to match the per-file style of
//    /api/review-queue.js, /api/seed-batch.js, /api/weekly-report.js) ──
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
function toIsoDate(d) { return d.toISOString().slice(0, 10); }

// Start of the week that just ENDED (Sunday-anchored, UTC).
//   Sunday today:  rewind 7 days → previous Sunday (start of last week).
//   Any other day: rewind to the most recent Sunday strictly before today.
// The cron fires Sunday 16:00 UTC so the Sunday branch is the live path;
// the other-day branch only matters for manual reruns mid-week.
function previousCompletedSundayUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // Sun = 0
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 7 : dow));
  return d;
}
