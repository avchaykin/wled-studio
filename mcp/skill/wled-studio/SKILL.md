---
name: wled-studio
description: Control WLED LED lights running WLED Studio firmware through the wled-studio MCP tools — set scenes, split strips into segments, pick effects, palettes and colours, save presets, check what the LEDs actually show, and write custom Glow effect scripts that run on the device. Use when the user asks to change, design, animate or script their LED lights, or mentions WLED, segments, effects, palettes or Glow.
---

# WLED Studio

The `wled-studio` MCP server talks to WLED controllers over their JSON API. Tools are prefixed `wled_` (device state) and `glow_` (scripts).

## Working loop

1. **Look first.** Call `wled_status` before changing anything: it lists segments (LED ranges), each segment's effect, parameters by label, colours and palette. For "what does it look like now", call `wled_snapshot`.
2. **Remember the starting point.** Before a larger change (new layout, several segments), keep the `wled_status` result so you can restore it if the user dislikes the result. For anything the user may want back later, offer `wled_preset_save` first.
3. **Change the smallest thing** that does what was asked: `wled_segment` for one segment, `wled_layout` only when the segment ranges themselves change, `wled_power` for on/off/brightness.
4. **Verify** with `wled_snapshot` after visual changes, and tell the user what changed in plain words (segment names, effect names, colours), not raw ids.

## Facts that prevent mistakes

- Segments are LED ranges `[start, stop)`, stop exclusive. `wled_status` reports them as inclusive `leds: [first, last]`.
- Effects and palettes accept names; matching is case-insensitive, then prefix, then substring. If a name is ambiguous, call `wled_effects(query=...)` and pick explicitly.
- Effect parameters are per effect. Their labels come from `wled_status`/`wled_effects` (e.g. Fire 2012 has "Cooling", "Spark rate"). Pass them as `params={"Speed": 200}`; values are 0–255, toggles true/false.
- Selecting an effect loads its default parameters unless you pass `params` in the same call.
- Colours: up to three per segment, `#RRGGBB` (or `#RRGGBBWW` for RGBW strips). Effects only use the slots they declare (see `colors` in the effect metadata).
- Effects flagged `audio` react to sound only if the device has a microphone (AudioReactive); otherwise they idle.
- `brightness` on `wled_power` is the master (1–255); per-segment `brightness` is relative opacity.
- Presets store whole looks. Applying one replaces the current layout.
- Several devices may be configured; pass `device=` (name from `wled_devices`) when the user names a specific one.

## Glow scripts (custom effects)

Glow is a small JavaScript-like language compiled to bytecode and run by the firmware at frame rate. An installed script becomes a normal effect (selectable in the UI, presets and Home Assistant).

Read the resource `glow://reference` before writing a non-trivial script. Core shape:

```glow
effect "Ocean Drift" {
  speed = slider("Speed", 120)        // up to 5 sliders, 3 toggles; become effect parameters
  depth = slider("Depth", 80)
  uses palette, default "Ocean"

  fn pixel(i) {                        // called per LED; return a colour
    let n = noise(i / len * (depth / 16 + 1), t * speed / 200000)
    return pal(n * 255)
  }
}
```

- `fn pixel(i)` (1D) or `fn pixel(x, y)` (matrix) returns a colour per LED; or `fn frame()` draws imperatively with `set(i, c)`, `add`, `fade(n)`, `blur(n)`, `shift(n)`, `fill(c)`, `get(i)`.
- Built-ins: `t` (ms since start), `len`, `w`, `h`, `frame`; maths `sin cos tri saw sq` (period 1, output 0–1), `noise(x[,y[,z]])` 0–1, `beat(bpm)`, `random()`/`random(n)`, `mix clamp map smoothstep`; colour `rgb() hsv()` (0–255), `pal(index)`, `blend(a,b,f)`, `color(0..2)` (segment colours), `#ff8800` literals; `colour * 0.5` scales.
- `var` at the top of an effect keeps state between frames (`var heat = array(len)`); `let` is local. No recursion; loops are `for i in 0..n` and `while`.
- Audio: `audio.vol`, `audio.beat`, `audio.band(0..15)`.

Workflow: draft → `glow_check(source)` → fix the reported `line:col` error → `glow_install(file_name, source, run_on_segment=N)` → `wled_snapshot` to confirm it lights up. Keep per-pixel work modest: around 10 `noise()` calls per LED on 250 LEDs already halves the frame rate, and scripts that exceed the per-frame budget stop and show a dim red pattern (`glow_scripts` reports the error).

Never delete scripts (`glow_delete`) or presets the user did not ask you to remove.

## Escape hatch

`wled_json(path, body)` reaches any `/json/*` endpoint for features without a dedicated tool (night light `{"nl": {...}}`, sync `{"udpn": {...}}`, live data). Read `/json/state` first and send only the keys you change.
