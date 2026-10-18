# TheIntroDB v4 playback segments fixture source

`playback-segments.fixtures.json` is copied verbatim from
`shebincze/Movly/contracts/playback-segments/cases.json` (client-side TheIntroDB v4
lookup and merge with `/v1/playback/segments`, contract issue shebincze/Movly#1117,
PR shebincze/Movly#1121, web issue shebincze/movly-web#166). The web contract test
`theintrodb.test.js` reads this local copy, so this standalone repository does not
depend on a sibling checkout. Keep the JSON byte-for-byte synchronized with the
canonical contract (`README.md` and `reference.py` in the same main-repo folder are
the normative rules) when it changes.

Copied from main commit `444720ba745439599e325ea0f35e65be4ec23538` (the commit that
added the file).
SHA-256: `830aab61261080dc4c730f9ba57eea5ce4851d8e2f76ced08789ecd184801fbd`.
