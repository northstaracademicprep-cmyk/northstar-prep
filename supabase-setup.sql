-- ============================================================
-- NORTHSTAR ACADEMIC PREP — Supabase Database Setup
-- Paste this entire script into Supabase SQL Editor and Run
-- ============================================================

-- ── SECTION 1: CREATE TABLES ──────────────────────────────

CREATE TABLE IF NOT EXISTS tutors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    email TEXT,
    school TEXT,
    subjects TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    grade TEXT,
    school TEXT,
    program_type TEXT DEFAULT 'ap-prep',
    subjects TEXT[],
    tutor_id UUID REFERENCES tutors(id),
    hours_total DECIMAL(4,1),
    hours_used DECIMAL(4,1),
    exam_date DATE,
    payment_status TEXT,
    payment_amount DECIMAL(8,2),
    invoice_number TEXT,
    payment_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    tutor_id UUID REFERENCES tutors(id),
    session_date DATE,
    duration_hours DECIMAL(3,1),
    topic TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS homework (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    tutor_id UUID REFERENCES tutors(id),
    title TEXT,
    description TEXT,
    due_date DATE,
    status TEXT DEFAULT 'pending',
    submission_text TEXT,
    submission_date TIMESTAMPTZ,
    feedback TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject TEXT,
    question_type TEXT CHECK (question_type IN ('MCQ','SAQ','LEQ','DBQ')),
    period_unit TEXT,
    question_text TEXT,
    stimulus TEXT,
    options JSONB,
    correct_answer TEXT,
    answer_guidance TEXT,
    points INTEGER DEFAULT 1,
    source_year INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    question_id UUID REFERENCES practice_questions(id),
    answer_text TEXT,
    selected_option TEXT,
    score DECIMAL(3,1),
    max_score INTEGER,
    feedback TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    graded_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    tutor_id UUID REFERENCES tutors(id),
    file_name TEXT,
    file_url TEXT,
    description TEXT,
    file_type TEXT DEFAULT 'other',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    title TEXT,
    message TEXT,
    author TEXT DEFAULT 'Northstar Academic Prep',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    amount DECIMAL(8,2),
    invoice_number TEXT,
    status TEXT DEFAULT 'pending',
    payment_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT
);

-- ── SECTION 2: DISABLE ROW LEVEL SECURITY ────────────────

ALTER TABLE tutors DISABLE ROW LEVEL SECURITY;
ALTER TABLE students DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE homework DISABLE ROW LEVEL SECURITY;
ALTER TABLE practice_questions DISABLE ROW LEVEL SECURITY;
ALTER TABLE practice_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE files DISABLE ROW LEVEL SECURITY;
ALTER TABLE announcements DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_access DISABLE ROW LEVEL SECURITY;

-- ── SECTION 3: SEED DATA ──────────────────────────────────

INSERT INTO admin_access (code, name)
VALUES ('NAP-ADMIN', 'Northstar Admin')
ON CONFLICT (code) DO NOTHING;

INSERT INTO tutors (name, code, school, subjects)
VALUES ('Siddarth Shasti', 'SID-TUTOR', 'UC Santa Cruz',
    ARRAY['AP US History','AP World History','AP Government'])
ON CONFLICT (code) DO NOTHING;

INSERT INTO students (name, code, grade, program_type, subjects, tutor_id,
    hours_total, hours_used, exam_date, payment_status, payment_amount, invoice_number, payment_date)
VALUES (
    'Nav Singh', 'NAV-APUSH26', '11th Grade', 'ap-prep',
    ARRAY['AP US History'],
    (SELECT id FROM tutors WHERE code = 'SID-TUTOR'),
    20.0, 18.5, '2026-05-09', 'paid', 1200.00, 'NSP-2026-001', '2026-03-15'
) ON CONFLICT (code) DO NOTHING;

-- ── SESSIONS (12 past + 1 upcoming) ──────────────────────

INSERT INTO sessions (student_id, tutor_id, session_date, duration_hours, topic, notes) VALUES
((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-03-02',1.5,'Period 1 & 2: Colonial Foundations and Early America',
 'Covered Native American societies, European contact, and colonial development. Nav demonstrated strong recall of the Columbian Exchange. Reviewed encomienda system and early labor systems. Assigned reading on Chesapeake vs. New England colonial models.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-03-05',1.5,'Period 3: Revolution, Constitution, and Early Republic',
 'Analyzed causes of the American Revolution and Declaration of Independence foundations. Reviewed Articles of Confederation weaknesses and Constitutional Convention debates. Nav struggled with Federalist vs. Anti-Federalist arguments — worked through Federalist No. 10 together. Strong improvement by end of session.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-03-09',1.5,'Period 3 Deep Dive: Market Revolution and Jeffersonian Era',
 'Focused on the Market Revolution, transportation networks, early industrialization. Covered Jeffersonian vs. Hamiltonian visions. Reviewed Louisiana Purchase implications. Practiced SAQ on Market Revolution — good evidence, thesis needs sharpening.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-03-12',1.5,'Period 4: Jacksonian Democracy and Antebellum Reform',
 'Covered Jacksonian Democracy, Bank War, expansion of suffrage. Reviewed antebellum reform movements: abolition, temperance, women''s rights (Seneca Falls). Nav connected reform movements to Second Great Awakening effectively. Practiced LEQ outline — solid argument, needs more specific body paragraph evidence.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-03-16',1.5,'Period 4: Manifest Destiny and Sectional Tensions',
 'Analyzed Manifest Destiny ideology and consequences for Native Americans and Mexico. Covered Mexican-American War and Compromise of 1850. Nav showed excellent analytical thinking connecting Manifest Destiny to the growing sectional divide. MCQ drill: 8/10 correct.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-03-19',1.5,'Period 5: Civil War Causation and the Slavery Crisis',
 'Deep dive into Civil War causation: Compromise of 1850, Kansas-Nebraska Act, Bleeding Kansas, Dred Scott, John Brown, Election of 1860. Nav articulated escalation of sectional tensions effectively. Introduced DBQ structure and worked through a sample prompt together.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-03-23',1.5,'Period 5: Civil War and Reconstruction',
 'Covered Civil War turning points and Lincoln''s evolving war aims. Emancipation Proclamation context. Introduced Reconstruction: Presidential vs. Radical plans, 13th/14th/15th Amendments. Nav wrote a full DBQ — strong contextualization and document use, needs stronger outside evidence. Provided detailed written feedback.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-03-30',1.5,'Period 6: Gilded Age, Industrialization, and Labor',
 'Rapid industrialization, rise of big business, Gilded Age politics. Labor movement: Knights of Labor, AFL, Homestead Strike, Pullman Strike. Populist movement and agrarian discontent. Nav connected economic inequality to political responses strongly. SAQ on Gilded Age — excellent specific evidence.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-04-02',1.5,'Period 6 & 7: Imperialism and the Progressive Era',
 'Spanish-American War, overseas expansion, debates over imperialism. Progressive Era reforms: muckrakers, trust-busting, constitutional amendments (16th-19th). Roosevelt, Taft, Wilson presidencies. Nav showed strong command of Progressive complexity. MCQ drill: 9/10. Reviewed missed questions carefully.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-04-07',1.5,'Period 7: WWI, the 1920s, and the Great Depression',
 'U.S. entry into WWI, Wilson''s Fourteen Points, Treaty of Versailles debate. 1920s: Red Scare, immigration restriction, Harlem Renaissance, consumer culture. Great Depression causes and impacts. Nav connected Roaring Twenties excess to Depression causes effectively. Practiced LEQ on 1920s change vs. continuity.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-04-13',1.5,'Period 7 & 8: New Deal, WWII, and Early Cold War',
 'FDR''s New Deal programs and debates over government''s role. U.S. path to WWII and home front experience. Cold War origins: Truman Doctrine, Marshall Plan, NATO, containment. Nav wrote a strong SAQ comparing New Deal to Great Society. Identified Cold War chronology gaps — reviewed with timeline activity.'),

((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-04-21',1.5,'Period 8 & 9: Civil Rights, Vietnam, and the Conservative Turn',
 'Civil Rights Movement strategies and legislation. Vietnam War escalation, anti-war movement, Great Society. Nixon, Reagan Revolution, rise of conservatism. Culture wars and end of Cold War. Full timed MCQ (55 questions): Nav scored 42/55 — strong performance. Reviewed missed questions systematically.'),

-- Upcoming final session
((SELECT id FROM students WHERE code='NAV-APUSH26'),(SELECT id FROM tutors WHERE code='SID-TUTOR'),
 '2026-04-28',1.5,'FINAL SESSION: Full DBQ Workshop + Exam Strategy',
 'Final prep before May 9 AP exam. Plan: timed DBQ practice (60 min), full debrief and scoring, exam-day strategy review, time management tips, Q&A on any remaining content questions.');

-- ── HOMEWORK ─────────────────────────────────────────────

INSERT INTO homework (student_id, tutor_id, title, description, due_date, status, submission_text, submission_date, feedback) VALUES
(
  (SELECT id FROM students WHERE code='NAV-APUSH26'),
  (SELECT id FROM tutors WHERE code='SID-TUTOR'),
  'DBQ Essay: The Successes and Failures of Reconstruction',
  'Using the provided documents and your outside knowledge, write a full DBQ essay evaluating the extent to which Reconstruction achieved its goals for formerly enslaved people. Include thesis, contextualization, evidence from at least 6 of 7 documents, sourcing for at least 3 documents, and one example of complexity.',
  '2026-03-27', 'submitted',
  'The Reconstruction era represented a transformative yet ultimately incomplete revolution in American society. While Reconstruction achieved significant legal and political gains through constitutional amendments and temporary political representation, the failure to ensure long-term economic independence and the rise of white supremacist violence undermined these gains... [Full 4-page essay submitted]',
  '2026-03-26 21:30:00+00',
  'Excellent work, Nav! Thesis is clear and defensible. Contextualization is strong. You sourced 4 documents effectively with HAPP analysis. Outside evidence (sharecropping, Black Codes, Compromise of 1877) shows real depth. To push to 7/7: strengthen complexity by connecting Reconstruction failures more explicitly to post-1877 Jim Crow. Score: 6/7 — outstanding!'
),
(
  (SELECT id FROM students WHERE code='NAV-APUSH26'),
  (SELECT id FROM tutors WHERE code='SID-TUTOR'),
  'SAQ Practice: Cold War Containment Policy (3 Parts)',
  'Answer all three parts in complete sentences. Part A: ONE specific example of U.S. containment policy in action 1947-1953. Part B: ONE way domestic politics shaped Cold War foreign policy. Part C: ONE limitation or criticism of the containment strategy.',
  '2026-04-10', 'submitted',
  'Part A: The Korean War (1950-1953) directly applied containment doctrine — Truman committed U.S. troops to repel the communist North Korean invasion, implementing NSC-68 in practice. Part B: McCarthyism made it politically impossible to appear soft on communism, forcing Truman toward the aggressive NSC-68 defense buildup and hardening U.S. diplomatic positions. Part C: Containment''s major limitation was supporting authoritarian regimes simply because they were anticommunist — fueling nationalist resentment that often strengthened the very communist movements the U.S. sought to contain.',
  '2026-04-09 19:15:00+00',
  'Near-perfect SAQ, Nav. All three parts are direct, well-evidenced, and concise. Part A correctly links Korean War to NSC-68. Part B''s McCarthyism argument is sophisticated. Part C demonstrates strong analytical thinking about containment''s contradictions. Minor note: in Part A, mention the armistice at the 38th parallel to show full command of the outcome. Score: 3/3.'
),
(
  (SELECT id FROM students WHERE code='NAV-APUSH26'),
  (SELECT id FROM tutors WHERE code='SID-TUTOR'),
  'Period 8-9 Key Terms Review Sheet',
  'Complete the key terms review sheet for Periods 8 and 9. For each of the 20 terms: (1) one-sentence identification, (2) approximate date/date range, (3) historical significance in 1-2 sentences connecting to a broader APUSH theme. Terms: Great Society, Gulf of Tonkin Resolution, Tet Offensive, Nixon Doctrine, détente, stagflation, Reagan Revolution, Iran-Contra, fall of the Berlin Wall, NAFTA, Contract with America, 9/11 and War on Terror, USA PATRIOT Act, Hurricane Katrina response, 2008 Financial Crisis, Obama election (2008), Tea Party movement, Citizens United, Affordable Care Act, Arab Spring.',
  '2026-04-27', 'pending', NULL, NULL, NULL
);

-- ── PAYMENT ──────────────────────────────────────────────

INSERT INTO payments (student_id, amount, invoice_number, status, payment_date, notes)
VALUES (
  (SELECT id FROM students WHERE code='NAV-APUSH26'),
  1200.00, 'NSP-2026-001', 'paid', '2026-03-15',
  'Full payment received for 20-hour AP US History prep package. Payment confirmed via bank transfer.'
);

-- ── ANNOUNCEMENTS ────────────────────────────────────────

INSERT INTO announcements (student_id, title, message, author) VALUES
(
  (SELECT id FROM students WHERE code='NAV-APUSH26'),
  'Final Session Tomorrow — April 28',
  'Hi Nav! Your final prep session with Sid is tomorrow, April 28. This session will focus on a timed DBQ workshop and full exam strategy review ahead of your AP US History exam on May 9. Please review your Period 8-9 key terms beforehand so we can address any lingering content questions. You have worked incredibly hard this season — come ready to show what you know!',
  'Northstar Academic Prep'
),
(
  (SELECT id FROM students WHERE code='NAV-APUSH26'),
  'Great Work on the April 21 Practice Exam!',
  'Nav — fantastic effort on your full-length timed MCQ section on April 21. You scored 42/55 (76%), putting you solidly in the 4-5 AP score range. Strongest areas: Periods 6-7 (Gilded Age through Progressive Era) and Period 5 (Civil War and Reconstruction). Focus before May 9: War of 1812 causes/consequences (Period 3) and Reagan-era domestic policy details (Period 9). Sid has a targeted review sheet ready for your final session. Keep up the momentum — you are on track!',
  'Northstar Academic Prep'
);

-- ── SECTION 4: PRACTICE QUESTIONS (10 APUSH) ─────────────

INSERT INTO practice_questions (subject, question_type, period_unit, question_text, stimulus, options, correct_answer, answer_guidance, points, source_year) VALUES

('AP US History','MCQ','Period 3 (1754-1800)',
 'The passage above best reflects which of the following continuities in American political thought during the late eighteenth century?',
 '"We hold these truths to be self-evident, that all men are created equal, that they are endowed by their Creator with certain unalienable Rights, that among these are Life, Liberty and the pursuit of Happiness. That to secure these rights, Governments are instituted among Men, deriving their just powers from the consent of the governed." — Declaration of Independence, 1776',
 '{"A":"A belief that government authority derives from divine right and hereditary monarchy","B":"An embrace of Enlightenment principles emphasizing natural rights and popular sovereignty","C":"A rejection of representative government in favor of direct democracy","D":"A commitment to maintaining traditional British constitutional structures"}',
 'B',
 'The correct answer is B. The passage directly echoes Enlightenment thinkers like John Locke — natural rights and consent of the governed. Option A is directly contradicted. Option C is wrong — founders favored representative republicanism, not direct democracy. Option D is wrong — the Declaration argues for a break from British structures. Key skill: recognize Enlightenment ideological influence on the founding generation.',
 1,2019),

('AP US History','MCQ','Period 4 (1800-1848)',
 'Jackson''s veto message best exemplifies which of the following developments in the antebellum period?',
 '"It is to be regretted that the rich and powerful too often bend the acts of government to their selfish purposes... the humble members of society — the farmers, mechanics, and laborers — who have neither the time nor the means of securing like favors to themselves, have a right to complain of the injustice of their Government." — Andrew Jackson, Bank Veto Message, 1832',
 '{"A":"The expansion of federal power to regulate interstate commerce and banking","B":"The use of popular democratic rhetoric to challenge entrenched economic elites","C":"The Whig Party''s effort to build a strong national economic infrastructure","D":"Growing sectional tensions between the North and South over economic policy"}',
 'B',
 'The correct answer is B. Jackson frames the Bank as benefiting wealthy elites at the expense of ordinary citizens — classic Jacksonian populist democracy. Option A is wrong — Jackson was attacking federal economic power, not expanding it. Option C is wrong — Whigs supported the Bank; Jackson opposed it. Option D is a distractor — this passage focuses on class, not sectional conflict. Key theme: Jacksonian Democracy and democratization.',
 1,2022),

('AP US History','MCQ','Period 5 (1844-1877)',
 'Lincoln''s speech excerpt above best reflects which of the following regarding slavery in the antebellum period?',
 '"A house divided against itself cannot stand. I believe this government cannot endure, permanently, half slave and half free. I do not expect the Union to be dissolved — I do not expect the house to fall — but I do expect it will cease to be divided. It will become all one thing, or all the other." — Abraham Lincoln, House Divided Speech, 1858',
 '{"A":"Lincoln''s belief that slavery should be immediately abolished nationwide by federal action","B":"A growing northern conviction that the sectional conflict over slavery''s expansion was irreconcilable","C":"The Republican Party''s position that slaveholders should be compensated for emancipation","D":"Lincoln''s support for the Dred Scott decision as a permanent resolution to the slavery question"}',
 'B',
 'The correct answer is B. Lincoln argues the nation cannot permanently exist divided over slavery — the issue must ultimately resolve one way or the other. This reflects the intensifying 1850s sectional crisis. Option A is wrong — Lincoln in 1858 opposed immediate abolition. Option C is unrelated. Option D is directly contradicted — Lincoln strongly opposed Dred Scott. Key skill: contextualization within the 1850s sectional crisis.',
 1,2018),

('AP US History','MCQ','Period 6 (1865-1898)',
 'The political cartoon described above most directly reflects which of the following Gilded Age developments?',
 '"[A political cartoon from 1882 depicts a massive octopus labeled ''Standard Oil'' with tentacles wrapped around state legislatures, Congress, the U.S. Treasury, and the White House, with one tentacle reaching toward the Supreme Court.]"',
 '{"A":"Public concern that large industrial monopolies exercised disproportionate influence over democratic institutions","B":"Growing support among Americans for the nationalization of major industries","C":"The success of the Sherman Antitrust Act in curtailing the power of large corporations","D":"The Populist Party''s efforts to ally urban workers with rural farmers"}',
 'A',
 'The correct answer is A. The octopus cartoon depicts Standard Oil''s monopolistic reach into all branches of government — capturing public anxiety about corporate power undermining democracy. Option B is wrong — the dominant response was regulation, not nationalization. Option C is wrong and contradicted — the Sherman Act (1890) was largely ineffective early on. Option D is a distractor — Populism is era-relevant but not depicted here. Key theme: Gilded Age corporate power and political corruption.',
 1,2020),

('AP US History','MCQ','Period 7 (1898-1945)',
 'Wilson''s statement above best reflects which of the following tensions in American foreign policy during the early twentieth century?',
 '"It must be a peace without victory... Victory would mean peace forced upon the loser, a victor''s terms imposed upon the vanquished. It would be accepted in humiliation, under duress, at an intolerable sacrifice, and would leave a sting, a resentment, a bitter memory upon which terms of peace would rest, not permanently, but only as upon quicksand." — Woodrow Wilson, Address to the Senate, January 1917',
 '{"A":"The conflict between Wilson''s idealist internationalism and the realities of European power politics","B":"Wilson''s support for a negotiated settlement that would preserve German imperial power","C":"The U.S. Senate''s opposition to any American involvement in European affairs","D":"The isolationist sentiment that prevented the United States from entering World War I"}',
 'A',
 'The correct answer is A. Wilson articulates an idealistic vision of lasting peace that clashed sharply with British and French demands for punitive terms at Versailles — illustrating the gap between Wilsonian idealism and European Realpolitik. Option B misrepresents Wilson — he sought a just peace, not preservation of German power. Option C conflates this with the later Senate treaty debate. Option D is wrong — the U.S. entered the war in April 1917. Key theme: U.S. foreign policy idealism vs. realism.',
 1,2021),

('AP US History','MCQ','Period 8 (1945-1980)',
 'Truman''s message above most directly contributed to which of the following developments in U.S. foreign policy?',
 '"I believe that it must be the policy of the United States to support free peoples who are resisting attempted subjugation by armed minorities or by outside pressures." — President Harry Truman, Address to Congress, March 1947',
 '{"A":"The decision to use atomic weapons against Japan to end World War II","B":"The establishment of a broad U.S. policy of containing the spread of Soviet communism","C":"The creation of the United Nations as a forum for resolving international disputes","D":"The U.S. policy of massive retaliation and nuclear brinkmanship under Eisenhower"}',
 'B',
 'The correct answer is B. This is the Truman Doctrine — establishing the foundational U.S. containment policy, committing American resources to countries resisting communist pressure. It directly led to aid for Greece and Turkey. Option A predates this (1945 vs. 1947). Option C also predates it — UN founded 1945. Option D describes Eisenhower''s later New Look policy. Key theme: Cold War containment origins.',
 1,2023),

('AP US History','MCQ','Period 9 (1980-Present)',
 'Reagan''s statement above best reflects which of the following ideological shifts in American politics?',
 '"In this present crisis, government is not the solution to our problem; government is the problem... It is my intention to curb the size and influence of the Federal establishment and to demand recognition of the distinction between the powers granted to the Federal Government and those reserved to the states or to the people." — Ronald Reagan, First Inaugural Address, 1981',
 '{"A":"A bipartisan consensus that New Deal programs had successfully resolved the economic problems of the 1930s","B":"The rise of a conservative political movement rejecting New Deal liberalism and advocating reduced federal government","C":"Democratic Party efforts to shift away from Great Society programs following the 1980 election defeat","D":"Reagan''s commitment to expanding federal civil rights enforcement at the expense of state authority"}',
 'B',
 'The correct answer is B. Reagan''s inaugural explicitly rejects the New Deal liberal consensus — government intervention as the solution — and articulates limited federal government and states'' rights. Option A mischaracterizes Reagan — he challenged the New Deal legacy. Option C is wrong — this is Republican ideology. Option D is directly contradicted — Reagan sought to reduce, not expand, federal power. Key theme: Reagan Revolution and conservative political realignment.',
 1,2024);

-- SAQ 1
INSERT INTO practice_questions (subject, question_type, period_unit, question_text, answer_guidance, points, source_year) VALUES
('AP US History','SAQ','Periods 4, 7, 8',
 'Answer Parts A, B, and C. Do NOT write a thesis. Use complete sentences.

Part A: Briefly describe ONE specific example of a reform movement in the antebellum period (Period 4) that sought to address a social problem in the United States.

Part B: Briefly explain ONE way in which Progressive Era reforms of the early twentieth century (Period 7) were similar to the antebellum reform movements in Part A.

Part C: Briefly explain ONE way in which the Great Society programs of the 1960s (Period 8) differed from Progressive Era reforms in their approach to solving social problems.',
 'RUBRIC (3 points, 1 each):
Part A: Any well-identified antebellum reform with specific evidence. Strong: abolitionism (Garrison/Douglass), women''s rights (Seneca Falls/Stanton), temperance, public education reform (Horace Mann), prison/asylum reform (Dorothea Dix). Must be specific — not just "reform movement existed."
Part B: Genuine similarity with specificity. Strong: both driven by middle-class moral/religious conviction; both used political process to address social ills; both challenged concentrated power (slave power vs. corporate power); both energized by investigative writing and moral literature. Must connect to Part A example.
Part C: Meaningful difference. Strong: Great Society was primarily federal government initiatives (Medicare, Medicaid, federal education funding) while Progressive reforms relied on state-level legislation; Great Society explicitly addressed racial inequality as central focus (Civil Rights Act, Voting Rights Act) while Progressive Era largely excluded Black Americans; Great Society represented massive federal welfare state expansion while Progressive reforms focused on regulation and political process reform.',
 3,2022);

-- SAQ 2
INSERT INTO practice_questions (subject, question_type, period_unit, question_text, answer_guidance, points, source_year) VALUES
('AP US History','SAQ','Period 8 (1945-1980)',
 'Answer Parts A, B, and C. Do NOT write a thesis. Use complete sentences.

Part A: Briefly describe ONE cause of the acceleration of the Civil Rights Movement in the late 1950s and early 1960s.

Part B: Briefly explain ONE specific success of the Civil Rights Movement in achieving its goals during the period 1954-1968.

Part C: Briefly explain ONE way in which the Civil Rights Movement influenced other social movements that emerged in the late 1960s and 1970s.',
 'RUBRIC (3 points, 1 each):
Part A: Specific cause with historical grounding. Strong: Cold War context made racial inequality an international embarrassment; WWII veterans unwilling to accept Jim Crow at home (Double V Campaign legacy); Brown v. Board (1954) energized activists; TV coverage of non-violent protesters being attacked galvanized national opinion; organized infrastructure of Black churches and NAACP.
Part B: Specific, concrete success. Strong: Brown v. Board (1954) — Supreme Court declares school segregation unconstitutional; Civil Rights Act of 1964 — banned discrimination in public accommodations and employment; Voting Rights Act of 1965 — banned discriminatory voting practices, dramatically increased Black voter registration; 24th Amendment abolished poll taxes. Must explain significance, not just name the event.
Part C: Specific logical connection to a later movement. Strong: Women''s liberation adopted Civil Rights tactics and legal strategies; United Farm Workers (Cesar Chavez) modeled non-violent direct action and boycotts; American Indian Movement drew inspiration from Black Power organizing; gay rights movement post-Stonewall explicitly modeled identity politics and legal equality demands on Civil Rights Movement.',
 3,2023);

-- LEQ
INSERT INTO practice_questions (subject, question_type, period_unit, question_text, answer_guidance, points, source_year) VALUES
('AP US History','LEQ','Periods 7-8',
 'Evaluate the extent to which United States foreign policy changed from the period 1898 to 1975.

(Write a full essay with thesis, contextualization, at least two specific pieces of evidence, and historical reasoning. No documents provided — this is evidence-based.)',
 'RUBRIC (6 points total):
THESIS (0-1 pt): Historically defensible claim establishing a line of reasoning. Must acknowledge both change and continuity or take a clear position on the EXTENT of change. Strong example: "While U.S. foreign policy shifted dramatically from pre-WWI isolationism to post-WWII global interventionism, a consistent thread of ideological mission — the belief America had a special responsibility to spread democracy — provided continuity across the period."
CONTEXTUALIZATION (0-1 pt): Broader historical context connected to the argument. Reach before 1898 — Monroe Doctrine tradition, late 19th century industrialization driving need for overseas markets, Manifest Destiny extending to foreign policy. Must be more than a phrase.
EVIDENCE (0-2 pts): 1 pt for two specific pieces; 2 pts if evidence supports an argument. Strong: Spanish-American War and Philippine acquisition, Wilson''s Fourteen Points and League failure, Neutrality Acts, Lend-Lease, Truman Doctrine, Marshall Plan, Korean War, Vietnam and Gulf of Tonkin, Nixon Doctrine and Vietnamization.
ANALYSIS — HISTORICAL REASONING (0-1 pt): Use continuity/change over time, comparison, or causation to frame argument. Strong answers periodize changes (pre-WWI, interwar, post-WWII) and explain WHY policy changed while identifying what remained consistent.
COMPLEXITY (0-1 pt): Nuanced understanding. Options: explain both causes and consequences of change; connect to different time period; qualify by noting "isolationism" was never absolute (U.S. continued Latin American interventions throughout); explain how domestic politics both enabled and constrained foreign policy choices.',
 6,2021);
