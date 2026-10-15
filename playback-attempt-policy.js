const stages = ["start","source_discovery","resume_lookup","session_prepare","media_opened","terminal","playback_failure","source_switch"];
const keys = ["attempt_id","sequence","stage","outcome","elapsed_ms","duration_ms","provider","client_version","engine","sample_rate","build_unknown"];
module.exports = function validPlaybackAttempt(body) {
  return body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === keys.length && Object.keys(body).every(key=>keys.includes(key))
    && typeof body.attempt_id === "string" && /^[0-9a-f]{32}$/.test(body.attempt_id) && stages.indexOf(body.stage)>=0 && body.sequence === stages.indexOf(body.stage)
    && (body.stage === "terminal" ? ["first_frame","playing","failure","timeout","cancelled","source_switch"] : body.stage === "playback_failure" ? ["failure","timeout"] : body.stage === "source_switch" ? ["source_switch"] : ["success","failure","timeout"]).includes(body.outcome)
    && typeof body.build_unknown === "boolean"
    && typeof body.client_version === "string" && /^[0-9]{1,7}(\.[0-9]{1,7}){0,3}$/.test(body.client_version)
    && ["unknown","hls_mse","native_hls","html5","avplayer","media3","libvlc","mpv"].includes(body.engine)
    && ["none","webshare","hellspy","sosac","fastshare","stremio","database","direct","vlc","avplayer"].includes(body.provider)
    && Number.isSafeInteger(body.elapsed_ms) && body.elapsed_ms>=0 && body.elapsed_ms<=3_600_000
    && Number.isSafeInteger(body.duration_ms) && body.duration_ms>=0 && body.duration_ms<=body.elapsed_ms && body.sample_rate===1000;
};
