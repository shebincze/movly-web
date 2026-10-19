# Restore Premium authorization — issue180

The owner clarified that Premium and restricted access remain required; the owner gives selected people access without charging them. PR177 had incorrectly treated this statement as removal of product authorization. It was never deployed.

This inverse of mergeabdb29b restores the original Premium download, feedback and signed offline-grant rules, paid-period expiry and original account/store/coin behavior. The independent Windows diagnostic dashboard changes from PR178 remain. Eight operational policy/UI files were compared byte-for-byte with the revision before PR177 and match exactly.

Verification: complete579/579 Node tests passed, including original free/expired/malformed entitlement denial and eligible Premium forwarding; syntax and five ES5 files passed; diff check passed. Hash receipt and raw logs are retained in /Users/shebin/Movly-verification-20261019/web-premium-restored-*. No deployment, release or production authorization change occurred.
