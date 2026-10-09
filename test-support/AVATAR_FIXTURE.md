# Default-avatar fixture

`default-avatars.json` is the public avatar catalog from
`shebincze/Movly`, `backend/apps/core-api/assets/default_avatars.json`, at
commit `18d0bea82189fa4b132c9b2216b6a6686961bf70`.

It is pinned locally so standalone web tests do not require an adjacent backend
checkout. It contains public catalog IDs and image URLs, not account data. Update
it deliberately when avatar-contract expectations change.
