---
name: WLED Studio
description: Dense, dark, keyboard-first studio for designing LED looks next to the lights.
colors:
  canvas: "#0e0f11"
  panel: "#15171a"
  raised: "#1c1f23"
  hover: "#23272c"
  line: "#2a2e34"
  line-strong: "#3a3f46"
  text: "#e6e8eb"
  text-secondary: "#a6acb4"
  text-tertiary: "#8a9099"
  cobalt: "#5b8cff"
  cobalt-hover: "#6b98ff"
  cobalt-text: "#8fb0ff"
  cobalt-soft: "rgb(91 140 255 / 0.14)"
  danger: "#f2555a"
  danger-text: "#ffb3b5"
  ok: "#3ecf8e"
  white: "#ffffff"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, Roboto, Helvetica Neue, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  name:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, Roboto, Helvetica Neue, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, Roboto, Helvetica Neue, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, Roboto, Helvetica Neue, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.06em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, Roboto, Helvetica Neue, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, Roboto, Helvetica Neue, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, SF Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  xs: "4px"
  sm: "5px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  full: "999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-hover}"
  button-ghost:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  icon-button:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    size: "28px"
  icon-button-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
  picker:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 6px 0 8px"
    height: "28px"
  number-field:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    typography: "{typography.mono}"
    rounded: "{rounded.xs}"
    height: "24px"
    width: "44px"
  text-field:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "28px"
  switch-track:
    backgroundColor: "{colors.line-strong}"
    rounded: "{rounded.lg}"
    width: "26px"
    height: "16px"
  switch-track-on:
    backgroundColor: "{colors.cobalt}"
  library-row:
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "30px"
  library-row-current:
    backgroundColor: "{colors.cobalt-soft}"
    textColor: "{colors.cobalt-text}"
  filter-chip:
    textColor: "{colors.text-tertiary}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
    height: "24px"
  filter-chip-pressed:
    backgroundColor: "{colors.cobalt-soft}"
    textColor: "{colors.cobalt-text}"
  tag:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-tertiary}"
    typography: "{typography.micro}"
    rounded: "{rounded.xs}"
    padding: "0 5px"
    height: "16px"
  popover:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.lg}"
  command-palette:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    width: "600px"
  search-item:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "30px"
  search-item-highlighted:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
  toast:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "6px 6px 6px 14px"
  clip-label:
    backgroundColor: "rgb(14 15 17 / .78)"
    textColor: "{colors.text}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "1px 6px"
  clip-label-selected:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.white}"
  kbd:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.xs}"
    padding: "0 4px"
    height: "18px"
---

# Design System: WLED Studio

## Overview

**Creative North Star: "The Lighting Desk"**

WLED Studio is a professional tool that sits beside a strip of LEDs in a dim room. The interface is graphite and recessive so the only saturated colour on screen is the light itself: live pixels inside the timeline clips, palette swatch bars, colour swatches. Everything the builder touches is small, crisp and exact, in the register of Linear and Figma: 13px system UI with tabular numerals, 28px controls, 1px hairlines, 6px corners, authored 16px stroke icons.

The system is dark-only, and that is a scene decision, not a theme preference. The builder judges LED output by eye, often with the room lights low; a bright UI would wash out their perception of the strip and fight the preview for attention. There is no light mode and none should be added without revisiting that scene (`color-scheme: dark`, theme-color matches the panel).

Density is the default. Panels are separated by hairlines and four tonal steps, never by cards or shadows. One accent, cobalt, marks what is selected, focused, engaged or primary; it never decorates. Interaction speed is part of the visual system: a control the user is holding never moves under them, and the LEDs answer on the next frame.

**Key Characteristics:**
- Dark-only graphite in four tonal steps; the light is the only colour.
- One accent (cobalt) reserved for selection, focus, engaged state and the primary action.
- 13px system UI, tabular numerals everywhere, monospace only for values that are code-like (hex, IP, scripts).
- 28px control height (32px on narrow screens), 1px hairlines, 6px radius.
- Keyboard-first: every list is arrow-navigable, every common action has a single-key shortcut, ⌘K reaches everything.
- Input ownership: local state renders immediately, device echoes never override a touched control.

## Colors

A cool graphite ramp with one cobalt voice; status colours appear only as small signals.

### Primary
- **Cobalt** (`cobalt`): Selection, focus and primary action. Focus rings (2px outline), selected clip ring and its label chip, primary button fill, checked switch track, slider fill up to the value, power button when lights are on, timeline cursor while dragging, active edge handle.
- **Cobalt Hover** (`cobalt-hover`): hover fill of the primary button only.
- **Cobalt Text** (`cobalt-text`): cobalt as text or icon on dark surfaces (current library row name, pressed filter, current rail item icon, selected search-list item). Use this, not `cobalt`, whenever cobalt is foreground at text size.
- **Cobalt Soft** (`cobalt-soft`): tinted background of the current item in lists and tables (current effect/palette row, current preset row, current script file, pressed filter chip).

### Neutral
- **Canvas** (`canvas`): app background, timeline band, and the recessed fill of every input (pickers, number fields, hex fields, text fields). Inputs are darker than the panel they sit on.
- **Panel** (`panel`): top bar, rail, inspector, editors, compact search boxes.
- **Raised** (`raised`): popovers, command palette, toast, default buttons, selected segmented tab, tags, kbd keys.
- **Hover** (`hover`): hover fill for rows, icon buttons, ghost buttons and highlighted list items.
- **Line** (`line`): every hairline divider and resting input border.
- **Line Strong** (`line-strong`): borders on floating surfaces and buttons, input borders on hover, unfilled slider track, switch off-track, scrollbar thumb, ruler ticks.
- **Text** (`text`): primary text and values.
- **Text Secondary** (`text-secondary`): control labels, section headers, default icon colour.
- **Text Tertiary** (`text-tertiary`): hints, units, counts, placeholders, ruler numbers, metadata. Raised from a dimmer grey so it holds at least 4.5:1 on every surface up to `hover`.

### Status
- **Danger** (`danger`) and **Danger Text** (`danger-text`): disconnected dot, destructive icon-button hover, error tag, compile-error gutter line; `danger-text` for error prose on a 6-12% danger tint.
- **OK** (`ok`): the connected dot and a successful compile status. Nothing else.

### Named Rules
**The Light Is the Colour Rule.** Saturated colour on screen comes from the device: live pixels in clips, the matrix preview, palette swatch bars, colour swatches, the hue strip. Chrome stays graphite.

**The One Voice Rule.** Cobalt means "this is selected, focused, engaged, or the primary action". It is never used for decoration, headings, links-as-ornament or illustration. If a screen has two cobalt fills, one of them should be a selection.

**The Recessed Input Rule.** Fields are darker than their surroundings (`canvas` on `panel`), with a transparent or `line` border at rest, `line-strong` on hover and `cobalt` on focus.

## Typography

**Body Font:** system UI stack (-apple-system, Segoe UI, Roboto, Helvetica Neue)
**Mono Font:** ui-monospace stack (SF Mono, Menlo, Consolas)

**Character:** One native sans at small sizes, set for reading values rather than headlines. The system stack costs zero bytes from the ESP32's flash and renders crisply at 10-13px. Tabular numerals are on globally so values never jitter while they change.

### Hierarchy
- **Title** (600, 15px): page headings on Presets, Scripts, Settings.
- **Name** (600, 14px): the editable segment name at the top of the inspector.
- **Body** (400, 13px, 1.4): all controls, rows, buttons, prose. Becomes 14px at ≤860px.
- **Label** (600, 11px, 0.06em, uppercase, `text-secondary`): inspector section headers (Effect, Colours, Layout) and side-panel headings. These are the headings of their sections, not ornaments above another heading.
- **Caption** (400-500, 11px, `text-tertiary`): field labels, hints, counts, table headers (600), clip labels (500).
- **Micro** (10px): rail labels (400), ruler ticks, tags and the cursor readout chip (600). Rail labels become 11px on the bottom bar.
- **Mono** (12px; 1.6 in the code editor): hex values, IP address, script source, gutter, compile status.

### Named Rules
**The Tabular Rule.** `font-variant-numeric: tabular-nums` is global; any number that can change while visible must not shift its neighbours.

**The No Display Face Rule.** There is no display size. The largest type is 15px; hierarchy comes from weight, case and the grey ramp, not from scale.

## Layout

A fixed application shell, not a document. Desktop: 44px top bar across, 56px icon-and-label rail on the left, main area filling the rest (`100dvh`). The Lights page splits main into a work area (timeline on top, library list below, scrolling independently) and a 320px inspector on the right. Other pages are padded documents (20px 24px, max 1200px), with two-column grids that collapse to one.

Spacing runs on a 4px base with 2px for hairline gaps between tight items: 4 / 8 / 12 / 16 / 24 / 32. Inside controls, 6px and 10px insets appear for optical balance next to icons. Panel sections pad 12px top, 16px left, 12px right; section bodies stack controls at 8px.

Control heights are fixed: 28px standard (`--ctl`), 24px for inline number/hex fields and filter chips, 30px for list rows and search-list items, 36px search header in popovers, 46px in the command palette, 40px table rows.

The library is a dense auto-fill grid of rows (min 220px columns, 1px row gap), so the full effect catalogue is scannable at once.

**Breakpoints.** At ≤1080px the ⌘K trigger collapses to its icon. At ≤860px: `--ctl` becomes 32px and body 14px; the rail moves to a bottom bar (with safe-area inset); the inspector stacks under the timeline and the library goes last; library rows grow to 40px with always-visible 40px favourite buttons; slider thumbs grow to 18px on a 32px hit area. On `hover: none` devices, timeline edge handles widen to 28px and show at rest.

## Elevation & Depth

Flat by default. Depth on the shell is tonal: canvas, panel, raised, hover, separated by 1px hairlines. Shadows exist only on things that float above the shell, plus a few functional micro-shadows.

### Shadow Vocabulary
- **Popover** (`0 12px 32px rgb(0 0 0 / .5), 0 2px 6px rgb(0 0 0 / .35)`): pickers and colour picker.
- **Dialog** (`0 24px 64px rgb(0 0 0 / .6)`, backdrop `rgb(0 0 0 / .45)`): command palette.
- **Toast** (`0 8px 24px rgb(0 0 0 / .5)`).
- **Thumb** (`0 1px 3px rgb(0 0 0 / .5)`): slider thumbs and colour-picker dots, so a white knob reads on any colour.
- **Tab lift** (`0 1px 2px rgb(0 0 0 / .4)`): the selected segmented tab.
- **Inset rings** (`inset 0 0 0 1px rgb(255 255 255 / .08-.28)`): edges of clips, swatches and swatch bars, so colour content keeps its boundary against dark chrome.

### Named Rules
**The Flat Shell Rule.** Nothing docked to the shell casts a shadow. If it does not float, separate it with a hairline.

**The Ring Is Focus Rule.** A zero-offset ring is only ever a selection or focus indicator in cobalt (selected clip, open swatch, focused edge handle). It is never ambient glow.

## Shapes

Small, consistent corners. Controls, rows and buttons use 6px; inline fields, tags, kbd keys and chips use 4px; clips, swatches and list items in popovers 5px; floating surfaces 8px (popover, toast, editor, link list); the command palette 10px. Round shapes are reserved for knobs and dots (slider thumb, switch knob, connection dot, colour-picker dots). The switch track is a full pill. Live-pixel canvases use `image-rendering: pixelated` so each LED stays a hard-edged block.

## Components

### Buttons
Quiet and solid.
- **Shape:** 6px corners, 28px tall, 10px side padding, 500 weight, optional 16px leading icon at 6px gap.
- **Default:** `raised` fill, `line-strong` border, `text`; hover to `hover`.
- **Primary:** `cobalt` fill and border, white label; hover `cobalt-hover`. One per view, for the commit action (Save current, Save to device). A kbd hint inside a primary button uses a translucent white key. Known defect, not a rule: white on `cobalt` measures about 3.2:1, below 4.5:1 for 13px text (the hover fill is lower still); the label colour is open, so do not cite it as proven legible.
- **Ghost:** transparent, `text-secondary`; hover `hover` fill and `text`.
- **Disabled:** 40% opacity, default cursor.

### Icon Button
28px square, 6px corners, `text-secondary` icon; hover `hover` fill. Pressed state is `raised` fill with `text`. Danger tone turns the icon `danger` on hover only. Tooltip carries the shortcut ("Split (S)").

### Slider Row
The core parameter control: a three-column grid of label (76px, `text-secondary`), track, and a 44px number field. Track 4px, unfilled `line-strong`, filled `cobalt` up to the value (a hard stop, not a blend). 12px white thumb with the thumb shadow, scales 1.25x while held; keyboard focus shows a 3px translucent cobalt ring. Arrow keys step 1, Shift steps 10. The row owns its value while the pointer is down: incoming state is ignored until release.

### Number Field
44px wide, 24px tall, `canvas` fill, transparent border at rest, `line` on hover, `cobalt` on focus. Right-aligned 12px value with optional `text-tertiary` unit. Focus selects all; Enter/blur commits; Esc reverts; ↑/↓ steps (Shift ×10). Wide variant fills its cell at 28px with a `line` border and left-aligned value.

### Switch
26 × 16 pill, `line-strong` off, `cobalt` on, 12px white knob sliding 10px. Label in `text-secondary`, turning `text` when on. Focus ring sits on the track.

### Picker, Popover and Search List
- **Picker:** full-width 28px trigger, `canvas` fill, `line` border (`line-strong` hover, `cobalt` while open), value truncated with a chevron in `text-tertiary`.
- **Popover:** `raised`, `line-strong` border, 8px corners, popover shadow, enters with a 140ms fade and 4px rise. Positions below its anchor and flips above if it would overflow. Closes on outside pointer or Esc, returning focus to the trigger.
- **Search List:** 36px search header with a hairline under it; 30px items, 5px corners, `text-secondary`. Arrow keys move the highlight (`hover` fill, `text`); Enter picks. The current value is marked in `cobalt-text` with a trailing check. Empty state reads "No match for ..." in `text-tertiary`.

### Timeline (Signature)
The strip is a timeline: an LED ruler (10px tertiary numbers with 4px ticks on a hairline) over one 64px lane of clips. Each clip is a rounded (5px) window onto the live LED pixels of its range, drawn on canvas, with a 1px white inset ring at 10% (28% on hover). The selected clip gets a 2px inset `cobalt` ring and its label chip turns cobalt. Labels are 11px on a 78% canvas-tinted chip so they read over any LED colour. (The selected label's white-on-cobalt text has the same sub-4.5:1 contrast defect as the primary button.) Off segments are dimmed with the same tint.
- **Edges:** 14px hit zones between clips (28px on touch) with a 2px bar that appears at 50% on lane hover and full `cobalt` on hover/drag. A shared boundary moves both neighbours; every segment keeps at least one LED. Shift snaps to 10 LEDs; arrow keys step 1 (Shift 10).
- **Cursor:** 1px line with an LED-index chip above the ruler; it turns cobalt while dragging.
- **Hint line:** 11px tertiary text with kbd keys, hidden on narrow screens.

### Library Rows
30px rows (40px on touch) in a dense multi-column grid, 6px corners, `hover` on hover. The current item gets `cobalt-soft` with its name in `cobalt-text` at 600. Trailing tags (micro, `raised`, 4px) mark Script, sound-reactive and 2D; palette rows show a 72px swatch bar. The favourite star is hidden until row hover or focus (always visible on touch). Above the list: segmented tabs (Effects / Palettes), a compact search box, and filter chips that use `cobalt-soft` when pressed, with a right-aligned count.

### Command Palette
A modal dialog, 600px wide at 12vh from the top, `raised`, 10px corners, dialog shadow and dimmed backdrop. One search list over effects, palettes, presets, segments and actions, each row prefixed by a 56px tertiary group name and an icon or swatch bar, with kbd hints where an action has a shortcut. A footer explains ↑↓ / ↵ / esc. Its search header gets a 1px cobalt underline while focused.

### Toast
Bottom-centre (above the bottom bar on phones), `raised`, `line-strong` border, 8px corners, toast shadow, 180ms rise. Announces structural changes ("Split Seg 1 at LED 120") with an inline Undo button showing its shortcut; dismisses after 6s.

### Tables and Lists
Full-width, collapsed borders, 40px rows with hairlines under each, 11px 600 tertiary headers. Row hover is `panel`; the active row is `cobalt-soft`. Link lists are hairline-separated 38px rows in an 8px-cornered frame.

### Navigation
- **Rail:** 56px column of 18px icons over 10px labels, `text-tertiary`; hover `hover` fill; current page `raised` fill with `text` and a `cobalt-text` icon. Labels stay because four labelled sections read faster than icons alone. At ≤860px it becomes an evenly spaced bottom bar.
- **Top bar:** device name (600) with a 7px connection dot (`ok`/`danger`) and mono IP, then the ⌘K trigger (styled as a recessed field with a kbd hint), master brightness slider row, and a 28px power button that fills cobalt when the lights are on.

### Kbd
18px key, 4px corners, `raised` fill, `line-strong` border, 11px `text-secondary`. Used in hints, the palette footer, tooltips and buttons.

### Interaction Rules (part of the system)
- **Input ownership.** Every edit is applied to local state and rendered on the same frame. A field the user touched keeps its local value for 800 ms; WebSocket echoes of that field inside the window are discarded. Sliders additionally hold their value while the pointer is down; text fields hold theirs while focused.
- **One send per frame.** Outgoing changes merge into one pending message flushed at most once per animation frame; if the socket buffer exceeds 2 KB the flush waits a frame. Discrete actions (power, effect pick, switch toggles, structural edits) flush immediately.
- **Structural edits are undoable.** Split, merge, delete and boundary moves snapshot the segment layout first (30 deep). Split/merge/delete announce themselves in a toast with Undo; boundary drags are undoable silently. ⌘Z / Ctrl Z undoes outside text fields.
- **Shortcuts.** ⌘K palette; S split at the hovered LED (or the middle of the selection); double-click splits too; [ and ] select previous/next segment; Delete/Backspace deletes the selected segment; P toggles power; 1-4 switch pages. Single-key shortcuts never fire inside inputs, dialogs or with modifiers.
- **Motion.** One easing (`cubic-bezier(.2, .8, .2, 1)`), 120-200ms, used for state feedback and entrances only. `prefers-reduced-motion` removes all animation and transition.

## Do's and Don'ts

### Do:
- **Do** keep chrome graphite and let the LEDs, palettes and swatches carry all saturated colour.
- **Do** reserve cobalt for selection, focus, engaged state (on, checked, filled) and the single primary action; use `cobalt-text` when cobalt is foreground text.
- **Do** build every control at 28px (32px at ≤860px) with 6px corners and 1px hairlines.
- **Do** recess inputs to `canvas` with a cobalt border on focus.
- **Do** give every list arrow-key navigation and every frequent action a shortcut shown as a kbd hint.
- **Do** apply edits locally first, flush at most once per frame, and protect a touched field from echoes for 800 ms.
- **Do** make structural segment edits undoable and announce them with a toast.
- **Do** inset-ring any colour content (clips, swatches, swatch bars) so it keeps an edge against the dark chrome.

### Don't:
- **Don't** add a light theme or bright surfaces; the UI is used beside the lights in dim rooms.
- **Don't** use cobalt, or any other hue, for decoration, headings or illustration.
- **Don't** use decorative gradients or glows. Gradients appear only where they are the content (palette swatch bars, the hue strip, the colour plane); the slider fill is a hard stop.
- **Don't** put cards or shadows on docked panels; shadows are for floating surfaces only.
- **Don't** introduce a display size or second typeface; hierarchy is weight, case and grey.
- **Don't** let incoming device state move a control the user is holding or typing in.
- **Don't** replace the authored 16px stroke icons (1.5px stroke, round caps) with an icon font or mixed sets.
