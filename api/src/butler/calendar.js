// MyButler's calendar: the owner's week is computed from routines, then periods, exceptions and holidays are applied,
// then one-off events are added. Plain code with tests (tools/check-mybutler.mjs), never the AI.
// Dates are 'YYYY-MM-DD' and times 'HH:MM' on the owner's wall clock in their time zone, so daylight saving never moves them.

export const DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
const DAY_NAMES = { mo: 'Monday', tu: 'Tuesday', we: 'Wednesday', th: 'Thursday', fr: 'Friday', sa: 'Saturday', su: 'Sunday' };

// ---------- dates ----------
const ms = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
export const iso = (t) => new Date(t).toISOString().slice(0, 10);
export function addDays(date, n) { return iso(ms(date) + n * 86400000); }
export function daysBetween(a, b) { return Math.round((ms(b) - ms(a)) / 86400000); }
export function weekday(date) { return DAYS[new Date(ms(date)).getUTCDay()]; }
export function mondayOf(date) { return addDays(date, -((new Date(ms(date)).getUTCDay() + 6) % 7)); }
const monthLength = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const toMin = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
export const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Today's date and the time now on the owner's clock.
export function localNow(tz = 'Europe/Berlin', d = new Date()) {
  const f = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${f.year}-${f.month}-${f.day}`, time: `${f.hour}:${f.minute}`, minutes: +f.hour * 60 + +f.minute };
}
// The real moment a wall-clock time happens on a date in a time zone (as an ISO string).
export function instant(date, time, tz = 'Europe/Berlin') {
  const guess = ms(date) + (toMin(time) || 0) * 60000;
  const offset = (t) => { const l = localNow(tz, new Date(t)); return ms(l.date) + l.minutes * 60000 - t; };
  let t = guess - offset(guess);
  t = guess - offset(t); // a second pass settles times near a daylight-saving change
  return new Date(t).toISOString();
}

// ---------- German public holidays ----------
// Easter Sunday (Anonymous Gregorian algorithm).
export function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export const STATES = { BW: 'Baden-Württemberg', BY: 'Bavaria', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hesse', MV: 'Mecklenburg-Western Pomerania', NI: 'Lower Saxony', NW: 'North Rhine-Westphalia', RP: 'Rhineland-Palatinate', SL: 'Saarland', SN: 'Saxony', ST: 'Saxony-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thuringia' };
// Holidays for one year: { date: name }. `assumption` adds 15 August where only some towns keep it (Munich does).
export function holidays(year, state = 'BY', { assumption = false } = {}) {
  const e = easter(year), y = (md) => `${year}-${md}`, out = {};
  const add = (date, name, states) => { if (!states || states.includes(state)) out[date] = name; };
  add(y('01-01'), 'New Year’s Day');
  add(y('01-06'), 'Epiphany', ['BW', 'BY', 'ST']);
  if (year >= 2019) add(y('03-08'), 'International Women’s Day', year >= 2023 ? ['BE', 'MV'] : ['BE']);
  add(addDays(e, -2), 'Good Friday');
  add(e, 'Easter Sunday', ['BB']);
  add(addDays(e, 1), 'Easter Monday');
  add(y('05-01'), 'Labour Day');
  add(addDays(e, 39), 'Ascension Day');
  add(addDays(e, 49), 'Whit Sunday', ['BB']);
  add(addDays(e, 50), 'Whit Monday');
  add(addDays(e, 60), 'Corpus Christi', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
  if (state === 'SL' || (state === 'BY' && assumption)) out[y('08-15')] = 'Assumption Day';
  if (year >= 2019) add(y('09-20'), 'World Children’s Day', ['TH']);
  add(y('10-03'), 'German Unity Day');
  add(y('10-31'), 'Reformation Day', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']);
  add(y('11-01'), 'All Saints’ Day', ['BW', 'BY', 'NW', 'RP', 'SL']);
  // Repentance and Prayer Day: the Wednesday before 23 November.
  if (state === 'SN') { let d = y('11-22'); while (weekday(d) !== 'we') d = addDays(d, -1); out[d] = 'Repentance and Prayer Day'; }
  add(y('12-25'), 'Christmas Day');
  add(y('12-26'), 'Boxing Day');
  return out;
}
function holidayLookup(settings) {
  const cache = {};
  return (date) => {
    const yr = +date.slice(0, 4);
    cache[yr] ||= holidays(yr, settings.state || 'BY', { assumption: settings.assumption !== false && (settings.state || 'BY') === 'BY' });
    return cache[yr][date] || null;
  };
}

// ---------- routines ----------
// rule: { freq: 'weekly', days: ['mo','we'], every: 1, anchor? } | { freq: 'monthly', day: 15 } |
//       { freq: 'monthly', nth: 1..4 or -1, weekday: 'sa' } | { freq: 'yearly', month: 3, day: 14 }
export function occursOn(routine, date) {
  if (routine.from && date < routine.from) return false;
  if (routine.until && date > routine.until) return false;
  const r = routine.rule || {};
  const yr = +date.slice(0, 4), mo = +date.slice(5, 7), dy = +date.slice(8, 10);
  if (r.freq === 'weekly') {
    if (!(r.days || []).includes(weekday(date))) return false;
    const every = Math.max(1, r.every || 1);
    if (every === 1) return true;
    const anchor = r.anchor || routine.from || '2026-01-05';
    const weeks = Math.round(daysBetween(mondayOf(anchor), mondayOf(date)) / 7);
    return ((weeks % every) + every) % every === 0;
  }
  if (r.freq === 'monthly') {
    if (r.day) return dy === Math.min(r.day, monthLength(yr, mo));
    if (r.weekday !== weekday(date)) return false;
    if (r.nth === -1) return dy + 7 > monthLength(yr, mo);
    return Math.ceil(dy / 7) === r.nth;
  }
  if (r.freq === 'yearly') return mo === r.month && dy === Math.min(r.day, monthLength(yr, mo));
  return false;
}

// Plain words for a rule, for read-backs ("Tuesday and Thursday, every 2 weeks").
export function describeRule(r = {}) {
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
  if (r.freq === 'weekly') {
    const order = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'], days = order.filter((d) => (r.days || []).includes(d));
    const names = days.length === 7 ? 'every day' : days.join() === 'mo,tu,we,th,fr' ? 'weekdays' : list(days.map((d) => DAY_NAMES[d]));
    return (r.every || 1) > 1 ? `${names}, every ${r.every} weeks` : names;
  }
  if (r.freq === 'monthly') return r.day ? `monthly on the ${r.day}.` : `the ${r.nth === -1 ? 'last' : ['first', 'second', 'third', 'fourth'][r.nth - 1]} ${DAY_NAMES[r.weekday]} of each month`;
  if (r.freq === 'yearly') return `every year on ${r.day}.${r.month}.`;
  return 'never';
}
export function describeRoutine(rt) {
  const time = rt.start ? (rt.around ? ` around ${rt.start}` : rt.end ? ` ${rt.start}–${rt.end}` : ` from ${rt.start}`) : rt.end ? ` until ${rt.end}` : '';
  const valid = rt.from && rt.until ? `, from ${rt.from} until ${rt.until}` : rt.from ? `, from ${rt.from}` : rt.until ? `, until ${rt.until}` : '';
  return `${rt.title}, ${describeRule(rt.rule)}${time}, ${rt.fixed ? 'fixed' : 'flexible'}${valid}`;
}

// ---------- the computed week ----------
// data: { routines, exceptions, periods, events, settings }. Returns one entry per day from `from`, `days` long.
// Each day: { date, weekday, holiday, periods: [titles], items: [...] }, items sorted by start time.
export function expand(data, from, days = 7) {
  const { routines = [], exceptions = [], periods = [], events = [], settings = {} } = data;
  const tz = settings.tz || 'Europe/Berlin', holiday = holidayLookup(settings);
  const out = [];
  const byDate = {};
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const day = { date, weekday: weekday(date), holiday: holiday(date), periods: [], items: [] };
    out.push(day); byDate[date] = day;
  }
  const item = (rt, date, over = {}) => {
    const start = over.start ?? rt.start ?? null, end = over.end ?? rt.end ?? null;
    return { type: 'routine', id: rt.id, title: rt.title, date, start, end, around: !!rt.around, fixed: !!rt.fixed, outdoor: !!rt.outdoor, place: rt.place || '', ...(over.moved ? { moved: over.moved } : {}),
      startAt: start ? instant(date, start, tz) : null, endAt: end ? instant(date, end, tz) : null };
  };
  // Moved routines can land inside the range from a date outside it, so look a little either side.
  const scanFrom = addDays(from, -14), scanDays = days + 28;
  for (const rt of routines) {
    for (let i = 0; i < scanDays; i++) {
      const date = addDays(scanFrom, i);
      if (!occursOn(rt, date)) continue;
      const ex = exceptions.filter((x) => x.routine === rt.id && date >= x.from && date <= (x.until || x.from));
      const skip = ex.find((x) => x.skip), move = ex.find((x) => x.moveTo || x.start || x.end);
      const paused = periods.some((p) => date >= p.from && date <= p.until && (p.pauses === 'all' || (Array.isArray(p.pauses) && p.pauses.includes(rt.id))));
      if (skip || paused) continue;
      if (holiday(date) && (rt.onHoliday || 'skip') === 'skip' && !move?.moveTo) continue;
      const target = move?.moveTo || date;
      if (!byDate[target]) continue;
      byDate[target].items.push(item(rt, target, { start: move?.start, end: move?.end, moved: move?.moveTo ? date : null }));
    }
  }
  for (const p of periods) for (const d of out) if (d.date >= p.from && d.date <= p.until) d.periods.push(p.title);
  for (const ev of events) {
    const d = byDate[ev.date];
    if (!d) continue;
    d.items.push({ type: 'event', id: ev.id, title: ev.title, date: ev.date, start: ev.start || null, end: ev.end || null, fixed: ev.fixed !== false, place: ev.place || '', url: ev.url || '',
      startAt: ev.start ? instant(ev.date, ev.start, tz) : null, endAt: ev.end ? instant(ev.date, ev.end, tz) : null });
  }
  for (const d of out) d.items.sort((a, b) => (toMin(a.start) ?? -1) - (toMin(b.start) ?? -1) || a.title.localeCompare(b.title));
  return out;
}

// Free stretches on each day between `between` times, ignoring flexible routines (MyButler may suggest over them).
// Items with only an end ("office until 17:00") block the day up to it; a start without an end blocks an hour.
export function freeTime(week, { between = ['08:00', '22:00'], minMinutes = 60, includeFlexible = false } = {}) {
  const [lo, hi] = between.map(toMin);
  return week.map((d) => {
    const busy = d.items.filter((it) => (it.start || it.end) && (it.fixed || includeFlexible))
      .map((it) => { const s = it.start ? toMin(it.start) : lo, e = it.end ? toMin(it.end) : s + 60; return [s, e > s ? e : 24 * 60]; })
      .sort((a, b) => a[0] - b[0]);
    const free = [];
    let t = lo;
    for (const [s, e] of busy) { if (s - t >= minMinutes && s > t) free.push([t, Math.min(s, hi)]); t = Math.max(t, e); if (t >= hi) break; }
    if (hi - t >= minMinutes) free.push([t, hi]);
    return { date: d.date, weekday: d.weekday, holiday: d.holiday, periods: d.periods, free: free.filter(([s, e]) => e - s >= minMinutes).map(([s, e]) => ({ from: toTime(s), to: toTime(e), minutes: e - s })) };
  });
}

// Weekends (Sat+Sun, with a holiday Friday or Monday joined on) with no fixed plans: candidates for a short trip.
export function freeWeekends(week) {
  const out = [];
  for (const d of week) {
    if (d.weekday !== 'sa') continue;
    const sun = week.find((x) => x.date === addDays(d.date, 1));
    if (!sun) continue;
    const span = [d, sun];
    const fri = week.find((x) => x.date === addDays(d.date, -1)), mon = week.find((x) => x.date === addDays(d.date, 2));
    if (fri?.holiday) span.unshift(fri);
    if (mon?.holiday) span.push(mon);
    if (span.every((x) => !x.items.some((it) => it.fixed))) out.push({ from: span[0].date, until: span[span.length - 1].date, days: span.length });
  }
  return out;
}

// ---------- reminders from plain rules ----------
// chore: { id, title, every: { n, unit: 'day'|'week'|'month'|'year' }, lastDone, due, remindDays }
export function nextDue(chore) {
  if (chore.due && (!chore.lastDone || chore.lastDone < chore.due)) return chore.due;
  if (!chore.every || !chore.lastDone) return chore.due || null;
  const { n = 1, unit = 'week' } = chore.every;
  if (unit === 'day') return addDays(chore.lastDone, n);
  if (unit === 'week') return addDays(chore.lastDone, 7 * n);
  const y = +chore.lastDone.slice(0, 4), m = +chore.lastDone.slice(5, 7) - 1, d = +chore.lastDone.slice(8, 10);
  const months = unit === 'month' ? n : 12 * n, ty = y + Math.floor((m + months) / 12), tm = (m + months) % 12;
  return iso(Date.UTC(ty, tm, Math.min(d, monthLength(ty, tm + 1))));
}
export function dueChores(chores, today) {
  return chores.map((c) => ({ c, due: nextDue(c) }))
    .filter(({ c, due }) => due && !c.paused && daysBetween(today, due) <= (c.remindDays ?? 0))
    .map(({ c, due }) => ({ type: 'chore', id: c.id, title: c.title, due, days: daysBetween(today, due) }))
    .sort((a, b) => a.due.localeCompare(b.due));
}
// people: { birthday: 'MM-DD' or 'YYYY-MM-DD' }. Birthdays within `within` days, with the age when the year is known.
export function upcomingBirthdays(people, today, within = 14) {
  const out = [];
  for (const p of people) {
    const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(p.birthday || '');
    if (!m) continue;
    const yr = +today.slice(0, 4);
    for (const y of [yr, yr + 1]) {
      // 29 February birthdays fall on 28 February in other years.
      const md = m[2] === '02' && m[3] === '29' && monthLength(y, 2) === 28 ? '02-28' : `${m[2]}-${m[3]}`;
      const date = `${y}-${md}`, days = daysBetween(today, date);
      if (days >= 0 && days <= within) { out.push({ type: 'birthday', id: p.id, title: `${p.name}’s birthday`, name: p.name, due: date, days, age: m[1] ? y - +m[1] : null }); break; }
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

// ---------- goals ----------
// How often MyButler asks about a goal, by its time frame, unless the goal says otherwise.
export const CHECK_DAYS = { 'this-month': 7, 'this-year': 30, 'few-years': 60, someday: 90 };
// Steps of active goals due within `within` days (or overdue), and goals whose check-in is due.
export function goalReminders(goals, today, within = 3) {
  const out = [];
  for (const g of goals) {
    if (g.status !== 'active') continue;
    for (const s of g.steps || []) if (s.due && !s.done && daysBetween(today, s.due) <= within) out.push({ type: 'step', id: s.id, goal: g.id, title: `${g.title}: ${s.text}`, due: s.due, days: daysBetween(today, s.due) });
    const every = g.checkEvery ?? CHECK_DAYS[g.horizon] ?? 30;
    if (every > 0) {
      const due = addDays(g.lastCheck || g.created, every);
      if (due <= today) out.push({ type: 'goal', id: g.id, title: `How is “${g.title}” going?`, due, days: daysBetween(today, due) });
    }
  }
  return out;
}
