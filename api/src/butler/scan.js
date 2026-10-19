// The twice-daily look (about 6:00 and 18:00 on the owner's clock, and whenever asked): reminders from plain rules,
// events and weather from real sources, and Claude to pick and word what is worth the owner's time. Only real,
// linked events pass; nothing that passes the bar means no digest, which is normal. Plus feedback and the Today view.
import { randomBytes } from 'node:crypto';
import * as base from '../lib/store.js';
import { sendMail, canSendMail } from '../lib/mail.js';
import { owner } from '../lib/owner.js';
import * as store from './store.js';
import * as cal from './calendar.js';
import * as sources from './sources.js';
import { context, reminders, profileText, converse, webSearch } from './chat.js';

const BAR = 0.6, MAX = 6;
const KINDS = ['event', 'birthday', 'chore', 'trip', 'weather', 'idea', 'goal'];
const FEEDBACK = ['up', 'down', 'not', 'later', 'did'];
const err = (m, status = 400) => Object.assign(new Error(m), { user: true, status });
const site = () => process.env.SITE_URL || '';
const norm = (u) => { try { const x = new URL(u); return `${x.host.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`; } catch { return ''; } };
const month = (d) => d.slice(0, 7);
const prevMonth = (d) => cal.addDays(`${month(d)}-01`, -1).slice(0, 7);

async function log(pid, date) {
  return [...(await store.lines(pid, `suggestions-${prevMonth(date)}`)), ...(await store.lines(pid, `suggestions-${month(date)}`))];
}
const remKey = (r) => `${r.type}:${r.id}:${r.due}`;

const SUBMIT = {
  name: 'submit_digest',
  description: 'Hand in the digest: only suggestions really worth the owner\'s time. An empty list is fine.',
  input_schema: { type: 'object', required: ['suggestions'], properties: {
    suggestions: { type: 'array', items: { type: 'object', required: ['kind', 'title', 'text', 'score'], properties: {
      kind: { type: 'string', enum: KINDS }, title: { type: 'string' }, text: { type: 'string', description: 'one to three sentences, why it fits and when' },
      date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM' }, url: { type: 'string', description: 'the real source page' },
      sourceId: { type: 'string', description: 'tm:… id for Ticketmaster events' }, score: { type: 'number', description: '0–1: how sure you are the owner would want this' },
      why: { type: 'string', description: 'which facts or feedback this is based on' },
    } } },
  } },
};

function scanSystem(now, settings) {
  return `You are MyButler, the private personal advisor of one person, the owner, doing your ${now.minutes < 12 * 60 ? 'morning' : 'evening'} look for things worth their time in the next two weeks (today is ${now.date}, ${now.time}, ${settings.tz}; home ${settings.home?.name || 'Munich'}).
Look at the events list, the weather and the free time below, and use web search for local things the list misses (markets, festivals, exhibitions, talks, outdoor ideas, things for the people they care about). Then call submit_digest once.
Rules:
- Only what really fits this owner, judged by their facts, memories and feedback. Things they said no to, or that look like those, stay out. Two or three good ones beat six so-so ones; none is fine.
- Never invent anything. Every event needs its real page as url (a Ticketmaster event: its sourceId) and a date you saw on that page. Nothing on top of a fixed plan.
- Goals and dreams: now and then, something that moves an active goal forward (a course, an event, a free stretch for its next step), kind "goal", naming the goal.
- Birthdays coming up: a gift or plan idea that fits that person's interests (kind "birthday"). A free weekend: a short trip idea only if it suits them (kind "trip").
- Don't repeat what was already suggested (listed below).
- Write title and text in the language the owner mostly uses with you (English if unsure). Keep each text short.

What you know about the owner:
`;
}

// Checks the AI's picks against the real sources and the past, and keeps those above the bar.
function vet(picks, { now, sourced, webUrls, past }) {
  const pastKeys = new Set();
  for (const l of past) if (l.type === 'suggestion') { if (l.url) pastKeys.add(norm(l.url)); if (l.sourceId) pastKeys.add(l.sourceId); pastKeys.add(l.title.toLowerCase()); }
  const known = new Set([...webUrls].map(norm));
  const out = [];
  for (const p of Array.isArray(picks) ? picks : []) {
    if (!p || !KINDS.includes(p.kind)) continue;
    const s = { kind: p.kind, title: String(p.title || '').trim().slice(0, 120), text: String(p.text || '').trim().slice(0, 600), score: Math.max(0, Math.min(1, Number(p.score) || 0)), why: String(p.why || '').slice(0, 300) };
    if (!s.title || !s.text || s.score < BAR) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) s.date = p.date;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time || '')) s.time = p.time;
    const tm = p.sourceId && sourced.get(p.sourceId);
    if (tm) Object.assign(s, { sourceId: tm.id, url: tm.url, date: tm.date, time: tm.time || s.time || undefined, source: 'Ticketmaster' });
    else if (p.url && known.has(norm(p.url))) Object.assign(s, { url: new URL(p.url).href, source: new URL(p.url).host.replace(/^www\./, '') });
    if (s.kind === 'event') {
      // An event must come from a real source, on a real date in the next month.
      if (!s.url || !s.date || s.date < now.date || s.date > cal.addDays(now.date, 31)) continue;
    }
    if (pastKeys.has(s.title.toLowerCase()) || (s.url && pastKeys.has(norm(s.url))) || (s.sourceId && pastKeys.has(s.sourceId))) continue;
    pastKeys.add(s.title.toLowerCase()); if (s.url) pastKeys.add(norm(s.url));
    out.push(s);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX);
}

export async function scan(player, { slot = null, log: say = () => {}, email = true } = {}) {
  const pid = player.id;
  const settings = (await store.read(pid, 'settings')).data, now = cal.localNow(settings.tz);
  slot ||= `now-${new Date().toISOString().slice(0, 16)}`;
  const c = await context(pid, now);
  // Nothing known yet (a fresh start, or after Delete everything): nothing to look for, and no cost.
  if (!c.profile.facts.length && !c.people.length && !c.routines.routines.length && !c.chores.length && !c.goals.length) return { slot, suggestions: 0, reminders: 0, emailed: false, empty: true, note: 'nothing known yet' };
  const weather = await sources.weather(settings).catch((e) => { say(`mybutler weather: ${e.message}`); return { days: [] }; });
  const ev = await sources.events(settings, { from: now.date, days: 14 }).catch((e) => { say(`mybutler events: ${e.message}`); return { off: false, events: [], note: 'The events source failed this time.' }; });
  const sourced = new Map(ev.events.map((e) => [e.id, e]));
  const rem = reminders(c, now, weather);
  const past = (await log(pid, now.date)).filter((l) => l.at >= cal.addDays(now.date, -45));
  const free = cal.freeTime(c.week, { minMinutes: 120 }), weekends = cal.freeWeekends(c.week);

  const brief = [
    'EVENTS NEAR HOME (Ticketmaster)', ev.off ? `(${ev.note} Use web search for events.)` : ev.events.slice(0, 80).map((e) => `- ${e.id} | ${e.date} ${e.time || ''} | ${e.title} | ${[e.venue, e.city].filter(Boolean).join(', ')} | ${e.kind} ${e.price}`).join('\n') || '(none found)',
    'WEATHER', weather.days.map((w) => `- ${w.date}: ${w.text}, ${w.min}–${w.max} °C, rain ${w.rainChance ?? '?'}%`).join('\n') || '(unavailable)',
    'FREE TIME (2 h or more, fixed plans only)', free.map((d) => `- ${d.date} ${d.weekday}${d.holiday ? ` (${d.holiday})` : ''}: ${d.free.map((f) => `${f.from}–${f.to}`).join(', ') || 'none'}`).join('\n'),
    'FREE WEEKENDS', weekends.map((w) => `- ${w.from} to ${w.until} (${w.days} days)`).join('\n') || '(none)',
    'REMINDERS ALREADY SENT BY RULES', rem.map((r) => `- ${r.title} (${r.due})`).join('\n') || '(none)',
    'ALREADY SUGGESTED (do not repeat)', past.filter((l) => l.type === 'suggestion').slice(-60).map((l) => `- ${l.title}`).join('\n') || '(nothing yet)',
  ].join('\n');

  let picks = null;
  const r = await converse({
    system: scanSystem(now, settings) + profileText(c), messages: [{ role: 'user', content: brief }], maxTokens: 4000, rounds: 6, nudge: 'Call submit_digest now with what you have (an empty list is fine).',
    tools: [SUBMIT, webSearch(settings, 5)],
    onTool: async (name, input) => { if (name !== 'submit_digest') return { error: 'Only submit_digest and web search are available here.' }; picks = input.suggestions; return { ok: true }; },
    stop: () => picks !== null,
  });
  const suggestions = vet(picks, { now, sourced, webUrls: r.urls.keys(), past }).map((s) => ({ id: `s${randomBytes(4).toString('hex')}`, ...s }));

  // Reminders go in the email only when new since the last digest, or due today in the morning.
  const prev = (await store.read(pid, 'digest')).data;
  const before = new Set(prev.reminderKeys || []);
  const mailRem = rem.filter((x) => !before.has(remKey(x)) || (x.days <= 0 && now.minutes < 12 * 60));
  const at = new Date().toISOString();
  for (const s of suggestions) await store.append(pid, `suggestions-${month(now.date)}`, { type: 'suggestion', slot, at, ...s });
  const digest = { slot, at, date: now.date, suggestions, reminders: rem, reminderKeys: rem.map(remKey), empty: !suggestions.length && !mailRem.length, events: ev.off ? 'off' : 'on', model: r.model };
  if (!suggestions.length) { digest.suggestions = prev.suggestions || []; digest.keptFrom = prev.slot || null; }
  let emailed = false;
  if (email && settings.digest?.email !== false && !digest.empty && player.email && canSendMail()) {
    await sendMail({ to: player.email, ...mail(suggestions, mailRem, now) }).then(() => { emailed = true; }, (e) => say(`mybutler mail: ${e.message}`));
  }
  digest.emailed = emailed;
  await store.update(pid, 'digest', (d) => { Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, digest); });
  return { slot, suggestions: suggestions.length, reminders: mailRem.length, emailed, empty: digest.empty };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const ICON = { event: '🎟️', birthday: '🎂', chore: '🧹', trip: '🧳', weather: '🌦️', idea: '💡', goal: '🎯', step: '🎯' };
function when(s) { return [s.date, s.time].filter(Boolean).join(' '); }
function mail(suggestions, rem, now) {
  const link = `${site()}/`;
  const subject = `MyButler: ${[suggestions.length && `${suggestions.length} idea${suggestions.length > 1 ? 's' : ''}`, rem.length && `${rem.length} reminder${rem.length > 1 ? 's' : ''}`].filter(Boolean).join(', ')}`;
  const text = [
    ...(rem.length ? ['Reminders:', ...rem.map((x) => `- ${x.title} (${x.days < 0 ? `${-x.days} days overdue` : x.days === 0 ? 'today' : `in ${x.days} days`})`), ''] : []),
    ...suggestions.flatMap((s) => [`${ICON[s.kind] || '•'} ${s.title}${when(s) ? ` — ${when(s)}` : ''}`, s.text, ...(s.url ? [s.url] : []), '']),
    `Feedback and more: ${link}`,
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#221a36">
<p style="font-size:20px;font-weight:bold;margin:0 0 4px">MyButler</p><p style="color:#6b6480;margin:0 0 18px">${esc(now.date)}, ${now.minutes < 720 ? 'morning' : 'evening'}</p>
${rem.length ? `<p style="font-weight:bold;margin:0 0 6px">Reminders</p><ul style="margin:0 0 18px;padding-left:20px">${rem.map((x) => `<li>${esc(x.title)} <span style="color:#6b6480">(${x.days < 0 ? `${-x.days} days overdue` : x.days === 0 ? 'today' : `in ${x.days} days`})</span></li>`).join('')}</ul>` : ''}
${suggestions.map((s) => `<div style="border:1px solid #e4def0;border-radius:12px;padding:12px 14px;margin:0 0 10px"><p style="margin:0 0 4px;font-weight:bold">${ICON[s.kind] || ''} ${esc(s.title)}</p>${when(s) ? `<p style="margin:0 0 4px;color:#6b6480">${esc(when(s))}</p>` : ''}<p style="margin:0">${esc(s.text)}</p>${s.url ? `<p style="margin:6px 0 0"><a href="${esc(s.url)}">${esc(s.source || 'Source')}</a></p>` : ''}</div>`).join('')}
<p style="margin:22px 0"><a href="${link}" style="background:#ff6a45;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Open MyButler</a></p></div>`;
  return { subject, text, html };
}

// ---------- feedback ----------
export async function feedback(pid, id, value, note) {
  if (!FEEDBACK.includes(value)) throw err('Unknown feedback.');
  const settings = (await store.read(pid, 'settings')).data, now = cal.localNow(settings.tz);
  const s = (await log(pid, now.date)).find((l) => l.type === 'suggestion' && l.id === id);
  if (!s) throw err('That suggestion is gone.', 404);
  const line = { type: 'feedback', id, value, at: new Date().toISOString() };
  const why = String(note || '').trim().slice(0, 300);
  if (why) line.note = why;
  if (value === 'later') line.until = cal.addDays(now.date, 2);
  await store.append(pid, `suggestions-${month(now.date)}`, line);
  if (value === 'not') await store.append(pid, 'memories', { text: `Not interested: ${s.title}${why ? ` (because ${why})` : ''}`, at: now.date, source: 'feedback' });
  if (value === 'did') await store.append(pid, 'memories', { text: `Did: ${s.title}${why ? ` (${why})` : ''}`, at: now.date, source: 'feedback' });
  return { ok: true };
}

// ---------- the Today screen ----------
export async function todayView(pid) {
  const settings = (await store.read(pid, 'settings')).data, now = cal.localNow(settings.tz);
  const [digest, lines, c, weather] = await Promise.all([store.read(pid, 'digest').then((x) => x.data), log(pid, now.date), context(pid, now), sources.weather(settings).catch(() => ({ days: [] }))]);
  const last = {};
  for (const l of lines) if (l.type === 'feedback') last[l.id] = l;
  const shown = new Set((digest.suggestions || []).map((s) => s.id));
  // "Remind me later" brings a suggestion back once its day comes.
  const back = lines.filter((l) => l.type === 'suggestion' && !shown.has(l.id) && last[l.id]?.value === 'later' && last[l.id].until <= now.date);
  const list = [...(digest.suggestions || []), ...back].map((s) => ({ ...s, feedback: last[s.id] ? { value: last[s.id].value, note: last[s.id].note || '', until: last[s.id].until || '' } : null }))
    .filter((s) => !(s.feedback?.value === 'later' && s.feedback.until > now.date));
  return { now, digest: { slot: digest.slot || null, at: digest.at || null, emailed: !!digest.emailed, keptFrom: digest.keptFrom || null }, suggestions: list, reminders: reminders(c, now, weather), weather: weather.days.slice(0, 3), today: c.week[0] };
}

// ---------- the timer step ----------
// Runs the newest slot that is due (6:00 and 18:00 by default, owner's clock) once. A missed slot is caught up an hour
// later; one that keeps failing is given up after three tries, so a broken key can't run up costs all day.
export async function timerStep(say = () => {}) {
  const p = owner();
  if (!p.email) return null;
  const settings = (await store.read(p.id, 'settings')).data, now = cal.localNow(settings.tz);
  const am = cal.toMin(settings.digest?.am || '06:00'), pm = cal.toMin(settings.digest?.pm || '18:00');
  const date = now.minutes >= am ? now.date : cal.addDays(now.date, -1), which = now.minutes >= pm || now.minutes < am ? 'pm' : 'am';
  const key = `mybutler:${date}-${which}`;
  if (await base.getFlag(key)) return null;
  try {
    const r = await scan(p, { slot: `${date}-${which}`, log: say });
    await base.setFlag(key, new Date().toISOString());
    if (which === 'pm') { const n = await store.cleanTalk(p.id, now.date); if (n) r.removedTalk = n; }
    return r;
  } catch (e) {
    const tries = Number(await base.getFlag(`${key}:tries`) || 0) + 1;
    await base.setFlag(`${key}:tries`, tries);
    if (tries >= 3) await base.setFlag(key, `gave up: ${String(e.message).slice(0, 200)}`);
    throw e;
  }
}
