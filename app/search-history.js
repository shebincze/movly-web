// Local history has the same selected-profile boundary as the native clients.
// Values are plain search terms; rendering always uses DOM text nodes.
let owner = null;
const prefix = "movly.searchHistory.";
export function setSearchOwner(account, profile) {
  owner =
    account && profile
      ? prefix + encodeURIComponent(account.username) + ":" + profile.id
      : null;
}
export function searchHistory() {
  if (!owner) return [];
  try {
    return JSON.parse(localStorage.getItem(owner) || "[]")
      .filter(
        (item) => typeof item === "string" && item.trim() && item.length <= 200,
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}
export function rememberSearch(value) {
  const term = value.trim().slice(0, 200);
  if (!owner || !term) return;
  try {
    localStorage.setItem(
      owner,
      JSON.stringify(
        [
          term,
          ...searchHistory().filter(
            (old) => old.toLocaleLowerCase() !== term.toLocaleLowerCase(),
          ),
        ].slice(0, 20),
      ),
    );
  } catch {}
}
export function removeSearch(value) {
  try {
    if (owner)
      localStorage.setItem(
        owner,
        JSON.stringify(searchHistory().filter((old) => old !== value)),
      );
  } catch {}
}
export function clearSearchHistory() {
  try {
    if (owner) localStorage.removeItem(owner);
  } catch {}
}
