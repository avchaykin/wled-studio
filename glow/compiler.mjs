// Glow compiler: source -> bytecode image (Uint8Array) + metadata
import { parse } from './parser.mjs';
import { GlowError } from './lexer.mjs';
import { OP, NATIVES, NATIVE_ID, BUILTIN_ID, KIND, TAG, CONTROL, EVENT } from './natives.mjs';

export { GlowError };

const SLIDER_SLOTS = ['sx', 'ix', 'c1', 'c2', 'c3'];
const TOGGLE_SLOTS = ['o1', 'o2', 'o3'];
const AUDIO_VARS = { vol: 'audio_vol', peak: 'audio_peak', beat: 'audio_beat', freq: 'audio_freq' };
const AUDIO_FNS = { band: 'audio_band' };
const DRAW_NATIVES = new Set(NATIVES.filter(n => n[3] === 'frame').map(n => n[0]));
// segment handle methods in shows: seg(0).effect("Aurora") -> seg_effect(seg(0), "Aurora")
const SEG_METHODS = { effect: 'seg_effect', palette: 'seg_palette', colors: 'seg_colors', speed: 'seg_speed', intensity: 'seg_intensity', bri: 'seg_bri', on: 'seg_on' };
const EVENT_NAMES = { start: EVENT.START, stop: EVENT.STOP, button: EVENT.BUTTON, beat: EVENT.BEAT };
const MAX_LOCALS = 64;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

class FnBuilder {
  constructor(name, params, node) {
    this.name = name; this.params = params; this.node = node;
    this.code = []; this.nlocals = params.length;
    this.scopes = [new Map(params.map((p, i) => [p, i]))];
    this.loops = []; this.calls = new Set();
  }
  emit(...bytes) { this.code.push(...bytes); }
  get pos() { return this.code.length; }
  lookup(name) {
    for (let s = this.scopes.length - 1; s >= 0; s--) if (this.scopes[s].has(name)) return this.scopes[s].get(name);
    return undefined;
  }
  declare(name, n) {
    const top = this.scopes[this.scopes.length - 1];
    if (top.has(name)) throw new GlowError(`'${name}' is already declared in this block`, n.line, n.col);
    if (this.nlocals >= MAX_LOCALS) throw new GlowError(`too many local variables (max ${MAX_LOCALS})`, n.line, n.col);
    top.set(name, this.nlocals);
    return this.nlocals++;
  }
  // emit a jump with a placeholder, return patch position
  jump(op) { this.emit(op, 0, 0); return this.pos; }
  patch(at, target = this.pos) {
    const rel = target - at;
    if (rel < -32768 || rel > 32767) throw new GlowError('function too large');
    this.code[at - 2] = rel & 0xff; this.code[at - 1] = (rel >> 8) & 0xff;
  }
  jumpTo(op, target) { this.emit(op, 0, 0); this.patch(this.pos, target); }
}

export function compile(src) {
  const ast = parse(src);
  return new Compiler(ast).build();
}

class Compiler {
  constructor(ast) {
    this.ast = ast;
    this.kind = ast.kind === 'effect' ? KIND.EFFECT : KIND.SHOW;
    this.consts = []; this.constKey = new Map();
    this.strings = [];
    this.globals = new Map();   // name -> slot
    this.constants = new Map(); // name -> {tag, value}
    this.controls = new Map();  // name -> {ctl, slot, label, def}
    this.fnDecls = new Map();   // name -> {index, node}
    this.fns = [];
    this.usesPalette = false; this.usesAudio = false;
    this.colorsUsed = new Set();
    this.paletteDefault = null;
    this.handlers = []; this.events = [];
  }

  err(msg, n) { return new GlowError(msg, n?.line, n?.col); }

  build() {
    const { ast } = this;
    let nSlider = 0, nToggle = 0;
    const varInits = [];

    // pass 1: collect declarations
    for (const m of ast.members) {
      const dupe = () => this.globals.has(m.name) || this.constants.has(m.name) || this.controls.has(m.name) || this.fnDecls.has(m.name);
      if (m.type === 'control') {
        if (dupe()) throw this.err(`'${m.name}' is already declared`, m);
        const [labelN, defN] = m.args;
        if (!labelN || labelN.type !== 'str') throw this.err(`${m.ctl}() needs a label string as first argument`, m);
        const label = labelN.value;
        if (/[,;@]/.test(label)) throw this.err('control labels must not contain , ; or @', labelN);
        if (m.ctl === 'slider') {
          if (nSlider >= 5) throw this.err('at most 5 sliders', m);
          const def = defN ? this.constEval(defN).value : 128;
          if (!(def >= 0 && def <= 255)) throw this.err('slider default must be 0..255', defN);
          this.controls.set(m.name, { ctl: CONTROL.SLIDER, slot: nSlider++, label, def: Math.round(def) });
        } else {
          if (nToggle >= 3) throw this.err('at most 3 toggles', m);
          const def = defN ? !!this.constEval(defN).value : false;
          this.controls.set(m.name, { ctl: CONTROL.TOGGLE, slot: 5 + nToggle++, label, def });
        }
      } else if (m.type === 'uses') {
        this.usesPalette = true; this.paletteDefault = m.def;
      } else if (m.type === 'const') {
        if (dupe()) throw this.err(`'${m.name}' is already declared`, m);
        this.constants.set(m.name, this.constEval(m.init));
      } else if (m.type === 'var') {
        if (dupe()) throw this.err(`'${m.name}' is already declared`, m);
        if (this.globals.size >= 64) throw this.err('too many vars (max 64)', m);
        this.globals.set(m.name, this.globals.size);
        varInits.push(m);
      } else if (m.type === 'on' || m.type === 'every' || m.type === 'at') {
        this.handlers.push(m);
      } else if (m.type === 'fn') {
        if (dupe()) throw this.err(`'${m.name}' is already declared`, m);
        if (NATIVE_ID[m.name] !== undefined) throw this.err(`'${m.name}' is a built-in function name`, m);
        this.fnDecls.set(m.name, { index: this.fnDecls.size, node: m });
      }
    }

    let mainFn = 255, flags = 0;
    if (this.kind === KIND.EFFECT) {
      const px = this.fnDecls.get('pixel'), fr = this.fnDecls.get('frame');
      if (px && fr) throw this.err(`an effect has either fn pixel() or fn frame(), not both`, fr.node);
      if (!px && !fr) throw this.err(`an effect needs fn pixel(i), fn pixel(x, y) or fn frame()`, ast);
      if (px) {
        const n = px.node.params.length;
        if (n !== 1 && n !== 2) throw this.err('pixel() takes (i) for strips or (x, y) for matrices', px.node);
        flags |= 1; if (n === 2) flags |= 2;
        mainFn = px.index;
      } else {
        if (fr.node.params.length) throw this.err('frame() takes no parameters', fr.node);
        flags |= 4; mainFn = fr.index;
      }
    }

    // pass 2: compile functions (declared order), show handlers, then the init function
    for (const [name, d] of this.fnDecls) this.fns[d.index] = this.compileFn(name, d.node);
    if (this.kind === KIND.SHOW) {
      if (!this.handlers.length) throw this.err('a show needs at least one handler: on start { }, every 10s { }, at "22:00" { }, on button(0) { }', ast);
      for (const h of this.handlers) {
        let type, arg = 0, label;
        if (h.type === 'every') {
          const iv = this.constEval(h.interval);
          if (iv.tag !== TAG.NUM || !(iv.value >= 50)) throw this.err('every needs a constant interval of at least 50ms, e.g. every 30s', h);
          type = EVENT.EVERY; arg = Math.round(iv.value); label = `every ${arg}ms`;
        } else if (h.type === 'at') {
          const m = /^(\d{1,2}):(\d{2})$/.exec(h.time);
          if (!m || +m[1] > 23 || +m[2] > 59) throw this.err(`at needs a time like "07:30", got "${h.time}"`, h);
          type = EVENT.AT; arg = +m[1] * 60 + +m[2]; label = `at ${h.time}`;
        } else {
          type = EVENT_NAMES[h.event];
          if (type === undefined) throw this.err(`unknown event 'on ${h.event}'. Events: start, stop, button(n), beat`, h);
          if (type === EVENT.BUTTON) {
            if (h.args.length !== 1) throw this.err('on button(n) needs the button number', h);
            arg = this.constEval(h.args[0]).value | 0;
          } else if (h.args.length) throw this.err(`on ${h.event} takes no arguments`, h);
          label = `on ${h.event}`;
        }
        const fb = this.compileFn(`<${label}>`, { params: [], body: h.body, line: h.line, col: h.col });
        this.events.push({ type, fn: this.fns.length, arg });
        this.fns.push(fb);
      }
    }
    let initFn = 255;
    if (varInits.length) {
      const fb = new FnBuilder('__init', [], this.ast);
      this.cur = fb; this.inInit = true;
      this.initCount = 0;
      for (const v of varInits) { this.expr(v.init); fb.emit(OP.STOREG, this.globals.get(v.name)); this.initCount++; }
      this.inInit = false;
      fb.emit(OP.PUSHI, 0, OP.RET);
      initFn = this.fns.length; this.fns.push(fb);
    }
    this.checkCycles();
    if (this.usesPalette) flags |= 8;
    if (this.usesAudio) flags |= 16;

    const meta = this.kind === KIND.EFFECT ? this.modeData(flags) : this.ast.name;
    const image = this.link({ flags, mainFn, initFn, meta });
    return {
      image, meta,
      name: ast.name, kind: ast.kind,
      controls: [...this.controls].map(([name, c]) => ({ name, ...c, ctl: c.ctl === CONTROL.SLIDER ? 'slider' : 'toggle' })),
      paletteDefault: this.paletteDefault,
      twoD: !!(flags & 2), audio: this.usesAudio,
      events: this.events.map(e => ({ ...e, type: Object.keys(EVENT).find(k => EVENT[k] === e.type).toLowerCase() })),
    };
  }

  // WLED effect metadata string: "Name@s0,s1,s2,s3,s4,o1,o2,o3;colors;palette;flags;defaults"
  modeData(flags) {
    const slots = new Array(8).fill('');
    const defaults = [];
    for (const c of this.controls.values()) {
      slots[c.slot] = c.label;
      const key = c.slot < 5 ? SLIDER_SLOTS[c.slot] : TOGGLE_SLOTS[c.slot - 5];
      defaults.push(`${key}=${c.ctl === CONTROL.TOGGLE ? (c.def ? 1 : 0) : c.def}`);
    }
    while (slots.length && slots[slots.length - 1] === '') slots.pop();
    const cols = [0, 1, 2].map(k => (this.colorsUsed.has(k) || this.colorsUsed.has('*') ? '!' : '')).join(',').replace(/,+$/, '');
    const fl = (flags & 2 ? '2' : '1') + (this.usesAudio ? 'v' : '');
    return `${this.ast.name}@${slots.join(',')};${cols};${this.usesPalette ? '!' : ''};${fl};${defaults.join(',')}`;
  }

  checkCycles() {
    const state = new Map();
    const visit = (i, path) => {
      if (state.get(i) === 2) return;
      if (state.get(i) === 1) throw this.err(`recursion is not allowed: ${[...path, this.fns[i].name].join(' -> ')}`, this.fns[i].node);
      state.set(i, 1);
      for (const c of this.fns[i].calls) visit(c, [...path, this.fns[i].name]);
      state.set(i, 2);
    };
    this.fns.forEach((_, i) => visit(i, []));
  }

  compileFn(name, node) {
    const fb = new FnBuilder(name, node.params, node);
    this.cur = fb; this.fnName = name;
    this.block(node.body, false);
    fb.emit(OP.PUSHI, 0, OP.RET);
    return fb;
  }

  // ---------- constants ----------
  constEval(n) {
    const bad = () => { throw this.err('expected a constant value here', n); };
    switch (n.type) {
      case 'num': return { tag: TAG.NUM, value: n.value };
      case 'color': return { tag: TAG.COLOR, value: n.value };
      case 'bool': return { tag: TAG.BOOL, value: n.value };
      case 'ident': if (this.constants.has(n.name)) return this.constants.get(n.name); return bad();
      case 'unary': {
        const a = this.constEval(n.arg);
        if (n.op === '-' && a.tag === TAG.NUM) return { tag: TAG.NUM, value: Math.fround(-a.value) };
        if (n.op === '!') return { tag: TAG.BOOL, value: !a.value };
        return bad();
      }
      case 'binary': {
        const a = this.constEval(n.left), b = this.constEval(n.right);
        if (a.tag !== TAG.NUM || b.tag !== TAG.NUM) return bad();
        const x = a.value, y = b.value;
        // must match VM semantics: x/0 = 0, floored modulo
        const v = { '+': x + y, '-': x - y, '*': x * y, '/': y === 0 ? 0 : x / y,
          '%': y === 0 ? 0 : Math.fround(x - Math.fround(y * Math.floor(Math.fround(x / y)))) }[n.op];
        if (v === undefined) return bad();
        return { tag: TAG.NUM, value: Math.fround(v) };
      }
      default: return bad();
    }
  }

  constIndex(tag, value) {
    let bits;
    if (tag === TAG.NUM) { f32[0] = value; bits = u32[0]; } else bits = value >>> 0;
    const key = `${tag}:${bits}`;
    if (this.constKey.has(key)) return this.constKey.get(key);
    if (this.consts.length >= 255) throw this.err('too many constants');
    this.consts.push({ tag, bits });
    this.constKey.set(key, this.consts.length - 1);
    return this.consts.length - 1;
  }

  pushConst(c) {
    const fb = this.cur;
    if (c.tag === TAG.BOOL) fb.emit(c.value ? OP.PUSHT : OP.PUSHF);
    else if (c.tag === TAG.NUM && Number.isInteger(c.value) && c.value >= -128 && c.value <= 127 && !Object.is(c.value, -0)) fb.emit(OP.PUSHI, c.value & 0xff);
    else fb.emit(OP.PUSHK, this.constIndex(c.tag, c.value));
  }

  // ---------- statements ----------
  block(stmts, scoped = true) {
    const fb = this.cur;
    if (scoped) fb.scopes.push(new Map());
    for (const s of stmts) this.stmt(s);
    if (scoped) fb.scopes.pop();
  }

  stmt(s) {
    const fb = this.cur;
    switch (s.type) {
      case 'let': {
        this.expr(s.init);
        const slot = fb.declare(s.name, s);
        fb.emit(OP.STOREL, slot); return;
      }
      case 'assign': {
        if (s.target.type === 'index') {
          this.expr(s.target.obj); this.expr(s.target.idx);
          if (s.op !== '=') {
            this.expr(s.target.obj); this.expr(s.target.idx); fb.emit(OP.AGET);
            this.expr(s.value); fb.emit(this.arith(s.op.slice(0, 1)));
          } else this.expr(s.value);
          fb.emit(OP.ASET); return;
        }
        const name = s.target.name;
        if (s.op !== '=') { this.expr(s.target); this.expr(s.value); fb.emit(this.arith(s.op.slice(0, 1))); }
        else this.expr(s.value);
        const l = fb.lookup(name);
        if (l !== undefined) { fb.emit(OP.STOREL, l); return; }
        if (this.globals.has(name)) { fb.emit(OP.STOREG, this.globals.get(name)); return; }
        if (this.controls.has(name) || this.constants.has(name) || BUILTIN_ID[name] !== undefined)
          throw this.err(`'${name}' is read-only`, s);
        throw this.err(`unknown variable '${name}' — declare it with 'let' (local) or 'var' (kept between frames)`, s);
      }
      case 'if': {
        this.expr(s.test);
        const jElse = fb.jump(OP.JZ);
        this.block(s.then);
        if (s.els) { const jEnd = fb.jump(OP.JMP); fb.patch(jElse); this.block(s.els); fb.patch(jEnd); }
        else fb.patch(jElse);
        return;
      }
      case 'while': {
        const top = fb.pos;
        this.expr(s.test);
        const jOut = fb.jump(OP.JZ);
        const loop = { breaks: [], continues: [], contTarget: top };
        fb.loops.push(loop); this.block(s.body); fb.loops.pop();
        fb.jumpTo(OP.JMP, top);
        fb.patch(jOut);
        loop.breaks.forEach(b => fb.patch(b));
        loop.continues.forEach(c => fb.patch(c, top));
        return;
      }
      case 'for': {
        fb.scopes.push(new Map());
        this.expr(s.from);
        const iv = fb.declare(s.name, s); fb.emit(OP.STOREL, iv);
        this.expr(s.to);
        const end = fb.declare(`<end ${s.name}>`, s); fb.emit(OP.STOREL, end);
        const top = fb.pos;
        fb.emit(OP.LOADL, iv, OP.LOADL, end, OP.LT);
        const jOut = fb.jump(OP.JZ);
        const loop = { breaks: [], continues: [] };
        fb.loops.push(loop); this.block(s.body); fb.loops.pop();
        const cont = fb.pos;
        fb.emit(OP.LOADL, iv, OP.PUSHI, 1, OP.ADD, OP.STOREL, iv);
        fb.jumpTo(OP.JMP, top);
        fb.patch(jOut);
        loop.breaks.forEach(b => fb.patch(b));
        loop.continues.forEach(c => fb.patch(c, cont));
        fb.scopes.pop();
        return;
      }
      case 'break': case 'continue': {
        const loop = fb.loops[fb.loops.length - 1];
        if (!loop) throw this.err(`'${s.type}' outside a loop`, s);
        loop[s.type === 'break' ? 'breaks' : 'continues'].push(fb.jump(OP.JMP));
        return;
      }
      case 'return':
        if (s.value) this.expr(s.value); else fb.emit(OP.PUSHI, 0);
        fb.emit(OP.RET); return;
      case 'expr':
        this.expr(s.expr); fb.emit(OP.POP); return;
      default:
        throw this.err(`unexpected statement ${s.type}`, s);
    }
  }

  arith(op) {
    return { '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD }[op];
  }

  // ---------- expressions ----------
  expr(n) {
    const fb = this.cur;
    switch (n.type) {
      case 'num': return this.pushConst({ tag: TAG.NUM, value: Math.fround(n.value) });
      case 'color': return this.pushConst({ tag: TAG.COLOR, value: n.value });
      case 'bool': return fb.emit(n.value ? OP.PUSHT : OP.PUSHF);
      case 'str': {
        if (this.kind !== KIND.SHOW) throw this.err('strings are only allowed as names in show scripts', n);
        let k = this.strings.indexOf(n.value);
        if (k < 0) { if (this.strings.length >= 255) throw this.err('too many strings', n); this.strings.push(n.value); k = this.strings.length - 1; }
        if (new TextEncoder().encode(n.value).length > 255) throw this.err('string too long', n);
        fb.emit(OP.PUSHS, k); return;
      }
      case 'ident': return this.ident(n);
      case 'unary':
        this.expr(n.arg); fb.emit(n.op === '-' ? OP.NEG : OP.NOT); return;
      case 'binary': {
        // fold constant sub-expressions
        try { const c = this.constEval(n); return this.pushConst(c); } catch { /* not constant */ }
        this.expr(n.left); this.expr(n.right);
        fb.emit({ '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD,
          '==': OP.EQ, '!=': OP.NE, '<': OP.LT, '<=': OP.LE, '>': OP.GT, '>=': OP.GE }[n.op]);
        return;
      }
      case 'logical': {
        this.expr(n.left);
        fb.emit(OP.DUP);
        const j = fb.jump(n.op === '&&' ? OP.JZ : OP.JNZ);
        fb.emit(OP.POP);
        this.expr(n.right);
        fb.patch(j); return;
      }
      case 'cond': {
        this.expr(n.test);
        const jElse = fb.jump(OP.JZ);
        this.expr(n.a);
        const jEnd = fb.jump(OP.JMP);
        fb.patch(jElse); this.expr(n.b); fb.patch(jEnd); return;
      }
      case 'index':
        this.expr(n.obj); this.expr(n.idx); fb.emit(OP.AGET); return;
      case 'member': {
        if (n.obj.type === 'ident' && n.obj.name === 'audio' && AUDIO_VARS[n.prop]) {
          this.usesAudio = true;
          fb.emit(OP.LOADB, BUILTIN_ID[AUDIO_VARS[n.prop]]); return;
        }
        throw this.err(`unknown property '.${n.prop}'`, n);
      }
      case 'arraylit': {
        if (!this.inInit) throw this.err('array literals are only allowed as a var initializer', n);
        if (n.items.length > 255) throw this.err('array literal too long', n);
        n.items.forEach(i => this.expr(i));
        fb.emit(OP.ARRLIT, n.items.length); return;
      }
      case 'call': return this.call(n);
      default: throw this.err(`unexpected expression ${n.type}`, n);
    }
  }

  ident(n) {
    const fb = this.cur, name = n.name;
    const l = fb.lookup(name);
    if (l !== undefined) return fb.emit(OP.LOADL, l);
    if (this.globals.has(name)) {
      if (this.inInit && this.globals.get(name) >= this.initCount) throw this.err(`'${name}' used before it is initialised`, n);
      return fb.emit(OP.LOADG, this.globals.get(name));
    }
    if (this.constants.has(name)) return this.pushConst(this.constants.get(name));
    if (this.controls.has(name)) return fb.emit(OP.LOADC, this.controls.get(name).slot);
    if (BUILTIN_ID[name] !== undefined && !['i', 'x', 'y'].includes(name) && !name.startsWith('audio_')) {
      if (['sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3'].includes(name)) {
        const s = [...SLIDER_SLOTS, ...TOGGLE_SLOTS].indexOf(name);
        return fb.emit(OP.LOADC, s);
      }
      return fb.emit(OP.LOADB, BUILTIN_ID[name]);
    }
    if (name === 'speed') return fb.emit(OP.LOADC, 0);
    if (name === 'intensity') return fb.emit(OP.LOADC, 1);
    if (name === 'PI') return this.pushConst({ tag: TAG.NUM, value: Math.fround(Math.PI) });
    if (name === 'next' && this.kind === KIND.SHOW) return fb.emit(OP.PUSHI, 0xff); // -1: next effect/palette/preset
    throw this.err(`unknown name '${name}'`, n);
  }

  call(n) {
    const fb = this.cur;
    if (Object.keys(n.named).length) throw this.err('named arguments are not supported; pass values in order', n);
    let name;
    if (n.callee.type === 'member' && SEG_METHODS[n.callee.prop] && !(n.callee.obj.type === 'ident' && n.callee.obj.name === 'audio')) {
      if (this.kind !== KIND.SHOW) throw this.err(`.${n.callee.prop}() on segments is only available in show scripts`, n);
      const native = SEG_METHODS[n.callee.prop];
      const [, min, max] = NATIVES[NATIVE_ID[native]];
      if (n.args.length < min - 1 || n.args.length > max - 1) throw this.err(`.${n.callee.prop}() takes ${min - 1 === max - 1 ? min - 1 : `${min - 1}-${max - 1}`} argument(s)`, n);
      this.expr(n.callee.obj);
      n.args.forEach(a => this.expr(a));
      fb.emit(OP.NATIVE, NATIVE_ID[native], n.args.length + 1);
      return;
    }
    if (n.callee.type === 'ident') name = n.callee.name;
    else if (n.callee.type === 'member' && n.callee.obj.type === 'ident' && n.callee.obj.name === 'audio' && AUDIO_FNS[n.callee.prop]) {
      name = AUDIO_FNS[n.callee.prop]; this.usesAudio = true;
    } else throw this.err('only named functions can be called', n);

    const user = this.fnDecls.get(name);
    if (user) {
      if (name === 'pixel' || name === 'frame') throw this.err(`'${name}' is called by the engine, not by your code`, n);
      if (n.args.length !== user.node.params.length)
        throw this.err(`${name}() takes ${user.node.params.length} argument(s), got ${n.args.length}`, n);
      n.args.forEach(a => this.expr(a));
      fb.emit(OP.CALL, user.index);
      fb.calls.add(user.index);
      return;
    }
    const id = NATIVE_ID[name];
    if (id === undefined) {
      if (name === 'slider' || name === 'toggle') throw this.err(`${name}() can only be used at the top of an effect: name = ${name}("Label", default)`, n);
      throw this.err(`unknown function '${name}'`, n);
    }
    const [, min, max, ctx] = NATIVES[id];
    if (n.args.length < min || n.args.length > max)
      throw this.err(`${name}() takes ${min === max ? min : `${min}-${max}`} argument(s), got ${n.args.length}`, n);
    if (ctx === 'frame' && this.fnName === 'pixel') throw this.err(`${name}() draws pixels — use it in fn frame(), not in fn pixel()`, n);
    if (ctx === 'frame' && this.kind === KIND.SHOW) throw this.err(`${name}() draws pixels — shows change segments, effects and presets; draw in an effect script`, n);
    if (ctx === 'show' && this.kind !== KIND.SHOW) throw this.err(`${name}() is only available in show scripts`, n);
    if (name === 'array' && !this.inInit) throw this.err('array() is only allowed as a var initializer: var buf = array(len)', n);
    if (name === 'pal') this.usesPalette = true;
    if (name === 'color') {
      const a = n.args[0];
      if (a.type === 'num' && [0, 1, 2].includes(a.value)) this.colorsUsed.add(a.value); else this.colorsUsed.add('*');
    }
    n.args.forEach(a => this.expr(a));
    fb.emit(OP.NATIVE, id, n.args.length);
  }

  // ---------- image ----------
  link({ flags, mainFn, initFn, meta }) {
    const out = [];
    const u8 = v => out.push(v & 0xff);
    const u16 = v => { out.push(v & 0xff, (v >> 8) & 0xff); };
    const u32le = v => { out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); };
    const metaBytes = new TextEncoder().encode(meta);
    if (metaBytes.length > 255 * 4) throw this.err('effect metadata too long');
    if (this.fns.length > 255) throw this.err('too many functions');

    // code: concatenate functions
    const offsets = []; const code = [];
    for (const f of this.fns) { offsets.push(code.length); code.push(...f.code); }
    if (code.length > 65535) throw this.err('script too large');

    [0x47, 0x4c, 0x57, 0x31].forEach(u8);            // "GLW1"
    u8(1); u8(this.kind); u8(flags); u8(this.globals.size);
    u8(this.consts.length); u8(this.strings.length); u8(this.fns.length); u8(this.controls.size);
    if (this.events.length > 64) throw this.err('too many handlers (max 64)');
    u8(initFn); u8(mainFn); u8(this.events.length); u8(0);
    u16(code.length); u16(metaBytes.length);
    for (const c of this.consts) { u8(c.tag); u32le(c.bits); }
    for (const s of this.strings) { const b = new TextEncoder().encode(s); u8(b.length); b.forEach(u8); }
    this.fns.forEach((f, i) => { u16(offsets[i]); u8(f.params.length); u8(f.nlocals); });
    metaBytes.forEach(u8);
    for (const e of this.events) { u8(e.type); u8(e.fn); u32le(e.arg >>> 0); }
    code.forEach(u8);
    return Uint8Array.from(out);
  }
}
