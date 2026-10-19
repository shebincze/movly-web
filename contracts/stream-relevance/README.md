# Node provider relevance

`sources-relevance.js` ports the relevance portion of
`shebincze/Movly/contracts/stream-relevance/reference.py`.
`lexicons.json` and `test-support/stream-relevance.cases.json` are verbatim copies
of the canonical contract, including the Czech making-of correction tracked in
shebincze/Movly#1151. Update both copies together when the contract changes.

`node --test sources-relevance.test.js` covers normalization, tokenization,
title variants, patterns, fuzzy matching, token gating, episode slots, provider
types, early provider gating, trailer filtering, and every evaluate fixture.
The remaining canonical sections (Wikidata lookups and reference de-duplication)
are outside this Node adapter's scope.

The existing `app/stream-scoring.js` remains responsible for browser scoring.
Node adapters emit its snake_case `scoring` payload, with unknown measurements
left null. Hellspy's reported duration is seconds. Filename-derived quality,
codec, HDR, language and channel metadata retains the web's existing semantics.

Episode ranges containing the requested episode remain accepted by the shared
contract. They are not season-pack verdicts merely because of a range marker.
