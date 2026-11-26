/* ── ADMIN: TUTOR HIRING PIPELINE + MATCH STUDENTS ── */
async function tutorAdminApi(body) {
  const r = await fetch('/api/onboarding?r=tutor-admin', { method:'POST', headers:{'Content-Type':'application/json','x-admin-code': window.TA_CODE || sessionStorage.getItem('portalCode')||''}, body: JSON.stringify(body) });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(j.error || ('Request failed ('+r.status+')'));
  return j;
}
const _tpEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let _tpApps = [], _tpRubric = [], _tpFilter = 'active';
// Manager: hide the Copy link banner's admin wording is fine; pay is never sent by the server.
const TP_LABEL = {audition_pending:'Waiting on video', quiz_pending:'Waiting on quiz', quiz_failed:'Quiz failed', video_review:'Video to review', call_pending:'5 min call', approved:'Approved', rejected:'Rejected', dq:'Auto-DQ', applied:'Applied'};
async function buildAdminTutorPipeline() {
  const body = document.getElementById('admBody');
  try { const j = await tutorAdminApi({action:'list'}); _tpApps = j.apps; _tpRubric = j.rubric; }
  catch (e) { body.innerHTML = `<div class="adm-error">${_tpEsc(e.message)}</div>`; return; }
  renderTutorPipeline();
}
function renderTutorPipeline() {
  const body = document.getElementById('admBody');
  const groups = [['video_review','Videos to review'],['call_pending','Passed quiz: 5 min call, then approve'],['quiz_pending','Approved video, waiting on quiz'],['audition_pending','Waiting on video'],['quiz_failed','Quiz failed'],['approved','Approved'],['dq','Auto-DQ'],['rejected','Rejected']];
  const show = _tpFilter === 'active' ? ['video_review','call_pending','quiz_pending','audition_pending','quiz_failed'] : groups.map(g=>g[0]);
  const link = `${location.origin}/tutor-apply`;
  body.innerHTML = `
    <div class="adm-section-header">Apply link (send to referrals, use in GHL ads): <a href="${link}" target="_blank" style="color:#1a3260;font-weight:700">${link}</a>
      <button onclick="navigator.clipboard.writeText('${link}');this.textContent='Copied'" style="margin-left:.5rem;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;font-size:.72rem;padding:.2rem .6rem;cursor:pointer">Copy</button>
      <button onclick="_tpFilter=_tpFilter==='active'?'all':'active';renderTutorPipeline()" style="margin-left:.5rem;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;font-size:.72rem;padding:.2rem .6rem;cursor:pointer">${_tpFilter==='active'?'Show all (incl. DQ, approved)':'Show active only'}</button></div>
    ${groups.filter(g=>show.includes(g[0])).map(([st,label])=>{
      const rows = _tpApps.filter(a=>a.status===st);
      if (!rows.length) return '';
      return `<div class="adm-section-header" style="margin-top:1.2rem">${label} (${rows.length})</div><div class="adm-list">${rows.map(tpCard).join('')}</div>`;
    }).join('') || '<div style="padding:2rem;color:#64748b">No applicants in progress yet.</div>'}`;
}
function tpCard(a) {
  const aps = (a.ap_taken||[]).map(t=>`<span class="adm-stat-chip" style="background:${t.score>=4?'#ecfdf5;color:#065f46':'#fef2f2;color:#991b1b'}">${_tpEsc(t.course)} · <strong>${t.score}</strong></span>`).join('');
  const sched = (a.availability_schedule||[]).map(s=>`${s.day.slice(0,3)} ${s.from}–${s.to}`).join(' · ') || 'none given';
  const sum = a.rubric_summary;
  const yn = v => v===true?'yes':v===false?'no':'?';
  let actions = '';
  if (a.status === 'video_review' || a.rubric) {
    actions += `<div style="margin-top:.7rem;padding:.7rem;background:#f8fafc;border-radius:8px">
      <div style="font-size:.75rem;font-weight:700;color:#0f2044;margin-bottom:.4rem">Audition rubric (1 to 5)${sum?` &nbsp;·&nbsp; avg ${sum.avg} ${sum.pass?'<span style="color:#065f46">recommend: advance</span>':'<span style="color:#991b1b">recommend: pass</span>'}`:''}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.4rem">
        ${_tpRubric.map(([k,l])=>`<label style="font-size:.74rem;color:#374151">${_tpEsc(l)}<select id="rb-${a.id}-${k}" style="width:100%;padding:.25rem;border:1px solid #e2e8f0;border-radius:6px"><option value="">-</option>${[1,2,3,4,5].map(n=>`<option ${a.rubric&&a.rubric[k]==n?'selected':''}>${n}</option>`).join('')}</select></label>`).join('')}
      </div>
      <textarea id="rn-${a.id}" placeholder="Notes" style="width:100%;margin-top:.4rem;padding:.4rem;border:1px solid #e2e8f0;border-radius:6px;font-size:.78rem">${_tpEsc(a.rubric_notes||'')}</textarea>
      <button onclick="tpScore('${a.id}')" class="adm-btn" style="margin-top:.4rem;background:#0f2044;color:#fff;border:none;border-radius:7px;padding:.4rem .9rem;font-size:.75rem;font-weight:700;cursor:pointer">Save score</button>
      ${a.status==='video_review'?`<div style="margin-top:.6rem;display:flex;gap:.5rem;flex-wrap:wrap">
        <button onclick="tpVideo('${a.id}',true)" style="background:#065f46;color:#fff;border:none;border-radius:7px;padding:.45rem 1rem;font-size:.78rem;font-weight:700;cursor:pointer">Approve video (emails them the Hub and quiz)</button>
        <button onclick="if(confirm('Decline this applicant?'))tpVideo('${a.id}',false)" style="background:#fff;color:#991b1b;border:1px solid #fecaca;border-radius:7px;padding:.45rem 1rem;font-size:.78rem;font-weight:700;cursor:pointer">Decline</button></div>`:''}
    </div>`;
  }
  if (a.status === 'call_pending') {
    actions += `<div style="margin-top:.7rem;padding:.7rem;background:#f8fafc;border-radius:8px">
      <div style="font-size:.75rem;font-weight:700;color:#0f2044;margin-bottom:.3rem">5 minute check-in: confirm their answers are true and the energy is still there</div>
      <textarea id="cn-${a.id}" placeholder="Call notes" style="width:100%;padding:.4rem;border:1px solid #e2e8f0;border-radius:6px;font-size:.78rem">${_tpEsc(a.call_notes||'')}</textarea>
      <label style="font-size:.78rem"><input type="checkbox" id="cd-${a.id}" ${a.call_done?'checked':''}> Call done and they check out</label>
      <button onclick="tpCall('${a.id}')" style="margin-left:.5rem;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;padding:.3rem .7rem;font-size:.75rem;cursor:pointer">Save</button>
      <div style="margin-top:.5rem;font-size:.78rem">${window.TA_ROLE==='manager'?'':`Hourly rate $<input id="rate-${a.id}" type="number" step="0.5" max="30" value="${a.pay_expectation||''}" style="width:70px;padding:.25rem;border:1px solid #e2e8f0;border-radius:6px"> `}
      <button onclick="tpApprove('${a.id}')" style="background:#065f46;color:#fff;border:none;border-radius:7px;padding:.4rem .9rem;font-size:.75rem;font-weight:700;cursor:pointer">Approve and create tutor</button></div>
    </div>`;
  }
  if (a.status === 'quiz_failed') actions += `<button onclick="tpStatus('${a.id}','quiz_pending')" style="margin-top:.6rem;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;padding:.3rem .7rem;font-size:.75rem;cursor:pointer">Allow a quiz retake</button>`;
  if (!['approved','rejected','dq'].includes(a.status)) actions += `<button onclick="if(confirm('Reject ${_tpEsc(a.name).replace(/'/g,'')}?'))tpStatus('${a.id}','rejected')" style="margin-top:.6rem;margin-left:.4rem;background:#fff;border:1px solid #fecaca;color:#991b1b;border-radius:7px;padding:.3rem .7rem;font-size:.75rem;cursor:pointer">Reject</button>`;
  const dq = (a.dq_reasons||[]).length ? `<div style="margin-top:.4rem;font-size:.75rem;color:#991b1b">DQ: ${a.dq_reasons.map(_tpEsc).join('; ')}</div>` : '';
  return `<div class="adm-card"><div class="adm-card-top"><div class="adm-card-info"><div class="adm-card-name">${_tpEsc(a.name)} <span style="font-size:.7rem;font-weight:600;color:#64748b">· ${TP_LABEL[a.status]||a.status}</span></div>
      <div class="adm-card-meta">${_tpEsc(a.school||'')} · ${_tpEsc(a.major||'')} · ${_tpEsc(a.email)} ${a.phone?'· 📱 '+_tpEsc(a.phone):''} ${a.referral?'· via '+_tpEsc(a.referral):''}</div></div></div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem">${aps}</div>
    <div style="font-size:.75rem;color:#374151;margin-top:.4rem"><b>Wants to tutor:</b> ${_tpEsc((a.ap_can_tutor||[]).join(', '))}</div>
    <div style="font-size:.75rem;color:#374151"><b>Hours/week:</b> ${a.weekly_hours} (cap ${Math.floor((a.weekly_hours||0)/4)} students) · <b>Start:</b> ${_tpEsc(({asap:'ASAP','1_week':'within 1 wk','2_weeks':'within 2 wks'})[a.start_timing]||a.start_timing||'?')} · <b>Commit:</b> ${a.commit_months}+ mo · ${a.pay_expectation!=null?`<b>Pay ask:</b> $${a.pay_expectation} · `:''}iPad ${yn(a.has_ipad)} · stylus ${yn(a.has_stylus)} · whiteboard ${yn(a.whiteboard_ok)}</div>
    <div style="font-size:.75rem;color:#374151"><b>Schedule:</b> ${_tpEsc(sched)}</div>
    <div style="font-size:.75rem;color:#374151"><b>Next semester:</b> ${_tpEsc(a.next_semester_classes||'not given')}</div>
    ${a.audition_url?`<div style="font-size:.78rem;margin-top:.3rem"><a href="${_tpEsc(a.audition_url)}" target="_blank" rel="noopener" style="color:#1a3260;font-weight:700">▶ Watch audition video</a></div>`:''}
    ${a.quiz_total?`<div style="font-size:.75rem;color:#374151">Quiz: ${a.quiz_score}/${a.quiz_total} ${a.quiz_passed?'(passed)':'(failed)'}</div>`:''}
    ${dq}${actions}</div>`;
}
async function tpScore(id) {
  const rubric = {};
  for (const [k] of _tpRubric) rubric[k] = document.getElementById(`rb-${id}-${k}`).value;
  try { await tutorAdminApi({action:'score', id, rubric, notes: document.getElementById('rn-'+id).value}); buildAdminTutorPipeline(); }
  catch (e) { alert(e.message); }
}
async function tpVideo(id, approve) {
  try {
    await tpScoreQuiet(id);
    const j = await tutorAdminApi({action:'video_decision', id, approve});
    if (approve) alert(j.emailed ? 'Approved. They were emailed the Hub and quiz link (you are copied).' : 'Approved, but the email did not send. Their quiz link is on their application; text or email it to them.');
    buildAdminTutorPipeline();
  } catch (e) { alert(e.message); }
}
async function tpScoreQuiet(id) {
  const rubric = {}; let all = true;
  for (const [k] of _tpRubric) { const v = document.getElementById(`rb-${id}-${k}`)?.value; if (!v) all = false; rubric[k] = v; }
  if (all) await tutorAdminApi({action:'score', id, rubric, notes: document.getElementById('rn-'+id)?.value || ''});
}
async function tpCall(id) {
  try { await tutorAdminApi({action:'call', id, done: document.getElementById('cd-'+id).checked, notes: document.getElementById('cn-'+id).value}); buildAdminTutorPipeline(); }
  catch (e) { alert(e.message); }
}
async function tpStatus(id, status) {
  try { await tutorAdminApi({action:'set_status', id, status}); buildAdminTutorPipeline(); } catch (e) { alert(e.message); }
}
async function tpApprove(id) {
  const rateEl = document.getElementById('rate-'+id);
  const rate = rateEl ? rateEl.value : undefined;
  try {
    await tpCall(id);
    const j = await tutorAdminApi({action:'approve', id, hourly_rate: rate});
    alert(`Created tutor ${j.tutor.name}. Access key: ${j.tutor.code}. Cap: ${j.tutor.max_students} students. ` + (j.emailed ? 'Welcome email sent (you are copied).' : 'The welcome email did NOT send, so send it yourself.') + ' Next: match them to a student.');
    showAdminSection('match-students');
  } catch (e) { alert(e.message); }
}

async function buildAdminMatchStudents() {
  const body = document.getElementById('admBody');
  let j;
  try { j = await tutorAdminApi({action:'matches'}); } catch (e) { body.innerHTML = `<div class="adm-error">${_tpEsc(e.message)}</div>`; return; }
  const cap = j.capacity.length ? `<div class="adm-section-header">New tutors: slots left (4 hrs per student)</div><div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem">${j.capacity.map(c=>`<span class="adm-stat-chip" style="background:${c.left?'#ecfdf5;color:#065f46':'#fef2f2;color:#991b1b'}">${_tpEsc(c.name)} · ${c.active}/${c.max} · ${c.left} left</span>`).join('')}</div>` : '';
  body.innerHTML = cap + `<div class="adm-section-header">${j.students.length} student${j.students.length===1?'':'s'} without a tutor</div><div class="adm-list">${j.students.map(s=>`
    <div class="adm-card"><div class="adm-card-top"><div class="adm-card-info"><div class="adm-card-name">${_tpEsc(s.name)}</div>
      <div class="adm-card-meta">${_tpEsc((s.subjects||[]).join(', '))} · ${s.form_in?('Prefers '+_tpEsc((s.pref_days||[]).map(d=>d.slice(0,3)).join(', ')||'days not given')+(s.pref_times?' · '+_tpEsc(s.pref_times):'')):'<span style="color:#b45309">intake form not in yet</span>'}</div></div>
      <select onchange="tpGender('student','${s.id}',this.value)" style="font-size:.72rem;padding:.2rem;border:1px solid #e2e8f0;border-radius:6px"><option value="">gender?</option>${['female','male','other'].map(g=>`<option ${s.gender===g?'selected':''}>${g}</option>`).join('')}</select></div>
      ${s.suggestions.length ? s.suggestions.map(t=>`<div style="display:flex;align-items:center;gap:.6rem;margin-top:.5rem;padding:.5rem .7rem;background:#f8fafc;border-radius:8px">
        <div style="flex:1;font-size:.78rem"><b>${_tpEsc(t.name)}</b> ${t.is_new?'<span style="font-size:.65rem;color:#065f46">new</span>':''}<div style="color:#64748b">${t.reasons.map(_tpEsc).join(' · ')}</div></div>
        <button onclick="tpAssign('${s.id}','${t.tutor_id}','${_tpEsc(s.name).replace(/'/g,'')}','${_tpEsc(t.name).replace(/'/g,'')}')" style="background:#0f2044;color:#fff;border:none;border-radius:7px;padding:.35rem .8rem;font-size:.74rem;font-weight:700;cursor:pointer">Assign</button></div>`).join('')
      : '<div style="margin-top:.5rem;font-size:.78rem;color:#b45309">No tutor covers this subject with open slots.</div>'}
    </div>`).join('') || '<div style="padding:2rem;color:#64748b">Every active student has a tutor.</div>'}</div>`;
}
async function tpGender(kind, id, gender) { try { await tutorAdminApi({action:'set_gender', kind, id, gender}); buildAdminMatchStudents(); } catch (e) { alert(e.message); } }
async function tpAssign(studentId, tutorId, sName, tName) {
  if (!confirm(`Assign ${sName} to ${tName}? This also moves their homework to this tutor. Remember to send the tutor the trimmed form and start the group chat.`)) return;
  try { await tutorAdminApi({action:'assign', student_id: studentId, tutor_id: tutorId}); buildAdminMatchStudents(); } catch (e) { alert(e.message); }
}


const SB_STEPS = [['portal_ready','Portal ready'],['welcome_sent','Welcome sent'],['form_in','Form in'],['tutor_matched','Tutor matched'],['trimmed_form_sent','Tutor got form'],['group_chat','Group chat'],['diagnostic_done','Diagnostic done'],['first_session','First session']];
const SB_MANUAL = ['welcome_sent','trimmed_form_sent','group_chat'];
async function buildAdminStatusBoard() {
  const body = document.getElementById('admBody');
  let j;
  try { j = await tutorAdminApi({action:'board'}); } catch (e) { body.innerHTML = `<div class="adm-error">${_tpEsc(e.message)}</div>`; return; }
  const open = j.rows.filter(r => Object.values(r.steps).some(v => !v));
  body.innerHTML = `<div class="adm-section-header">${open.length} of ${j.rows.length} paid students still have steps open. Green is done. Tap a dashed step to check it off after you do it.</div>
    <div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:.76rem;width:100%"><thead><tr><th style="text-align:left;padding:.4rem">Student</th><th style="text-align:left;padding:.4rem">Tutor</th>${SB_STEPS.map(s=>`<th style="padding:.4rem;font-weight:600;color:#64748b">${s[1]}</th>`).join('')}</tr></thead><tbody>
    ${j.rows.sort((a,b)=>Object.values(a.steps).filter(v=>!v).length<Object.values(b.steps).filter(v=>!v).length?1:-1).map(r=>`<tr style="border-top:1px solid #e5e7eb"><td style="padding:.4rem;font-weight:700">${_tpEsc(r.name)}</td><td style="padding:.4rem">${_tpEsc(r.tutor||'—')}</td>${SB_STEPS.map(([k])=>{
      const done = r.steps[k], manual = SB_MANUAL.includes(k);
      return `<td style="padding:.3rem;text-align:center"><span ${manual?`onclick="sbToggle('${r.id}','${k}',${!done})"`:''} style="display:inline-block;min-width:26px;padding:.2rem .4rem;border-radius:6px;${done?'background:#d1fae5;color:#065f46':'background:#fff;color:#94a3b8;border:1px '+(manual?'dashed':'solid')+' #cbd5e1'};${manual?'cursor:pointer':''}">${done?'✓':'·'}</span></td>`}).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}
async function sbToggle(id, field, value) { try { await tutorAdminApi({action:'board_set', student_id:id, field, value}); buildAdminStatusBoard(); } catch (e) { alert(e.message); } }


/* ── Staff access (admin only) ── */
async function buildAdminStaffAccess() {
  const body = document.getElementById('admBody');
  let j;
  try { j = await tutorAdminApi({action:'staff_list'}); } catch (e) { body.innerHTML = `<div class="adm-error">${_tpEsc(e.message)}</div>`; return; }
  body.innerHTML = `<div class="adm-section-header">Manager logins for ${location.origin}/manage (hiring, matching, students and tutors only; no pay, billing or sessions)</div>
    <div style="display:flex;gap:.5rem;margin-bottom:1rem"><input id="staffName" placeholder="Name (e.g. Maya, VA)" style="padding:.5rem .8rem;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.82rem;width:240px">
      <button onclick="staffAdd()" style="background:#0f2044;color:#fff;border:none;border-radius:8px;padding:.5rem 1.1rem;font-size:.8rem;font-weight:700;cursor:pointer">Create access key</button></div>
    <div class="adm-list">${j.staff.map(s=>`<div class="adm-card"><div class="adm-card-top"><div class="adm-card-info"><div class="adm-card-name">${_tpEsc(s.name)} <span style="font-size:.7rem;color:${s.active?'#065f46':'#991b1b'}">${s.active?'active':'disabled'}</span></div>
      <div class="adm-card-meta">Key: <b>${_tpEsc(s.code)}</b> · last login ${s.last_login?new Date(s.last_login).toLocaleString():'never'}</div></div>
      <button onclick="staffToggle('${s.id}',${!s.active})" style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;font-size:.75rem;padding:.3rem .7rem;cursor:pointer">${s.active?'Disable':'Enable'}</button></div></div>`).join('') || '<div style="padding:1rem;color:#64748b">No managers yet.</div>'}</div>`;
}
async function staffAdd() {
  const name = document.getElementById('staffName').value;
  try { const j = await tutorAdminApi({action:'staff_add', name}); alert('Access key: ' + j.code + '\nThey log in at ' + location.origin + '/manage'); buildAdminStaffAccess(); } catch (e) { alert(e.message); }
}
async function staffToggle(id, active) { try { await tutorAdminApi({action:'staff_set_active', id, active}); buildAdminStaffAccess(); } catch (e) { alert(e.message); } }

/* ── Manager views: students and tutors (no pay, hours, billing or sessions) ── */
function _mgrField(k, v) { return v ? `<div style="font-size:.76rem;color:#374151"><b>${_tpEsc(k)}:</b> ${_tpEsc(Array.isArray(v)?v.join(', '):v)}</div>` : ''; }
async function buildMgrStudents() {
  const body = document.getElementById('admBody');
  let j;
  try { j = await tutorAdminApi({action:'students'}); } catch (e) { body.innerHTML = `<div class="adm-error">${_tpEsc(e.message)}</div>`; return; }
  window._mgrStudents = j.students;
  body.innerHTML = `<input id="mgrSearch" placeholder="Search students" oninput="mgrFilterStudents()" style="padding:.5rem .8rem;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.82rem;width:260px;margin-bottom:1rem"><div class="adm-list" id="mgrStudentList"></div>`;
  mgrFilterStudents();
}
function mgrFilterStudents() {
  const q = (document.getElementById('mgrSearch')?.value || '').toLowerCase();
  document.getElementById('mgrStudentList').innerHTML = window._mgrStudents.filter(s => !q || (s.name||'').toLowerCase().includes(q)).map(s => {
    const o = s.intake;
    return `<div class="adm-card"><div class="adm-card-top"><div class="adm-card-info"><div class="adm-card-name">${_tpEsc(s.name)}</div>
      <div class="adm-card-meta">${_tpEsc(s.grade||'')} ${_tpEsc(s.school||'')} · ${_tpEsc((s.subjects||[]).join(', '))} · Tutor: <b>${_tpEsc(s.tutor||'none yet')}</b></div></div>
      ${s.tutor?`<button onclick="mgrEmailForm('${s.id}')" style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;font-size:.74rem;padding:.3rem .7rem;cursor:pointer">Email tutor the form</button>`:''}</div>
      ${o ? `<details style="margin-top:.5rem"><summary style="cursor:pointer;font-size:.78rem;font-weight:700;color:#1a3260">Intake form</summary><div style="margin-top:.4rem">
        ${_mgrField('Parent 1',[o.parent1_name,o.parent1_email,o.parent1_phone].filter(Boolean).join(' · '))}${_mgrField('Parent 2',[o.parent2_name,o.parent2_email,o.parent2_phone].filter(Boolean).join(' · '))}
        ${_mgrField('Student contact',[o.student_email,o.student_phone].filter(Boolean).join(' · '))}${_mgrField('Preferred contact',o.preferred_contact)}${_mgrField('Contact notes',o.contact_notes)}
        ${_mgrField('Time zone',o.timezone)}${_mgrField('Days',o.preferred_days)}${_mgrField('Times',o.preferred_times)}${_mgrField('Scheduling notes',o.scheduling_notes)}
        ${_mgrField('Subjects',o.subjects)}${_mgrField('Teacher',o.teacher_name)}${_mgrField('Current grade',o.current_grade)}${_mgrField('Target grade',o.target_grade)}${_mgrField('Next test',o.next_test_date)}${_mgrField('Struggles',o.struggles)}</div></details>`
        : '<div style="font-size:.76rem;color:#b45309;margin-top:.4rem">Intake form not in yet</div>'}</div>`;
  }).join('') || '<div style="padding:1.5rem;color:#64748b">No students.</div>';
}
async function mgrEmailForm(id) {
  if (!confirm("Email this student's trimmed form to their tutor? (no parent info is included)")) return;
  try { const j = await tutorAdminApi({action:'email_tutor_form', student_id:id}); alert(j.emailed ? 'Sent to ' + j.tutor + '.' : 'The email did not send. Try again or send it manually.'); } catch (e) { alert(e.message); }
}
async function buildMgrTutors() {
  const body = document.getElementById('admBody');
  let j;
  try { j = await tutorAdminApi({action:'tutors'}); } catch (e) { body.innerHTML = `<div class="adm-error">${_tpEsc(e.message)}</div>`; return; }
  body.innerHTML = `<div class="adm-section-header">${j.tutors.length} tutors</div><div class="adm-list">${j.tutors.map(t=>`
    <div class="adm-card"><div class="adm-card-top"><div class="adm-card-info"><div class="adm-card-name">${_tpEsc(t.name)}</div>
      <div class="adm-card-meta">${_tpEsc([t.school,t.major].filter(Boolean).join(' · '))} ${t.email?'· '+_tpEsc(t.email):''}</div></div>
      <span class="adm-stat-chip" style="background:${t.slots_left===0?'#fef2f2;color:#991b1b':'#ecfdf5;color:#065f46'}">${t.active} student${t.active===1?'':'s'}${t.slots_left==null?'':' · '+t.slots_left+' slot'+(t.slots_left===1?'':'s')+' left'}</span></div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem">${(t.ap_scores||[]).map(a=>`<span class="adm-stat-chip" style="background:#ecfdf5;color:#065f46">${_tpEsc(a.course)} · <b>${a.score}</b></span>`).join('')}</div>
      ${_mgrField('Can teach',t.subjects_can_teach)}${_mgrField('Available',(t.availability_schedule||[]).length?(t.availability_schedule).map(s=>s.day.slice(0,3)+' '+s.from+'-'+s.to).join(' · '):(t.availability_days||[]))}
      ${_mgrField('Students',t.students)}</div>`).join('')}</div>`;
}
