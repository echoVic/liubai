"""Helpers shared by the browser checks (scripts/check-*.py).

A check imports each helper under the name it calls it by, for example
`from checklib import localized_api as api`.
"""
import atexit
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time

THEMES = json.loads((Path(__file__).resolve().parent.parent / "src" / "themes.json").read_text())

# A stand-in desktop bridge (window.mygo) for an init script: calls go to the web server's /api, and
# window.__settingsEvents[name](payload) delivers a native event such as a menu action.
BRIDGE = """window.__settingsEvents={};window.mygo={
 locale:'zh-CN',on:(name,fn)=>window.__settingsEvents[name]=fn,
 call:async(method,...args)=>{
  const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({method:method.replace(/^Desktop\\./,''),args,locale:'zh-CN'})}).then(r=>r.json());
  if(r.error)throw Error(r.error);return r.value;
 }
}"""


# The start of an element callback `e=>{...}` for evaluate(): defines contrast(a, b), the WCAG contrast ratio of two CSS
# colours, each resolved on the element e (so custom-property values and color-mix() work).
CONTRAST = """e=>{
 const rgb=c=>{const n=document.createElement('span');n.style.color=c;e.append(n);const s=getComputedStyle(n).color;n.remove();return s.match(/[\\d.]+/g).slice(0,3).map(Number)};
 const lum=c=>rgb(c).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
"""

def base_url():
    """The web server under test, from the command line (scripts/e2e.sh starts one and passes it)."""
    if len(sys.argv) < 2 or not sys.argv[1].startswith(("http://", "https://")):
        name = Path(sys.argv[0]).stem
        sys.exit(f"usage: scripts/e2e.sh {name}\n   or: python3 {sys.argv[0]} http://127.0.0.1:<port>  (a server started with go run . --web)")
    return sys.argv[1].rstrip("/")


def launch(kind, **options):
    """Start a headless browser. Chromium runs as the installed Chrome (PLAYWRIGHT_CHANNEL picks another channel); WebKit is Playwright's own."""
    if kind.name == "chromium":
        options.setdefault("channel", os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    return kind.launch(headless=True, **options)


def evidence(prefix):
    """A fresh directory for screenshots and logs. At exit it is removed if the check passed, and kept with its
    path printed if an exception ended the check or the check's FAILURES list (in checks that keep one) is not empty."""
    path = Path(tempfile.mkdtemp(prefix=prefix))

    def finish():
        failures = getattr(sys.modules.get("__main__"), "FAILURES", None)
        if getattr(sys, "last_exc", None) or getattr(sys, "last_value", None) or failures:
            print(f"Evidence: {path}", flush=True)
        else:
            shutil.rmtree(path, ignore_errors=True)

    atexit.register(finish)
    return path


def save_failure(artifacts, page, errors):
    """Screenshot the page and record its page errors."""
    page.screenshot(path=str(artifacts / "failure.png"))
    (artifacts / "errors.json").write_text(json.dumps(errors, ensure_ascii=False))


def api(page, method, *args):
    """Call a backend method through the web server's /api and return its value."""
    base = base_url()
    response = page.request.post(base + "/api", data={"method": method, "args": list(args)}, headers={"Origin": base})
    assert response.ok, response.text()
    body = response.json()
    assert not body.get("error"), body
    return body["value"]


def localized_api(page, method, *args, locale="zh-Hans"):
    """api() with the request locale set, so the backend answers in that language."""
    base = base_url()
    response = page.request.post(base + "/api", data={"method": method, "args": list(args), "locale": locale}, headers={"Origin": base})
    assert response.ok, response.text()
    result = response.json()
    assert not result.get("error"), result
    return result["value"]


def wait_state(page, check, timeout=7000):
    """Poll the backend state; Playwright treats an async wait_for_function predicate as already true."""
    for _ in range(timeout // 100):
        if check(api(page, "State")):
            return
        page.wait_for_timeout(100)
    raise AssertionError(api(page, "State")["current"])


def saved_position(page, check, timeout=7000):
    """Poll the persisted position; Playwright treats an async wait_for_function predicate as already true."""
    for _ in range(timeout // 100):
        current = api(page, "State")["current"]
        if check(current):
            return current
        page.wait_for_timeout(100)
    raise AssertionError(api(page, "State")["current"]["position"])


def wait_callback(page, predicate):
    """Wait up to 7 s for a condition that a Python-side page callback sets."""
    deadline = time.monotonic() + 7
    while not predicate() and time.monotonic() < deadline:
        page.wait_for_timeout(10)
    assert predicate(), "callback condition did not arrive"


def appearance_change(page, operation):
    """Run an operation and wait for the UpdateAppearance call it sends to succeed."""
    with page.expect_response(lambda r: r.url.endswith("/api") and '"UpdateAppearance"' in (r.request.post_data or "")) as pending:
        operation()
    assert not pending.value.json().get("error"), pending.value.text()


def set_theme(page, theme):
    """Paint a theme the way the app does, both root attributes. Assert right after: the app repaints the stored theme on its next minute tick or window focus."""
    scheme = "dark" if next(t["dark"] for t in THEMES if t["id"] == theme) else "light"
    page.evaluate("([theme, scheme]) => { const root = document.documentElement; root.dataset.liubaiTheme = theme; root.dataset.liubaiScheme = scheme }", [theme, scheme])


def palette(page, text):
    """Run a command from the command palette."""
    page.keyboard.press("Meta+k")
    page.locator("#command-search").fill(text)
    page.locator("#command-list button").filter(has_text=text).first.click()


def more_action(page, action):
    """Choose an item from the More menu."""
    page.locator("#more-button").click()
    page.locator(f'#more-menu [data-menu-action="{action}"]').click()
