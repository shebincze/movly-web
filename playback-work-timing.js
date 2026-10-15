'use strict';
// Request-local diagnostics only. Never retain IDs, URLs, owners or provider options.
const allowed = new Set(['bff_source_discovery','bff_source_resolve','bff_session_prepare','bff_probe','bff_init',
  'movly_profile_policy','movly_stream_read','movly_probe_wait']);
function createWorkTiming(id, res, clock = () => performance.now()) {
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return null;
  res.setHeader("Cache-Control", "private, no-store");
  const spans = new Map();
  function add(name, duration, outcome = 'success') {
    if (!allowed.has(name) || spans.has(name) || spans.size >= 8 || !Number.isFinite(duration) ||
        !['success','failure','timeout','cancelled'].includes(outcome) || res.headersSent) return;
    spans.set(name, `${name};dur=${Math.min(120000,Math.max(0,duration)).toFixed(3)};desc="${outcome}"`);
    const value = [...spans.values()].join(', ');
    if (Buffer.byteLength(value) <= 1024) res.setHeader('Server-Timing',value);
  }
  return Object.freeze({id, async measure(name, work) {
    const start=clock(); let outcome='success';
    try { return await work(); }
    catch(error) { outcome=error?.name==='AbortError'?'cancelled':error?.name==='TimeoutError'?'timeout':'failure'; throw error; }
    finally { add(name,clock()-start,outcome); }
  }, merge(headers) {
    if(headers?.get?.('x-movly-playback-attempt') !== id)return;
    const raw=headers?.get?.('server-timing');
    // Only admit the closed Go format; never reflect arbitrary descriptions.
    if(typeof raw!=='string'||Buffer.byteLength(raw)>1024)return;
    for(const item of raw.split(',')) {
      const m=/^\s*(movly_(?:profile_policy|stream_read|probe_wait));dur=(\d+(?:\.\d{1,3})?);desc="(success|failure|timeout|cancelled)"\s*$/.exec(item);
      if(m)add(m[1],Number(m[2]),m[3]);
    }
  }});
}
module.exports={createWorkTiming};
