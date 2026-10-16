/* Northstar full-length practice tests.
   Section I (MCQ) runs here, timed, built from the same in-portal banks the Practice Vault already uses.
   Section II (FRQ) is separate: real College Board free-response sets live in vault-v2.html (history courses).
   Uses portal globals: db, currentStudent, getPracticeBank, buildPracticeVault, showToast. */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Official-ish section sizes (questions, minutes). Used to scale the section to what the bank can supply.
  const EXAM = {
    apcalc: { n: 45, min: 105 }, apstat: { n: 40, min: 90 }, apbio: { n: 60, min: 90 }, apchem: { n: 60, min: 90 },
    apush: { n: 55, min: 55 }, apwh: { n: 55, min: 55 }, apgov: { n: 55, min: 80 }, apes: { n: 80, min: 90 },
    sat: { n: 54, min: 64 }, act: { n: 60, min: 60 }
  };
  const FRQ_LINKS = { apush: 'vault-v2.html?subject=apush&mode=frq', apwh: 'vault-v2.html?subject=apworld&mode=frq' };

  let T = null; // active test state
  let tick = null;

  function css() {
    if (document.getElementById('ftCss')) return;
    const st = document.createElement('style'); st.id = 'ftCss';
    st.textContent = `
.ft-hub{background:#fff;border:1.5px solid #e5e7eb;border-radius:16px;overflow:hidden;margin-bottom:1.5rem}
.ft-hub-h{background:linear-gradient(135deg,#0f2044,#1a3260);color:#fff;padding:1.1rem 1.4rem;display:flex;align-items:center;gap:.8rem}
.ft-hub-h b{font-size:1.05rem}.ft-hub-h span{font-size:.78rem;color:rgba(255,255,255,.6)}
.ft-secs{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;padding:1.2rem}
.ft-sec{border:1.5px solid #e5e7eb;border-radius:12px;padding:1rem 1.1rem;display:flex;flex-direction:column;gap:.5rem}
.ft-sec h4{margin:0;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:#92400e}
.ft-sec .t{font-weight:800;color:#0f2044;font-size:1rem}
.ft-sec p{margin:0;font-size:.8rem;color:#64748b;line-height:1.5}
.ft-hist{padding:0 1.2rem 1.1rem}.ft-hist table{width:100%;border-collapse:collapse;font-size:.8rem}
.ft-hist td,.ft-hist th{padding:.4rem .5rem;border-top:1px solid #f1f5f9;text-align:left}.ft-hist th{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8}
.ft-bar{position:sticky;top:0;z-index:5;background:#0f2044;color:#fff;border-radius:12px;padding:.7rem 1rem;display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap}
.ft-timer{font-variant-numeric:tabular-nums;font-weight:800;font-size:1.25rem;letter-spacing:.02em}
.ft-timer.low{color:#fca5a5}
.ft-layout{display:grid;grid-template-columns:1fr 210px;gap:1rem}
@media(max-width:820px){.ft-layout{grid-template-columns:1fr}}
.ft-nav{background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:.8rem;align-self:start;position:sticky;top:76px}
.ft-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:.3rem}
.ft-dot{border:1.5px solid #e2e8f0;background:#fff;border-radius:7px;font-size:.72rem;font-weight:700;padding:.35rem 0;cursor:pointer;color:#475569;font-family:inherit}
.ft-dot.ans{background:#dbeafe;border-color:#93c5fd;color:#1e3a8a}.ft-dot.cur{outline:2px solid #c9a03a}.ft-dot.flag{background:#fef3c7;border-color:#fcd34d;color:#92400e}
.ft-legend{font-size:.66rem;color:#94a3b8;margin-top:.6rem;line-height:1.6}
.ft-unit{display:flex;align-items:center;gap:.6rem;font-size:.8rem;margin:.35rem 0}.ft-unit .n{width:210px;color:#334155}.ft-unit .b{flex:1;height:8px;background:#e5e7eb;border-radius:99px;overflow:hidden}.ft-unit .b i{display:block;height:100%}.ft-unit .p{width:64px;text-align:right;font-weight:700}
`;
    document.head.appendChild(st);
  }

  /* ───────── config ───────── */
  function plan() {
    let r = typeof getPracticeBank === 'function' ? getPracticeBank((currentStudent || {}).subjects) : null;
    if (!r) return null;
    // AP Calc AB students should not be tested on BC-only units (parametric/polar/vector, series)
    const who = (((currentStudent || {}).subjects || []).join(' ') + ' ' + (((currentStudent || {}).progress_config || {}).subject || '')).toUpperCase();
    if (r.type === 'apcalc' && /\bAB\b/.test(who) && !/\bBC\b/.test(who)) {
      r = { ...r, bank: r.bank.filter(sec => !/^U(9|10)\b/.test(String(sec.label))) };
    }
    const pool = [];
    r.bank.forEach(sec => (sec.questions || []).forEach(q => pool.push({ ...q, _unit: sec.label, _key: sec.key })));
    if (pool.length < 10) return null;
    const ex = EXAM[r.type] || { n: 40, min: 45 };
    const n = Math.min(ex.n, pool.length);
    const minutes = Math.max(10, Math.round(ex.min * n / ex.n));
    return { r, pool, ex, n, minutes, scaled: n < ex.n };
  }

  // round-robin across units so the test covers the whole course
  function draw(r, n) {
    const buckets = r.bank.map(sec => (sec.questions || []).map(q => ({ ...q, _unit: sec.label, _key: sec.key })).sort(() => Math.random() - 0.5));
    const out = []; let i = 0;
    while (out.length < n && buckets.some(b => b.length)) {
      const b = buckets[i % buckets.length]; if (b.length) out.push(b.shift()); i++;
    }
    return out.sort(() => Math.random() - 0.5);
  }

  const saveKey = () => 'ft_' + ((currentStudent || {}).studentId || 'x');

  /* ───────── hub (rendered at the top of the Practice Vault) ───────── */
  async function hub(elId) {
    css();
    const el = document.getElementById(elId); if (!el) return;
    const p = plan(); if (!p) { el.innerHTML = ''; return; }
    const frq = FRQ_LINKS[p.r.type];
    let saved = null; try { saved = JSON.parse(localStorage.getItem(saveKey()) || 'null'); } catch (e) {}
    if (saved && (saved.type !== p.r.type || saved.deadline < Date.now())) saved = null;
    el.innerHTML = `<div class="ft-hub">
      <div class="ft-hub-h"><div style="font-size:1.6rem">📝</div><div><b>Full-length practice test</b><br><span>${esc(p.r.label)} · two separate sections, like test day</span></div></div>
      <div class="ft-secs">
        <div class="ft-sec"><h4>Section I · Multiple choice</h4><div class="t">${p.n} questions · ${p.minutes} minutes</div>
          <p>Timed, no feedback until you finish. Questions are drawn from every unit. Flag and revisit.${p.scaled ? ` Your bank has ${p.pool.length} questions so this section is scaled down from the real exam's ${p.ex.n}.` : ''}</p>
          ${saved ? `<button class="pv-btn" onclick="FullTest.resume()">▶ Resume your test (${Math.max(1, Math.round((saved.deadline - Date.now()) / 60000))} min left)</button><button class="pv-btn-outline" onclick="FullTest.start()">Start over</button>` : `<button class="pv-btn" onclick="FullTest.start()">Start Section I</button>`}
        </div>
        <div class="ft-sec"><h4>Section II · Free response</h4><div class="t">${frq ? 'Real College Board FRQs' : 'Coming soon'}</div>
          <p>${frq ? 'The 2025 free-response set: short answers, DBQ and long essay, with the official rubric. Take it as its own sitting.' : 'Free-response practice for this course is not built yet. Your tutor can assign FRQs as homework in the meantime.'}</p>
          ${frq ? `<a class="pv-btn" style="text-decoration:none;display:inline-block;text-align:center" href="${frq}">Open Section II →</a>` : ''}
        </div>
      </div>
      <div class="ft-hist" id="ftHist"></div>
    </div>`;
    loadHistory(p.r.type);
  }

  async function loadHistory(type) {
    const el = document.getElementById('ftHist'); if (!el || !(currentStudent || {}).studentId) return;
    const { data } = await db.from('practice_tests').select('correct,total,seconds_used,created_at').eq('student_id', currentStudent.studentId).eq('bank_type', type).order('created_at', { ascending: false }).limit(5);
    if (!data || !data.length) return;
    el.innerHTML = `<table><tr><th>Past attempts</th><th>Score</th><th>Time</th></tr>${data.map(r => `<tr><td>${new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</td><td><b>${r.correct}/${r.total}</b> · ${Math.round(r.correct / r.total * 100)}%</td><td>${r.seconds_used ? Math.round(r.seconds_used / 60) + ' min' : ''}</td></tr>`).join('')}</table>`;
  }

  /* ───────── run ───────── */
  function start() {
    const p = plan(); if (!p) return;
    const qs = draw(p.r, p.n);
    T = { type: p.r.type, label: p.r.label, qs, ans: {}, flag: {}, cur: 0, started: Date.now(), allowed: p.minutes * 60, deadline: Date.now() + p.minutes * 60000 };
    persist(); run();
  }
  function resume() {
    let s = null; try { s = JSON.parse(localStorage.getItem(saveKey()) || 'null'); } catch (e) {}
    if (!s) return start();
    T = s; run();
  }
  function persist() { try { localStorage.setItem(saveKey(), JSON.stringify(T)); } catch (e) {} }

  function run() {
    css();
    clearInterval(tick);
    tick = setInterval(onTick, 1000);
    draw_ui();
    onTick();
  }

  function onTick() {
    const left = Math.max(0, Math.round((T.deadline - Date.now()) / 1000));
    const el = document.getElementById('ftTimer');
    if (el) { el.textContent = fmt(left); el.classList.toggle('low', left <= 300); }
    if (left <= 0) { clearInterval(tick); showToast('Time is up. Submitting your test.', 'success'); finish(true); }
  }
  const fmt = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0'); };

  function draw_ui() {
    const c = document.getElementById('pvContent'); if (!c || !T) return;
    const q = T.qs[T.cur], n = T.qs.length;
    const answered = Object.keys(T.ans).length;
    c.innerHTML = `
      <div class="ft-bar"><div style="font-weight:800">📝 ${esc(T.label)} · Section I</div>
        <div style="margin-left:auto;font-size:.8rem;opacity:.8">${answered}/${n} answered</div>
        <div class="ft-timer" id="ftTimer"></div>
        <button class="pv-btn" style="background:#c9a03a;color:#0f2044;padding:.5rem 1rem" onclick="FullTest.submit()">Submit test</button></div>
      <div class="ft-layout">
        <div class="card"><div class="card-body">
          <div class="pv-q-num">Question ${T.cur + 1} of ${n} <span style="color:#94a3b8;font-weight:500">· ${esc(q._unit)}</span></div>
          ${q.stimulus ? `<div class="pv-stimulus">${q.stimulus}</div>` : ''}
          ${q.attribution ? `<div class="pv-attribution">${q.attribution}</div>` : ''}
          <div class="pv-question">${q.q}</div>
          <div class="pv-choices">${Object.entries(q.choices).map(([L, tx]) => `<div class="pv-choice${T.ans[q.id] === L ? ' correct' : ''}" style="${T.ans[q.id] === L ? 'border-color:#3b82f6;background:#eff6ff' : ''}" onclick="FullTest.pick('${L}')"><div class="pv-choice-letter">${L}</div><div class="pv-choice-text">${tx}</div></div>`).join('')}</div>
          <div class="pv-nav-row" style="margin-top:1rem">
            <div style="display:flex;gap:.5rem">
              <button class="pv-btn-outline" ${T.cur === 0 ? 'disabled' : ''} onclick="FullTest.go(${T.cur - 1})">← Prev</button>
              <button class="pv-btn-outline" onclick="FullTest.flag()">${T.flag[q.id] ? '⚑ Flagged' : '⚐ Flag for review'}</button>
              ${T.ans[q.id] ? `<button class="pv-btn-outline" onclick="FullTest.clear()">Clear answer</button>` : ''}
            </div>
            <button class="pv-btn" ${T.cur === n - 1 ? 'disabled' : ''} onclick="FullTest.go(${T.cur + 1})">Next →</button>
          </div>
        </div></div>
        <div class="ft-nav"><div style="font-size:.72rem;font-weight:800;color:#475569;margin-bottom:.5rem">QUESTIONS</div>
          <div class="ft-grid">${T.qs.map((x, i) => `<button class="ft-dot${T.ans[x.id] ? ' ans' : ''}${T.flag[x.id] ? ' flag' : ''}${i === T.cur ? ' cur' : ''}" onclick="FullTest.go(${i})">${i + 1}</button>`).join('')}</div>
          <div class="ft-legend">Blue = answered<br>Gold = flagged<br>Your progress is saved if you close this tab.</div></div>
      </div>`;
    onTick();
  }

  function pick(L) { const q = T.qs[T.cur]; T.ans[q.id] = L; persist(); draw_ui(); }
  function clear() { delete T.ans[T.qs[T.cur].id]; persist(); draw_ui(); }
  function flag() { const id = T.qs[T.cur].id; if (T.flag[id]) delete T.flag[id]; else T.flag[id] = 1; persist(); draw_ui(); }
  function go(i) { if (i < 0 || i >= T.qs.length) return; T.cur = i; persist(); draw_ui(); window.scrollTo({ top: 0 }); }
  function submit() {
    const un = T.qs.length - Object.keys(T.ans).length, fl = Object.keys(T.flag).length;
    if (!confirm(`Submit now?${un ? `\n${un} question${un === 1 ? ' is' : 's are'} unanswered.` : ''}${fl ? `\n${fl} flagged for review.` : ''}`)) return;
    finish(false);
  }

  /* ───────── results ───────── */
  async function finish() {
    clearInterval(tick);
    const used = Math.min(T.allowed, Math.round((Date.now() - T.started) / 1000));
    const total = T.qs.length;
    const correct = T.qs.filter(q => T.ans[q.id] === q.answer).length;
    const pct = Math.round(correct / total * 100);
    const units = {};
    T.qs.forEach(q => { const u = units[q._unit] = units[q._unit] || { c: 0, t: 0 }; u.t++; if (T.ans[q.id] === q.answer) u.c++; });
    const breakdown = Object.entries(units).map(([unit, v]) => ({ unit, correct: v.c, total: v.t }));
    try { localStorage.removeItem(saveKey()); } catch (e) {}
    if ((currentStudent || {}).studentId) {
      db.from('practice_tests').insert({
        student_id: currentStudent.studentId, bank_type: T.type, label: T.label, section: 'mcq', total, correct,
        seconds_used: used, seconds_allowed: T.allowed, unit_breakdown: breakdown,
        details: T.qs.map(q => ({ id: q.id, unit: q._unit, chosen: T.ans[q.id] || null, correct: T.ans[q.id] === q.answer, flagged: !!T.flag[q.id] }))
      }).then(({ error }) => { if (error) console.warn('practice_tests save', error.message); });
    }
    const col = p => p >= 80 ? '#10b981' : p >= 65 ? '#f59e0b' : '#ef4444';
    const weak = breakdown.filter(b => b.total >= 2).sort((a, b) => a.correct / a.total - b.correct / b.total)[0];
    const c = document.getElementById('pvContent');
    c.innerHTML = `<div class="card"><div class="card-body">
      <div class="pv-quiz-header"><div class="pv-quiz-title">📝 ${esc(T.label)} · Section I results</div><button class="pv-quiz-back" onclick="buildPracticeVault()">← Practice Vault</button></div>
      <div class="pv-results-wrap">
        <div class="pv-score-circle"><div class="pv-score-num">${correct}</div><div class="pv-score-denom">out of ${total}</div></div>
        <div class="pv-score-pct" style="color:${col(pct)}">${pct}%</div>
        <div class="pv-score-label">Finished in ${Math.round(used / 60)} of ${Math.round(T.allowed / 60)} minutes · about ${Math.round(used / total)} seconds per question${weak && weak.correct / weak.total < 0.7 ? ` · weakest unit: ${esc(weak.unit)}` : ''}</div>
        <div style="text-align:left;max-width:640px;margin:1rem auto">${breakdown.map(b => { const p = Math.round(b.correct / b.total * 100); return `<div class="ft-unit"><div class="n">${esc(b.unit)}</div><div class="b"><i style="width:${p}%;background:${col(p)}"></i></div><div class="p" style="color:${col(p)}">${b.correct}/${b.total}</div></div>`; }).join('')}</div>
        <div class="pv-review-list">${T.qs.map((q, i) => {
          const ch = T.ans[q.id], ok = ch === q.answer;
          return `<div class="pv-review-item"><div class="pv-review-header" onclick="this.nextElementSibling.classList.toggle('open')"><span style="font-size:1rem;flex-shrink:0">${ok ? '✅' : ch ? '❌' : '➖'}</span><div class="pv-review-q">Q${i + 1}: ${String(q.q).replace(/<[^>]+>/g, '').slice(0, 90)}</div><span class="pv-review-status ${ok ? 'correct' : 'incorrect'}">${ok ? 'Correct' : ch ? 'Incorrect' : 'Skipped'}</span></div>
            <div class="pv-review-body">${!ok ? `<div class="pv-review-correct-ans">✓ Correct answer: (${q.answer}) ${q.choices[q.answer]}</div>` : ''}${ch && !ok ? `<div style="color:var(--red);font-size:.78rem;margin-bottom:.4rem">✗ Your answer: (${ch}) ${q.choices[ch]}</div>` : ''}<div class="pv-review-expl">${q.explanation || ''}</div></div></div>`;
        }).join('')}</div>
        <div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;margin-top:1rem"><button class="pv-btn-outline" onclick="buildPracticeVault()">← Practice Vault</button><button class="pv-btn" onclick="FullTest.start()">Take another full test 🔀</button></div>
      </div></div></div>`;
    T = null;
  }

  window.FullTest = { hub, start, resume, pick, clear, flag, go, submit };
})();
