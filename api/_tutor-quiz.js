// Tutor quiz: 20 questions covering the Tutor Hub end to end. Answers stay server-side.
// Pass is 18 of 20 (90%).
export const PASS_SCORE = 18;

export const QUIZ = [
  // Approach
  { id: 'a1', q: 'What are the five steps of the Northstar tutoring style (the Guide to 5), in order?',
    o: ['Lecture, Notes, Quiz, Test, Review', 'Decode, Practice, Model, Reinforce, Test', 'Decode, Model, Practice, Test, Reinforce', 'Explain, Drill, Quiz, Grade, Repeat'], a: 2 },
  { id: 'a3', q: 'What does "Decode" mean in practice?',
    o: ['Screen-share a long deck and lecture while the student takes notes', 'Break each concept into simpler, breathable terms and have a friendly conversation so real questions come up', 'Hand the student the formula sheet', 'Have the student read the textbook section first'], a: 1 },
  { id: 'a4', q: 'In AP subjects, why does the "Model" step matter so much?',
    o: ['The right answer is only half the game; formatting and structuring answers to the AP rubric to earn maximum points is the other half', 'Students only need the final answer', 'It lets you skip practice problems', 'It is only for the last week before the exam'], a: 0 },
  { id: 'a5', q: 'How should the "Practice" step work?',
    o: ['The tutor solves everything while the student watches', 'The student walks you through problems and explains the content back, and it bleeds into targeted homework', 'The student works silently with the camera off', 'It is skipped if time runs short'], a: 1 },
  { id: 'a7', q: 'How often should students take tests, and why?',
    o: ['Never, it stresses them out', 'Bi-weekly, to verify real understanding and build hands-on testing experience', 'Only the week of the AP exam', 'Once at the very end of the program'], a: 1 },
  // Communication channel
  { id: 'g1', q: 'Where must all communication between you, the student, the parent and Northstar happen?',
    o: ['Wherever is easiest, including direct texts and calls', 'In the group chat we set up (iMessage or WhatsApp) and nowhere else', 'In the group chat, plus direct texts for anything quick', 'By email with the parent only'], a: 1 },
  { id: 'g2', q: 'A student texts you privately asking a homework question. What do you do?',
    o: ['Answer it privately, it is faster', 'Reply that you will answer it in the group chat, and keep all communication there', 'Ignore it', 'Answer privately but tell no one'], a: 1 },
  { id: 'g3', q: 'A parent calls or texts you directly to discuss their student. What do you do?',
    o: ['Take the call, parents like that', 'Politely move the conversation to the group chat; there is no direct texting or dialing with families', 'Give the parent your personal email too', 'Block the number'], a: 1 },
  // Lesson planning and session prep
  { id: 'p1', q: 'When should the full lesson plan (topics, slide deck, practice problems) be drafted?',
    o: ['2 days before the session', 'An hour before', 'During the session', 'The week after'], a: 0 },
  { id: 'p2', q: 'Who sees your materials before the session, and when?',
    o: ['Nobody sees them', 'Sahib, via Gmail or text, 24 hours before so tweaks happen before the session', 'The parent, one hour before', 'Sahib, after the session'], a: 1 },
  { id: 'p3', q: 'What is the rule for slides?',
    o: ['Put the full explanation on each slide and read it aloud', 'Slides carry main ideas only, never walls of text; you talk around them', 'Slides are optional and never shared', 'Use at least 40 slides per session'], a: 1 },
  { id: 'p4', q: 'What should homework look like after a session?',
    o: ['None, the portal assigns it', '15 to 20 targeted practice problems as a PDF, drilling exactly what the session covered', '100 mixed problems from the whole course', 'One problem to keep it light'], a: 1 },
  // Running a session
  { id: 's1', q: 'How should you open a session?',
    o: ['Jump straight into new material', 'Check homework and clear any confusion from last session, then lay out the agenda with specific time splits', 'Ask the student what they want to do', 'Start with a quiz'], a: 1 },
  { id: 's3', q: 'How should you close a session?',
    o: ['Just end the call', 'Recap what was covered, answer questions, schedule the next session ON the call (even a rough time), and share next session\'s game plan', 'Tell them you will message about scheduling later', 'Ask the parent to schedule it'], a: 1 },
  // Communication and scheduling
  { id: 'c1', q: 'Which is the correct communication loop around a session?',
    o: ['Confirm 48 hrs before, confirm 24 hrs before, heads-up 1 hr before that the link is coming, send the link 5 min before', 'Message only if the student does', 'Send the link at the start time and nothing else', 'One reminder a week before'], a: 0 },
  { id: 'c2', q: 'You cannot make a scheduled session because of a conflict. What do you do?',
    o: ['Do not show up and apologize later', 'Tell the student and Sahib as early as possible and offer reschedule times', 'Ask the student to cancel it', 'Wait to see if they message first'], a: 1 },
  { id: 'c3', q: 'A parent offers to pay you directly to skip the portal and Northstar. What do you do?',
    o: ['Say yes, it helps you both', 'Politely decline, explain that everything runs through Northstar, and tell Sahib', 'Agree for one session as a trial', 'Ignore the message'], a: 1 },
  // After the session and the portal
  { id: 'o1', q: 'What is the correct sequence after a session?',
    o: ['Log it at the end of the month', 'Paste the Fathom link, log the session, upload materials, assign homework, then message the student confirming it is all uploaded and the next session time', 'Message the parent that it went well and stop', 'Log it only if the student asks'], a: 1 },
  { id: 'o2', q: 'What tools record and support every session, and how are they used?',
    o: ['Zoom cloud recording, emailed to the parent', 'Fathom auto-records the Google Meet and you paste its share link in the portal session log; send the Excalidraw live collab link to the student in the Meet chat', 'Phone recording kept private', 'Nothing is recorded'], a: 1 },
  { id: 'o3', q: 'A student submits homework in the portal and it shows "pending grade." How fast should you grade it, and how fast should you reply to portal messages?',
    o: ['Grade within 24 hours; reply to messages within a couple of hours', 'Grade within a week; reply whenever', 'Grade before the exam; reply the next day', 'Grade only on request; do not reply to messages'], a: 0 },
];

export function publicQuiz() {
  return QUIZ.map(({ id, q, o }) => ({ id, q, o }));
}

export function gradeQuiz(answers) {
  const a = answers && typeof answers === 'object' ? answers : {};
  let score = 0;
  for (const q of QUIZ) if (Number(a[q.id]) === q.a) score++;
  return { score, total: QUIZ.length, passed: score >= PASS_SCORE };
}
