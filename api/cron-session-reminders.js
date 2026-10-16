// ============================================================
// /api/cron-session-reminders
// Daily cron (vercel.json). Emails a reminder for every scheduled
// session starting within the next 24 hours that has not been
// reminded yet. Goes to the student, the parent and the tutor.
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
// ============================================================
import { sbGet, sbPatch, sendReminderEmail } from './notify-calendar.js';

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
      const student = (await sbGet(c, `/rest/v1/students?select=name,email,parent_email,tutor_id&id=eq.${s.student_id}`))[0];
      const tid = s.tutor_id || student?.tutor_id;
      const tutor = tid ? (await sbGet(c, `/rest/v1/tutors?select=name,email&id=eq.${tid}`))[0] : null;
      const to = [student?.email, student?.parent_email, tutor?.email].filter(Boolean).map(x => x.toLowerCase());
      if (!to.length) { skipped++; continue; }
      const n = await sendReminderEmail(c, {
        to, subject: `Reminder: tutoring session for ${student?.name || 'your student'} · Northstar`,
        studentName: student?.name, whenIso: s.starts_at, minutes: s.duration_minutes,
        tutorName: tutor?.name, meetingUrl: s.meeting_url, topic: s.topic
      });
      if (n > 0) { await sbPatch(c, `/rest/v1/scheduled_sessions?id=eq.${s.id}`, { reminder_sent_at: new Date().toISOString() }); sent++; }
      else skipped++;
    }
    console.log('[cron-session-reminders]', JSON.stringify({ found: sessions.length, sent, skipped }));
    return res.status(200).json({ found: sessions.length, sent, skipped });
  } catch (e) {
    console.error('[cron-session-reminders] failed', e.message);
    return res.status(502).json({ error: e.message });
  }
}
