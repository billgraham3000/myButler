// All of MyButler's reads and writes: JSON files in the private blob container "mybutler", one folder per player.
// Edited files use version checks and retry; logs (memories, suggestions, talk) are appended. A later move to
// tables or a database changes only this file. useMemory() swaps in an in-memory copy for tests.
import * as base from '../lib/store.js';

const C = 'mybutler';
export const DEFAULT_SETTINGS = {
  tz: 'Europe/Berlin', state: 'BY', assumption: true,
  home: { name: 'Munich', lat: 48.137, lon: 11.575 }, radiusKm: 40,
  digest: { am: '06:00', pm: '18:00', email: true },
};
const FALLBACK = {
  profile: () => ({ facts: [], summary: '' }),
  people: () => ({ people: [] }),
  routines: () => ({ routines: [], exceptions: [], periods: [], proposals: [] }),
  chores: () => ({ chores: [] }),
  goals: () => ({ goals: [] }),
  settings: () => structuredClone(DEFAULT_SETTINGS),
  digest: () => ({}),
};
const fallback = (file) => (FALLBACK[file] || (/^events-\d{4}-\d{2}$/.test(file) ? () => ({ events: [] }) : () => ({})))();

let backend = {
  getJson: (n) => base.getJson(C, n), putJson: (n, d, e) => base.putJson(C, n, d, e), deleteJson: (n) => base.deleteJson(C, n),
  listJson: (p) => base.listJson(C, p), appendText: (n, t) => base.appendText(C, n, t), getText: (n) => base.getText(C, n),
};
export function useMemory() {
  const files = new Map();
  let v = 0;
  const conflict = () => { const c = new Error('conflict'); c.conflict = true; return c; };
  backend = {
    getJson: async (n) => (files.has(n) ? { data: JSON.parse(files.get(n).text), etag: files.get(n).etag } : null),
    putJson: async (n, d, etag) => {
      const cur = files.get(n);
      if (etag ? cur?.etag !== etag : cur) throw conflict();
      const e = `v${++v}`; files.set(n, { text: JSON.stringify(d), etag: e }); return e;
    },
    deleteJson: async (n) => { files.delete(n); },
    listJson: async (p) => [...files.keys()].filter((k) => k.startsWith(p)).sort(),
    appendText: async (n, t) => { const cur = files.get(n); files.set(n, { text: (cur?.text || '') + t, etag: `v${++v}` }); },
    getText: async (n) => files.get(n)?.text ?? null,
  };
  return files;
}

const folder = (pid) => { if (!/^[\w-]{4,80}$/.test(pid || '')) throw new Error('bad player id'); return `${pid}/`; };
const jsonName = (pid, file) => { if (!/^[a-z]+(-[\d-]+)?$/.test(file)) throw new Error(`bad file ${file}`); return `${folder(pid)}${file}.json`; };
const logName = (pid, file) => { if (!/^[a-z]+(-[\d-]+)?$/.test(file)) throw new Error(`bad log ${file}`); return `${folder(pid)}${file}.jsonl`; };

// { data, etag }; data is the empty default when the file doesn't exist yet (etag null).
export async function read(pid, file) {
  const got = await backend.getJson(jsonName(pid, file));
  return got ? { data: { ...fallback(file), ...got.data }, etag: got.etag } : { data: fallback(file), etag: null };
}
// Reads, lets fn change the data (and return a result), writes back. If someone else wrote in between, starts again.
export async function update(pid, file, fn) {
  for (let tries = 0; ; tries++) {
    const { data, etag } = await read(pid, file);
    const result = await fn(data);
    try { await backend.putJson(jsonName(pid, file), data, etag); return result; } catch (e) { if (!e.conflict || tries >= 5) throw e; }
  }
}
export async function append(pid, file, obj) { await backend.appendText(logName(pid, file), JSON.stringify(obj) + '\n'); }
export async function lines(pid, file) {
  const text = await backend.getText(logName(pid, file));
  return (text || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
// Names of the player's files, without folder or extension, e.g. "profile", "talk-2026-10-18".
export async function files(pid) { return (await backend.listJson(folder(pid))).map((n) => n.slice(folder(pid).length).replace(/\.jsonl?$/, '')); }

// One-off events for the months a date range touches.
export async function eventsBetween(pid, from, until) {
  const months = new Set();
  for (let d = from; d <= until; d = nextMonth(d)) months.add(d.slice(0, 7));
  months.add(until.slice(0, 7));
  const out = [];
  for (const m of months) out.push(...(await read(pid, `events-${m}`)).data.events.filter((e) => e.date >= from && e.date <= until));
  return out.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
}
const nextMonth = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };

// Conversation files older than 90 days are deleted.
export async function cleanTalk(pid, today) {
  const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - 90 * 86400000).toISOString().slice(0, 10);
  let n = 0;
  for (const f of await files(pid)) if (/^talk-\d{4}-\d{2}-\d{2}$/.test(f) && f.slice(5) < cutoff) { await backend.deleteJson(logName(pid, f)); n++; }
  return n;
}

// Everything, for the export button.
export async function exportAll(pid) {
  const out = {};
  for (const name of await backend.listJson(folder(pid))) {
    const short = name.slice(folder(pid).length);
    out[short] = name.endsWith('.jsonl') ? await lines(pid, short.replace(/\.jsonl$/, '')) : (await backend.getJson(name))?.data ?? null;
  }
  return out;
}
// Deletes every file. Blob soft delete on the container still allows a restore from the Azure portal for a while.
export async function deleteAll(pid) {
  const names = await backend.listJson(folder(pid));
  for (const n of names) await backend.deleteJson(n);
  return names.length;
}
