# Live web notification acceptance

Issue #30. Active release: `/srv/movly/.movly-web-releases/series-notifications-20261011-v2`.

The notification runtime patch applies to the verified deployed Home/feedback/provider baseline, preserving every other file byte-for-byte. The proxy uses that baseline's cleanQuery signature and supports account preferences before profile selection. The final public app module hashes match the manifest. Node syntax and service/HTTP checks passed.

The public authenticated canary used disposable ordinary accounts. Login, account settings before selecting a profile, saving multiple events/channels, and rejecting another expected account all passed; backend inbox/default inheritance/isolation checks passed too. Fixtures were removed. Browser UI controls were covered by the earlier feature tests; this receipt records live HTTP behavior, not a physical-device acceptance claim.

No client binaries were published. APNs/FCM device acceptance and native releases remain in Movly #349/#351/#350.
