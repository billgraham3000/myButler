// The only way MyButler's AI changes the owner's data: tools whose input is checked and limited here, as the Jar
// does with its building blocks. Routines, exceptions and periods are only proposed; they are saved after the owner
// says yes in a later message (or taps Yes on the page). The page's own edits go through edit(), with the same checks.
import { randomBytes } from 'node:crypto';
import * as store from './store.js';
import * as cal from './calendar.js';
import * as sources from './sources.js';

const bad = (m) => { const e = new Error(m); e.bad = true; return e; };
const newId = (p) => `${p}${randomBytes(4).toString('hex')}`;
const LIMIT = { facts: 400, people: 200, routines: 60, exceptions: 300, periods: 100, chores: 150, monthEvents: 300, proposals: 20, goals: 50, steps: 30, notes: 20 };

// ---------- checks ----------
const str = (v, max = 400) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, max);
const need = (v, name, max) => { const s = str(v, max); if (!s) throw bad(`${name} is required`); return s; };
const opt = (v, max) => (v == null || v === '' ? '' : str(v, max));
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const date = (v, name, required = false) => { if (v == null || v === '') { if (required) throw bad(`${name} is required`); return null; } if (!DATE.test(v)) throw bad(`${name} must be YYYY-MM-DD`); return v; };
const time = (v, name) => { if (v == null || v === '') return null; if (!TIME.test(v)) throw bad(`${name} must be HH:MM`); return v; };
const int = (v, lo, hi, name) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${name} must be a whole number from ${lo} to ${hi}`); return n; };
const list = (v, max = 12, len = 80) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => str(x, len)).filter(Boolean).slice(0, max);
const oneOf = (v, opts, name, dflt) => { if (v == null || v === '') return dflt; if (!opts.includes(v)) throw bad(`${name} must be one of ${opts.join(', ')}`); return v; };
const url = (v) => { const s = opt(v, 500); if (!s) return ''; try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);

function cleanRule(r) {
  if (!r || typeof r !== 'object') throw bad('rule is required');
  if (r.freq === 'weekly') {
    const days = Array.isArray(r.days) ? r.days : [];
    if (!days.length || !days.every((d) => cal.DAYS.includes(d))) throw bad('rule.days must list days like "mo", "tu"');
    const out = { freq: 'weekly', days: [...new Set(days)] };
    if (r.every != null && Number(r.every) !== 1) out.every = int(r.every, 1, 8, 'rule.every');
    if (r.anchor) out.anchor = date(r.anchor, 'rule.anchor');
    return out;
  }
  if (r.freq === 'monthly') {
    if (r.day != null) return { freq: 'monthly', day: int(r.day, 1, 31, 'rule.day') };
    if (![1, 2, 3, 4, -1].includes(Number(r.nth))) throw bad('rule.nth must be 1, 2, 3, 4 or -1 (last)');
    if (!cal.DAYS.includes(r.weekday)) throw bad('rule.weekday must be a day like "sa"');
    return { freq: 'monthly', nth: Number(r.nth), weekday: r.weekday };
  }
  if (r.freq === 'yearly') return { freq: 'yearly', month: int(r.month, 1, 12, 'rule.month'), day: int(r.day, 1, 31, 'rule.day') };
  throw bad('rule.freq must be weekly, monthly or yearly');
}
function cleanRoutine(x) {
  const rt = { title: need(x.title, 'title', 80), rule: cleanRule(x.rule), start: time(x.start, 'start'), end: time(x.end, 'end'),
    around: !!x.around, fixed: !!x.fixed, from: date(x.from, 'from'), until: date(x.until, 'until'),
    onHoliday: oneOf(x.onHoliday, ['skip', 'keep'], 'onHoliday', 'skip'), outdoor: !!x.outdoor, place: opt(x.place, 120) };
  if (rt.from && rt.until && rt.until < rt.from) throw bad('until is before from');
  return rt;
}
function cleanException(x, routines) {
  if (!routines.some((r) => r.id === x.routine)) throw bad('routine must be the id of an existing routine');
  const ex = { routine: x.routine, from: date(x.from, 'from', true), until: date(x.until, 'until'), skip: !!x.skip, moveTo: date(x.moveTo, 'moveTo'), start: time(x.start, 'start'), end: time(x.end, 'end'), note: opt(x.note, 200) };
  if (!ex.skip && !ex.moveTo && !ex.start && !ex.end) throw bad('say skip, or give moveTo or new times');
  if (ex.until && ex.until < ex.from) throw bad('until is before from');
  return ex;
}
function cleanPeriod(x, routines) {
  const pauses = x.pauses === 'all' || x.pauses == null ? 'all' : x.pauses === 'none' ? [] : list(x.pauses, 60, 20).filter((id) => routines.some((r) => r.id === id));
  const p = { title: need(x.title, 'title', 80), kind: oneOf(x.kind, ['vacation', 'sick', 'guests', 'trip', 'other'], 'kind', 'other'), from: date(x.from, 'from', true), until: date(x.until, 'until', true), pauses };
  if (p.until < p.from) throw bad('until is before from');
  return p;
}
function cleanChore(x) {
  const c = { title: need(x.title, 'title', 80), every: null, due: date(x.due, 'due'), lastDone: date(x.lastDone, 'lastDone'), remindDays: x.remindDays == null ? 0 : int(x.remindDays, 0, 60, 'remindDays'), notes: opt(x.notes, 400), paused: !!x.paused };
  if (x.every) c.every = { n: int(x.every.n ?? 1, 1, 52, 'every.n'), unit: oneOf(x.every.unit, ['day', 'week', 'month', 'year'], 'every.unit', 'week') };
  if (!c.every && !c.due) throw bad('give every (how often) or due (a date)');
  return c;
}
const HORIZONS = ['this-month', 'this-year', 'few-years', 'someday'];
function cleanGoal(x, partial = false) {
  const g = {};
  if (!partial || has(x, 'title')) g.title = need(x.title, 'title', 120);
  if (!partial || has(x, 'kind')) g.kind = oneOf(x.kind, ['goal', 'dream'], 'kind', 'goal');
  if (!partial || has(x, 'why')) g.why = opt(x.why, 400);
  if (!partial || has(x, 'horizon')) g.horizon = oneOf(x.horizon, HORIZONS, 'horizon', 'this-year');
  if (!partial || has(x, 'target')) g.target = date(x.target, 'target');
  if (has(x, 'checkEvery') && x.checkEvery != null && x.checkEvery !== '') g.checkEvery = int(x.checkEvery, 0, 365, 'checkEvery');
  if (has(x, 'status') && x.status) g.status = oneOf(x.status, ['active', 'paused', 'done', 'dropped'], 'status');
  return g;
}
const cleanStep = (x) => ({ text: need(x.text, 'step text', 160), due: date(x.due, 'due') });
function cleanEvent(x) {
  const ev = { title: need(x.title, 'title', 120), date: date(x.date, 'date', true), start: time(x.start, 'start'), end: time(x.end, 'end'), place: opt(x.place, 120), url: url(x.url), notes: opt(x.notes, 400), fixed: x.fixed !== false };
  return ev;
}
const BIRTHDAY = /^(\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// Only what helps the advice. Contact details and addresses are dropped unless put in notes on purpose.
function cleanPerson(x, partial = false) {
  const p = {};
  if (!partial || has(x, 'name')) p.name = need(x.name, 'name', 60);
  if (has(x, 'relation') || !partial) p.relation = opt(x.relation, 60);
  if (has(x, 'birthday') || !partial) { const b = opt(x.birthday, 10); if (b && !BIRTHDAY.test(b)) throw bad('birthday must be MM-DD or YYYY-MM-DD'); p.birthday = b; }
  if (has(x, 'interests') || !partial) p.interests = list(x.interests, 20, 60);
  if (has(x, 'ideas') || !partial) p.ideas = list(x.ideas, 20, 120);
  if (has(x, 'notes') || !partial) p.notes = opt(x.notes, 600);
  return p;
}
function cleanFact(x, partial = false) {
  const f = {};
  if (!partial || has(x, 'text')) f.text = need(x.text, 'text', 400);
  if (!partial || has(x, 'topic')) f.topic = opt(x.topic, 40).toLowerCase() || 'general';
  if (!partial || has(x, 'kind')) f.kind = oneOf(x.kind, ['stated', 'inferred'], 'kind', 'stated');
  if (f.kind === 'inferred' || has(x, 'confidence')) f.confidence = Math.max(0, Math.min(1, Number(x.confidence) || 0.5));
  if (f.kind === 'stated') { f.confirmed = true; delete f.confidence; } else if (f.kind === 'inferred') f.confirmed = false;
  return f;
}
const find = (arr, id, what) => { const it = arr.find((x) => x.id === id); if (!it) throw bad(`no ${what} with id ${id}`); return it; };
const cap = (arr, n, what) => { if (arr.length >= n) throw bad(`too many ${what} (at most ${n})`); };
const monthFile = (d) => `events-${d.slice(0, 7)}`;

// ---------- calendar data for a range ----------
export async function calendarData(pid, from, days) {
  const [{ data: r }, { data: settings }] = await Promise.all([store.read(pid, 'routines'), store.read(pid, 'settings')]);
  const events = await store.eventsBetween(pid, cal.addDays(from, -14), cal.addDays(from, days + 14));
  return { routines: r.routines, exceptions: r.exceptions, periods: r.periods, events, settings };
}
export async function week(pid, from, days) { return cal.expand(await calendarData(pid, from, days), from, days); }

// ---------- proposals ----------
function readback(action, item, routines) {
  const name = (id) => routines.find((r) => r.id === id)?.title || id;
  if (action === 'add_routine' || action === 'update_routine') return cal.describeRoutine(item);
  if (action === 'remove_routine') return `Remove the routine “${name(item.id)}”`;
  if (action === 'add_exception') {
    const when = item.until && item.until !== item.from ? `${item.from} to ${item.until}` : item.from;
    return `${name(item.routine)}: ${item.skip ? 'skipped' : item.moveTo ? `moved to ${item.moveTo}` : 'different times'} on ${when}${item.start || item.end ? ` (${item.start || '…'}–${item.end || '…'})` : ''}`;
  }
  if (action === 'add_period') return `${item.title} (${item.kind}) from ${item.from} until ${item.until}, pausing ${item.pauses === 'all' ? 'all routines' : item.pauses.length ? item.pauses.map(name).join(', ') : 'no routines'}`;
  if (action === 'remove_exception' || action === 'remove_period') return `Remove ${action === 'remove_period' ? 'the period' : 'the exception'} ${item.id}`;
  return action;
}
async function propose(pid, action, makeItem, ctx) {
  return store.update(pid, 'routines', (r) => {
    const item = makeItem(r);
    const p = { id: newId('q'), action, item, readback: readback(action, item, r.routines), turn: ctx.turn, at: new Date().toISOString() };
    r.proposals = [...r.proposals, p].slice(-LIMIT.proposals);
    ctx.changes?.push({ proposal: p.id, readback: p.readback });
    return { ok: true, proposal: p.id, readback: p.readback, note: 'Not saved yet. Read this back to the owner and ask if it is right.' };
  });
}
function applyProposal(r, p) {
  const it = p.item;
  if (p.action === 'add_routine') { cap(r.routines, LIMIT.routines, 'routines'); r.routines.push({ id: newId('r'), ...it }); }
  else if (p.action === 'update_routine') { const cur = find(r.routines, it.id, 'routine'); Object.assign(cur, it); }
  else if (p.action === 'remove_routine') { r.routines = r.routines.filter((x) => x.id !== it.id); r.exceptions = r.exceptions.filter((x) => x.routine !== it.id); }
  else if (p.action === 'add_exception') { cap(r.exceptions, LIMIT.exceptions, 'exceptions'); r.exceptions.push({ id: newId('x'), ...it }); }
  else if (p.action === 'add_period') { cap(r.periods, LIMIT.periods, 'periods'); r.periods.push({ id: newId('p'), ...it }); }
  else if (p.action === 'remove_exception') r.exceptions = r.exceptions.filter((x) => x.id !== it.id);
  else if (p.action === 'remove_period') r.periods = r.periods.filter((x) => x.id !== it.id);
}
// The owner's answer from the page (yes or no), or the AI's after the owner said yes in a later message.
export async function decide(pid, id, yes, ctx = {}) {
  return store.update(pid, 'routines', (r) => {
    const p = find(r.proposals, id, 'proposal');
    if (ctx.turn != null && p.turn >= ctx.turn) throw bad('Wait for the owner to say yes in a later message before confirming.');
    if (yes) applyProposal(r, p);
    r.proposals = r.proposals.filter((x) => x.id !== id);
    ctx.changes?.push({ [yes ? 'saved' : 'dropped']: p.readback });
    return { ok: true, saved: !!yes, readback: p.readback };
  });
}

// ---------- the tools ----------
const S = (props, required = []) => ({ type: 'object', properties: props, required });
const T = {
  string: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM, 24 hours, local' },
  strings: { type: 'array', items: { type: 'string' } }, bool: { type: 'boolean' }, number: { type: 'number' },
};
const RULE = { type: 'object', description: 'weekly: {freq:"weekly", days:["mo","we"], every?:N weeks, anchor?:date of a week it happens}; monthly: {freq:"monthly", day:15} or {freq:"monthly", nth:1|2|3|4|-1, weekday:"sa"}; yearly: {freq:"yearly", month:3, day:14}',
  properties: { freq: { type: 'string', enum: ['weekly', 'monthly', 'yearly'] }, days: { type: 'array', items: { type: 'string', enum: cal.DAYS } }, every: T.number, anchor: T.date, day: T.number, nth: T.number, weekday: { type: 'string', enum: cal.DAYS }, month: T.number }, required: ['freq'] };
const ROUTINE = { title: T.string, rule: RULE, start: T.time, end: T.time, around: { type: 'boolean', description: 'start is approximate' }, fixed: { type: 'boolean', description: 'true: never suggest over it; false: usually, but can move or skip' },
  from: T.date, until: T.date, onHoliday: { type: 'string', enum: ['skip', 'keep'], description: 'skip for work, school or classes; keep for personal things' }, outdoor: T.bool, place: T.string };

export const DEFS = [
  { name: 'add_fact', description: 'Save something about the owner: a taste, dislike, budget, habit, hobby or circumstance. kind "stated" when the owner said it outright, "inferred" (with confidence 0–1) when it is your own conclusion; inferred facts are shown to the owner to confirm.',
    input_schema: S({ text: T.string, topic: { type: 'string', description: 'one word, e.g. food, music, sport, travel, budget, home, work' }, kind: { type: 'string', enum: ['stated', 'inferred'] }, confidence: T.number }, ['text', 'kind']) },
  { name: 'update_fact', description: 'Change or confirm a saved fact (by id).', input_schema: S({ id: T.string, text: T.string, topic: T.string, kind: { type: 'string', enum: ['stated', 'inferred'] }, confidence: T.number }, ['id']) },
  { name: 'delete_fact', description: 'Forget a saved fact (by id).', input_schema: S({ id: T.string }, ['id']) },
  { name: 'add_memory', description: 'Note something that happened or a lasting impression, e.g. "loved the wine fest in Wiesbaden".', input_schema: S({ text: T.string }, ['text']) },
  { name: 'add_person', description: 'Save a friend or relative: only what helps the advice (relationship, birthday, interests, gift ideas, notes). No addresses or contact details.',
    input_schema: S({ name: T.string, relation: T.string, birthday: { type: 'string', description: 'MM-DD, or YYYY-MM-DD if the year is known' }, interests: T.strings, ideas: { ...T.strings, description: 'gift or plan ideas' }, notes: T.string }, ['name']) },
  { name: 'update_person', description: 'Change a saved person (by id); lists given replace the old ones.', input_schema: S({ id: T.string, name: T.string, relation: T.string, birthday: T.string, interests: T.strings, ideas: T.strings, notes: T.string }, ['id']) },
  { name: 'propose_routine', description: 'Propose a new routine, or a change to one (give id). Not saved until the owner says yes: read the returned readback to the owner and ask.', input_schema: S({ id: { type: 'string', description: 'only to change an existing routine' }, ...ROUTINE }, ['title', 'rule']) },
  { name: 'propose_remove_routine', description: 'Propose removing a routine (by id). Not saved until the owner says yes.', input_schema: S({ id: T.string }, ['id']) },
  { name: 'propose_exception', description: 'Propose an exception to a routine: skip it ("no gym this week": from/until, skip true) or move it ("office Friday instead of Thursday": from = the usual date, moveTo) or other times. Not saved until the owner says yes.',
    input_schema: S({ routine: { type: 'string', description: 'routine id' }, from: T.date, until: T.date, skip: T.bool, moveTo: T.date, start: T.time, end: T.time, note: T.string }, ['routine', 'from']) },
  { name: 'propose_period', description: 'Propose a period such as a vacation, sickness or guests staying, which pauses all routines ("all"), none ("none") or a list of routine ids. Not saved until the owner says yes.',
    input_schema: S({ title: T.string, kind: { type: 'string', enum: ['vacation', 'sick', 'guests', 'trip', 'other'] }, from: T.date, until: T.date, pauses: { description: '"all", "none" or a list of routine ids' } }, ['title', 'from', 'until']) },
  { name: 'propose_remove', description: 'Propose removing an exception or a period (by id). Not saved until the owner says yes.', input_schema: S({ what: { type: 'string', enum: ['exception', 'period'] }, id: T.string }, ['what', 'id']) },
  { name: 'confirm_proposal', description: 'Save a proposal after the owner said yes to its readback in a later message. Use answer "no" to drop it.', input_schema: S({ id: T.string, answer: { type: 'string', enum: ['yes', 'no'] } }, ['id']) },
  { name: 'add_event', description: 'Add a one-off appointment or a plan the owner accepted. Saved straight away.', input_schema: S({ title: T.string, date: T.date, start: T.time, end: T.time, place: T.string, url: T.string, notes: T.string }, ['title', 'date']) },
  { name: 'update_event', description: 'Change a one-off event (id and its current date); give newDate to move it to another day.', input_schema: S({ id: T.string, date: T.date, newDate: T.date, title: T.string, start: T.time, end: T.time, place: T.string, url: T.string, notes: T.string }, ['id', 'date']) },
  { name: 'remove_event', description: 'Remove a one-off event (id and date).', input_schema: S({ id: T.string, date: T.date }, ['id', 'date']) },
  { name: 'add_chore', description: 'Add a chore or reminder: repeating (every {n, unit}) with lastDone, or once (due). remindDays: how many days ahead to remind.',
    input_schema: S({ title: T.string, every: { type: 'object', properties: { n: T.number, unit: { type: 'string', enum: ['day', 'week', 'month', 'year'] } } }, due: T.date, lastDone: T.date, remindDays: T.number, notes: T.string }, ['title']) },
  { name: 'update_chore', description: 'Change a chore (by id), e.g. pause it or change how often.', input_schema: S({ id: T.string, title: T.string, every: { type: 'object', properties: { n: T.number, unit: { type: 'string' } } }, due: T.date, lastDone: T.date, remindDays: T.number, notes: T.string, paused: T.bool }, ['id']) },
  { name: 'complete_chore', description: 'Mark a chore done (today unless a date is given). A one-time chore is then removed.', input_schema: S({ id: T.string, date: T.date }, ['id']) },
  { name: 'remove_chore', description: 'Remove a chore (by id).', input_schema: S({ id: T.string }, ['id']) },
  { name: 'add_goal', description: 'Save a goal or a dream (not as a fact): what, why it matters, time frame, target date, and concrete steps if the owner names them. MyButler then reminds of due steps and asks how it is going now and then.',
    input_schema: S({ title: T.string, kind: { type: 'string', enum: ['goal', 'dream'] }, why: T.string, horizon: { type: 'string', enum: HORIZONS }, target: T.date, checkEvery: { type: 'number', description: 'days between check-ins; 0 = never; default by horizon' },
      steps: { type: 'array', items: { type: 'object', properties: { text: T.string, due: T.date }, required: ['text'] } } }, ['title']) },
  { name: 'update_goal', description: 'Change a goal (by id), or record progress with a note (this also counts as the check-in). status: active, paused, done or dropped.',
    input_schema: S({ id: T.string, title: T.string, kind: { type: 'string', enum: ['goal', 'dream'] }, why: T.string, horizon: { type: 'string', enum: HORIZONS }, target: T.date, checkEvery: T.number, status: { type: 'string', enum: ['active', 'paused', 'done', 'dropped'] }, note: { type: 'string', description: 'progress in the owner\'s words' } }, ['id']) },
  { name: 'add_goal_step', description: 'Add a step to a goal, with a due date if there is one.', input_schema: S({ goal: { type: 'string', description: 'goal id' }, text: T.string, due: T.date }, ['goal', 'text']) },
  { name: 'complete_goal_step', description: 'Mark a goal\'s step done (today unless a date is given).', input_schema: S({ goal: T.string, step: { type: 'string', description: 'step id' }, date: T.date }, ['goal', 'step']) },
  { name: 'get_week', description: 'The owner\'s computed calendar for a range: routines (fixed or flexible), exceptions, periods, holidays and one-off events.', input_schema: S({ from: T.date, days: { type: 'number', description: '1–31, default 7' } }) },
  { name: 'find_free_time', description: 'Free stretches per day, ignoring flexible routines unless includeFlexible.', input_schema: S({ from: T.date, days: T.number, minMinutes: T.number, between: { type: 'array', items: T.time, description: '["08:00","22:00"]' }, includeFlexible: T.bool }) },
  { name: 'search_events', description: 'Real events near home from Ticketmaster (concerts, theatre, sport, family). Each has a link. If the source is off, use web search instead.', input_schema: S({ from: T.date, days: T.number, keyword: T.string }) },
  { name: 'get_weather', description: 'Ten days of daily weather at home.', input_schema: S({}) },
];

const routines = (pid) => store.read(pid, 'routines').then((x) => x.data.routines);

const RUN = {
  async add_fact(pid, x, ctx) {
    const f = cleanFact(x);
    return store.update(pid, 'profile', (p) => {
      const same = p.facts.find((y) => y.text.toLowerCase() === f.text.toLowerCase());
      if (same) { Object.assign(same, f, { updated: ctx.now.date }); return { ok: true, id: same.id, note: 'already known; updated' }; }
      cap(p.facts, LIMIT.facts, 'facts');
      const id = newId('f');
      p.facts.push({ id, ...f, source: ctx.source || 'chat', at: ctx.now.date });
      ctx.changes?.push({ fact: f.text });
      return { ok: true, id };
    });
  },
  async update_fact(pid, x, ctx) {
    const f = cleanFact(x, true);
    return store.update(pid, 'profile', (p) => { Object.assign(find(p.facts, x.id, 'fact'), f, { updated: ctx.now.date }); ctx.changes?.push({ fact: f.text || x.id }); return { ok: true }; });
  },
  async delete_fact(pid, x, ctx) {
    return store.update(pid, 'profile', (p) => { find(p.facts, x.id, 'fact'); p.facts = p.facts.filter((y) => y.id !== x.id); ctx.changes?.push({ forgot: x.id }); return { ok: true }; });
  },
  async add_memory(pid, x, ctx) { const text = need(x.text, 'text', 600); await store.append(pid, 'memories', { text, at: ctx.now.date, source: ctx.source || 'chat' }); ctx.changes?.push({ memory: text }); return { ok: true }; },
  async add_person(pid, x, ctx) {
    const person = cleanPerson(x);
    return store.update(pid, 'people', (d) => {
      cap(d.people, LIMIT.people, 'people');
      const id = newId('h');
      d.people.push({ id, ...person, at: ctx.now.date });
      ctx.changes?.push({ person: person.name });
      return { ok: true, id };
    });
  },
  async update_person(pid, x, ctx) {
    const person = cleanPerson(x, true);
    return store.update(pid, 'people', (d) => { const cur = find(d.people, x.id, 'person'); Object.assign(cur, person, { updated: ctx.now.date }); ctx.changes?.push({ person: cur.name }); return { ok: true }; });
  },
  async propose_routine(pid, x, ctx) {
    const rt = cleanRoutine(x);
    if (x.id) { const cur = (await routines(pid)).find((r) => r.id === x.id); if (!cur) throw bad(`no routine with id ${x.id}`); }
    return propose(pid, x.id ? 'update_routine' : 'add_routine', () => (x.id ? { id: x.id, ...rt } : rt), ctx);
  },
  async propose_remove_routine(pid, x, ctx) { find(await routines(pid), x.id, 'routine'); return propose(pid, 'remove_routine', () => ({ id: x.id }), ctx); },
  async propose_exception(pid, x, ctx) { return propose(pid, 'add_exception', (r) => cleanException(x, r.routines), ctx); },
  async propose_period(pid, x, ctx) { return propose(pid, 'add_period', (r) => cleanPeriod(x, r.routines), ctx); },
  async propose_remove(pid, x, ctx) {
    const what = oneOf(x.what, ['exception', 'period'], 'what');
    return propose(pid, `remove_${what}`, (r) => { find(what === 'period' ? r.periods : r.exceptions, x.id, what); return { id: x.id }; }, ctx);
  },
  async confirm_proposal(pid, x, ctx) { return decide(pid, String(x.id || ''), x.answer !== 'no', ctx); },
  async add_event(pid, x, ctx) {
    const ev = cleanEvent(x);
    return store.update(pid, monthFile(ev.date), (d) => {
      cap(d.events, LIMIT.monthEvents, 'events this month');
      const id = newId('e');
      d.events.push({ id, ...ev, source: ctx.source || 'chat', at: ctx.now.date });
      ctx.changes?.push({ event: `${ev.title} on ${ev.date}` });
      return { ok: true, id };
    });
  },
  async update_event(pid, x, ctx) {
    const from = date(x.date, 'date', true);
    const cur = (await store.read(pid, monthFile(from))).data.events.find((e) => e.id === x.id);
    if (!cur) throw bad(`no event with id ${x.id} on ${from}`);
    const changes = Object.fromEntries(['title', 'start', 'end', 'place', 'url', 'notes'].filter((k) => has(x, k)).map((k) => [k, x[k]]));
    const ev = { ...cur, ...cleanEvent({ ...cur, ...changes, date: date(x.newDate, 'newDate') || from }) };
    if (monthFile(ev.date) === monthFile(from)) {
      await store.update(pid, monthFile(from), (d) => { const i = d.events.findIndex((e) => e.id === x.id); if (i < 0) throw bad(`no event with id ${x.id}`); d.events[i] = ev; });
    } else {
      // Moving to another month: add it there first, so a failure never loses it.
      await store.update(pid, monthFile(ev.date), (d) => { cap(d.events, LIMIT.monthEvents, 'events that month'); d.events = d.events.filter((e) => e.id !== ev.id); d.events.push(ev); });
      await store.update(pid, monthFile(from), (d) => { d.events = d.events.filter((e) => e.id !== x.id); });
    }
    ctx.changes?.push({ event: `${ev.title} on ${ev.date}` });
    return { ok: true };
  },
  async remove_event(pid, x, ctx) {
    const d0 = date(x.date, 'date', true);
    return store.update(pid, monthFile(d0), (d) => { find(d.events, x.id, 'event'); d.events = d.events.filter((e) => e.id !== x.id); ctx.changes?.push({ removed: x.id }); return { ok: true }; });
  },
  async add_chore(pid, x, ctx) {
    const c = cleanChore(x);
    return store.update(pid, 'chores', (d) => { cap(d.chores, LIMIT.chores, 'chores'); const id = newId('c'); d.chores.push({ id, ...c, at: ctx.now.date }); ctx.changes?.push({ chore: c.title }); return { ok: true, id, nextDue: cal.nextDue(c) }; });
  },
  async update_chore(pid, x, ctx) {
    return store.update(pid, 'chores', (d) => {
      const cur = find(d.chores, x.id, 'chore');
      const next = cleanChore({ ...cur, ...Object.fromEntries(Object.entries(x).filter(([k, v]) => k !== 'id' && v !== undefined)) });
      Object.assign(cur, next); ctx.changes?.push({ chore: cur.title });
      return { ok: true, nextDue: cal.nextDue(cur) };
    });
  },
  async complete_chore(pid, x, ctx) {
    const when = date(x.date, 'date') || ctx.now.date;
    return store.update(pid, 'chores', (d) => {
      const cur = find(d.chores, x.id, 'chore');
      if (!cur.every) d.chores = d.chores.filter((c) => c.id !== cur.id);
      else { cur.lastDone = when; cur.due = null; }
      ctx.changes?.push({ done: cur.title });
      return { ok: true, nextDue: cur.every ? cal.nextDue(cur) : null };
    });
  },
  async remove_chore(pid, x, ctx) { return store.update(pid, 'chores', (d) => { find(d.chores, x.id, 'chore'); d.chores = d.chores.filter((c) => c.id !== x.id); ctx.changes?.push({ removed: x.id }); return { ok: true }; }); },
  async add_goal(pid, x, ctx) {
    const g = cleanGoal(x);
    const steps = (Array.isArray(x.steps) ? x.steps : []).slice(0, LIMIT.steps).map(cleanStep);
    return store.update(pid, 'goals', (d) => {
      cap(d.goals.filter((y) => y.status === 'active' || y.status === 'paused'), LIMIT.goals, 'open goals');
      const id = newId('g');
      d.goals.push({ id, ...g, status: 'active', steps: steps.map((s) => ({ id: newId('t'), ...s, done: null })), notes: [], created: ctx.now.date, lastCheck: null });
      ctx.changes?.push({ goal: g.title });
      return { ok: true, id };
    });
  },
  async update_goal(pid, x, ctx) {
    const g = cleanGoal(x, true), note = opt(x.note, 400);
    return store.update(pid, 'goals', (d) => {
      const cur = find(d.goals, x.id, 'goal');
      Object.assign(cur, g, { updated: ctx.now.date });
      if (g.status === 'done') cur.doneAt = ctx.now.date;
      if (note) { cur.notes = [...(cur.notes || []), { at: ctx.now.date, text: note }].slice(-LIMIT.notes); cur.lastCheck = ctx.now.date; }
      ctx.changes?.push({ goal: `${cur.title}${note ? ` (${note})` : g.status ? ` (${g.status})` : ''}` });
      return { ok: true };
    });
  },
  async add_goal_step(pid, x, ctx) {
    const s = cleanStep(x);
    return store.update(pid, 'goals', (d) => {
      const cur = find(d.goals, x.goal, 'goal');
      cap(cur.steps, LIMIT.steps, 'steps for this goal');
      const id = newId('t');
      cur.steps.push({ id, ...s, done: null });
      ctx.changes?.push({ step: `${cur.title}: ${s.text}` });
      return { ok: true, id };
    });
  },
  async complete_goal_step(pid, x, ctx) {
    const when = date(x.date, 'date') || ctx.now.date;
    return store.update(pid, 'goals', (d) => {
      const cur = find(d.goals, x.goal, 'goal'), st = find(cur.steps, x.step, 'step');
      st.done = when; cur.lastCheck = ctx.now.date;
      ctx.changes?.push({ done: `${cur.title}: ${st.text}` });
      return { ok: true, left: cur.steps.filter((y) => !y.done).length };
    });
  },
  async get_week(pid, x, ctx) {
    const from = date(x.from, 'from') || ctx.now.date, days = x.days == null ? 7 : int(x.days, 1, 31, 'days');
    return { days: await week(pid, from, days) };
  },
  async find_free_time(pid, x, ctx) {
    const from = date(x.from, 'from') || ctx.now.date, days = x.days == null ? 7 : int(x.days, 1, 31, 'days');
    const between = Array.isArray(x.between) && x.between.length === 2 ? [time(x.between[0], 'between'), time(x.between[1], 'between')] : ['08:00', '22:00'];
    return { days: cal.freeTime(await week(pid, from, days), { between, minMinutes: x.minMinutes == null ? 60 : int(x.minMinutes, 15, 1440, 'minMinutes'), includeFlexible: !!x.includeFlexible }) };
  },
  async search_events(pid, x, ctx) {
    const from = date(x.from, 'from') || ctx.now.date, days = x.days == null ? 14 : int(x.days, 1, 60, 'days');
    const r = await sources.events((await store.read(pid, 'settings')).data, { from, days, keyword: opt(x.keyword, 60), size: 60 });
    for (const e of r.events) ctx.sourced?.set(e.id, e);
    return r;
  },
  async get_weather(pid, x, ctx) { return sources.weather((await store.read(pid, 'settings')).data); },
};

// Runs one tool. Problems with the input come back as { error } for the AI to fix; anything else is thrown.
// ctx: { pid, turn, now: { date, time }, changes?: [], source? }
export async function run(name, input, ctx) {
  const fn = RUN[name];
  if (!fn) return { error: `Unknown tool ${name}` };
  try { return await fn(ctx.pid, input && typeof input === 'object' ? input : {}, ctx); } catch (e) { if (e.bad) return { error: e.message }; throw e; }
}

// ---------- edits from the page (the owner editing by hand needs no proposal) ----------
export async function edit(pid, kind, op, item = {}, now) {
  const ctx = { pid, now, source: 'page', changes: [] };
  const go = async (name, x) => { const r = await run(name, x, ctx); if (r.error) throw Object.assign(new Error(r.error), { user: true, status: 400 }); return r; };
  const k = `${kind}:${op}`;
  if (k === 'fact:add') return go('add_fact', { ...item, kind: 'stated' });
  if (k === 'fact:update') return go('update_fact', item);
  if (k === 'fact:confirm') return go('update_fact', { id: item.id, kind: 'stated' });
  if (k === 'fact:delete') return go('delete_fact', item);
  if (k === 'person:add') return go('add_person', item);
  if (k === 'person:update') return go('update_person', item);
  if (k === 'person:delete') return store.update(pid, 'people', (d) => { d.people = d.people.filter((p) => p.id !== item.id); return { ok: true }; });
  if (k === 'chore:add') return go('add_chore', item);
  if (k === 'chore:update') return go('update_chore', item);
  if (k === 'chore:done') return go('complete_chore', item);
  if (k === 'chore:delete') return go('remove_chore', item);
  if (k === 'event:add') return go('add_event', item);
  if (k === 'event:delete') return go('remove_event', item);
  if (k === 'event:update') return go('update_event', item);
  if (k === 'goal:add') return go('add_goal', item);
  if (k === 'goal:update' || k === 'goal:note') return go('update_goal', item);
  if (k === 'goal:delete') return store.update(pid, 'goals', (d) => { d.goals = d.goals.filter((g) => g.id !== item.id); return { ok: true }; });
  if (k === 'step:add') return go('add_goal_step', item);
  if (k === 'step:done') return go('complete_goal_step', item);
  if (k === 'step:undo' || k === 'step:delete') return store.update(pid, 'goals', (d) => {
    const g = d.goals.find((x) => x.id === item.goal);
    if (g) { if (k === 'step:delete') g.steps = g.steps.filter((s) => s.id !== item.step); else { const s = g.steps.find((y) => y.id === item.step); if (s) s.done = null; } }
    return { ok: true };
  });
  if (k === 'memory:delete') return { error: 'memories are kept in a log; ask MyButler to forget instead' };
  if (kind === 'routine' || kind === 'exception' || kind === 'period') {
    const wrap = (fn) => store.update(pid, 'routines', (r) => { try { fn(r); } catch (e) { if (e.bad) throw Object.assign(new Error(e.message), { user: true, status: 400 }); throw e; } return { ok: true }; });
    if (k === 'routine:add') return wrap((r) => applyProposal(r, { action: 'add_routine', item: cleanRoutine(item) }));
    if (k === 'routine:update') return wrap((r) => applyProposal(r, { action: 'update_routine', item: { ...cleanRoutine(item), id: find(r.routines, item.id, 'routine').id } }));
    if (k === 'routine:delete') return wrap((r) => applyProposal(r, { action: 'remove_routine', item: { id: item.id } }));
    if (k === 'exception:add') return wrap((r) => applyProposal(r, { action: 'add_exception', item: cleanException(item, r.routines) }));
    if (k === 'exception:delete') return wrap((r) => applyProposal(r, { action: 'remove_exception', item: { id: item.id } }));
    if (k === 'period:add') return wrap((r) => applyProposal(r, { action: 'add_period', item: cleanPeriod(item, r.routines) }));
    if (k === 'period:delete') return wrap((r) => applyProposal(r, { action: 'remove_period', item: { id: item.id } }));
  }
  throw Object.assign(new Error('Unknown edit.'), { user: true, status: 400 });
}

// Settings from the page, checked. A new home town is looked up for its coordinates.
export async function saveSettings(pid, x) {
  try { return await settingsFrom(pid, x); } catch (e) { if (e.bad) throw Object.assign(new Error(e.message), { user: true, status: 400 }); throw e; }
}
async function settingsFrom(pid, x) {
  const next = {};
  if (has(x, 'tz')) { try { new Intl.DateTimeFormat('en', { timeZone: x.tz }); next.tz = x.tz; } catch { throw Object.assign(new Error('Unknown time zone.'), { user: true }); } }
  if (has(x, 'state')) { if (!cal.STATES[x.state]) throw Object.assign(new Error('Unknown state.'), { user: true }); next.state = x.state; }
  if (has(x, 'assumption')) next.assumption = !!x.assumption;
  if (has(x, 'radiusKm')) next.radiusKm = Math.max(5, Math.min(150, Math.round(Number(x.radiusKm) || 40)));
  if (has(x, 'home') && str(x.home, 80)) {
    const g = await sources.geocode(str(x.home, 80)).catch(() => null);
    if (!g) throw Object.assign(new Error('Couldn’t find that town.'), { user: true });
    next.home = { name: g.name, lat: g.lat, lon: g.lon };
  }
  if (has(x, 'digest')) {
    const d = x.digest || {};
    next.digest = { am: time(d.am, 'am') || '06:00', pm: time(d.pm, 'pm') || '18:00', email: d.email !== false };
  }
  return store.update(pid, 'settings', (s) => { Object.assign(s, next); return s; });
}
