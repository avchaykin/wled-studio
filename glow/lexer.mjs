// Glow lexer: source text -> tokens {type, value, line, col}

export class GlowError extends Error {
  constructor(msg, line, col) {
    super(line ? `${line}:${col}: ${msg}` : msg);
    this.line = line; this.col = col; this.msg = msg;
  }
}

const KEYWORDS = new Set([
  'effect', 'show', 'fn', 'let', 'var', 'const', 'if', 'else', 'for', 'in', 'while',
  'break', 'continue', 'return', 'true', 'false', 'on', 'every', 'at', 'uses', 'default',
]);

const UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000 };
const PUNCT = ['..', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=',
  '+', '-', '*', '/', '%', '<', '>', '=', '!', '?', ':', '(', ')', '{', '}', '[', ']', ',', '.', ';'];

export function lex(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const adv = (n = 1) => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  const isDigit = c => c >= '0' && c <= '9';
  const isIdStart = c => /[A-Za-z_]/.test(c);
  const isId = c => /[A-Za-z0-9_]/.test(c);

  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { adv(); continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') adv(); continue; }
    if (c === '/' && src[i + 1] === '*') {
      const l = line, cc = col; adv(2);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) adv();
      if (i >= src.length) throw new GlowError('unterminated comment', l, cc);
      adv(2); continue;
    }
    const tl = line, tc = col;
    const push = (type, value) => toks.push({ type, value, line: tl, col: tc });

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let s = '';
      while (i < src.length && (isDigit(src[i]) || (src[i] === '.' && src[i + 1] !== '.'))) { s += src[i]; adv(); }
      if (src[i] === 'e' || src[i] === 'E') {
        const save = { i, line, col }; let e = src[i]; adv();
        if (src[i] === '+' || src[i] === '-') { e += src[i]; adv(); }
        if (isDigit(src[i])) { while (isDigit(src[i])) { e += src[i]; adv(); } s += e; }
        else { i = save.i; line = save.line; col = save.col; }
      }
      let v = parseFloat(s);
      // duration suffix directly attached: 250ms 2s 5m 1h
      let unit = '';
      let j = i; while (j < src.length && isId(src[j])) unit += src[j++];
      if (unit) {
        if (!(unit in UNITS)) throw new GlowError(`unknown number suffix '${unit}'`, tl, tc);
        v *= UNITS[unit]; adv(unit.length);
      }
      push('num', v); continue;
    }
    if (c === '#') {
      let s = ''; adv();
      while (i < src.length && /[0-9a-fA-F]/.test(src[i])) { s += src[i]; adv(); }
      if (s.length === 3) s = s.split('').map(d => d + d).join('');
      if (s.length !== 6 && s.length !== 8) throw new GlowError(`bad colour literal '#${s}'`, tl, tc);
      const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
      const w = s.length === 8 ? parseInt(s.slice(6, 8), 16) : 0;
      push('color', ((w << 24) | (r << 16) | (g << 8) | b) >>> 0); continue;
    }
    if (c === '"' || c === "'") {
      let s = ''; adv();
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\n') throw new GlowError('unterminated string', tl, tc);
        if (src[i] === '\\') { adv(); s += ({ n: '\n', t: '\t' })[src[i]] ?? src[i]; adv(); continue; }
        s += src[i]; adv();
      }
      if (i >= src.length) throw new GlowError('unterminated string', tl, tc);
      adv(); push('str', s); continue;
    }
    if (isIdStart(c)) {
      let s = '';
      while (i < src.length && isId(src[i])) { s += src[i]; adv(); }
      push(KEYWORDS.has(s) ? 'kw' : 'id', s); continue;
    }
    const p = PUNCT.find(p => src.startsWith(p, i));
    if (p) { adv(p.length); push('op', p); continue; }
    throw new GlowError(`unexpected character '${c}'`, tl, tc);
  }
  toks.push({ type: 'eof', value: null, line, col });
  return toks;
}
