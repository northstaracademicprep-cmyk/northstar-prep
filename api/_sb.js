// Tiny Supabase REST helper (service role). Underscore prefix: not a Vercel route.
export function sbEnv() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
export async function sb(env, method, path, body, prefer = 'return=representation') {
  const r = await fetch(`${env.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
export function cors(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-code');
}

// Best-effort email through Resend. Never throws; returns true when accepted.
const ADMIN_EMAIL = 'northstaracademicprep@gmail.com';
const RESEND_FROM = 'Northstar Academic Prep <reports@send.northstaracademicprep.com>';
export async function sendMail({ to, bcc, subject, html }) {
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) { console.warn('[mail] RESEND_API_KEY not set, skipping'); return false; }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to, bcc, reply_to: ADMIN_EMAIL, subject, html }),
    });
    if (!r.ok) console.warn(`[mail] rejected ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    return r.ok;
  } catch (e) { console.warn('[mail] failed', e.message); return false; }
}
export { ADMIN_EMAIL };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
