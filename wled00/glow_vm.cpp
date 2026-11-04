/*
 * Glow VM — see glow_vm.h. Keep in step with glow/vm.mjs (reference semantics).
 */
#include "glow_vm.h"

// the interpreter loop is hot; the rest of WLED is built with -Os
#if defined(__GNUC__) && !defined(__clang__)
  #pragma GCC optimize("O2")
#endif
#include <math.h>
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
  nFuncs = data[10]; nControls = data[11]; initFn = data[12]; mainFn = data[13];
  codeLen = rd16(data + 16); metaLen = rd16(data + 18);
  if (nGlobals > 64) return "too many globals";
  size_t p = 20;
  consts = data + p; p += (size_t)nConsts * 5;
  for (uint8_t i = 0; i < nStrings; i++) { if (p >= len) return "truncated strings"; p += 1 + data[p]; }
  funcs = data + p; p += (size_t)nFuncs * 4;
  meta = (const char *)(data + p); p += metaLen;
  code = data + p; p += codeLen;
  if (p != len) return "image size mismatch";
  for (uint8_t i = 0; i < nConsts; i++) if (consts[i * 5] > T_STR) return "bad constant";
  for (uint8_t i = 0; i < nFuncs; i++) {
    Func f = func(i);
    if (f.off >= codeLen || f.nargs > f.nlocals || f.nlocals > 64) return "bad function table";
  }
  if (initFn != 255 && initFn >= nFuncs) return "bad init function";
  if (mainFn != 255 && mainFn >= nFuncs) return "bad main function";
  if (kind == K_EFFECT && mainFn == 255) return "effect has no main function";
  return nullptr;
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
static inline uint8_t clamp8(float v) { return v <= 0.0f ? 0 : v >= 255.0f ? 255 : (uint8_t)floorf(v + 0.5f); }
static inline uint8_t CR(uint32_t c) { return (c >> 16) & 255; }
static inline uint8_t CG(uint32_t c) { return (c >> 8) & 255; }
static inline uint8_t CB(uint32_t c) { return c & 255; }
static inline uint8_t CW(uint32_t c) { return (c >> 24) & 255; }
static inline float fract(float x) { return x - floorf(x); }
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
  int i = (int)floorf(h); float f = h - i;
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
  int X = (int)fx & 255, Y = (int)fy & 255, Z = (int)fz & 255;
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
  float fi = floorf(pos); int i0 = (int)fi; float f = pos - fi;
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

bool VM::runFrame(const Image &img, Host &host, uint8_t *state, size_t stateSize, uint32_t seed, uint32_t budget) {
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
  const Image &img = *img_;
  const uint8_t *code = img.code;
  const uint16_t codeLen = img.codeLen;
  int sp = 0, fp = 0;
  int32_t pc;

  for (int k = 0; k < nargs; k++) stack_[sp++] = args[k];

  #define FAIL(e, d) return fail(e, d)
  #define NEED(n) do { if (pc + (n) > codeLen) FAIL(E_BAD_CODE, "truncated"); } while (0)
  #define BASE (frames_[fp - 1].base)
  #define POP() (sp > BASE ? &stack_[--sp] : nullptr)
  #define PUSH(v) do { if (sp >= STACK_SIZE) FAIL(E_STACK, ""); stack_[sp++] = (v); } while (0)

  auto enter = [&](uint8_t fi, int32_t retPc) -> int32_t {
    if (fi >= img.nFuncs) { fail(E_BAD_CODE, "bad function"); return -1; }
    if (fp >= MAX_FRAMES) { fail(E_STACK, "call depth"); return -1; }
    Func f = img.func(fi);
    int base = sp - f.nargs;
    if (base < (fp ? frames_[fp - 1].base : 0) || base + f.nlocals + 16 > STACK_SIZE) { fail(E_STACK, ""); return -1; }
    for (int k = f.nargs; k < f.nlocals; k++) stack_[base + k] = mkNum(0);
    sp = base + f.nlocals;
    frames_[fp].base = base; frames_[fp].retPc = retPc; fp++;
    return f.off;
  };

  pc = enter(fn, -1);
  if (pc < 0) return false;

  for (;;) {
    if (budget_-- == 0) FAIL(E_BUDGET, "");
    if (pc < 0 || pc >= codeLen) FAIL(E_BAD_CODE, "pc out of range");
    uint8_t op = code[pc++];
    switch (op) {
      case OP_HALT: result = mkNum(0); return true;
      case OP_PUSHK: {
        NEED(1); uint8_t k = code[pc++];
        if (k >= img.nConsts) FAIL(E_BAD_CODE, "bad const");
        const uint8_t *c = img.consts + k * 5;
        Value v; v.u = rd32(c + 1); v.tag = c[0];
        PUSH(v); break;
      }
      case OP_PUSHI: { NEED(1); PUSH(mkNum((int8_t)code[pc++])); break; }
      case OP_PUSHT: PUSH(mkBool(true)); break;
      case OP_PUSHF: PUSH(mkBool(false)); break;
      case OP_POP: if (!POP()) FAIL(E_STACK, "underflow"); break;
      case OP_DUP: { if (sp <= BASE) FAIL(E_STACK, "underflow"); Value v = stack_[sp - 1]; PUSH(v); break; }
      case OP_LOADL: { NEED(1); int k = BASE + code[pc++]; if (k >= sp) FAIL(E_BAD_CODE, "bad local"); Value v = stack_[k]; PUSH(v); break; }
      case OP_STOREL: {
        NEED(1); int k = BASE + code[pc++]; Value *v = POP();
        if (!v || k >= sp) FAIL(E_BAD_CODE, "bad local");
        stack_[k] = *v; break;
      }
      case OP_LOADG: { NEED(1); uint8_t g = code[pc++]; if (g >= img.nGlobals) FAIL(E_BAD_CODE, "bad global"); PUSH(globals_[g]); break; }
      case OP_STOREG: {
        NEED(1); uint8_t g = code[pc++]; Value *v = POP();
        if (!v || g >= img.nGlobals) FAIL(E_BAD_CODE, "bad global");
        globals_[g] = *v; break;
      }
      case OP_LOADB: {
        NEED(1); uint8_t b = code[pc++]; Value v;
        switch (b) {
          case B_T: v = mkNum((float)host_->t); break;
          case B_FRAME: v = mkNum((float)st_->frame); break;
          case B_LEN: v = mkNum(host_->len); break;
          case B_W: v = mkNum(host_->w); break;
          case B_H: v = mkNum(host_->h); break;
          case B_AUDIO_VOL: v = mkNum(host_->audioVol); break;
          case B_AUDIO_PEAK: v = mkBool(host_->audioPeak); break;
          case B_AUDIO_BEAT: v = mkBool(host_->audioBeat); break;
          case B_AUDIO_FREQ: v = mkNum(host_->audioFreq); break;
          default: FAIL(E_BAD_CODE, "bad builtin");
        }
        PUSH(v); break;
      }
      case OP_LOADC: {
        NEED(1); uint8_t c = code[pc++];
        if (c > 7) FAIL(E_BAD_CODE, "bad control");
        PUSH(c < 5 ? mkNum(host_->controls[c]) : mkBool(host_->controls[c] != 0));
        break;
      }
      case OP_ADD: case OP_SUB: case OP_MUL: case OP_DIV: case OP_MOD: {
        Value *b = POP(); Value *a = POP();
        if (!a || !b) FAIL(E_STACK, "underflow");
        Value r;
        if (a->tag == T_COLOR || b->tag == T_COLOR) {
          if (op == OP_ADD && a->tag == T_COLOR && b->tag == T_COLOR) r = mkCol(addColor(a->u, b->u));
          else if (op == OP_SUB && a->tag == T_COLOR && b->tag == T_COLOR) r = mkCol(subColor(a->u, b->u));
          else if (op == OP_MUL && a->tag == T_COLOR && isNum(*b)) r = mkCol(scaleColor(a->u, b->f));
          else if (op == OP_MUL && b->tag == T_COLOR && isNum(*a)) r = mkCol(scaleColor(b->u, a->f));
          else if (op == OP_DIV && a->tag == T_COLOR && isNum(*b)) r = mkCol(b->f == 0 ? 0 : scaleColor(a->u, 1.0f / b->f));
          else FAIL(E_TYPE, "colour arithmetic");
        } else {
          if (!isNum(*a) || !isNum(*b)) FAIL(E_TYPE, "expected numbers");
          float x = a->f, y = b->f;
          switch (op) {
            case OP_ADD: r = mkNum(x + y); break;
            case OP_SUB: r = mkNum(x - y); break;
            case OP_MUL: r = mkNum(x * y); break;
            case OP_DIV: r = mkNum(y == 0 ? 0 : x / y); break;
            default: r = mkNum(y == 0 ? 0 : x - y * floorf(x / y)); break;
          }
        }
        stack_[sp++] = r; break;
      }
      case OP_NEG: { Value *a = POP(); if (!a || !isNum(*a)) FAIL(E_TYPE, "expected number"); stack_[sp++] = mkNum(-a->f); break; }
      case OP_NOT: { Value *a = POP(); if (!a) FAIL(E_STACK, "underflow"); stack_[sp++] = mkBool(!truthy(*a)); break; }
      case OP_EQ: case OP_NE: {
        Value *b = POP(); Value *a = POP();
        if (!a || !b) FAIL(E_STACK, "underflow");
        bool eq;
        if (a->tag == T_COLOR || b->tag == T_COLOR) eq = a->tag == b->tag && a->u == b->u;
        else if (isNum(*a) && isNum(*b)) eq = a->f == b->f;
        else FAIL(E_TYPE, "cannot compare");
        stack_[sp++] = mkBool((op == OP_EQ) == eq); break;
      }
      case OP_LT: case OP_LE: case OP_GT: case OP_GE: {
        Value *b = POP(); Value *a = POP();
        if (!a || !b) FAIL(E_STACK, "underflow");
        if (!isNum(*a) || !isNum(*b)) FAIL(E_TYPE, "expected numbers");
        float x = a->f, y = b->f;
        bool r = op == OP_LT ? x < y : op == OP_LE ? x <= y : op == OP_GT ? x > y : x >= y;
        stack_[sp++] = mkBool(r); break;
      }
      case OP_JMP: { NEED(2); int16_t d = (int16_t)rd16(code + pc); pc += 2 + d; break; }
      case OP_JZ: case OP_JNZ: {
        NEED(2); int16_t d = (int16_t)rd16(code + pc); pc += 2;
        Value *a = POP(); if (!a) FAIL(E_STACK, "underflow");
        if (truthy(*a) == (op == OP_JNZ)) pc += d;
        break;
      }
      case OP_CALL: { NEED(1); uint8_t fi = code[pc++]; pc = enter(fi, pc); if (pc < 0) return false; break; }
      case OP_RET: {
        Value *r = POP(); if (!r) FAIL(E_STACK, "underflow");
        Value v = *r;
        fp--;
        sp = frames_[fp].base;
        if (fp == 0) { result = v; return true; }
        pc = frames_[fp].retPc;
        stack_[sp++] = v; break;
      }
      case OP_NATIVE: {
        NEED(2); uint8_t id = code[pc++], argc = code[pc++];
        if (id >= N_COUNT || argc < NATIVE_ARGC[id][0] || argc > NATIVE_ARGC[id][1]) FAIL(E_BAD_CODE, "bad native");
        if (sp - argc < BASE) FAIL(E_STACK, "underflow");
        if (pixelMode_ && NATIVE_DRAWS[id]) FAIL(E_DRAW_IN_PIXEL, "");
        sp -= argc;
        Value out;
        if (!native(id, &stack_[sp], argc, out)) return false;
        stack_[sp++] = out; break;
      }
      case OP_AGET: case OP_ASET: {
        Value *v = nullptr;
        if (op == OP_ASET) { v = POP(); if (!v) FAIL(E_STACK, "underflow"); }
        Value *ib = POP(); Value *ab = POP();
        if (!ib || !ab) FAIL(E_STACK, "underflow");
        if (ab->tag != T_ARRAY || ab->u >= st_->nArrays) FAIL(E_TYPE, "expected an array");
        if (!isNum(*ib)) FAIL(E_TYPE, "array index must be a number");
        if (measuring_) { if (op == OP_AGET) stack_[sp++] = mkNum(0); break; }
        const ArrayRef &a = arrays_[ab->u];
        int i = (int)floorf(ib->f);
        uint32_t *data = (uint32_t *)(arena_ + a.off);
        if (op == OP_AGET) {
          Value r; r.tag = a.tag; r.u = (i >= 0 && i < a.size) ? data[i] : 0;
          stack_[sp++] = r;
        } else {
          if (a.tag == T_COLOR ? v->tag != T_COLOR : !isNum(*v)) FAIL(E_TYPE, "wrong array element type");
          if (i >= 0 && i < a.size) data[i] = v->u;
        }
        break;
      }
      case OP_ARRLIT: {
        NEED(1); uint8_t n = code[pc++];
        if (sp - n < BASE) FAIL(E_STACK, "underflow");
        sp -= n;
        uint8_t tag = (n && stack_[sp].tag == T_COLOR) ? T_COLOR : T_NUM;
        Value out; uint32_t *data;
        if (!allocArray(tag, n, out, &data)) return false;
        for (int k = 0; k < n; k++) {
          const Value &e = stack_[sp + k];
          if (tag == T_COLOR ? e.tag != T_COLOR : !isNum(e)) FAIL(E_TYPE, "mixed array literal");
          if (data) data[k] = e.u;
        }
        stack_[sp++] = out; break;
      }
      default: FAIL(E_BAD_CODE, "bad opcode");
    }
  }
  #undef FAIL
  #undef NEED
  #undef BASE
  #undef POP
  #undef PUSH
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
    case N_PAL: { float i = NUM(0); CHECK(); RET_COL(h.palette((uint8_t)((int)floorf(i) & 255))); }
    case N_BLEND: RET_COL(blendColor(COL(0), COL(1), NUM(2)));
    case N_BRIGHT: RET_COL(scaleColor(COL(0), NUM(1) / 255.0f));
    case N_R: RET_NUM(CR(COL(0)));
    case N_G: RET_NUM(CG(COL(0)));
    case N_B: RET_NUM(CB(COL(0)));
    case N_W: RET_NUM(CW(COL(0)));
    case N_COLOR: { float k = NUM(0); CHECK(); int i = (int)floorf(k); RET_COL(i >= 0 && i < 3 ? h.colors[i] : 0); }
    case N_SET: case N_ADD: {
      if (argc == 3) {
        float fx = NUM(0), fy = NUM(1); uint32_t c = COL(2); CHECK();
        int x = (int)floorf(fx), y = (int)floorf(fy);
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
        int x = (int)floorf(fx), y = (int)floorf(fy);
        RET_COL(x >= 0 && x < h.w && y >= 0 && y < h.h ? h.getPixel(y * h.w + x) : 0);
      }
      float fi = NUM(0); CHECK(); int i = (int)floorf(fi);
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
      int n = (int)truncf(fn), L = h.len;
      if (n > 0) { for (int i = L - 1; i >= 0; i--) h.setPixel(i, i - n >= 0 ? h.getPixel(i - n) : 0); }
      else if (n < 0) { for (int i = 0; i < L; i++) h.setPixel(i, i - n < L ? h.getPixel(i - n) : 0); }
      RET_NONE();
    }
    case N_ARRAY: {
      float fn = NUM(0); CHECK();
      int n = (int)floorf(fn); n = n < 1 ? 1 : n > MAX_ARRAY_LEN ? MAX_ARRAY_LEN : n;
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
      float k = NUM(0); CHECK(); int i = (int)floorf(k);
      RET_NUM(i >= 0 && i < 16 && h.audioBands ? h.audioBands[i] : 0.0f);
    }
    default: return fail(E_BAD_CODE, "native not implemented");
  }
  #undef NUM
  #undef COL
  #undef CHECK
  #undef RET_NUM
  #undef RET_COL
  #undef RET_NONE
}

} // namespace glow
