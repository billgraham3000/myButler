// Signing in to MyButler: only the owner's email can get a sign-in link, and a passkey (Face ID, Touch ID, screen lock)
// can be added afterwards. Sessions, links and passkeys are small JSON files in the "auth" container, stored by hash,
// so a stolen storage listing reveals no usable token.
import { createHash, randomBytes } from 'node:crypto';
import * as store from './store.js';
import { sendMail, canSendMail } from './mail.js';
import { owner, isOwnerEmail } from './owner.js';

const LINK_MINUTES = 20, SESSION_DAYS = 180;
const C = 'auth';
const hash = (t) => createHash('sha256').update(String(t)).digest('hex');
const userError = (msg, status = 400) => Object.assign(new Error(msg), { user: true, status });
const site = () => process.env.SITE_URL || '';

// ---------- sessions ----------
export async function newSession(label = '') {
  const token = randomBytes(32).toString('base64url');
  await store.putJson(C, `sessions/${hash(token)}.json`, { created: new Date().toISOString(), expires: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), label: String(label).slice(0, 80) }, null);
  return token;
}
// The owner for a valid session token, otherwise null.
export async function ownerFromToken(token) {
  if (!token || token.length < 20) return null;
  const s = await store.getJson(C, `sessions/${hash(token)}.json`);
  if (!s || s.data.expires < new Date().toISOString()) return null;
  return owner();
}
export async function logout(token) { if (token) await store.deleteJson(C, `sessions/${hash(token)}.json`); }
export async function sessionFor() { return { token: await newSession('passkey'), player: owner() }; }

// ---------- sign-in links by email ----------
// Always answers the same way, so nobody can find out which address is the owner's.
export async function requestLink(email) {
  if (!isOwnerEmail(email)) return { ok: true };
  if (!canSendMail()) throw userError('Email isn’t set up yet.', 503);
  const token = randomBytes(32).toString('base64url');
  await store.putJson(C, `links/${hash(token)}.json`, { expires: new Date(Date.now() + LINK_MINUTES * 60000).toISOString() }, null);
  const link = `${site()}/#signin=${token}`;
  await sendMail({
    to: owner().email, subject: 'Your MyButler sign-in link',
    text: `Open this link to sign in to MyButler (it works once, for ${LINK_MINUTES} minutes):\n\n${link}\n\nIf you didn't ask for it, ignore this email.`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#221a36"><p style="font-size:20px;font-weight:bold;margin:0 0 16px">MyButler</p>
<p>Tap the button to sign in. It works once, for ${LINK_MINUTES} minutes.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#ff6a45;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Sign in to MyButler</a></p>
<p style="color:#6b6480">If you didn't ask for this, ignore this email.</p></div>`,
  });
  return { ok: true };
}
export async function redeemLink(token, label) {
  const name = `links/${hash(token)}.json`;
  const l = token && await store.getJson(C, name);
  if (!l || l.data.used || l.data.expires < new Date().toISOString()) throw userError('This sign-in link has expired or was used already. Please ask for a new one.');
  await store.putJson(C, name, { ...l.data, used: new Date().toISOString() }, l.etag); // a second use loses this race
  return { token: await newSession(label) };
}

// ---------- passkey storage (used by passkey.js) ----------
export async function savePasskeyChallenge(hashHex, c) { await store.putJson(C, `challenges/${hashHex}.json`, c, null); }
export async function takePasskeyChallenge(hashHex) {
  const name = `challenges/${hashHex}.json`, c = await store.getJson(C, name);
  if (c) await store.deleteJson(C, name);
  return c?.data || null;
}
const credName = (id) => { if (!/^[\w-]{8,700}$/.test(id)) throw userError('Unknown passkey.'); return `passkeys/${hash(id)}.json`; };
export async function savePasskey(k) {
  const name = credName(k.credId), cur = await store.getJson(C, name);
  await store.putJson(C, name, k, cur?.etag || null);
}
export async function getPasskey(credId) { try { return (await store.getJson(C, credName(credId)))?.data || null; } catch { return null; } }
export async function listPasskeys() {
  const out = [];
  for (const n of await store.listJson(C, 'passkeys/')) { const k = await store.getJson(C, n); if (k) out.push(k.data); }
  return out;
}
export async function deletePasskey(shortId) {
  for (const n of await store.listJson(C, 'passkeys/')) { const k = await store.getJson(C, n); if (k?.data.credId.startsWith(shortId)) await store.deleteJson(C, n); }
  return { ok: true };
}
