// One hourly timer: MyButler's look and digest at about 6:00 and 18:00 on the owner's clock (once per slot, catching
// up if an hour was missed), plus cleaning up old request counters.
import { app } from '@azure/functions';
import * as store from '../lib/store.js';
import * as butler from '../butler/scan.js';

export async function tick(ctx = console) {
  const done = [];
  const cleaned = await store.cleanLimits().catch((e) => { ctx.warn?.(`limit cleanup failed: ${e.message}`); return 0; });
  if (cleaned) done.push(`removed ${cleaned} old request counters`);
  const r = await butler.timerStep((t) => ctx.warn?.(t)).catch((e) => { ctx.warn?.(`mybutler scan failed: ${e.message}`); return null; });
  if (r) done.push(`look ${r.slot}: ${r.empty ? (r.note || 'nothing worth sending') : `digest${r.emailed ? ' emailed' : ''}`}`);
  ctx.log(`MyButler tick ${done.length ? done.join(' | ') : 'nothing to do'}`);
  return done;
}

app.timer('hourly', { schedule: '0 5 * * * *', handler: async (_t, ctx) => { await tick(ctx); } });
