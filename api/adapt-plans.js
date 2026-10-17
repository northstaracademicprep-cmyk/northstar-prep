// ============================================================
// /api/adapt-plans
// Adaptive game plans. Re-reads each active student's real activity
// (graded homework, practice tests, hours used) and updates the
// progress_config the portal renders: unit scores, current grade,
// weaknesses, and the active phase.
//
// Idempotent: results are always computed from a stored baseline, so
// running it daily never compounds. Every change is written to
// progress_config.adaptive.log so the tutor and Sahib can see why.
//
// Runs daily from /api/cron-session-reminders (isolated in try/catch).
// Manual run: GET /api/adapt-plans?dry=1  (Bearer CRON_SECRET)
// ============================================================

const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'when', 'than', 'her', 'his', 'their', 'overall', 'basic', 'rules', 'practice', 'skills', 'work', 'performance']);
const stems = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)).map(w => w.slice(0, 5));

/** Pure: returns { cfg, changes[] } or null when there is nothing to adapt. */
export function computeAdaptation(student, homework, tests, now = new Date()) {
  const cfg0 = student.progress_config;
  if (!cfg0 || typeof cfg0 !== 'object' || !Array.isArray(cfg0.units)) return null;
  const cfg = JSON.parse(JSON.stringify(cfg0));
  const changes = [];

  const graded = (homework || []).filter(h => h.score != null && Number(h.max_score) > 0)
    .sort((a, b) => new Date(b.graded_at || b.created_at) - new Date(a.graded_at || a.created_at)).slice(0, 8);
  const hwPct = graded.length ? graded.reduce((s, h) => s + Number(h.score) / Number(h.max_score) * 100, 0) / graded.length : null;
  const mcq = (tests || []).filter(t => t.total > 0);
  const tCorrect = mcq.reduce((s, t) => s + t.correct, 0), tTotal = mcq.reduce((s, t) => s + t.total, 0);
  const testPct = tTotal ? tCorrect / tTotal * 100 : null;
  const dataPoints = graded.length + mcq.length;
  const hoursUsed = Number(student.hours_used) || 0;
  if (!dataPoints && !hoursUsed) return null;

  // Baseline is captured once, before the first adaptation
  cfg.adaptive = cfg.adaptive || {};
  if (!cfg.adaptive.baseline) {
    cfg.adaptive.baseline = {
      units: cfg.units.map(u => ({ name: u.name, score: u.score })),
      startingGrade: cfg.startingGrade ?? null,
      capturedAt: now.toISOString()
    };
  }
  const base = cfg.adaptive.baseline;
  const baseScore = name => (base.units.find(b => b.name === name) || {}).score;

  // 1) Unit scores: blend baseline with observed practice-test accuracy per matching unit
  const assigned = (homework || []).filter(h => h.due_date && new Date(h.due_date) <= now);
  const completion = assigned.length >= 2 ? assigned.filter(h => h.status && h.status !== 'pending').length / assigned.length * 100 : null;
  cfg.units.forEach(u => {
    const b = baseScore(u.name); if (typeof b !== 'number') return;
    let observed = null, n = 0;
    if (/homework/i.test(u.name) && completion != null) { observed = completion; n = assigned.length * 3; }
    else {
      const ks = stems(u.name); let c = 0, t = 0;
      if (ks.length) mcq.forEach(tt => (tt.unit_breakdown || []).forEach(ub => {
        const us = stems(ub.unit); if (ks.some(k => us.includes(k))) { c += ub.correct; t += ub.total; }
      }));
      if (t >= 4) { observed = c / t * 100; n = t; }
    }
    if (observed == null) return;
    const w = Math.min(0.6, n / 30);
    const next = Math.max(0, Math.min(100, Math.round(b * (1 - w) + observed * w)));
    if (next !== u.score) { changes.push(`${u.name}: ${u.score} to ${next}`); u.score = next; }
  });

  // 2) Current grade: blend starting grade with recent real performance
  const perfParts = [hwPct, testPct].filter(v => v != null);
  const perf = perfParts.length ? perfParts.reduce((a, b) => a + b, 0) / perfParts.length : null;
  if (perf != null && typeof base.startingGrade === 'number') {
    const w = Math.min(0.7, dataPoints / 10);
    const cur = Math.round(base.startingGrade * (1 - w) + perf * w);
    if (cur !== cfg.currentGrade) { changes.push(`Current grade: ${cfg.currentGrade ?? 'none'} to ${cur}`); cfg.currentGrade = cur; }
  }

  // 3) Weaknesses follow their unit scores
  if (Array.isArray(cfg.weaknesses)) {
    cfg.weaknesses.forEach(wk => {
      const u = cfg.units.find(x => x.name === wk.area); if (!u) return;
      if (wk.score !== u.score) wk.score = u.score;
      const b = baseScore(wk.area);
      // Only re-rate impact once the unit has moved meaningfully from the plan's baseline
      if (typeof b !== 'number' || Math.abs(u.score - b) < 8) return;
      const imp = u.score < 60 ? 'high' : u.score < 80 ? 'medium' : 'low';
      if (wk.impact !== imp) { changes.push(`${wk.area}: impact ${wk.impact || 'n/a'} to ${imp}`); wk.impact = imp; }
    });
    if (cfg.weaknesses.every(x => typeof x.score === 'number')) cfg.weaknesses.sort((a, b) => a.score - b.score);
  }

  // 4) Phase: advance with hours used, but hold if real performance is lagging
  if (Array.isArray(cfg.phases) && cfg.phases.length && Number(student.hours_total) > 0) {
    const frac = hoursUsed / Number(student.hours_total);
    const want = Math.min(cfg.phases.length, 1 + Math.floor(frac * cfg.phases.length));
    const cur = Number(cfg.currentPhase) || 1;
    if (want > cur) {
      if (perf == null || perf >= 70) {
        cfg.currentPhase = want;
        cfg.phases.forEach((p, i) => { p.status = i + 1 < want ? 'complete' : i + 1 === want ? 'active' : 'upcoming'; });
        changes.push(`Phase ${cur} to ${want} (${Math.round(frac * 100)}% of hours used)`);
      } else {
        const msg = `Holding phase ${cur}: recent work at ${Math.round(perf)}%, below the 70% bar to advance`;
        if (!(cfg.adaptive.log || []).some(l => l.summary === msg)) changes.push(msg);
      }
    }
  }

  if (!changes.length) return { cfg: cfg0, changes: [], unchanged: true };
  cfg.adaptive.updatedAt = now.toISOString();
  cfg.adaptive.log = [...(cfg.adaptive.log || []), { date: now.toISOString().slice(0, 10), summary: changes.join('; ') }].slice(-20);
  return { cfg, changes };
}

/** Runs the adaptation for every active student. */
export async function adaptAll(c, { dryRun = false, studentId = null } = {}) {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const q = studentId ? `&id=eq.${studentId}` : '';
  const students = await sbGet(c, `/rest/v1/students?select=id,name,hours_total,hours_used,progress_config&status=eq.active&progress_config=not.is.null${q}`);
  const out = [];
  for (const s of students) {
    const [hw, tests] = await Promise.all([
      sbGet(c, `/rest/v1/homework?select=score,max_score,status,due_date,created_at,graded_at&student_id=eq.${s.id}&created_at=gte.${since}`),
      sbGet(c, `/rest/v1/practice_tests?select=total,correct,unit_breakdown,created_at&student_id=eq.${s.id}&section=eq.mcq&created_at=gte.${since}`)
    ]);
    const r = computeAdaptation(s, hw, tests);
    if (!r || r.unchanged || !r.changes.length) continue;
    out.push({ student: s.name, changes: r.changes });
    if (!dryRun) await sbPatch(c, `/rest/v1/students?id=eq.${s.id}`, { progress_config: r.cfg });
  }
  return out;
}

async function sbGet(c, path) {
  const r = await fetch(c.sbUrl + path, { headers: { apikey: c.sbKey, Authorization: `Bearer ${c.sbKey}` } });
  if (!r.ok) throw new Error(`Supabase GET ${r.status}`);
  return r.json();
}
async function sbPatch(c, path, body) {
  const r = await fetch(c.sbUrl + path, { method: 'PATCH', headers: { apikey: c.sbKey, Authorization: `Bearer ${c.sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Supabase PATCH ${r.status}`);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  const c = { sbUrl: process.env.SUPABASE_URL, sbKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
  if (!c.sbUrl || !c.sbKey) return res.status(500).json({ error: 'server not configured' });
  try {
    const changed = await adaptAll(c, { dryRun: req.query?.dry === '1', studentId: req.query?.student || null });
    return res.status(200).json({ dryRun: req.query?.dry === '1', changed });
  } catch (e) {
    console.error('[adapt-plans] failed', e.message);
    return res.status(502).json({ error: e.message });
  }
}
