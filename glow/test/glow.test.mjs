import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '../compiler.mjs';
import { loadImage, GlowInstance, runFrame, runEvent, GlowRuntimeError, hsv } from '../vm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, '..', 'examples');

function host(len = 10, extra = {}) {
  return {
    len, w: len, h: 1, t: 0,
    controls: [128, 128, 128, 128, 128, 0, 0, 0],
    colors: [0xff0000, 0x00ff00, 0x0000ff],
    palette: i => ((i << 16) | ((255 - i) << 8)) >>> 0,
    pixels: new Uint32Array(len),
    ...extra,
  };
}
const run = (src, h = host(), frames = 1) => {
  const { image } = compile(src);
  const inst = new GlowInstance(loadImage(image), 1234);
  for (let f = 0; f < frames; f++) { h.t = f * 25; runFrame(inst, h); }
  return { h, inst };
};
const throwsAt = (src, re) => assert.throws(() => compile(src), e => re.test(e.message), `expected ${re}`);

test('every example compiles and runs 50 frames', () => {
  for (const f of readdirSync(examplesDir).filter(f => f.endsWith('.glow'))) {
    const src = readFileSync(join(examplesDir, f), 'utf8');
    const out = compile(src);
    assert.ok(out.image.length < 4096, `${f} image is ${out.image.length} bytes`);
    if (out.kind === 'show') {
      const inst = new GlowInstance(loadImage(out.image), 1); const calls = [];
      for (const e of inst.img.events) runEvent(inst, { show: (n, a) => { calls.push(n); return n.startsWith('seg') ? a[0] : 0; } }, e.fn);
      assert.ok(calls.length > 0, `${f} made no calls`);
      continue;
    }
    const h = host(60, { audio: { vol: 100, bands: new Array(16).fill(50) } });
    const inst = new GlowInstance(loadImage(out.image), 1);
    for (let k = 0; k < 50; k++) { h.t = k * 25; runFrame(inst, h); }
    assert.ok(h.pixels.some(p => p !== 0), `${f} produced only black`);
  }
});

test('pixel shader fills the segment', () => {
  const { h } = run('effect "A" { fn pixel(i) { return rgb(i * 10, 0, 0) } }');
  assert.deepEqual([...h.pixels].map(p => p >>> 16), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
});

test('2D pixel shader', () => {
  const h = host(6, { w: 3, h: 2 });
  run('effect "A" { fn pixel(x, y) { return rgb(x, y, 0) } }', h);
  assert.deepEqual([...h.pixels], [0x000000, 0x010000, 0x020000, 0x000100, 0x010100, 0x020100]);
});

test('var persists between frames, let does not', () => {
  const src = `effect "C" { var n = 0
    fn frame() { n += 1; let k = 5; set(0, rgb(n, k, 0)) } }`;
  const { h } = run(src, host(), 3);
  assert.equal(h.pixels[0], 0x030500);
});

test('controls map to WLED slots and metadata string', () => {
  const out = compile(`effect "Ctl" {
    speed = slider("Speed", 200)
    width = slider("Width")
    mirror = toggle("Mirror", true)
    uses palette
    fn pixel(i) { return mirror ? pal(speed) : color(1) } }`);
  assert.equal(out.meta, 'Ctl@Speed,Width,,,,Mirror;,!;!;1;sx=200,ix=128,o1=1');
  const h = host(1); h.controls = [77, 0, 0, 0, 0, 1, 0, 0];
  const inst = new GlowInstance(loadImage(out.image));
  runFrame(inst, h);
  assert.equal(h.pixels[0], h.palette(77));
});

test('colour arithmetic saturates', () => {
  const { h } = run(`effect "A" { fn pixel(i) {
    if i == 0 { return #f08000 + #208000 }
    if i == 1 { return #102030 - #204010 }
    if i == 2 { return #ff8040 * 0.5 }
    if i == 3 { return 2 * #808080 }
    return #000000 } }`, host(4));
  assert.deepEqual([...h.pixels], [0xffff00, 0x000020, 0x804020, 0xffffff]);
});

test('floored modulo and safe division', () => {
  const { h } = run(`effect "A" { fn pixel(i) {
    if i == 0 { return rgb(-1 % 5, 0, 0) }
    if i == 1 { return rgb(7 / 0 + 3, 0, 0) }
    return rgb(7.5 % 2 * 100, 0, 0) } }`, host(3));
  assert.deepEqual([...h.pixels].map(p => p >>> 16), [4, 3, 150]);
});

test('logical operators short-circuit', () => {
  const { h } = run(`effect "A" { var calls = 0
    fn bump() { calls += 1; return true }
    fn frame() { let a = false && bump(); let b = true || bump(); set(0, rgb(calls, 0, 0)) } }`);
  assert.equal(h.pixels[0], 0);
});

test('helper functions, loops, break and continue', () => {
  const { h } = run(`effect "A" {
    fn square(v) { return v * v }
    fn frame() {
      let s = 0
      for k in 0..100 { if k == 5 { break } if k == 2 { continue } s += square(k) }
      let n = 0
      while n < 3 { n += 1 }
      set(0, rgb(s, n, 0)) } }`);
  assert.equal(h.pixels[0], ((0 + 1 + 9 + 16) << 16) | (3 << 8));
});

test('arrays: allocate, read, write, out-of-range is safe', () => {
  const { h } = run(`effect "A" {
    var buf = array(4)
    var cols = [#ff0000, #00ff00]
    fn frame() {
      buf[1] += 7; buf[99] = 1
      set(0, rgb(buf[1], size(buf), buf[-1]))
      set(1, cols[1]) } }`, host(), 2);
  assert.equal(h.pixels[0], (14 << 16) | (4 << 8));
  assert.equal(h.pixels[1], 0x00ff00);
});

test('fractional set() antialiases across two pixels', () => {
  const { h } = run('effect "A" { fn frame() { fill(#000000); set(2.25, #ffffff) } }');
  assert.equal(h.pixels[2] & 255, 191);
  assert.equal(h.pixels[3] & 255, 64);
});

test('random() is deterministic per seed', () => {
  const src = 'effect "R" { fn pixel(i) { return rgb(random(256), 0, 0) } }';
  const a = run(src).h.pixels, b = run(src).h.pixels;
  assert.deepEqual([...a], [...b]);
  assert.ok(new Set(a).size > 3);
});

test('hsv primary hues', () => {
  assert.equal(hsv(0, 255, 255), 0xff0000);
  assert.equal(hsv(256 / 3, 255, 255), 0x00ff00);
  assert.equal(hsv(0, 0, 128), 0x808080);
});

test('runtime errors', () => {
  assert.throws(() => run('effect "A" { fn pixel(i) { return 3 } }'), /must return a colour/);
  assert.throws(() => run('effect "A" { fn frame() { while true { } } }'), /budget/);
  assert.throws(() => run('effect "A" { fn pixel(i) { return #ff0000 + 1 } }'), /cannot add colour and number/);
});

test('compile errors carry line numbers and helpful text', () => {
  throwsAt('effect "A" {\n fn pixel(i) {\n return foo\n } }', /^3:\d+: unknown name 'foo'/);
  throwsAt('effect "A" { fn pixel(i) { set(i, #fff); return #fff } }', /use it in fn frame\(\)/);
  throwsAt('effect "A" { fn f(n) { return f(n) } fn frame() { f(1) } }', /recursion is not allowed: f -> f/);
  throwsAt('effect "A" { fn frame() { } fn pixel(i) { return #fff } }', /either fn pixel\(\) or fn frame\(\)/);
  throwsAt('effect "A" { }', /needs fn pixel/);
  throwsAt('effect "A" { fn frame() { len = 3 } }', /read-only/);
  throwsAt('effect "A" { fn frame() { q = 3 } }', /unknown variable 'q'/);
  throwsAt('effect "A" { fn frame() { let b = array(3) } }', /only allowed as a var initializer/);
  throwsAt('effect "A" { fn frame() { 1 + 2 } }', /expression does nothing/);
  throwsAt('show "S" { on start { } } x', /only one effect or show/);
  throwsAt('effect "A;B" { fn frame() { } }', /must not contain/);
  throwsAt('effect "A" { a = slider("A") b = slider("B") c = slider("C") d = slider("D") e = slider("E") f = slider("F") fn frame() {} }', /at most 5 sliders/);
});

test('durations and colour shorthands', () => {
  const { h } = run('effect "A" { fn pixel(i) { return i == 0 ? rgb(2s / 1000, 250ms / 10, 0) : #0f8 } }', host(2));
  assert.deepEqual([...h.pixels], [0x021900, 0x00ff88]);
});

test('show scripts: events, chained segment calls, strings, next', () => {
  const r = compile(`show "S" {
    var n = 0
    on start { split(3) seg(2).effect("Comet").palette(next).colors(#ff0000, #00ff00).speed(9).on(true) }
    every 5s { n += 1 brightness(n * 10, 2s) }
    at "07:05" { power(true) }
    on button(1) { preset("Night") }
  }`);
  assert.equal(r.kind, 'show');
  assert.deepEqual(r.events.map(e => [e.type, e.arg]), [['start', 0], ['every', 5000], ['at', 425], ['button', 1]]);
  const inst = new GlowInstance(loadImage(r.image), 1);
  const calls = [];
  const host = { show: (n, a) => { calls.push(`${n}(${a.join(',')})`); return n.startsWith('seg') ? a[0] : 0; } };
  for (const e of inst.img.events) runEvent(inst, host, e.fn);
  runEvent(inst, host, inst.img.events[1].fn);
  assert.deepEqual(calls, ['split(3)', 'seg(2)', 'seg_effect(2,Comet)', 'seg_palette(2,-1)', 'seg_colors(2,16711680,65280)',
    'seg_speed(2,9)', 'seg_on(2,true)', 'brightness(10,2000)', 'power(true)', 'preset(Night)', 'brightness(20,2000)']);
});

test('show/effect separation is enforced', () => {
  throwsAt('effect "A" { fn frame() { split(2) } }', /only available in show scripts/);
  throwsAt('effect "A" { fn frame() { seg(0) } }', /only available in show scripts/);
  throwsAt('show "S" { on start { fade(10) } }', /draws pixels/);
  throwsAt('show "S" { var x = 1 }', /needs at least one handler/);
  throwsAt('show "S" { every 10 { } }', /at least 50ms/);
  throwsAt('show "S" { at "25:00" { } }', /time like/);
  throwsAt('show "S" { on sunrise { } }', /unknown event/);
});
