/* Northstar shared calendar. One component, three roles (student, tutor, admin).
   Uses the portal's global `db` (Supabase client) and `showToast`.
   Tables: scheduled_sessions (upcoming/booked), session_requests (new / reschedule / cancel),
   sessions (logged history, shown read-only). Times are stored in UTC and shown in the viewer's timezone. */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fmtTime = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDay = d => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const tzAbbr = () => { try { return new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value; } catch (e) { return ''; } };
  const toLocalInput = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const first = n => String(n || '').split(' ')[0] || '';
  // fire-and-forget email alert; never blocks or breaks the UI
  function notify(event, id, series) {
    if (!id) return;
    try { fetch('/api/notify-calendar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, id, series: series || undefined }), keepalive: true }).catch(() => {}); } catch (e) {}
  }

  /* ───────── time zones ───────── */
  const TZS = [
    ['America/Los_Angeles', 'Pacific (PT)'], ['America/Denver', 'Mountain (MT)'], ['America/Phoenix', 'Arizona (MST)'],
    ['America/Chicago', 'Central (CT)'], ['America/New_York', 'Eastern (ET)'],
    ['Europe/London', 'UK'], ['Asia/Kolkata', 'India (IST)']
  ];
  const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'; } catch (e) { return 'America/Los_Angeles'; } };
  const tzLabel = z => { const f = TZS.find(t => t[0] === z); return f ? f[1] : z; };
  const tzOptions = (sel) => {
    const list = TZS.slice(); if (sel && !list.some(t => t[0] === sel)) list.push([sel, sel]);
    return list.map(t => `<option value="${t[0]}" ${t[0] === sel ? 'selected' : ''}>${esc(t[1])}</option>`).join('');
  };
  // How far a zone is ahead of UTC at a given instant, in ms
  function tzOffsetMs(utcMs, tz) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(utcMs)).forEach(x => { if (x.type !== 'literal') p[x.type] = +x.value; });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
  }
  // Wall-clock time in a zone -> real UTC instant (daylight saving safe)
  function zonedToUtc(y, mo, d, h, mi, tz) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    let ms = guess - tzOffsetMs(guess, tz);
    ms = guess - tzOffsetMs(ms, tz);
    return new Date(ms);
  }
  // The family's zone if we know it, otherwise the zone of whoever is scheduling
  const tzFor = sid => { const s = ((S.o && S.o.students) || []).find(x => x.id === sid); return (s && s.timezone) || myTz(); };
  const tutorTzFor = tid => {
    if (!S.o) return null;
    if (S.o.role === 'tutor' && (!tid || tid === S.o.tutorId)) return S.o.tutorTimezone || myTz();
    const t = (S.o.tutors || []).find(x => x.id === tid); return (t && t.timezone) || null;
  };
  const fmtIn = (date, tz, withDay) => date.toLocaleString('en-US', Object.assign({ timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }, withDay ? { weekday: 'short', month: 'short', day: 'numeric' } : {}));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const S = { oh: [], el: null, o: null, cursor: new Date(), view: 'month', filter: '', sessions: [], logged: [], requests: [], names: {}, tutorNames: {} };

  function injectCss() {
    if (document.getElementById('nsCalCss')) return;
    const st = document.createElement('style');
    st.id = 'nsCalCss';
    st.textContent = `
.nscal{font-family:inherit}
.nscal-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem;margin-bottom:1rem}
.nscal-title{font-size:1.15rem;font-weight:800;color:#0f2044;min-width:9.5rem;text-align:center}
.nscal-btn{border:1.5px solid #e2e8f0;background:#fff;color:#0f2044;border-radius:9px;padding:.4rem .8rem;font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit}
.nscal-btn:hover{border-color:#0f2044}
.nscal-btn.pri{background:#0f2044;color:#fff;border-color:#0f2044}
.nscal-btn.gold{background:#c9a03a;color:#0f2044;border-color:#c9a03a}
.nscal-btn.danger{color:#dc2626;border-color:#fecaca}
.nscal-btn.sm{padding:.25rem .6rem;font-size:.72rem}
.nscal-toggle{display:inline-flex;border:1.5px solid #e2e8f0;border-radius:9px;overflow:hidden}
.nscal-toggle button{border:0;background:#fff;padding:.4rem .8rem;font-size:.78rem;font-weight:700;color:#64748b;cursor:pointer;font-family:inherit}
.nscal-toggle button.on{background:#0f2044;color:#fff}
.nscal-sel{border:1.5px solid #e2e8f0;border-radius:9px;padding:.4rem .6rem;font-size:.8rem;background:#fff;font-family:inherit;color:#0f2044}
.nscal-grid{display:grid;grid-template-columns:repeat(7,1fr);border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff}
.nscal-dow{background:#f8fafc;padding:.45rem;font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#64748b;text-align:center;border-bottom:1px solid #e5e7eb}
.nscal-cell{min-height:92px;border-right:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;padding:.3rem;display:flex;flex-direction:column;gap:2px;overflow:hidden}
.nscal-cell:nth-child(7n){border-right:0}
.nscal-cell.dim{background:#fafbfc}
.nscal-cell.dim .nscal-num{opacity:.4}
.nscal-cell.today{background:#fffbeb}
.nscal-num{font-size:.72rem;font-weight:700;color:#475569;padding:0 .15rem}
.nscal-cell.today .nscal-num{color:#fff;background:#c9a03a;border-radius:99px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;padding:0}
.nscal-chip{font-size:.66rem;font-weight:700;border-radius:5px;padding:.15rem .3rem;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#0f2044;color:#fff;border:1px solid #0f2044;text-align:left;font-family:inherit;width:100%}
.nscal-chip.pend{background:#fef3c7;color:#92400e;border-color:#fcd34d}
.nscal-chip.done{background:#dcfce7;color:#166534;border-color:#bbf7d0}
.nscal-chip.oh{background:#c9a03a;color:#0f2044;border-color:#c9a03a}
.nscal-chip.cancel{background:#f1f5f9;color:#94a3b8;border-color:#e2e8f0;text-decoration:line-through}
.nscal-more{font-size:.62rem;color:#64748b;font-weight:700;padding-left:.2rem}
.nscal-panel{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:1rem 1.1rem;margin-bottom:1rem}
.nscal-panel h4{margin:0 0 .6rem;font-size:.85rem;color:#0f2044}
.nscal-row{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem;padding:.55rem 0;border-top:1px solid #f1f5f9}
.nscal-row:first-of-type{border-top:0}
.nscal-row .grow{flex:1;min-width:180px}
.nscal-row .t1{font-weight:700;font-size:.85rem;color:#0f2044}
.nscal-row .t2{font-size:.76rem;color:#64748b}
.nscal-badge{font-size:.66rem;font-weight:800;border-radius:99px;padding:.15rem .55rem;background:#fef3c7;color:#92400e}
.nscal-empty{padding:1.5rem;text-align:center;color:#94a3b8;font-size:.85rem}
.nscal-tz{font-size:.72rem;color:#94a3b8;margin-top:.6rem}
.nscal-ov{position:fixed;inset:0;background:rgba(10,20,45,.55);backdrop-filter:blur(3px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem}
.nscal-md{background:#fff;border-radius:14px;width:100%;max-width:440px;max-height:92vh;overflow:auto;box-shadow:0 24px 80px rgba(0,0,0,.35)}
.nscal-mh{background:linear-gradient(135deg,#0f2044,#1a3260);color:#fff;padding:1rem 1.25rem;font-weight:800;display:flex;justify-content:space-between;align-items:center}
.nscal-mh button{background:rgba(255,255,255,.12);border:0;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:1rem}
.nscal-mb{padding:1.1rem 1.25rem;display:flex;flex-direction:column;gap:.75rem}
.nscal-mb label{font-size:.72rem;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:.25rem}
.nscal-mb input,.nscal-mb select,.nscal-mb textarea{width:100%;border:1.5px solid #e2e8f0;border-radius:9px;padding:.5rem .65rem;font-size:.85rem;font-family:inherit;box-sizing:border-box}
.nscal-acts{display:flex;flex-wrap:wrap;gap:.5rem}
@media(max-width:640px){.nscal-cell{min-height:64px}.nscal-chip{font-size:.58rem}.nscal-title{min-width:7rem;font-size:1rem}}
`;
    document.head.appendChild(st);
  }

  /* ───────── data ───────── */
  const isStaff = () => S.o.role === 'tutor' || S.o.role === 'admin';
  const studentIds = () => S.o.studentIds || null; // null = all (admin)

  async function load() {
    const from = new Date(S.cursor.getFullYear(), S.cursor.getMonth() - 1, 1).toISOString();
    const to = new Date(S.cursor.getFullYear(), S.cursor.getMonth() + 2, 1).toISOString();
    const ids = studentIds();
    let q1 = db.from('scheduled_sessions').select('*').gte('starts_at', from).lt('starts_at', to).order('starts_at');
    let q2 = db.from('session_requests').select('*').order('created_at', { ascending: false }).limit(200);
    let q3 = db.from('sessions').select('id, student_id, session_date, duration_hours, topic, approved')
      .gte('session_date', from.slice(0, 10)).lt('session_date', to.slice(0, 10));
    if (ids) { q1 = q1.in('student_id', ids); q2 = q2.in('student_id', ids); q3 = q3.in('student_id', ids); }
    const q4 = db.from('office_hours').select('*').eq('status', 'scheduled').gte('starts_at', from).lt('starts_at', to).order('starts_at');
    const [a, b, c, d4] = await Promise.all([q1, q2, q3, q4]);
    S.oh = d4.error ? [] : (d4.data || []);
    const bad = a.error || b.error || c.error; if (bad) throw new Error(bad.message);
    S.sessions = a.data || [];
    S.requests = b.data || [];
    S.logged = c.data || [];
    // names for admin (students/tutors come in via opts)
    (S.o.students || []).forEach(s => { S.names[s.id] = s.name; });
    (S.o.tutors || []).forEach(t => { S.tutorNames[t.id] = t.name; });
    if (S.o.tutorName && S.o.tutorId) S.tutorNames[S.o.tutorId] = S.o.tutorName;
  }

  function visible(list, key = 'student_id') {
    if (!S.filter) return list;
    const [kind, id] = S.filter.split(':');
    if (kind === 's') return list.filter(x => x.student_id === id);
    if (kind === 't') return list.filter(x => x.tutor_id === id);
    return list;
  }

  /* ───────── render ───────── */
  async function render() {
    const c = S.cursor;
    const label = S.view === 'month' ? MONTHS[c.getMonth()] + ' ' + c.getFullYear() : 'Upcoming';
    S.el.innerHTML = `<div class="nscal">
      <div class="nscal-bar">
        ${S.view === 'month' ? `<button class="nscal-btn" data-a="prev">‹</button><div class="nscal-title">${label}</div><button class="nscal-btn" data-a="next">›</button><button class="nscal-btn" data-a="today">Today</button>` : `<div class="nscal-title" style="text-align:left">${label}</div>`}
        <div class="nscal-toggle"><button data-a="vm" class="${S.view === 'month' ? 'on' : ''}">Month</button><button data-a="vl" class="${S.view === 'list' ? 'on' : ''}">List</button></div>
        ${filterSelect()}
        <span style="flex:1"></span>
        <button class="nscal-btn gold" data-a="new">${isStaff() ? '+ Schedule session' : '+ Request a session'}</button>
      </div>
      <div id="nscalPanels"></div>
      <div id="nscalBody"><div class="nscal-empty">Loading…</div></div>
      <div class="nscal-tz">Times shown in your timezone (${esc(tzAbbr())}).</div>
    </div>`;
    wire();
    try {
      await load();
      panels();
      S.view === 'month' ? month() : list();
    } catch (e) { showErr(e); }
    NSCal.badge();
  }
  function showErr(e) {
    console.error('[NSCal]', e);
    const b = document.getElementById('nscalBody');
    if (b) b.innerHTML = `<div class="nscal-panel nscal-empty">Could not load the calendar.<br><span style="font-size:.75rem">${esc(e && e.message || e)}</span><br><br><button class="nscal-btn" onclick="NSCal.reload()">Try again</button></div>`;
  }

  function filterSelect() {
    if (S.o.role !== 'admin') return '';
    const st = (S.o.students || []).map(s => `<option value="s:${s.id}" ${S.filter === 's:' + s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    const tu = (S.o.tutors || []).map(t => `<option value="t:${t.id}" ${S.filter === 't:' + t.id ? 'selected' : ''}>Tutor: ${esc(t.name)}</option>`).join('');
    return `<select class="nscal-sel" data-a="filter"><option value="">Everyone</option>${st}${tu}</select>`;
  }

  function wire() {
    S.el.querySelectorAll('[data-a]').forEach(b => {
      const a = b.dataset.a;
      if (a === 'filter') { b.onchange = () => { S.filter = b.value; refresh(); }; return; }
      b.onclick = () => {
        if (a === 'prev') { S.cursor = new Date(S.cursor.getFullYear(), S.cursor.getMonth() - 1, 1); render(); }
        else if (a === 'next') { S.cursor = new Date(S.cursor.getFullYear(), S.cursor.getMonth() + 1, 1); render(); }
        else if (a === 'today') { S.cursor = new Date(); render(); }
        else if (a === 'vm') { S.view = 'month'; render(); }
        else if (a === 'vl') { S.view = 'list'; render(); }
        else if (a === 'new') openForm();
      };
    });
  }

  async function refresh() { try { await load(); panels(); S.view === 'month' ? month() : list(); } catch (e) { showErr(e); } NSCal.badge(); }

  function who(x) {
    // label for staff = student first name; for students = tutor first name
    if (S.o.role === 'student') return first(S.tutorNames[x.tutor_id]) || 'Session';
    return first(S.names[x.student_id]) || 'Student';
  }

  function evOf(x) { return { ...x, d: new Date(x.starts_at) }; }
  function pendingFor(sid) { return S.requests.find(r => r.status === 'pending' && r.scheduled_session_id === sid); }

  function month() {
    const c = S.cursor, y = c.getFullYear(), m = c.getMonth();
    const start = new Date(y, m, 1 - new Date(y, m, 1).getDay());
    const map = {};
    visible(S.sessions).forEach(x => { (map[dayKey(new Date(x.starts_at))] = map[dayKey(new Date(x.starts_at))] || []).push({ t: 's', x }); });
    visible(S.logged).forEach(x => { const k = x.session_date; (map[k] = map[k] || []).push({ t: 'l', x }); });
    S.oh.forEach(x => { const k = dayKey(new Date(x.starts_at)); (map[k] = map[k] || []).push({ t: 'o', x }); });
    const todayK = dayKey(new Date());
    let cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="nscal-dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = dayKey(d);
      // hide logged entries that duplicate a booked session the same day for the same student
      const items = (map[k] || []).filter(e => !(e.t === 'l' && (map[k] || []).some(o => o.t === 's' && o.x.student_id === e.x.student_id && o.x.status === 'completed')));
      items.sort((a, b) => (a.t === 's' ? a.x.starts_at : k) < (b.t === 's' ? b.x.starts_at : k) ? -1 : 1);
      const shown = items.slice(0, 3).map(e => chip(e)).join('');
      const more = items.length > 3 ? `<div class="nscal-more">+${items.length - 3} more</div>` : '';
      cells += `<div class="nscal-cell${d.getMonth() !== m ? ' dim' : ''}${k === todayK ? ' today' : ''}"><div class="nscal-num">${d.getDate()}</div>${shown}${more}</div>`;
    }
    document.getElementById('nscalBody').innerHTML = `<div class="nscal-grid">${cells}</div>`;
    document.querySelectorAll('#nscalBody [data-sid]').forEach(b => { b.onclick = () => openDetail(b.dataset.sid); });
    document.querySelectorAll('#nscalBody [data-oid]').forEach(b => { b.onclick = () => openOH(b.dataset.oid); });
  }

  function chip(e) {
    if (e.t === 'o') return `<button class="nscal-chip oh" data-oid="${e.x.id}">${esc(fmtTime(new Date(e.x.starts_at)))} Office hours</button>`;
    if (e.t === 'l') {
      const nm = S.o.role === 'student' ? 'Session' : first(S.names[e.x.student_id]) || 'Session';
      return `<button class="nscal-chip done" title="Logged session" data-lid="${e.x.id}" onclick="event.stopPropagation()">✓ ${esc(nm)} · ${e.x.duration_hours || ''}h</button>`;
    }
    const x = e.x, d = new Date(x.starts_at);
    const cls = x.status === 'cancelled' ? 'cancel' : x.status === 'completed' ? 'done' : pendingFor(x.id) ? 'pend' : '';
    return `<button class="nscal-chip ${cls}" data-sid="${x.id}">${esc(fmtTime(d))} ${esc(who(x))}</button>`;
  }

  function list() {
    const now = Date.now() - 60 * 60 * 1000;
    const up = visible(S.sessions).filter(x => x.status === 'scheduled' && new Date(x.starts_at).getTime() >= now);
    const body = document.getElementById('nscalBody');
    if (!up.length) { body.innerHTML = `<div class="nscal-panel nscal-empty">Nothing booked yet. ${isStaff() ? 'Use Schedule session to add one.' : 'Use Request a session to ask for a time.'}</div>`; return; }
    let lastDay = '', html = '<div class="nscal-panel">';
    up.forEach(x => {
      const d = new Date(x.starts_at), k = dayKey(d);
      if (k !== lastDay) { html += `<h4 style="margin-top:${lastDay ? '.9rem' : '0'}">${esc(fmtDay(d))}</h4>`; lastDay = k; }
      const p = pendingFor(x.id);
      html += `<div class="nscal-row"><div class="grow"><div class="t1">${esc(fmtTime(d))} · ${x.duration_minutes} min · ${esc(S.o.role === 'student' ? (S.tutorNames[x.tutor_id] || 'Tutor') : (S.names[x.student_id] || 'Student'))}</div><div class="t2">${esc(x.topic || 'Tutoring session')}${S.o.role === 'admin' && x.tutor_id ? ' · ' + esc(S.tutorNames[x.tutor_id] || '') : ''}</div></div>${p ? `<span class="nscal-badge">${esc(p.kind)} requested</span>` : ''}<button class="nscal-btn sm" data-sid="${x.id}">Open</button></div>`;
    });
    body.innerHTML = html + '</div>';
    body.querySelectorAll('[data-sid]').forEach(b => { b.onclick = () => openDetail(b.dataset.sid); });
  }

  /* ───────── request panels ───────── */
  function panels() {
    const el = document.getElementById('nscalPanels');
    if (!el) return;
    const pend = visible(S.requests.filter(r => r.status === 'pending'));
    let html = '';
    if (isStaff() && pend.length) {
      html += `<div class="nscal-panel" style="border-color:#fcd34d;background:#fffdf5"><h4>⏳ ${pend.length} request${pend.length === 1 ? '' : 's'} to review</h4>${pend.map(r => reqRow(r, true)).join('')}</div>`;
    } else if (!isStaff()) {
      const mine = S.requests.filter(r => r.status === 'pending');
      const recent = S.requests.filter(r => r.status !== 'pending' && Date.now() - new Date(r.decided_at || r.created_at).getTime() < 7 * 864e5).slice(0, 3);
      if (mine.length || recent.length) html += `<div class="nscal-panel"><h4>Your requests</h4>${mine.concat(recent).map(r => reqRow(r, false)).join('')}</div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-rid]').forEach(b => { b.onclick = () => decide(b.dataset.rid, b.dataset.do); });
  }

  function reqRow(r, canDecide) {
    const kind = r.kind === 'new' ? 'New session' : r.kind === 'reschedule' ? 'Reschedule' : 'Cancel';
    const when = r.proposed_starts_at ? fmtDay(new Date(r.proposed_starts_at)) + ' ' + fmtTime(new Date(r.proposed_starts_at)) : '';
    const orig = r.scheduled_session_id ? S.sessions.find(s => s.id === r.scheduled_session_id) : null;
    const was = orig ? ` (now ${fmtDay(new Date(orig.starts_at))} ${fmtTime(new Date(orig.starts_at))})` : '';
    const status = r.status === 'pending' ? '<span class="nscal-badge">Pending</span>' : `<span class="nscal-badge" style="background:${r.status === 'approved' ? '#dcfce7;color:#166534' : '#fee2e2;color:#991b1b'}">${r.status === 'approved' ? 'Approved' : 'Declined'}</span>`;
    return `<div class="nscal-row"><div class="grow"><div class="t1">${esc(kind)}${canDecide ? ' · ' + esc(S.names[r.student_id] || 'Student') : ''}${when ? ' → ' + esc(when) : ''}</div><div class="t2">${esc(r.reason || '')}${esc(was)}</div></div>
      ${canDecide ? `<button class="nscal-btn sm pri" data-rid="${r.id}" data-do="approved">Approve</button><button class="nscal-btn sm danger" data-rid="${r.id}" data-do="declined">Decline</button>` : status}</div>`;
  }

  async function decide(id, verdict) {
    const r = S.requests.find(x => x.id === id);
    if (!r) return;
    try {
      if (verdict === 'approved') {
        if (r.kind === 'new') {
          const stu = (S.o.students || []).find(s => s.id === r.student_id);
          const { error } = await db.from('scheduled_sessions').insert({ student_id: r.student_id, tutor_id: r.tutor_id || (stu && stu.tutor_id) || null, starts_at: r.proposed_starts_at, duration_minutes: r.proposed_duration_minutes || 60, topic: r.reason || null, created_by: 'student' });
          if (error) throw error;
        } else if (r.kind === 'reschedule') {
          const upd = { starts_at: r.proposed_starts_at }; if (r.proposed_duration_minutes) upd.duration_minutes = r.proposed_duration_minutes;
          const { error } = await db.from('scheduled_sessions').update(upd).eq('id', r.scheduled_session_id);
          if (error) throw error;
        } else if (r.kind === 'cancel') {
          const { error } = await db.from('scheduled_sessions').update({ status: 'cancelled' }).eq('id', r.scheduled_session_id);
          if (error) throw error;
        }
      }
      const { error: e2 } = await db.from('session_requests').update({ status: verdict, decided_by: S.o.role, decided_at: new Date().toISOString() }).eq('id', id);
      if (e2) throw e2;
      notify('request_decided', id);
      showToast(verdict === 'approved' ? 'Approved ✅' : 'Declined', 'success');
      refresh();
    } catch (e) { showToast('Error: ' + (e.message || e), 'error'); }
  }

  /* ───────── modals ───────── */
  function modal(title, body) {
    closeModal();
    const o = document.createElement('div');
    o.className = 'nscal-ov'; o.id = 'nscalOv';
    o.innerHTML = `<div class="nscal-md"><div class="nscal-mh"><span>${esc(title)}</span><button onclick="NSCal.close()">×</button></div><div class="nscal-mb">${body}</div></div>`;
    o.onclick = e => { if (e.target === o) closeModal(); };
    document.body.appendChild(o);
    return o;
  }
  function closeModal() { const o = document.getElementById('nscalOv'); if (o) o.remove(); }

  function durOptions(sel) { return [30, 45, 60, 75, 90, 120].map(n => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n} min</option>`).join(''); }

  function openOH(id) {
    const x = S.oh.find(o => o.id === id); if (!x) return;
    const d = new Date(x.starts_at), end = new Date(d.getTime() + x.duration_minutes * 60000);
    modal('Office hours', `<div><div style="font-size:1.05rem;font-weight:800;color:#0f2044">${esc(fmtDay(d))} · ${esc(fmtTime(d))} to ${esc(fmtTime(end))}</div>
      <div style="font-size:.82rem;color:#64748b;margin-top:.25rem">${x.host_name ? 'Hosted by ' + esc(x.host_name) + '. ' : ''}Open to every student. Drop in with any question.</div></div>
      <div class="nscal-acts">${x.meeting_url ? `<a class="nscal-btn pri" style="text-decoration:none" href="${esc(x.meeting_url)}" target="_blank" rel="noopener">📹 Join meeting</a>` : '<span style="font-size:.8rem;color:#94a3b8">Meeting link coming soon</span>'}</div>`);
  }

  function openForm() {
    const stu = S.o.students || [];
    const defStu = S.o.defaultStudentId || (stu[0] && stu[0].id) || '';
    const staff = isStaff();
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(16, 0, 0, 0);
    const o = modal(staff ? 'Schedule a session' : 'Request a session', `
      ${stu.length > 1 ? `<div><label>Student</label><select id="ncStu">${stu.map(s => `<option value="${s.id}" ${s.id === defStu ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : `<input type="hidden" id="ncStu" value="${esc(defStu)}">`}
      ${staff ? `<div><label>Time zone for this time</label><select id="ncTz">${tzOptions(tzFor(defStu))}</select></div>` : ''}
      <div><label>Date and time (<span id="ncTzName">${esc(staff ? tzLabel(tzFor(defStu)) : tzAbbr())}</span>)</label><input type="datetime-local" id="ncWhen" value="${toLocalInput(d)}"></div>
      ${staff ? `<div id="ncPrev" style="font-size:.76rem;color:#475569;background:#f8fafc;border-radius:8px;padding:.5rem .65rem;line-height:1.5"></div>` : ''}
      <div><label>Length</label><select id="ncDur">${durOptions(60)}</select></div>
      <div><label>${staff ? 'Topic' : 'What do you want to work on?'}</label><input id="ncTopic" placeholder="${staff ? 'e.g. Unit 4 review' : 'e.g. Chain rule practice'}"></div>
      ${staff ? `<div><label>Meeting link (optional)</label><input id="ncMeet" type="url" placeholder="https://meet.google.com/..."></div>
      <div><label style="display:flex;align-items:center;gap:.4rem;text-transform:none;letter-spacing:0;font-size:.82rem;cursor:pointer"><input type="checkbox" id="ncRep" style="width:auto"> Repeat weekly</label>
        <div id="ncRepBox" style="display:none;margin-top:.5rem">
          <div style="display:flex;gap:.3rem;flex-wrap:wrap">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n, i) => `<label style="border:1.5px solid #e2e8f0;border-radius:8px;padding:.3rem .5rem;font-size:.75rem;font-weight:700;cursor:pointer;text-transform:none;letter-spacing:0;display:inline-flex;align-items:center;gap:.25rem;margin:0"><input type="checkbox" class="ncDay" value="${i}" style="width:auto"> ${n}</label>`).join('')}</div>
          <div style="margin-top:.5rem;display:flex;align-items:center;gap:.5rem;font-size:.8rem">For <input type="number" id="ncWeeks" min="1" max="26" value="8" style="width:70px"> weeks, same time each day</div>
          <div id="ncRepSum" style="font-size:.74rem;color:#64748b;margin-top:.35rem"></div>
        </div></div>` : ''}
      <div class="nscal-acts"><button class="nscal-btn pri" id="ncGo">${staff ? 'Schedule' : 'Send request'}</button><button class="nscal-btn" onclick="NSCal.close()">Cancel</button></div>
      ${staff ? '' : '<div style="font-size:.74rem;color:#64748b">Your tutor will confirm. You will see it here once it is approved.</div>'}`);

    // Wall-clock parts from the datetime-local value (no zone applied)
    const parts = v => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ''); return m ? { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] } : null; };
    // All the instants this form will create (one, or the weekly series)
    const instants = () => {
      const when = o.querySelector('#ncWhen').value, p = parts(when); if (!p) return [];
      const tz = staff ? o.querySelector('#ncTz').value : myTz();
      const rep = staff && o.querySelector('#ncRep').checked;
      if (!rep) return [zonedToUtc(p.y, p.mo, p.d, p.h, p.mi, tz)];
      const days = [...o.querySelectorAll('.ncDay:checked')].map(x => +x.value);
      const weeks = Math.max(1, Math.min(26, parseInt(o.querySelector('#ncWeeks').value, 10) || 1));
      const out = [];
      for (let i = 0; i < weeks * 7; i++) {
        const wall = new Date(Date.UTC(p.y, p.mo - 1, p.d + i));
        if (!days.includes(wall.getUTCDay())) continue;
        const t = zonedToUtc(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(), p.h, p.mi, tz);
        if (t.getTime() > Date.now()) out.push(t);
      }
      return out;
    };
    const stuTzSel = () => { const sid = o.querySelector('#ncStu').value; return tzFor(sid); };
    const tutTz = () => { const sid = o.querySelector('#ncStu').value; const s = (S.o.students || []).find(x => x.id === sid); return tutorTzFor((s && s.tutor_id) || S.o.tutorId); };
    const preview = () => {
      if (!staff) return;
      const first1 = instants()[0], pv = o.querySelector('#ncPrev'), sum = o.querySelector('#ncRepSum');
      o.querySelector('#ncTzName').textContent = tzLabel(o.querySelector('#ncTz').value);
      if (!first1) { pv.textContent = 'Pick a date and time.'; return; }
      const sz = stuTzSel(), tz2 = tutTz(), me = myTz();
      const stuName = first((S.names[o.querySelector('#ncStu').value])) || 'Student';
      const lines = [`${esc(stuName)} sees <b>${esc(fmtIn(first1, sz, true))}</b>`];
      if (tz2 && tz2 !== sz) lines.push(`Tutor sees <b>${esc(fmtIn(first1, tz2, true))}</b>`);
      if (me !== sz && me !== tz2) lines.push(`You see ${esc(fmtIn(first1, me, true))}`);
      pv.innerHTML = lines.join('<br>');
      if (o.querySelector('#ncRep').checked) { const n = instants().length; sum.textContent = n ? n + ' session' + (n === 1 ? '' : 's') + ' will be created.' : 'Pick at least one day.'; }
    };
    if (staff) {
      const stuSel = o.querySelector('#ncStu');
      stuSel.onchange = () => { o.querySelector('#ncTz').innerHTML = tzOptions(stuTzSel()); preview(); };
      ['#ncTz', '#ncWhen', '#ncWeeks'].forEach(q => { const el = o.querySelector(q); el.oninput = preview; el.onchange = preview; });
      o.querySelectorAll('.ncDay').forEach(el => { el.onchange = preview; });
      o.querySelector('#ncRep').onchange = e => {
        o.querySelector('#ncRepBox').style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked && !o.querySelector('.ncDay:checked')) {
          const p = parts(o.querySelector('#ncWhen').value);
          if (p) { const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay(); const b = o.querySelector('.ncDay[value="' + dow + '"]'); if (b) b.checked = true; }
        }
        preview();
      };
      preview();
    }
    o.querySelector('#ncGo').onclick = async () => {
      const sid = o.querySelector('#ncStu').value, when = o.querySelector('#ncWhen').value;
      if (!sid || !when) { showToast('Pick a time first.', 'error'); return; }
      const times = instants();
      if (!times.length) { showToast(staff && o.querySelector('#ncRep').checked ? 'Pick at least one day in the future.' : 'Pick a time first.', 'error'); return; }
      const dur = parseInt(o.querySelector('#ncDur').value, 10), topic = o.querySelector('#ncTopic').value.trim() || null;
      const s = (S.o.students || []).find(x => x.id === sid);
      const tutorId = (s && s.tutor_id) || S.o.tutorId || null;
      o.querySelector('#ncGo').disabled = true;
      let res;
      if (staff) {
        // Remember the zone chosen for this family so next time it is the default
        const tzSel = o.querySelector('#ncTz').value;
        if (s && s.timezone !== tzSel) { try { const r = await db.from('students').update({ timezone: tzSel }).eq('id', sid); if (!r.error) s.timezone = tzSel; } catch (e) {} }
        const meet = (o.querySelector('#ncMeet').value || '').trim() || null;
        const seriesId = times.length > 1 ? (crypto.randomUUID ? crypto.randomUUID() : null) : null;
        const rows = times.map(t => ({ student_id: sid, tutor_id: tutorId, starts_at: t.toISOString(), duration_minutes: dur, topic, meeting_url: meet, created_by: S.o.role, series_id: seriesId }));
        res = await db.from('scheduled_sessions').insert(rows).select('id, starts_at');
        if (!res.error) { const firstRow = (res.data || []).slice().sort((a, b) => a.starts_at < b.starts_at ? -1 : 1)[0]; res.data = firstRow; res.count = rows.length; }
      } else {
        res = await db.from('session_requests').insert({ student_id: sid, tutor_id: tutorId, kind: 'new', proposed_starts_at: times[0].toISOString(), proposed_duration_minutes: dur, reason: topic, requested_by: 'student' }).select('id').single();
      }
      if (res.error) { showToast('Error: ' + res.error.message, 'error'); o.querySelector('#ncGo').disabled = false; return; }
      notify(staff ? 'session_scheduled' : 'request_created', res.data && res.data.id, staff && res.count > 1 ? res.count : undefined);
      closeModal(); showToast(staff ? (res.count > 1 ? res.count + ' sessions scheduled ✅' : 'Session scheduled ✅') : 'Request sent ✅', 'success'); refresh();
    };
  }

  function openDetail(id) {
    const x = S.sessions.find(s => s.id === id);
    if (!x) return;
    const d = new Date(x.starts_at), staff = isStaff(), p = pendingFor(x.id), active = x.status === 'scheduled';
    const o = modal('Session', `
      <div><div style="font-size:1.05rem;font-weight:800;color:#0f2044">${esc(fmtDay(d))} · ${esc(fmtTime(d))}</div>
      <div style="font-size:.82rem;color:#64748b;margin-top:.2rem">${x.duration_minutes} min · ${esc(S.o.role === 'student' ? (S.tutorNames[x.tutor_id] || 'Tutor') : (S.names[x.student_id] || 'Student') + (S.tutorNames[x.tutor_id] && S.o.role === 'admin' ? ' with ' + S.tutorNames[x.tutor_id] : ''))}</div>
      ${x.topic ? `<div style="font-size:.85rem;margin-top:.5rem">${esc(x.topic)}</div>` : ''}
      ${staff ? (() => { const sz = tzFor(x.student_id), tz2 = tutorTzFor(x.tutor_id); const l = [`Student: ${esc(fmtIn(d, sz, false))}`]; if (tz2 && tz2 !== sz) l.push(`Tutor: ${esc(fmtIn(d, tz2, false))}`); return `<div style="font-size:.76rem;color:#475569;margin-top:.5rem;line-height:1.5">${l.join('<br>')}</div>`; })() : `<div style="font-size:.76rem;color:#64748b;margin-top:.3rem">${esc(fmtIn(d, myTz(), false))}</div>`}
      ${x.series_id && staff ? `<div style="font-size:.74rem;color:#64748b;margin-top:.4rem">Part of a weekly series</div>` : ''}
      ${x.status !== 'scheduled' ? `<div style="margin-top:.5rem"><span class="nscal-badge">${esc(x.status)}</span></div>` : ''}
      ${p ? `<div style="margin-top:.5rem"><span class="nscal-badge">${esc(p.kind)} request pending</span></div>` : ''}</div>
      <div class="nscal-acts">
        ${x.meeting_url && active ? `<a class="nscal-btn pri" style="text-decoration:none" href="${esc(x.meeting_url)}" target="_blank" rel="noopener">📹 Join meeting</a>` : ''}
        ${active && !staff && !p ? `<button class="nscal-btn" id="ndRe">Request reschedule</button><button class="nscal-btn danger" id="ndCa">Request cancel</button>` : ''}
        ${active && staff ? `<button class="nscal-btn" id="ndEd">Reschedule</button><button class="nscal-btn danger" id="ndCx">Cancel session</button>${x.series_id ? '<button class="nscal-btn danger" id="ndCs">Cancel this and all later in series</button>' : ''}` : ''}
      </div>`);
    const cs = o.querySelector('#ndCs');
    if (cs) cs.onclick = async () => {
      if (!confirm('Cancel this session and every later session in this weekly series?')) return;
      const { data, error } = await db.from('scheduled_sessions').update({ status: 'cancelled' }).eq('series_id', x.series_id).eq('status', 'scheduled').gte('starts_at', x.starts_at).select('id');
      if (error) { showToast('Error: ' + error.message, 'error'); return; }
      notify('session_cancelled', x.id, (data || []).length);
      closeModal(); showToast((data || []).length + ' sessions cancelled', 'success'); refresh();
    };
    const re = o.querySelector('#ndRe'), ca = o.querySelector('#ndCa'), ed = o.querySelector('#ndEd'), cx = o.querySelector('#ndCx');
    if (re) re.onclick = () => openMove(x, false);
    if (ed) ed.onclick = () => openMove(x, true);
    if (ca) ca.onclick = () => openCancelReq(x);
    if (cx) cx.onclick = async () => {
      if (!confirm('Cancel this session?')) return;
      const { error } = await db.from('scheduled_sessions').update({ status: 'cancelled' }).eq('id', x.id);
      if (error) { showToast('Error: ' + error.message, 'error'); return; }
      notify('session_cancelled', x.id);
      closeModal(); showToast('Session cancelled', 'success'); refresh();
    };
  }

  function openMove(x, direct) {
    const d = new Date(x.starts_at);
    const zone0 = direct ? tzFor(x.student_id) : myTz();
    // datetime-local text for an instant as seen on the wall clock of a zone
    const wallIn = (date, tz) => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date).forEach(q => { if (q.type !== 'literal') p[q.type] = q.value; }); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
    const o = modal(direct ? 'Reschedule session' : 'Request a new time', `
      ${direct ? `<div><label>Time zone</label><select id="nmTz">${tzOptions(zone0)}</select></div>` : ''}
      <div><label>New date and time (<span id="nmTzName">${esc(direct ? tzLabel(zone0) : tzAbbr())}</span>)</label><input type="datetime-local" id="nmWhen" value="${direct ? wallIn(d, zone0) : toLocalInput(d)}"></div>
      <div><label>Length</label><select id="nmDur">${durOptions(x.duration_minutes)}</select></div>
      ${direct ? '' : `<div><label>Reason (optional)</label><textarea id="nmWhy" rows="2" placeholder="e.g. I have a test that day"></textarea></div>`}
      <div class="nscal-acts"><button class="nscal-btn pri" id="nmGo">${direct ? 'Save' : 'Send request'}</button><button class="nscal-btn" onclick="NSCal.close()">Cancel</button></div>`);
    if (direct) {
      const tzEl = o.querySelector('#nmTz');
      tzEl.onchange = () => {
        o.querySelector('#nmTzName').textContent = tzLabel(tzEl.value);
        o.querySelector('#nmWhen').value = wallIn(d, tzEl.value);
      };
    }
    o.querySelector('#nmGo').onclick = async () => {
      const when = o.querySelector('#nmWhen').value; if (!when) return;
      let iso;
      if (direct) { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(when); iso = zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], o.querySelector('#nmTz').value).toISOString(); }
      else iso = new Date(when).toISOString();
      const dur = parseInt(o.querySelector('#nmDur').value, 10);
      const res = direct
        ? await db.from('scheduled_sessions').update({ starts_at: iso, duration_minutes: dur, reminder_sent_at: null }).eq('id', x.id).select('id').single()
        : await db.from('session_requests').insert({ student_id: x.student_id, tutor_id: x.tutor_id, scheduled_session_id: x.id, kind: 'reschedule', proposed_starts_at: iso, proposed_duration_minutes: dur, reason: (o.querySelector('#nmWhy').value || '').trim() || null, requested_by: 'student' }).select('id').single();
      if (res.error) { showToast('Error: ' + res.error.message, 'error'); return; }
      notify(direct ? 'session_rescheduled' : 'request_created', res.data && res.data.id);
      closeModal(); showToast(direct ? 'Session moved ✅' : 'Request sent ✅', 'success'); refresh();
    };
  }

  function openCancelReq(x) {
    const o = modal('Request to cancel', `
      <div><label>Reason (optional)</label><textarea id="ncqWhy" rows="2"></textarea></div>
      <div class="nscal-acts"><button class="nscal-btn danger" id="ncqGo">Send cancel request</button><button class="nscal-btn" onclick="NSCal.close()">Back</button></div>`);
    o.querySelector('#ncqGo').onclick = async () => {
      const { data, error } = await db.from('session_requests').insert({ student_id: x.student_id, tutor_id: x.tutor_id, scheduled_session_id: x.id, kind: 'cancel', reason: (o.querySelector('#ncqWhy').value || '').trim() || null, requested_by: 'student' }).select('id').single();
      if (error) { showToast('Error: ' + error.message, 'error'); return; }
      notify('request_created', data && data.id);
      closeModal(); showToast('Request sent ✅', 'success'); refresh();
    };
  }

  /* ───────── public ───────── */
  window.NSCal = {
    close: closeModal,
    reload() { render(); },
    markSeen(studentId) { try { localStorage.setItem('nscal_seen_' + studentId, new Date().toISOString()); } catch (e) {} const el = document.getElementById('calNavBadge'); if (el) el.style.display = 'none'; },
    /* pending-request count shown on the tutor "My Calendar" button and the admin Calendar nav */
    async badge(ctx) {
      if (ctx) NSCal._ctx = ctx;
      const c = NSCal._ctx; if (!c) return;
      try {
        let q = db.from('session_requests').select('id', { count: 'exact', head: true });
        if (c.role === 'student') {
          let seen = '1970-01-01T00:00:00Z'; try { seen = localStorage.getItem('nscal_seen_' + c.studentIds[0]) || seen; } catch (e) {}
          q = q.neq('status', 'pending').gt('decided_at', seen);
        } else q = q.eq('status', 'pending');
        if (c.studentIds) q = q.in('student_id', c.studentIds);
        const { count } = await q;
        const el = document.getElementById(c.el);
        if (el) { el.textContent = count || ''; el.style.display = count ? 'inline-flex' : 'none'; }
        
      } catch (e) {}
    },
    /* opts: { role, studentIds|null, students:[{id,name,tutor_id}], tutors:[{id,name}], tutorId, tutorName, defaultStudentId } */
    mount(el, opts) {
      injectCss();
      S.el = el; S.o = opts; S.cursor = new Date(); S.view = 'month'; S.filter = '';
      render();
    }
  };
})();
