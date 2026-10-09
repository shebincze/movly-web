const { test } = require("node:test");
const assert = require("node:assert/strict");
test("episode state and mutations respect premiere and verify durable toggle", async () => {
  const { episodeState, toggleEpisodeWatched } = await import(
    "./app/episode-state.js"
  );
  const now = new Date("2026-10-09T12:00:00Z");
  assert.equal(
    episodeState(
      { air_date: "2099-01-01", watch_history: { watch_status: "completed" } },
      now,
    ).upcoming,
    true,
  );
  let history = null,
    writes = [];
  const request = async (path, options = {}) => {
    if (options.method === "POST") {
      writes.push(options.body);
      history = { id: 42, ...options.body };
      return history;
    }
    if (options.method === "DELETE") {
      assert.equal(path, "watch-history/42");
      history = null;
      return { ok: true };
    }
    if (!history) throw Object.assign(new Error("absent"), { status: 404 });
    return { ...history };
  };
  const episode = { id: 11, episode_number: 2, air_date: "2020-01-01" };
  assert.equal(
    (await toggleEpisodeWatched(request, { id: 7 }, 1, episode)).watch_status,
    "completed",
  );
  assert.equal(writes[0].season_number, 1);
  assert.equal(writes[0].episode_number, 2);
  assert.equal(
    await toggleEpisodeWatched(request, { id: 7 }, 1, episode),
    null,
  );
  await assert.rejects(() =>
    toggleEpisodeWatched(request, { id: 7 }, 1, {
      ...episode,
      air_date: "2099-01-01",
    }),
  );
  assert.equal(writes.length, 1);
});
test("unconfirmed or unauthorized mutations never report success", async () => {
  const { toggleEpisodeWatched } = await import("./app/episode-state.js");
  const ep = { episode_number: 1, air_date: "2020-01-01" };
  await assert.rejects(
    () =>
      toggleEpisodeWatched(
        async () => ({ id: 2, watch_status: "completed" }),
        { id: 7 },
        1,
        ep,
      ),
    /nepotvrdilo/,
  );
  let mutations = 0;
  await assert.rejects(() =>
    toggleEpisodeWatched(
      async (_, options) => {
        if (options) mutations++;
        throw Object.assign(new Error("unauthorized"), { status: 403 });
      },
      { id: 7 },
      1,
      ep,
    ),
  );
  assert.equal(mutations, 0);
});
