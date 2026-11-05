# /// script
# requires-python = ">=3.11"
# dependencies = ["wled>=0.21"]
# ///
"""Home Assistant compatibility check for WLED Studio firmware.

Drives a real device through python-wled — the library Home Assistant's WLED
integration is built on — and checks everything the integration relies on:
model parsing, effects/palettes/presets, master and segment control, Glow
script effects selectable by name, and the WebSocket push channel.
The device state is restored at the end.

Usage: WLED_HOST=192.168.1.118 uv run --python /opt/homebrew/bin/python3 test/ha/test_ha_compat.py
"""
import asyncio
import json
import os
import sys
import urllib.request

from wled import WLED

HOST = os.environ.get("WLED_HOST", "192.168.1.118")
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")


def raw(path: str, body: dict | None = None):
    req = urllib.request.Request(f"http://{HOST}{path}", data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read())


async def main() -> int:
    before = raw("/json/state")
    restore = {"on": before["on"], "bri": before["bri"],
               "seg": [{k: s[k] for k in ("id", "start", "stop", "fx", "sx", "ix", "pal", "col", "on", "bri") if k in s} for s in before["seg"]]}
    try:
        async with WLED(HOST) as led:
            dev = await led.update()
            info = dev.info
            check("device model parses", dev is not None)
            check("info: version/brand/product", bool(info.version) and info.brand == "WLED", f"ver {info.version}, product {info.product}")
            check("info: led count", info.leds.count > 0, f"{info.leds.count} LEDs")
            check("info: websocket supported", info.websocket is not None and info.websocket >= 0, f"websocket={info.websocket}")
            check("info: mac address present", bool(info.mac_address), info.mac_address)
            check("effects list parses", len(dev.effects) > 100, f"{len(dev.effects)} effects")
            names = {e.name for e in dev.effects.values()} if isinstance(dev.effects, dict) else {e.name for e in dev.effects}
            check("Glow script effects are listed by name", {"Aurora", "Comet", "Fire Bars"} <= names)
            check("palettes list parses", len(dev.palettes) > 50, f"{len(dev.palettes)} palettes")
            check("presets parse", isinstance(dev.presets, dict), f"{len(dev.presets)} presets")
            segs = dev.state.segments
            check("segments parse", len(segs) >= 1, f"{len(segs)} segments")

            # master control (what the HA light entity does)
            await led.master(on=True, brightness=60)
            st = raw("/json/state")
            check("master on + brightness", st["on"] and st["bri"] == 60, f"bri={st['bri']}")

            # segment control by effect *name*, including a Glow script effect
            await led.segment(0, effect="Comet", speed=90, intensity=200)
            seg0 = raw("/json/state")["seg"][0]
            glow_fx = {s["file"]: s["fx"] for s in raw("/json/info")["glow"]["slots"]}
            check("select Glow effect by name", seg0["fx"] == glow_fx.get("comet"), f"fx={seg0['fx']}")
            check("speed/intensity applied", seg0["sx"] == 90 and seg0["ix"] == 200)
            await led.segment(0, effect="Rainbow", palette="Ocean", color_primary=(255, 80, 0))
            seg0 = raw("/json/state")["seg"][0]
            check("built-in effect + palette + colour", seg0["col"][0][:3] == [255, 80, 0], f"fx={seg0['fx']} pal={seg0['pal']}")

            # WebSocket push: HA listens for state updates
            got: list = []
            await led.connect()
            listener = asyncio.create_task(led.listen(lambda d: got.append(d)))
            await asyncio.sleep(0.5)
            raw("/json/state", {"bri": 70})
            # the first message is the state sent on connect; wait for the pushed change
            for _ in range(40):
                if any(d.state.brightness == 70 for d in got):
                    break
                await asyncio.sleep(0.1)
            check("websocket pushes state updates", any(d.state.brightness == 70 for d in got),
                  f"{len(got)} update(s), bri={got[-1].state.brightness if got else None}")
            listener.cancel()
            await led.disconnect()

            dev2 = await led.update()
            check("re-read after changes parses", dev2.state.brightness == 70)
    except Exception as e:  # noqa: BLE001
        check("no exceptions from python-wled", False, f"{type(e).__name__}: {e}")
    finally:
        raw("/json/state", restore)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


sys.exit(asyncio.run(main()))
