# Stream scoring fixture source

`stream-scoring.fixtures.json` is copied verbatim from
`shebincze/Movly/contracts/stream-relevance/scoring.json` (contract issue
shebincze/Movly#1047, web parity shebincze/movly-web#160). The web contract test
`stream-scoring.test.js` reads this local copy, so this standalone repository
does not depend on a sibling checkout. Keep the JSON byte-for-byte synchronized
with the canonical contract when it changes. `app/stream-scoring.js` embeds
`tables` and the test fails if they drift.

Copied from main commit `07439beee48c2456f23e11036f60b76162fa1bba`; the file was
last changed in `cff06444d082a599ff932e3c7d8308d319de06f5`.
SHA-256: `a2fb1acc66bc8b96b7c7d4a91cad01c07754f469ba8c430a680b46f771e88c12`.
