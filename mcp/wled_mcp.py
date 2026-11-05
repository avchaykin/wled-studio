# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp>=1.10,<2", "websockets>=12"]
# ///
"""WLED Studio MCP server.

Lets an AI assistant control WLED devices: power and brightness, segments,
effects, palettes, colours, presets, live LED snapshots, and Glow scripts
(compiled with glow/cli.mjs, uploaded and run as WLED effects).

Run:   uv run mcp/wled_mcp.py                 (stdio transport)
Config: WLED_DEVICES="desk=192.168.1.118,shelf=192.168.1.120"  (first is default)
        or ~/.config/wled-studio/devices.json  {"desk": "192.168.1.118"}
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

REPO = Path(__file__).resolve().parent.parent
GLOW_CLI = REPO / "glow" / "cli.mjs"
GLOW_DOC = REPO / "docs" / "design" / "glow-language.md"
CONFIG = Path.home() / ".config" / "wled-studio" / "devices.json"

mcp = FastMCP(
    "wled-studio",
    instructions=(
        "Controls WLED LED controllers running WLED Studio firmware. Start with wled_status to see "
        "segments, effects and colours. Effects and palettes accept names (fuzzy) or numeric ids. "
        "Use wled_snapshot to see what the LEDs actually show. Write custom effects in the Glow "
        "language (read resource glow://reference first), check them with glow_check, then "
        "glow_install. Prefer small, reversible changes and report what changed."
    ),
)

# ---------------------------------------------------------------- devices


def _load_devices() -> dict[str, str]:
    devs: dict[str, str] = {}
    env = os.environ.get("WLED_DEVICES", "").strip()
    if env:
        for part in env.split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                devs[k.strip()] = v.strip()
            elif part.strip():
                devs[part.strip()] = part.strip()
    elif CONFIG.exists():
        devs.update(json.loads(CONFIG.read_text()))
    return devs


DEVICES = _load_devices()
_catalogue: dict[str, dict] = {}


def _host(device: str | None) -> str:
    if not DEVICES:
        raise ValueError("No devices configured. Call wled_add_device with an IP address first.")
    if device is None:
        return next(iter(DEVICES.values()))
    if device in DEVICES:
        return DEVICES[device]
    if re.fullmatch(r"[\w.\-:]+", device) and ("." in device or ":" in device):
        return device  # raw host/IP
    raise ValueError(f"Unknown device '{device}'. Known: {', '.join(DEVICES)}")


def _http(host: str, path: str, body: Any = None, method: str | None = None, raw: bytes | None = None,
          headers: dict | None = None, timeout: float = 8) -> Any:
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(f"http://{host}{path}", data=data, method=method or ("POST" if data else "GET"))
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            text = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{path}: HTTP {e.code}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Cannot reach {host}: {e.reason}") from None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _state(host: str, patch: dict) -> dict:
    res = _http(host, "/json/state", patch)
    if isinstance(res, dict) and res.get("error"):
        raise RuntimeError(f"Device rejected the change (error {res['error']})")
    return res


def _cat(host: str, refresh: bool = False) -> dict:
    """Effect/palette catalogue with parsed effect metadata, cached per host + script set."""
    info = _http(host, "/json/info")
    key = f"{host}|{info.get('vid')}|{','.join(s['file'] for s in (info.get('glow') or {}).get('slots', []))}"
    if not refresh and _catalogue.get(host, {}).get("key") == key:
        return _catalogue[host]
    eff = _http(host, "/json/eff")
    fxd = _http(host, "/json/fxdata")
    pal = _http(host, "/json/pal")
    scripts = {s["fx"]: s["file"] for s in (info.get("glow") or {}).get("slots", [])}
    effects = []
    for i, name in enumerate(eff):
        if not name or name == "RSVD" or name.startswith("-"):
            continue
        effects.append({"id": i, "name": name, **_fx_meta(i, fxd[i] if i < len(fxd) else None), **({"script": scripts[i]} if i in scripts else {})})
    _catalogue[host] = {"key": key, "effects": effects, "palettes": pal, "info": info}
    return _catalogue[host]


SLIDERS = ["sx", "ix", "c1", "c2", "c3"]
CHECKS = ["o1", "o2", "o3"]
SLIDER_DEFAULT = ["Speed", "Intensity", "Custom 1", "Custom 2", "Custom 3"]


def _fx_meta(fx_id: int, raw: str | None) -> dict:
    if fx_id == 0:
        return {"controls": {}, "colors": ["Colour"], "palette": False, "audio": False, "2d": False}
    defined = bool(raw)
    parts = raw.split(";") if defined else []
    sl = parts[0].split(",") if parts and parts[0] else []
    co = parts[1].split(",") if len(parts) > 1 and parts[1] else []
    flags = parts[3] if len(parts) > 3 else ""
    controls: dict[str, str] = {}
    for i in range(5):
        if (not defined and i < 2) or (i < len(sl) and sl[i]):
            controls[SLIDER_DEFAULT[i] if i >= len(sl) or sl[i] in ("", "!") else sl[i]] = SLIDERS[i]
    for i in range(3):
        if 5 + i < len(sl) and sl[5 + i]:
            controls[f"Option {i + 1}" if sl[5 + i] == "!" else sl[5 + i]] = CHECKS[i]
    colors = [("Primary", "Secondary", "Tertiary")[i] if not defined or co[i] == "!" else co[i]
              for i in range(3) if not defined or (i < len(co) and co[i])]
    return {"controls": controls, "colors": colors, "palette": not defined or (len(parts) > 2 and parts[2] != ""),
            "audio": bool(re.search("[vf]", flags)), "2d": "2" in flags and "1" not in flags}


def _resolve(kind: str, items: list[tuple[int, str]], want: str | int) -> int:
    if isinstance(want, int) or (isinstance(want, str) and want.isdigit()):
        return int(want)
    w = want.strip().lower()
    for pick in (lambda n: n.lower() == w, lambda n: n.lower().startswith(w), lambda n: w in n.lower()):
        hits = [i for i, n in items if pick(n)]
        if hits:
            return hits[0]
    near = [n for _, n in items if any(t in n.lower() for t in w.split())][:8]
    raise ValueError(f"No {kind} named '{want}'." + (f" Did you mean: {', '.join(near)}?" if near else ""))


def _hex(c: list[int] | None) -> str:
    c = c or [0, 0, 0]
    return "#" + "".join(f"{v:02x}" for v in c[:3]) + (f"{c[3]:02x}" if len(c) > 3 and c[3] else "")


def _rgb(s: str) -> list[int]:
    s = s.strip().lstrip("#")
    named = {"red": "ff0000", "green": "00ff00", "blue": "0000ff", "white": "ffffff", "black": "000000", "warm white": "ffb46b",
             "orange": "ff7a00", "yellow": "ffd400", "purple": "8a00ff", "pink": "ff00a8", "cyan": "00e0ff", "off": "000000"}
    s = named.get(s.lower(), s)
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    if not re.fullmatch(r"[0-9a-fA-F]{6}([0-9a-fA-F]{2})?", s):
        raise ValueError(f"Colour '{s}' is not #RRGGBB, #RRGGBBWW or a basic colour name")
    return [int(s[i:i + 2], 16) for i in range(0, len(s), 2)]


def _describe(host: str) -> dict:
    cat = _cat(host)
    st = _http(host, "/json/state")
    by_id = {e["id"]: e for e in cat["effects"]}
    segs = []
    for s in st.get("seg", []):
        if s.get("stop", 0) <= s.get("start", 0):
            continue
        fx = by_id.get(s["fx"], {"name": f"#{s['fx']}", "controls": {}, "colors": []})
        seg = {"id": s["id"], "name": s.get("n") or f"Segment {s['id']}", "leds": [s["start"], s["stop"] - 1], "on": s.get("on", True),
               "brightness": s.get("bri", 255), "effect": fx["name"], "effect_id": s["fx"],
               "params": {label: (bool(s.get(k)) if k.startswith("o") else s.get(k)) for label, k in fx.get("controls", {}).items()},
               "colors": {label: _hex(s["col"][i]) for i, label in enumerate(fx.get("colors", [])) if i < len(s.get("col", []))}}
        if fx.get("palette", True):
            seg["palette"] = cat["palettes"][s["pal"]] if s["pal"] < len(cat["palettes"]) else s["pal"]
        if fx.get("script"):
            seg["script"] = fx["script"]
        for flag, key in (("reverse", "rev"), ("mirror", "mi"), ("frozen", "frz")):
            if s.get(key):
                seg[flag] = True
        segs.append(seg)
    info = cat["info"]
    return {"device": info.get("name"), "firmware": info.get("ver"), "leds": info.get("leds", {}).get("count"),
            "on": st.get("on"), "brightness": st.get("bri"), "preset": st.get("ps"), "fps": info.get("leds", {}).get("fps"),
            "segments": segs, "scripts": [s["file"] for s in (info.get("glow") or {}).get("slots", [])],
            "max_segments": info.get("leds", {}).get("maxseg")}


def _seg_patch(host: str, cur: dict | None, effect=None, palette=None, colors=None, params=None) -> dict:
    cat = _cat(host)
    patch: dict[str, Any] = {}
    fx_id = cur["fx"] if cur else 0
    if effect is not None:
        fx_id = _resolve("effect", [(e["id"], e["name"]) for e in cat["effects"]], effect)
        patch["fx"] = fx_id
        patch["fxdef"] = True  # load the effect's default parameters first
    if palette is not None:
        patch["pal"] = _resolve("palette", list(enumerate(cat["palettes"])), palette)
    if colors:
        cols = [list(c) for c in (cur or {}).get("col", [[0, 0, 0], [0, 0, 0], [0, 0, 0]])]
        for i, c in enumerate(colors[:3]):
            if c is not None:
                cols[i] = _rgb(c)
        patch["col"] = cols
    if params:
        meta = next((e for e in cat["effects"] if e["id"] == fx_id), {"controls": {}})
        lower = {k.lower(): v for k, v in meta["controls"].items()}
        for label, value in params.items():
            key = label if label in SLIDERS + CHECKS else lower.get(label.lower())
            if not key:
                raise ValueError(f"Effect has no parameter '{label}'. Available: {', '.join(meta['controls']) or 'none'}")
            patch[key] = bool(value) if key.startswith("o") else max(0, min(255, int(value)))
        if effect is not None:
            patch.pop("fxdef", None)  # explicit params win over defaults
    return patch


# ---------------------------------------------------------------- tools: devices & state


@mcp.tool()
def wled_devices() -> dict:
    """List configured WLED devices (name -> address). The first one is the default."""
    return {"devices": DEVICES, "default": next(iter(DEVICES), None)}


@mcp.tool()
def wled_add_device(name: str, address: str) -> dict:
    """Register a device for this session (and remember it in ~/.config/wled-studio/devices.json)."""
    info = _http(address, "/json/info")
    DEVICES[name] = address
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps(DEVICES, indent=2))
    return {"added": name, "address": address, "firmware": info.get("ver"), "leds": info.get("leds", {}).get("count")}


@mcp.tool()
def wled_status(device: str | None = None) -> dict:
    """Current state: power, brightness, and every segment with its effect, parameters (by label), colours and palette."""
    return _describe(_host(device))


@mcp.tool()
def wled_power(on: bool | None = None, brightness: int | None = None, transition_ms: int | None = None, device: str | None = None) -> dict:
    """Turn lights on/off and/or set master brightness (1-255). transition_ms sets the fade time for this change."""
    patch: dict[str, Any] = {}
    if on is not None:
        patch["on"] = on
    if brightness is not None:
        patch["bri"] = max(1, min(255, brightness))
    if transition_ms is not None:
        patch["tt"] = max(0, transition_ms // 100)
    if not patch:
        raise ValueError("Give on and/or brightness")
    _state(_host(device), patch)
    st = _http(_host(device), "/json/state")
    return {"on": st["on"], "brightness": st["bri"]}


@mcp.tool()
def wled_segment(segment: int, effect: str | None = None, palette: str | None = None, colors: list[str] | None = None,
                 params: dict[str, float] | None = None, start: int | None = None, stop: int | None = None,
                 name: str | None = None, on: bool | None = None, brightness: int | None = None,
                 reverse: bool | None = None, mirror: bool | None = None, device: str | None = None) -> dict:
    """Change one segment. effect/palette: name or id. colors: up to 3 of '#RRGGBB' (primary, secondary, tertiary; null keeps).
    params: effect parameters by their label from wled_status/wled_effects (e.g. {"Speed": 200}). start/stop: LED range, stop exclusive."""
    host = _host(device)
    st = _http(host, "/json/state")
    cur = next((s for s in st["seg"] if s["id"] == segment), None)
    patch = _seg_patch(host, cur, effect, palette, colors, params)
    for k, v in (("start", start), ("stop", stop), ("n", name), ("on", on), ("bri", brightness), ("rev", reverse), ("mi", mirror)):
        if v is not None:
            patch[k] = v
    if not patch:
        raise ValueError("Nothing to change")
    _state(host, {"seg": [{"id": segment, **patch}]})
    return next(s for s in _describe(host)["segments"] if s["id"] == segment)


@mcp.tool()
def wled_layout(segments: list[dict], device: str | None = None) -> dict:
    """Replace the whole segment layout. Each item: {start, stop, name?, effect?, palette?, colors?, params?}.
    Ranges must not overlap; stop is exclusive. Segments beyond the list are removed."""
    host = _host(device)
    total = _cat(host)["info"]["leds"]["count"]
    st = _http(host, "/json/state")
    ordered = sorted(segments, key=lambda s: s["start"])
    for a, b in zip(ordered, ordered[1:]):
        if b["start"] < a["stop"]:
            raise ValueError(f"Segments overlap: {a['start']}-{a['stop']} and {b['start']}-{b['stop']}")
    out = []
    for i, s in enumerate(ordered):
        if not (0 <= s["start"] < s["stop"] <= total):
            raise ValueError(f"Range {s['start']}-{s['stop']} is outside 0-{total}")
        cur = next((x for x in st["seg"] if x["id"] == i), None)
        p = _seg_patch(host, cur, s.get("effect"), s.get("palette"), s.get("colors"), s.get("params"))
        out.append({"id": i, "start": s["start"], "stop": s["stop"], "on": True, **({"n": s["name"]} if s.get("name") else {}), **p})
    for x in st["seg"]:
        if x["id"] >= len(ordered) and x.get("stop", 0) > x.get("start", 0):
            out.append({"id": x["id"], "stop": 0})
    _state(host, {"seg": out})
    return _describe(host)


@mcp.tool()
def wled_effects(query: str | None = None, audio_only: bool = False, two_d: bool | None = None, device: str | None = None) -> list[dict]:
    """List effects (id, name, parameter labels, colour slots, palette use, audio/2D, script file). Filter by query substring."""
    effs = _cat(_host(device))["effects"]
    q = (query or "").lower()
    return [e for e in effs if (not q or q in e["name"].lower()) and (not audio_only or e["audio"]) and (two_d is None or e["2d"] == two_d)]


@mcp.tool()
def wled_palettes(query: str | None = None, device: str | None = None) -> list[dict]:
    """List palettes (id, name), optionally filtered by a substring."""
    q = (query or "").lower()
    return [{"id": i, "name": n} for i, n in enumerate(_cat(_host(device))["palettes"]) if not q or q in n.lower()]


@mcp.tool()
def wled_presets(device: str | None = None) -> list[dict]:
    """List saved presets and playlists."""
    ps = _http(_host(device), "/presets.json")
    return [{"id": int(k), "name": v.get("n") or f"Preset {k}", "playlist": "playlist" in v} for k, v in ps.items() if k != "0" and isinstance(v, dict)]


@mcp.tool()
def wled_preset_apply(preset: str, device: str | None = None) -> dict:
    """Apply a preset or playlist by name or id."""
    host = _host(device)
    ps = wled_presets(device)
    pid = _resolve("preset", [(p["id"], p["name"]) for p in ps], preset)
    _state(host, {"ps": pid})
    return {"applied": pid}


@mcp.tool()
def wled_preset_save(name: str, device: str | None = None) -> dict:
    """Save the current look as a new preset (uses the first free id)."""
    host = _host(device)
    ids = {p["id"] for p in wled_presets(device)}
    pid = next(i for i in range(1, 251) if i not in ids)
    _state(host, {"psave": pid, "n": name, "ib": True, "sb": True})
    return {"saved": pid, "name": name}


@mcp.tool()
def wled_snapshot(device: str | None = None) -> dict:
    """What the LEDs show right now, per segment, as runs of colour (e.g. '#ff0000 x85'). Use it to verify changes."""
    from websockets.sync.client import connect

    host = _host(device)
    desc = _describe(host)
    with connect(f"ws://{host}/ws", open_timeout=5, close_timeout=1) as ws:
        ws.send('{"lv":true}')
        frame = None
        deadline = time.time() + 4
        while time.time() < deadline:
            msg = ws.recv(timeout=max(0.1, deadline - time.time()))
            if isinstance(msg, bytes) and msg[:1] == b"L":
                frame = msg
                break
        ws.send('{"lv":false}')
    if not frame:
        raise RuntimeError("No live frame received (is another client holding the live view?)")
    off = 4 if frame[1] == 2 else 2
    px = [frame[i:i + 3] for i in range(off, len(frame) - 2, 3)]
    total = desc["leds"] or len(px)

    def runs(a: int, b: int) -> list[str]:
        out, last, n = [], None, 0
        for i in range(a, b):
            c = px[min(len(px) - 1, i * len(px) // total)]
            h = "#%02x%02x%02x" % tuple(c)
            # merge near-identical neighbours so gradients stay readable
            if last and sum(abs(int(h[k:k + 2], 16) - int(last[k:k + 2], 16)) for k in (1, 3, 5)) <= 24:
                n += 1
            else:
                if last:
                    out.append(f"{last} x{n}")
                last, n = h, 1
        if last:
            out.append(f"{last} x{n}")
        return out[:40] + ([f"... {len(out) - 40} more runs"] if len(out) > 40 else [])

    return {"on": desc["on"], "brightness": desc["brightness"],
            "segments": [{"id": s["id"], "name": s["name"], "effect": s["effect"], "runs": runs(s["leds"][0], s["leds"][1] + 1)} for s in desc["segments"]]}


@mcp.tool()
def wled_json(path: str = "/json/state", body: dict | None = None, device: str | None = None) -> Any:
    """Escape hatch: GET (no body) or POST (body) any WLED JSON API path, e.g. '/json/info' or '/json/state' with {"nl":{"on":true}}."""
    if not path.startswith("/json"):
        raise ValueError("Only /json/* paths are allowed")
    return _http(_host(device), path, body)


# ---------------------------------------------------------------- tools: Glow scripts


def _glow(cmd: str, source: str) -> dict:
    try:
        r = subprocess.run(["node", str(GLOW_CLI), cmd, "-", "--json"], input=source, capture_output=True, text=True, timeout=20)
    except FileNotFoundError:
        raise RuntimeError("Node.js is needed to compile Glow scripts (node not found on PATH)") from None
    out = (r.stdout or "").strip().splitlines()
    if not out:
        raise RuntimeError(f"Glow compiler failed: {r.stderr.strip()[:400]}")
    return json.loads(out[-1])


def _multipart(path: str, data: bytes, ctype: str) -> tuple[bytes, str]:
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"data\"; filename=\"{path}\"\r\nContent-Type: {ctype}\r\n\r\n").encode() + data + f"\r\n--{b}--\r\n".encode()
    return body, f"multipart/form-data; boundary={b}"


@mcp.tool()
def glow_check(source: str) -> dict:
    """Compile a Glow script without uploading. Returns {ok, name, size, controls} or {ok:false, error:{line, col, message}}."""
    return _glow("check", source)


@mcp.tool()
def glow_install(file_name: str, source: str, run_on_segment: int | None = None, start_show: bool = False, device: str | None = None) -> dict:
    """Compile a Glow script, upload it as /glow/<file_name>.glow/.glw and load it.
    Effects appear as normal effects (optionally applied to run_on_segment). Shows are event scripts
    (on start / every / at / button / beat) that orchestrate segments; start_show=true starts one now.
    file_name: lowercase letters, digits, - and _."""
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", file_name):
        raise ValueError("file_name must be 1-32 chars of a-z, 0-9, - and _")
    host = _host(device)
    res = _glow("compile", source)
    if not res.get("ok"):
        return res
    if "glow" not in _http(host, "/json/info"):
        raise RuntimeError("This device's firmware has no Glow engine (flash WLED Studio firmware)")
    for suffix, data, ctype in ((".glow", source.encode(), "text/plain"), (".glw", base64.b64decode(res["image"]), "application/octet-stream")):
        body, ct = _multipart(f"/glow/{file_name}{suffix}", data, ctype)
        _http(host, "/upload", raw=body, headers={"Content-Type": ct}, timeout=15)
    _state(host, {"glow": {"reload": True}})
    if res.get("kind") == "show":
        for _ in range(20):
            time.sleep(0.25)
            if file_name in ((_http(host, "/json/info").get("glow") or {}).get("shows") or []):
                break
        else:
            raise RuntimeError("Uploaded, but the device did not list the show")
        if start_show:
            _state(host, {"glow": {"show": file_name}})
        return {"installed": file_name, "kind": "show", "show_name": res["name"], "bytes": res["size"], "started": start_show}
    slot = None
    for _ in range(20):
        time.sleep(0.25)
        slot = next((s for s in (_http(host, "/json/info").get("glow") or {}).get("slots", []) if s["file"] == file_name), None)
        if slot:
            break
    if not slot:
        raise RuntimeError("Uploaded, but the device did not load the script (check its size and the device log)")
    _catalogue.pop(host, None)
    if run_on_segment is not None:
        _state(host, {"seg": [{"id": run_on_segment, "fx": slot["fx"], "fxdef": True}]})
    return {"installed": file_name, "effect_name": res["name"], "effect_id": slot["fx"], "bytes": res["size"],
            "controls": [c["label"] for c in res["controls"]], "running_on": run_on_segment, "error": slot.get("err")}


@mcp.tool()
def glow_scripts(device: str | None = None) -> dict:
    """Glow scripts on the device: effects (with effect id and any runtime error), shows, and the running show."""
    g = _http(_host(device), "/json/info").get("glow") or {}
    return {"effects": g.get("slots", []), "shows": g.get("shows", []), "running_show": g.get("show"), "show_error": g.get("showErr")}


@mcp.tool()
def glow_show(name: str | None = None, device: str | None = None) -> dict:
    """Start the installed show `name`, or stop the running show when name is omitted/empty.
    A running show is part of the state, so saving a preset while it runs makes that preset start it."""
    host = _host(device)
    _state(host, {"glow": {"show": name or ""}})
    time.sleep(0.4)
    g = _http(host, "/json/info").get("glow") or {}
    return {"running_show": g.get("show"), "error": g.get("showErr")}


@mcp.tool()
def glow_source(file_name: str, device: str | None = None) -> str:
    """Read the source of an installed Glow script."""
    return _http(_host(device), f"/glow/{file_name}.glow")


@mcp.tool()
def glow_delete(file_name: str, device: str | None = None) -> dict:
    """Delete an installed Glow script (its effect id becomes free)."""
    _state(_host(device), {"glow": {"del": file_name}})
    return {"deleted": file_name}


@mcp.resource("glow://reference")
def glow_reference() -> str:
    """Glow language reference: syntax, built-ins, controls, examples."""
    examples = "\n\n".join(f"### {p.name}\n```glow\n{p.read_text()}\n```" for p in sorted((REPO / "glow" / "examples").glob("*.glow")))
    return GLOW_DOC.read_text() + "\n\n## Examples\n\n" + examples


if __name__ == "__main__":
    mcp.run()
