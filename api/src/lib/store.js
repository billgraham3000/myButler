// All storage for MyButler: JSON and log files in blob containers, read and written by the function app's own identity.
// Edited files use version checks (ETags), so two writers can't overwrite each other.
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const account = process.env.STORAGE_ACCOUNT;
// A prefix keeps test data apart from the real data, for example TABLE_PREFIX=test.
const prefix = (process.env.TABLE_PREFIX || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
let service;
const containers = {}, ready = {};
async function container(name) {
  const full = prefix + name;
  service ||= new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
  containers[full] ||= service.getContainerClient(full);
  ready[full] ||= containers[full].createIfNotExists();
  await ready[full];
  return containers[full];
}
const conflict = () => Object.assign(new Error('conflict'), { conflict: true });

export async function getJson(c, name) {
  try {
    const r = await (await container(c)).getBlockBlobClient(name).download();
    const chunks = [];
    for await (const x of r.readableStreamBody) chunks.push(x);
    return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), etag: r.etag };
  } catch (e) { if (e.statusCode === 404) return null; throw e; }
}
// etag null means "create, and fail if it already exists". Throws an error with .conflict when someone else wrote first.
export async function putJson(c, name, data, etag) {
  const text = JSON.stringify(data);
  try {
    const r = await (await container(c)).getBlockBlobClient(name).upload(text, Buffer.byteLength(text), { conditions: etag ? { ifMatch: etag } : { ifNoneMatch: '*' }, blobHTTPHeaders: { blobContentType: 'application/json' } });
    return r.etag;
  } catch (e) { if (e.statusCode === 412 || e.statusCode === 409) throw conflict(); throw e; }
}
export async function deleteJson(c, name) {
  try { await (await container(c)).getBlobClient(name).delete(); } catch (e) { if (e.statusCode !== 404) throw e; }
}
export async function listJson(c, startsWith = '') {
  const out = [];
  for await (const b of (await container(c)).listBlobsFlat({ prefix: startsWith })) out.push(b.name);
  return out;
}
// Files that only grow (one JSON object per line) are appended in place.
export async function appendText(c, name, text) {
  const blob = (await container(c)).getAppendBlobClient(name);
  await blob.createIfNotExists({ blobHTTPHeaders: { blobContentType: 'application/x-ndjson' } });
  await blob.appendBlock(text, Buffer.byteLength(text));
}
export async function getText(c, name) {
  try { return (await (await container(c)).getBlobClient(name).downloadToBuffer()).toString('utf8'); } catch (e) { if (e.statusCode === 404) return null; throw e; }
}

// ---------- small state: timer flags and request counters ----------
const safe = (k) => String(k).replace(/[^\w.:-]/g, '_').slice(0, 200);
export async function getFlag(key) { return (await getJson('state', `flags/${safe(key)}.json`))?.data?.value ?? null; }
export async function setFlag(key, value) {
  const name = `flags/${safe(key)}.json`, cur = await getJson('state', name);
  await putJson('state', name, { value: String(value), at: new Date().toISOString() }, cur?.etag || null).catch((e) => { if (!e.conflict) throw e; });
}
// Counts a request in a time window and returns the count. Approximate by design, which is fine for abuse limits.
export async function hit(key, windowSeconds) {
  const name = `limits/${Math.floor(Date.now() / 1000 / windowSeconds)}-${windowSeconds}-${safe(key)}.json`;
  for (let i = 0; i < 4; i++) {
    const cur = await getJson('state', name);
    const count = (cur?.data?.count || 0) + 1;
    try { await putJson('state', name, { count }, cur?.etag || null); return count; } catch (e) { if (!e.conflict) throw e; }
  }
  return Infinity;
}
// Deletes request counters from windows that ended more than a day ago.
export async function cleanLimits() {
  let n = 0;
  for (const name of await listJson('state', 'limits/')) {
    const [, bucket, secs] = /^limits\/(\d+)-(\d+)-/.exec(name) || [];
    if (bucket && (Number(bucket) + 1) * Number(secs) * 1000 < Date.now() - 86400000) { await deleteJson('state', name); n++; }
  }
  return n;
}
