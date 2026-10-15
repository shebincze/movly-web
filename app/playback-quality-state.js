// Fixed-size aggregate only. Frame latency never includes the weaker playing fallback.
export function playbackQualityVersions(response) {
  if (!response || !Array.isArray(response.rows) || response.rows.length>392) throw new Error("Neplatný přehled přehrávání.");
  const versions=new Map();
  for(const row of response.rows){
    if(!/^[0-9]{1,7}(\.[0-9]{1,7}){0,3}$/.test(row.client_version)||!Number.isSafeInteger(row.count)||row.count<0||!Number.isSafeInteger(row.attempt_count)||row.attempt_count<row.count)throw new Error("Neplatný přehled přehrávání.");
    let v=versions.get(row.client_version);if(!v){if(versions.size>=8)throw new Error("Příliš mnoho verzí.");v={version:row.client_version,buildUnknown:row.build_unknown===true,attempts:row.attempt_count,first_frame:0,playing:0,failure:0,timeout:0,cancelled:0,source_switch:0,switches_after_start:0,stages:[]};versions.set(row.client_version,v);}
    v.buildUnknown ||= row.build_unknown===true;
    if(v.attempts!==row.attempt_count)throw new Error("Neplatné počty pokusů.");
    if(row.stage==="terminal"&&Object.hasOwn(v,row.outcome)&&Number.isFinite(row.p50_upper_ms)&&Number.isFinite(row.p95_upper_ms)){
      v[row.outcome]+=row.count;if(row.outcome==="first_frame"){v.p50=row.p50_upper_ms;v.p95=row.p95_upper_ms;}
    } else if(row.stage==="source_switch")v.switches_after_start+=row.count;
    else if(!["start","terminal"].includes(row.stage))v.stages.push(row);
  }
  return [...versions.values()].map(v=>({...v,incomplete:Math.max(0,v.attempts-v.first_frame-v.playing-v.failure-v.timeout-v.cancelled-v.source_switch)}));
}
