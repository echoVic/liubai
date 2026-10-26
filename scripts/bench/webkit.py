#!/usr/bin/env python3
"""Editing benchmark in WebKit (the desktop app's engine) for one source tree.

python3 scripts/bench/webkit.py <repo-root> <server-binary>   — prints one JSON object per line.
Starts <server-binary> -web from <repo-root>, so it serves that tree's committed web/ bundle with an
empty data dir and HOME, then opens each document of scripts/bench/documents.mjs in an off-screen
WKWebView (scripts/bench/webkit.swift): opening, typing, arrow keys, scrolling, the pause after typing
and the web process's memory. The window never activates. WebKit renders nothing while the screen is
locked or the display sleeps; a run that loses its frames is discarded and tried again every 30 s, for
up to RETRY_MINUTES (default 30). PROBE=<file.js> is passed on to the helper (see webkit.swift).
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

root = Path(sys.argv[1]).resolve()
server = Path(sys.argv[2]).resolve()
here = Path(__file__).resolve().parent
source = here / "webkit.swift"
cache = Path(tempfile.gettempdir()) / "liubai-webkit-bench"
cache.mkdir(exist_ok=True)
helper = cache / ("webkit-bench-" + hashlib.sha256(source.read_bytes()).hexdigest()[:12])
if not helper.exists():
    subprocess.run(["swiftc", "-O", "-module-cache-path", str(cache / "modules"), str(source), "-o", str(helper)], check=True, timeout=900)

work = Path(tempfile.mkdtemp(prefix="liubai-webkit-bench-"))
try:
    docs = work / "docs"
    docs.mkdir()
    # Writes <kind>-<chars>.md for each document and prints their order.
    script = ("import {writeFileSync} from 'node:fs';const m=await import(process.argv[1]),dir=process.argv[2];"
              "for(const [kind,size] of m.webkitDocuments)writeFileSync(`${dir}/${kind}-${size}.md`,m[kind](size));"
              "console.log(JSON.stringify(m.webkitDocuments))")
    order = json.loads(subprocess.run(["node", "--input-type=module", "-e", script, (here / "documents.mjs").as_uri(), str(docs)],
                                      check=True, stdout=subprocess.PIPE, text=True).stdout)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    home = work / "home"
    home.mkdir()
    url = f"http://127.0.0.1:{port}/"
    log = open(work / "server.log", "w")
    proc = subprocess.Popen([str(server), "-web", f"127.0.0.1:{port}", "-data-dir", str(work / "data")], cwd=root,
                            env={**os.environ, "HOME": str(home)}, stdout=subprocess.DEVNULL, stderr=log)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(url, timeout=1).read()
                break
            except OSError:
                if proc.poll() is not None:
                    raise SystemExit("server exited: " + (work / "server.log").read_text())
                time.sleep(0.1)
        else:
            raise SystemExit("server did not start")
        files = [str(docs / f"{kind}-{chars}.md") for kind, chars in order]
        deadline = time.time() + 60 * float(os.environ.get("RETRY_MINUTES", "30"))
        while True:
            run = subprocess.run([str(helper), url, *files], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=900)
            sys.stderr.write(run.stderr)
            if run.returncode == 0:
                out = run.stdout
                break
            if ("no animation frames" not in run.stderr and "timed out waiting" not in run.stderr) or time.time() > deadline:
                raise SystemExit(f"webkit bench failed for {root}")
            time.sleep(30)
        tree = json.loads((root / "package.json").read_text())["version"]
        for line in out.splitlines():
            print(json.dumps({**json.loads(line), "tree": tree}, ensure_ascii=False), flush=True)
    finally:
        proc.terminate()
        proc.wait(timeout=10)
finally:
    shutil.rmtree(work, ignore_errors=True)
    # Older helpers seeded through URLSession.shared, which keeps a cache and cookie store named after the executable.
    for folder in ("Caches", "HTTPStorages"):
        shutil.rmtree(Path.home() / "Library" / folder / helper.name, ignore_errors=True)
