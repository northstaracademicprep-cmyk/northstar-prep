# Northstar ops runbook

For whoever runs fulfillment day to day. Everything here is done from the admin portal
(portal.northstaracademicprep.com, admin code) plus Sahib's Gmail. No database access needed.
Family-facing emails always go from northstaracademicprep@gmail.com, never an auto-sender.

## 1. A family closes
Sahib tells you: family, program (hours), price paid.
1. Confirm the student exists in **My Students** (it is usually pre-created before the demo). Set hours total, hours used 0, payment paid, amount, date, parent email.
2. Confirm the game plan is loaded (4 phases) and the subject diagnostic is in their assignments.
3. Send the **welcome email** from Gmail:
   - Subject: Welcome to Northstar, your portal access
   - Greet the parent by first name. Say "your student", not the name, in the body. No pricing.
   - Include: portal link, access key, hours and course, onboarding form link (portal.northstaracademicprep.com/onboarding), "we will match a tutor and start a group chat", request syllabus, calendar, past tests, test dates.
4. Tick **Welcome sent** on the **Student Status** page.

## 2. Intake form arrives
It shows in Student Status as **Form in**. Read the answers (they also email the admin inbox).

## 3. Match a tutor
Open **Match Students**. Each student with no tutor shows the top three suggestions and why
(subject strength, shared days, slots left, same gender as a soft bonus only). Click **Assign**.
This sets the tutor on the student and on their homework.
Then:
1. Send the tutor the trimmed form from Gmail (subject "Onboarding form: <student>"): student name, grade, school, preferred contact, contact notes, time zone, preferred days and times, scheduling notes, subjects, teacher, current and target grade, next test date, struggles. Write "not given" for blanks. Never include parent info or student email or phone.
2. Start the group chat with the family and tutor.
3. Tick **Tutor got form** and **Group chat** on Student Status.

Existing tutors are untouched by capacity rules. Only tutors hired through the new funnel have a cap
(4 hours per student: floor(weekly hours / 4) students). Legacy tutors show as "Legacy tutor".

## 4. Hiring a tutor
Applicants come from referrals or ads. Send them **portal.northstaracademicprep.com/tutor-apply**.
1. They apply. Auto-DQ if: cannot commit 4+ months, no iPad, under 4 hrs/week, pay ask above $30, or no AP 4 or 5 in a subject they want to tutor. DQ'd applicants get a polite close. Nothing for you to do.
2. Qualified applicants land on a page for their audition video (about 6 minutes: short intro, then a mini lesson with a live practice problem) and a 12 question quiz (7 scenarios, 5 on the Tutor Hub). Pass is 10 of 12.
3. Open **Tutor Hiring**. Applicants who passed the quiz are under **Ready to score**. Watch the video and score the rubric 1 to 5: charisma, energy, clarity, analogies, easy to absorb, confidence, expertise. Average 4.0 or higher with nothing under 3 recommends advancing; click Save and advance.
4. Do the **5 minute check-in call**: confirm what they wrote is true and the energy holds up. Tick it done.
5. Set the hourly rate (max $30) and click **Approve and create tutor**. It creates their tutor login. Send the tutor welcome email from Gmail: Tutor Hub link (https://gamma.app/docs/Northstar-Tutor-Hub-Your-Complete-Onboarding-Guide-vmvwl4l8iyxyg9s), portal link and access key together. Do not mention pay.
6. Quiz fails can be reopened with **Allow a quiz retake** if Sahib wants to give a second chance.

## 5. Changing tutor pay
Update the rate in **Tutor Management**, then ask Sahib if he wants the raise email sent.

## 6. Weekly checks
- **Student Status**: anything open for more than 3 days gets chased.
- **Pending Approvals**: approve logged sessions; grade homework within 24 hours.
- **Hours & Billing**: students under 5 hours left are renewal conversations. Tell Sahib.

## Rules that never bend
- Never delete rows. Never touch other students.
- Tutors never take payment off platform. If a parent asks, decline politely and tell Sahib.
- Code changes go on a branch and a pull request for Sahib to merge.
