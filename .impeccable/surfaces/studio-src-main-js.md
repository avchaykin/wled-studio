---
version: 1
slug: "studio-src-main-js"
primary_target: "studio/src/main.js"
related_targets: []
---

# Surface: WLED Studio app (studio/)

Mode: Operate. Built code-led (working screen).

Audience & job: the builder at a desk next to the lights, designing a look — segmenting the strip, picking effects/palettes/colours, tuning parameters, writing Glow scripts. Phone for quick tweaks. Frequency: long sessions.
Constraints: ≤ ~50 KB gzip total from ESP32 flash; Preact + own components; WebSocket state echoes must never move a control the user is touching; multi-device switcher later.
User-pinned direction (2026-11-05): "Pro tool" — Linear/Figma-like, dense, crisp, keyboard friendly, desktop-first, neutral greys + one accent. Top priority: kill interaction lag.

## Direction contract
THESIS: The strip is a timeline. Segments are clips on one lane under an LED ruler, and each clip renders the live pixels of its LEDs — preview and segment editor are the same object. Refuses the remote-control layout (big cards, stacked tabs, a separate preview box above a separate bar).
OWN-WORLD: Graphite neutrals (cool, 4 steps: canvas #0e0f11, panel #15171a, raised #1c1f23, line #2a2e34), text #e6e8eb / #a6acb4 / #8a9099 (tertiary raised for ≥4.5:1), one accent: cobalt #5b8cff for selection, focus and primary action only. 13px system UI, tabular numerals, 28px controls, 1px hairlines, 6px radii, authored 16px stroke icons. No glows, no gradients except real palettes.
STORY: The builder sees the whole strip live, selects a clip, adjusts it in the inspector, and the LEDs answer at once; ⌘K reaches any effect, palette, preset or action.
FIRST VIEWPORT: 44px top bar (device, connection, power, master brightness with number, ⌘K). 56px rail left with icon + short label (amended 2026-11-05: labels kept because four sections with 10px labels read faster than icon-only for a tool used daily; 44px fits the 28px controls with even 8px padding). Centre top: timeline — ruler, full-width live strip, clip lane with drag handles. Centre below: library (Effects / Palettes) as a dense searchable list. Right: 320px inspector (Effect, Parameters, Colours, Palette, Segment). Phone: rail → bottom bar, inspector below timeline.
FORM: user-pinned "Pro tool" (Linear/Figma register), chosen by the user from three offered directions on 2026-11-05. No concept-seed roll was run: new-work routes a user-pinned direction past the roll ("a user- or brief-pinned direction beats the roll, always"), so no seed reference exists. seed: none (pinned)
Signature interaction: clips render live LEDs; drag edges with snapping and an LED-index readout; S splits at the hovered LED.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
