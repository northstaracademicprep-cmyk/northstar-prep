// Tutor quiz: 7 scenario questions + 5 Tutor Hub questions. Answers stay server-side.
export const PASS_SCORE = 10;   // of 12

export const QUIZ = [
  // ---- Scenarios ----
  { id: 's1', kind: 'scenario', q: 'A parent texts you: "Could we just pay you directly and skip the portal? We would save on fees and you would earn more." What do you do?',
    o: ['Say yes, since it helps you both', 'Politely decline, explain that everything runs through Northstar, and tell Sahib right away', 'Ignore the message so it does not get awkward', 'Agree but only for one session as a trial'], a: 1 },
  { id: 's2', kind: 'scenario', q: 'You have a student assigned and no one has told you when to start. What is the right move?',
    o: ['Wait until the family reaches out', 'Ask Sahib to schedule it for you', 'Take ownership: contact the student and parent, lock in days and times, and start prepping', 'Wait for a reminder from Northstar'], a: 2 },
  { id: 's3', kind: 'scenario', q: 'Your student says, "I just want to go over whatever I am confused about today." How do you run the session?',
    o: ['Let them pick topics all session', 'Politely lead: Northstar is proactive, so you already planned the lesson from their game plan and weak areas, and you check for questions along the way', 'Cancel since they have no agenda', 'Give them a worksheet and stay quiet'], a: 1 },
  { id: 's4', kind: 'scenario', q: 'Your session ended 10 minutes ago. Which sequence is correct?',
    o: ['Nothing, you log it at the end of the month', 'Paste the Fathom link, log the session, upload materials, assign homework, then message the student confirming it is all uploaded and the next session time', 'Message the parent that it went well and stop there', 'Log the session only if the student asks'], a: 1 },
  { id: 's5', kind: 'scenario', q: 'The night before a session you realize you have not built the slides or homework yet. What should have happened and what do you do now?',
    o: ['Normally the full plan is ready 2 days before and shared with Sahib 24 hours before; tell Sahib immediately, finish it, and share it right away', 'Wing it, students will not notice', 'Skip the slides and lecture from the textbook', 'Reschedule without telling anyone'], a: 0 },
  { id: 's6', kind: 'scenario', q: 'Your student is lost on a topic but the agenda says you should move on in 5 minutes. What do you do?',
    o: ['Stick to the agenda no matter what', 'Slow down and make sure they get it, then adjust the plan; never rush past a topic just to hit the agenda', 'Assign the topic as homework and move on', 'Tell them they should have studied'], a: 1 },
  { id: 's7', kind: 'scenario', q: 'You cannot make a scheduled session because of a conflict. What do you do?',
    o: ['Do not show up and apologize later', 'Tell the student and Sahib as early as possible and offer a reschedule time', 'Ask the student to cancel it', 'Wait to see if they message first'], a: 1 },
  // ---- Tutor Hub ----
  { id: 'h1', kind: 'hub', q: 'What are the five steps of the Northstar tutoring style (the Guide to 5), in order?',
    o: ['Lecture, Notes, Quiz, Test, Review', 'Decode, Model, Practice, Test, Reinforce', 'Explain, Drill, Quiz, Grade, Repeat', 'Decode, Practice, Model, Reinforce, Test'], a: 1 },
  { id: 'h2', kind: 'hub', q: 'Which of these is the rule for slides?',
    o: ['Put the full explanation on each slide and read it aloud', 'Slides carry main ideas only, never walls of text; you talk around them', 'Slides are optional and never shared', 'Use a different deck for every student with at least 40 slides'], a: 1 },
  { id: 'h3', kind: 'hub', q: 'How much homework should you assign after a session, and what should it be?',
    o: ['None, the portal assigns it', '15 to 20 targeted practice problems as a PDF, drilling exactly what the session covered', '100 mixed problems from the whole course', 'One problem, to keep it light'], a: 1 },
  { id: 'h4', kind: 'hub', q: 'A student submits homework in the portal. How fast should you grade it?',
    o: ['Within 24 hours', 'Within a week', 'Before the next exam', 'Only if the student asks'], a: 0 },
  { id: 'h5', kind: 'hub', q: 'What tool records every Northstar session, and what do you do with it after?',
    o: ['Zoom cloud recording, email it to the parent', 'Fathom auto-records the Google Meet; paste the Fathom share link into the session log in the portal', 'Phone screen recording, keep it private', 'Nothing is recorded'], a: 1 },
];

export function publicQuiz() {
  // Fixed order, answers removed.
  return QUIZ.map(({ id, kind, q, o }) => ({ id, kind, q, o }));
}

export function gradeQuiz(answers) {
  const a = answers && typeof answers === 'object' ? answers : {};
  let score = 0;
  for (const q of QUIZ) if (Number(a[q.id]) === q.a) score++;
  return { score, total: QUIZ.length, passed: score >= PASS_SCORE };
}
