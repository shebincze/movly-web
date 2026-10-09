const { test } = require("node:test");
const assert = require("node:assert/strict");
test("next episode crosses seasons but never skips an upcoming or unknown premiere", async () => {
  const { nextReleasedEpisode, episodeReleaseState } = await import("./app/episode-policy.js");
  const now = new Date("2026-10-08T10:00:00Z");
  const seasons = [{ season_number: 2, episodes: [{ id: 3, episode_number: 1, air_date: "2026-10-08" }] },
    { season_number: 1, episodes: [{ id: 2, episode_number: 2, air_date: "2026-10-07" }, { id: 1, episode_number: 1, air_date: "2026-10-01" }] }];
  assert.equal(nextReleasedEpisode(seasons, 1, now).id, 2);
  assert.equal(nextReleasedEpisode(seasons, 2, now).id, 3);
  seasons[1].episodes[0].air_date = "2026-10-09";
  assert.equal(nextReleasedEpisode(seasons, 1, now), null);
  seasons[1].episodes[0].air_date = null;
  assert.equal(nextReleasedEpisode(seasons, 1, now), null);
  assert.equal(nextReleasedEpisode(seasons, 999, now), null);
  assert.equal(episodeReleaseState("2026-02-30", now), "unknown");
});
