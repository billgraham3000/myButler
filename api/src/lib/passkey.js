// Passkeys (WebAuthn): sign in with Face ID, Touch ID or the phone's screen lock instead of a password.
// The device keeps a private key; we keep only its public key and check a signature at each sign-in.
// Only the checks this needs are implemented: challenge, origin, site, user presence and the signature (ES256, RS256).
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import * as store from './auth.js';
import { sessionFor } from './auth.js';

// The site passkeys belong to: the web app's host name, from SITE_URL unless set separately.
const SITE = process.env.SITE_URL || 'https://localhost';
const RP_ID = process.env.PASSKEY_RP_ID || new URL(SITE).hostname;
const ORIGINS = (process.env.PASSKEY_ORIGINS || new URL(SITE).origin).split(',').map((s) => s.trim());
const CHALLENGE_MINUTES = 5;
const userError = (msg, status = 400) => Object.assign(new Error(msg), { user: true, status });
const sha256 = (b) => createHash('sha256').update(b).digest();
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(String(s || ''), 'base64url');

// ---------- a minimal CBOR reader (enough for WebAuthn attestation objects and COSE keys) ----------
function cbor(buf, at = 0) {
  const head = buf[at], major = head >> 5, info = head & 31;
  let len = info, p = at + 1;
  if (info === 24) { len = buf[p]; p += 1; } else if (info === 25) { len = buf.readUInt16BE(p); p += 2; } else if (info === 26) { len = buf.readUInt32BE(p); p += 4; } else if (info === 27) { len = Number(buf.readBigUInt64BE(p)); p += 8; } else if (info > 27) throw new Error('unsupported CBOR');
  if (major === 0) return [len, p];
  if (major === 1) return [-1 - len, p];
  if (major === 2) return [buf.subarray(p, p + len), p + len];
  if (major === 3) return [buf.subarray(p, p + len).toString('utf8'), p + len];
  if (major === 4) { const a = []; for (let i = 0; i < len; i++) { const [v, q] = cbor(buf, p); a.push(v); p = q; } return [a, p]; }
  if (major === 5) { const m = new Map(); for (let i = 0; i < len; i++) { const [k, q] = cbor(buf, p); const [v, r] = cbor(buf, q); m.set(k, v); p = r; } return [m, p]; }
  if (major === 7) return [info === 20 ? false : info === 21 ? true : null, p];
  throw new Error('unsupported CBOR');
}
// authenticatorData: site hash (32), flags (1), counter (4), then for new keys the credential id and public key.
function parseAuthData(a) {
  const out = { rpIdHash: a.subarray(0, 32), flags: a[32], count: a.readUInt32BE(33) };
  if (out.flags & 0x40) {
    const idLen = a.readUInt16BE(53);
    out.credId = a.subarray(55, 55 + idLen);
    const [, end] = cbor(a, 55 + idLen);
    out.publicKey = a.subarray(55 + idLen, end);
  }
  return out;
}
function keyFromCose(coseBytes) {
  const [k] = cbor(Buffer.from(coseBytes));
  const kty = k.get(1), alg = k.get(3);
  if (kty === 2 && alg === -7) return { alg, key: createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64(k.get(-2)), y: b64(k.get(-3)) } }) };
  if (kty === 3 && alg === -257) return { alg, key: createPublicKey({ format: 'jwk', key: { kty: 'RSA', n: b64(k.get(-1)), e: b64(k.get(-2)) } }) };
  throw userError('This passkey type isn’t supported.');
}
function checkClient(clientDataJSON, type, challenge) {
  const c = JSON.parse(unb64(clientDataJSON).toString('utf8'));
  if (c.type !== type) throw userError('Passkey check failed (type).');
  if (c.challenge !== challenge) throw userError('Passkey check failed (challenge).');
  if (!ORIGINS.includes(c.origin)) throw userError('Passkey check failed (site).');
}
function checkSite(auth) {
  if (!auth.rpIdHash.equals(sha256(RP_ID))) throw userError('Passkey check failed (site).');
  if (!(auth.flags & 0x01)) throw userError('Passkey check failed (presence).');
}
async function newChallenge(playerId, kind) {
  const challenge = b64(randomBytes(32));
  await store.savePasskeyChallenge(sha256(challenge).toString('hex'), { playerId: playerId || '', kind, expires: new Date(Date.now() + CHALLENGE_MINUTES * 60000).toISOString() });
  return challenge;
}
async function useChallenge(clientDataJSON, kind) {
  const c = JSON.parse(unb64(clientDataJSON).toString('utf8'));
  const saved = c.challenge && await store.takePasskeyChallenge(sha256(c.challenge).toString('hex'));
  if (!saved || saved.kind !== kind || saved.expires < new Date().toISOString()) throw userError('This sign-in request has expired. Please try again.');
  return { challenge: c.challenge, playerId: saved.playerId };
}

// ---------- adding a passkey to a signed-in account ----------
export async function registerOptions(player) {
  const existing = await store.listPasskeys();
  return {
    challenge: await newChallenge(player.id, 'register'),
    rp: { name: 'MyButler', id: RP_ID },
    user: { id: b64(Buffer.from(player.id)), name: player.email, displayName: 'MyButler' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
    excludeCredentials: existing.map((k) => ({ type: 'public-key', id: k.credId })),
    timeout: 60000, attestation: 'none',
  };
}
export async function registerVerify(player, body = {}, label = '') {
  const r = body.response || {};
  const { challenge, playerId } = await useChallenge(r.clientDataJSON, 'register');
  if (playerId !== player.id) throw userError('This request belongs to another account.');
  checkClient(r.clientDataJSON, 'webauthn.create', challenge);
  const [att] = cbor(unb64(r.attestationObject));
  const auth = parseAuthData(Buffer.from(att.get('authData')));
  checkSite(auth);
  if (!auth.credId) throw userError('The device sent no passkey.');
  keyFromCose(auth.publicKey); // fails early for key types we can't check later
  await store.savePasskey({ credId: b64(auth.credId), playerId: player.id, publicKey: b64(auth.publicKey), count: auth.count, created: new Date().toISOString(), label: String(label || '').slice(0, 60) });
  return { ok: true };
}

// ---------- signing in with a passkey ----------
export async function loginOptions() {
  return { challenge: await newChallenge('', 'login'), rpId: RP_ID, userVerification: 'preferred', timeout: 60000 };
}
export async function loginVerify(body = {}) {
  const r = body.response || {};
  const { challenge } = await useChallenge(r.clientDataJSON, 'login');
  checkClient(r.clientDataJSON, 'webauthn.get', challenge);
  const k = await store.getPasskey(String(body.id || ''));
  if (!k) throw userError('This passkey isn’t known here. Sign in with the email link, then add Face ID again in Settings.');
  const authData = unb64(r.authenticatorData), auth = parseAuthData(authData);
  checkSite(auth);
  const { alg, key } = keyFromCose(unb64(k.publicKey));
  const signed = Buffer.concat([authData, sha256(unb64(r.clientDataJSON))]);
  const ok = alg === -7 ? verify('sha256', signed, { key, dsaEncoding: 'der' }, unb64(r.signature)) : verify('sha256', signed, key, unb64(r.signature));
  if (!ok) throw userError('Passkey check failed (signature).');
  // A counter that goes backwards can mean a copied key; synced passkeys always report 0.
  if (k.count && auth.count && auth.count <= k.count) throw userError('Passkey check failed (counter).');
  if (auth.count) await store.savePasskey({ ...k, count: auth.count });
  return sessionFor();
}
export async function listForPlayer() { return (await store.listPasskeys()).map((k) => ({ id: k.credId.slice(0, 8), label: k.label, created: k.created })); }
