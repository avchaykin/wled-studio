# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
The builder: an LED/maker enthusiast who designs light looks, writes Glow scripts and lays out segments for their own installations. Other people in the household control the lights through Home Assistant, not through this interface.

## Product Purpose
WLED Studio is the web interface of a custom WLED firmware fork. It lets the builder segment a strip, assign effects, colours and palettes per segment, write and preview Glow scripts that run on the device, and watch a live LED preview — faster and more precisely than the classic WLED UI. Success: designing a look feels like working in a professional tool, with every control reacting instantly.

## Positioning
The only WLED interface with an on-device scripting language (Glow) whose scripts compile in the browser, preview locally and then run as first-class WLED effects — combined with a live preview and direct-manipulation segment editing.

## Operating Context
- Mostly used on a desktop/laptop next to the lights during design sessions; the phone is for quick tweaks.
- Served from the ESP32 itself (gzipped in firmware, ~190 KB flash free; target ≤ ~50 KB gzip for the UI). Device runs on a home LAN; WebSocket for state + live frames, HTTP JSON API for everything else.
- Device state echoes arrive asynchronously over WebSocket and must never fight the user's in-progress input.
- Classic WLED UI stays available at `/legacy`; settings pages are the classic ones.

## Capabilities and Constraints
- Segments (1D now; 2D matrices supported by firmware), ~200 built-in effects with per-effect metadata (sliders, toggles, colour slots, palette), ~70 palettes, presets/playlists, AudioReactive.
- Glow scripts: editor, compile errors with line numbers, in-browser preview, upload, per-device management.
- Stack: Preact with custom components (user decision, 2026-11-05), bundled by esbuild into one file.
- Multi-device control is planned later; leave room for a device switcher.
- Must keep the JSON API compatible with Home Assistant.

## Evidence on Hand
Real device at 192.168.1.118 (250 LEDs, ESP32), Glow examples in `glow/examples/`. No testimonials, users or metrics exist; do not fabricate any.

## Product Principles
1. Input is sacred: local state updates instantly and device echoes never move a control the user is touching.
2. Show the light: the live preview and segment layout are always visible while editing.
3. Dense, precise, keyboard friendly — a tool for someone who builds, not a remote control.
4. Fit the device: every byte ships from the ESP32's flash.
