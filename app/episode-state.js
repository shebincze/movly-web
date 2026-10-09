import { translateUI } from "./i18n.js";
import { episodeReleaseState } from "./episode-policy.js";

export function episodeState(episode, now = new Date()) {
  const history = episode.watch_history || episode.watch_progress || {};
  const upcoming = episodeReleaseState(episode.air_date, now) === "upcoming";
  return {
    upcoming,
    watched:
      history.watch_status === "completed" || history.is_completed === true,
    historyId:
      Number.isSafeInteger(history.id) && history.id > 0 ? history.id : null,
  };
}

export async function toggleEpisodeWatched(
  request,
  title,
  seasonNumber,
  episode,
) {
  if (episodeState(episode).upcoming)
    throw new Error(translateUI("Epizoda ještě neměla premiéru."));
  const path = `watch-history/position/${title.id}?season_number=${seasonNumber}&episode_number=${episode.episode_number}`;
  let current;
  try {
    current = await request(path);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (current?.watch_status === "completed") {
    if (!Number.isSafeInteger(current.id) || current.id <= 0)
      throw new Error(translateUI("API nevrátilo identitu zhlédnuté epizody."));
    await request(`watch-history/${current.id}`, { method: "DELETE" });
  } else {
    await request("watch-history", {
      method: "POST",
      body: {
        title_id: title.id,
        type: "tv",
        watch_status: "completed",
        season_number: seasonNumber,
        episode_number: episode.episode_number,
      },
    });
  }
  let confirmed = null;
  try {
    confirmed = await request(path);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const watched = confirmed?.watch_status === "completed";
  if (watched === (current?.watch_status === "completed"))
    throw new Error(translateUI("API nepotvrdilo změnu zhlédnutí epizody."));
  return confirmed;
}
