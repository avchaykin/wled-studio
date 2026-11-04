# Glow — scripting for WLED Studio

Status: draft v0.1 (2026-11-04)

Glow is a small, JavaScript-flavoured language for LED effects and light shows.
Scripts are compiled to compact bytecode by a compiler written in JavaScript
(runs in the web UI, in Node for the MCP bridge, and in tests) and executed by a
stack VM inside the firmware. A JavaScript port of the same VM runs in the
browser for offline preview; a shared conformance suite keeps both VMs in step.

## Goals

- **Readable by people and LLMs.** Familiar C/JS syntax, few concepts, no surprises.
- **Safe on the device.** No dynamic allocation while running, bounded instruction
  budget per frame, bad bytecode is rejected by a verifier before it runs.
- **Fast enough.** Per-pixel shaders for 1–2k LEDs at 40+ fps on a classic ESP32.
- **First-class WLED citizens.** A Glow effect appears in the normal effect list
  (so Home Assistant, presets, playlists and sync all work), with its own sliders.

## Two kinds of script

### 1. Effects — draw pixels for one segment

```glow
effect "Aurora" {
  // UI controls map onto WLED's sx/ix/c1..c3/o1..o3 slots and the palette
  speed  = slider("Speed", 128)
  scale  = slider("Scale", 64)
  shimmer = toggle("Shimmer", false)
  uses palette, default "Ocean"

  // per-pixel shader: called for every LED, returns a colour
  fn pixel(i) {
    let x = i / len
    let n = noise(x * scale / 8, t * speed / 50000)
    let c = pal(n * 255)
    if shimmer { c = c * (0.8 + 0.2 * random()) }
    return c
  }
}
```

An effect defines either `fn pixel(i)` (1D), `fn pixel(x, y)` (2D), or
`fn frame()` for imperative drawing (`set`, `add`, `fade`, `blur`, `shift`).
Top-level `var` declarations inside an effect are per-segment state that persists
between frames (stored in the segment's effect data buffer); `let` is frame-local.

```glow
effect "Comet" {
  speed = slider("Speed", 128)
  var pos = 0

  fn frame() {
    fade(32)
    pos = (pos + speed / 400) % len
    set(pos, color(0))           // segment primary colour
  }
}
```

### 2. Shows — orchestrate segments, effects and state over time

```glow
show "Evening" {
  on start {
    segments.split([0.5, 0.5])
    seg(0).effect("Aurora").palette("Ocean")
    seg(1).effect("Comet").colors(#ff6000)
  }
  every 30s { seg(0).palette(next) }
  at "23:00" { fadeTo(bri: 0, over: 10m) }
  on button(0) { preset(next) }
  on beat     { seg(1).flash(#ffffff, 80ms) }   // needs AudioReactive
}
```

A show is event-driven: handlers run to completion, never per pixel. One show
can be active at a time; it is a preset-able state like any other.

## Values and types

| Type | Literal | Notes |
|---|---|---|
| number | `1`, `0.5`, `1e3`, `250ms`, `2s`, `5m` | float32; time suffixes convert to ms |
| colour | `#ff8000`, `#ff800020` (RGBW), `rgb(..)`, `hsv(..)` | packed RGBW; arithmetic is per-channel saturating |
| bool | `true`, `false` | |
| array | `array(n)`, `[1, 2, 3]` | fixed size, numbers or colours; only in `var` (allocated once) |
| string | `"Ocean"` | only as arguments to API calls (names of effects, palettes) |

Operators: `+ - * / %`, comparisons, `&& || !`, `?:`. `colour * number` scales,
`colour + colour` adds, `colour - colour` subtracts.

Statements: `let`, `var`, assignment (`=`, `+=` …), `if/else`, `for i in 0..n`,
`while`, `break`, `continue`, `return`, `fn name(args) { }` helper functions.
No recursion (the compiler rejects call cycles, so stack depth is known statically).

## Built-ins (effects)

Context: `t` (ms since effect start), `frame`, `len` (segment length), `w`, `h`
(2D size), `i`/`x`/`y` (arguments), `speed`/`intensity`/`c1..c3` raw 0–255 when
no named control is declared, `color(0..2)` segment colours.

Maths: `sin cos tri saw sq` (period 1.0, output 0..1), `abs min max clamp floor
ceil round fract mix smoothstep sqrt pow map(v, a, b, c, d)`, `random()` 0..1,
`random(n)`, `noise(x [, y [, z]])` 0..1, `beat(bpm)` 0..1 sawtooth synced to time.

Colour: `rgb(r,g,b[,w])`, `hsv(h,s,v)` all 0..255, `pal(index)` segment palette,
`pal("Name", index)`, `blend(a, b, f)`, `bright(c, v)`, `r(c) g(c) b(c) w(c)`.

Drawing (`fn frame()`): `set(i, c)`, `set(x, y, c)`, `add(i, c)`, `get(i)`,
`fill(c)`, `fade(amount)`, `blur(amount)`, `shift(n)`, `line(...)`, `circle(...)`.
Fractional positions in `set`/`add` are antialiased across two pixels.

Audio (when AudioReactive is present, zeros otherwise): `audio.vol`, `audio.peak`,
`audio.beat` (bool), `audio.band(n)` for n = 0..15, `audio.freq` (dominant Hz).

## Built-ins (shows)

`seg(n)` returns a segment handle with chainable setters: `.effect(name|id)`,
`.palette(name|id|next)`, `.colors(c1[, c2[, c3]])`, `.speed(v)`, `.intensity(v)`,
`.bri(v)`, `.on(bool)`, `.range(start, stop)`, `.flash(c, dur)`.
`segments.split([fractions])`, `segments.clear()`, `preset(id|next)`,
`fadeTo(bri:, over:)`, `state.on`, `state.bri`, `wait(dur)` (inside handlers,
suspends the handler; the VM keeps running other work).

Events: `on start`, `on stop`, `every <dur>`, `at "HH:MM"`, `on button(n)`,
`on beat`, `on preset(n)`, `on message("name")` (from JSON API / MCP / HA).

## Bytecode and VM (summary — see glow-vm.md once written)

- Program image: header (magic `GLW1`, version, kind), constant pool, control
  descriptors, function table, code. Typically 0.3–3 KB.
- 32-bit tagged values; operand stack and locals sized by the compiler and
  checked by the verifier, so the VM never grows memory at run time.
- Per-frame instruction budget; scripts that exceed it are paused and the
  segment shows an error pattern instead of locking up the device.
- Images live in LittleFS under `/glow/*.glw` with source in `/glow/*.glow`.
  On boot each effect image registers as a WLED effect (`strip.addEffect`),
  so its name and control metadata appear in `/json/effects` and `/json/fxdata`.

## Open questions

- Whether `pixel()` shaders should get a precomputed `x = i/len` to save ops.
- How many effect slots to reserve (proposal: 16, adjustable at compile time).
- Exact name of the language — "Glow" is a placeholder.
