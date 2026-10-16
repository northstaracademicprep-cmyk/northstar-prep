// ============================================================
// /api/notify-calendar
// Email alerts for the shared calendar.
//
// POST { event, id }
//   event 'request_created'  id = session_requests.id  -> tutor + admin
//   event 'request_decided'  id = session_requests.id  -> student + parent
//   event 'session_scheduled' | 'session_rescheduled' | 'session_cancelled'
//                            id = scheduled_sessions.id -> student + parent
//
// Auth is lightweight (same pattern as notify-message): the id must be a
// real row. request_* events are idempotent via notified_at columns.
// ============================================================

const ADMIN_EMAIL = 'northstaracademicprep@gmail.com';
const PORTAL_URL  = 'https://portal.northstaracademicprep.com';
const RESEND_FROM = 'Northstar Academic Prep <reports@send.northstaracademicprep.com>';
const TZ          = 'America/Los_Angeles';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sbUrl = process.env.SUPABASE_URL, sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY, resendKey = process.env.RESEND_API_KEY;
  if (!sbUrl || !sbKey || !resendKey) return res.status(500).json({ error: 'server not configured' });

  const { event, id } = req.body || {};
  if (!event || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'bad request' });

  try {
    const ctx = { sbUrl, sbKey, resendKey };
    let out;
    if (event === 'request_created') out = await requestCreated(ctx, id);
    else if (event === 'request_decided') out = await requestDecided(ctx, id);
    else if (['session_scheduled', 'session_rescheduled', 'session_cancelled'].includes(event)) out = await sessionChanged(ctx, event, id);
    else return res.status(400).json({ error: 'unknown event' });
    console.log('[notify-calendar]', event, id, JSON.stringify(out));
    return res.status(200).json(out);
  } catch (e) {
    console.error('[notify-calendar] failed', event, id, e.message);
    return res.status(502).json({ error: 'notify failed', detail: e.message });
  }
}

/* ───── events ───── */
async function requestCreated(c, id) {
  const r = (await sbGet(c, `/rest/v1/session_requests?select=*&id=eq.${id}`))[0];
  if (!r) return { ok: false, reason: 'not found' };
  if (r.notified_at) return { ok: true, skipped: true };
  const { student, tutor } = await people(c, r.student_id, r.tutor_id);
  const kind = r.kind === 'new' ? 'a new session' : r.kind === 'reschedule' ? 'a new time for a session' : 'to cancel a session';
  const lines = [];
  if (r.proposed_starts_at) lines.push(['Requested time', fmt(r.proposed_starts_at)]);
  if (r.scheduled_session_id) {
    const s = (await sbGet(c, `/rest/v1/scheduled_sessions?select=starts_at&id=eq.${r.scheduled_session_id}`))[0];
    if (s) lines.push(['Current time', fmt(s.starts_at)]);
  }
  if (r.reason) lines.push(['Note', r.reason]);
  const html = layout('📅 Session request', `${esc(student?.name || 'A student')} is asking for ${kind}`, lines, 'Review in the portal →');
  const to = [ADMIN_EMAIL, tutor?.email].filter(Boolean);
  const sent = await sendAll(c, to, `Session request from ${student?.name || 'a student'} · Northstar`, html);
  if (sent > 0) await sbPatch(c, `/rest/v1/session_requests?id=eq.${id}`, { notified_at: new Date().toISOString() });
  return { ok: true, sent, to };
}

async function requestDecided(c, id) {
  const r = (await sbGet(c, `/rest/v1/session_requests?select=*&id=eq.${id}`))[0];
  if (!r) return { ok: false, reason: 'not found' };
  if (r.status === 'pending') return { ok: false, reason: 'still pending' };
  if (r.decision_notified_at) return { ok: true, skipped: true };
  const { student, tutor } = await people(c, r.student_id, r.tutor_id);
  const approved = r.status === 'approved';
  const what = r.kind === 'new' ? 'session request' : r.kind === 'reschedule' ? 'reschedule request' : 'cancel request';
  const lines = [];
  if (approved && r.proposed_starts_at) lines.push(['Time', fmt(r.proposed_starts_at)]);
  if (tutor?.name) lines.push(['Tutor', tutor.name]);
  const head = approved ? `Good news, your ${what} was approved` : `Your ${what} could not be approved`;
  const html = layout(approved ? '✅ Approved' : 'Request update', head, lines, 'Open your calendar →',
    approved ? '' : 'Your tutor may have a conflict at that time. Pick another time in the portal calendar and send a new request.');
  const to = [...recipientsFor(student), ADMIN_EMAIL];
  const sent = await sendAll(c, to, `${approved ? 'Approved' : 'Update'}: ${what} for ${student?.name || 'student'} · Northstar`, html);
  if (sent > 0) await sbPatch(c, `/rest/v1/session_requests?id=eq.${id}`, { decision_notified_at: new Date().toISOString() });
  return { ok: true, sent, to };
}

async function sessionChanged(c, event, id) {
  const s = (await sbGet(c, `/rest/v1/scheduled_sessions?select=*&id=eq.${id}`))[0];
  if (!s) return { ok: false, reason: 'not found' };
  const { student, tutor } = await people(c, s.student_id, s.tutor_id);
  const verb = event === 'session_scheduled' ? 'scheduled' : event === 'session_rescheduled' ? 'moved' : 'cancelled';
  const lines = [['Time', fmt(s.starts_at)], ['Length', `${s.duration_minutes} min`]];
  if (tutor?.name) lines.push(['Tutor', tutor.name]);
  if (s.topic) lines.push(['Topic', s.topic]);
  if (s.meeting_url && verb !== 'cancelled') lines.push(['Meeting link', s.meeting_url]);
  const html = layout(verb === 'cancelled' ? '❌ Session cancelled' : '📅 Session ' + verb, `A session for ${esc(student?.name || 'your student')} was ${verb}`, lines, 'Open your calendar →');
  const to = [...recipientsFor(student), ADMIN_EMAIL, tutor?.email].filter(Boolean);
  const sent = await sendAll(c, to, `Session ${verb} (${student?.name || 'student'}): ${fmt(s.starts_at)} · Northstar`, html);
  return { ok: true, sent, to };
}

/* ───── exported for the reminder cron ───── */
export async function sendReminderEmail(c, { to, subject, studentName, whenIso, minutes, tutorName, meetingUrl, topic }) {
  const lines = [['Time', fmt(whenIso)], ['Length', `${minutes} min`]];
  if (tutorName) lines.push(['Tutor', tutorName]);
  if (topic) lines.push(['Topic', topic]);
  if (meetingUrl) lines.push(['Meeting link', meetingUrl]);
  return sendAll(c, to, subject, layout('⏰ Session reminder', `Upcoming session for ${esc(studentName || 'your student')}`, lines, 'Open your calendar →'));
}

/* ───── helpers ───── */
function recipientsFor(student) {
  return [...new Set([student?.email, student?.parent_email].filter(Boolean).map(x => x.toLowerCase()))];
}
async function people(c, studentId, tutorId) {
  const student = (await sbGet(c, `/rest/v1/students?select=id,name,email,parent_email,tutor_id&id=eq.${studentId}`))[0] || null;
  const tid = tutorId || student?.tutor_id;
  const tutor = tid ? (await sbGet(c, `/rest/v1/tutors?select=id,name,email&id=eq.${tid}`))[0] || null : null;
  return { student, tutor };
}
export function fmt(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

export function layout(kicker, headline, lines, cta, footnote) {
  const NAVY = '#1B2A4A', GOLD = '#C9A84C';
  const rows = lines.map(([k, v]) => `<tr><td style="padding:6px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;width:120px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#0f172a">${/^https?:\/\//.test(v) ? `<a href="${esc(v)}" style="color:#1a73e8">${esc(v)}</a>` : esc(v)}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <div style="max-width:540px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:${NAVY};padding:20px 24px;color:#fff"><div style="font-size:11px;font-weight:700;letter-spacing:.16em;color:${GOLD};text-transform:uppercase;margin-bottom:6px">${esc(kicker)}</div>
    <div style="font-size:17px;font-weight:700;line-height:1.35">${headline}</div></div>
    <div style="padding:20px 24px"><table style="width:100%;border-collapse:collapse">${rows}</table>
      ${footnote ? `<div style="margin-top:14px;font-size:13px;color:#475569;line-height:1.5">${esc(footnote)}</div>` : ''}
      <div style="margin-top:22px;text-align:center"><a href="${PORTAL_URL}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px">${esc(cta)}</a></div>
    </div></div><div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:14px">Northstar Academic Prep · Times shown in Pacific Time</div></div></body></html>`;
}

export async function sendAll(c, to, subject, html) {
  const list = [...new Set(to.filter(Boolean))];
  const results = await Promise.allSettled(list.map(addr => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: addr, reply_to: ADMIN_EMAIL, subject, html })
  }).then(async r => { if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`); return r.json(); })));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error('[notify-calendar] send failed', list[i], r.reason?.message); });
  return results.filter(r => r.status === 'fulfilled').length;
}

export async function sbGet(c, path) {
  const r = await fetch(c.sbUrl + path, { headers: { apikey: c.sbKey, Authorization: `Bearer ${c.sbKey}` } });
  if (!r.ok) throw new Error(`Supabase GET ${r.status}`);
  return r.json();
}
export async function sbPatch(c, path, body) {
  const r = await fetch(c.sbUrl + path, { method: 'PATCH', headers: { apikey: c.sbKey, Authorization: `Bearer ${c.sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Supabase PATCH ${r.status}`);
}
