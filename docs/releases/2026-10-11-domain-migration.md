# Movly domain migration — 2026-10-11

Production web is https://movly.top/ (also www.movly.top); the browser app is /app/. Production server-side API is https://api.movly.top. Legacy movly.sheri.cz and api-go.shebin.eu continue working.

PX LXC 214 release /srv/movly/.movly-web-releases/domain-migration-20261011 clones the then-current notification-editors-20261011 release and changes only the API defaults and screenshot URLs. /etc/movly/web.env now uses MOVLY_API_BASE=https://api.movly.top. The previous release and environment backup are retained for rollback.

Cloudflare routes web requests through the PX LXC 203 gateway, which overwrites X-Movly-Client-IP using CF-Connecting-IP from the dedicated LXC 101 connector. Existing trusted gateway IP 192.168.1.156 is preserved. The new and old gateway entry points reject public origin bypass; firewall rules also cover Docker forwarding.

Validation: npm run check; public web, /app/, /activate, /party/ABC234, application association files, and API readiness; new API CORS preflight; spoofed client-IP header remains overwritten. Source merge and production patch are separate receipts. Native client releases and real account acceptance are tracked separately in shebincze/Movly.

Issues: shebincze/movly-web#34, shebincze/Movly#422 and #427. GitHub Actions disabled.
