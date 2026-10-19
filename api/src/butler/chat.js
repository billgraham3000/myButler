// One conversation turn with MyButler: the owner's whole profile goes with every request, and the AI changes data
// only through the tools in tools.js. Also the shared pieces the scan uses: the profile as text and the tool loop.
import { claudeTools } from '../lib/claude.js';
import * as store from './store.js';
import * as cal from './calendar.js';
import * as tools from './tools.js';

// The Claude model is the app setting BUTLER_MODEL (a strong one: advice quality matters more than cost here).
const models = () => [process.env.BUTLER_MODEL];
const WEEKDAY = { mo: 'Mon', tu: 'Tue', we: 'Wed', th: 'Thu', fr: 'Fri', sa: 'Sat', su: 'Sun' };
const err = (m, status = 400) => Object.assign(new Error(m), { user: true, status });

export const webSearch = (settings, max) => ({ type: 'web_search_20250305', name: 'web_search', max_uses: max,
  user_location: { type: 'approximate', city: settings.home?.name || 'Munich', country: 'DE', timezone: settings.tz || 'Europe/Berlin' } });

// ---------- what MyButler knows, gathered for one request ----------
export async function context(pid, now) {
  const [profile, people, routines, chores, settings, goals] = await Promise.all(['profile', 'people', 'routines', 'chores', 'settings', 'goals'].map((f) => store.read(pid, f).then((x) => x.data)));
  const week = cal.expand({ ...(await tools.calendarData(pid, now.date, 14)), settings }, now.date, 14);
  const memories = (await store.lines(pid, 'memories')).slice(-60);
  const months = [now.date.slice(0, 7), cal.addDays(`${now.date.slice(0, 7)}-01`, -1).slice(0, 7)];
  const feedback = [];
  for (const m of months.reverse()) feedback.push(...(await store.lines(pid, `suggestions-${m}`)));
  return { profile, people: people.people, routines, chores: chores.chores, goals: goals.goals, settings, week, memories, log: feedback.slice(-120) };
}
// Rules, not AI: chores due, birthdays coming up, today's and tomorrow's appointments, rain on outdoor plans.
export function reminders(c, now, weather = null) {
  const out = [...cal.dueChores(c.chores, now.date), ...cal.upcomingBirthdays(c.people, now.date, 14), ...cal.goalReminders(c.goals, now.date)];
  for (const d of c.week.slice(0, 2)) for (const it of d.items) if (it.type === 'event') out.push({ type: 'event', id: it.id, title: it.title, due: d.date, days: cal.daysBetween(now.date, d.date), start: it.start });
  for (const w of weather?.days?.slice(0, 3) || []) {
    const day = c.week.find((d) => d.date === w.date);
    for (const it of day?.items || []) if (it.outdoor && (w.rainChance ?? 0) >= 60) out.push({ type: 'weather', id: it.id, title: `${it.title}: ${w.text}, ${w.rainChance}% chance of rain`, due: w.date, days: cal.daysBetween(now.date, w.date) });
  }
  return out;
}

const line = (xs) => xs.filter(Boolean).join('; ');
export function profileText(c) {
  const out = [];
  const name = (id) => c.routines.routines.find((r) => r.id === id)?.title || id;
  out.push('FACTS', ...c.profile.facts.map((f) => `- [${f.id}] ${f.kind === 'inferred' ? `inferred ${f.confidence}${f.confirmed ? '' : ', not yet confirmed'}` : 'stated'} · ${f.topic}: ${f.text}`));
  if (c.profile.summary) out.push('SUMMARY', c.profile.summary);
  out.push('PEOPLE', ...c.people.map((p) => `- [${p.id}] ${p.name}${p.relation ? ` (${p.relation})` : ''}: ${line([p.birthday && `birthday ${p.birthday}`, p.interests?.length && `interests ${p.interests.join(', ')}`, p.ideas?.length && `ideas ${p.ideas.join(', ')}`, p.notes])}`));
  out.push('ROUTINES', ...c.routines.routines.map((r) => `- [${r.id}] ${cal.describeRoutine(r)}${r.outdoor ? ', outdoor' : ''}${r.place ? `, at ${r.place}` : ''}${r.onHoliday === 'keep' ? ', also on holidays' : ''}`));
  if (c.routines.exceptions.length) out.push('EXCEPTIONS', ...c.routines.exceptions.map((x) => `- [${x.id}] ${name(x.routine)} ${x.from}${x.until ? `–${x.until}` : ''}: ${x.skip ? 'skipped' : x.moveTo ? `moved to ${x.moveTo}` : `${x.start || ''}–${x.end || ''}`}`));
  if (c.routines.periods.length) out.push('PERIODS', ...c.routines.periods.map((p) => `- [${p.id}] ${p.title} (${p.kind}) ${p.from}–${p.until}, pauses ${p.pauses === 'all' ? 'all' : p.pauses.map(name).join(', ') || 'nothing'}`));
  if (c.routines.proposals.length) out.push('PROPOSALS WAITING FOR A YES', ...c.routines.proposals.map((p) => `- [${p.id}] ${p.readback}`));
  const open = c.goals.filter((g) => g.status === 'active' || g.status === 'paused');
  if (open.length) out.push('GOALS AND DREAMS', ...open.map((g) => `- [${g.id}] ${g.kind === 'dream' ? 'dream' : 'goal'}, ${g.horizon}${g.target ? `, target ${g.target}` : ''}${g.status === 'paused' ? ', paused' : ''}: ${g.title}${g.why ? ` (why: ${g.why})` : ''}${g.steps.length ? `; steps: ${g.steps.map((s) => `[${s.id}] ${s.text}${s.done ? ` (done ${s.done})` : s.due ? ` (due ${s.due})` : ''}`).join(', ')}` : ''}${g.notes?.length ? `; latest: ${g.notes.at(-1).at} ${g.notes.at(-1).text}` : ''}; last check-in ${g.lastCheck || 'never'}`));
  const finished = c.goals.filter((g) => g.status === 'done').slice(-10);
  if (finished.length) out.push('GOALS REACHED', ...finished.map((g) => `- ${g.title} (${g.doneAt || ''})`));
  out.push('CHORES', ...c.chores.map((x) => `- [${x.id}] ${x.title}: ${line([x.every && `every ${x.every.n} ${x.every.unit}${x.every.n > 1 ? 's' : ''}`, x.lastDone && `last done ${x.lastDone}`, `next due ${cal.nextDue(x) || '?'}`, x.paused && 'paused', x.notes])}`));
  out.push('THE NEXT 14 DAYS', ...c.week.map((d) => `${d.date} ${WEEKDAY[d.weekday]}${d.holiday ? ` (holiday: ${d.holiday})` : ''}${d.periods.length ? ` (${d.periods.join(', ')})` : ''}: ${d.items.map((it) => `${it.start ? `${it.around ? '~' : ''}${it.start}${it.end ? `–${it.end}` : ''} ` : it.end ? `until ${it.end} ` : ''}${it.title} [${it.id}${it.type === 'event' ? ', one-off' : it.fixed ? ', fixed' : ', flexible'}]`).join('; ') || 'nothing planned'}`));
  if (c.memories.length) out.push('MEMORIES', ...c.memories.map((m) => `- ${m.at}: ${m.text}`));
  const fb = c.log.filter((l) => l.type === 'feedback');
  if (fb.length) {
    const title = (id) => c.log.find((l) => l.type === 'suggestion' && l.id === id)?.title || id;
    out.push('RECENT FEEDBACK ON SUGGESTIONS', ...fb.slice(-40).map((f) => `- ${f.at.slice(0, 10)} ${f.value} “${title(f.id)}”${f.note ? ` because ${f.note}` : ''}`));
  }
  return out.join('\n');
}

// ---------- the tool loop ----------
// Calls Claude until it stops asking for tools (or stop() says enough). Collects the links its web searches found.
// A reply cut off by its length limit is asked again with more room (its half-written tool calls are never run), and
// if the tools are done but no words came back, Claude is asked once to answer the owner.
const NUDGE = 'Now answer the owner in a few words (no more tools): what you saved, and anything you need them to confirm.';
export async function converse({ system, messages, tools: defs, onTool, maxTokens = 4000, rounds = 10, stop = () => false, nudge = NUDGE }) {
  const urls = new Map(), said = [];
  let final = '', model = '', stopReason = '', budget = maxTokens, nudged = false, ranTools = false;
  for (let i = 0; i < rounds; i++) {
    const res = await claudeTools({ system, messages, tools: defs, maxTokens: budget, models: models() });
    model = res.model; stopReason = res.stop_reason;
    const content = res.content || [];
    if (res.stop_reason === 'max_tokens' && budget < 16000) { budget = Math.min(16000, budget * 2); i--; continue; }
    for (const b of content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) urls.set(r.url, r.title || r.url);
      if (b.type === 'text') for (const ci of b.citations || []) if (ci.url) urls.set(ci.url, ci.title || ci.url);
    }
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    messages.push({ role: 'assistant', content });
    if (res.stop_reason === 'pause_turn') continue;
    const uses = content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      final = text;
      if (!final && ranTools && !nudged && !stop()) { nudged = true; messages.push({ role: 'user', content: nudge }); continue; }
      break;
    }
    if (text) said.push(text);
    ranTools = true;
    const results = [];
    for (const u of uses) {
      let out;
      try { out = await onTool(u.name, u.input || {}); } catch (e) { out = { error: `That didn’t work: ${String(e.message).slice(0, 200)}` }; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 40000) });
    }
    // On the last round, ask for words along with the results, so the turn doesn't end on a tool call.
    if (i === rounds - 2 && !stop()) { results.push({ type: 'text', text: nudge }); nudged = true; }
    messages.push({ role: 'user', content: results });
    if (stop()) break;
  }
  return { text: final || said.join('\n\n'), urls, model, stopReason };
}

// Conversation history as alternating user/assistant messages, starting with the owner.
function history(talk) {
  const out = [];
  for (const t of talk) {
    const role = t.role === 'assistant' ? 'assistant' : 'user';
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n\n${t.text}`;
    else out.push({ role, content: t.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (out.length && out[out.length - 1].role === 'user') out.pop();
  return out;
}

const STATE_NAMES = cal.STATES;
function system(now, settings) {
  const day = { mo: 'Monday', tu: 'Tuesday', we: 'Wednesday', th: 'Thursday', fr: 'Friday', sa: 'Saturday', su: 'Sunday' }[cal.weekday(now.date)];
  return `You are MyButler, the private personal advisor of one person, the owner. You get to know them (tastes, friends and relatives, hobbies, their normal week) and help them plan: events worth going to, birthdays, chores, free weekends, the weather.
Now: ${day} ${now.date}, ${now.time} (${settings.tz}). Home: ${settings.home?.name || 'Munich'}, ${STATE_NAMES[settings.state] || 'Bavaria'}, Germany.

How to work:
- Answer in the language the owner wrote in: German, English, or the same mix. Be brief and warm. Use short lists for several items.
- Save what you learn with the tools as you go, without making a fuss about it. Said outright → kind "stated". Your own conclusion → "inferred" with a confidence; mention it so the owner can confirm or correct it.
- Routines, exceptions and periods: call the propose_* tool, then read its readback to the owner in plain words and ask whether it is right. Only after the owner says yes in a later message call confirm_proposal. If they correct it, drop the old one (confirm_proposal with answer "no") and propose again.
- One-off appointments, and plans the owner accepts: add_event straight away.
- Goals and dreams: save them with add_goal (not add_fact), with concrete steps when the owner names them. Progress the owner mentions → update_goal with a note; a finished step → complete_goal_step. When a goal's check-in is due (see the reminders), ask how it is going, briefly. If FACTS hold goals or dreams from before the goals list existed, offer once to move them (add_goal, then delete_fact).
- People: keep only what helps the advice (relationship, birthday, interests, gift ideas). No addresses, phone numbers or emails.
- Never invent events, dates, times, prices or opening hours. Get them from search_events or web search and give the link for each. If you can't confirm a date, say so.
- Never suggest anything over a fixed plan. Flexible routines may be moved or skipped.
- Dates are YYYY-MM-DD and times HH:MM (24 h) on the owner's clock. Ids are in [brackets] below; use them with the tools.
- Your reply is shown on a phone: plain text with simple Markdown (bold, lists, links), no tables.

What you know about the owner:
`;
}

export async function turn(player, text, log = () => {}) {
  const pid = player.id, msg = String(text || '').trim().slice(0, 6000);
  if (!msg) throw err('Please type a message.');
  const settings = (await store.read(pid, 'settings')).data, now = cal.localNow(settings.tz);
  const at = Date.now(), file = `talk-${now.date}`;
  const talk = [...(await store.lines(pid, `talk-${cal.addDays(now.date, -1)}`)).slice(-8), ...(await store.lines(pid, file))].slice(-20);
  await store.append(pid, file, { role: 'user', text: msg, at: new Date(at).toISOString() });
  const c = await context(pid, now);
  const ctx = { pid, turn: at, now, changes: [], sourced: new Map() };
  const messages = [...history(talk), { role: 'user', content: msg }];
  let r;
  try {
    r = await converse({ system: system(now, settings) + profileText(c), messages, tools: [...tools.DEFS, webSearch(settings, 3)], onTool: (n, input) => tools.run(n, input, ctx) });
  } catch (e) {
    if (e.code === 'not_configured') throw err('MyButler needs the Claude key in the key vault.', 503);
    throw e;
  }
  // Without words from Claude, say what was saved rather than nothing.
  if (!r.text) log(`mybutler chat: no reply text (stop ${r.stopReason}, ${ctx.changes.length} changes)`);
  const done = ctx.changes.map((ch) => Object.entries(ch).filter(([k]) => k !== 'proposal').map(([k, v]) => `${k === 'readback' ? 'to confirm' : k}: ${v}`).join('')).filter(Boolean);
  const reply = r.text || (done.length ? `I saved this:\n${done.map((d) => `- ${d}`).join('\n')}` : 'Sorry, I couldn’t finish that. Please send it again.');
  const links = [...r.urls].slice(0, 10).map(([url, title]) => ({ url, title }));
  await store.append(pid, file, { role: 'assistant', text: reply, at: new Date().toISOString(), changes: ctx.changes, links });
  return { reply, changes: ctx.changes, links, proposals: (await store.read(pid, 'routines')).data.proposals };
}

export async function talkToday(pid, tz) {
  const now = cal.localNow(tz);
  return (await store.lines(pid, `talk-${now.date}`)).slice(-40);
}
