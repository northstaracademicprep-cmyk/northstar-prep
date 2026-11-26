// /api/onboarding?r=tutor-admin : admin-only actions for the tutor pipeline and match suggestions.
// Header x-admin-code must equal ADMIN_CODE (env) or the portal's NAP-ADMIN code.
// Never deletes rows. Never edits existing tutors; only new tutors created via approve carry a cap.
import { RUBRIC, rubricSummary, qualifiedSubjects, HOURS_PER_STUDENT, scoreMatch, slotsLeft } from './_tutor-rules.js';
import { sb, sbEnv, cors } from './_sb.js';

const STATUSES = ['applied', 'dq', 'audition_pending', 'quiz_pending', 'quiz_failed', 'review', 'call_pending', 'approved', 'rejected'];

export default async function handler(req, res) {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const env = sbEnv();
  if (!env) return res.status(500).json({ error: 'Server not configured' });
  const expected = process.env.ADMIN_CODE || 'NAP-ADMIN';
  if (req.headers['x-admin-code'] !== expected) return res.status(401).json({ error: 'Not authorized' });

  const { action } = req.body || {};
  const b = req.body || {};
  try {
    if (action === 'list') {
      const rows = await sb(env, 'GET', 'tutor_applications?select=*&order=created_at.desc&limit=300');
      return res.status(200).json({ apps: rows.map(a => ({ ...a, rubric_summary: rubricSummary(a.rubric) })), rubric: RUBRIC });
    }
    if (action === 'set_status') {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Bad status' });
      const patch = { status: b.status };
      if (b.status === 'quiz_pending') { patch.quiz_answers = null; patch.quiz_score = null; patch.quiz_passed = null; }  // retake
      await sb(env, 'PATCH', `tutor_applications?id=eq.${enc(b.id)}`, patch, 'return=minimal');
      return res.status(200).json({ ok: true });
    }
    if (action === 'score') {
      const rubric = {};
      for (const [k] of RUBRIC) { const v = Number(b.rubric?.[k]); if (!(v >= 1 && v <= 5)) return res.status(400).json({ error: 'Score every criterion 1 to 5.' }); rubric[k] = v; }
      const s = rubricSummary(rubric);
      const patch = { rubric, rubric_notes: String(b.notes || '').slice(0, 1500) };
      if (b.advance && s.pass) patch.status = 'call_pending';
      await sb(env, 'PATCH', `tutor_applications?id=eq.${enc(b.id)}`, patch, 'return=minimal');
      return res.status(200).json({ ok: true, summary: s });
    }
    if (action === 'call') {
      await sb(env, 'PATCH', `tutor_applications?id=eq.${enc(b.id)}`, { call_done: !!b.done, call_notes: String(b.notes || '').slice(0, 1500) }, 'return=minimal');
      return res.status(200).json({ ok: true });
    }
    if (action === 'approve') return res.status(200).json(await approve(env, b));
    if (action === 'board') return res.status(200).json(await board(env));
    if (action === 'board_set') {
      if (!['welcome_sent', 'trimmed_form_sent', 'group_chat'].includes(b.field)) return res.status(400).json({ error: 'Bad field' });
      await sb(env, 'POST', 'student_checklist?on_conflict=student_id', { student_id: b.student_id, [b.field]: !!b.value, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal');
      return res.status(200).json({ ok: true });
    }
    if (action === 'matches') return res.status(200).json(await matches(env));
    if (action === 'assign') return res.status(200).json(await assign(env, b));
    if (action === 'set_gender') {
      const g = ['female', 'male', 'other'].includes(b.gender) ? b.gender : null;
      const table = b.kind === 'tutor' ? 'tutors' : 'students';
      await sb(env, 'PATCH', `${table}?id=eq.${enc(b.id)}`, { gender: g }, 'return=minimal');
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[tutor-admin]', action, e.message);
    return res.status(502).json({ error: e.message });
  }
}

const enc = v => encodeURIComponent(String(v ?? ''));

async function approve(env, b) {
  const rows = await sb(env, 'GET', `tutor_applications?id=eq.${enc(b.id)}&select=*`);
  const a = rows?.[0];
  if (!a) throw new Error('Application not found');
  if (a.tutor_id) throw new Error('Already approved');
  if (a.status === 'dq') throw new Error('This applicant was auto-disqualified');
  if (!a.quiz_passed) throw new Error('Quiz not passed');
  if (!a.rubric || !rubricSummary(a.rubric)) throw new Error('Score the audition first');
  if (!a.call_done) throw new Error('Mark the 5 minute check-in call done first');
  const rate = Number(b.hourly_rate);
  if (!(rate > 0 && rate <= 30)) throw new Error('Set an hourly rate up to $30');

  // Unique access code: FIRSTNAME26, then FIRSTNAME + last initial, then numbered.
  const parts = a.name.trim().split(/\s+/);
  const first = parts[0].toUpperCase().replace(/[^A-Z]/g, '') || 'TUTOR';
  const last = (parts[parts.length - 1] || '').toUpperCase().replace(/[^A-Z]/g, '');
  const existing = await sb(env, 'GET', 'tutors?select=code');
  const taken = new Set(existing.map(t => (t.code || '').toUpperCase()));
  let code = `${first}26`;
  if (taken.has(code) && last) code = `${first}${last.slice(0, 1)}26`;
  if (taken.has(code) && last) code = `${first}${last}26`;
  for (let i = 2; taken.has(code); i++) code = `${first}${i}26`;

  const qualified = qualifiedSubjects(a.ap_can_tutor, a.ap_taken);
  const schedule = a.availability_schedule || [];
  const tutor = {
    name: a.name, code, email: a.email, school: a.school, major: a.major, gender: a.gender, timezone: a.timezone,
    subjects: qualified, subjects_can_teach: qualified,
    ap_scores: (a.ap_taken || []).map(t => ({ course: t.course, score: t.score })),
    availability_schedule: schedule, availability_days: [...new Set(schedule.map(s => s.day))],
    hourly_rate: rate, weekly_hours: a.weekly_hours,
    max_students: Math.max(1, Math.floor((a.weekly_hours || 0) / HOURS_PER_STUDENT)),
    application_id: a.id,
  };
  const created = (await sb(env, 'POST', 'tutors', tutor))[0];
  await sb(env, 'PATCH', `tutor_applications?id=eq.${a.id}`, { status: 'approved', tutor_id: created.id }, 'return=minimal');
  return { ok: true, tutor: { id: created.id, name: created.name, code: created.code, max_students: created.max_students } };
}

async function matches(env) {
  const [students, tutors, onboard] = await Promise.all([
    sb(env, 'GET', 'students?select=id,name,subjects,tutor_id,status,hours_total,gender,timezone&order=name'),
    sb(env, 'GET', 'tutors?select=id,name,code,subjects_can_teach,ap_scores,availability_days,availability_schedule,max_students,weekly_hours,gender,major,application_id'),
    sb(env, 'GET', 'onboarding_responses?select=student_id,student_name,preferred_days,preferred_times,timezone&order=created_at.desc'),
  ]);
  const counts = {};
  for (const s of students) if (s.tutor_id && s.status !== 'inactive') counts[s.tutor_id] = (counts[s.tutor_id] || 0) + 1;
  const ob = r => (r.student_id ? 'id:' + r.student_id : 'name:' + (r.student_name || '').toLowerCase());
  const obMap = {};
  for (const r of onboard) { if (!obMap[ob(r)]) obMap[ob(r)] = r; }
  const unassigned = students.filter(s => !s.tutor_id && s.status !== 'inactive' && Number(s.hours_total) > 0);
  const out = unassigned.map(s => {
    const o = obMap['id:' + s.id] || obMap['name:' + s.name.toLowerCase()] || null;
    const prefDays = o?.preferred_days || [];
    const sugg = tutors
      .map(t => ({ t, m: scoreMatch({ student: s, prefDays, tutor: t, activeCount: counts[t.id] || 0 }) }))
      .filter(x => x.m.covered && x.m.slotsLeft !== 0)
      .sort((a, b) => b.m.score - a.m.score).slice(0, 3)
      .map(x => ({ tutor_id: x.t.id, name: x.t.name, score: x.m.score, reasons: x.m.reasons, slots_left: x.m.slotsLeft, is_new: x.t.max_students != null }));
    return { id: s.id, name: s.name, subjects: s.subjects, gender: s.gender, pref_days: prefDays, pref_times: o?.preferred_times || null, form_in: !!o, suggestions: sugg };
  });
  const capacity = tutors.filter(t => t.max_students != null).map(t => ({
    id: t.id, name: t.name, gender: t.gender, max: t.max_students, active: counts[t.id] || 0, left: slotsLeft(t, counts[t.id] || 0),
  }));
  return { students: out, capacity };
}

async function assign(env, b) {
  const [st] = await sb(env, 'GET', `students?id=eq.${enc(b.student_id)}&select=id,name,tutor_id`);
  const [tu] = await sb(env, 'GET', `tutors?id=eq.${enc(b.tutor_id)}&select=id,name,max_students`);
  if (!st || !tu) throw new Error('Student or tutor not found');
  if (st.tutor_id) throw new Error(`${st.name} already has a tutor`);
  if (tu.max_students != null) {
    const cur = await sb(env, 'GET', `students?tutor_id=eq.${tu.id}&select=id,status`);
    const active = cur.filter(s => s.status !== 'inactive').length;
    if (active >= tu.max_students) throw new Error(`${tu.name} has no slots left`);
  }
  await sb(env, 'PATCH', `students?id=eq.${st.id}`, { tutor_id: tu.id }, 'return=minimal');
  await sb(env, 'PATCH', `homework?student_id=eq.${st.id}`, { tutor_id: tu.id }, 'return=minimal');
  return { ok: true, student: st.name, tutor: tu.name };
}

// Per-student status board: computed where the data exists, manual for emails and group chats.
async function board(env) {
  const [students, tutors, onboard, hw, sess, chk] = await Promise.all([
    sb(env, 'GET', 'students?select=id,name,subjects,tutor_id,status,hours_total,hours_used,payment_status,progress_config&order=name'),
    sb(env, 'GET', 'tutors?select=id,name'),
    sb(env, 'GET', 'onboarding_responses?select=student_id,student_name'),
    sb(env, 'GET', 'homework?select=student_id,title,status&title=ilike.*diagnostic*'),
    sb(env, 'GET', 'sessions?select=student_id'),
    sb(env, 'GET', 'student_checklist?select=*'),
  ]);
  const tn = Object.fromEntries(tutors.map(t => [t.id, t.name]));
  const obIds = new Set(onboard.map(o => o.student_id).filter(Boolean));
  const obNames = new Set(onboard.map(o => (o.student_name || '').toLowerCase()));
  const sessCount = {};
  for (const s of sess) sessCount[s.student_id] = (sessCount[s.student_id] || 0) + 1;
  const diag = {};
  for (const h of hw) { const d = diag[h.student_id] || (diag[h.student_id] = { assigned: true, done: false }); if (h.status && h.status !== 'pending') d.done = true; }
  const ck = Object.fromEntries(chk.map(c => [c.student_id, c]));
  const rows = students.filter(s => s.status !== 'inactive' && s.payment_status === 'paid' && Number(s.hours_total) > 0).map(s => {
    const c = ck[s.id] || {};
    return {
      id: s.id, name: s.name, subjects: s.subjects, tutor: tn[s.tutor_id] || null,
      steps: {
        closed: true,
        portal_ready: !!s.progress_config && !!s.progress_config.phases,
        welcome_sent: !!c.welcome_sent,
        form_in: obIds.has(s.id) || obNames.has((s.name || '').toLowerCase()),
        tutor_matched: !!s.tutor_id,
        trimmed_form_sent: !!c.trimmed_form_sent,
        group_chat: !!c.group_chat,
        diagnostic_done: !!diag[s.id]?.done,
        first_session: (sessCount[s.id] || 0) > 0,
      },
    };
  });
  return { rows };
}
