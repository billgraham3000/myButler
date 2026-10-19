// Where MyButler's outside facts come from: events (Ticketmaster Discovery, once its key is set), weather
// (Open-Meteo: free, no key) and place lookup (Open-Meteo geocoding). Claude's web search runs inside chat and scan.

const TIMEOUT = 15000;
// A key counts only if it is set and resolved; an unresolved Key Vault reference stays as "@Microsoft.KeyVault(...)".
const hasKey = (name) => { const v = process.env[name]; return !!v && !v.startsWith('@Microsoft.KeyVault('); };
export const eventsOn = () => hasKey('TICKETMASTER_API_KEY');

async function getJson(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
const cache = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return value;
}

// ---------- weather ----------
const WMO = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' };
// Ten days of daily weather at home: [{ date, text, max, min, rainChance, rainMm }].
export async function weather(settings) {
  const { lat, lon } = settings.home || {}, tz = settings.tz || 'Europe/Berlin';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { days: [], note: 'No home location set.' };
  return cached(`w:${lat.toFixed(2)},${lon.toFixed(2)}`, 3600000, async () => {
    const d = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=${encodeURIComponent(tz)}&forecast_days=10`);
    const x = d.daily || {};
    return { source: 'https://open-meteo.com/', days: (x.time || []).map((date, i) => ({ date, text: WMO[x.weather_code?.[i]] || 'unknown', max: Math.round(x.temperature_2m_max?.[i]), min: Math.round(x.temperature_2m_min?.[i]), rainChance: x.precipitation_probability_max?.[i] ?? null, rainMm: x.precipitation_sum?.[i] ?? null })) };
  });
}
// A town's name to coordinates, for the home setting.
export async function geocode(name) {
  const d = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(String(name).slice(0, 80))}`);
  const r = d.results?.[0];
  return r ? { name: r.name, lat: r.latitude, lon: r.longitude, region: r.admin1 || '', country: r.country_code || '' } : null;
}

// ---------- events ----------
// Events near home from Ticketmaster Discovery: [{ id: 'tm:…', title, date, time, venue, city, kind, price, url }].
// Without the key it says so instead, and everything else keeps working.
export async function events(settings, { from, days = 14, keyword = '', size = 100 } = {}) {
  if (!eventsOn()) return { off: true, events: [], note: 'The events source is off until TICKETMASTER-API-KEY is in the key vault.' };
  const { lat, lon } = settings.home || {};
  const until = new Date(Date.parse(`${from}T00:00:00Z`) + (days + 1) * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
  const q = new URLSearchParams({ apikey: process.env.TICKETMASTER_API_KEY, latlong: `${lat},${lon}`, radius: String(Math.round(settings.radiusKm || 40)), unit: 'km',
    startDateTime: `${from}T00:00:00Z`, endDateTime: until, size: String(Math.min(200, size)), sort: 'date,asc', locale: '*' });
  if (keyword) q.set('keyword', String(keyword).slice(0, 60));
  const key = `tm:${q.toString().replace(/apikey=[^&]+/, '')}`;
  return cached(key, 3 * 3600000, async () => {
    const d = await getJson(`https://app.ticketmaster.com/discovery/v2/events.json?${q}`);
    const list = (d._embedded?.events || []).filter((e) => !/cancel|postpon/i.test(e.dates?.status?.code || '')).map((e) => {
      const v = e._embedded?.venues?.[0] || {}, c = e.classifications?.[0] || {}, p = e.priceRanges?.[0];
      return { id: `tm:${e.id}`, title: e.name, date: e.dates?.start?.localDate || '', time: (e.dates?.start?.localTime || '').slice(0, 5) || null,
        venue: v.name || '', city: v.city?.name || '', kind: [c.segment?.name, c.genre?.name].filter((x) => x && x !== 'Undefined').join(' / '),
        price: p ? `${p.min}–${p.max} ${p.currency}` : '', url: e.url };
    }).filter((e) => e.date && e.url);
    return { off: false, source: 'Ticketmaster', events: list };
  });
}
