// Glow reference VM (JavaScript). Semantics here are normative: the C++ VM in
// wled00/glow_vm.cpp must produce the same pixels (±1 per channel) for the
// conformance suite in glow/test/.
import { OP, NATIVES, BUILTIN_VARS, TAG } from './natives.mjs';

const fr = Math.fround;
const NATIVE_NAMES = NATIVES.map(n => n[0]);
const B = Object.fromEntries(BUILTIN_VARS.map((n, i) => [n, i]));

export class GlowRuntimeError extends Error {}

// ---------- image ----------
export function loadImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 20 || b[0] !== 0x47 || b[1] !== 0x4c || b[2] !== 0x57 || b[3] !== 0x31) throw new GlowRuntimeError('not a Glow image');
  if (b[4] !== 1) throw new GlowRuntimeError(`unsupported image version ${b[4]}`);
  const img = {
    kind: b[5], flags: b[6], nGlobals: b[7], nConsts: b[8], nStrings: b[9], nFuncs: b[10], nControls: b[11],
    initFn: b[12], mainFn: b[13], codeLen: dv.getUint16(16, true), metaLen: dv.getUint16(18, true),
    consts: [], strings: [], funcs: [],
  };
  let p = 20;
  for (let i = 0; i < img.nConsts; i++) {
    const tag = b[p], bits = dv.getUint32(p + 1, true);
    img.consts.push({ tag, v: tag === TAG.NUM ? dv.getFloat32(p + 1, true) : bits });
    p += 5;
  }
  for (let i = 0; i < img.nStrings; i++) { const l = b[p++]; img.strings.push(new TextDecoder().decode(b.subarray(p, p + l))); p += l; }
  for (let i = 0; i < img.nFuncs; i++) { img.funcs.push({ off: dv.getUint16(p, true), nargs: b[p + 2], nlocals: b[p + 3] }); p += 4; }
  img.meta = new TextDecoder().decode(b.subarray(p, p + img.metaLen)); p += img.metaLen;
  img.code = b.subarray(p, p + img.codeLen);
  if (p + img.codeLen !== b.length) throw new GlowRuntimeError('image size mismatch');
  return img;
}

// ---------- shared maths (must match C++) ----------
export const clamp8 = v => (v <= 0 ? 0 : v >= 255 ? 255 : Math.floor(v + 0.5));
export const packRGBW = (r, g, b, w = 0) => ((clamp8(w) << 24) | (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b)) >>> 0;
const CR = c => (c >>> 16) & 255, CG = c => (c >>> 8) & 255, CB = c => c & 255, CW = c => (c >>> 24) & 255;
const fract = x => fr(x - Math.floor(x));
const TAU = fr(Math.PI * 2);

export function scaleColor(c, f) {
  if (!(f > 0)) return 0;
  return packRGBW(fr(CR(c) * f), fr(CG(c) * f), fr(CB(c) * f), fr(CW(c) * f));
}
export function addColor(a, b) {
  return (Math.min(255, CW(a) + CW(b)) << 24 | Math.min(255, CR(a) + CR(b)) << 16 | Math.min(255, CG(a) + CG(b)) << 8 | Math.min(255, CB(a) + CB(b))) >>> 0;
}
export function subColor(a, b) {
  return (Math.max(0, CW(a) - CW(b)) << 24 | Math.max(0, CR(a) - CR(b)) << 16 | Math.max(0, CG(a) - CG(b)) << 8 | Math.max(0, CB(a) - CB(b))) >>> 0;
}
export function blendColor(a, b, f) {
  f = f <= 0 ? 0 : f >= 1 ? 1 : f;
  const m = (x, y) => fr(x + fr(fr(y - x) * f));
  return packRGBW(m(CR(a), CR(b)), m(CG(a), CG(b)), m(CB(a), CB(b)), m(CW(a), CW(b)));
}
export function hsv(h, s, v) {
  h = fr(fract(fr(h / 256)) * 6); s = Math.min(1, Math.max(0, fr(s / 255))); v = Math.min(255, Math.max(0, v));
  const i = Math.floor(h), f = fr(h - i);
  const p = fr(v * fr(1 - s)), q = fr(v * fr(1 - fr(s * f))), t = fr(v * fr(1 - fr(s * fr(1 - f))));
  switch (i % 6) {
    case 0: return packRGBW(v, t, p); case 1: return packRGBW(q, v, p); case 2: return packRGBW(p, v, t);
    case 3: return packRGBW(p, q, v); case 4: return packRGBW(t, p, v); default: return packRGBW(v, p, q);
  }
}

// Ken Perlin's improved noise; output mapped to 0..1
const PERM = new Uint8Array(512);
{
  const p = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const nfade = t => fr(fr(fr(t * t) * t) * fr(fr(t * fr(fr(t * 6) - 15)) + 10));
const nlerp = (t, a, b) => fr(a + fr(t * fr(b - a)));
function grad(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return fr(((h & 1) ? -u : u) + ((h & 2) ? -v : v));
}
export function noise3(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  x = fr(x - fx); y = fr(y - fy); z = fr(z - fz);
  const u = nfade(x), v = nfade(y), w = nfade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B2 = PERM[X + 1] + Y, BA = PERM[B2] + Z, BB = PERM[B2 + 1] + Z;
  const x1 = fr(x - 1), y1 = fr(y - 1), z1 = fr(z - 1);
  const r = nlerp(w,
    nlerp(v, nlerp(u, grad(PERM[AA], x, y, z), grad(PERM[BA], x1, y, z)), nlerp(u, grad(PERM[AB], x, y1, z), grad(PERM[BB], x1, y1, z))),
    nlerp(v, nlerp(u, grad(PERM[AA + 1], x, y, z1), grad(PERM[BA + 1], x1, y, z1)), nlerp(u, grad(PERM[AB + 1], x, y1, z1), grad(PERM[BB + 1], x1, y1, z1))));
  const o = fr(fr(r * 0.5) + 0.5);
  return o < 0 ? 0 : o > 1 ? 1 : o;
}

// xorshift32 — same sequence as C++
export class Rng {
  constructor(seed = 0x9e3779b9) { this.s = (seed >>> 0) || 1; }
  next() { let x = this.s; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.s = x; return x; }
  float() { return fr((this.next() >>> 8) / 16777216); }
}

// ---------- VM ----------
const STACK = 256, FRAMES = 32;
// counted in loop iterations (backward jumps), calls and built-in calls, like the C++ VM
export const DEFAULT_BUDGET = 60000;

// Per-segment instance: holds persistent globals and arrays.
export class GlowInstance {
  constructor(img, seed) {
    this.img = typeof img.code === 'undefined' ? loadImage(img) : img;
    this.gv = new Float64Array(this.img.nGlobals); this.gt = new Uint8Array(this.img.nGlobals);
    this.arrays = []; this.frame = 0; this.rng = new Rng(seed); this.inited = false;
  }
}

/**
 * host: {
 *   len, w, h, t, controls: [sx,ix,c1,c2,c3,o1,o2,o3], colors: [c0,c1,c2],
 *   palette(i0_255) -> color, pixels: Uint32Array(len), audio?: {vol,peak,beat,freq,bands}
 * }
 */
export function runFrame(inst, host, budget = DEFAULT_BUDGET) {
  const img = inst.img;
  const ctx = { inst, host, budget, pixelMode: false };
  if (!inst.inited) {
    if (img.initFn !== 255) exec(ctx, img.initFn, []);
    inst.inited = true;
  }
  if (img.mainFn === 255) return;
  if (img.flags & 1) {
    ctx.pixelMode = true;
    const twoD = img.flags & 2;
    const { len, pixels } = host;
    if (twoD) {
      const w = host.w, h = host.h;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [v, t] = exec(ctx, img.mainFn, [[x, TAG.NUM], [y, TAG.NUM]]);
        pixels[y * w + x] = toColor(v, t);
      }
    } else {
      for (let i = 0; i < len; i++) {
        const [v, t] = exec(ctx, img.mainFn, [[i, TAG.NUM]]);
        pixels[i] = toColor(v, t);
      }
    }
  } else exec(ctx, img.mainFn, []);
  inst.frame++;
}

function toColor(v, t) {
  if (t === TAG.COLOR) return v >>> 0;
  throw new GlowRuntimeError('pixel() must return a colour');
}

function truthy(v, t) { return t === TAG.ARRAY || t === TAG.STR ? true : v !== 0; }

function exec(ctx, fnIndex, args) {
  const { inst, host } = ctx; const img = inst.img; const code = img.code;
  const sv = new Float64Array(STACK), st = new Uint8Array(STACK);
  let sp = 0;
  const frames = [];
  const enter = (fi, retPc) => {
    const f = img.funcs[fi];
    if (!f) throw new GlowRuntimeError('bad function index');
    if (frames.length >= FRAMES) throw new GlowRuntimeError('call stack overflow');
    const base = sp - f.nargs;
    if (base < 0 || base + f.nlocals + 16 > STACK) throw new GlowRuntimeError('stack overflow');
    for (let k = f.nargs; k < f.nlocals; k++) { sv[base + k] = 0; st[base + k] = TAG.NUM; }
    sp = base + f.nlocals;
    frames.push({ base, retPc });
    return f.off;
  };
  for (const [v, t] of args) { sv[sp] = v; st[sp++] = t; }
  let pc = enter(fnIndex, -1);
  const pop = () => { if (sp <= frames[frames.length - 1].base) throw new GlowRuntimeError('stack underflow'); return --sp; };
  const push = (v, t) => { if (sp >= STACK) throw new GlowRuntimeError('stack overflow'); sv[sp] = v; st[sp++] = t; };
  const num = k => { const t = st[k]; if (t === TAG.NUM) return sv[k]; if (t === TAG.BOOL) return sv[k] ? 1 : 0; throw new GlowRuntimeError(`expected a number, got ${tagName(t)}`); };
  const col = k => { if (st[k] !== TAG.COLOR) throw new GlowRuntimeError(`expected a colour, got ${tagName(st[k])}`); return sv[k] >>> 0; };
  const s16 = () => { const v = code[pc] | (code[pc + 1] << 8); pc += 2; return v >= 0x8000 ? v - 0x10000 : v; };

  const tick = () => { if (--ctx.budget < 0) throw new GlowRuntimeError('script too slow: instruction budget exceeded'); };
  for (;;) {
    if (pc < 0 || pc >= code.length) throw new GlowRuntimeError('pc out of range');
    const op = code[pc++];
    switch (op) {
      case OP.HALT: return [0, TAG.NUM];
      case OP.PUSHK: { const c = img.consts[code[pc++]]; if (!c) throw new GlowRuntimeError('bad const'); push(c.v, c.tag); break; }
      case OP.PUSHI: { const v = code[pc++]; push(v >= 128 ? v - 256 : v, TAG.NUM); break; }
      case OP.PUSHT: push(1, TAG.BOOL); break;
      case OP.PUSHF: push(0, TAG.BOOL); break;
      case OP.POP: pop(); break;
      case OP.DUP: { const k = pop(); sp++; push(sv[k], st[k]); break; }
      case OP.LOADL: { const k = frames[frames.length - 1].base + code[pc++]; if (k >= sp) throw new GlowRuntimeError('bad local'); push(sv[k], st[k]); break; }
      case OP.STOREL: { const k = frames[frames.length - 1].base + code[pc++]; const s = pop(); if (k >= sp) throw new GlowRuntimeError('bad local'); sv[k] = sv[s]; st[k] = st[s]; break; }
      case OP.LOADG: { const g = code[pc++]; if (g >= img.nGlobals) throw new GlowRuntimeError('bad global'); push(inst.gv[g], inst.gt[g]); break; }
      case OP.STOREG: { const g = code[pc++]; const s = pop(); if (g >= img.nGlobals) throw new GlowRuntimeError('bad global'); inst.gv[g] = sv[s]; inst.gt[g] = st[s]; break; }
      case OP.LOADB: push(...builtin(ctx, code[pc++])); break;
      case OP.LOADC: {
        const c = code[pc++]; if (c > 7) throw new GlowRuntimeError('bad control');
        const v = host.controls?.[c] ?? 0;
        if (c < 5) push(v, TAG.NUM); else push(v ? 1 : 0, TAG.BOOL);
        break;
      }
      case OP.ADD: case OP.SUB: case OP.MUL: case OP.DIV: case OP.MOD: {
        const b = pop(), a = pop(); const ta = st[a], tb = st[b];
        if (ta === TAG.COLOR || tb === TAG.COLOR) {
          let r;
          if (op === OP.ADD && ta === TAG.COLOR && tb === TAG.COLOR) r = addColor(sv[a], sv[b]);
          else if (op === OP.SUB && ta === TAG.COLOR && tb === TAG.COLOR) r = subColor(sv[a], sv[b]);
          else if (op === OP.MUL && ta === TAG.COLOR && tb !== TAG.COLOR) r = scaleColor(sv[a], num(b));
          else if (op === OP.MUL && tb === TAG.COLOR && ta !== TAG.COLOR) r = scaleColor(sv[b], num(a));
          else if (op === OP.DIV && ta === TAG.COLOR && tb !== TAG.COLOR) { const d = num(b); r = d === 0 ? 0 : scaleColor(sv[a], fr(1 / d)); }
          else throw new GlowRuntimeError(`cannot ${opName(op)} ${tagName(ta)} and ${tagName(tb)}`);
          push(r, TAG.COLOR); break;
        }
        const x = num(a), y = num(b); let r;
        switch (op) {
          case OP.ADD: r = x + y; break;
          case OP.SUB: r = x - y; break;
          case OP.MUL: r = x * y; break;
          case OP.DIV: r = y === 0 ? 0 : x / y; break;
          default: r = y === 0 ? 0 : fr(x - fr(y * Math.floor(fr(x / y)))); // floored modulo
        }
        push(fr(r), TAG.NUM); break;
      }
      case OP.NEG: { const a = pop(); push(fr(-num(a)), TAG.NUM); break; }
      case OP.NOT: { const a = pop(); push(truthy(sv[a], st[a]) ? 0 : 1, TAG.BOOL); break; }
      case OP.EQ: case OP.NE: {
        const b = pop(), a = pop();
        let eq;
        if (st[a] === TAG.COLOR || st[b] === TAG.COLOR) eq = st[a] === st[b] && sv[a] === sv[b];
        else eq = num(a) === num(b);
        push((op === OP.EQ) === eq ? 1 : 0, TAG.BOOL); break;
      }
      case OP.LT: case OP.LE: case OP.GT: case OP.GE: {
        const b = pop(), a = pop(); const x = num(a), y = num(b);
        const r = op === OP.LT ? x < y : op === OP.LE ? x <= y : op === OP.GT ? x > y : x >= y;
        push(r ? 1 : 0, TAG.BOOL); break;
      }
      case OP.JMP: { const d = s16(); pc += d; if (d < 0) tick(); break; }
      case OP.JZ: { const d = s16(); const a = pop(); if (!truthy(sv[a], st[a])) { pc += d; if (d < 0) tick(); } break; }
      case OP.JNZ: { const d = s16(); const a = pop(); if (truthy(sv[a], st[a])) { pc += d; if (d < 0) tick(); } break; }
      case OP.CALL: { tick(); const fi = code[pc++]; pc = enter(fi, pc); break; }
      case OP.RET: {
        const r = pop(); const v = sv[r], t = st[r];
        const f = frames.pop();
        sp = f.base;
        if (!frames.length) return [v, t];
        push(v, t); pc = f.retPc; break;
      }
      case OP.NATIVE: {
        tick();
        const id = code[pc++], argc = code[pc++];
        if (id >= NATIVES.length) throw new GlowRuntimeError('bad native');
        if (sp - argc < frames[frames.length - 1].base) throw new GlowRuntimeError('stack underflow');
        sp -= argc;
        const [v, t] = native(ctx, NATIVE_NAMES[id], sp, argc, sv, st, num, col);
        push(v, t); break;
      }
      case OP.AGET: {
        const ib = pop(), ab = pop();
        const arr = arrayOf(inst, sv[ab], st[ab]);
        const i = Math.floor(num(ib));
        push(i >= 0 && i < arr.data.length ? arr.data[i] : 0, arr.tag); break;
      }
      case OP.ASET: {
        const vb = pop(), ib = pop(), ab = pop();
        const arr = arrayOf(inst, sv[ab], st[ab]);
        const i = Math.floor(num(ib));
        const v = arr.tag === TAG.COLOR ? col(vb) : num(vb);
        if (i >= 0 && i < arr.data.length) arr.data[i] = v;
        break;
      }
      case OP.ARRLIT: {
        const n = code[pc++];
        if (sp - n < frames[frames.length - 1].base) throw new GlowRuntimeError('stack underflow');
        sp -= n;
        const tag = n && st[sp] === TAG.COLOR ? TAG.COLOR : TAG.NUM;
        const data = tag === TAG.COLOR ? new Uint32Array(n) : new Float32Array(n);
        for (let k = 0; k < n; k++) data[k] = tag === TAG.COLOR ? col(sp + k) : num(sp + k);
        push(allocArray(inst, tag, data), TAG.ARRAY); break;
      }
      default: throw new GlowRuntimeError(`bad opcode ${op}`);
    }
  }
}

const MAX_ARRAY = 4096;
function allocArray(inst, tag, data) {
  if (inst.arrays.length >= 16) throw new GlowRuntimeError('too many arrays (max 16)');
  inst.arrays.push({ tag, data });
  return inst.arrays.length - 1;
}
function arrayOf(inst, v, t) {
  if (t !== TAG.ARRAY || !inst.arrays[v]) throw new GlowRuntimeError(`expected an array, got ${tagName(t)}`);
  return inst.arrays[v];
}

function tagName(t) { return ['number', 'colour', 'bool', 'array', 'string'][t] ?? '?'; }
function opName(op) { return { [OP.ADD]: 'add', [OP.SUB]: 'subtract', [OP.MUL]: 'multiply', [OP.DIV]: 'divide', [OP.MOD]: 'take modulo of' }[op]; }

function builtin(ctx, id) {
  const h = ctx.host;
  switch (id) {
    case B.t: return [fr(h.t), TAG.NUM];
    case B.frame: return [ctx.inst.frame, TAG.NUM];
    case B.len: return [h.len, TAG.NUM];
    case B.w: return [h.w ?? h.len, TAG.NUM];
    case B.h: return [h.h ?? 1, TAG.NUM];
    case B.audio_vol: return [h.audio?.vol ?? 0, TAG.NUM];
    case B.audio_peak: return [h.audio?.peak ? 1 : 0, TAG.BOOL];
    case B.audio_beat: return [h.audio?.beat ? 1 : 0, TAG.BOOL];
    case B.audio_freq: return [fr(h.audio?.freq ?? 0), TAG.NUM];
    default: throw new GlowRuntimeError(`bad builtin ${id}`);
  }
}

// ---------- drawing helpers on host.pixels ----------
function px(h, i) { return i >= 0 && i < h.len ? h.pixels[i] : 0; }
function setAA(h, pos, c, additive) {
  const i0 = Math.floor(pos), f = fr(pos - i0);
  const put = (i, cc, weight) => {
    if (i < 0 || i >= h.len || weight <= 0) return;
    if (additive) h.pixels[i] = addColor(h.pixels[i], weight >= 1 ? cc : scaleColor(cc, weight));
    else h.pixels[i] = weight >= 1 ? cc : blendColor(h.pixels[i], cc, weight);
  };
  if (f === 0) put(i0, c, 1);
  else { put(i0, c, fr(1 - f)); put(i0 + 1, c, f); }
}

function native(ctx, name, base, argc, sv, st, num, col) {
  const h = ctx.host, inst = ctx.inst;
  const N = k => num(base + k), C = k => col(base + k);
  const n1 = v => [fr(v), TAG.NUM];
  const drawCheck = () => { if (ctx.pixelMode) throw new GlowRuntimeError(`${name}() cannot be used inside pixel()`); };
  switch (name) {
    case 'sin': return n1(fr(Math.sin(fr(N(0) * TAU)) * 0.5) + 0.5);
    case 'cos': return n1(fr(Math.cos(fr(N(0) * TAU)) * 0.5) + 0.5);
    case 'tri': return n1(1 - Math.abs(fr(fr(2 * fract(N(0))) - 1)));
    case 'saw': return n1(fract(N(0)));
    case 'sq': return n1(fract(N(0)) < 0.5 ? 1 : 0);
    case 'abs': return n1(Math.abs(N(0)));
    case 'min': return n1(Math.min(N(0), N(1)));
    case 'max': return n1(Math.max(N(0), N(1)));
    case 'clamp': { const v = N(0), lo = N(1), hi = N(2); return n1(v < lo ? lo : v > hi ? hi : v); }
    case 'floor': return n1(Math.floor(N(0)));
    case 'ceil': return n1(Math.ceil(N(0)));
    case 'round': { const v = N(0); return n1(v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5)); }
    case 'fract': return n1(fract(N(0)));
    case 'mix': { const a = N(0), b = N(1), f = N(2); return n1(a + fr(fr(b - a) * f)); }
    case 'smoothstep': {
      const e0 = N(0), e1 = N(1), x = N(2);
      if (e1 === e0) return n1(x < e0 ? 0 : 1);
      let t = fr(fr(x - e0) / fr(e1 - e0)); t = t < 0 ? 0 : t > 1 ? 1 : t;
      return n1(fr(t * t) * fr(3 - fr(2 * t)));
    }
    case 'sqrt': { const v = N(0); return n1(v > 0 ? Math.sqrt(v) : 0); }
    case 'pow': { const r = fr(Math.pow(N(0), N(1))); return n1(Number.isFinite(r) ? r : 0); }
    case 'map': {
      const v = N(0), a = N(1), b = N(2), c = N(3), d = N(4);
      if (b === a) return n1(c);
      return n1(c + fr(fr(fr(v - a) * fr(d - c)) / fr(b - a)));
    }
    case 'random': {
      const f = inst.rng.float();
      return argc ? n1(Math.floor(fr(f * N(0)))) : n1(f);
    }
    case 'noise': return n1(noise3(N(0), argc > 1 ? N(1) : 0, argc > 2 ? N(2) : 0));
    case 'beat': return n1(fract(fr(fr(fr(h.t) * N(0)) / 60000)));
    case 'rgb': return [packRGBW(N(0), N(1), N(2), argc > 3 ? N(3) : 0), TAG.COLOR];
    case 'hsv': return [hsv(N(0), N(1), N(2)), TAG.COLOR];
    case 'pal': {
      const i = Math.floor(N(0)) & 255;
      return [(h.palette ? h.palette(i) : packRGBW(i, i, i)) >>> 0, TAG.COLOR];
    }
    case 'blend': return [blendColor(C(0), C(1), N(2)), TAG.COLOR];
    case 'bright': return [scaleColor(C(0), fr(N(1) / 255)), TAG.COLOR];
    case 'r': return n1(CR(C(0)));
    case 'g': return n1(CG(C(0)));
    case 'b': return n1(CB(C(0)));
    case 'w': return n1(CW(C(0)));
    case 'color': { const k = Math.floor(N(0)); return [(k >= 0 && k < 3 ? (h.colors?.[k] ?? 0) : 0) >>> 0, TAG.COLOR]; }
    case 'set': case 'add': {
      drawCheck();
      if (argc === 3) { // set(x, y, c)
        const x = Math.floor(N(0)), y = Math.floor(N(1)), c = C(2), w = h.w ?? h.len;
        if (x >= 0 && x < w && y >= 0 && y < (h.h ?? 1)) h.pixels[y * w + x] = c;
      } else setAA(h, N(0), C(1), name === 'add');
      return [0, TAG.NUM];
    }
    case 'get': {
      drawCheck();
      if (argc === 2) { const x = Math.floor(N(0)), y = Math.floor(N(1)), w = h.w ?? h.len;
        return [x >= 0 && x < w && y >= 0 && y < (h.h ?? 1) ? h.pixels[y * w + x] : 0, TAG.COLOR]; }
      return [px(h, Math.floor(N(0))), TAG.COLOR];
    }
    case 'fill': { drawCheck(); h.pixels.fill(C(0)); return [0, TAG.NUM]; }
    case 'fade': {
      drawCheck();
      const keep = fr(fr(255 - Math.min(255, Math.max(0, N(0)))) / 255);
      for (let i = 0; i < h.len; i++) h.pixels[i] = scaleColor(h.pixels[i], keep);
      return [0, TAG.NUM];
    }
    case 'blur': {
      drawCheck();
      const amt = Math.min(255, Math.max(0, N(0)));
      const seep = fr(amt / 510), keep = fr(1 - fr(amt / 255));
      let carry = 0;
      for (let i = 0; i < h.len; i++) {
        const cur = h.pixels[i];
        const part = scaleColor(cur, seep);
        if (i > 0) h.pixels[i - 1] = addColor(h.pixels[i - 1], part);
        h.pixels[i] = addColor(scaleColor(cur, keep), carry);
        carry = part;
      }
      return [0, TAG.NUM];
    }
    case 'shift': {
      drawCheck();
      const n = Math.trunc(N(0)), L = h.len, p = h.pixels;
      if (n > 0) { for (let i = L - 1; i >= 0; i--) p[i] = i - n >= 0 ? p[i - n] : 0; }
      else if (n < 0) { for (let i = 0; i < L; i++) p[i] = i - n < L ? p[i - n] : 0; }
      return [0, TAG.NUM];
    }
    case 'array': {
      const n = Math.max(1, Math.min(MAX_ARRAY, Math.floor(N(0))));
      const isCol = argc > 1 && st[base + 1] === TAG.COLOR;
      const data = isCol ? new Uint32Array(n) : new Float32Array(n);
      if (argc > 1) data.fill(isCol ? C(1) : N(1));
      return [allocArray(inst, isCol ? TAG.COLOR : TAG.NUM, data), TAG.ARRAY];
    }
    case 'size': return n1(arrayOf(inst, sv[base], st[base]).data.length);
    case 'audio_band': { const k = Math.floor(N(0)); return n1(k >= 0 && k < 16 ? (h.audio?.bands?.[k] ?? 0) : 0); }
    default: throw new GlowRuntimeError(`native ${name} not implemented`);
  }
}
