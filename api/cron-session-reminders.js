// ============================================================
// /api/cron-session-reminders
// Daily cron (vercel.json). Emails a reminder for every scheduled
// session starting within the next 24 hours that has not been
// reminded yet. Goes to the student, the parent and the tutor.
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
// ============================================================
import { sbGet, sbPatch, sendReminderEmail, layout, fmt } from './notify-calendar.js';
import { adaptAll } from './adapt-plans.js';

const ADMIN_EMAIL = 'northstaracademicprep@gmail.com';
const RESEND_FROM = 'Northstar Academic Prep <reports@send.northstaracademicprep.com>';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });

  const c = { sbUrl: process.env.SUPABASE_URL, sbKey: process.env.SUPABASE_SERVICE_ROLE_KEY, resendKey: process.env.RESEND_API_KEY };
  if (!c.sbUrl || !c.sbKey || !c.resendKey) return res.status(500).json({ error: 'server not configured' });

  try {
    const now = new Date(), until = new Date(now.getTime() + 24 * 3600 * 1000);
    const sessions = await sbGet(c, `/rest/v1/scheduled_sessions?select=*&status=eq.scheduled&reminder_sent_at=is.null&starts_at=gte.${now.toISOString()}&starts_at=lt.${until.toISOString()}&order=starts_at`);
    let sent = 0, skipped = 0;
    for (const s of sessions) {
      const student = (await sbGet(c, `/rest/v1/students?select=name,email,parent_email,tutor_id,timezone&id=eq.${s.student_id}`))[0];
      const tid = s.tutor_id || student?.tutor_id;
      const tutor = tid ? (await sbGet(c, `/rest/v1/tutors?select=name,email,timezone&id=eq.${tid}`))[0] : null;
      const stuTo = [student?.email, student?.parent_email].filter(Boolean).map(x => x.toLowerCase());
      const tutTo = [tutor?.email].filter(Boolean).map(x => x.toLowerCase()).filter(x => !stuTo.includes(x));
      if (!stuTo.length && !tutTo.length) { skipped++; continue; }
      const base = {
        subject: `Reminder: tutoring session for ${student?.name || 'your student'} · Northstar`,
        studentName: student?.name, whenIso: s.starts_at, minutes: s.duration_minutes,
        tutorName: tutor?.name, meetingUrl: s.meeting_url, topic: s.topic
      };
      // each side sees the time in their own zone
      let n = 0;
      if (stuTo.length) n += await sendReminderEmail(c, { ...base, to: stuTo, tz: student?.timezone });
      if (tutTo.length) n += await sendReminderEmail(c, { ...base, to: tutTo, tz: tutor?.timezone });
      if (n > 0) { await sbPatch(c, `/rest/v1/scheduled_sessions?id=eq.${s.id}`, { reminder_sent_at: new Date().toISOString() }); sent++; }
      else skipped++;
    }
    // Office hours: one announcement per slot to every active student + parent
    let ohSent = 0;
    const slots = await sbGet(c, `/rest/v1/office_hours?select=*&status=eq.scheduled&announced_at=is.null&starts_at=gte.${now.toISOString()}&starts_at=lt.${until.toISOString()}&order=starts_at`);
    if (slots.length) {
      const studs = await sbGet(c, `/rest/v1/students?select=email,parent_email&status=eq.active`);
      const to = [...new Set(studs.flatMap(x => [x.email, x.parent_email]).filter(Boolean).map(x => x.toLowerCase()).concat(ADMIN_EMAIL))];
      for (const o of slots) {
        const end = new Date(new Date(o.starts_at).getTime() + o.duration_minutes * 60000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
        const lines = [['When', `${fmt(o.starts_at)} to ${end}`]];
        if (o.host_name) lines.push(['Host', o.host_name]);
        if (o.meeting_url) lines.push(['Join link', o.meeting_url]);
        lines.push(['Who', 'Any student. Drop in with any question, no sign up needed.']);
        const html = layout('🙋 Office hours today', 'Free office hours with a Northstar tutor', lines, 'Open the portal →');
        let ok = 0;
        for (let i = 0; i < to.length; i += 100) {
          const batch = to.slice(i, i + 100).map(addr => ({ from: RESEND_FROM, to: addr, reply_to: ADMIN_EMAIL, subject: 'Office hours today · Northstar', html }));
          const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${c.resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
          if (r.ok) ok += batch.length; else console.error('[office-hours] batch failed', r.status, (await r.text()).slice(0, 200));
        }
        if (ok > 0) { await sbPatch(c, `/rest/v1/office_hours?id=eq.${o.id}`, { announced_at: new Date().toISOString() }); ohSent += ok; }
      }
    }
    // Adaptive game plans: isolated so a failure here can never block reminders
    let plansAdapted = 0;
    try { plansAdapted = (await adaptAll(c)).length; } catch (e) { console.error('[adapt-plans] failed', e.message); }
    console.log('[cron-session-reminders]', JSON.stringify({ found: sessions.length, sent, skipped, officeHoursEmails: ohSent, plansAdapted }));
    return res.status(200).json({ found: sessions.length, sent, skipped, officeHoursEmails: ohSent, plansAdapted });
  } catch (e) {
    console.error('[cron-session-reminders] failed', e.message);
    return res.status(502).json({ error: e.message });
  }
}
