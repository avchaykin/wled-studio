// Glow built-in table — single source of truth for the compiler, the JS VM and
// the C++ VM (wled00/glow_natives.h is generated from this file by
// glow/tools/gen-natives.mjs). Never reorder; append only, ids are bytecode ABI.

// Built-in read-only variables (opcode LOADB <id>)
export const BUILTIN_VARS = [
  't', 'frame', 'len', 'w', 'h',
  'sx', 'ix', 'c1', 'c2', 'c3',          // raw slider slots 0..255
  'o1', 'o2', 'o3',                       // raw option slots (bool)
  'audio_vol', 'audio_peak', 'audio_beat', 'audio_freq',
  'i', 'x', 'y',                          // only valid in pixel() — reserved
];

// Built-in functions (opcode NATIVE <id> <argc>)
// [name, minArgs, maxArgs, context]  context: 'any' | 'frame' (drawing) | 'show'
export const NATIVES = [
  // maths
  ['sin', 1, 1, 'any'], ['cos', 1, 1, 'any'], ['tri', 1, 1, 'any'], ['saw', 1, 1, 'any'], ['sq', 1, 1, 'any'],
  ['abs', 1, 1, 'any'], ['min', 2, 2, 'any'], ['max', 2, 2, 'any'], ['clamp', 3, 3, 'any'],
  ['floor', 1, 1, 'any'], ['ceil', 1, 1, 'any'], ['round', 1, 1, 'any'], ['fract', 1, 1, 'any'],
  ['mix', 3, 3, 'any'], ['smoothstep', 3, 3, 'any'], ['sqrt', 1, 1, 'any'], ['pow', 2, 2, 'any'],
  ['map', 5, 5, 'any'], ['random', 0, 1, 'any'], ['noise', 1, 3, 'any'], ['beat', 1, 1, 'any'],
  // colour
  ['rgb', 3, 4, 'any'], ['hsv', 3, 3, 'any'], ['pal', 1, 1, 'any'], ['blend', 3, 3, 'any'],
  ['bright', 2, 2, 'any'], ['r', 1, 1, 'any'], ['g', 1, 1, 'any'], ['b', 1, 1, 'any'], ['w', 1, 1, 'any'],
  ['color', 1, 1, 'any'],
  // drawing
  ['set', 2, 3, 'frame'], ['add', 2, 2, 'frame'], ['get', 1, 2, 'frame'], ['fill', 1, 1, 'frame'],
  ['fade', 1, 1, 'frame'], ['blur', 1, 1, 'frame'], ['shift', 1, 1, 'frame'],
  // arrays
  ['array', 1, 2, 'any'], ['size', 1, 1, 'any'],
  // audio
  ['audio_band', 1, 1, 'any'],
  // shows (event scripts): every seg_* takes the segment id first and returns it, so calls chain:
  //   seg(0).effect("Aurora").palette(next)  ->  seg_palette(seg_effect(seg(0), "Aurora"), -1)
  ['seg', 1, 1, 'show'], ['seg_effect', 2, 2, 'show'], ['seg_palette', 2, 2, 'show'], ['seg_colors', 2, 4, 'show'],
  ['seg_speed', 2, 2, 'show'], ['seg_intensity', 2, 2, 'show'], ['seg_bri', 2, 2, 'show'], ['seg_on', 2, 2, 'show'],
  ['split', 1, 1, 'show'], ['preset', 1, 1, 'show'], ['power', 1, 1, 'show'], ['brightness', 1, 2, 'show'],
  ['hour', 0, 0, 'show'], ['minute', 0, 0, 'show'], ['segcount', 0, 0, 'show'],
];

// Show events (event table entry: u8 type, u8 function, u32 argument)
export const EVENT = { START: 0, STOP: 1, EVERY: 2, AT: 3, BUTTON: 4, BEAT: 5 };

export const NATIVE_ID = Object.fromEntries(NATIVES.map((n, i) => [n[0], i]));
export const BUILTIN_ID = Object.fromEntries(BUILTIN_VARS.map((n, i) => [n, i]));

// Opcodes. Operands follow the opcode byte, little-endian.
export const OP = {
  HALT: 0,
  PUSHK: 1,     // u8 const index
  PUSHI: 2,     // i8 small integer
  PUSHT: 3,     // true
  PUSHF: 4,     // false
  POP: 5,
  DUP: 6,
  LOADL: 7,     // u8 local slot
  STOREL: 8,    // u8 local slot (pops)
  LOADG: 9,     // u8 global (persistent) slot
  STOREG: 10,   // u8 global slot (pops)
  LOADB: 11,    // u8 builtin var id
  LOADC: 12,    // u8 control slot (0..4 sliders sx,ix,c1,c2,c3; 5..7 toggles o1..o3)
  ADD: 13, SUB: 14, MUL: 15, DIV: 16, MOD: 17, NEG: 18, NOT: 19,
  EQ: 20, NE: 21, LT: 22, LE: 23, GT: 24, GE: 25,
  JMP: 26,      // i16 relative to next instruction
  JZ: 27,       // i16, pops
  JNZ: 28,      // i16, pops
  CALL: 29,     // u8 function index
  RET: 30,      // return top of stack
  NATIVE: 31,   // u8 native id, u8 argc
  AGET: 32,     // array, index -> value
  ASET: 33,     // array, index, value ->
  PUSHS: 34,    // u8 string index (only for show APIs)
  ARRLIT: 35,   // u8 count: pops count values, pushes array (init only)
};

export const KIND = { EFFECT: 0, SHOW: 1 };
export const TAG = { NUM: 0, COLOR: 1, BOOL: 2, ARRAY: 3, STR: 4 };
export const CONTROL = { SLIDER: 0, TOGGLE: 1 };
