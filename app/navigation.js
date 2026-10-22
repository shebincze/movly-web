// Rodičovská položka hlavní navigace pro trasu. Záložky Mých seznamů (Historie,
// Skryté, Offline) a katalog kolekce nemají vlastní položku, a proto zvýrazní rodiče.
const PARENTS = { history: "lists", hidden: "lists", offline: "lists", collection: "home" };
export function navigationParent(route) {
  return PARENTS[route] || route;
}
