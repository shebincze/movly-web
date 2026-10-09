const { test } = require("node:test");
const assert = require("node:assert/strict");
const { streamUploadPayload } = require("./stream-feedback");
const { rewritePlaylist, mediaPlan } = require("./playback-server");
test("stream upload records measured tracks, episode and canonical Bombuj identity", () => {
  const body = streamUploadPayload({ title: { id: 5 }, episode: { season_number: 2, episode_number: 3 }, provider: "Mixdrop", providerID: 9,
    ident: "s|123|4", fileName: "episode", analysis: { format: { size: "1234" }, streams: [
      { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, r_frame_rate: "24000/1001", color_transfer: "smpte2084" },
      { codec_type: "audio", codec_name: "eac3", channels: 6, tags: { language: "ces" }, disposition: { default: 1 } } ] } });
  assert.equal(body.source_stream_id, "bombuj|mixdrop|s|123|4"); assert.equal(body.season_number, 2);
  assert.equal(body.video_height, 1080); assert.equal(body.hdr_type, "HDR10"); assert.equal(body.file_size, 1234);
  assert.equal(body.audio_streams[0].audio_channels, 6); assert.equal(body.fps, 23);
  assert.throws(() => streamUploadPayload({ analysis: { streams: [] } }), { status: 422 });
});
test("HLS proxy rewrites playlists, segments, encryption keys and maps through the same gate", () => {
  const mapped = [];
  const result = rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nsegment.ts\n', uri => { mapped.push(uri); return `local/${uri}`; });
  assert.deepEqual(mapped, ["key", "init.mp4", "segment.ts"]);
  assert.ok(result.includes('URI="local/key"')); assert.ok(result.includes("local/segment.ts"));
  assert.throws(() => rewritePlaylist("not hls", x => x), { status: 502 });
});
test("bitmap subtitles force rendering and unsupported Dolby Vision profile five fails explicitly", () => {
  const info = { streams: [{ codec_type: "video", codec_name: "hevc" }, { codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle" }] };
  assert.equal(mediaPlan(info, 0, 0, { videoMode: "native", capabilities: { hevc: true } }).copyVideo, false);
  assert.equal(mediaPlan(info, 0, 0).bitmap, true);
  info.streams[0].side_data_list = [{ side_data_type: "DOVI configuration record", dv_profile: 5 }];
  assert.throws(() => mediaPlan(info), { status: 422 });
});

test("compatible quality actually scales full HD while native mode preserves the source", () => {
  const info = { streams: [{ codec_type: "video", codec_name: "h264", width: 1920 }] };
  assert.equal(mediaPlan(info, 0, -1, { maxWidth: 1280 }).copyVideo, false);
  assert.equal(mediaPlan(info, 0, -1, { maxWidth: 1920 }).copyVideo, true);
  assert.equal(mediaPlan(info, 0, -1, { maxWidth: 1280, videoMode: "native" }).copyVideo, true);
});
