// ============================================================
// /api/reset-practice
// Server-side delete of a single student's practice attempts.
// Wipes BOTH the vault (student_attempts) and the legacy in-portal
// quiz (practice_attempts) for that student, and bumps the student's
// practice_reset_at so other devices flush their seen-question cache
// on next login. Account, sessions, homework, messages are untouched.
//
// Gating: requires { adminSecret } in the request body and compares it
// to process.env.ADMIN_RESET_SECRET on the server. The client never
// sees the real value. Returns 401 on mismatch, 503 if the env var
// isn't configured (so the button is effectively disabled until you
// set it in Vercel project settings → Environment Variables).
//
// Why not RLS / real auth: the project has no auth layer today — the
// admin "login" is a hardcoded code in portal.html. This adds one
// targeted hardening on the highest-risk action (irreversible delete)
// without rebuilding all auth.
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sbUrl  = process.env.SUPABASE_URL;
  const sbKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.ADMIN_RESET_SECRET;
  if (!sbUrl || !sbKey) return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server' });
  if (!secret) {
    return res.status(503).json({
      error: 'ADMIN_RESET_SECRET not configured on server — set it in Vercel project settings before using this endpoint',
    });
  }

  const { studentId, adminSecret } = req.body || {};
  if (typeof adminSecret !== 'string' || adminSecret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!isUuid(studentId)) {
    return res.status(400).json({ error: 'studentId must be a UUID' });
  }

  const headers = {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
    // Tell PostgREST to return the deleted rows so we can count them.
    Prefer: 'return=representation',
  };

  let vaultDeleted, legacyDeleted;
  try {
    [vaultDeleted, legacyDeleted] = await Promise.all([
      countingDelete(`${sbUrl}/rest/v1/student_attempts?student_id=eq.${studentId}`, headers),
      countingDelete(`${sbUrl}/rest/v1/practice_attempts?student_id=eq.${studentId}`, headers),
    ]);
  } catch (err) {
    return res.status(502).json({ error: 'Delete failed', detail: err.message });
  }

  // Bump practice_reset_at so other browsers flush their pv_seen_* cache
  // on the student's next login. Non-fatal if it fails.
  try {
    await fetch(`${sbUrl}/rest/v1/students?id=eq.${studentId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ practice_reset_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.warn('practice_reset_at bump failed (non-fatal):', err.message);
  }

  console.log(`[reset-practice] student=${studentId} vault=${vaultDeleted} legacy=${legacyDeleted}`);
  return res.status(200).json({ vaultDeleted, legacyDeleted });
}

function isUuid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function countingDelete(url, headers) {
  const r = await fetch(url, { method: 'DELETE', headers });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase DELETE ${r.status}: ${detail}`);
  }
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}
