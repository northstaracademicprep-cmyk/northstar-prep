// ============================================================
// /api/onboarding
// Receives the parent/student onboarding form (onboarding.html) and
// stores it in public.onboarding_responses using the service role.
// Emails Sahib a short heads-up via Resend (best-effort).
//
// POST JSON { ...fields }  ->  { ok: true }
// The table has RLS on with no policies: this endpoint is the only writer.
// ============================================================

const ADMIN_EMAIL = 'northstaracademicprep@gmail.com';
const RESEND_FROM = 'Northstar Academic Prep <reports@send.northstaracademicprep.com>';

const TEXT_FIELDS = {
  student_name: 120, student_email: 160, student_phone: 40, student_grade: 40, school: 160,
  parent1_name: 120, parent1_email: 160, parent1_phone: 40,
  parent2_name: 120, parent2_email: 160, parent2_phone: 40,
  preferred_contact: 40, contact_notes: 500,
  timezone: 60, preferred_times: 300, scheduling_notes: 800,
  subjects: 300, teacher_name: 120, current_grade: 60, target_grade: 60,
  next_test_date: 80, struggles: 1500, heard_about: 200, notes: 1500,
};
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return res.status(500).json({ error: 'Server not configured' });

  const body = req.body || {};
  // Honeypot: real people never fill the hidden "website" field.
  if (body.website) return res.status(200).json({ ok: true });

  const row = {};
  for (const [k, max] of Object.entries(TEXT_FIELDS)) {
    const v = typeof body[k] === 'string' ? body[k].trim().slice(0, max) : '';
    row[k] = v || null;
  }
  row.preferred_days = Array.isArray(body.preferred_days)
    ? body.preferred_days.filter(d => DAYS.includes(d))
    : [];

  const missing = [];
  if (!row.student_name)  missing.push('student name');
  if (!row.parent1_name)  missing.push('parent name');
  if (!row.parent1_email || !EMAIL_RE.test(row.parent1_email)) missing.push('a valid parent email');
  if (!row.timezone)      missing.push('time zone');
  if (missing.length) return res.status(400).json({ error: `Please add ${missing.join(', ')}.` });
  for (const k of ['student_email', 'parent2_email']) {
    if (row[k] && !EMAIL_RE.test(row[k])) return res.status(400).json({ error: 'One of the email addresses looks off. Please check it.' });
  }

  const r = await fetch(`${sbUrl}/rest/v1/onboarding_responses`, {
    method: 'POST',
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error(`[onboarding] insert failed ${r.status}: ${detail.slice(0, 300)}`);
    return res.status(502).json({ error: 'Could not save your answers. Please try again in a minute.' });
  }

  // Heads-up email to Sahib. Never blocks or fails the submission, but every
  // outcome is logged so a missing email can be traced in Vercel logs.
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.warn('[onboarding] RESEND_API_KEY not set, skipping notify email');
    } else {
      const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const er = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: ADMIN_EMAIL,
          subject: `New onboarding form: ${row.student_name}`,
          html: `<p><b>${esc(row.student_name)}</b> (parent: ${esc(row.parent1_name)}, ${esc(row.parent1_email)}) just submitted the onboarding form.</p>`
              + `<p>Subjects: ${esc(row.subjects || 'not given')}<br>Time zone: ${esc(row.timezone)}<br>Days: ${esc(row.preferred_days.join(', ') || 'not given')}</p>`,
        }),
      });
      const detail = await er.text().catch(() => '');
      if (er.ok) console.log(`[onboarding] notify email sent for ${row.student_name}: ${detail.slice(0, 120)}`);
      else console.warn(`[onboarding] notify email rejected ${er.status}: ${detail.slice(0, 300)}`);
    }
  } catch (e) {
    console.warn(`[onboarding] notify email failed: ${e.message}`);
  }

  return res.status(200).json({ ok: true });
}
