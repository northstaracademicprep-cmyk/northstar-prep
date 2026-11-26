// /api/onboarding?r=tutor-app : applicant-facing steps, keyed by the private token from the apply step.
//   POST { token, action: 'get' }                      -> status + quiz questions (no answers)
//   POST { token, action: 'audition', url }            -> saves the audition video link
//   POST { token, action: 'quiz', answers: {id: idx} } -> grades server-side
const HUB_URL = 'https://gamma.app/docs/Northstar-Tutor-Hub-Your-Complete-Onboarding-Guide-vmvwl4l8iyxyg9s';
import { publicQuiz, gradeQuiz, PASS_SCORE } from './_tutor-quiz.js';
import { sb, sbEnv, cors, sendMail, esc, ADMIN_EMAIL } from './_sb.js';

export default async function handler(req, res) {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const env = sbEnv();
  if (!env) return res.status(500).json({ error: 'Server not configured' });
  const { token, action, url, answers } = req.body || {};
  if (!/^[a-f0-9]{32}$/.test(token || '')) return res.status(400).json({ error: 'Invalid link.' });
  try {
    const rows = await sb(env, 'GET', `tutor_applications?token=eq.${token}&select=id,name,email,status,audition_url,quiz_score,quiz_total,quiz_passed`);
    const app = rows?.[0];
    if (!app) return res.status(404).json({ error: 'Invalid link.' });

    if (action === 'audition') {
      let u;
      try { u = new URL(String(url || '').trim()); } catch { return res.status(400).json({ error: 'Please paste a full link (https://...).' }); }
      if (!/^https?:$/.test(u.protocol)) return res.status(400).json({ error: 'Please paste a full link (https://...).' });
      if (app.status !== 'audition_pending') return res.status(400).json({ error: 'Your video is already submitted.' });
      const patch = { audition_url: u.toString().slice(0, 500), audition_submitted_at: new Date().toISOString(), status: 'video_review' };
      await sb(env, 'PATCH', `tutor_applications?id=eq.${app.id}`, patch, 'return=minimal');
      await sendMail({ to: ADMIN_EMAIL, subject: `Tutor audition to review: ${app.name}`,
        html: `<p><b>${esc(app.name)}</b> submitted an audition video.</p><p><a href="${esc(patch.audition_url)}">Watch the video</a>, then approve or decline in the admin portal under Tutor Hiring.</p>` });
      return res.status(200).json({ ok: true });
    }
    if (action === 'quiz') {
      if (app.status !== 'quiz_pending') return res.status(400).json({ error: 'The quiz is not open for you right now.' });
      const g = gradeQuiz(answers);
      await sb(env, 'PATCH', `tutor_applications?id=eq.${app.id}`, {
        quiz_answers: answers || {}, quiz_score: g.score, quiz_total: g.total, quiz_passed: g.passed,
        quiz_submitted_at: new Date().toISOString(), status: g.passed ? 'call_pending' : 'quiz_pending',
      }, 'return=minimal');
      if (g.passed) await sendMail({ to: ADMIN_EMAIL, subject: `Tutor passed the quiz: ${app.name} (${g.score}/${g.total})`,
        html: `<p><b>${esc(app.name)}</b> passed the tutor quiz with ${g.score} of ${g.total}. Next: the 5 minute check-in call, then Approve in Tutor Hiring.</p>` });
      return res.status(200).json({ ok: true, passed: g.passed, score: g.score, total: g.total, needed: PASS_SCORE });
    }
    // get
    return res.status(200).json({
      ok: true, name: app.name, status: app.status, hasAudition: !!app.audition_url,
      quiz: app.status === 'quiz_pending' ? publicQuiz() : null, needed: PASS_SCORE,
      hubUrl: app.status === 'quiz_pending' ? HUB_URL : null,
      score: app.quiz_score, total: app.quiz_total,
    });
  } catch (e) {
    console.error('[tutor-app]', e.message);
    return res.status(502).json({ error: 'Something went wrong. Please try again.' });
  }
}
