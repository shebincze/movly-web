#!/usr/bin/env python3
"""Prepare the reviewed Home overlay on a copy of its exact production baseline.
Usage: python3 scripts/prepare-home-production.py BASELINE_DIRECTORY NEW_DIRECTORY
The baseline must be the resume-stream-20261010-dfe3231-v3 release, without secrets.
Activation remains a separate locked deployment with rollback and smoke checks.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

repo = Path(__file__).resolve().parent.parent
baseline, output = map(lambda p: Path(p).resolve(), sys.argv[1:])
if output.exists():
    raise SystemExit("Output must be a new directory")
shutil.copytree(baseline, output)
subprocess.run(["git", "apply", "--check", str(repo / "scripts/home-production-runtime.patch")], cwd=output, check=True)
subprocess.run(["git", "apply", str(repo / "scripts/home-production-runtime.patch")], cwd=output, check=True)
subprocess.run(["git", "apply", "--check", str(repo / "scripts/playback-control-runtime.patch")], cwd=output, check=True)
subprocess.run(["git", "apply", str(repo / "scripts/playback-control-runtime.patch")], cwd=output, check=True)
for name in ["home.js", "home-state.js"]:
    shutil.copy2(repo / "app" / name, output / "app" / name)
files = ["app-server.js", "app/catalog.js", "app/api.js", "app/styles.css", "app/offline-sw.js", "app/home.js", "app/home-state.js", "app/player.js"]
unchanged = ["server.js", "playback-server.js", "sources-server.js", "app/stream-recommendations.js"]
def hashes(names):
    return {name: hashlib.sha256((output / name).read_bytes()).hexdigest() for name in names}
manifest = {"baseline": "resume-stream-20261010-dfe3231-v3", "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(), "issues": [10, 14, 17, 21, 24, 25], "files": hashes(files), "unchanged": hashes(unchanged)}
(output / "home-release.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
