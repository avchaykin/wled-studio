# /// script
# dependencies = ["mcp>=1.10,<2", "websockets>=12"]
# ///
"""Smoke test of the WLED MCP tools against a real device (mostly read-only).
Usage: WLED_DEVICES="desk=192.168.1.118" uv run mcp/test/smoke.py"""
import importlib.util, json, pathlib
p = pathlib.Path(__file__).resolve().parent.parent / "wled_mcp.py"
spec = importlib.util.spec_from_file_location("w", p); w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
st = w.wled_status(); print("status:", json.dumps({k: st[k] for k in ("device", "firmware", "leds", "on", "brightness", "scripts")}))
print("segments:", [(s["id"], s["effect"], s["colors"]) for s in st["segments"]])
print("effects 'fire':", [e["name"] for e in w.wled_effects("fire")][:6])
print("script effect:", next(e for e in w.wled_effects("aurora") if "script" in e))
print("palettes 'ocean':", w.wled_palettes("ocean"))
print("presets:", w.wled_presets())
snap = w.wled_snapshot(); print("snapshot:", [(s["id"], s["runs"][:2]) for s in snap["segments"]])
print("check bad:", w.glow_check('effect "X" { fn pixel(i) { return foo } }'))
print("check ok:", {k: v for k, v in w.glow_check((p.parent.parent / "glow/examples/comet.glow").read_text()).items() if k != "controls"})
print("install:", w.glow_install("comet", (p.parent.parent / "glow/examples/comet.glow").read_text()))
try:
    w.wled_segment(0, effect="Nonexistent Thing")
except Exception as e:
    print("bad effect ->", e)
