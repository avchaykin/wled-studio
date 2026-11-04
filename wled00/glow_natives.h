// AUTO-GENERATED from glow/natives.mjs by glow/tools/gen-natives.mjs — do not edit.
#pragma once

namespace glow {

enum Op : uint8_t {
  OP_HALT = 0,
  OP_PUSHK = 1,
  OP_PUSHI = 2,
  OP_PUSHT = 3,
  OP_PUSHF = 4,
  OP_POP = 5,
  OP_DUP = 6,
  OP_LOADL = 7,
  OP_STOREL = 8,
  OP_LOADG = 9,
  OP_STOREG = 10,
  OP_LOADB = 11,
  OP_LOADC = 12,
  OP_ADD = 13,
  OP_SUB = 14,
  OP_MUL = 15,
  OP_DIV = 16,
  OP_MOD = 17,
  OP_NEG = 18,
  OP_NOT = 19,
  OP_EQ = 20,
  OP_NE = 21,
  OP_LT = 22,
  OP_LE = 23,
  OP_GT = 24,
  OP_GE = 25,
  OP_JMP = 26,
  OP_JZ = 27,
  OP_JNZ = 28,
  OP_CALL = 29,
  OP_RET = 30,
  OP_NATIVE = 31,
  OP_AGET = 32,
  OP_ASET = 33,
  OP_PUSHS = 34,
  OP_ARRLIT = 35,
};

enum Native : uint8_t {
  N_SIN = 0,
  N_COS = 1,
  N_TRI = 2,
  N_SAW = 3,
  N_SQ = 4,
  N_ABS = 5,
  N_MIN = 6,
  N_MAX = 7,
  N_CLAMP = 8,
  N_FLOOR = 9,
  N_CEIL = 10,
  N_ROUND = 11,
  N_FRACT = 12,
  N_MIX = 13,
  N_SMOOTHSTEP = 14,
  N_SQRT = 15,
  N_POW = 16,
  N_MAP = 17,
  N_RANDOM = 18,
  N_NOISE = 19,
  N_BEAT = 20,
  N_RGB = 21,
  N_HSV = 22,
  N_PAL = 23,
  N_BLEND = 24,
  N_BRIGHT = 25,
  N_R = 26,
  N_G = 27,
  N_B = 28,
  N_W = 29,
  N_COLOR = 30,
  N_SET = 31,
  N_ADD = 32,
  N_GET = 33,
  N_FILL = 34,
  N_FADE = 35,
  N_BLUR = 36,
  N_SHIFT = 37,
  N_ARRAY = 38,
  N_SIZE = 39,
  N_AUDIO_BAND = 40,
  N_COUNT = 41
};

// min/max argument counts per native, indexed by Native
static const uint8_t NATIVE_ARGC[N_COUNT][2] = { {1,1}, {1,1}, {1,1}, {1,1}, {1,1}, {1,1}, {2,2}, {2,2}, {3,3}, {1,1}, {1,1}, {1,1}, {1,1}, {3,3}, {3,3}, {1,1}, {2,2}, {5,5}, {0,1}, {1,3}, {1,1}, {3,4}, {3,3}, {1,1}, {3,3}, {2,2}, {1,1}, {1,1}, {1,1}, {1,1}, {1,1}, {2,3}, {2,2}, {1,2}, {1,1}, {1,1}, {1,1}, {1,1}, {1,2}, {1,1}, {1,1} };
// 1 = drawing native (not allowed inside pixel())
static const uint8_t NATIVE_DRAWS[N_COUNT] = { 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,0,0,0 };

enum Builtin : uint8_t {
  B_T = 0,
  B_FRAME = 1,
  B_LEN = 2,
  B_W = 3,
  B_H = 4,
  B_SX = 5,
  B_IX = 6,
  B_C1 = 7,
  B_C2 = 8,
  B_C3 = 9,
  B_O1 = 10,
  B_O2 = 11,
  B_O3 = 12,
  B_AUDIO_VOL = 13,
  B_AUDIO_PEAK = 14,
  B_AUDIO_BEAT = 15,
  B_AUDIO_FREQ = 16,
  B_I = 17,
  B_X = 18,
  B_Y = 19,
  B_COUNT = 20
};

enum Tag : uint8_t {
  T_NUM = 0,
  T_COLOR = 1,
  T_BOOL = 2,
  T_ARRAY = 3,
  T_STR = 4,
};
enum Kind : uint8_t {
  K_EFFECT = 0,
  K_SHOW = 1,
};
enum Control : uint8_t {
  C_SLIDER = 0,
  C_TOGGLE = 1,
};

} // namespace glow
