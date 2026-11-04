// Glow parser: tokens -> AST
import { lex, GlowError } from './lexer.mjs';

const BINPREC = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

export function parse(src) {
  const toks = lex(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const at = (type, value) => peek().type === type && (value === undefined || peek().value === value);
  const isOp = v => at('op', v);
  const isKw = v => at('kw', v);
  const err = (msg, t = peek()) => new GlowError(msg, t.line, t.col);
  const next = () => toks[p++];
  const expect = (type, value) => {
    if (!at(type, value)) {
      const t = peek();
      throw err(`expected ${value ?? type} but found ${t.type === 'eof' ? 'end of file' : `'${t.value}'`}`);
    }
    return next();
  };
  const accept = (type, value) => (at(type, value) ? next() : null);
  const node = (type, t, props) => ({ type, line: t.line, col: t.col, ...props });
  const semi = () => { while (accept('op', ';')); };

  // ---------- expressions ----------
  function parseExpr() { return parseCond(); }

  function parseCond() {
    const c = parseBin(1);
    if (isOp('?')) {
      const t = next();
      const a = parseExpr(); expect('op', ':'); const b = parseExpr();
      return node('cond', t, { test: c, a, b });
    }
    return c;
  }

  function parseBin(minPrec) {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      const prec = t.type === 'op' ? BINPREC[t.value] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      next();
      const right = parseBin(prec + 1);
      left = node(t.value === '&&' || t.value === '||' ? 'logical' : 'binary', t, { op: t.value, left, right });
    }
  }

  function parseUnary() {
    if (isOp('-') || isOp('!')) {
      const t = next();
      return node('unary', t, { op: t.value, arg: parseUnary() });
    }
    return parsePostfix(parsePrimary());
  }

  function parsePostfix(e) {
    for (;;) {
      if (isOp('(')) {
        const t = next();
        const args = [], named = {};
        while (!isOp(')')) {
          if (at('id') && peek(1).type === 'op' && peek(1).value === ':') {
            const k = next().value; next(); named[k] = parseExpr();
          } else args.push(parseExpr());
          if (!accept('op', ',')) break;
        }
        expect('op', ')');
        e = node('call', t, { callee: e, args, named });
      } else if (isOp('.') ) {
        const t = next();
        const prop = expect('id').value;
        e = node('member', t, { obj: e, prop });
      } else if (isOp('[')) {
        const t = next();
        const idx = parseExpr(); expect('op', ']');
        e = node('index', t, { obj: e, idx });
      } else return e;
    }
  }

  function parsePrimary() {
    const t = peek();
    if (t.type === 'num') { next(); return node('num', t, { value: t.value }); }
    if (t.type === 'color') { next(); return node('color', t, { value: t.value }); }
    if (t.type === 'str') { next(); return node('str', t, { value: t.value }); }
    if (isKw('true') || isKw('false')) { next(); return node('bool', t, { value: t.value === 'true' }); }
    if (t.type === 'id') { next(); return node('ident', t, { name: t.value }); }
    // `default` is a keyword but also usable as an argument name
    if (isOp('(')) { next(); const e = parseExpr(); expect('op', ')'); return e; }
    if (isOp('[')) {
      next();
      const items = [];
      while (!isOp(']')) { items.push(parseExpr()); if (!accept('op', ',')) break; }
      expect('op', ']');
      return node('arraylit', t, { items });
    }
    throw err(t.type === 'eof' ? 'unexpected end of file' : `unexpected '${t.value}'`);
  }

  // ---------- statements ----------
  function parseBlock() {
    const t = expect('op', '{');
    const body = [];
    while (!isOp('}')) {
      if (at('eof')) throw err('missing }', t);
      body.push(parseStmt()); semi();
    }
    next();
    return body;
  }

  function parseStmt() {
    const t = peek();
    if (isKw('let')) {
      next();
      const name = expect('id').value;
      expect('op', '=');
      return node('let', t, { name, init: parseExpr() });
    }
    if (isKw('var') || isKw('const')) throw err(`'${t.value}' is only allowed at the top of an effect or show; use 'let' inside functions`);
    if (isKw('if')) {
      next();
      const test = parseExpr();
      const then = parseBlock();
      let els = null;
      if (accept('kw', 'else')) els = isKw('if') ? [parseStmt()] : parseBlock();
      return node('if', t, { test, then, els });
    }
    if (isKw('for')) {
      next();
      const name = expect('id').value;
      expect('kw', 'in');
      const from = parseExpr(); expect('op', '..'); const to = parseExpr();
      return node('for', t, { name, from, to, body: parseBlock() });
    }
    if (isKw('while')) { next(); const test = parseExpr(); return node('while', t, { test, body: parseBlock() }); }
    if (isKw('break')) { next(); return node('break', t, {}); }
    if (isKw('continue')) { next(); return node('continue', t, {}); }
    if (isKw('return')) {
      next();
      const hasValue = !isOp('}') && !isOp(';');
      return node('return', t, { value: hasValue ? parseExpr() : null });
    }
    const e = parseExpr();
    if (at('op') && ASSIGN_OPS.has(peek().value)) {
      const op = next().value;
      if (e.type !== 'ident' && e.type !== 'index') throw err('can only assign to a variable or array element', t);
      return node('assign', t, { target: e, op, value: parseExpr() });
    }
    if (e.type !== 'call') throw err('expression does nothing — expected a call or an assignment', t);
    return node('expr', t, { expr: e });
  }

  // ---------- top level ----------
  function parseFn() {
    const t = expect('kw', 'fn');
    const name = expect('id').value;
    expect('op', '(');
    const params = [];
    while (!isOp(')')) { params.push(expect('id').value); if (!accept('op', ',')) break; }
    expect('op', ')');
    return node('fn', t, { name, params, body: parseBlock() });
  }

  function parseMember(kind) {
    const t = peek();
    if (isKw('fn')) return parseFn();
    if (isKw('var') || isKw('const')) {
      next();
      const name = expect('id').value;
      expect('op', '=');
      return node(t.value, t, { name, init: parseExpr() });
    }
    if (kind === 'effect' && isKw('uses')) {
      next();
      const what = expect('id').value;
      if (what !== 'palette') throw err(`'uses' supports only 'palette'`);
      let def = null;
      if (accept('op', ',')) { expect('kw', 'default'); def = expect('str').value; }
      return node('uses', t, { what, def });
    }
    if (kind === 'effect' && at('id') && peek(1).type === 'op' && peek(1).value === '=') {
      const name = next().value; next();
      const call = parseExpr();
      if (call.type !== 'call' || call.callee.type !== 'ident' || !['slider', 'toggle'].includes(call.callee.name))
        throw err(`top-level '${name} = ...' must be a control: slider("Label", default) or toggle("Label", default)`, t);
      return node('control', t, { name, ctl: call.callee.name, args: call.args });
    }
    if (kind === 'show') {
      if (isKw('on')) {
        next();
        const event = expect('id').value;
        let args = [];
        if (accept('op', '(')) {
          while (!isOp(')')) { args.push(parseExpr()); if (!accept('op', ',')) break; }
          expect('op', ')');
        }
        return node('on', t, { event, args, body: parseBlock() });
      }
      if (isKw('every')) { next(); const interval = parseExpr(); return node('every', t, { interval, body: parseBlock() }); }
      if (isKw('at')) { next(); const time = expect('str').value; return node('at', t, { time, body: parseBlock() }); }
    }
    throw err(`unexpected '${t.value ?? 'end of file'}' in ${kind} body`);
  }

  const t = peek();
  let kind;
  if (isKw('effect') || isKw('show')) kind = next().value;
  else throw err(`a script must start with 'effect "Name" {' or 'show "Name" {'`);
  const name = expect('str').value;
  if (!name.trim() || /[@;"]/.test(name)) throw err(`name must be non-empty and must not contain @ ; or "`);
  expect('op', '{');
  const members = [];
  while (!isOp('}')) {
    if (at('eof')) throw err(`missing } to close ${kind}`, t);
    members.push(parseMember(kind)); semi();
  }
  next();
  if (!at('eof')) throw err('only one effect or show per script');
  return node('program', t, { kind, name, members });
}
