#!/usr/bin/env node
// Glow command line.
//   node glow/cli.mjs compile <file.glow|-> [--out file.glw] [--json]
//   node glow/cli.mjs check   <file.glow|->            (compile, print diagnostics only)
// With --json prints {ok, name, kind, size, meta, controls, twoD, audio, error:{line,col,message}}
// and, for compile without --out, the image as base64 in "image".
import { readFileSync, writeFileSync } from 'node:fs';
import { compile } from './compiler.mjs';

const [cmd, file, ...rest] = process.argv.slice(2);
const json = rest.includes('--json');
const outIdx = rest.indexOf('--out');
const out = outIdx >= 0 ? rest[outIdx + 1] : null;

if (!['compile', 'check'].includes(cmd) || !file) {
  console.error('usage: glow compile|check <file.glow|-> [--out file.glw] [--json]');
  process.exit(2);
}
const src = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
try {
  const r = compile(src);
  if (out) writeFileSync(out, r.image);
  const res = { ok: true, name: r.name, kind: r.kind, size: r.image.length, meta: r.meta, controls: r.controls, twoD: r.twoD, audio: r.audio };
  if (cmd === 'compile' && !out) res.image = Buffer.from(r.image).toString('base64');
  if (json) console.log(JSON.stringify(res));
  else console.log(`${r.name}: ${r.image.length} bytes${out ? ` -> ${out}` : ''}`);
} catch (e) {
  const err = { line: e.line ?? null, col: e.col ?? null, message: e.msg ?? e.message };
  if (json) console.log(JSON.stringify({ ok: false, error: err }));
  else console.error(e.message);
  process.exit(1);
}
