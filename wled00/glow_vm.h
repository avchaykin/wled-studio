#pragma once
/*
 * Glow VM — bytecode interpreter for Glow effect scripts.
 * Platform independent (no Arduino/WLED dependencies) so it can be unit tested
 * natively; WLED integration lives in glow_fx.cpp.
 * Semantics follow the reference VM in glow/vm.mjs.
 */
#include <stdint.h>
#include <stddef.h>
#include "glow_natives.h"

namespace glow {

struct Value {
  union { float f; uint32_t u; };
  uint8_t tag;
};

struct Func { uint16_t off; uint8_t nargs; uint8_t nlocals; };

// Parsed view over a program image; does not own the bytes.
struct Image {
  const uint8_t *bytes = nullptr;
  size_t size = 0;
  uint8_t kind = 0, flags = 0, nGlobals = 0, nConsts = 0, nStrings = 0, nFuncs = 0, nControls = 0;
  uint8_t initFn = 255, mainFn = 255;
  const uint8_t *consts = nullptr;  // 5 bytes each
  const uint8_t *funcs = nullptr;   // 4 bytes each
  const char *meta = nullptr;       // not NUL terminated
  uint16_t metaLen = 0;
  const uint8_t *code = nullptr;
  uint16_t codeLen = 0;

  enum Flags : uint8_t { F_PIXEL = 1, F_2D = 2, F_FRAME = 4, F_PALETTE = 8, F_AUDIO = 16 };
  // Validates header and section bounds. Returns nullptr on success or an error message.
  const char *load(const uint8_t *data, size_t len);
  Func func(uint8_t i) const;
};

// What the script can see of the outside world. Implemented by the WLED glue
// (and by the native test harness).
class Host {
public:
  virtual ~Host() {}
  int len = 0, w = 0, h = 1;
  uint32_t t = 0;            // ms since effect start
  uint8_t controls[8] = {};  // sx ix c1 c2 c3 o1 o2 o3
  uint32_t colors[3] = {};
  uint8_t audioVol = 0; bool audioPeak = false, audioBeat = false; float audioFreq = 0;
  const uint8_t *audioBands = nullptr; // 16 bytes or nullptr
  virtual uint32_t getPixel(int i) = 0;
  virtual void setPixel(int i, uint32_t c) = 0;
  virtual uint32_t palette(uint8_t i) = 0;
};

// Per-segment persistent state lives in caller-provided memory:
//   [StateHeader][Value globals[nGlobals]][ArrayRef arrays[MAX_ARRAYS]][arena bytes]
struct ArrayRef { uint32_t off; uint16_t size; uint8_t tag; uint8_t _pad; };
struct StateHeader {
  uint32_t frame;
  uint32_t rng;
  uint32_t arenaSize;
  uint32_t arenaUsed;
  uint8_t inited;
  uint8_t nArrays;
  uint8_t error;      // 0 = ok, otherwise Error code; script stops running
  uint8_t _pad;
};

static const int MAX_ARRAYS = 16;
static const int MAX_ARRAY_LEN = 4096;
static const int STACK_SIZE = 256;
static const int MAX_FRAMES = 32;
static const uint32_t DEFAULT_BUDGET = 200000;

enum Error : uint8_t {
  E_OK = 0, E_BUDGET, E_STACK, E_TYPE, E_BAD_CODE, E_PIXEL_RETURN, E_DRAW_IN_PIXEL, E_ARRAYS, E_MEMORY,
};
const char *errorText(uint8_t e);

// Bytes of state memory needed before init has run (arena excluded).
size_t stateBaseSize(const Image &img);

class VM {
public:
  // Measure how much arena the init function needs (runs init without storing arrays).
  // Returns false on error (see lastError).
  bool measureArena(const Image &img, Host &host, uint32_t &arenaBytes);
  // Run one frame. `state` must be stateBaseSize(img)+arena bytes, zeroed on first use;
  // on first call initialises with given seed.
  bool runFrame(const Image &img, Host &host, uint8_t *state, size_t stateSize, uint32_t seed, uint32_t budget = DEFAULT_BUDGET);
  uint8_t lastError = E_OK;
  const char *lastDetail = "";

private:
  struct CallFrame { uint16_t base; int32_t retPc; };
  Value stack_[STACK_SIZE];
  CallFrame frames_[MAX_FRAMES];
  const Image *img_ = nullptr;
  Host *host_ = nullptr;
  StateHeader *st_ = nullptr;
  Value *globals_ = nullptr;
  ArrayRef *arrays_ = nullptr;
  uint8_t *arena_ = nullptr;
  bool measuring_ = false;
  bool pixelMode_ = false;
  uint32_t budget_ = 0;
  uint32_t measured_ = 0;

  bool exec(uint8_t fn, const Value *args, uint8_t nargs, Value &result);
  bool native(uint8_t id, Value *a, uint8_t argc, Value &out);
  bool fail(uint8_t e, const char *detail = "");
  bool allocArray(uint8_t tag, uint16_t n, Value &out, uint32_t **data);
  float rngFloat();
  void setAA(float pos, uint32_t c, bool additive);
};

// colour helpers shared with tests
uint32_t pack(float r, float g, float b, float w = 0);
uint32_t scaleColor(uint32_t c, float f);
uint32_t addColor(uint32_t a, uint32_t b);
uint32_t subColor(uint32_t a, uint32_t b);
uint32_t blendColor(uint32_t a, uint32_t b, float f);
uint32_t hsv(float h, float s, float v);
float noise3(float x, float y, float z);

} // namespace glow
