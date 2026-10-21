// HTTP endpoints for MyButler. Everything except signing in needs the owner's session (header x-session).
import { app } from '@azure/functions';
import { createHash } from 'node:crypto';
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import * as passkey from '../lib/passkey.js';
import { canSendMail } from '../lib/mail.js';
import { hasKey } from '../lib/claude.js';
import * as butlerStore from '../butler/store.js';
import * as butlerTools from '../butler/tools.js';
import * as butlerChat from '../butler/chat.js';
import * as butlerTopics from '../butler/topics.js';
import * as butlerScan from '../butler/scan.js';
import * as butlerSources from '../butler/sources.js';
import { localNow } from '../butler/calendar.js';

const json = (status, body) => ({ status, jsonBody: body, headers: { 'cache-control': 'no-store' } });

// Request limits: [kind, max requests, window in seconds]. "ip" counts per (hashed) address, "all" across everyone.
const LIMITS = {
  'auth/link': [['ip', 5, 3600], ['all', 20, 86400]],
  'auth/redeem': [['ip', 20, 3600]],
  'auth/passkey-login-options': [['ip', 60, 3600]],
  'auth/passkey-login': [['ip', 30, 600]],
  chat: [['all', 120, 3600], ['all', 400, 86400]],
  scan: [['all', 6, 3600], ['all', 20, 86400]],
  settings: [['all', 60, 3600]],
  export: [['all', 20, 3600]],
  'delete-all': [['all', 5, 3600]],
};
const DEFAULT_LIMIT = [['ip', 600, 3600]];
// Azure appends the real client address as the last entry of X-Forwarded-For. Earlier entries can be faked.
function clientIp(req) {
  const parts = (req.headers.get('x-forwarded-for') || '').split(',').map((x) => x.trim()).filter(Boolean);
  return (parts[parts.length - 1] || 'unknown').replace(/:\d+$/, '');
}
async function overLimit(name, req) {
  for (const [kind, max, secs] of LIMITS[name] || DEFAULT_LIMIT) {
    // Addresses are kept only as a keyed hash.
    const id = kind === 'all' ? 'all' : createHash('sha256').update(`${process.env.STORAGE_ACCOUNT || ''}:${clientIp(req)}`).digest('hex').slice(0, 32);
    if (await store.hit(`${name}:${kind}:${id}`, secs) > max) return secs;
  }
  return 0;
}

// Wraps a handler with the session check, limits and error handling. Expected problems return their message.
function route(name, methods, handler, { open = false } = {}) {
  app.http(name.replace(/[^A-Za-z0-9_-]/g, '_'), {
    methods, authLevel: 'anonymous', route: name,
    handler: async (req, ctx) => {
      try {
        const token = req.headers.get('x-session');
        const owner = open ? null : await auth.ownerFromToken(token);
        if (!open && !owner) return json(401, { error: 'Please sign in.' });
        const wait = await overLimit(name, req).catch((e) => { ctx.warn(`limit check failed: ${e.message}`); return 0; });
        if (wait) return { status: 429, jsonBody: { error: 'Too many requests. Please wait a little and try again.' }, headers: { 'retry-after': String(Math.min(wait, 3600)) } };
        const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
        let settings = null, now = null;
        if (owner) { settings = (await butlerStore.read(owner.id, 'settings')).data; now = localNow(settings.tz); }
        return await handler({ req, ctx, owner, token, body, settings, now, q: (k) => req.query.get(k) });
      } catch (e) {
        if (e.user) return json(e.status || 400, { error: e.message });
        if (e.bad) return json(400, { error: e.message });
        ctx.error(e);
        return json(500, { error: 'Something went wrong on our side. Please try again.' });
      }
    },
  });
}

// ---------- signing in ----------
route('auth/link', ['POST'], async ({ body }) => json(200, await auth.requestLink(body.email)), { open: true });
route('auth/redeem', ['POST'], async ({ body, req }) => json(200, await auth.redeemLink(String(body.token || ''), (req.headers.get('user-agent') || '').replace(/\(.*?\)/g, '').slice(0, 60))), { open: true });
route('auth/logout', ['POST'], async ({ token }) => { await auth.logout(token); return json(200, { ok: true }); });
route('auth/passkey-login-options', ['POST'], async () => json(200, await passkey.loginOptions()), { open: true });
route('auth/passkey-login', ['POST'], async ({ body }) => { const { token } = await passkey.loginVerify(body); return json(200, { token }); }, { open: true });
route('auth/passkey-register-options', ['POST'], async ({ owner }) => json(200, await passkey.registerOptions(owner)));
route('auth/passkey-register', ['POST'], async ({ owner, body, req }) => json(200, await passkey.registerVerify(owner, body, (req.headers.get('user-agent') || '').replace(/\(.*?\)/g, '').slice(0, 60))));
route('auth/passkeys', ['GET'], async () => json(200, await passkey.listForPlayer()));
route('auth/passkey-delete', ['POST'], async ({ body }) => json(200, await auth.deletePasskey(String(body.id || ''))));

// ---------- MyButler ----------
route('state', ['GET'], async ({ owner, settings }) => {
  const pid = owner.id;
  const [profile, people, routines, chores, goals, today, talk] = await Promise.all([
    butlerStore.read(pid, 'profile'), butlerStore.read(pid, 'people'), butlerStore.read(pid, 'routines'), butlerStore.read(pid, 'chores'), butlerStore.read(pid, 'goals'),
    butlerScan.todayView(pid), butlerTopics.view(pid, settings.tz)]);
  const memories = (await butlerStore.lines(pid, 'memories')).slice(-200);
  return json(200, { settings, profile: profile.data, people: people.data.people, routines: routines.data, chores: chores.data.chores, goals: goals.data.goals, memories, today, topics: talk,
    sources: { claude: hasKey(), events: butlerSources.eventsOn(), email: canSendMail() } });
});
route('week', ['GET'], async ({ owner, q, now }) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q('from') || '') ? q('from') : now.date;
  return json(200, { from, days: await butlerTools.week(owner.id, from, Math.max(1, Math.min(42, Number(q('days')) || 7))) });
});
route('chat', ['POST'], async ({ owner, body, ctx }) => json(200, await butlerChat.turn(owner, body.text, { topic: body.topic, log: (t) => ctx.warn(t) })));
route('topic', ['GET'], async ({ owner, q }) => {
  const t = butlerTopics.find(await butlerTopics.index(owner.id), q('id'));
  if (!t) return json(404, { error: 'That topic is gone.' });
  return json(200, { topic: t, messages: (await butlerTopics.messages(owner.id, t.id)).slice(-200) });
});
route('topic-edit', ['POST'], async ({ owner, body, now }) => json(200, await butlerTopics.change(owner.id, body.id, { title: body.title, lasting: body.lasting, until: body.until, done: body.done }, now)));
// A look on demand shows in the app; it emails only when asked to.
route('scan', ['POST'], async ({ owner, ctx, body }) => json(200, await butlerScan.scan(owner, { log: (t) => ctx.warn(t), email: body.email === true })));
route('confirm', ['POST'], async ({ owner, body }) => json(200, await butlerTools.decide(owner.id, String(body.id || ''), body.yes === true)));
route('feedback', ['POST'], async ({ owner, body }) => json(200, await butlerScan.feedback(owner.id, String(body.id || ''), String(body.value || ''), body.note)));
route('edit', ['POST'], async ({ owner, body, now }) => json(200, await butlerTools.edit(owner.id, String(body.kind || ''), String(body.op || ''), body.item && typeof body.item === 'object' ? body.item : {}, now)));
route('settings', ['POST'], async ({ owner, body }) => json(200, await butlerTools.saveSettings(owner.id, body || {})));
route('export', ['GET'], async ({ owner, now }) => ({ status: 200, jsonBody: { exported: new Date().toISOString(), files: await butlerStore.exportAll(owner.id) }, headers: { 'cache-control': 'no-store', 'content-disposition': `attachment; filename="mybutler-${now.date}.json"` } }));
route('delete-all', ['POST'], async ({ owner, body }) => {
  if (body.confirm !== 'DELETE') return json(400, { error: 'Type DELETE to confirm.' });
  return json(200, { deleted: await butlerStore.deleteAll(owner.id) });
});

route('health', ['GET'], async () => json(200, { ok: true, claude: hasKey(), email: canSendMail(), events: butlerSources.eventsOn() }), { open: true });
