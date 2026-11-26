// /api/onboarding?r=tutor-admin : admin-only actions for the tutor pipeline and match suggestions.
// Header x-admin-code must equal ADMIN_CODE (env) or the portal's NAP-ADMIN code.
// Never deletes rows. Never edits existing tutors; only new tutors created via approve carry a cap.
import { RUBRIC, rubricSummary, qualifiedSubjects, HOURS_PER_STUDENT, scoreMatch, slotsLeft } from './_tutor-rules.js';
import { sb, sbEnv, cors, sendMail, esc, ADMIN_EMAIL } from './_sb.js';

const HUB_URL = 'https://gamma.app/docs/Northstar-Tutor-Hub-Your-Complete-Onboarding-Guide-vmvwl4l8iyxyg9s';
const MANAGER_ACTIONS = ['login', 'list', 'set_status', 'score', 'call', 'video_decision', 'approve', 'matches', 'assign', 'set_gender', 'board', 'board_set', 'students', 'tutors', 'email_tutor_form'];
const STATUSES = ['applied', 'dq', 'audition_pending', 'quiz_pending', 'quiz_failed', 'video_review', 'call_pending', 'approved', 'rejected'];

export default async function handler(req, res) {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const env = sbEnv();
  if (!env) return res.status(500).json({ error: 'Server not configured' });
  const { action } = req.body || {};
  const b = req.body || {};
  // Two roles. admin: the NAP-ADMIN code. manager: an active key from staff_access.
  // Managers get a fixed set of actions and never receive pay, billing or session data.
  const code = String(req.headers['x-admin-code'] || '');
  let role = null, staff = null;
  if (code && code === (process.env.ADMIN_CODE || 'NAP-ADMIN')) role = 'admin';
  else if (/^[A-Za-z0-9-]{6,40}$/.test(code)) {
    try {
      const r = await sb(env, 'GET', `staff_access?code=eq.${encodeURIComponent(code)}&active=eq.true&select=id,name,role`);
      if (r?.[0]) { role = 'manager'; staff = r[0]; }
    } catch (e) { console.error('[tutor-admin] staff lookup', e.message); }
  }
  if (!role) return res.status(401).json({ error: 'Not authorized' });
  if (role === 'manager' && !MANAGER_ACTIONS.includes(action)) return res.status(403).json({ error: 'Not allowed' });
  const isMgr = role === 'manager';
  try {
    if (action === 'login') {
      if (staff) await sb(env, 'PATCH', `staff_access?id=eq.${staff.id}`, { last_login: new Date().toISOString() }, 'return=minimal');
      return res.status(200).json({ ok: true, role, name: staff?.name || 'Admin' });
    }
    if (action === 'staff_list' || action === 'staff_add' || action === 'staff_set_active') {
      if (isMgr) return res.status(403).json({ error: 'Not allowed' });
      return res.status(200).json(await staffAdmin(env, action, b));
    }
    if (action === 'students') return res.status(200).json(await mgrStudents(env));
    if (action === 'tutors') return res.status(200).json(await mgrTutors(env));
    if (action === 'email_tutor_form') return res.status(200).json(await emailTutorForm(env, b));
    if (action === 'list') {
      const rows = await sb(env, 'GET', 'tutor_applications?select=*&order=created_at.desc&limit=300');
      return res.status(200).json({ role, apps: rows.map(a => {
        const o = { ...a, rubric_summary: rubricSummary(a.rubric) };
        if (isMgr) { delete o.pay_expectation; delete o.pay_text; }
        return o;
      }), rubric: RUBRIC });
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
      await sb(env, 'PATCH', `tutor_applications?id=eq.${enc(b.id)}`, patch, 'return=minimal');
      return res.status(200).json({ ok: true, summary: s });
    }
    if (action === 'video_decision') {
      const [a] = await sb(env, 'GET', `tutor_applications?id=eq.${enc(b.id)}&select=id,name,email,token,status`);
      if (!a) throw new Error('Application not found');
      if (a.status !== 'video_review') throw new Error('This video is not waiting for review');
      if (!b.approve) {
        await sb(env, 'PATCH', `tutor_applications?id=eq.${a.id}`, { status: 'rejected' }, 'return=minimal');
        return res.status(200).json({ ok: true, emailed: false });
      }
      await sb(env, 'PATCH', `tutor_applications?id=eq.${a.id}`, { status: 'quiz_pending' }, 'return=minimal');
      const link = `https://portal.northstaracademicprep.com/tutor-status?t=${a.token}`;
      const first = esc(a.name.trim().split(/\s+/)[0]);
      const emailed = await sendMail({ to: a.email, bcc: ADMIN_EMAIL, subject: 'You are through to the next step at Northstar',
        html: `<p>Hey ${first},</p><p>We watched your audition and loved it. You are through to the next step.</p>`
          + `<p><b>Next:</b> read the Northstar Tutor Hub, then take a 20 question quiz on how we run sessions. You need 18 correct to pass. Both are on your link:</p>`
          + `<p><a href="${link}">${link}</a></p><p>Once you pass, we will reach out to talk through next steps and get you started.</p><p>Northstar Academic Prep</p>` });
      return res.status(200).json({ ok: true, emailed });
    }
    if (action === 'call') {
      await sb(env, 'PATCH', `tutor_applications?id=eq.${enc(b.id)}`, { call_done: !!b.done, call_notes: String(b.notes || '').slice(0, 1500) }, 'return=minimal');
      return res.status(200).json({ ok: true });
    }
    if (action === 'approve') return res.status(200).json(await approve(env, b, isMgr));
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

async function approve(env, b, isMgr) {
  const rows = await sb(env, 'GET', `tutor_applications?id=eq.${enc(b.id)}&select=*`);
  const a = rows?.[0];
  if (!a) throw new Error('Application not found');
  if (a.tutor_id) throw new Error('Already approved');
  if (a.status === 'dq') throw new Error('This applicant was auto-disqualified');
  if (!a.quiz_passed) throw new Error('Quiz not passed');
  if (!a.call_done) throw new Error('Mark the 5 minute check-in call done first');
  // Managers never see or set pay; the rate stays blank for Sahib to fill in.
  let rate = null;
  if (!isMgr) { rate = Number(b.hourly_rate); if (!(rate > 0 && rate <= 30)) throw new Error('Set an hourly rate up to $30'); }

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
  // Welcome email: Tutor Hub, portal link and login code together in one message. No pay mentioned.
  const firstName = esc(a.name.trim().split(/\s+/)[0]);
  const emailed = await sendMail({ to: a.email, bcc: ADMIN_EMAIL, subject: 'Welcome to Northstar, your tutor access',
    html: `<p>Hey ${firstName},</p><p>Welcome to the Northstar team. We are super excited to work with you.</p>`
      + `<p><b>Your tutor portal:</b> <a href="https://portal.northstaracademicprep.com">portal.northstaracademicprep.com</a><br><b>Your access key:</b> ${esc(created.code)}</p>`
      + `<p><b>Tutor Hub</b> (keep this handy, it covers everything): <a href="${HUB_URL}">${HUB_URL}</a></p>`
      + `<p>Next, we will match you with your first student and start a group chat with you, the student and their family. All communication stays in that group chat.</p><p>Northstar Academic Prep</p>` });
  return { ok: true, emailed, tutor: { id: created.id, name: created.name, code: created.code, max_students: created.max_students } };
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
  const unassigned = students.filter(s => !s.tutor_id && s.status !== 'inactive' && s.status !== 'completed' && Number(s.hours_total) > 0);
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

// ---- Staff keys (admin only) ----
async function staffAdmin(env, action, b) {
  if (action === 'staff_add') {
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) throw new Error('Add a name');
    const code = 'MGR-' + Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    await sb(env, 'POST', 'staff_access', { name, code, role: 'manager', active: true });
    return { ok: true, code };
  }
  if (action === 'staff_set_active') {
    await sb(env, 'PATCH', `staff_access?id=eq.${enc(b.id)}`, { active: !!b.active }, 'return=minimal');
    return { ok: true };
  }
  return { staff: await sb(env, 'GET', 'staff_access?select=id,name,code,role,active,created_at,last_login&order=created_at.desc') };
}

// ---- Manager views: whitelisted fields only (no pay, hours, billing or session counts) ----
async function mgrStudents(env) {
  const [students, tutors, onboard] = await Promise.all([
    sb(env, 'GET', 'students?select=id,name,grade,school,subjects,tutor_id,status,gender,timezone,parent_email&order=name'),
    sb(env, 'GET', 'tutors?select=id,name'),
    sb(env, 'GET', 'onboarding_responses?select=*&order=created_at.desc'),
  ]);
  const tn = Object.fromEntries(tutors.map(t => [t.id, t.name]));
  const intake = {};
  for (const o of onboard) { const k = o.student_id || ('n:' + (o.student_name || '').toLowerCase()); if (!intake[k]) intake[k] = o; }
  return { students: students.filter(s => s.status !== 'inactive').map(s => {
    const o = intake[s.id] || intake['n:' + (s.name || '').toLowerCase()] || null;
    return { id: s.id, name: s.name, grade: s.grade, school: s.school, subjects: s.subjects, gender: s.gender, timezone: s.timezone,
      tutor: tn[s.tutor_id] || null, tutor_id: s.tutor_id,
      intake: o ? { parent1_name: o.parent1_name, parent1_email: o.parent1_email, parent1_phone: o.parent1_phone,
        parent2_name: o.parent2_name, parent2_email: o.parent2_email, parent2_phone: o.parent2_phone,
        student_email: o.student_email, student_phone: o.student_phone, preferred_contact: o.preferred_contact, contact_notes: o.contact_notes,
        student_grade: o.student_grade, school: o.school, timezone: o.timezone, preferred_days: o.preferred_days, preferred_times: o.preferred_times,
        scheduling_notes: o.scheduling_notes, subjects: o.subjects, teacher_name: o.teacher_name, current_grade: o.current_grade,
        target_grade: o.target_grade, next_test_date: o.next_test_date, struggles: o.struggles } : null };
  }) };
}

async function mgrTutors(env) {
  const [tutors, students] = await Promise.all([
    sb(env, 'GET', 'tutors?select=id,name,email,school,major,gender,subjects_can_teach,ap_scores,availability_days,availability_schedule,max_students,weekly_hours,timezone&order=name'),
    sb(env, 'GET', 'students?select=id,name,tutor_id,status'),
  ]);
  return { tutors: tutors.map(t => {
    const mine = students.filter(s => s.tutor_id === t.id && s.status !== 'inactive');
    return { id: t.id, name: t.name, email: t.email, school: t.school, major: t.major, gender: t.gender, subjects_can_teach: t.subjects_can_teach,
      ap_scores: t.ap_scores, availability_days: t.availability_days, availability_schedule: t.availability_schedule, max_students: t.max_students,
      students: mine.map(s => s.name), active: mine.length, slots_left: t.max_students == null ? null : Math.max(0, t.max_students - mine.length) };
  }) };
}

// Trimmed family form for a matched tutor. Never parent info, student email or phone, heard-about or notes.
async function emailTutorForm(env, b) {
  const [st] = await sb(env, 'GET', `students?id=eq.${enc(b.student_id)}&select=id,name,tutor_id,grade,school,subjects`);
  if (!st) throw new Error('Student not found');
  if (!st.tutor_id) throw new Error('Assign a tutor first');
  const [tu] = await sb(env, 'GET', `tutors?id=eq.${st.tutor_id}&select=id,name,email`);
  if (!tu?.email) throw new Error('This tutor has no email on file');
  const ob = await sb(env, 'GET', `onboarding_responses?student_id=eq.${st.id}&select=*&order=created_at.desc&limit=1`)
    .then(r => r?.length ? r : sb(env, 'GET', `onboarding_responses?student_name=ilike.${enc(st.name)}&select=*&order=created_at.desc&limit=1`));
  const o = ob?.[0];
  if (!o) throw new Error('The family has not submitted the intake form yet');
  const v = x => (Array.isArray(x) ? x.join(', ') : x) || 'not given';
  const rows = [['Student', o.student_name || st.name], ['Grade', o.student_grade || st.grade], ['School', o.school || st.school],
    ['Preferred contact', o.preferred_contact], ['Contact notes', o.contact_notes], ['Time zone', o.timezone],
    ['Preferred days', o.preferred_days], ['Preferred times', o.preferred_times], ['Scheduling notes', o.scheduling_notes],
    ['Subjects', o.subjects], ['Teacher', o.teacher_name], ['Current grade', o.current_grade], ['Target grade', o.target_grade],
    ['Next test date', o.next_test_date], ['Struggles', o.struggles]];
  const emailed = await sendMail({ to: tu.email, bcc: ADMIN_EMAIL, subject: `Onboarding form: ${st.name}`,
    html: `<p>Here is the family's onboarding form so you can gauge where your student is at. We will start a group chat with you and the family for intros.</p><table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">`
      + rows.map(([k, x]) => `<tr><td style="border-bottom:1px solid #eee;color:#666;vertical-align:top"><b>${esc(k)}</b></td><td style="border-bottom:1px solid #eee">${esc(v(x))}</td></tr>`).join('') + `</table>` });
  if (emailed) await sb(env, 'POST', 'student_checklist?on_conflict=student_id', { student_id: st.id, trimmed_form_sent: true, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal');
  return { ok: true, emailed, tutor: tu.name };
}
