# Free Movly web acceptance — 19 October 2026

Issue #175; parent shebincze/Movly#1173. Baseline 791bff3.

An authenticated active, verified ordinary account no longer needs an obsolete Movly paid tier for manual installer access, consumer feedback or the signed profile-scoped offline authorization. Existing browser media downloads remain intentionally app-only (#153). Authentication, administrator authorization, profile policy, PIN unlock, signature, device/environment/session ownership, expiry and revocation are retained. Third-party subscriptions and quotas are unchanged.

The BFF advertises purchase disabled and rejects both legacy plan and purchase requests before forwarding, even if an older upstream advertises purchase eligibility. No coins or historical financial records are changed. The account and settings menus contain no paid offer, and old #premium bookmarks display the free-service explanation without fetching plans.

## Verification

- Complete Node suite: **578 passed, 0 failed, 0 skipped**. Includes free consumer feedback and retained admin denial, no forwarded purchase/plan request, active/verified installer boundary, real signed free-user grant persisted through JSON with seven-day expiry, policy/owner/session/tamper/expiry denial and service-worker restart checks.
- `npm run check`: syntax and all five legacy ES5 files passed.
- Actual in-app browser using the loopback BFF and explicit synthetic upstream: ordinary account menu had feedback and no Premium/coin offer; opening feedback rendered its real form and list; old #premium rendered “Movly je zdarma” and no purchase button. Fixture account id1 was active/verified with no paid tier. Screenshots and raw AX retained in `/Users/shebin/Movly-verification-20261019/web-free-*`.
- The policy-marker test now selects the actual receipt-bound marker instead of the unrelated pre-existing live marker. The former one-day paid expiry had accidentally made those two independent timestamps match. Its real denial and expiry assertion pass with the free seven-day grant.

These are local source and browser results. No deployment, publication, external purchase or production account mutation occurred.
