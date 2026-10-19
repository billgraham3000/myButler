// MyButler in the browser: Today (digest, reminders, conversation), Calendar, People, About you, Settings.
// Only the owner can sign in: with an emailed link, or Face ID / a passkey added on this device.
(function () {
  'use strict';
  const API = window.MYBUTLER_API, $ = (id) => document.getElementById(id);
  const load = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const keep = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  let token = load('mybutler.session');
  const DAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'], DAY = { mo: 'Mon', tu: 'Tue', we: 'Wed', th: 'Thu', fr: 'Fri', sa: 'Sat', su: 'Sun' };
  const STATES = { BW: 'Baden-Württemberg', BY: 'Bavaria', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hesse', MV: 'Mecklenburg-Western Pomerania', NI: 'Lower Saxony', NW: 'North Rhine-Westphalia', RP: 'Rhineland-Palatinate', SL: 'Saarland', SN: 'Saxony', ST: 'Saxony-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thuringia' };
  const ICON = { event: '🎟️', birthday: '🎂', chore: '🧹', trip: '🧳', weather: '🌦️', idea: '💡', goal: '🎯', step: '🎯' };
  let S = null;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, fn, cls) { const b = el('button', cls || '', text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  // Every request gives up after a while (a dropped phone connection otherwise waits forever).
  function api(path, body, method, timeout = 30000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    return fetch(API + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'x-session': token || '' }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal })
      .then((r) => r.json().catch(() => ({})).then((d) => { if (!r.ok) { const e = new Error(d.error || (r.status === 404 ? 'not found' : 'Something went wrong.')); e.status = r.status; throw e; } return d; }),
        (e) => { const x = new Error(e.name === 'AbortError' ? 'No answer in time. The connection may have dropped; please try again.' : 'No connection. Please check your internet and try again.'); x.timeout = true; throw x; })
      .finally(() => clearTimeout(t));
  }
  function err(msg) { $('err').hidden = !msg; $('err').textContent = msg || ''; if (msg) window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const fail = (e) => err(e.message);
  const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const nice = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const inDays = (n) => (n < 0 ? `${-n} day${n < -1 ? 's' : ''} overdue` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

  // A small, safe Markdown subset for replies: bold, links, lists, line breaks. Everything else stays text.
  function md(text) {
    const box = el('div');
    let list = null;
    for (const raw of String(text || '').split('\n')) {
      const m = /^\s*[-*•]\s+(.*)$/.exec(raw);
      if (m) { if (!list) { list = el('ul'); box.appendChild(list); } list.appendChild(inline(el('li'), m[1])); continue; }
      list = null;
      if (!raw.trim()) { box.appendChild(el('div', '', ' ')); continue; }
      box.appendChild(inline(el('div'), raw));
    }
    return box;
  }
  function inline(node, s) {
    const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) node.appendChild(document.createTextNode(s.slice(last, m.index)));
      if (m[1]) node.appendChild(el('b', '', m[1]));
      else { const a = el('a', '', m[2] || m[4]); a.href = m[3] || m[4]; a.target = '_blank'; a.rel = 'noopener noreferrer'; node.appendChild(a); }
      last = re.lastIndex;
    }
    if (last < s.length) node.appendChild(document.createTextNode(s.slice(last)));
    return node;
  }

  // ---------- a form dialog used for every hand edit ----------
  // fields: [{ k, label, type: text|textarea|date|time|number|check|select|days, options }]
  function form(title, fields, values, save) {
    const dlg = $('dlg'), box = $('dlgFields');
    $('dlgTitle').textContent = title; box.innerHTML = ''; $('dlgErr').hidden = true; $('dlgSave').hidden = false; $('dlgCancel').textContent = 'Cancel';
    const inputs = {};
    for (const f of fields) {
      if (f.type === 'check') { const l = el('label', 'check'); const i = el('input'); i.type = 'checkbox'; i.checked = !!values[f.k]; l.append(i, document.createTextNode(' ' + f.label)); box.appendChild(l); inputs[f.k] = i; continue; }
      const wrap = el('div', 'field'); const lab = el('label', '', f.label); wrap.appendChild(lab);
      let i;
      if (f.type === 'days') {
        i = el('div', 'days');
        for (const d of DAYS) { const l = el('label'); const c = el('input'); c.type = 'checkbox'; c.value = d; c.checked = (values[f.k] || []).includes(d); l.append(c, document.createTextNode(DAY[d])); i.appendChild(l); }
      } else if (f.type === 'select') {
        i = el('select');
        for (const [v, t] of f.options) { const o = el('option', '', t); o.value = v; o.selected = String(values[f.k] ?? '') === String(v); i.appendChild(o); }
      } else { i = el(f.type === 'textarea' ? 'textarea' : 'input'); if (f.type !== 'textarea') i.type = f.type || 'text'; i.value = values[f.k] ?? ''; }
      i.id = 'f-' + f.k; lab.htmlFor = i.id; wrap.appendChild(i); box.appendChild(wrap); inputs[f.k] = i;
    }
    const read = () => {
      const out = {};
      for (const f of fields) {
        const i = inputs[f.k];
        if (f.type === 'check') out[f.k] = i.checked;
        else if (f.type === 'days') out[f.k] = [...i.querySelectorAll('input:checked')].map((c) => c.value);
        else if (f.type === 'number') out[f.k] = i.value === '' ? null : Number(i.value);
        else out[f.k] = i.value.trim() || null;
      }
      return out;
    };
    $('dlgForm').onsubmit = (ev) => {
      ev.preventDefault();
      $('dlgSave').disabled = true;
      Promise.resolve(save(read())).then(() => { dlg.close(); refresh(); }, (e) => { $('dlgErr').hidden = false; $('dlgErr').textContent = e.message; }).finally(() => { $('dlgSave').disabled = false; });
    };
    $('dlgCancel').onclick = () => dlg.close();
    dlg.showModal();
  }
  // A read-only card in the same dialog, with action buttons (used for calendar entries).
  function sheet(title, lines, actions) {
    const dlg = $('dlg'), box = $('dlgFields');
    $('dlgTitle').textContent = title; box.innerHTML = ''; $('dlgErr').hidden = true; $('dlgSave').hidden = true; $('dlgCancel').textContent = 'Close';
    lines.filter(Boolean).forEach((l) => box.appendChild(typeof l === 'string' ? el('p', '', l) : l));
    const row = el('div', 'row'); row.style.justifyContent = 'flex-start';
    actions.forEach(([label, fn, cls]) => row.appendChild(btn(label, () => { dlg.close(); fn(); }, cls || 'btn ghost small')));
    box.appendChild(row);
    $('dlgForm').onsubmit = (ev) => { ev.preventDefault(); dlg.close(); };
    $('dlgCancel').onclick = () => dlg.close();
    dlg.showModal();
  }
  const edit = (kind, op, item) => api('/edit', { kind, op, item });
  const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);

  // ---------- tabs ----------
  function tab(name) {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['today', 'week', 'people', 'know', 'settings'].forEach((t) => { $('tab-' + t).hidden = t !== name; });
    try { sessionStorage.setItem('mybutler.tab', name); } catch (e) { /* private mode */ }
    if (name === 'week') drawWeek();
  }
  document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => tab(b.dataset.tab)));

  // ---------- Today ----------
  function drawToday() {
    const t = S.today;
    $('clock').textContent = `${nice(t.now.date)} ${t.now.time}`;
    const w = $('weather'); w.innerHTML = '';
    t.weather.forEach((d) => { const x = el('div'); x.append(el('b', '', nice(d.date)), document.createTextNode(`${d.text}, ${d.min}–${d.max}°${d.rainChance != null ? `, rain ${d.rainChance}%` : ''}`)); w.appendChild(x); });

    const rem = $('reminders'); rem.innerHTML = '';
    $('remCard').hidden = !t.reminders.length;
    t.reminders.forEach((r) => {
      const li = el('li'); const what = el('span', 'what');
      what.append(document.createTextNode(`${ICON[r.type] || '⏰'} ${r.title} `), el('span', 'tag' + (r.days < 0 ? ' over' : ''), inDays(r.days)));
      li.appendChild(what);
      if (r.type === 'chore') { const a = el('span', 'acts'); a.appendChild(btn('Done', () => edit('chore', 'done', { id: r.id }).then(refresh, fail))); li.appendChild(a); }
      if (r.type === 'step') { const a = el('span', 'acts'); a.appendChild(btn('Done', () => edit('step', 'done', { goal: r.goal, step: r.id }).then(refresh, fail))); li.appendChild(a); }
      if (r.type === 'goal') { const a = el('span', 'acts'); a.appendChild(btn('Update', () => noteGoal(r.id))); li.appendChild(a); }
      rem.appendChild(li);
    });

    const props = S.routines.proposals || [];
    $('propCard').hidden = !props.length; $('proposals').innerHTML = '';
    props.forEach((p) => {
      const box = el('div', 'proposal'); box.appendChild(el('p', '', p.readback));
      const row = el('div', 'row');
      row.append(btn('Yes, save', () => api('/confirm', { id: p.id, yes: true }).then(refresh, fail), 'btn small'), btn('No', () => api('/confirm', { id: p.id, yes: false }).then(refresh, fail), 'btn ghost small'));
      box.appendChild(row); $('proposals').appendChild(box);
    });

    const d = t.digest;
    $('digestInfo').textContent = d.at ? `From the ${new Date(d.at).getHours() < 12 ? 'morning' : 'evening'} look, ${new Date(d.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}${d.emailed ? ' (also emailed)' : ''}.` : 'The first look happens at the next 6:00 or 18:00, or tap Look now.';
    const box = $('suggestions'); box.innerHTML = '';
    if (!t.suggestions.length && d.at) box.appendChild(el('p', 'muted', 'Nothing worth your time right now. That’s fine.'));
    t.suggestions.forEach((s) => box.appendChild(suggestion(s)));
    drawTalk();
  }
  function suggestion(s) {
    const c = el('div', 'sugg');
    c.appendChild(el('h3', '', `${ICON[s.kind] || '•'} ${s.title}`));
    if (s.date) c.appendChild(el('span', 'when', [nice(s.date), s.time].filter(Boolean).join(' · ')));
    c.appendChild(el('p', '', s.text));
    if (s.url) { const a = el('a', 'small', s.source || 'Source'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; c.appendChild(a); }
    const fb = el('div', 'fb'), why = el('div', 'why');
    const send = (value, note) => api('/feedback', { id: s.id, value, note }).then(refresh, fail);
    const opts = [['up', '👍'], ['down', '👎'], ['not', 'Not interested…'], ['later', 'Remind me later'], ['did', 'Did it']];
    for (const [v, label] of opts) {
      const b = btn(label, () => {
        if (v !== 'not') return send(v);
        why.innerHTML = '';
        const i = el('input'); i.placeholder = 'Because… (helps me learn)'; i.maxLength = 300;
        i.addEventListener('keydown', (e) => { if (e.key === 'Enter') send('not', i.value); });
        why.append(i, btn('Send', () => send('not', i.value), 'btn small'));
        i.focus();
      });
      b.setAttribute('aria-pressed', String(s.feedback?.value === v));
      fb.appendChild(b);
    }
    c.append(fb, why);
    if (s.feedback?.note) c.appendChild(el('p', 'muted small', `You said: ${s.feedback.note}`));
    return c;
  }
  // ---------- the conversation and the prompt bar (on every screen) ----------
  // While MyButler answers, you can keep typing: further messages wait and go out one after another.
  let inflight = null, started = 0, ticker = null;
  const queue = [];
  function drawTalk() {
    const box = $('talk'); box.innerHTML = '';
    if (!S.talk.length && !inflight) box.appendChild(el('p', 'muted small', 'Tell me about your week, the people you care about, what you like or want to achieve. Or ask: “Was kann ich am Samstag machen?”'));
    const bubble = (m, extra) => {
      const b = el('div', 'msg ' + (m.role === 'assistant' ? 'assistant' : 'user') + (extra ? ' ' + extra : ''));
      b.appendChild(m.role === 'assistant' ? md(m.text) : el('div', '', m.text));
      const ch = (m.changes || []).map((c) => Object.entries(c).map(([k, v]) => k === 'proposal' || k === 'readback' ? null : `${k}: ${v}`).filter(Boolean).join(' ')).filter(Boolean);
      if (ch.length) b.appendChild(el('div', 'changes', '✓ ' + ch.join(' · ')));
      if ((m.links || []).length) { const l = el('div', 'links'); m.links.slice(0, 5).forEach((x, i) => { if (i) l.appendChild(document.createTextNode(' · ')); const a = el('a', '', x.title.slice(0, 40)); a.href = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; l.appendChild(a); }); b.appendChild(l); }
      box.appendChild(b); return b;
    };
    S.talk.forEach((m) => bubble(m));
    if (inflight) {
      const last = S.talk[S.talk.length - 1];
      if (!last || last.role !== 'user' || last.text !== inflight) bubble({ role: 'user', text: inflight });
      const t = bubble({ role: 'assistant', text: '' }, 'thinking'); t.id = 'thinking';
      t.textContent = `MyButler is thinking… ${Math.round((Date.now() - started) / 1000)} s`;
    }
    queue.forEach((q) => { const b = bubble({ role: 'user', text: q }, 'queued'); b.appendChild(el('div', 'changes', 'waiting to send')); });
    box.scrollTop = box.scrollHeight;
  }
  function send(text) {
    inflight = text; started = Date.now(); err('');
    clearInterval(ticker);
    ticker = setInterval(() => { const t = $('thinking'); if (t) t.textContent = `MyButler is thinking… ${Math.round((Date.now() - started) / 1000)} s`; }, 1000);
    drawTalk(); sendLabel();
    api('/chat', { text }, null, 180000).then(() => { inflight = null; return refresh(); }, (e) => {
      inflight = null;
      // Put the text back so nothing typed is lost (with any messages still waiting).
      const back = [text, ...queue.splice(0)].join('\n\n');
      $('ask').value = back + ($('ask').value ? '\n\n' + $('ask').value : ''); grow();
      fail(e.timeout ? e : new Error(e.message)); drawTalk();
    }).finally(() => {
      clearInterval(ticker); inflight = null;
      if (queue.length) send(queue.shift()); else { sendLabel(); drawTalk(); }
    });
  }
  function sendLabel() { $('askBtn').textContent = inflight ? 'Queue' : 'Send'; }
  function grow() { const a = $('ask'); a.style.height = 'auto'; a.style.height = Math.min(a.scrollHeight, 180) + 'px'; }
  $('ask').addEventListener('input', grow);
  $('askForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = $('ask').value.trim();
    if (!text || !S) return;
    $('ask').value = ''; grow();
    if ($('tab-today').hidden) tab('today');
    if (inflight) { queue.push(text); drawTalk(); } else send(text);
    setTimeout(() => $('chatCard').scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  });
  $('ask').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('askForm').requestSubmit(); });
  $('lookNow').addEventListener('click', () => {
    $('lookNow').disabled = true; $('lookNow').textContent = 'Looking…'; err('');
    api('/scan', {}).then(refresh, fail).finally(() => { $('lookNow').disabled = false; $('lookNow').textContent = 'Look now'; });
  });

  // ---------- Calendar: day, 3 days, week, month and list, like a phone calendar ----------
  const HOUR = 44; // pixels per hour in the time grids
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const store2 = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  let calView = store2.get('mybutler.calView') || (window.innerWidth >= 700 ? 'week' : '3'), calDate = null, calDays = [];
  $('calView').value = calView;
  const toMin = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const mondayOf = (d) => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
  const monthStart = (d) => d.slice(0, 8) + '01';
  const addMonths = (d, n) => { const t = new Date(d.slice(0, 8) + '01T12:00:00Z'); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); };
  const fmt = (d, o) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { ...o, timeZone: 'UTC' });
  const kind = (it) => (it.type === 'event' ? 'one' : it.fixed ? 'fixed' : 'flex');
  const timeOf = (it) => (it.start ? `${it.around ? '~' : ''}${it.start}${it.end ? '–' + it.end : ''}` : it.end ? `until ${it.end}` : '');
  function range() {
    const d = calDate;
    if (calView === 'day') return [d, 1];
    if (calView === '3') return [d, 3];
    if (calView === 'week') return [mondayOf(d), 7];
    if (calView === 'list') return [d, 14];
    return [mondayOf(monthStart(d)), 42];
  }
  function step(dir) {
    const n = { day: 1, 3: 3, week: 7, list: 14 }[calView];
    calDate = n ? addDays(calDate, dir * n) : addMonths(calDate, dir);
    drawWeek();
  }
  function calTitle(from, n) {
    if (calView === 'month') return fmt(calDate, { month: 'long', year: 'numeric' });
    if (n === 1) return fmt(from, { weekday: 'long', day: 'numeric', month: 'long' });
    const to = addDays(from, n - 1);
    return `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  function drawWeek() {
    if (!S) return;
    calDate ||= S.today.now.date;
    const [from, n] = range();
    $('calTitle').textContent = calTitle(from, n);
    api(`/week?from=${from}&days=${n}`).then((r) => {
      calDays = r.days;
      const box = $('cal'); box.innerHTML = '';
      if (calView === 'month') box.appendChild(monthGrid(r.days));
      else if (calView === 'list') box.appendChild(listView(r.days));
      else box.appendChild(timeGrid(r.days));
    }, fail);
  }
  // Side-by-side columns for entries that overlap in time.
  function lanes(items) {
    const evs = items.filter((it) => it.start).map((it) => { const s = toMin(it.start); let e = it.end ? toMin(it.end) : s + 60; if (e <= s) e = s + 30; return { it, s, e }; })
      .sort((a, b) => a.s - b.s || b.e - a.e);
    let group = [], ends = [], groupEnd = -1;
    const close = () => { group.forEach((g) => { g.cols = ends.length; }); group = []; ends = []; };
    for (const ev of evs) {
      if (ev.s >= groupEnd) { close(); groupEnd = -1; }
      let c = ends.findIndex((x) => x <= ev.s);
      if (c < 0) { c = ends.length; ends.push(ev.e); } else ends[c] = ev.e;
      ev.col = c; group.push(ev); groupEnd = Math.max(groupEnd, ev.e);
    }
    close();
    return evs;
  }
  function timeGrid(days) {
    const wrap = el('div', 'tg'), today = S.today.now.date;
    wrap.style.setProperty('--n', days.length);
    const head = el('div', 'tg-head'); head.appendChild(el('div', 'tg-gut'));
    days.forEach((d) => {
      const h = el('button', 'tg-day' + (d.date === today ? ' today' : '')); h.type = 'button';
      h.append(el('span', 'wd', WD[(new Date(d.date + 'T12:00:00Z').getUTCDay() + 6) % 7]), el('span', 'dn', String(+d.date.slice(8))));
      h.addEventListener('click', () => { calView = 'day'; calDate = d.date; $('calView').value = 'day'; drawWeek(); });
      head.appendChild(h);
    });
    const all = el('div', 'tg-all'); all.appendChild(el('div', 'tg-gut', 'all day'));
    let anyAll = false;
    days.forEach((d) => {
      const c = el('div', 'tg-allcell');
      if (d.holiday) { c.appendChild(chip(d.holiday, 'hol')); anyAll = true; }
      d.periods.forEach((p) => { c.appendChild(chip(p, 'per')); anyAll = true; });
      d.items.filter((it) => !it.start).forEach((it) => { const x = chip(`${it.title}${it.end ? ' · until ' + it.end : ''}`, kind(it)); x.addEventListener('click', () => entry(it, d)); c.appendChild(x); anyAll = true; });
      all.appendChild(c);
    });
    const body = el('div', 'tg-body'), grid = el('div', 'tg-grid'), gut = el('div', 'tg-gut tg-hours');
    for (let h = 0; h < 24; h++) gut.appendChild(el('div', 'tg-h', h ? `${String(h).padStart(2, '0')}:00` : ''));
    grid.appendChild(gut);
    const nowMin = S.today.now.minutes ?? toMin(S.today.now.time);
    days.forEach((d) => {
      const col = el('div', 'tg-col' + (d.date === today ? ' today' : '') + (d.holiday ? ' holiday' : ''));
      col.style.height = 24 * HOUR + 'px';
      col.addEventListener('click', (e) => {
        if (e.target !== col) return;
        const m = Math.floor((e.offsetY / HOUR) * 2) * 30;
        newEvent(d.date, hhmm(m), hhmm(Math.min(m + 60, 23 * 60 + 59)));
      });
      lanes(d.items).forEach((ev) => {
        const x = el('button', 'ev ' + kind(ev.it) + (ev.it.around ? ' around' : '')); x.type = 'button';
        x.style.top = (ev.s / 60) * HOUR + 'px';
        x.style.height = Math.max(18, ((ev.e - ev.s) / 60) * HOUR - 2) + 'px';
        x.style.left = `calc(${(100 * ev.col) / ev.cols}% + 1px)`; x.style.width = `calc(${100 / ev.cols}% - 3px)`;
        x.append(el('b', '', ev.it.title), el('span', '', timeOf(ev.it)));
        x.title = `${ev.it.title} ${timeOf(ev.it)}`;
        x.addEventListener('click', () => entry(ev.it, d));
        col.appendChild(x);
      });
      if (d.date === today) { const line = el('div', 'tg-now'); line.style.top = (nowMin / 60) * HOUR + 'px'; col.appendChild(line); }
      grid.appendChild(col);
    });
    body.appendChild(grid);
    wrap.append(head);
    if (anyAll) wrap.appendChild(all);
    wrap.appendChild(body);
    const showsToday = days.some((d) => d.date === today);
    requestAnimationFrame(() => { body.scrollTop = Math.max(0, ((showsToday ? nowMin / 60 - 1.5 : 7) * HOUR)); });
    return wrap;
  }
  function chip(text, cls) { const c = el('button', 'chip ' + cls, text); c.type = 'button'; return c; }
  function monthGrid(days) {
    const wrap = el('div', 'mg'), today = S.today.now.date, month = calDate.slice(0, 7);
    WD.forEach((w) => wrap.appendChild(el('div', 'mg-wd', w.slice(0, 2))));
    days.forEach((d) => {
      const c = el('button', 'mg-cell' + (d.date.slice(0, 7) !== month ? ' other' : '') + (d.date === today ? ' today' : '') + (d.holiday ? ' holiday' : '')); c.type = 'button';
      c.appendChild(el('span', 'dn', String(+d.date.slice(8))));
      const chips = [...(d.holiday ? [[d.holiday, 'hol']] : []), ...d.periods.map((p) => [p, 'per']), ...d.items.map((it) => [it.title, kind(it)])];
      chips.slice(0, 3).forEach(([t, k]) => c.appendChild(el('span', 'mchip ' + k, t)));
      if (chips.length > 3) c.appendChild(el('span', 'more', `+${chips.length - 3}`));
      c.addEventListener('click', () => { calView = 'day'; calDate = d.date; $('calView').value = 'day'; drawWeek(); });
      wrap.appendChild(c);
    });
    return wrap;
  }
  function listView(days) {
    const box = el('div', 'week');
    days.forEach((d) => {
      const day = el('div', 'day' + (d.date === S.today.now.date ? ' today' : ''));
      const h = el('h3', '', nice(d.date));
      if (d.holiday) h.appendChild(el('span', 'hol', d.holiday));
      d.periods.forEach((p) => h.appendChild(el('span', 'hol', p)));
      day.appendChild(h);
      if (!d.items.length) day.appendChild(el('div', 'none', 'Nothing planned'));
      d.items.forEach((it) => {
        const row = el('button', 'it ' + (it.type === 'event' ? 'oneoff' : it.fixed ? 'fixed' : 'flexible')); row.type = 'button';
        const t = timeOf(it);
        if (t) row.appendChild(el('span', 't', t));
        row.appendChild(document.createTextNode(it.title + (it.moved ? ` (moved from ${nice(it.moved)})` : '')));
        row.addEventListener('click', () => entry(it, d));
        day.appendChild(row);
      });
      box.appendChild(day);
    });
    return box;
  }
  const EVENT_FIELDS = [{ k: 'title', label: 'What' }, { k: 'date', label: 'Date', type: 'date' }, { k: 'start', label: 'Start', type: 'time' }, { k: 'end', label: 'End', type: 'time' }, { k: 'place', label: 'Where' }, { k: 'notes', label: 'Notes', type: 'textarea' }];
  function newEvent(date, start, end) { form('New appointment', EVENT_FIELDS, { date, start, end }, (v) => edit('event', 'add', v)); }
  // One entry: what it is, and what can be done with it.
  function entry(it, d) {
    const when = `${fmt(it.date, { weekday: 'long', day: 'numeric', month: 'long' })}${timeOf(it) ? ', ' + timeOf(it) : ''}`;
    const link = it.url ? (() => { const a = el('a', '', 'Open link'); a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; })() : null;
    if (it.type === 'event') {
      return sheet(it.title, [when, it.place && `Where: ${it.place}`, 'Appointment', link], [
        ['Edit', () => form('Edit appointment', EVENT_FIELDS, it, (v) => edit('event', 'update', { id: it.id, date: it.date, newDate: v.date, title: v.title, start: v.start, end: v.end, place: v.place, notes: v.notes })), 'btn small'],
        ['Delete', () => { if (confirm(`Delete “${it.title}”?`)) edit('event', 'delete', { id: it.id, date: it.date }).then(drawWeek, fail); }],
      ]);
    }
    const rt = S.routines.routines.find((r) => r.id === it.id);
    const usual = it.moved || it.date;
    // Replace any earlier change to this same occurrence, so the newest one counts.
    const clear = () => Promise.all(S.routines.exceptions.filter((x) => x.routine === it.id && x.from === usual && !x.until).map((x) => edit('exception', 'delete', { id: x.id })));
    sheet(it.title, [when, it.moved && `Moved from ${nice(it.moved)}`, `Routine · ${it.fixed ? 'fixed' : 'flexible (can move or skip)'}${rt ? ' · ' + describe(rt).split(': ')[1] : ''}`, it.place && `Where: ${it.place}`, d.holiday && `Holiday: ${d.holiday}`], [
      ['Skip this time', () => clear().then(() => edit('exception', 'add', { routine: it.id, from: usual, skip: true })).then(refresh, fail), 'btn small'],
      ['Move this time', () => form(`Move “${it.title}” this time`, [{ k: 'date', label: 'To day', type: 'date' }, { k: 'start', label: 'Start', type: 'time' }, { k: 'end', label: 'End', type: 'time' }], { date: it.date, start: it.start, end: it.end },
        (v) => clear().then(() => edit('exception', 'add', { routine: it.id, from: usual, moveTo: v.date && v.date !== usual ? v.date : null, start: v.start, end: v.end })))],
      ...(it.moved ? [['Back to usual', () => clear().then(refresh, fail)]] : []),
      ...(rt ? [['Edit routine', () => form('Edit routine', ROUTINE_FIELDS, routineValues(rt), (v) => edit('routine', 'update', routineFrom(v, rt.id)))]] : []),
    ]);
  }
  $('calPrev').addEventListener('click', () => step(-1));
  $('calNext').addEventListener('click', () => step(1));
  $('calToday').addEventListener('click', () => { calDate = S.today.now.date; drawWeek(); });
  $('calView').addEventListener('change', () => { calView = $('calView').value; store2.set('mybutler.calView', calView); drawWeek(); });

  const ROUTINE_FIELDS = [
    { k: 'title', label: 'What' }, { k: 'freq', label: 'How often', type: 'select', options: [['weekly', 'Weekly'], ['monthly', 'Monthly (on a day)'], ['yearly', 'Yearly']] },
    { k: 'days', label: 'Days (weekly)', type: 'days' }, { k: 'every', label: 'Every … weeks (weekly)', type: 'number' }, { k: 'day', label: 'Day of month (monthly, yearly)', type: 'number' }, { k: 'month', label: 'Month (yearly)', type: 'number' },
    { k: 'start', label: 'Start', type: 'time' }, { k: 'end', label: 'End', type: 'time' }, { k: 'around', label: 'Start time is approximate', type: 'check' },
    { k: 'fixed', label: 'Fixed (never suggest anything over it)', type: 'check' }, { k: 'onHoliday', label: 'On public holidays', type: 'select', options: [['skip', 'Skip'], ['keep', 'Keep']] },
    { k: 'outdoor', label: 'Outdoors', type: 'check' }, { k: 'from', label: 'Valid from', type: 'date' }, { k: 'until', label: 'Valid until', type: 'date' },
  ];
  const routineFrom = (v, id) => {
    const rule = v.freq === 'weekly' ? { freq: 'weekly', days: v.days, every: v.every || 1 } : v.freq === 'monthly' ? { freq: 'monthly', day: v.day } : { freq: 'yearly', month: v.month, day: v.day };
    return { id, title: v.title, rule, start: v.start, end: v.end, around: v.around, fixed: v.fixed, onHoliday: v.onHoliday, outdoor: v.outdoor, from: v.from, until: v.until };
  };
  const routineValues = (r) => ({ ...r, freq: r.rule.freq, days: r.rule.days || [], every: r.rule.every || 1, day: r.rule.day, month: r.rule.month });
  function describe(r) {
    const rr = r.rule, names = { mo: 'Mon', tu: 'Tue', we: 'Wed', th: 'Thu', fr: 'Fri', sa: 'Sat', su: 'Sun' };
    const when = rr.freq === 'weekly' ? DAYS.filter((d) => rr.days.includes(d)).map((d) => names[d]).join(', ') + (rr.every > 1 ? `, every ${rr.every} weeks` : '')
      : rr.freq === 'monthly' ? (rr.day ? `monthly on the ${rr.day}.` : `${rr.nth === -1 ? 'last' : rr.nth + '.'} ${names[rr.weekday]} of the month`) : `yearly on ${rr.day}.${rr.month}.`;
    const time = r.start ? (r.around ? ` ~${r.start}` : ` ${r.start}${r.end ? '–' + r.end : ''}`) : r.end ? ` until ${r.end}` : '';
    return `${r.title}: ${when}${time}`;
  }
  function drawLists() {
    const rs = $('routines'); rs.innerHTML = '';
    if (!S.routines.routines.length) rs.appendChild(el('li', 'muted small', 'No routines yet. Tell MyButler about your normal week, or add one here.'));
    S.routines.routines.forEach((r) => {
      const li = el('li'); const w = el('span', 'what');
      w.append(el('span', 'tag', r.fixed ? 'fixed' : 'flexible'), document.createTextNode(describe(r) + (r.from || r.until ? ` (${r.from || '…'} to ${r.until || '…'})` : '')));
      const a = el('span', 'acts');
      a.append(btn('Edit', () => form('Edit routine', ROUTINE_FIELDS, routineValues(r), (v) => edit('routine', 'update', routineFrom(v, r.id)))),
        btn('✕', () => { if (confirm(`Remove “${r.title}”?`)) edit('routine', 'delete', { id: r.id }).then(refresh, fail); }));
      li.append(w, a); rs.appendChild(li);
    });
    const name = (id) => (S.routines.routines.find((r) => r.id === id) || {}).title || id;
    const ps = $('periods'); ps.innerHTML = '';
    const rows = [...S.routines.exceptions.map((x) => ({ kind: 'exception', id: x.id, text: `${name(x.routine)}: ${x.skip ? 'skipped' : x.moveTo ? 'moved to ' + x.moveTo : 'other times'} ${x.from}${x.until ? ' – ' + x.until : ''}` })),
      ...S.routines.periods.map((p) => ({ kind: 'period', id: p.id, text: `${p.title} (${p.kind}) ${p.from} – ${p.until}` }))];
    if (!rows.length) ps.appendChild(el('li', 'muted small', 'None.'));
    rows.forEach((x) => { const li = el('li'); const a = el('span', 'acts'); a.appendChild(btn('✕', () => edit(x.kind, 'delete', { id: x.id }).then(refresh, fail))); li.append(el('span', 'what', x.text), a); ps.appendChild(li); });
    const cs = $('chores'); cs.innerHTML = '';
    if (!S.chores.length) cs.appendChild(el('li', 'muted small', 'No chores yet.'));
    S.chores.forEach((c) => {
      const li = el('li'); const a = el('span', 'acts');
      a.append(btn('Done', () => edit('chore', 'done', { id: c.id }).then(refresh, fail)), btn('Edit', () => form('Edit chore', CHORE_FIELDS, choreValues(c), (v) => edit('chore', 'update', choreFrom(v, c.id)))), btn('✕', () => { if (confirm(`Remove “${c.title}”?`)) edit('chore', 'delete', { id: c.id }).then(refresh, fail); }));
      li.append(el('span', 'what', `${c.title}${c.every ? ` · every ${c.every.n} ${c.every.unit}${c.every.n > 1 ? 's' : ''}` : ''}${c.lastDone ? ` · last ${c.lastDone}` : ''}${c.due ? ` · due ${c.due}` : ''}${c.paused ? ' · paused' : ''}`), a);
      cs.appendChild(li);
    });
  }
  const CHORE_FIELDS = [{ k: 'title', label: 'What' }, { k: 'n', label: 'Every (number)', type: 'number' }, { k: 'unit', label: 'Unit', type: 'select', options: [['', 'Once only'], ['day', 'days'], ['week', 'weeks'], ['month', 'months'], ['year', 'years']] },
    { k: 'lastDone', label: 'Last done', type: 'date' }, { k: 'due', label: 'Due (once, or next)', type: 'date' }, { k: 'remindDays', label: 'Remind … days ahead', type: 'number' }, { k: 'paused', label: 'Paused', type: 'check' }, { k: 'notes', label: 'Notes', type: 'textarea' }];
  const choreFrom = (v, id) => ({ id, title: v.title, every: v.unit ? { n: v.n || 1, unit: v.unit } : null, lastDone: v.lastDone, due: v.due, remindDays: v.remindDays || 0, paused: v.paused, notes: v.notes });
  const choreValues = (c) => ({ ...c, n: c.every?.n, unit: c.every?.unit || '' });
  $('addRoutine').addEventListener('click', () => form('New routine', ROUTINE_FIELDS, { freq: 'weekly', every: 1, fixed: true, onHoliday: 'skip' }, (v) => edit('routine', 'add', routineFrom(v))));
  $('addChore').addEventListener('click', () => form('New chore or reminder', CHORE_FIELDS, { n: 1, unit: 'week' }, (v) => edit('chore', 'add', choreFrom(v))));
  $('addEvent').addEventListener('click', () => newEvent(calDate || S.today.now.date, null, null));
  $('addException').addEventListener('click', () => form('Exception to a routine', [{ k: 'routine', label: 'Routine', type: 'select', options: S.routines.routines.map((r) => [r.id, r.title]) }, { k: 'from', label: 'From (the usual day)', type: 'date' }, { k: 'until', label: 'Until (optional)', type: 'date' },
    { k: 'skip', label: 'Skip it', type: 'check' }, { k: 'moveTo', label: 'Or move it to', type: 'date' }, { k: 'start', label: 'New start', type: 'time' }, { k: 'end', label: 'New end', type: 'time' }], { skip: true }, (v) => edit('exception', 'add', v)));
  $('addPeriod').addEventListener('click', () => form('Period', [{ k: 'title', label: 'What' }, { k: 'kind', label: 'Kind', type: 'select', options: [['vacation', 'Vacation'], ['sick', 'Sick'], ['guests', 'Guests'], ['trip', 'Trip'], ['other', 'Other']] },
    { k: 'from', label: 'From', type: 'date' }, { k: 'until', label: 'Until', type: 'date' }, { k: 'pauseAll', label: 'Pause all routines', type: 'check' }], { kind: 'vacation', pauseAll: true }, (v) => edit('period', 'add', { title: v.title, kind: v.kind, from: v.from, until: v.until, pauses: v.pauseAll ? 'all' : 'none' })));

  // ---------- People ----------
  const PERSON_FIELDS = [{ k: 'name', label: 'Name' }, { k: 'relation', label: 'Relationship' }, { k: 'birthday', label: 'Birthday (MM-DD or YYYY-MM-DD)' }, { k: 'interests', label: 'Interests (comma separated)' }, { k: 'ideas', label: 'Gift and plan ideas (comma separated)' }, { k: 'address', label: 'Address (for visits and trips)' }, { k: 'notes', label: 'Notes', type: 'textarea' }];
  const personFrom = (v, id) => ({ id, name: v.name, relation: v.relation, birthday: v.birthday, interests: list(v.interests), ideas: list(v.ideas), address: v.address, notes: v.notes });
  const personValues = (p) => ({ ...p, interests: (p.interests || []).join(', '), ideas: (p.ideas || []).join(', ') });
  function drawPeople() {
    const ul = $('people'); ul.innerHTML = '';
    if (!S.people.length) ul.appendChild(el('li', 'muted small', 'Nobody yet. Tell MyButler about your family and friends.'));
    S.people.forEach((p) => {
      const li = el('li'), w = el('span', 'what');
      w.appendChild(el('b', '', p.name + (p.relation ? ` (${p.relation})` : '')));
      const bits = [p.birthday && `🎂 ${p.birthday}`, p.interests?.length && `likes ${p.interests.join(', ')}`, p.ideas?.length && `ideas: ${p.ideas.join(', ')}`, p.address && `📍 ${p.address}`, p.notes].filter(Boolean);
      if (bits.length) w.appendChild(el('div', 'small muted', bits.join(' · ')));
      const a = el('span', 'acts');
      a.append(btn('Edit', () => form('Edit person', PERSON_FIELDS, personValues(p), (v) => edit('person', 'update', personFrom(v, p.id)))), btn('✕', () => { if (confirm(`Forget ${p.name}?`)) edit('person', 'delete', { id: p.id }).then(refresh, fail); }));
      li.append(w, a); ul.appendChild(li);
    });
  }
  $('addPerson').addEventListener('click', () => form('New person', PERSON_FIELDS, {}, (v) => edit('person', 'add', personFrom(v))));

  // ---------- What I know ----------
  // ---------- goals and dreams ----------
  const HORIZON = { 'this-month': 'this month', 'this-year': 'this year', 'few-years': 'next few years', someday: 'someday' };
  const GOAL_FIELDS = [{ k: 'title', label: 'Goal or dream' }, { k: 'kind', label: 'Kind', type: 'select', options: [['goal', 'Goal'], ['dream', 'Dream']] }, { k: 'why', label: 'Why it matters', type: 'textarea' },
    { k: 'horizon', label: 'When', type: 'select', options: Object.entries(HORIZON) }, { k: 'target', label: 'Target date (optional)', type: 'date' },
    { k: 'checkEvery', label: 'Ask me how it’s going every … days (0 = never, empty = default)', type: 'number' }];
  let showDone = false;
  function noteGoal(id) {
    const g = S.goals.find((x) => x.id === id);
    form(`How is “${g ? g.title : 'it'}” going?`, [{ k: 'note', label: 'In a few words', type: 'textarea' }], {}, (v) => edit('goal', 'note', { id, note: v.note }));
  }
  function drawGoals() {
    const ul = $('goals'); ul.innerHTML = '';
    const open = S.goals.filter((g) => g.status === 'active' || g.status === 'paused'), closed = S.goals.filter((g) => g.status === 'done' || g.status === 'dropped');
    if (!open.length) ul.appendChild(el('li', 'muted small', 'No goals yet. Tell MyButler what you’d like to achieve, or add one here.'));
    [...open, ...(showDone ? closed : [])].forEach((g) => {
      const li = el('li', g.status === 'active' ? '' : 'closed');
      const head = el('div', 'head'), w = el('span', 'what');
      w.append(el('b', '', g.title), document.createElement('br'), el('span', 'tag' + (g.kind === 'dream' ? ' guess' : ''), g.kind), el('span', 'tag', HORIZON[g.horizon] || g.horizon));
      if (g.target) w.appendChild(el('span', 'tag', 'by ' + g.target));
      if (g.status !== 'active') w.appendChild(el('span', 'tag', g.status));
      const a = el('span', 'acts');
      a.append(btn('Edit', () => form('Edit goal', [...GOAL_FIELDS, { k: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['paused', 'Paused'], ['done', 'Reached'], ['dropped', 'Dropped']] }], g, (v) => edit('goal', 'update', { ...v, id: g.id }))),
        btn('✕', () => { if (confirm(`Delete “${g.title}”?`)) edit('goal', 'delete', { id: g.id }).then(refresh, fail); }));
      head.append(w, a); li.appendChild(head);
      if (g.why) li.appendChild(el('div', 'small muted', g.why));
      if (g.steps.length) {
        const done = g.steps.filter((s) => s.done).length, bar = el('div', 'prog'), fill = el('span');
        fill.style.width = Math.round(100 * done / g.steps.length) + '%'; bar.appendChild(fill);
        li.append(bar, el('div', 'small muted', `${done} of ${g.steps.length} steps done`));
        const sl = el('ul', 'steps');
        g.steps.forEach((s) => {
          const r = el('li', s.done ? 'done' : ''), c = el('input');
          c.type = 'checkbox'; c.checked = !!s.done; c.setAttribute('aria-label', 'Done: ' + s.text);
          c.addEventListener('change', () => edit('step', c.checked ? 'done' : 'undo', { goal: g.id, step: s.id }).then(refresh, fail));
          r.append(c, el('span', '', s.text + (s.done ? ` (done ${s.done})` : s.due ? ` · due ${s.due}` : '')), btn('✕', () => edit('step', 'delete', { goal: g.id, step: s.id }).then(refresh, fail), 'x'));
          sl.appendChild(r);
        });
        li.appendChild(sl);
      }
      const last = (g.notes || []).at(-1);
      if (last) li.appendChild(el('div', 'note', `${last.at}: ${last.text}`));
      const row = el('div', 'row');
      row.style.justifyContent = 'flex-start';
      row.append(btn('Add step', () => form('New step', [{ k: 'text', label: 'Step' }, { k: 'due', label: 'Due (optional)', type: 'date' }], {}, (v) => edit('step', 'add', { goal: g.id, text: v.text, due: v.due })), 'btn ghost small'),
        btn('How it’s going', () => noteGoal(g.id), 'btn ghost small'));
      li.appendChild(row);
      ul.appendChild(li);
    });
    $('showDone').hidden = !closed.length;
    $('showDone').textContent = showDone ? 'Hide reached and dropped goals' : `Show reached and dropped goals (${closed.length})`;
  }
  $('showDone').addEventListener('click', () => { showDone = !showDone; drawGoals(); });
  $('addGoal').addEventListener('click', () => form('New goal or dream', [...GOAL_FIELDS, { k: 'steps', label: 'Steps, one per line (optional)', type: 'textarea' }], { kind: 'goal', horizon: 'this-year' },
    (v) => edit('goal', 'add', { ...v, steps: (v.steps || '').split('\n').map((t) => t.trim()).filter(Boolean).map((text) => ({ text })) })));

  function drawKnow() {
    drawGoals();
    const ul = $('facts'); ul.innerHTML = '';
    const facts = [...S.profile.facts].sort((a, b) => (a.confirmed === b.confirmed ? a.topic.localeCompare(b.topic) : a.confirmed ? 1 : -1));
    if (!facts.length) ul.appendChild(el('li', 'muted small', 'Nothing yet. Chat with MyButler, or add something here.'));
    facts.forEach((f) => {
      const li = el('li'), w = el('span', 'what');
      w.append(el('span', 'tag' + (f.kind === 'inferred' && !f.confirmed ? ' guess' : ''), f.kind === 'inferred' ? (f.confirmed ? 'confirmed' : `guess ${Math.round((f.confidence || 0) * 100)}%`) : 'stated'), el('span', 'tag', f.topic), document.createTextNode(f.text));
      const a = el('span', 'acts');
      if (f.kind === 'inferred' && !f.confirmed) a.appendChild(btn('Right', () => edit('fact', 'confirm', { id: f.id }).then(refresh, fail)));
      a.append(btn('Edit', () => form('Edit', [{ k: 'text', label: 'What', type: 'textarea' }, { k: 'topic', label: 'Topic' }], f, (v) => edit('fact', 'update', { id: f.id, text: v.text, topic: v.topic }))),
        btn('✕', () => edit('fact', 'delete', { id: f.id }).then(refresh, fail)));
      li.append(w, a); ul.appendChild(li);
    });
    const mu = $('memories'); mu.innerHTML = '';
    if (!S.memories.length) mu.appendChild(el('li', 'muted small', 'None yet.'));
    [...S.memories].reverse().forEach((m) => mu.appendChild(el('li', '', `${m.at}: ${m.text}`)));
  }
  $('addFact').addEventListener('click', () => form('Something about you', [{ k: 'text', label: 'What', type: 'textarea' }, { k: 'topic', label: 'Topic (food, music, travel…)' }], {}, (v) => edit('fact', 'add', v)));

  // ---------- Settings ----------
  function drawSettings() {
    const s = S.settings;
    const st = $('sState');
    if (!st.options.length) for (const [k, v] of Object.entries(STATES)) { const o = el('option', '', v); o.value = k; st.appendChild(o); }
    $('sHome').value = s.home?.name || ''; $('sAddress').value = s.address || ''; st.value = s.state; $('sAssumption').checked = s.assumption !== false; $('sTz').value = s.tz;
    $('sRadius').value = s.radiusKm; $('sAm').value = s.digest?.am || '06:00'; $('sPm').value = s.digest?.pm || '18:00'; $('sEmail').checked = s.digest?.email !== false;
    const src = $('sources'); src.innerHTML = '';
    [['Claude (conversation and the twice-daily look)', S.sources.claude], ['Events from Ticketmaster', S.sources.events, 'Off until TICKETMASTER-API-KEY is in the key vault. Web search fills in meanwhile.'],
      ['Weather from Open-Meteo', true], ['Email digest', S.sources.email]].forEach(([name, on, why]) => {
      const li = el('li'); li.append(el('span', 'what', name + (on ? '' : why ? ` — ${why}` : '')), el('span', 'tag' + (on ? '' : ' over'), on ? 'on' : 'off')); src.appendChild(li);
    });
  }
  $('settingsForm').addEventListener('submit', (ev) => {
    ev.preventDefault(); $('settingsOk').hidden = true;
    const body = { state: $('sState').value, assumption: $('sAssumption').checked, tz: $('sTz').value.trim(), radiusKm: Number($('sRadius').value), address: $('sAddress').value.trim(), digest: { am: $('sAm').value, pm: $('sPm').value, email: $('sEmail').checked } };
    if ($('sHome').value.trim() !== (S.settings.home?.name || '')) body.home = $('sHome').value.trim();
    api('/settings', body).then(() => { $('settingsOk').hidden = false; refresh(); }, fail);
  });
  $('export').addEventListener('click', () => api('/export').then((d) => {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = `mybutler-${S.today.now.date}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }, fail));
  $('wipe').addEventListener('click', () => {
    const t = prompt('This deletes everything MyButler knows about you. Type DELETE to confirm.');
    if (t !== 'DELETE') return;
    api('/delete-all', { confirm: 'DELETE' }).then(refresh, fail);
  });

  // ---------- load ----------
  function refresh() {
    return api('/state').then((s) => {
      S = s;
      $('loading').hidden = true; $('app').hidden = false;
      drawToday(); drawLists(); drawPeople(); drawKnow(); drawSettings();
      if (!$('tab-week').hidden) drawWeek();
    }, (e) => {
      $('loading').hidden = true;
      if (e.status === 401) signinScreen(); else fail(e);
    });
  }

  // ---------- signing in ----------
  const canPasskey = !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  function toBuf(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a.buffer; }
  function toB64(buf) { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  const pkMessage = (e) => (e && e.name === 'NotAllowedError' ? 'Face ID was cancelled, or this device has no passkey for MyButler yet. Use the email link, then turn on Face ID in Settings.' : e && e.name === 'InvalidStateError' ? 'This device already has Face ID for MyButler.' : (e && e.message) || 'Face ID didn’t work.');
  function signinScreen(msg) {
    token = null; keep('mybutler.session', null);
    $('loading').hidden = true; $('app').hidden = true; $('signin').hidden = false;
    $('pkLogin').hidden = !canPasskey;
    $('signinErr').hidden = !msg; $('signinErr').textContent = msg || '';
  }
  function signedIn(t) { token = t; keep('mybutler.session', t); $('signin').hidden = true; $('loading').hidden = false; return start(); }
  $('linkForm').addEventListener('submit', (ev) => {
    ev.preventDefault(); $('linkBtn').disabled = true; $('signinErr').hidden = true;
    api('/auth/link', { email: $('linkEmail').value.trim() }).then(() => { $('linkSent').hidden = false; }, (e) => signinScreen(e.message)).finally(() => { $('linkBtn').disabled = false; });
  });
  $('pkLogin').addEventListener('click', () => {
    $('signinErr').hidden = true;
    api('/auth/passkey-login-options', {}).then((o) => navigator.credentials.get({ publicKey: { challenge: toBuf(o.challenge), rpId: o.rpId, userVerification: o.userVerification, timeout: o.timeout } }))
      .then((c) => { const r = c.response; return api('/auth/passkey-login', { id: c.id, response: { clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature), userHandle: r.userHandle ? toB64(r.userHandle) : null } }); })
      .then((d) => signedIn(d.token), (e) => signinScreen(pkMessage(e)));
  });
  function listPasskeys() {
    api('/auth/passkeys').then((l) => {
      $('pkInfo').textContent = l.length ? `Face ID / passkey sign-in is on for ${l.length} device${l.length === 1 ? '' : 's'}. Add this one too if it isn’t among them.` : 'Sign in with one touch on this device. The key stays on your device (and in your iCloud or Google keychain).';
      const ul = $('pkList'); ul.innerHTML = '';
      l.forEach((k) => { const li = el('li'), a = el('span', 'acts'); a.appendChild(btn('Remove', () => { if (confirm('Remove this passkey? That device will need the email link again.')) api('/auth/passkey-delete', { id: k.id }).then(listPasskeys, fail); })); li.append(el('span', 'what', `${k.label || 'Device'} · added ${String(k.created).slice(0, 10)}`), a); ul.appendChild(li); });
    }).catch(() => {});
  }
  $('pkAdd').hidden = !canPasskey;
  $('pkAdd').addEventListener('click', () => {
    $('pkOk').hidden = true; $('pkErr').hidden = true;
    api('/auth/passkey-register-options', {}).then((o) => navigator.credentials.create({ publicKey: {
      challenge: toBuf(o.challenge), rp: o.rp, user: { id: toBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams, authenticatorSelection: o.authenticatorSelection, timeout: o.timeout, attestation: 'none',
      excludeCredentials: (o.excludeCredentials || []).map((x) => ({ type: 'public-key', id: toBuf(x.id) })),
    } })).then((c) => api('/auth/passkey-register', { id: c.id, response: { clientDataJSON: toB64(c.response.clientDataJSON), attestationObject: toB64(c.response.attestationObject) } }))
      .then(() => { $('pkOk').hidden = false; listPasskeys(); }, (e) => { $('pkErr').hidden = false; $('pkErr').textContent = pkMessage(e); });
  });
  $('signOut').addEventListener('click', () => { api('/auth/logout', {}).catch(() => {}).finally(() => signinScreen()); });

  function start() {
    return refresh().then(() => { listPasskeys(); let t = null; try { t = sessionStorage.getItem('mybutler.tab'); } catch (e) { /* private mode */ } if (t && $('tab-' + t)) tab(t); });
  }
  // Arriving from the emailed link: trade it for a session on this device, and drop it from the address bar.
  const link = /#signin=([\w-]+)/.exec(location.hash);
  if (link) {
    history.replaceState(null, '', location.pathname);
    api('/auth/redeem', { token: link[1] }).then((d) => signedIn(d.token), (e) => signinScreen(e.message));
  } else if (!token) signinScreen();
  else start();
})();
