export function episodeReleaseState(airDate, now = new Date()) {
  if (typeof airDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(airDate)) return "unknown";
  const day = airDate.slice(0, 10), parsed = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return "unknown";
  return day > now.toISOString().slice(0, 10) ? "upcoming" : "released";
}

export function nextReleasedEpisode(seasons, currentEpisodeId, now = new Date()) {
  const ordered = [...seasons].filter(s => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number)
    .flatMap(s => [...(s.episodes || [])].sort((a, b) => a.episode_number - b.episode_number)
      .map(e => ({ ...e, season_number: s.season_number })));
  const index = ordered.findIndex(e => e.id === currentEpisodeId);
  if (index < 0 || index + 1 >= ordered.length) return null;
  const next = ordered[index + 1], state = episodeReleaseState(next.air_date, now);
  if (state === "released") return next;
  if (state === "unknown" && (next.watch_history?.progress_seconds > 0 || next.watch_progress?.progress_seconds > 0)) return next;
  return null;
}
