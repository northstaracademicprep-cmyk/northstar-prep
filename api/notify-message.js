// ============================================================
// /api/notify-message
// Sends email notifications when a portal message is created.
// Fan-out: every participant in the message's thread EXCEPT the
// sender. Idempotent via messages.notified_at — once set, repeat
// calls return early without sending.
//
// POST { messageId, studentId }
//
// Auth: lightweight. The caller must supply a (messageId, studentId)
// pair that matches a real row in messages. Anyone with read access
// to the messages table can call this, but the worst they can do is
// trigger a single email per real message (idempotency blocks the
// rest). This avoids needing ADMIN_RESET_SECRET, which would break
// the client-side call from portal.html:6638.
// ============================================================

const ADMIN_EMAIL   = 'sahibsidhu190@gmail.com';
const PORTAL_URL    = 'https://portal.northstaracademicprep.com';
const RESEND_FROM   = 'Northstar Academic Prep <reports@send.northstaracademicprep.com>';
const PREVIEW_CHARS = 200;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sbUrl     = process.env.SUPABASE_URL;
  const sbKey     = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!sbUrl || !sbKey) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server' });
  if (!resendKey)       return res.status(500).json({ error: 'RESEND_API_KEY not configured on server' });

  const { messageId, studentId } = req.body || {};
  if (!messageId || typeof messageId !== 'string') return res.status(400).json({ error: 'Missing messageId' });
  if (!studentId || typeof studentId !== 'string') return res.status(400).json({ error: 'Missing studentId' });

  try {
    const result = await notifyMessage(sbUrl, sbKey, resendKey, messageId, studentId);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({ error: 'notify failed', detail: err.message });
  }
}

async function notifyMessage(sbUrl, sbKey, resendKey, messageId, studentId) {
  // 1. Fetch the message. The (messageId, studentId) pair check is the
  //    lightweight auth — both values must point at the same real row.
  const msgRows = await sbGet(sbUrl, sbKey,
    `/rest/v1/messages?select=id,student_id,sender_role,sender_name,content,created_at,notified_at&id=eq.${encodeURIComponent(messageId)}`);
  const msg = msgRows[0];
  if (!msg) return { ok: false, reason: 'message not found' };
  if (msg.student_id !== studentId) return { ok: false, reason: 'student_id mismatch' };

  // 2. Idempotency. Repeat calls (e.g. client retries after a flaky
  //    network) are no-ops once notified_at has been written.
  if (msg.notified_at) {
    return { ok: true, skipped: true, reason: 'already notified', notified_at: msg.notified_at };
  }

  // 3. Resolve the thread's participants: the student row (always),
  //    and the assigned tutor (if any).
  const studentRows = await sbGet(sbUrl, sbKey,
    `/rest/v1/students?select=id,name,email,tutor_id&id=eq.${encodeURIComponent(studentId)}`);
  const student = studentRows[0];
  if (!student) return { ok: false, reason: 'student not found' };

  let tutor = null;
  if (student.tutor_id) {
    const tutorRows = await sbGet(sbUrl, sbKey,
      `/rest/v1/tutors?select=id,name,email&id=eq.${encodeURIComponent(student.tutor_id)}`);
    tutor = tutorRows[0] || null;
  }

  // 4. Build the recipient list — everyone in the thread EXCEPT the
  //    sender. Recipients with no email on file are quietly dropped
  //    (same pattern as weekly-report.js with missing parent_email).
  //      sender='student' → tutor + admin
  //      sender='tutor'   → student + admin
  //      sender='admin'   → student + tutor
  const sender = msg.sender_role;
  const recipients = [];
  if (sender !== 'student' && student.email)         recipients.push({ to: student.email, label: 'student' });
  if (sender !== 'tutor'   && tutor && tutor.email)  recipients.push({ to: tutor.email,   label: 'tutor'   });
  if (sender !== 'admin')                            recipients.push({ to: ADMIN_EMAIL,   label: 'admin'   });

  // 5. Compose and fan out. allSettled so a single Resend failure
  //    doesn't block other recipients from being reached.
  const senderName = msg.sender_name || roleDisplay(sender);
  const subject = `New message from ${senderName} · Northstar`;
  const html    = buildNotificationHtml({
    senderName,
    senderRole: sender,
    studentName: student.name,
    preview: previewContent(msg.content),
  });

  const results = await Promise.allSettled(
    recipients.map(r => sendResendEmail(resendKey, { to: r.to, subject, html }))
  );
  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failures = results
    .map((r, i) => r.status === 'rejected' ? { to: recipients[i].to, error: r.reason?.message || String(r.reason) } : null)
    .filter(Boolean);

  // 6. Mark notified_at if anything went out, OR if there was no one to
  //    notify (e.g. sender=admin with no student.email and no tutor —
  //    nothing left to send). Either way the message is "done" and
  //    shouldn't be retried. Skip the write only if every send failed,
  //    so a transient Resend outage can be retried later.
  if (sent > 0 || recipients.length === 0) {
    try {
      await sbPatch(sbUrl, sbKey,
        `/rest/v1/messages?id=eq.${encodeURIComponent(messageId)}`,
        { notified_at: new Date().toISOString() });
    } catch (e) {
      console.warn(`[notify-message] sent=${sent} but could not write notified_at: ${e.message}`);
    }
  }

  return {
    ok: true,
    sent,
    skipped_no_recipients: recipients.length === 0,
    failures,
    recipients: recipients.map(r => ({ label: r.label, to: r.to })),
  };
}

function roleDisplay(role) {
  if (role === 'student') return 'Student';
  if (role === 'tutor')   return 'Tutor';
  if (role === 'admin')   return 'Northstar';
  return role || 'Northstar';
}

function previewContent(content) {
  const s = (content || '').replace(/\s+/g, ' ').trim();
  if (s.length <= PREVIEW_CHARS) return s;
  return s.slice(0, PREVIEW_CHARS).trimEnd() + '…';
}

// ── Resend send ──────────────────────────────────────────────────
async function sendResendEmail(resendKey, { to, subject, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to,
      reply_to: ADMIN_EMAIL,
      subject,
      html,
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Resend ${r.status}: ${detail.slice(0, 400)}`);
  }
  return r.json().catch(() => ({}));
}

// ── HTML builder ─────────────────────────────────────────────────
function buildNotificationHtml({ senderName, senderRole, studentName, preview }) {
  // Inline styles only — Gmail/Outlook strip <style> blocks. Brand
  // colors match the weekly-report email for visual continuity.
  const NAVY = '#1B2A4A';
  const GOLD = '#C9A84C';
  const senderLabel = roleDisplay(senderRole);
  const safeSender  = escapeHtmlEmail(senderName);
  const safeStudent = escapeHtmlEmail(studentName || 'a student');
  const safePreview = escapeHtmlEmail(preview);

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <div style="max-width:540px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <div style="background:${NAVY};padding:20px 24px;color:#fff">
        <div style="font-size:11px;font-weight:700;letter-spacing:.16em;color:${GOLD};text-transform:uppercase;margin-bottom:6px">💬 New Message</div>
        <div style="font-size:17px;font-weight:700;line-height:1.35">${safeSender} (${senderLabel}) sent a message about ${safeStudent}</div>
      </div>
      <div style="padding:20px 24px">
        <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Preview</div>
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.55;color:#0f172a">${safePreview}</div>
        <div style="margin-top:22px;text-align:center">
          <a href="${PORTAL_URL}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px">Open the portal →</a>
        </div>
        <div style="margin-top:18px;font-size:12px;color:#94a3b8;text-align:center">Reply directly in the Messages tab — replies to this email aren't posted to the thread.</div>
      </div>
    </div>
    <div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:14px">Northstar Academic Prep</div>
  </div>
</body></html>`;
}

function escapeHtmlEmail(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Supabase helpers (same style as api/weekly-report.js) ────────
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
    headers: { ...sbHeaders(sbKey), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase PATCH ${r.status}: ${detail.slice(0, 400)}`);
  }
  return true;
}
