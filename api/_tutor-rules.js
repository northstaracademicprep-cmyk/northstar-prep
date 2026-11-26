// Shared rules for the tutor hiring funnel. Underscore prefix: not a Vercel route.

export const MIN_COMMIT_MONTHS = 4;
export const MIN_WEEKLY_HOURS = 4;
export const MAX_PAY = 30;
export const MIN_AP_SCORE = 4;
export const HOURS_PER_STUDENT = 4;   // 2 sessions/week + a complimentary exam-week session + prep

export const AP_COURSES = [
  'AP Calculus AB', 'AP Calculus BC', 'AP Precalculus', 'AP Statistics',
  'AP Physics 1', 'AP Physics 2', 'AP Physics C: Mechanics', 'AP Physics C: E&M',
  'AP Chemistry', 'AP Biology', 'AP Environmental Science', 'AP Computer Science A', 'AP Computer Science Principles',
  'AP English Language', 'AP English Literature', 'AP US History', 'AP World History', 'AP European History',
  'AP US Government', 'AP Comparative Government', 'AP Macroeconomics', 'AP Microeconomics', 'AP Psychology',
  'AP Human Geography', 'AP Spanish Language', 'AP Art History',
];

export const STEM_RE = /(calc|precalc|statistic|physics|chem|bio|environmental|computer|algebra|geometry|trig|math)/i;

export const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Does a tutor course name cover a student subject? "AP Calculus BC" covers "Calculus BC",
// and a BC tutor can also cover AB. Loose on purpose; the admin makes the final call.
export function subjectCovers(course, studentSubject) {
  const c = norm(course).replace(/^ap /, ''), s = norm(studentSubject).replace(/^(ap|honors|ib) /, '');
  if (!c || !s) return false;
  if (c === s || c.includes(s) || s.includes(c)) return true;
  if (/calculus bc/.test(c) && /calculus( ab)?$|calc( ab)?$/.test(s)) return true;
  if (/calculus/.test(c) && /precalc/.test(s) === false && /calc/.test(s) && !/(ab|bc)/.test(s)) return true;
  if (/precalc/.test(c) && /algebra 2|algebra ii|trig/.test(s)) return true;
  if (/calculus/.test(c) && /precalc|algebra|geometry/.test(s)) return true;
  if (/statistic/.test(c) && /stat/.test(s)) return true;
  return false;
}

const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const yn = v => (v === true || v === 'yes' || v === 'true' ? true : (v === false || v === 'no' || v === 'false' ? false : null));

// A wanted course qualifies when they scored 4+ on that AP, or on a harder one that covers it
// (a BC 5 covers AB; an AB 5 does not cover BC).
export function qualifiedSubjects(wanted, taken) {
  return (wanted || []).filter(c => (taken || []).some(t =>
    Number(t.score) >= MIN_AP_SCORE && (norm(t.course) === norm(c) || subjectCovers(t.course, c))));
}

// Auto-DQ. Returns { reasons: string[], qualified: string[] }.
export function evaluate(a) {
  const reasons = [];
  if (a.commit_months == null || a.commit_months < MIN_COMMIT_MONTHS) reasons.push('Cannot commit at least 4 months');
  if (a.has_ipad !== true) reasons.push('No iPad');
  if (a.weekly_hours == null || a.weekly_hours < MIN_WEEKLY_HOURS) reasons.push('Under 4 hours per week');
  if (a.pay_expectation == null || a.pay_expectation > MAX_PAY) reasons.push('Pay expectation above $30/hr');
  const taken = Array.isArray(a.ap_taken) ? a.ap_taken : [];
  const qualified = qualifiedSubjects(a.ap_can_tutor, taken);
  if (!qualified.length) reasons.push('No AP score of 4 or 5 in a subject they want to tutor');
  return { reasons, qualified };
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIME_RE = /^\d{2}:\d{2}$/;

// Normalizes the public form body into a DB row. Returns { row } or { error }.
export function parseApplication(b) {
  const t = (k, max) => (typeof b[k] === 'string' ? b[k].trim().slice(0, max) : '') || null;
  const row = {
    name: t('name', 120), email: t('email', 160), phone: t('phone', 40), gender: t('gender', 20),
    school: t('school', 160), major: t('major', 160), grad_year: t('grad_year', 20), timezone: t('timezone', 60),
    other_subjects: t('other_subjects', 500), next_semester_classes: t('next_semester_classes', 800),
    referral: t('referral', 200), source: t('source', 40) || 'referral', pay_text: t('pay_text', 80),
  };
  if (!row.name) return { error: 'Please add your name.' };
  if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) return { error: 'Please add a valid email.' };
  if (!['female', 'male', 'other'].includes(row.gender)) return { error: 'Please select your gender.' };
  if (!row.phone || row.phone.replace(/\D/g, '').length < 10) return { error: 'Please add a phone number.' };
  row.ap_taken = (Array.isArray(b.ap_taken) ? b.ap_taken : [])
    .map(x => ({ course: String(x?.course || '').slice(0, 80), score: Number(x?.score) }))
    .filter(x => x.course && x.score >= 1 && x.score <= 5).slice(0, 30);
  row.ap_can_tutor = (Array.isArray(b.ap_can_tutor) ? b.ap_can_tutor : []).map(s => String(s).slice(0, 80)).slice(0, 30);
  row.availability_schedule = (Array.isArray(b.availability_schedule) ? b.availability_schedule : [])
    .filter(s => DAYS.includes(s?.day) && TIME_RE.test(s?.from || '') && TIME_RE.test(s?.to || ''))
    .map(s => ({ day: s.day, from: s.from, to: s.to })).slice(0, 21);
  row.weekly_hours = num(b.weekly_hours);
  row.commit_months = num(b.commit_months);
  row.pay_expectation = num(b.pay_expectation);
  row.has_ipad = yn(b.has_ipad);
  row.has_stylus = yn(b.has_stylus);
  row.can_screenshare = yn(b.can_screenshare);
  row.whiteboard_ok = yn(b.whiteboard_ok);
  row.understands_program = yn(b.understands_program);
  for (const k of ['weekly_hours', 'commit_months', 'pay_expectation', 'has_ipad']) {
    if (row[k] == null) return { error: 'Please answer every required question.' };
  }
  return { row };
}

// ---- Rubric ----
export const RUBRIC = [
  ['charisma', 'Charisma and presence'],
  ['energy', 'Energy (upbeat, high energy)'],
  ['clarity', 'Clarity (it makes sense)'],
  ['analogies', 'Good analogies and examples'],
  ['absorbability', 'Easy to absorb for a high schooler'],
  ['confidence', 'Confident, not shaky'],
  ['expertise', 'Expertise and accuracy'],
];
export const RUBRIC_PASS_AVG = 4.0;   // average of 7 criteria
export const RUBRIC_MIN_EACH = 3;

export function rubricSummary(r) {
  if (!r) return null;
  const vals = RUBRIC.map(([k]) => Number(r[k]) || 0);
  if (vals.some(v => v < 1)) return null;
  const total = vals.reduce((a, b) => a + b, 0);
  const avg = total / vals.length;
  return { total, max: vals.length * 5, avg: Math.round(avg * 100) / 100, pass: avg >= RUBRIC_PASS_AVG && vals.every(v => v >= RUBRIC_MIN_EACH) };
}

// ---- Match scoring (new tutors only carry a cap; legacy tutors have max_students null) ----
export function slotsLeft(tutor, activeCount) {
  if (tutor.max_students == null) return null;       // legacy: no cap tracked
  return Math.max(0, tutor.max_students - activeCount);
}

export function scoreMatch({ student, prefDays, tutor, activeCount }) {
  const reasons = [];
  let score = 0;
  const subjects = student.subjects || [];
  // Subject expertise (0-50)
  let best = 0, bestWhy = '';
  const aps = Array.isArray(tutor.ap_scores) ? tutor.ap_scores : [];
  for (const s of subjects) {
    for (const a of aps) {
      if (subjectCovers(a.course, s)) {
        const sc = Number(a.score) >= 5 ? 50 : Number(a.score) === 4 ? 40 : 15;
        if (sc > best) { best = sc; bestWhy = `${a.course} score ${a.score}`; }
      }
    }
    if (!best && (tutor.subjects_can_teach || []).some(c => subjectCovers(c, s))) { best = 25; bestWhy = 'lists the subject'; }
  }
  if (best) {
    const stemBonus = subjects.some(s => STEM_RE.test(s)) && STEM_RE.test(`${tutor.major || ''}`) ? 5 : 0;
    score += best + stemBonus;
    reasons.push(`Subject: ${bestWhy}${stemBonus ? ', STEM major' : ''}`);
  } else reasons.push('No subject match');
  // Availability overlap on days (0-30)
  const tDays = new Set([...(tutor.availability_days || []), ...((tutor.availability_schedule || []).map(s => s.day))]);
  const shared = (prefDays || []).filter(d => tDays.has(d));
  if (shared.length) { score += Math.min(30, shared.length * 10); reasons.push(`Shared days: ${shared.map(d => d.slice(0, 3)).join(', ')}`); }
  else if (prefDays?.length && tDays.size) reasons.push('No shared days');
  else reasons.push('Days unknown');
  // Slots (0-15)
  const left = slotsLeft(tutor, activeCount);
  if (left === 0) { score -= 100; reasons.push('Full (0 slots left)'); }
  else if (left != null) { score += Math.min(15, left * 5); reasons.push(`${left} slot${left === 1 ? '' : 's'} left`); }
  else reasons.push(`Legacy tutor, ${activeCount} student${activeCount === 1 ? '' : 's'} now`);
  // Gender: soft bonus only
  if (student.gender && tutor.gender && norm(student.gender) === norm(tutor.gender)) {
    score += 5; reasons.push('Same gender (soft bonus)');
  }
  return { score, reasons, covered: !!best, slotsLeft: left };
}
