import "./tv/home-preferences-state.js";
import { api, apiContextKey, apiContextOwner } from "./api.js";
import { effectiveContentPolicy } from "./effective-policy.js";
import { uiLanguage } from "./i18n.js";

// Metadata polling complements mirror invalidations without a new content/SSE route.
export function watchPagePreferences({ page, signal, active, changed }) {
  const context = apiContextKey(), owner = apiContextOwner(), state = window.MovlyHomePreferences;
  const current = () => !signal?.aborted && !document.hidden && context === apiContextKey() && !!owner && active();
  const watcher = state.watch({ active: current, changed, initial: true,
    read(done) {
      const request = new AbortController();
      void (async () => {
        try {
          const policy = await effectiveContentPolicy({ refresh: true });
          if (!current() || request.signal.aborted || policy.user_id !== owner.accountId || policy.profile_id !== owner.profileId) return;
          const value = state.document(await api(`pages/${page}/preferences?lang=${uiLanguage()}`, { signal: request.signal, expectedOwner: owner }), owner.profileId, page);
          if (current() && !request.signal.aborted) done(null, { ...value, policy_revision: policy.revision });
        } catch (error) { done(error); }
      })();
      return request;
    }
  });
  const visibility = () => { if (current()) watcher.start(); else watcher.stop(); };
  document.addEventListener("visibilitychange", visibility, { signal });
  window.addEventListener("focus", visibility, { signal });
  window.addEventListener("blur", () => watcher.stop(), { signal });
  window.addEventListener("online", visibility, { signal });
  signal?.addEventListener("abort", () => watcher.stop(), { once: true });
  const initial = setTimeout(visibility, 0);
  signal?.addEventListener("abort", () => clearTimeout(initial), { once: true });
  return watcher;
}
