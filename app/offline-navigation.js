// Ignore an older inventory read after a profile change or a newer refresh.
export function observeOfflineNavigation(link, readVisible, events = window) {
  let revision = 0;
  let disposed = false;
  const refresh = async () => {
    const current = ++revision;
    link.hidden = true;
    try {
      const visible = await readVisible();
      if (!disposed && current === revision) link.hidden = !visible;
    } catch { /* Unavailable storage must not reveal a stale owner's menu. */ }
  };
  const revoke = () => { ++revision; link.hidden = true; };
  const signals = ["movly-downloads-changed", "movly-offline-context-changed"];
  for (const name of signals) events.addEventListener(name, refresh);
  events.addEventListener("movly-offline-revoked", revoke);
  void refresh();
  return { refresh, dispose() {
    disposed = true;
    ++revision;
    for (const name of signals) events.removeEventListener(name, refresh);
    events.removeEventListener("movly-offline-revoked", revoke);
  } };
}
