# Lossless language filters and live facets (#191)

Saved filters now round-trip audio/subtitle/original language arrays and countries through grid/Search URLs, API CSV queries and save documents. Legacy singular languages are merged with arrays. Valid selected codes absent from current facets remain options, so applying or saving another client's filter cannot silently broaden it. Explicit sort order, vote-count sorting, arbitrary valid quality heights, fractional/zero rating bounds and selected genres absent from lookup are preserved; Search title `q`, Search `quality` and legacy grid `q` retain their existing meanings.

The four fields use native keyboard-accessible multiple selects populated by the actual facets API. Loading errors offer retry without discarding selections. Response application is fenced by route, API owner/context and freshly verified content policy. Children require the server's opted-in `policy_scoped` capability; older endpoints fail closed. The BFF owns header negotiation; browser input cannot choose upstream headers.

## Local acceptance, 19 October 2026

- Syntax/ES5 checks passed and all 602 combined Node tests passed, including ten filter helper regressions and the existing Search/TV tests.
- Actual Chromium 151 + local BFF + production Go router/PostgreSQL (#1210 synthetic Premium fixture): selected audio `[cs,en,zul]`, subtitles `[cs,sk]`, originals `[fr,ja]`, countries `[CZ,US,ZZ]`, 2160p, rating lower bound 0, rating ascending.
- Actual UI save, fresh BFF GET and fresh SQL row agreed on every field; applying the saved filter restored URL and selected controls. Deleting this own QA row was verified by a fresh GET. BFF document preservation depends on #192; no other fixture rows were changed.
- Controlled facets 503 then Retry recovered through the real endpoint and retained the unknown selected code. A delayed adult response released after an actual UI switch to Kids QA was ignored. No page errors.
- Keyboard supplement used the actual production filterBuilder and DOM helpers with controlled facet data: Home then Shift+ArrowDown selected CS/EN and actual FormData submission retained both CSV values plus the title query, a missing-lookup genre, 1440p, fractional rating bounds and vote-count ascending order. This component run made no authentication requests.
- Actual child UI with #1216 received only policy-permitted facet counts. A controlled older response without the negotiated capability was rejected before rendering global options.
- Desktop and mobile screenshots retained externally under `Movly-verification-20261019/search191/`, alongside redacted `browser.json`, `faults.json`, `saved.json` and reproducible harness scripts.

These are local synthetic-catalogue runtime checks. No production account/catalogue writes, deployment or client publication occurred. Backend scoped-count and opt-in capability acceptance is tracked by #1216.
