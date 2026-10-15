// Fixed-size aggregate only. Frame latency never includes the weaker playing fallback.
export function playbackQualityVersions(response) {
  if (!response || !Array.isArray(response.rows) || response.rows.length>864) throw new Error("Neplatný přehled přehrávání.");
  const versions=new Map();
  for(const row of response.rows){
    const errorClasses=["none","source_resolve","session_prepare","media_prepare","media_network","media_decode","unsupported","unknown"];
    const stages=["start","source_discovery","resume_lookup","session_prepare","media_opened","terminal","playback_failure","source_switch"];
    const outcomes=row.stage==="terminal"?["first_frame","playing","failure","timeout","cancelled","source_switch"]:row.stage==="playback_failure"?["failure","timeout"]:row.stage==="source_switch"?["source_switch"]:["success","failure","timeout"];
    if(!stages.includes(row.stage)||!outcomes.includes(row.outcome)||!errorClasses.includes(row.error_class)||typeof row.build_unknown!=="boolean"||typeof row.client_version!=="string"||
      [row.p50_upper_ms,row.p95_upper_ms].some(value=>!Number.isSafeInteger(value)||value<0||value>3_600_000)||(["failure","timeout"].includes(row.outcome)===(row.error_class==="none")))throw new Error("Neplatný přehled přehrávání.");
    if(!/^[0-9]{1,7}(\.[0-9]{1,7}){0,3}$/.test(row.client_version)||!Number.isSafeInteger(row.count)||row.count<0||!Number.isSafeInteger(row.attempt_count)||row.attempt_count<row.count)throw new Error("Neplatný přehled přehrávání.");
    let v=versions.get(row.client_version);if(!v){if(versions.size>=8)throw new Error("Příliš mnoho verzí.");v={version:row.client_version,buildUnknown:row.build_unknown===true,attempts:row.attempt_count,first_frame:0,playing:0,failure:0,timeout:0,cancelled:0,source_switch:0,switches_after_start:0,errorClasses:new Map(),stages:[]};versions.set(row.client_version,v);}
    v.buildUnknown ||= row.build_unknown===true;
    if (["terminal","playback_failure"].includes(row.stage) && ["failure","timeout"].includes(row.outcome)) v.errorClasses.set(row.error_class||"unknown",(v.errorClasses.get(row.error_class||"unknown")||0)+row.count);
    if(v.attempts!==row.attempt_count)throw new Error("Neplatné počty pokusů.");
    if(row.stage==="terminal"&&Object.hasOwn(v,row.outcome)&&Number.isFinite(row.p50_upper_ms)&&Number.isFinite(row.p95_upper_ms)){
      v[row.outcome]+=row.count;if(row.outcome==="first_frame"){v.p50=row.p50_upper_ms;v.p95=row.p95_upper_ms;}
    } else if(row.stage==="source_switch")v.switches_after_start+=row.count;
    else if(!["start","terminal"].includes(row.stage))v.stages.push(row);
  }
  return [...versions.values()].map(v=>({...v,incomplete:Math.max(0,v.attempts-v.first_frame-v.playing-v.failure-v.timeout-v.cancelled-v.source_switch)}));
}
