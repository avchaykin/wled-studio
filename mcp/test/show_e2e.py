# /// script
# dependencies = ["mcp>=1.10,<2", "websockets>=12"]
# ///
"""End-to-end test of Glow show scripts on a real device: install, start, timed event, stop, clean up.
Restores the segment layout it found. Usage: WLED_DEVICES="desk=192.168.1.118" uv run mcp/test/show_e2e.py"""
import importlib.util, json, pathlib, sys, time
p = pathlib.Path(__file__).resolve().parent.parent / "wled_mcp.py"
spec = importlib.util.spec_from_file_location("w", p); w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
host = w._host(None)
SRC = """show "E2E" {
  var n = 0
  on start { split(2); seg(0).effect("Solid").colors(#ff0000); seg(1).effect("Solid").colors(#0000ff) }
  every 2s { n += 1; seg(0).colors(n % 2 == 0 ? #ff0000 : #00ff00) }
  on stop { seg(1).colors(#ffffff) }
}"""

before = w._http(host, "/json/state")
fails = []
def check(name, ok, got=None):
    print(("ok  " if ok else "FAIL"), name, "" if ok else got)
    if not ok: fails.append(name)
def segs():
    return [(s["start"], s["stop"], s["fx"], s["col"][0][:3]) for s in w._http(host, "/json/state")["seg"]]

try:
    r = w.glow_install("e2e-show", SRC, start_show=True); print("install:", r)
    check("listed and started", r.get("kind") == "show" and r.get("started"), r)
    time.sleep(1)
    st = w._http(host, "/json/state")
    check("state reports running show", (st.get("glow") or {}).get("show") == "e2e-show", st.get("glow"))
    s = segs(); check("on start split into 2 solid segments", len(s) == 2 and s[0][3] == [255, 0, 0] and s[1][3] == [0, 0, 255], s)
    seen = set()
    for _ in range(10):
        time.sleep(0.6); seen.add(tuple(segs()[0][3]))
    check("every 2s alternates colour", {(255, 0, 0), (0, 255, 0)} <= seen, seen)
    check("no runtime error", not w.glow_scripts().get("show_error"), w.glow_scripts())
    r = w.glow_show(None); print("stop:", r)
    check("stopped", r.get("running_show") is None, r)
    check("on stop ran", segs()[1][3] == [255, 255, 255], segs())
    info = w._http(host, "/json/info")
    print("heap", info["freeheap"], "uptime", info["uptime"])
finally:
    w.glow_show(None)
    w.glow_delete("e2e-show")
    keys = ['id', 'start', 'stop', 'grp', 'spc', 'of', 'on', 'bri', 'col', 'fx', 'sx', 'ix', 'pal', 'c1', 'c2', 'c3', 'rev', 'mi', 'o1', 'o2', 'o3', 'n']
    seg = [{k: s[k] for k in keys if k in s} for s in before["seg"]]
    ids = {s["id"] for s in seg}; seg += [{"id": i, "stop": 0} for i in range(8) if i not in ids]
    w._state(host, {"on": before["on"], "bri": before["bri"], "seg": seg})
    time.sleep(1)
    restored = [(s["start"], s["stop"], s["col"][0][:3]) for s in w._http(host, "/json/state")["seg"]]
    want = [(s["start"], s["stop"], s["col"][0][:3]) for s in before["seg"]]
    check("original layout restored", restored == want, restored)
print("PASS" if not fails else f"FAILED: {fails}")
sys.exit(1 if fails else 0)
