// Conversation topics (owner request 2026-10-21): every message belongs to a topic, so subjects don't intermingle and the
// newest one is on top. A topic is lasting (an apartment search) or short with a date it matters until (weekend plans);
// past that date, or marked done, it moves to "Older topics". Index in topics.json, messages in topic-<n>.jsonl.
import * as store from './store.js';
import * as cal from './calendar.js';

const MAX_TOPICS = 400, KEEP_DAYS = 90, SHORT_DAYS = 3;
const bad = (m) => Object.assign(new Error(m), { bad: true });
export const file = (id) => `topic-${id}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Active unless done, or short and past its date.
export const isActive = (t, today) => !t.done && (t.lasting || (t.until || '') >= today);

function clean(x, today, partial = false) {
  const t = {};
  if (!partial || x.title != null) { t.title = String(x.title || '').replace(/\s+/g, ' ').trim().slice(0, 60); if (!t.title) throw bad('a topic needs a title'); }
  if (x.lasting != null) t.lasting = !!x.lasting;
  if (x.until != null && x.until !== '') { if (!DATE.test(x.until)) throw bad('until must be YYYY-MM-DD'); t.until = x.until; }
  if (x.done != null) t.done = !!x.done;
  if (!partial && !t.lasting && !t.until) t.until = cal.addDays(today, SHORT_DAYS);
  return t;
}

// The day-by-day conversation from before topics becomes one short topic per day, once.
async function migrate(pid) {
  const idx = (await store.read(pid, 'topics')).data;
  if (idx.migrated) return;
  const days = (await store.files(pid)).filter((f) => /^talk-\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  const made = [];
  for (const f of days) {
    const lines = await store.lines(pid, f);
    if (!lines.length) continue;
    made.push({ date: f.slice(5), lines });
  }
  await store.update(pid, 'topics', (d) => {
    if (d.migrated) return;
    for (const m of made) {
      const id = d.next++;
      d.topics.push({ id, title: `Conversation, ${m.date}`, lasting: false, until: m.date, created: m.lines[0].at, lastAt: m.lines.at(-1).at, count: m.lines.length, old: true });
      m.id = id;
    }
    d.migrated = true;
  });
  for (const m of made) if (m.id) for (const l of m.lines) await store.append(pid, file(m.id), { ...l, topic: m.id });
}

export async function index(pid) { await migrate(pid); return (await store.read(pid, 'topics')).data; }
export const find = (idx, id) => idx.topics.find((t) => t.id === Number(id));

export async function create(pid, x, now) {
  const t = clean(x, now.date);
  return store.update(pid, 'topics', (d) => {
    if (d.topics.length >= MAX_TOPICS) d.topics = d.topics.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '')).slice(0, MAX_TOPICS - 1);
    const topic = { id: d.next++, lasting: false, ...t, created: new Date().toISOString(), lastAt: new Date().toISOString(), count: 0 };
    d.topics.push(topic);
    return topic;
  });
}
export async function change(pid, id, x, now) {
  const t = clean(x, now.date, true);
  return store.update(pid, 'topics', (d) => {
    const cur = find(d, id);
    if (!cur) throw bad(`no topic with id ${id}`);
    Object.assign(cur, t);
    if (t.lasting === false && !cur.until) cur.until = cal.addDays(now.date, SHORT_DAYS);
    if (t.done === false && !cur.lasting && (cur.until || '') < now.date) cur.until = cal.addDays(now.date, SHORT_DAYS);
    return { ok: true, topic: { ...cur } };
  });
}
// A new message in a topic: it moves to the top, and a closed or faded topic becomes active again.
export async function add(pid, id, lines, now) {
  for (const l of lines) await store.append(pid, file(id), { ...l, topic: id });
  await store.update(pid, 'topics', (d) => {
    const cur = find(d, id);
    if (!cur) return;
    cur.lastAt = new Date().toISOString(); cur.count = (cur.count || 0) + lines.length; cur.done = false;
    if (!cur.lasting && (cur.until || '') < now.date) cur.until = cal.addDays(now.date, SHORT_DAYS);
  });
}
export const messages = (pid, id) => store.lines(pid, file(id));

// For the page: topics newest first, each with its latest messages (more for active ones).
export async function view(pid, tz) {
  const now = cal.localNow(tz), idx = await index(pid);
  const sorted = [...idx.topics].sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  const out = [];
  for (const t of sorted) {
    const active = isActive(t, now.date);
    if (!active && out.filter((x) => !x.active).length >= 40) continue;
    const msgs = await messages(pid, t.id);
    out.push({ ...t, active, total: msgs.length, messages: msgs.slice(active ? -12 : -4) });
  }
  return out;
}

// For Claude: the topic list as text.
export function text(idx, today) {
  const sorted = [...idx.topics].sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  const line = (t) => `- [${t.id}] ${t.title} (${t.done ? 'done' : t.lasting ? 'lasting' : `until ${t.until}`}; last ${String(t.lastAt || '').slice(0, 10)})`;
  const act = sorted.filter((t) => isActive(t, today)).slice(0, 30), old = sorted.filter((t) => !isActive(t, today) && !t.old).slice(0, 10);
  return ['TOPICS (newest first)', ...(act.length ? act.map(line) : ['(none yet)']), ...(old.length ? ['Older topics:', ...old.map(line)] : [])].join('\n');
}

// Old topics' messages go after 90 days; open lasting topics are kept whatever their age.
export async function cleanup(pid, today) {
  const cutoff = cal.addDays(today, -KEEP_DAYS), gone = [];
  await store.update(pid, 'topics', (d) => {
    d.topics = d.topics.filter((t) => { const drop = !isActive(t, today) && String(t.lastAt || '').slice(0, 10) < cutoff; if (drop) gone.push(t.id); return !drop; });
  });
  for (const id of gone) await store.remove(pid, file(id), true);
  return gone.length;
}

export const DEFS = [
  { name: 'choose_topic', description: 'Call this first, once: which conversation topic this message belongs to. Give id for an existing topic (see TOPICS), or title for a new one. A new topic is lasting (an ongoing matter: an apartment search, a project, a goal) or short with until = the last date it matters (weekend plans: the Sunday). Use one topic per subject; a greeting or quick question can go with the newest topic.',
    input_schema: { type: 'object', properties: { id: { type: 'number' }, title: { type: 'string', description: 'short, e.g. "Apartment search", "Weekend 25–26 Oct"' }, lasting: { type: 'boolean' }, until: { type: 'string', description: 'YYYY-MM-DD' } } } },
  { name: 'update_topic', description: 'Change a topic: rename it, make it lasting or short (until a date), or mark it done when the matter is settled.',
    input_schema: { type: 'object', required: ['id'], properties: { id: { type: 'number' }, title: { type: 'string' }, lasting: { type: 'boolean' }, until: { type: 'string', description: 'YYYY-MM-DD' }, done: { type: 'boolean' } } } },
];
