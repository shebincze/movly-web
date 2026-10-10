#!/usr/bin/env python3
"""Apply the scoped diagnostic patch to the exact live web release; atomic rollback."""
import fcntl,hashlib,json,os,pathlib,shutil,subprocess,sys,time
ROOT=pathlib.Path('/srv/movly');LINK=ROOT/'web'
EXPECTED=ROOT/'.movly-web-releases/feedback-admin-20261009T2006Z'
BASE_HASHES={'app-server.js':'7d5f682ea301ab308827da0f05807f2fc5bc08cf02f06a0940a1fad28e8c97e8','app/feedback.js':'750c21a04d14be0ee493c63d42e9697ef56bc2f2b5967f54028643cac85ddcb0','app/player.js':'d22d7ad08c43057aaf97b991db574eadd0fd108a40dec642a0bbdc924a2da538','playback-server.js':'b2fb167e7bbbac0ed860f968afb6840a5ab9cf239c4e0fa4b615ea40d57dc111'}
ALLOWED=set(BASE_HASHES)|{'app/playback-diagnostics.js','app/main.js'}
def run(args):
 p=subprocess.run(args,capture_output=True,text=True,timeout=180)
 if p.returncode:raise RuntimeError(args[0]+' failed; inspect protected web release state')
 return p.stdout.strip()
def hashes(root):return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
assert os.geteuid()==0 and run(['hostname','-s'])=='movly-web-lxc'
assert len(sys.argv)==2;incoming=pathlib.Path(sys.argv[1]);assert incoming==ROOT/'incoming/feedback-diagnostics-20261010'
os.umask(0o077)
lock=(ROOT/'.movly-web-release.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX)
assert LINK.is_symlink() and LINK.resolve()==EXPECTED,'live web release drift'
assert {name:hashlib.sha256((EXPECTED/name).read_bytes()).hexdigest() for name in BASE_HASHES}==BASE_HASHES
manifest=json.loads((incoming/'manifest.json').read_text());patch=incoming/'feedback-diagnostics-runtime.patch'
assert hashlib.sha256(patch.read_bytes()).hexdigest()==manifest['patch_sha256']
release=ROOT/'.movly-web-releases'/('feedback-diagnostics-20261010-'+manifest['source_commit'][:12]);assert not release.exists()
shutil.copytree(EXPECTED,release);before=hashes(EXPECTED)
run(['git','-C',str(release),'apply','--check',str(patch)]);run(['git','-C',str(release),'apply',str(patch)])
# The old caller predates the owner-bound diagnostic draft parameter.
main=release/'app/main.js';text=main.read_text();assert text.count('feedback(params, signal)')==1
main.write_text(text.replace('feedback(params, signal)','feedback(params, signal, session.account)',1))
for name in sorted(ALLOWED):run(['node','--check',str(release/name)])
after=hashes(release);changed={name for name in after if after[name]!=before.get(name)}
assert changed<=ALLOWED and not(set(before)-set(after))
# No source files outside the explicit feedback selection change.
receipt={'source_commit':manifest['source_commit'],'previous_release':str(EXPECTED),'release':str(release),'changed_files':sorted(changed),'file_hashes':{name:after[name] for name in changed},'status':'failed','client_binaries_published':False}
next_link=ROOT/'.feedback-diagnostics-next';assert not next_link.exists();next_link.symlink_to(release)
try:
 next_link.replace(LINK);run(['systemctl','restart','movly-web.service'])
 for _ in range(30):
  if run(['systemctl','is-active','movly-web.service'])=='active':break
  time.sleep(1)
 else:raise RuntimeError('web service unhealthy')
 for name in ['app/player.js','app/feedback.js','app/playback-diagnostics.js']:
  data=subprocess.check_output(['curl','--fail','--silent','--show-error','--max-time','20','https://movly.sheri.cz/'+name])
  assert hashlib.sha256(data).hexdigest()==after[name],'public web file mismatch '+name
 assert LINK.resolve()==release
 receipt.update(status='deployed_and_verified',health='active',public_files_verified=True)
except Exception:
 next_link.symlink_to(EXPECTED);next_link.replace(LINK);run(['systemctl','restart','movly-web.service']);receipt['rollback']='active previous release restored';raise
finally:
 (incoming/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
