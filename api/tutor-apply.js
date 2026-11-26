// POST /api/tutor-apply : public tutor application. Runs the auto-DQ rules and stores the row.
// Returns { ok, qualified, token? }. A DQ'd applicant gets a polite close and no token.
import { evaluate, parseApplication } from './_tutor-rules.js';
import { sb, sbEnv, cors } from './_sb.js';

export default async function handler(req, res) {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const env = sbEnv();
  if (!env) return res.status(500).json({ error: 'Server not configured' });
  const body = req.body || {};
  if (body.website) return res.status(200).json({ ok: true, qualified: false });   // honeypot

  const { row, error } = parseApplication(body);
  if (error) return res.status(400).json({ error });
  const { reasons } = evaluate(row);
  row.dq_reasons = reasons;
  row.status = reasons.length ? 'dq' : 'audition_pending';
  try {
    const out = await sb(env, 'POST', 'tutor_applications', row);
    const saved = out[0];
    return res.status(200).json({ ok: true, qualified: !reasons.length, token: reasons.length ? null : saved.token });
  } catch (e) {
    console.error('[tutor-apply]', e.message);
    return res.status(502).json({ error: 'Could not save your application. Please try again in a minute.' });
  }
}
