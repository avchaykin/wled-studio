// Generates wled00/glow_natives.h from glow/natives.mjs (the single source of truth).
// Usage: node glow/tools/gen-natives.mjs [--check]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OP, NATIVES, BUILTIN_VARS, TAG, KIND, CONTROL, EVENT } from '../natives.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'wled00', 'glow_natives.h');
const up = s => s.toUpperCase();
const lines = [
  '// AUTO-GENERATED from glow/natives.mjs by glow/tools/gen-natives.mjs — do not edit.',
  '#pragma once',
  '',
  'namespace glow {',
  '',
  'enum Op : uint8_t {',
  ...Object.entries(OP).map(([k, v]) => `  OP_${k} = ${v},`),
  '};',
  '',
  'enum Native : uint8_t {',
  ...NATIVES.map(([n], i) => `  N_${up(n)} = ${i},`),
  `  N_COUNT = ${NATIVES.length}`,
  '};',
  '',
  '// min/max argument counts per native, indexed by Native',
  `static const uint8_t NATIVE_ARGC[N_COUNT][2] = { ${NATIVES.map(n => `{${n[1]},${n[2]}}`).join(', ')} };`,
  '// 1 = drawing native (not allowed inside pixel())',
  `static const uint8_t NATIVE_DRAWS[N_COUNT] = { ${NATIVES.map(n => (n[3] === 'frame' ? 1 : 0)).join(',')} };`,
  '// 1 = show-only native (handled by Host::show)',
  `static const uint8_t NATIVE_SHOW[N_COUNT] = { ${NATIVES.map(n => (n[3] === 'show' ? 1 : 0)).join(',')} };`,
  '',
  'enum Builtin : uint8_t {',
  ...BUILTIN_VARS.map((n, i) => `  B_${up(n)} = ${i},`),
  `  B_COUNT = ${BUILTIN_VARS.length}`,
  '};',
  '',
  'enum Tag : uint8_t {', ...Object.entries(TAG).map(([k, v]) => `  T_${k} = ${v},`), '};',
  'enum Kind : uint8_t {', ...Object.entries(KIND).map(([k, v]) => `  K_${k} = ${v},`), '};',
  'enum Control : uint8_t {', ...Object.entries(CONTROL).map(([k, v]) => `  C_${k} = ${v},`), '};',
  'enum EventType : uint8_t {', ...Object.entries(EVENT).map(([k, v]) => `  EV_${k} = ${v},`), '};',
  '',
  '} // namespace glow',
  '',
];
const text = lines.join('\n');
if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== text) { console.error(`${out} is stale — run: node glow/tools/gen-natives.mjs`); process.exit(1); }
} else writeFileSync(out, text);
