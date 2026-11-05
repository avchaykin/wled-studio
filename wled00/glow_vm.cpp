/*
 * Glow VM — see glow_vm.h. Keep in step with glow/vm.mjs (reference semantics).
 */
#include "glow_vm.h"

// the interpreter loop is hot; the rest of WLED is built with -Os
#if defined(__GNUC__) && !defined(__clang__)
  #pragma GCC optimize("O2")
#endif
#include <math.h>
#include <stdlib.h>
#include <string.h>

namespace glow {

static const float TAU = 6.2831853f;

// ---------------- image ----------------
static inline uint16_t rd16(const uint8_t *p) { return p[0] | (p[1] << 8); }
static inline uint32_t rd32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }

const char *Image::load(const uint8_t *data, size_t len) {
  if (!data || len < 20) return "image too small";
  if (data[0] != 'G' || data[1] != 'L' || data[2] != 'W' || data[3] != '1') return "not a Glow image";
  if (data[4] != 1) return "unsupported image version";
  bytes = data; size = len;
  kind = data[5]; flags = data[6]; nGlobals = data[7]; nConsts = data[8]; nStrings = data[9];
  nFuncs = data[10]; nControls = data[11]; initFn = data[12]; mainFn = data[13]; nEvents = data[14];
  codeLen = rd16(data + 16); metaLen = rd16(data + 18);
  if (nGlobals > 64) return "too many globals";
  size_t p = 20;
  consts = data + p; p += (size_t)nConsts * 5;
  if (p > len) return "truncated constants";
  strings = data + p;
  for (uint8_t i = 0; i < nStrings; i++) { if (p >= len || p + 1 + data[p] > len) return "truncated strings"; p += 1 + data[p]; }
  funcs = data + p; p += (size_t)nFuncs * 4;
  meta = (const char *)(data + p); p += metaLen;
  events = data + p; p += (size_t)nEvents * 6;
  code = data + p; p += codeLen;
  if (p != len) return "image size mismatch";
  if (codeLen == 0) return "no code";
  for (uint8_t i = 0; i < nConsts; i++) if (consts[i * 5] > T_STR) return "bad constant";
  for (uint8_t i = 0; i < nFuncs; i++) {
    Func f = func(i);
    if (f.off >= codeLen || f.nargs > f.nlocals || f.nlocals > 64) return "bad function table";
  }
  if (initFn != 255 && initFn >= nFuncs) return "bad init function";
  if (mainFn != 255 && mainFn >= nFuncs) return "bad main function";
  if (kind == K_EFFECT && mainFn == 255) return "effect has no main function";
  if (kind == K_EFFECT && nEvents) return "effects have no event handlers";
  if (kind == K_SHOW && !nEvents) return "show has no handlers";
  if (kind > K_SHOW) return "unknown script kind";
  for (uint8_t i = 0; i < nEvents; i++) {
    Event e = event(i);
    if (e.type > EV_BEAT || e.fn >= nFuncs || func(e.fn).nargs != 0) return "bad event table";
  }
  if (initFn != 255 && func(initFn).nargs != 0) return "init function takes arguments";
  if (mainFn != 255) {
    uint8_t want = (flags & F_PIXEL) ? ((flags & F_2D) ? 2 : 1) : 0;
    if (func(mainFn).nargs != want) return "main function has wrong arity";
  }
  return verify();
}

// operand bytes per opcode (0xff = invalid opcode)
static uint8_t opLen(uint8_t op) {
  switch (op) {
    case OP_HALT: case OP_PUSHT: case OP_PUSHF: case OP_POP: case OP_DUP: case OP_RET:
    case OP_ADD: case OP_SUB: case OP_MUL: case OP_DIV: case OP_MOD: case OP_NEG: case OP_NOT:
    case OP_EQ: case OP_NE: case OP_LT: case OP_LE: case OP_GT: case OP_GE: case OP_AGET: case OP_ASET: return 0;
    case OP_PUSHK: case OP_PUSHI: case OP_LOADL: case OP_STOREL: case OP_LOADG: case OP_STOREG:
    case OP_LOADB: case OP_LOADC: case OP_CALL: case OP_PUSHS: case OP_ARRLIT: return 1;
    case OP_JMP: case OP_JZ: case OP_JNZ: case OP_NATIVE: return 2;
    default: return 0xff;
  }
}

const char *Image::verify() {
  // instruction starts (bitmap) and per-pc stack depth (-1 = unvisited)
  uint8_t *start = (uint8_t *)calloc((codeLen + 7) / 8, 1);
  int16_t *depth = (int16_t *)malloc(codeLen * sizeof(int16_t));
  uint16_t *work = (uint16_t *)malloc(codeLen * sizeof(uint16_t));
  const char *err = nullptr;
  if (!start || !depth || !work) { err = "out of memory"; goto done; }
  maxFrame = 0;
  for (uint8_t fi = 0; fi < nFuncs && !err; fi++) {
    Func f = func(fi);
    uint32_t end = codeLen;
    for (uint8_t j = 0; j < nFuncs; j++) { uint16_t o = func(j).off; if (o > f.off && o < end) end = o; if (j != fi && o == f.off) err = "functions share code"; }
    if (err) break;
    // pass 1: decode linearly, check operands, mark instruction starts
    for (uint32_t pc = f.off; pc < end && !err;) {
      uint8_t op = code[pc], n = opLen(op);
      if (n == 0xff) { err = "invalid opcode"; break; }
      if (pc + 1 + n > end) { err = "truncated instruction"; break; }
      start[pc >> 3] |= 1 << (pc & 7);
      uint8_t a = n ? code[pc + 1] : 0;
      switch (op) {
        case OP_PUSHK: if (a >= nConsts) err = "bad constant index"; break;
        case OP_LOADL: case OP_STOREL: if (a >= f.nlocals) err = "bad local index"; break;
        case OP_LOADG: case OP_STOREG: if (a >= nGlobals) err = "bad global index"; break;
        case OP_LOADB: if (a >= B_COUNT) err = "bad builtin"; break;
        case OP_LOADC: if (a > 7) err = "bad control"; break;
        case OP_CALL: if (a >= nFuncs) err = "bad function index"; break;
        case OP_PUSHS: if (a >= nStrings) err = "bad string index"; break;
        case OP_NATIVE: if (a >= N_COUNT || code[pc + 2] < NATIVE_ARGC[a][0] || code[pc + 2] > NATIVE_ARGC[a][1]) err = "bad native call"; break;
      }
      pc += 1 + n;
    }
    if (err) break;
    // pass 2: stack depth dataflow (depth counts values above the locals)
    for (uint32_t pc = f.off; pc < end; pc++) depth[pc] = -1;
    int wn = 0, maxDepth = 0;
    depth[f.off] = 0; work[wn++] = f.off;
    while (wn && !err) {
      uint32_t pc = work[--wn];
      int d = depth[pc];
      uint8_t op = code[pc], a = opLen(op) ? code[pc + 1] : 0;
      int pop = 0, push = 0; bool falls = true; int32_t target = -1;
      switch (op) {
        case OP_HALT: falls = false; break;
        case OP_RET: pop = 1; falls = false; break;
        case OP_PUSHK: case OP_PUSHI: case OP_PUSHT: case OP_PUSHF: case OP_LOADL: case OP_LOADG:
        case OP_LOADB: case OP_LOADC: case OP_PUSHS: push = 1; break;
        case OP_POP: case OP_STOREL: case OP_STOREG: pop = 1; break;
        case OP_DUP: pop = 1; push = 2; break;
        case OP_NEG: case OP_NOT: pop = 1; push = 1; break;
        case OP_ADD: case OP_SUB: case OP_MUL: case OP_DIV: case OP_MOD:
        case OP_EQ: case OP_NE: case OP_LT: case OP_LE: case OP_GT: case OP_GE: case OP_AGET: pop = 2; push = 1; break;
        case OP_ASET: pop = 3; break;
        case OP_CALL: pop = func(a).nargs; push = 1; break;
        case OP_NATIVE: pop = code[pc + 2]; push = 1; break;
        case OP_ARRLIT: pop = a; push = 1; break;
        case OP_JMP: case OP_JZ: case OP_JNZ: {
          pop = op == OP_JMP ? 0 : 1; falls = op != OP_JMP;
          target = (int32_t)pc + 3 + (int16_t)rd16(code + pc + 1);
          break;
        }
      }
      if (d < pop) { err = "stack underflow"; break; }
      int nd = d - pop + push;
      if (nd > maxDepth) maxDepth = nd;
      uint32_t next = pc + 1 + opLen(op);
      uint32_t succ[2]; int ns = 0;
      if (falls) { if (next >= end) { err = "falls off end of function"; break; } succ[ns++] = next; }
      if (target >= 0 || op == OP_JMP || op == OP_JZ || op == OP_JNZ) {
        if (target < (int32_t)f.off || target >= (int32_t)end || !(start[target >> 3] & (1 << (target & 7)))) { err = "bad jump target"; break; }
        succ[ns++] = (uint32_t)target;
      }
      for (int k = 0; k < ns; k++) {
        if (depth[succ[k]] < 0) { depth[succ[k]] = nd; work[wn++] = succ[k]; }
        else if (depth[succ[k]] != nd) { err = "inconsistent stack depth"; break; }
      }
    }
    if (!err && f.nlocals + maxDepth > maxFrame) maxFrame = f.nlocals + maxDepth;
  }
  if (!err && maxFrame + 2 > STACK_SIZE / 2) err = "function needs too much stack";
done:
  free(start); free(depth); free(work);
  return err;
}

Event Image::event(uint8_t i) const {
  const uint8_t *e = events + i * 6;
  return Event{ e[0], e[1], rd32(e + 2) };
}

int Image::str(uint8_t i, const char **out) const {
  if (i >= nStrings) return -1;
  const uint8_t *p = strings;
  for (uint8_t k = 0; k < i; k++) p += 1 + p[0];
  *out = (const char *)(p + 1);
  return p[0];
}

Func Image::func(uint8_t i) const {
  const uint8_t *f = funcs + i * 4;
  return Func{ rd16(f), f[2], f[3] };
}

size_t stateBaseSize(const Image &img) {
  return sizeof(StateHeader) + img.nGlobals * sizeof(Value) + MAX_ARRAYS * sizeof(ArrayRef);
}

const char *errorText(uint8_t e) {
  switch (e) {
    case E_OK: return "ok";
    case E_BUDGET: return "script too slow: instruction budget exceeded";
    case E_STACK: return "stack overflow";
    case E_TYPE: return "type error";
    case E_BAD_CODE: return "invalid bytecode";
    case E_PIXEL_RETURN: return "pixel() must return a colour";
    case E_DRAW_IN_PIXEL: return "drawing function used inside pixel()";
    case E_ARRAYS: return "too many arrays (max 16)";
    case E_MEMORY: return "not enough memory for arrays";
    default: return "error";
  }
}

// ---------------- colour maths (match vm.mjs) ----------------
static inline uint8_t clamp8(float v) { return !(v > 0.0f) ? 0 : v >= 255.0f ? 255 : (uint8_t)floorf(v + 0.5f); }  // NaN -> 0
static inline uint8_t CR(uint32_t c) { return (c >> 16) & 255; }
static inline uint8_t CG(uint32_t c) { return (c >> 8) & 255; }
static inline uint8_t CB(uint32_t c) { return c & 255; }
static inline uint8_t CW(uint32_t c) { return (c >> 24) & 255; }
static inline float fract(float x) { return x - floorf(x); }
// float -> int without undefined behaviour.
// toI32: JavaScript ToInt32 semantics (wraps), used where the JS VM applies bitwise ops.
static inline int32_t toI32(float x) {
  if (!(x == x) || x > 3.4e38f || x < -3.4e38f) return 0;  // NaN, +-inf
  float fl = floorf(x);
  if (fl >= -2147483648.0f && fl < 2147483648.0f) return (int32_t)fl;
  double d = fmod((double)fl, 4294967296.0);
  if (d < 0) d += 4294967296.0;
  return (int32_t)(uint32_t)d;
}
// toIndex: floor for pixel/array/slot indices; NaN, inf and |x| >= 1e9 map to a value that is
// out of range for every index check and safe to add small offsets to.
static inline int toIndex(float x) {
  if (!(x > -1e9f && x < 1e9f)) return -(1 << 30);
  return (int)floorf(x);
}
static inline uint8_t sat(int v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

uint32_t pack(float r, float g, float b, float w) {
  return ((uint32_t)clamp8(w) << 24) | ((uint32_t)clamp8(r) << 16) | ((uint32_t)clamp8(g) << 8) | clamp8(b);
}
uint32_t scaleColor(uint32_t c, float f) {
  if (!(f > 0.0f)) return 0;
  return pack(CR(c) * f, CG(c) * f, CB(c) * f, CW(c) * f);
}
uint32_t addColor(uint32_t a, uint32_t b) {
  return ((uint32_t)sat(CW(a) + CW(b)) << 24) | ((uint32_t)sat(CR(a) + CR(b)) << 16) | ((uint32_t)sat(CG(a) + CG(b)) << 8) | sat(CB(a) + CB(b));
}
uint32_t subColor(uint32_t a, uint32_t b) {
  return ((uint32_t)sat(CW(a) - CW(b)) << 24) | ((uint32_t)sat(CR(a) - CR(b)) << 16) | ((uint32_t)sat(CG(a) - CG(b)) << 8) | sat(CB(a) - CB(b));
}
uint32_t blendColor(uint32_t a, uint32_t b, float f) {
  f = f <= 0.0f ? 0.0f : f >= 1.0f ? 1.0f : f;
  #define GLOW_MIX(x, y) ((float)(x) + ((float)(y) - (float)(x)) * f)
  return pack(GLOW_MIX(CR(a), CR(b)), GLOW_MIX(CG(a), CG(b)), GLOW_MIX(CB(a), CB(b)), GLOW_MIX(CW(a), CW(b)));
  #undef GLOW_MIX
}
uint32_t hsv(float h, float s, float v) {
  h = fract(h / 256.0f) * 6.0f;
  s = s / 255.0f; s = s < 0 ? 0 : s > 1 ? 1 : s;
  v = v < 0 ? 0 : v > 255 ? 255 : v;
  if (!(h >= 0 && h < 6)) h = 0;  // NaN/inf input
  int i = (int)h; float f = h - i;
  float p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0: return pack(v, t, p); case 1: return pack(q, v, p); case 2: return pack(p, v, t);
    case 3: return pack(p, q, v); case 4: return pack(t, p, v); default: return pack(v, p, q);
  }
}

static const uint8_t PERM[256] = {151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180};
static inline int P(int i) { return PERM[i & 255]; }
static inline float nfade(float t) { return t * t * t * (t * (t * 6 - 15) + 10); }
static inline float nlerp(float t, float a, float b) { return a + t * (b - a); }
static inline float grad(int h, float x, float y, float z) {
  h &= 15;
  float u = h < 8 ? x : y, v = h < 4 ? y : (h == 12 || h == 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
float noise3(float x, float y, float z) {
  float fx = floorf(x), fy = floorf(y), fz = floorf(z);
  int X = toI32(fx) & 255, Y = toI32(fy) & 255, Z = toI32(fz) & 255;
  x -= fx; y -= fy; z -= fz;
  float u = nfade(x), v = nfade(y), w = nfade(z);
  int A = P(X) + Y, AA = P(A) + Z, AB = P(A + 1) + Z, B = P(X + 1) + Y, BA = P(B) + Z, BB = P(B + 1) + Z;
  float r = nlerp(w,
    nlerp(v, nlerp(u, grad(P(AA), x, y, z), grad(P(BA), x - 1, y, z)), nlerp(u, grad(P(AB), x, y - 1, z), grad(P(BB), x - 1, y - 1, z))),
    nlerp(v, nlerp(u, grad(P(AA + 1), x, y, z - 1), grad(P(BA + 1), x - 1, y, z - 1)), nlerp(u, grad(P(AB + 1), x, y - 1, z - 1), grad(P(BB + 1), x - 1, y - 1, z - 1))));
  float o = r * 0.5f + 0.5f;
  return o < 0 ? 0 : o > 1 ? 1 : o;
}

// ---------------- VM ----------------
bool VM::fail(uint8_t e, const char *detail) { lastError = e; lastDetail = detail; return false; }

float VM::rngFloat() {
  uint32_t x = st_->rng;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  st_->rng = x;
  return (float)(x >> 8) / 16777216.0f;
}

static inline Value mkNum(float f) { Value v; v.f = f; v.tag = T_NUM; return v; }
static inline Value mkCol(uint32_t c) { Value v; v.u = c; v.tag = T_COLOR; return v; }
static inline Value mkBool(bool b) { Value v; v.f = b ? 1.0f : 0.0f; v.tag = T_BOOL; return v; }
static inline bool truthy(const Value &v) {
  if (v.tag == T_ARRAY || v.tag == T_STR) return true;
  if (v.tag == T_COLOR) return v.u != 0;
  return v.f != 0.0f;
}
// numbers and bools are both stored as float; bools are 0/1
static inline bool isNum(const Value &v) { return v.tag == T_NUM || v.tag == T_BOOL; }

bool VM::allocArray(uint8_t tag, uint16_t n, Value &out, uint32_t **data) {
  if (st_->nArrays >= MAX_ARRAYS) return fail(E_ARRAYS);
  uint32_t bytes = (uint32_t)n * 4;
  if (measuring_) { measured_ += bytes; *data = nullptr; }
  else {
    if (st_->arenaUsed + bytes > st_->arenaSize) return fail(E_MEMORY);
    ArrayRef &a = arrays_[st_->nArrays];
    a.off = st_->arenaUsed; a.size = n; a.tag = tag;
    st_->arenaUsed += bytes;
    *data = (uint32_t *)(arena_ + a.off);
    memset(*data, 0, bytes);
  }
  out.u = st_->nArrays++; out.tag = T_ARRAY;
  return true;
}

void VM::setAA(float pos, uint32_t c, bool additive) {
  int i0 = toIndex(pos); float f = pos - floorf(pos);
  if (!(f >= 0 && f < 1)) f = 0;
  auto put = [&](int i, float weight) {
    if (i < 0 || i >= host_->len || weight <= 0) return;
    uint32_t cur = host_->getPixel(i);
    uint32_t n;
    if (additive) n = addColor(cur, weight >= 1 ? c : scaleColor(c, weight));
    else n = weight >= 1 ? c : blendColor(cur, c, weight);
    host_->setPixel(i, n);
  };
  if (f == 0) put(i0, 1);
  else { put(i0, 1 - f); put(i0 + 1, f); }
}

bool VM::measureArena(const Image &img, Host &host, uint32_t &arenaBytes) {
  static Value tmpGlobals[64];
  static ArrayRef tmpArrays[MAX_ARRAYS];
  StateHeader tmp = {};
  tmp.rng = 1;
  img_ = &img; host_ = &host; st_ = &tmp; globals_ = tmpGlobals; arrays_ = tmpArrays; arena_ = nullptr;
  measuring_ = true; measured_ = 0; budget_ = DEFAULT_BUDGET; lastError = E_OK;
  bool ok = true;
  if (img.initFn != 255) { Value r; ok = exec(img.initFn, nullptr, 0, r); }
  measuring_ = false;
  arenaBytes = measured_;
  return ok;
}

bool VM::runEvent(const Image &img, Host &host, uint8_t fn, uint8_t *state, size_t stateSize, uint32_t seed, uint32_t budget) {
  if (!prepare(img, host, state, stateSize, seed, budget)) return false;
  if (fn >= img.nFuncs || img.func(fn).nargs != 0) return fail(E_BAD_CODE, "bad handler");
  Value r;
  if (!exec(fn, nullptr, 0, r)) { st_->error = lastError; return false; }
  return true;
}

// common setup for runFrame/runEvent: bind state memory, run init once
bool VM::prepare(const Image &img, Host &host, uint8_t *state, size_t stateSize, uint32_t seed, uint32_t budget) {
  size_t base = stateBaseSize(img);
  if (stateSize < base) return fail(E_MEMORY);
  img_ = &img; host_ = &host;
  st_ = (StateHeader *)state;
  globals_ = (Value *)(state + sizeof(StateHeader));
  arrays_ = (ArrayRef *)(state + sizeof(StateHeader) + img.nGlobals * sizeof(Value));
  arena_ = state + base;
  budget_ = budget; lastError = E_OK; measuring_ = false; pixelMode_ = false;
  if (st_->error) return fail(st_->error);

  if (!st_->inited) {
    st_->rng = seed ? seed : 1;
    st_->arenaSize = stateSize - base;
    st_->arenaUsed = 0; st_->nArrays = 0; st_->frame = 0;
    for (int i = 0; i < img.nGlobals; i++) globals_[i] = mkNum(0);
    if (img.initFn != 255) { Value r; if (!exec(img.initFn, nullptr, 0, r)) { st_->error = lastError; return false; } }
    st_->inited = 1;
  }
  return true;
}

bool VM::runFrame(const Image &img, Host &host, uint8_t *state, size_t stateSize, uint32_t seed, uint32_t budget) {
  if (img.kind != K_EFFECT || img.mainFn == 255) return fail(E_BAD_CODE, "not an effect");
  if (!prepare(img, host, state, stateSize, seed, budget)) return false;
  bool ok = true;
  if (img.flags & Image::F_PIXEL) {
    pixelMode_ = true;
    Value args[2]; Value r;
    if (img.flags & Image::F_2D) {
      for (int y = 0; y < host.h && ok; y++) for (int x = 0; x < host.w; x++) {
        args[0] = mkNum(x); args[1] = mkNum(y);
        if (!(ok = exec(img.mainFn, args, 2, r))) break;
        if (r.tag != T_COLOR) { ok = fail(E_PIXEL_RETURN); break; }
        host.setPixel(y * host.w + x, r.u);
      }
    } else {
      for (int i = 0; i < host.len; i++) {
        args[0] = mkNum(i);
        if (!(ok = exec(img.mainFn, args, 1, r))) break;
        if (r.tag != T_COLOR) { ok = fail(E_PIXEL_RETURN); break; }
        host.setPixel(i, r.u);
      }
    }
    pixelMode_ = false;
  } else {
    Value r;
    ok = exec(img.mainFn, nullptr, 0, r);
  }
  if (!ok) { st_->error = lastError; return false; }
  st_->frame++;
  return true;
}

bool VM::exec(uint8_t fn, const Value *args, uint8_t nargs, Value &result) {
  // The image passed Image::verify(): operands, jump targets and stack depths are valid,
  // so only dynamic properties (types, array indices, call depth, budget) are checked here.
  const Image &img = *img_;
  const uint8_t *code = img.code;
  Value *const stack = stack_;
  int sp = 0, fp = 0, base = 0;
  const uint8_t *ip;

  for (int k = 0; k < nargs; k++) stack[sp++] = args[k];

  auto enter = [&](uint8_t fi, const uint8_t *ret) -> const uint8_t * {
    if (fp >= MAX_FRAMES || sp + img.maxFrame > STACK_SIZE) { fail(E_STACK, "call depth"); return nullptr; }
    Func f = img.func(fi);
    int b = sp - f.nargs;
    for (int k = f.nargs; k < f.nlocals; k++) stack[b + k] = mkNum(0);
    sp = b + f.nlocals;
    frames_[fp].base = (uint16_t)b; frames_[fp].retPc = (int32_t)(ret ? ret - code : -1); fp++;
    base = b;
    return code + f.off;
  };
  #define TICK() do { if (budget_-- == 0) return fail(E_BUDGET, ""); } while (0)
  #define TYPEFAIL(d) return fail(E_TYPE, d)

  if (!(ip = enter(fn, nullptr))) return false;

#if defined(__GNUC__)
  // the verifier rejects unknown opcodes, so the table only covers OP_HALT..OP_ARRLIT
  static_assert(OP_ARRLIT == 35, "update the dispatch table when adding opcodes");
  static const void *const table[36] = {
    #define L(x) &&L_##x
    L(HALT), L(PUSHK), L(PUSHI), L(PUSHT), L(PUSHF), L(POP), L(DUP), L(LOADL), L(STOREL), L(LOADG), L(STOREG),
    L(LOADB), L(LOADC), L(ADD), L(SUB), L(MUL), L(DIV), L(MOD), L(NEG), L(NOT), L(EQ), L(NE), L(LT), L(LE),
    L(GT), L(GE), L(JMP), L(JZ), L(JNZ), L(CALL), L(RET), L(NATIVE), L(AGET), L(ASET), L(PUSHS), L(ARRLIT),
    #undef L
  };
  #define CASE(x) L_##x:
  #define NEXT() goto *table[*ip++]
  NEXT();
#else
  #define CASE(x) case OP_##x:
  #define NEXT() goto dispatch
  dispatch:
  switch (*ip++) {
#endif

  CASE(HALT) result = mkNum(0); return true;
  CASE(PUSHK) { const uint8_t *c = img.consts + *ip++ * 5; Value v; v.u = rd32(c + 1); v.tag = c[0]; stack[sp++] = v; NEXT(); }
  CASE(PUSHI) stack[sp++] = mkNum((int8_t)*ip++); NEXT();
  CASE(PUSHT) stack[sp++] = mkBool(true); NEXT();
  CASE(PUSHF) stack[sp++] = mkBool(false); NEXT();
  CASE(POP) sp--; NEXT();
  CASE(DUP) stack[sp] = stack[sp - 1]; sp++; NEXT();
  CASE(LOADL) stack[sp++] = stack[base + *ip++]; NEXT();
  CASE(STOREL) stack[base + *ip++] = stack[--sp]; NEXT();
  CASE(LOADG) stack[sp++] = globals_[*ip++]; NEXT();
  CASE(STOREG) globals_[*ip++] = stack[--sp]; NEXT();
  CASE(LOADB) {
    Value v;
    switch (*ip++) {
      case B_T: v = mkNum((float)host_->t); break;
      case B_FRAME: v = mkNum((float)st_->frame); break;
      case B_LEN: v = mkNum(host_->len); break;
      case B_W: v = mkNum(host_->w); break;
      case B_H: v = mkNum(host_->h); break;
      case B_AUDIO_VOL: v = mkNum(host_->audioVol); break;
      case B_AUDIO_PEAK: v = mkBool(host_->audioPeak); break;
      case B_AUDIO_BEAT: v = mkBool(host_->audioBeat); break;
      case B_AUDIO_FREQ: v = mkNum(host_->audioFreq); break;
      default: return fail(E_BAD_CODE, "bad builtin");
    }
    stack[sp++] = v; NEXT();
  }
  CASE(LOADC) { uint8_t c = *ip++; stack[sp++] = c < 5 ? mkNum(host_->controls[c]) : mkBool(host_->controls[c] != 0); NEXT(); }
  CASE(ADD) CASE(SUB) CASE(MUL) CASE(DIV) CASE(MOD) {
    uint8_t op = ip[-1];
    Value *a = &stack[sp - 2], *b = &stack[sp - 1];
    Value r;
    if (isNum(*a) && isNum(*b)) {           // fast path: plain numbers
      float x = a->f, y = b->f;
      switch (op) {
        case OP_ADD: r = mkNum(x + y); break;
        case OP_SUB: r = mkNum(x - y); break;
        case OP_MUL: r = mkNum(x * y); break;
        case OP_DIV: r = mkNum(y == 0 ? 0 : x / y); break;
        default: r = mkNum(y == 0 ? 0 : x - y * floorf(x / y)); break;
      }
    } else if (a->tag == T_COLOR || b->tag == T_COLOR) {
      if (op == OP_ADD && a->tag == T_COLOR && b->tag == T_COLOR) r = mkCol(addColor(a->u, b->u));
      else if (op == OP_SUB && a->tag == T_COLOR && b->tag == T_COLOR) r = mkCol(subColor(a->u, b->u));
      else if (op == OP_MUL && a->tag == T_COLOR && isNum(*b)) r = mkCol(scaleColor(a->u, b->f));
      else if (op == OP_MUL && b->tag == T_COLOR && isNum(*a)) r = mkCol(scaleColor(b->u, a->f));
      else if (op == OP_DIV && a->tag == T_COLOR && isNum(*b)) r = mkCol(b->f == 0 ? 0 : scaleColor(a->u, 1.0f / b->f));
      else TYPEFAIL("colour arithmetic");
    } else TYPEFAIL("expected numbers");
    stack[sp - 2] = r; sp--; NEXT();
  }
  CASE(NEG) { Value *a = &stack[sp - 1]; if (!isNum(*a)) TYPEFAIL("expected number"); *a = mkNum(-a->f); NEXT(); }
  CASE(NOT) stack[sp - 1] = mkBool(!truthy(stack[sp - 1])); NEXT();
  CASE(EQ) CASE(NE) {
    Value *a = &stack[sp - 2], *b = &stack[sp - 1];
    bool eq;
    if (a->tag == T_COLOR || b->tag == T_COLOR) eq = a->tag == b->tag && a->u == b->u;
    else if (isNum(*a) && isNum(*b)) eq = a->f == b->f;
    else TYPEFAIL("cannot compare");
    stack[sp - 2] = mkBool((ip[-1] == OP_EQ) == eq); sp--; NEXT();
  }
  CASE(LT) CASE(LE) CASE(GT) CASE(GE) {
    uint8_t op = ip[-1];
    Value *a = &stack[sp - 2], *b = &stack[sp - 1];
    if (!isNum(*a) || !isNum(*b)) TYPEFAIL("expected numbers");
    float x = a->f, y = b->f;
    stack[sp - 2] = mkBool(op == OP_LT ? x < y : op == OP_LE ? x <= y : op == OP_GT ? x > y : x >= y); sp--; NEXT();
  }
  CASE(JMP) { int16_t d = (int16_t)rd16(ip); ip += 2 + d; if (d < 0) TICK(); NEXT(); }
  CASE(JZ) CASE(JNZ) {
    bool nz = ip[-1] == OP_JNZ;
    int16_t d = (int16_t)rd16(ip); ip += 2;
    if (truthy(stack[--sp]) == nz) { ip += d; if (d < 0) TICK(); }
    NEXT();
  }
  CASE(CALL) { TICK(); uint8_t fi = *ip++; if (!(ip = enter(fi, ip))) return false; NEXT(); }
  CASE(RET) {
    Value v = stack[--sp];
    fp--;
    sp = frames_[fp].base;
    if (fp == 0) { result = v; return true; }
    base = frames_[fp - 1].base;
    ip = code + frames_[fp].retPc;
    stack[sp++] = v; NEXT();
  }
  CASE(NATIVE) {
    TICK();
    uint8_t id = ip[0], argc = ip[1]; ip += 2;
    if (pixelMode_ && NATIVE_DRAWS[id]) return fail(E_DRAW_IN_PIXEL, "");
    sp -= argc;
    Value out;
    if (!native(id, &stack[sp], argc, out)) return false;
    stack[sp++] = out; NEXT();
  }
  CASE(AGET) CASE(ASET) {
    bool set = ip[-1] == OP_ASET;
    Value *v = set ? &stack[--sp] : nullptr;
    Value *ib = &stack[--sp], *ab = &stack[--sp];
    if (ab->tag != T_ARRAY || ab->u >= st_->nArrays) TYPEFAIL("expected an array");
    if (!isNum(*ib)) TYPEFAIL("array index must be a number");
    if (measuring_) { if (!set) stack[sp++] = mkNum(0); NEXT(); }
    const ArrayRef &a = arrays_[ab->u];
    int i = toIndex(ib->f);
    uint32_t *data = (uint32_t *)(arena_ + a.off);
    if (!set) { Value r; r.tag = a.tag; r.u = (i >= 0 && i < a.size) ? data[i] : 0; stack[sp++] = r; }
    else {
      if (a.tag == T_COLOR ? v->tag != T_COLOR : !isNum(*v)) TYPEFAIL("wrong array element type");
      if (i >= 0 && i < a.size) data[i] = v->u;
    }
    NEXT();
  }
  CASE(PUSHS) { Value v; v.u = *ip++; v.tag = T_STR; stack[sp++] = v; NEXT(); }
  CASE(ARRLIT) {
    uint8_t n = *ip++;
    sp -= n;
    uint8_t tag = (n && stack[sp].tag == T_COLOR) ? T_COLOR : T_NUM;
    Value out; uint32_t *data;
    if (!allocArray(tag, n, out, &data)) return false;
    for (int k = 0; k < n; k++) {
      const Value &e = stack[sp + k];
      if (tag == T_COLOR ? e.tag != T_COLOR : !isNum(e)) TYPEFAIL("mixed array literal");
      if (data) data[k] = e.u;
    }
    stack[sp++] = out; NEXT();
  }
#if !defined(__GNUC__)
  default:
  }
#endif
  return fail(E_BAD_CODE, "bad opcode");
  #undef CASE
  #undef NEXT
  #undef TICK
  #undef TYPEFAIL
}

bool VM::native(uint8_t id, Value *a, uint8_t argc, Value &out) {
  Host &h = *host_;
  #define NUM(k) (isNum(a[k]) ? a[k].f : (fail(E_TYPE, "expected a number"), NAN))
  #define COL(k) (a[k].tag == T_COLOR ? a[k].u : (fail(E_TYPE, "expected a colour"), 0u))
  #define CHECK() if (lastError) return false
  #define RET_NUM(x) do { float _v = (x); CHECK(); out = mkNum(_v); return true; } while (0)
  #define RET_COL(x) do { uint32_t _c = (x); CHECK(); out = mkCol(_c); return true; } while (0)
  #define RET_NONE() do { CHECK(); out = mkNum(0); return true; } while (0)
  lastError = E_OK;
  switch (id) {
    case N_SIN: RET_NUM(sinf(NUM(0) * TAU) * 0.5f + 0.5f);
    case N_COS: RET_NUM(cosf(NUM(0) * TAU) * 0.5f + 0.5f);
    case N_TRI: RET_NUM(1.0f - fabsf(2.0f * fract(NUM(0)) - 1.0f));
    case N_SAW: RET_NUM(fract(NUM(0)));
    case N_SQ: RET_NUM(fract(NUM(0)) < 0.5f ? 1.0f : 0.0f);
    case N_ABS: RET_NUM(fabsf(NUM(0)));
    case N_MIN: { float x = NUM(0), y = NUM(1); RET_NUM(x < y ? x : y); }
    case N_MAX: { float x = NUM(0), y = NUM(1); RET_NUM(x > y ? x : y); }
    case N_CLAMP: { float v = NUM(0), lo = NUM(1), hi = NUM(2); RET_NUM(v < lo ? lo : v > hi ? hi : v); }
    case N_FLOOR: RET_NUM(floorf(NUM(0)));
    case N_CEIL: RET_NUM(ceilf(NUM(0)));
    case N_ROUND: { float v = NUM(0); RET_NUM(v < 0 ? -floorf(-v + 0.5f) : floorf(v + 0.5f)); }
    case N_FRACT: RET_NUM(fract(NUM(0)));
    case N_MIX: { float x = NUM(0), y = NUM(1), f = NUM(2); RET_NUM(x + (y - x) * f); }
    case N_SMOOTHSTEP: {
      float e0 = NUM(0), e1 = NUM(1), x = NUM(2); CHECK();
      if (e1 == e0) RET_NUM(x < e0 ? 0.0f : 1.0f);
      float t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t;
      RET_NUM(t * t * (3 - 2 * t));
    }
    case N_SQRT: { float v = NUM(0); RET_NUM(v > 0 ? sqrtf(v) : 0.0f); }
    case N_POW: { float r = powf(NUM(0), NUM(1)); RET_NUM(isfinite(r) ? r : 0.0f); }
    case N_MAP: {
      float v = NUM(0), x0 = NUM(1), x1 = NUM(2), y0 = NUM(3), y1 = NUM(4); CHECK();
      if (x1 == x0) RET_NUM(y0);
      RET_NUM(y0 + (v - x0) * (y1 - y0) / (x1 - x0));
    }
    case N_RANDOM: {
      if (argc) { float n = NUM(0); CHECK(); RET_NUM(floorf(rngFloat() * n)); }
      RET_NUM(rngFloat());
    }
    case N_NOISE: RET_NUM(noise3(NUM(0), argc > 1 ? NUM(1) : 0.0f, argc > 2 ? NUM(2) : 0.0f));
    case N_BEAT: RET_NUM(fract((float)h.t * NUM(0) / 60000.0f));
    case N_RGB: RET_COL(pack(NUM(0), NUM(1), NUM(2), argc > 3 ? NUM(3) : 0.0f));
    case N_HSV: RET_COL(hsv(NUM(0), NUM(1), NUM(2)));
    case N_PAL: { float i = NUM(0); CHECK(); RET_COL(h.palette((uint8_t)(toI32(i) & 255))); }
    case N_BLEND: RET_COL(blendColor(COL(0), COL(1), NUM(2)));
    case N_BRIGHT: RET_COL(scaleColor(COL(0), NUM(1) / 255.0f));
    case N_R: RET_NUM(CR(COL(0)));
    case N_G: RET_NUM(CG(COL(0)));
    case N_B: RET_NUM(CB(COL(0)));
    case N_W: RET_NUM(CW(COL(0)));
    case N_COLOR: { float k = NUM(0); CHECK(); int i = toIndex(k); RET_COL(i >= 0 && i < 3 ? h.colors[i] : 0); }
    case N_SET: case N_ADD: {
      if (argc == 3) {
        float fx = NUM(0), fy = NUM(1); uint32_t c = COL(2); CHECK();
        int x = toIndex(fx), y = toIndex(fy);
        if (x >= 0 && x < h.w && y >= 0 && y < h.h) h.setPixel(y * h.w + x, c);
        RET_NONE();
      }
      float pos = NUM(0); uint32_t c = COL(1); CHECK();
      setAA(pos, c, id == N_ADD);
      RET_NONE();
    }
    case N_GET: {
      if (argc == 2) {
        float fx = NUM(0), fy = NUM(1); CHECK();
        int x = toIndex(fx), y = toIndex(fy);
        RET_COL(x >= 0 && x < h.w && y >= 0 && y < h.h ? h.getPixel(y * h.w + x) : 0);
      }
      float fi = NUM(0); CHECK(); int i = toIndex(fi);
      RET_COL(i >= 0 && i < h.len ? h.getPixel(i) : 0);
    }
    case N_FILL: { uint32_t c = COL(0); CHECK(); for (int i = 0; i < h.len; i++) h.setPixel(i, c); RET_NONE(); }
    case N_FADE: {
      float amt = NUM(0); CHECK();
      amt = amt < 0 ? 0 : amt > 255 ? 255 : amt;
      float keep = (255.0f - amt) / 255.0f;
      for (int i = 0; i < h.len; i++) h.setPixel(i, scaleColor(h.getPixel(i), keep));
      RET_NONE();
    }
    case N_BLUR: {
      float amt = NUM(0); CHECK();
      amt = amt < 0 ? 0 : amt > 255 ? 255 : amt;
      float seep = amt / 510.0f, keep = 1.0f - amt / 255.0f;
      uint32_t carry = 0;
      for (int i = 0; i < h.len; i++) {
        uint32_t cur = h.getPixel(i);
        uint32_t part = scaleColor(cur, seep);
        if (i > 0) h.setPixel(i - 1, addColor(h.getPixel(i - 1), part));
        h.setPixel(i, addColor(scaleColor(cur, keep), carry));
        carry = part;
      }
      RET_NONE();
    }
    case N_SHIFT: {
      float fn = NUM(0); CHECK();
      int L = h.len;
      float tn = truncf(fn);
      int n = !(tn == tn) ? 0 : tn > L ? L : tn < -L ? -L : (int)tn;  // |n| >= len clears the strip
      if (n > 0) { for (int i = L - 1; i >= 0; i--) h.setPixel(i, i - n >= 0 ? h.getPixel(i - n) : 0); }
      else if (n < 0) { for (int i = 0; i < L; i++) h.setPixel(i, i - n < L ? h.getPixel(i - n) : 0); }
      RET_NONE();
    }
    case N_ARRAY: {
      float fn = NUM(0); CHECK();
      int n = toIndex(fn); n = n < 1 ? 1 : n > MAX_ARRAY_LEN ? MAX_ARRAY_LEN : n;
      bool isCol = argc > 1 && a[1].tag == T_COLOR;
      if (argc > 1 && !isCol && !isNum(a[1])) return fail(E_TYPE, "array fill value");
      uint32_t *data;
      if (!allocArray(isCol ? T_COLOR : T_NUM, n, out, &data)) return false;
      if (data && argc > 1) for (int k = 0; k < n; k++) data[k] = a[1].u;
      return true;
    }
    case N_SIZE: {
      if (a[0].tag != T_ARRAY || a[0].u >= st_->nArrays) return fail(E_TYPE, "expected an array");
      RET_NUM(measuring_ ? 0.0f : (float)arrays_[a[0].u].size);
    }
    case N_AUDIO_BAND: {
      float k = NUM(0); CHECK(); int i = toIndex(k);
      RET_NUM(i >= 0 && i < 16 && h.audioBands ? h.audioBands[i] : 0.0f);
    }
    default:
      if (NATIVE_SHOW[id]) {
        if (img_->kind != K_SHOW) return fail(E_BAD_CODE, "show function in an effect");
        if (!h.show(id, a, argc, *img_, out)) return fail(E_TYPE, "bad argument to a show function");
        return true;
      }
      return fail(E_BAD_CODE, "native not implemented");
  }
  #undef NUM
  #undef COL
  #undef CHECK
  #undef RET_NUM
  #undef RET_COL
  #undef RET_NONE
}

} // namespace glow
