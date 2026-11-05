// Runs every example and a set of snippets on both the JS reference VM and the
// C++ VM (built natively from wled00/glow_vm.cpp) and compares pixels (±1 per channel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '../compiler.mjs';
import { loadImage, GlowInstance, runFrame } from '../vm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const work = mkdtempSync(join(tmpdir(), 'glow-'));
const harness = join(work, 'harness');

const cxx = process.env.CXX || 'c++';
const haveCxx = spawnSync(cxx, ['--version']).status === 0;

const FRAMES = 40, SEED = 4242;

function hostFor(len, w, h) {
  return {
    len, w: w ?? len, h: h ?? 1, t: 0,
    controls: [128, 128, 128, 128, 128, 0, 0, 0],
    colors: [0xff0000, 0x00ff00, 0x0000ff],
    palette: i => ((i << 16) | ((255 - i) << 8)) >>> 0,
    pixels: new Uint32Array(len),
    audio: { vol: 100, peak: false, beat: false, freq: 0, bands: new Array(16).fill(50) },
  };
}

function runJs(image, len, w, h) {
  const host = hostFor(len, w, h);
  const inst = new GlowInstance(loadImage(image), SEED);
  const out = [];
  for (let f = 0; f < FRAMES; f++) { host.t = f * 25; runFrame(inst, host); out.push([...host.pixels]); }
  return out;
}

function runNative(name, image, len, w, h) {
  const file = join(work, `${name.replace(/\W/g, '_')}.glw`);
  writeFileSync(file, image);
  const args = [file, String(len), String(FRAMES), String(SEED)];
  if (w) args.push(String(w), String(h));
  const out = execFileSync(harness, args, { encoding: 'utf8' }).trim();
  if (out.startsWith('ERR') || out.startsWith('LOAD')) throw new Error(out);
  return out.split('\n').map(l => l.split(' ').map(x => parseInt(x, 16)));
}

function close(a, b) {
  for (let s = 0; s < 32; s += 8) if (Math.abs(((a >>> s) & 255) - ((b >>> s) & 255)) > 1) return false;
  return true;
}

const SNIPPETS = {
  maths: `effect "M" { fn pixel(i) { let x = i / len
    return rgb(sin(x) * 255, tri(x * 3) * 255, smoothstep(0.2, 0.8, x) * 255,
               map(x, 0, 1, 10, 200) + clamp(pow(x, 2), 0, 1) * 20) } }`,
  colour: `effect "C" { fn pixel(i) { let a = hsv(i * 9 + t / 10, 200, 255)
    return blend(a, color(1), fract(i / 7)) + bright(color(2), i) - #100010 } }`,
  noise: `effect "N" { fn pixel(i) { return rgb(noise(i / 7, t / 900) * 255, noise(i / 3) * 255, noise(i / 5, 1.5, t / 333) * 255) } }`,
  drawing: `effect "D" { var p = 0 fn frame() { blur(90); fade(20); p = (p + 0.37) % len
    set(p, #ff8800); add(len - 1 - p, #0044ff); if frame % 7 == 0 { shift(1) } } }`,
  matrix: `effect "X" { fn pixel(x, y) { return hsv(x * 20 + y * 30 + t / 20, 255, 255) } }`,
  random: `effect "R" { fn frame() { fade(40); add(random(len), hsv(random(256), 255, 255)) } }`,
};

test('C++ VM matches the JS reference VM', { skip: !haveCxx && 'no C++ compiler' }, () => {
  execFileSync(cxx, ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', '-o', harness,
    join(here, 'native', 'harness.cpp'), join(root, 'wled00', 'glow_vm.cpp')]);

  const cases = [];
  const ex = join(here, '..', 'examples');
  for (const f of readdirSync(ex).filter(f => f.endsWith('.glow'))) {
    const src = readFileSync(join(ex, f), 'utf8');
    if (compile(src).kind === 'effect') cases.push([f, src]);   // shows have no pixels to compare
  }
  for (const [k, v] of Object.entries(SNIPPETS)) cases.push([k, v]);

  for (const [name, src] of cases) {
    const { image, twoD } = compile(src);
    const [len, w, h] = twoD ? [48, 8, 6] : [60];
    const js = runJs(image, len, w, h);
    const cc = runNative(name, image, len, w, h);
    assert.equal(cc.length, FRAMES, `${name}: frame count`);
    for (let f = 0; f < FRAMES; f++) {
      for (let i = 0; i < len; i++) {
        if (!close(js[f][i], cc[f][i]))
          assert.fail(`${name}: frame ${f} pixel ${i}: js=${js[f][i].toString(16)} c++=${cc[f][i].toString(16)}`);
      }
    }
  }
});

test('wled00/glow_natives.h is up to date', () => {
  execFileSync(process.execPath, [join(here, '..', 'tools', 'gen-natives.mjs'), '--check']);
});

test('verifier: corrupted images never crash the C++ VM (ASan/UBSan)', { skip: !haveCxx && 'no C++ compiler' }, () => {
  const fuzz = join(work, 'fuzz');
  try {
    execFileSync(cxx, ['-std=c++17', '-O1', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-o', fuzz,
      join(here, 'native', 'fuzz.cpp'), join(root, 'wled00', 'glow_vm.cpp')], { stdio: 'pipe' });
  } catch { return; } // toolchain without sanitizers: covered by the conformance test above
  const seeds = readdirSync(join(here, '..', 'examples')).filter(f => f.endsWith('.glow')).map(f => {
    const out = join(work, `seed-${f}.glw`);
    writeFileSync(out, compile(readFileSync(join(here, '..', 'examples', f), 'utf8')).image);
    return out;
  });
  const out = execFileSync(fuzz, seeds, { encoding: 'utf8' });
  assert.match(out, /loaded \d+, rejected \d+, ran \d+/);
});
