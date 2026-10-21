// Checks MyButler's calendar rules and the AI tools' input checks: recurrence, exceptions, periods, holidays,
// daylight saving, free time, reminders. node tools/check-mybutler.mjs
import * as cal from '../api/src/butler/calendar.js';
import * as tools from '../api/src/butler/tools.js';
import * as mstore from '../api/src/butler/store.js';

let fails = 0, passes = 0;
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) passes++; else { fails++; console.log(`FAIL ${what}\n  got  ${g}\n  want ${w}`); }
};
const titles = (day) => day.items.map((i) => i.title);

// ---------- dates and holidays ----------
eq(cal.easter(2026), '2026-04-05', 'Easter 2026');
eq(cal.easter(2027), '2027-03-28', 'Easter 2027');
eq(cal.easter(2024), '2024-03-31', 'Easter 2024');
eq(cal.weekday('2026-10-18'), 'su', '18 Oct 2026 is a Sunday');
eq(cal.mondayOf('2026-10-18'), '2026-10-12', 'Monday of that week');
const by26 = cal.holidays(2026, 'BY', { assumption: true });
eq(Object.keys(by26).length, 13, 'Munich has 13 public holidays in 2026');
eq(by26['2026-06-04'], 'Corpus Christi', 'Corpus Christi 2026');
eq(by26['2026-01-06'], 'Epiphany', 'Epiphany in Bavaria');
eq(by26['2026-08-15'], 'Assumption Day', 'Assumption Day in Munich');
eq(by26['2026-11-01'], 'All Saints’ Day', 'All Saints in Bavaria');
eq(by26['2026-10-31'], undefined, 'no Reformation Day in Bavaria');
eq(cal.holidays(2026, 'BY')['2026-08-15'], undefined, 'no Assumption Day for Bavaria by default');
eq(cal.holidays(2026, 'BE')['2026-06-04'], undefined, 'no Corpus Christi in Berlin');
eq(cal.holidays(2026, 'SN')['2026-11-18'], 'Repentance and Prayer Day', 'Buß- und Bettag 2026 in Saxony');
eq(cal.holidays(2026, 'HH')['2026-10-31'], 'Reformation Day', 'Reformation Day in Hamburg');

// ---------- daylight saving: 6:00 stays 6:00 on the wall clock ----------
eq(cal.instant('2026-07-01', '06:00'), '2026-07-01T04:00:00.000Z', '6:00 in summer is 4:00 UTC');
eq(cal.instant('2026-12-01', '06:00'), '2026-12-01T05:00:00.000Z', '6:00 in winter is 5:00 UTC');
eq(cal.instant('2026-10-25', '06:00'), '2026-10-25T05:00:00.000Z', '6:00 on the day clocks go back');
eq(cal.instant('2026-03-29', '06:00'), '2026-03-29T04:00:00.000Z', '6:00 on the day clocks go forward');
eq(cal.instant('2026-03-29', '01:30'), '2026-03-29T00:30:00.000Z', '1:30 before the change');
eq(cal.localNow('Europe/Berlin', new Date('2026-10-18T16:30:00Z')), { date: '2026-10-18', time: '18:30', minutes: 1110 }, 'local now');
eq(cal.localNow('Europe/Berlin', new Date('2026-10-18T22:30:00Z')).date, '2026-10-19', 'local date after midnight');

// ---------- recurrence ----------
const gym = { id: 'r1', title: 'Gym', rule: { freq: 'weekly', days: ['mo', 'we', 'fr'] }, start: '06:00', end: '07:00', fixed: false };
const office = { id: 'r2', title: 'Office', rule: { freq: 'weekly', days: ['tu', 'we', 'th'] }, end: '17:00', start: '09:00', fixed: true };
const mom = { id: 'r3', title: 'Call with Mom', rule: { freq: 'weekly', days: ['su'] }, start: '16:00', around: true, fixed: false, onHoliday: 'keep' };
const choir = { id: 'r4', title: 'Choir', rule: { freq: 'weekly', days: ['th'], every: 2, anchor: '2026-10-15' }, start: '19:30', end: '21:30', fixed: true };
const club = { id: 'r5', title: 'Book club', rule: { freq: 'monthly', nth: -1, weekday: 'fr' }, start: '19:00', end: '21:00', fixed: true };
const rent = { id: 'r6', title: 'Pay rent', rule: { freq: 'monthly', day: 31 }, fixed: false, onHoliday: 'keep' };
const anniv = { id: 'r7', title: 'Anniversary', rule: { freq: 'yearly', month: 11, day: 7 }, fixed: true, onHoliday: 'keep' };
const course = { id: 'r8', title: 'Italian course', rule: { freq: 'weekly', days: ['mo'] }, start: '18:00', end: '19:30', fixed: true, from: '2026-11-01', until: '2026-12-20' };
eq(cal.occursOn(gym, '2026-10-19'), true, 'gym on Monday');
eq(cal.occursOn(gym, '2026-10-20'), false, 'no gym on Tuesday');
eq(cal.occursOn(choir, '2026-10-15'), true, 'choir on anchor week');
eq(cal.occursOn(choir, '2026-10-22'), false, 'no choir the week after');
eq(cal.occursOn(choir, '2026-10-29'), true, 'choir two weeks later');
eq(cal.occursOn(choir, '2026-10-01'), true, 'choir two weeks before the anchor');
eq(cal.occursOn(club, '2026-10-30'), true, 'last Friday of October');
eq(cal.occursOn(club, '2026-10-23'), false, 'not the second-last Friday');
eq(cal.occursOn({ ...club, rule: { freq: 'monthly', nth: 1, weekday: 'sa' } }, '2026-11-07'), true, 'first Saturday of November');
eq(cal.occursOn(rent, '2026-11-30'), true, 'day 31 falls on the 30th in November');
eq(cal.occursOn(rent, '2027-02-28'), true, 'and on the 28th in February');
eq(cal.occursOn(anniv, '2027-11-07'), true, 'yearly');
eq(cal.occursOn(course, '2026-10-26'), false, 'before valid-from');
eq(cal.occursOn(course, '2026-11-02'), true, 'inside validity');
eq(cal.occursOn(course, '2026-12-21'), false, 'after valid-until');

eq(cal.describeRoutine(office), 'Office, Tuesday, Wednesday and Thursday 09:00–17:00, fixed', 'read-back of office');
eq(cal.describeRoutine(mom), 'Call with Mom, Sunday around 16:00, flexible', 'read-back of call');
eq(cal.describeRule(choir.rule), 'Thursday, every 2 weeks', 'read-back of choir');
eq(cal.describeRule(club.rule), 'the last Friday of each month', 'read-back of book club');

// ---------- the week, with exceptions, periods and holidays ----------
const data = { routines: [gym, office, mom, choir, club], exceptions: [], periods: [], events: [], settings: { tz: 'Europe/Berlin', state: 'BY' } };
let w = cal.expand(data, '2026-10-26', 7);
eq(w.map((d) => d.weekday), ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'], 'week days');
eq(titles(w[0]), ['Gym'], 'Monday');
eq(titles(w[2]), ['Gym', 'Office'], 'Wednesday sorted by time');
eq(titles(w[3]), ['Office', 'Choir'], 'Thursday with choir');
eq(titles(w[4]), ['Gym', 'Book club'], 'Friday with book club');
eq(w[0].items[0].startAt, '2026-10-26T05:00:00.000Z', 'Monday gym after the clock change');
// "No gym this week" and "office Friday instead of Thursday"
data.exceptions = [{ id: 'x1', routine: 'r1', from: '2026-10-26', until: '2026-11-01', skip: true }, { id: 'x2', routine: 'r2', from: '2026-10-29', moveTo: '2026-10-30' }];
w = cal.expand(data, '2026-10-26', 7);
eq(w.flatMap(titles).filter((t) => t === 'Gym').length, 0, 'no gym this week');
eq(titles(w[3]), ['Choir'], 'office moved off Thursday');
eq(titles(w[4]), ['Office', 'Book club'], 'office on Friday instead');
eq(w[4].items[0].moved, '2026-10-29', 'moved item remembers its usual day');
// Moved from a day outside the range into it
w = cal.expand(data, '2026-10-30', 3);
eq(titles(w[0]), ['Office', 'Book club'], 'moved item from before the range');
// All Saints' (Sunday 2026-11-01) keeps the call with Mom; office skips Corpus Christi
data.exceptions = [];
w = cal.expand(data, '2026-06-01', 7);
eq(w[3].holiday, 'Corpus Christi', 'holiday marked');
eq(titles(w[3]), [], 'office skips the holiday (and choir is in its off week)');
eq(titles(w[2]), ['Gym', 'Office'], 'the day before is normal');
eq(titles(cal.expand(data, '2026-11-01', 1)[0]), ['Call with Mom'], 'call kept on a holiday');
// Vacation pauses everything; guests pause only gym
data.periods = [{ id: 'p1', title: 'Vacation', kind: 'vacation', from: '2026-11-09', until: '2026-11-13', pauses: 'all' }, { id: 'p2', title: 'Guests', kind: 'guests', from: '2026-11-16', until: '2026-11-18', pauses: ['r1'] }];
w = cal.expand(data, '2026-11-09', 10);
eq(w.slice(0, 5).flatMap(titles), [], 'nothing during vacation');
eq(w[0].periods, ['Vacation'], 'period shown');
eq(titles(w[9]), ['Office'], 'guests pause gym only');
// One-off events join the week
data.periods = []; data.events = [{ id: 'e1', title: 'Dentist', date: '2026-10-27', start: '08:30', end: '09:15' }];
w = cal.expand(data, '2026-10-26', 7);
eq(titles(w[1]), ['Dentist', 'Office'], 'one-off sorted in');

// ---------- free time ----------
const ft = cal.freeTime(w, { between: ['08:00', '22:00'], minMinutes: 60 });
eq(ft[1].free, [{ from: '17:00', to: '22:00', minutes: 300 }], 'Tuesday free after the office');
eq(ft[0].free, [{ from: '08:00', to: '22:00', minutes: 840 }], 'flexible gym does not block');
eq(cal.freeTime(w, { includeFlexible: true, between: ['06:00', '22:00'] })[0].free[0].from, '07:00', 'flexible blocks when asked');
eq(ft[3].free, [{ from: '08:00', to: '09:00', minutes: 60 }, { from: '17:00', to: '19:30', minutes: 150 }], 'Thursday before the office and between office and choir');
eq(cal.freeWeekends(w), [{ from: '2026-10-31', until: '2026-11-01', days: 2 }], 'free weekend');
const pent = cal.expand({ routines: [], events: [], settings: { state: 'BY' } }, '2027-05-14', 4);
eq(cal.freeWeekends(pent), [{ from: '2027-05-15', until: '2027-05-17', days: 3 }], 'Whit Monday makes a long weekend');

// ---------- reminders ----------
const chores = [
  { id: 'c1', title: 'Water plants', every: { n: 1, unit: 'week' }, lastDone: '2026-10-11' },
  { id: 'c2', title: 'Car inspection', due: '2026-11-15', remindDays: 30 },
  { id: 'c3', title: 'Change filter', every: { n: 3, unit: 'month' }, lastDone: '2026-07-31' },
  { id: 'c4', title: 'Clean gutters', every: { n: 1, unit: 'year' }, lastDone: '2026-04-01' },
];
eq(cal.nextDue(chores[2]), '2026-10-31', 'three months on, clamped to month end');
eq(cal.nextDue({ every: { n: 1, unit: 'month' }, lastDone: '2026-01-31' }), '2026-02-28', 'month end to February');
eq(cal.dueChores(chores, '2026-10-18').map((c) => [c.title, c.days]), [['Water plants', 0], ['Car inspection', 28]], 'due chores');
eq(cal.dueChores(chores, '2026-10-20')[0].days, -2, 'overdue shows negative days');
const people = [{ id: 'h1', name: 'Mom', birthday: '1950-10-28' }, { id: 'h2', name: 'Tom', birthday: '01-02' }, { id: 'h3', name: 'Leap', birthday: '2000-02-29' }];
eq(cal.upcomingBirthdays(people, '2026-10-18'), [{ type: 'birthday', id: 'h1', title: 'Mom’s birthday', name: 'Mom', due: '2026-10-28', days: 10, age: 76 }], 'birthday in 10 days');
eq(cal.upcomingBirthdays(people, '2026-12-25', 10).map((b) => b.due), ['2027-01-02'], 'birthday over new year');
eq(cal.upcomingBirthdays(people, '2027-02-20', 10).map((b) => b.due), ['2027-02-28'], 'leap birthday in a normal year');

// ---------- the AI tools: input checks and proposals (in memory) ----------
mstore.useMemory();
const pid = 'owner1';
const run = (name, input, turn = 1) => tools.run(name, input, { pid, turn, now: { date: '2026-10-18', time: '10:00' } });
let r = await run('add_fact', { text: 'Does not like crowds', topic: 'taste', kind: 'stated' });
eq(r.ok, true, 'fact saved');
r = await run('add_fact', { text: 'x'.repeat(5000), kind: 'stated' });
eq((await mstore.read(pid, 'profile')).data.facts[1].text.length, 400, 'long fact cut to 400 characters');
r = await run('add_fact', { text: 'Seems to like Saturday hikes', kind: 'inferred', confidence: 3 });
eq((await mstore.read(pid, 'profile')).data.facts[2].confidence, 1, 'confidence capped at 1');
eq((await mstore.read(pid, 'profile')).data.facts[2].confirmed, false, 'inferred facts start unconfirmed');
r = await run('add_person', { name: 'Mom', relation: 'mother', birthday: '1950-10-28', interests: ['pottery', 'gardening'], phone: '+49 123', address: 'Hauptstr. 1, Augsburg' });
eq(r.ok, true, 'person saved');
eq('phone' in (await mstore.read(pid, 'people')).data.people[0], false, 'phone numbers are not kept');
eq((await mstore.read(pid, 'people')).data.people[0].address, 'Hauptstr. 1, Augsburg', 'addresses are kept');
eq((await run('set_home_address', { address: 'Leopoldstr. 5, München' })).ok, true, 'owner address saved');
eq((await mstore.read(pid, 'settings')).data.address, 'Leopoldstr. 5, München', 'owner address in settings');
await run('set_home_address', { address: '' });
eq((await mstore.read(pid, 'settings')).data.address, '', 'owner address can be removed');
r = await run('add_person', { name: 'Bad', birthday: '1950-13-45' });
eq(r.error, 'birthday must be MM-DD or YYYY-MM-DD', 'bad birthday refused');
r = await run('propose_routine', { title: 'Office', rule: { freq: 'weekly', days: ['tu', 'th'] }, end: '17:00', fixed: true });
eq(r.readback, 'Office, Tuesday and Thursday until 17:00, fixed', 'routine proposal read back in plain words');
eq((await mstore.read(pid, 'routines')).data.routines.length, 0, 'not saved before a yes');
const prop = r.proposal;
eq((await run('confirm_proposal', { id: prop }, 1)).error, 'Wait for the owner to say yes in a later message before confirming.', 'cannot confirm in the same turn');
eq((await run('confirm_proposal', { id: prop }, 2)).ok, true, 'confirmed in a later turn');
eq((await mstore.read(pid, 'routines')).data.routines.map((x) => x.title), ['Office'], 'saved after the yes');
r = await run('propose_routine', { title: 'Bad', rule: { freq: 'weekly', days: ['xx'] } });
eq(r.error, 'rule.days must list days like "mo", "tu"', 'bad days refused');
r = await run('add_chore', { title: 'Water plants', every: { n: 1, unit: 'week' }, lastDone: '2026-10-11' });
const choreId = r.id;
r = await run('complete_chore', { id: choreId });
eq((await mstore.read(pid, 'chores')).data.chores[0].lastDone, '2026-10-18', 'chore done today');
r = await run('add_event', { title: 'Dentist', date: '2026-10-27', start: '8:30' });
eq(r.error, 'start must be HH:MM', 'bad time refused');
r = await run('add_event', { title: 'Dentist', date: '2026-10-27', start: '08:30', end: '09:15' });
eq((await mstore.read(pid, 'events-2026-10')).data.events[0].title, 'Dentist', 'event stored in its month file');
const dentist = (await mstore.read(pid, 'events-2026-10')).data.events[0].id;
eq((await run('update_event', { id: dentist, date: '2026-10-27', start: '08:45', end: '09:30' })).ok, true, 'event times changed');
await run('update_event', { id: dentist, date: '2026-10-27', newDate: '2026-11-03' });
eq([(await mstore.read(pid, 'events-2026-10')).data.events.length, (await mstore.read(pid, 'events-2026-11')).data.events.map((e) => [e.id === dentist, e.date, e.start])], [0, [[true, '2026-11-03', '08:45']]], 'event moved to another month keeps its id and times');
await run('update_event', { id: dentist, date: '2026-11-03', newDate: '2026-10-27', start: '08:30', end: '09:15' });
r = await run('get_week', { from: '2026-10-26', days: 7 });
eq(r.days[1].items.map((i) => i.title), ['Office', 'Dentist'], 'get_week reads stored routines and events');
r = await run('find_free_time', { from: '2026-10-27', days: 1, minMinutes: 120 });
eq(r.days[0].free, [{ from: '17:00', to: '22:00', minutes: 300 }], 'office until 17:00 blocks the day up to then');
eq((await run('nope', {})).error, 'Unknown tool nope', 'unknown tool');

// ---------- goals and dreams ----------
r = await run('add_goal', { title: 'Ride a dressage test with Califa', why: 'to grow together', horizon: 'this-year', target: '2027-06-30', steps: [{ text: 'Book lessons with a trainer', due: '2026-10-20' }, { text: 'Learn the test' }] });
const goalId = r.id;
let goals = (await mstore.read(pid, 'goals')).data.goals;
eq([goals[0].status, goals[0].steps.length, goals[0].created], ['active', 2, '2026-10-18'], 'goal saved with steps');
eq(cal.goalReminders(goals, '2026-10-18').map((x) => [x.type, x.title, x.days]), [['step', 'Ride a dressage test with Califa: Book lessons with a trainer', 2]], 'a step due in 2 days is a reminder');
eq(cal.goalReminders(goals, '2026-11-17').map((x) => x.type), ['step', 'goal'], 'a this-year goal asks after 30 days');
eq(cal.goalReminders([{ ...goals[0], status: 'paused' }], '2026-11-17'), [], 'paused goals stay quiet');
eq(cal.goalReminders([{ ...goals[0], checkEvery: 0, steps: [] }], '2027-11-17'), [], 'checkEvery 0 never asks');
await run('complete_goal_step', { goal: goalId, step: goals[0].steps[0].id });
await run('update_goal', { id: goalId, note: 'First lesson booked for Saturday' });
goals = (await mstore.read(pid, 'goals')).data.goals;
eq([goals[0].steps[0].done, goals[0].lastCheck, goals[0].notes[0].text], ['2026-10-18', '2026-10-18', 'First lesson booked for Saturday'], 'step done and progress noted');
eq(cal.goalReminders(goals, '2026-11-16').map((x) => x.type), [], 'a note resets the check-in');
eq((await run('add_goal', { title: 'Patagonia', kind: 'dream', horizon: 'sometime' })).error, 'horizon must be one of this-month, this-year, few-years, someday', 'bad time frame refused');
await run('add_goal', { title: 'See Patagonia', kind: 'dream', horizon: 'someday' });
await run('update_goal', { id: goalId, status: 'done' });
goals = (await mstore.read(pid, 'goals')).data.goals;
eq([goals[0].status, goals[0].doneAt, goals[1].kind], ['done', '2026-10-18', 'dream'], 'goal reached; dream kept');
await tools.edit(pid, 'step', 'add', { goal: goals[1].id, text: 'Save 5,000 €' }, { date: '2026-10-18', time: '10:00' });
await tools.edit(pid, 'goal', 'update', { id: goals[0].id, status: 'active' }, { date: '2026-10-18', time: '10:00' });
goals = (await mstore.read(pid, 'goals')).data.goals;
eq([goals[1].steps[0].text, goals[0].status], ['Save 5,000 €', 'active'], 'page edits for goals and steps');

// ---------- a chat turn and a scan, with stand-ins for Claude, Ticketmaster and Open-Meteo ----------
process.env.ANTHROPIC_API_KEY = 'test'; process.env.TICKETMASTER_API_KEY = 'test'; process.env.BUTLER_MODEL = 'stand-in';
const chat = await import('../api/src/butler/chat.js');
const scan = await import('../api/src/butler/scan.js');
const sent = [], inSix = cal.addDays(cal.localNow().date, 6);
let replies = [];
globalThis.fetch = async (u, opts = {}) => {
  const url = String(u);
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  if (url.includes('api.anthropic.com')) { sent.push(JSON.parse(opts.body)); return ok(replies.shift()); }
  if (url.includes('ticketmaster.com')) return ok({ _embedded: { events: [
    { id: 'A1', name: 'Jazz im Park', url: 'https://www.ticketmaster.de/event/a1', dates: { start: { localDate: inSix, localTime: '19:30:00' } }, _embedded: { venues: [{ name: 'Muffatwerk', city: { name: 'München' } }] }, classifications: [{ segment: { name: 'Music' }, genre: { name: 'Jazz' } }] },
    { id: 'A2', name: 'Cancelled show', url: 'https://www.ticketmaster.de/event/a2', dates: { start: { localDate: '2026-10-25' }, status: { code: 'cancelled' } } }] } });
  if (url.includes('open-meteo.com')) return ok({ daily: { time: ['2026-10-18', '2026-10-19'], weather_code: [61, 0], temperature_2m_max: [12, 15], temperature_2m_min: [5, 6], precipitation_probability_max: [80, 5], precipitation_sum: [4, 0] } });
  throw new Error(`unexpected fetch ${url}`);
};
const owner = { id: pid, email: '' };
replies = [
  { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Noted.' }, { type: 'tool_use', id: 'u1', name: 'add_fact', input: { text: 'Loves jazz', topic: 'music', kind: 'stated' } },
    { type: 'tool_use', id: 'u2', name: 'propose_routine', input: { title: 'Gym', rule: { freq: 'weekly', days: ['mo', 'we', 'fr'] }, start: '06:00', end: '07:00', fixed: false } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Gym, Monday, Wednesday and Friday 06:00–07:00, flexible — right?' }] },
];
r = await chat.turn(owner, 'Ich liebe Jazz, and I go to the gym Mon/Wed/Fri 6–7.');
eq(r.reply, 'Gym, Monday, Wednesday and Friday 06:00–07:00, flexible — right?', 'chat reply is the final text');
eq(r.proposals.length, 1, 'one proposal waiting');
eq(sent[0].messages[0].content, 'Ich liebe Jazz, and I go to the gym Mon/Wed/Fri 6–7.', 'the owner\'s words are sent');
eq(/FACTS[\s\S]*Does not like crowds/.test(sent[0].system), true, 'the whole profile goes with the request');
eq(/GOALS AND DREAMS[\s\S]*Ride a dressage test with Califa \(why: to grow together\)/.test(sent[0].system), true, 'goals go with the request');
eq(sent[0].tools.some((t) => t.name === 'web_search'), true, 'web search offered');
eq(sent[1].messages.at(-1).content[0].type, 'tool_result', 'tool results go back to Claude');
replies = [
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u3', name: 'confirm_proposal', input: { id: r.proposals[0].id } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Saved.' }] },
];
sent.length = 0;
r = await chat.turn(owner, 'ja, genau');
eq((await mstore.read(pid, 'routines')).data.routines.map((x) => x.title), ['Office', 'Gym'], 'confirmed in the next message');
eq(sent[0].messages.map((m) => m.role), ['user', 'assistant', 'user'], 'today\'s conversation goes along');
eq((await mstore.read(pid, 'topics')).data.topics.map((t) => [t.title, t.count]), [['Ich liebe Jazz, and I go to the gym Mon/Wed/Fri…', 4]], 'without choose_topic: a new topic, and a quick follow-up stays in it');
eq((await mstore.lines(pid, 'topic-1')).length, 4, 'conversation saved as text in its topic');
// A reply cut off by its length limit is asked again with more room; a wordless end gets one nudge.
replies = [
  { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 'x1', name: 'add_person', input: { name: 'Half' } }] },
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x2', name: 'add_person', input: { name: 'Gwen', relation: 'daughter' } }] },
  { stop_reason: 'end_turn', content: [] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Saved Gwen.' }] },
];
sent.length = 0;
r = await chat.turn(owner, 'My daughter is Gwen.');
eq(sent[1].max_tokens > sent[0].max_tokens, true, 'cut-off reply asked again with more room');
eq((await mstore.read(pid, 'people')).data.people.map((x) => x.name), ['Mom', 'Gwen'], 'the cut-off tool call is never run');
eq([r.reply, sent[3].messages.at(-1).content.startsWith('Now answer the owner')], ['Saved Gwen.', true], 'a wordless end is nudged once');
replies = [
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x3', name: 'add_fact', input: { text: 'Rides horses', kind: 'stated' } }] },
  { stop_reason: 'end_turn', content: [] },
  { stop_reason: 'end_turn', content: [] },
];
r = await chat.turn(owner, 'I ride.');
eq(r.reply, 'I saved this:\n- fact: Rides horses', 'with no words at all, the reply says what was saved');
// ---------- topics ----------
const topicsMod = await import('../api/src/butler/topics.js');
const today = cal.localNow().date;
replies = [
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'choose_topic', input: { title: 'Apartment search', lasting: true } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Which districts?' }] },
];
sent.length = 0;
r = await chat.turn(owner, 'I am looking for a 3-room flat.');
eq(/TOPICS \(newest first\)[\s\S]*\[1\]/.test(sent[0].system) && sent[0].tools[0].name === 'choose_topic', true, 'Claude sees the topics and is offered choose_topic');
let idx = (await mstore.read(pid, 'topics')).data;
const apt = idx.topics.find((t) => t.title === 'Apartment search');
eq([r.topic, apt.lasting, apt.count], [apt.id, true, 2], 'choose_topic starts a lasting topic');
replies = [
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'choose_topic', input: { title: 'Ignored' } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Noted for the gym.' }] },
];
sent.length = 0;
r = await chat.turn(owner, 'Make it 7 instead.', { topic: 1 });
eq([r.topic, sent[0].messages[0].content.startsWith('Ich liebe Jazz'), /writing inside the topic \[1\]/.test(sent[0].system)], [1, true, true], 'a reply inside a topic carries that topic\'s history');
eq((await mstore.read(pid, 'topics')).data.topics.length, 2, 'and no new topic is made');
eq((await chat.turn(owner, 'x', { topic: 999 }).catch((e) => e.message)), 'That topic is gone.', 'unknown topic refused');
replies = [
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't3', name: 'choose_topic', input: { title: 'Weekend plans', until: cal.addDays(today, 2) } },
    { type: 'tool_use', id: 't4', name: 'update_topic', input: { id: 1, done: true } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here are ideas.' }] },
];
r = await chat.turn(owner, 'What can I do this weekend?');
idx = (await mstore.read(pid, 'topics')).data;
eq([idx.topics.find((t) => t.id === r.topic).until, idx.topics.find((t) => t.id === 1).done], [cal.addDays(today, 2), true], 'a short topic has its date; update_topic marks one done');
await topicsMod.change(pid, r.topic, { until: cal.addDays(today, -1) }, { date: today });
let tv4 = await topicsMod.view(pid, 'Europe/Berlin');
eq(tv4.map((t) => [t.title, t.active]), [['Weekend plans', false], ['Ich liebe Jazz, and I go to the gym Mon/Wed/Fri…', false], ['Apartment search', true]], 'newest first; a past short topic and a done one are older, a lasting one stays');
await topicsMod.add(pid, 1, [{ role: 'user', text: 'one more', at: new Date().toISOString() }], { date: today });
eq((await topicsMod.view(pid, 'Europe/Berlin'))[0].active, true, 'a new message brings a done topic back to the top, active');
const pid2 = 'owner2';
await mstore.append(pid2, 'talk-2026-10-01', { role: 'user', text: 'hi', at: '2026-10-01T08:00:00Z' });
await mstore.append(pid2, 'talk-2026-10-01', { role: 'assistant', text: 'hello', at: '2026-10-01T08:00:05Z' });
tv4 = await topicsMod.view(pid2, 'Europe/Berlin');
eq([tv4.length, tv4[0].title, tv4[0].active, tv4[0].messages.length], [1, 'Conversation, 2026-10-01', false, 2], 'conversations from before topics become one older topic per day');
await topicsMod.view(pid2, 'Europe/Berlin');
eq((await mstore.lines(pid2, `topic-${tv4[0].id}`)).length, 2, 'moved only once');
eq(await topicsMod.cleanup(pid2, cal.addDays('2026-10-01', 91)), 1, 'older topics are removed after 90 days');
eq((await mstore.files(pid2)).includes(`topic-${tv4[0].id}`), false, 'with their messages');

replies = [
  { stop_reason: 'tool_use', content: [
    { type: 'server_tool_use', id: 'w1', name: 'web_search', input: { query: 'Munich market' } },
    { type: 'web_search_tool_result', tool_use_id: 'w1', content: [{ type: 'web_search_result', url: 'https://www.muenchen.de/auer-dult', title: 'Auer Dult' }] },
    { type: 'tool_use', id: 'u4', name: 'submit_digest', input: { suggestions: [
      { kind: 'event', title: 'Jazz im Park', text: 'Jazz, which you love.', sourceId: 'tm:A1', date: '2026-10-30', score: 0.9 },
      { kind: 'event', title: 'Auer Dult', text: 'The autumn fair.', url: 'https://muenchen.de/auer-dult/', date: cal.addDays(cal.localNow().date, 3), score: 0.8 },
      { kind: 'event', title: 'Made-up gala', text: 'Sounds nice.', url: 'https://example.com/gala', date: cal.addDays(cal.localNow().date, 2), score: 0.95 },
      { kind: 'idea', title: 'Meh', text: 'Low score.', score: 0.3 },
      { kind: 'birthday', title: 'Pottery class for Mom', text: 'She likes pottery.', score: 0.7 }] } }] },
];
sent.length = 0;
r = await scan.scan(owner, { slot: '2026-10-18-pm' });
eq(sent.length, 1, 'scan stops once the digest is handed in');
eq(/Jazz im Park/.test(sent[0].messages[0].content) && !/Cancelled show/.test(sent[0].messages[0].content), true, 'scan sees real events, not cancelled ones');
const dg = (await mstore.read(pid, 'digest')).data;
eq(dg.suggestions.map((x) => x.title), ['Jazz im Park', 'Auer Dult', 'Pottery class for Mom'], 'invented event and low score dropped');
eq([dg.suggestions[0].date, dg.suggestions[0].time, dg.suggestions[0].url], [inSix, '19:30', 'https://www.ticketmaster.de/event/a1'], 'Ticketmaster event takes the source\'s date, time and link');
eq(dg.suggestions[1].source, 'muenchen.de', 'web event keeps its checked source');
await scan.feedback(pid, dg.suggestions[0].id, 'not', 'too late in the evening');
eq((await mstore.lines(pid, 'memories')).at(-1).text, 'Not interested: Jazz im Park (because too late in the evening)', 'feedback becomes a memory');
await scan.feedback(pid, dg.suggestions[1].id, 'later');
const tv = await scan.todayView(pid);
eq(tv.suggestions.map((x) => x.title), ['Pottery class for Mom'], 'Today: answered "not interested" and snoozed ideas leave the current list');
eq(tv.earlier.map((x) => [x.title, x.feedback?.value]).sort(), [['Auer Dult', 'later'], ['Jazz im Park', 'not']], 'they are listed under earlier ideas, with the answer');
replies = [{ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u5', name: 'submit_digest', input: { suggestions: [{ kind: 'event', title: 'Jazz im Park', text: 'Again.', sourceId: 'tm:A1', score: 0.9 }] } }] }];
r = await scan.scan(owner, { slot: '2026-10-19-am' });
eq(r.suggestions, 0, 'never suggests the same thing twice');
eq((await mstore.read(pid, 'digest')).data.suggestions.length, 3, 'an empty look keeps the last digest on screen');
replies = [{ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u6', name: 'submit_digest', input: { suggestions: [{ kind: 'idea', title: 'Walk along the Isar', text: 'Sunny Sunday.', score: 0.8 }] } }] }];
await new Promise((ok) => setTimeout(ok, 5));
r = await scan.scan(owner, { slot: '2026-10-19-pm' });
const tv2 = await scan.todayView(pid);
eq(tv2.suggestions.map((x) => [x.title, x.latest]), [['Walk along the Isar', true], ['Pottery class for Mom', false]], 'Today keeps ideas from earlier looks, newest first');
const old = (await mstore.lines(pid, `suggestions-${cal.localNow().date.slice(0, 7)}`)).find((l) => l.title === 'Pottery class for Mom');
await scan.feedback(pid, old.id, 'did');
const tv3 = await scan.todayView(pid);
eq([tv3.suggestions.map((x) => x.title), tv3.earlier.some((x) => x.title === 'Pottery class for Mom' && x.feedback.value === 'did')], [['Walk along the Isar'], true], 'an idea marked "did it" moves to earlier');
const ex = await mstore.exportAll(pid);
eq(ex['profile.json'].facts.length, 5, 'export has the profile');
eq(await mstore.deleteAll(pid) > 5, true, 'delete removes the files');
eq((await mstore.files(pid)).length, 0, 'nothing left');
sent.length = 0;
eq((await scan.scan(owner, { slot: 'x' })).note, 'nothing known yet', 'no look when nothing is known');
eq(sent.length, 0, 'and no Claude call');

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
