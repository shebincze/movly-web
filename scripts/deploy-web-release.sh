#!/bin/zsh
# Publish the current web working tree to movly.sheri.cz (LXC 214 on Proxmox).
#
# Release convention on the LXC: /srv/movly/web is a symlink to
# /srv/movly/.movly-web-releases/web-<UTC stamp>-<sha12 of server.js>; the
# systemd service movly-web runs /srv/movly/web/server.js with
# EnvironmentFile=/etc/movly/web.env (never part of a release).
#
# Steps: pack an allowlisted tarball -> scp to the Proxmox host -> pct push
# into the LXC -> extract as a new release dir -> node --check -> switch the
# symlink -> restart movly-web -> smoke test /devices and /app/ over
# 127.0.0.1:8080 (the LXC has node but no curl) -> on failure switch the
# symlink back and restart again.
#
# Usage:  zsh scripts/deploy-web-release.sh            # publish
#         zsh scripts/deploy-web-release.sh --dry-run  # pack + upload only
set -eu

typeset -a PX
PX=(ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -p 12211 -i ~/.ssh/movly_deploy root@192.168.191.10)
ct=214
web_dir=${0:A:h:h}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
sha12=$(shasum -a 256 "$web_dir/server.js" | cut -c1-12)
release=web-$stamp-$sha12
tarball=/tmp/$release.tar.gz
dry_run=${1:-}

cd "$web_dir"
node --check server.js && node --check app-server.js
sh scripts/build-provider-resolver.sh linux-x64
# Allowlist: only what the server serves or requires. No git metadata, no
# design sources, no zip archives, no local download roots.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$tarball" \
  --exclude='._*' --exclude='.git' --exclude='node_modules' --exclude='downloads-local' \
  --exclude='design' --exclude='*.zip' --exclude='.DS_Store' \
  server.js app-server.js providers-server.js sources-server.js playback-server.js native-providers.js offline-grant.js stream-feedback.js provider-resolver support.js package.json \
  index.html privacy.html delete-account.html party.html activate.html devices.html \
  activate.css devices.css activate.js devices.js \
  assets en app .well-known
size=$(stat -f %z "$tarball")
sum=$(shasum -a 256 "$tarball" | cut -d' ' -f1)
printf 'release %s (%s bytes, sha256 %s)\n' "$release" "$size" "$sum"

scp -o ServerAliveInterval=15 -P 12211 -i ~/.ssh/movly_deploy "$tarball" root@192.168.191.10:/root/incoming/
"${PX[@]}" "printf '%s  %s\n' $sum /root/incoming/$release.tar.gz | sha256sum -c --quiet && pct push $ct /root/incoming/$release.tar.gz /tmp/$release.tar.gz && echo uploaded-into-lxc"
if [[ $dry_run == --dry-run ]]; then
  echo 'dry run: tarball is in the LXC at /tmp, nothing activated'
  exit 0
fi

"${PX[@]}" "pct exec $ct -- bash -s" <<REMOTE
set -euo pipefail
exec 9>/run/lock/movly-web-release.lock
flock -n 9 || { echo "Another web deployment is running" >&2; exit 1; }
release=$release
sum=$sum
base=/srv/movly/.movly-web-releases
dir=\$base/\$release
printf '%s  %s\n' "\$sum" "/tmp/\$release.tar.gz" | sha256sum -c --quiet
previous=\$(readlink -f /srv/movly/web)
mkdir -p "\$dir"
tar -xzf "/tmp/\$release.tar.gz" -C "\$dir" --no-same-owner
cd "\$dir"
for source in server.js app-server.js providers-server.js sources-server.js playback-server.js app/*.js; do node --check "\$source"; done
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null
printf '%s' '{"action":"status"}' | ./provider-resolver/Movly.ProviderResolver
switched=0
rollback() {
  code=\$?
  trap - ERR
  if [ "\$switched" = 1 ]; then
    ln -sfn "\$previous" /srv/movly/web.new && mv -Tf /srv/movly/web.new /srv/movly/web
    systemctl restart movly-web || true
  fi
  exit "\$code"
}
trap rollback ERR
ln -sfn "\$dir" /srv/movly/web.new && mv -Tf /srv/movly/web.new /srv/movly/web
switched=1
systemctl restart movly-web
sleep 2
smoke() {
  node -e 'const http=require("http");const p=process.argv[1];http.get({host:"127.0.0.1",port:8080,path:p,headers:{host:"movly.sheri.cz"}},r=>{console.log(p,r.statusCode);process.exit(r.statusCode===200?0:1)}).on("error",e=>{console.log(p,e.message);process.exit(1)})' "\$1"
}
if smoke /devices && smoke /app/ && systemctl is-active --quiet movly-web; then
  switched=0
  trap - ERR
  printf 'WEB-RELEASE DONE %s -> %s (previous %s)\n' "\$(date -u +%H:%M:%SZ)" "\$dir" "\$previous"
  rm -f "/tmp/\$release.tar.gz"
else
  echo 'smoke test failed; rolling back' >&2
  ln -sfn "\$previous" /srv/movly/web.new && mv -Tf /srv/movly/web.new /srv/movly/web
  systemctl restart movly-web
  journalctl -u movly-web -n 30 --no-pager >&2 || true
  exit 1
fi
REMOTE
