# Manual source input regression (#215)

Start `test-support/app-fixture.cjs` on loopback and log into its explicit synthetic account (`test` / `movly-test`), then select Testovací profil. In a Playwright CLI session on `/app`, run the function from `manual-source-play.pw.js` with `run-code`.

The test seeds a synthetic saved source for fixture title 2, then checks that hold, Shift+Enter and the visible context-menu action open the actual picker without querying saved playback. An ordinary click still performs that query, and manual selection does not erase source memory. The context-menu check uses an actual pointer click inside the modal, catching inert/outside-dialog menus. No source is resolved or played.

`node --test play-activation.test.js` separately covers cancellation, duplicate/repeated input, the next ordinary click and TV key activation. `npm test` includes offline module and ES5 loader regressions.

On the fixture TV homepage (`/app/tv/`), `manual-source-tv-repeat.pw.js` holds OK, transfers focus to a real source row, sends repeats and releases. It asserts zero source clicks until release and exactly one on the next deliberate Enter. Source clicks are intercepted before playback.
