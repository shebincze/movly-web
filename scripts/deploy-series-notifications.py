#!/usr/bin/env python3
"""Apply only notification changes to a verified live web release with rollback."""
import fcntl,hashlib,json,os,pathlib,shutil,subprocess,time,urllib.request
ROOT=pathlib.Path('/srv/movly');STAGE=ROOT/'incoming/series-notifications-20261011';LINK=ROOT/'web'
def run(args):return subprocess.check_output(args,text=True).strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert os.geteuid()==0 and run(['hostname','-s'])=='movly-web-lxc'
lock=(ROOT/'.movly-web-release.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX)
manifest=json.loads((STAGE/'manifest.json').read_text());previous=pathlib.Path(manifest['previous_release']);assert LINK.resolve()==previous
for f,v in manifest['base_hashes'].items():assert sha(previous/f)==v,f
assert sha(STAGE/'runtime.patch')==manifest['patch_sha256']
release=ROOT/'.movly-web-releases/series-notifications-20261011';assert not release.exists();shutil.copytree(previous,release)
run(['git','-C',str(release),'apply','--check',str(STAGE/'runtime.patch')]);run(['git','-C',str(release),'apply',str(STAGE/'runtime.patch')])
for f in ['app/notifications.js','app/notification-labels.js']:shutil.copy2(STAGE/f,release/f)
for f,v in manifest['expected_hashes'].items():
 assert sha(release/f)==v,f
 (release/f).chmod(0o644)
 if f.endswith('.js'):run(['node','--check',str(release/f)])
# Every other live file stays byte-for-byte identical.
assert all(p.relative_to(previous).as_posix() in manifest['expected_hashes'] or sha(release/p.relative_to(previous))==sha(p) for p in previous.rglob('*') if p.is_file())
next_link=ROOT/'.series-notifications-next';assert not next_link.exists()
def swap(target):next_link.symlink_to(target);next_link.replace(LINK)
try:
 swap(release);run(['systemctl','restart','movly-web']);time.sleep(2);assert run(['systemctl','is-active','movly-web'])=='active'
 for path in ['/app/','/devices']:
  with urllib.request.urlopen('http://127.0.0.1:8080'+path,timeout=15) as r:assert r.status==200
 for f,v in manifest['expected_hashes'].items():
  if f.startswith('app/'):
   req=urllib.request.Request('https://movly.sheri.cz/'+f,headers={'User-Agent':'Movly-Notifications-Canary/1','Cache-Control':'no-cache'})
   assert hashlib.sha256(urllib.request.urlopen(req,timeout=20).read()).hexdigest()==v,f
 receipt={'previous_release':str(previous),'release':str(release),'changed_files':sorted(manifest['expected_hashes']),'public_hashes_verified':True,'service':'active','client_binaries_published':False,'timestamp_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())};(STAGE/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
except Exception:swap(previous);run(['systemctl','restart','movly-web']);raise
