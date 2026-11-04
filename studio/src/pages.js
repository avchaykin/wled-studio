// Presets and Scripts pages.
import { h, mount } from './dom.js';
import { store, seg as selSeg } from './store.js';
import { send, getJson, getText, uploadFile, postState } from './api.js';
import { LedCanvas } from './stage.js';
import { compile } from '../../glow/compiler.mjs';
import { loadImage, GlowInstance, runFrame } from '../../glow/vm.mjs';
import EXAMPLES from './examples.gen.js';

// ---------------------------------------------------------------- Presets
export function PresetsPage() {
  const root = h('section.page', { 'aria-label': 'Presets' });
  let presets = null, err = '';
  async function load() {
    try { presets = await getJson('/presets.json'); err = ''; } catch (e) { err = e.message; presets = {}; }
    render();
  }
  function render() {
    const d = store.get();
    const list = Object.entries(presets ?? {}).filter(([id, p]) => +id > 0 && p && p.n !== undefined)
      .map(([id, p]) => ({ id: +id, name: p.n || `Preset ${id}`, pl: !!p.playlist }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const free = () => { let i = 1; while (presets?.[i]) i++; return i; };
    const nameIn = h('input', { placeholder: 'Name for current look', maxLength: 32, 'aria-label': 'Preset name' });
    mount(root,
      h('h2', null, 'Presets'),
      err && h('p.error', null, err),
      h('div.presetgrid', null, presets === null ? h('p.empty', null, 'Loading…') :
        list.length ? list.map(p => h('button.preset', { 'aria-pressed': d.state?.ps === p.id, onClick: () => send({ ps: p.id }, { now: true }) },
          h('span', null, p.name), p.pl && h('span.badge', null, 'playlist'))) : h('p.empty', null, 'No presets yet.')),
      h('form.savepreset', {
        onSubmit: async e => {
          e.preventDefault();
          const n = nameIn.value.trim(); if (!n) return;
          await postState({ psave: free(), n, ib: true, sb: true });
          setTimeout(load, 400);
        },
      }, nameIn, h('button.btn.primary', { type: 'submit' }, 'Save current')),
    );
  }
  root.addEventListener('page-shown', load);
  render();
  return root;
}

// ---------------------------------------------------------------- Scripts
const DRAFT_KEY = 'studio.glow.draft';

export function ScriptsPage() {
  const root = h('section.page.scripts', { 'aria-label': 'Scripts' });
  const preview = new LedCanvas({ maxRows: 3 });
  const editor = h('textarea.code', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Glow script source', wrap: 'off' });
  const gutter = h('div.gutter', { 'aria-hidden': true });
  const status = h('div.status', { role: 'status', 'aria-live': 'polite' });
  const fileName = h('input.filename', { placeholder: 'file-name', pattern: '[a-z0-9_-]{1,32}', 'aria-label': 'File name on device', maxLength: 32 });
  const deviceList = h('div.devscripts');
  let compiled = null, inst = null, raf = 0, t0 = 0;

  try { editor.value = localStorage.getItem(DRAFT_KEY) || EXAMPLES[0].src; } catch { editor.value = EXAMPLES[0].src; }

  function lines() { mount(gutter, editor.value.split('\n').map((_, i) => h('div', null, i + 1))); }
  editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
  editor.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
  });
  let timer;
  editor.addEventListener('input', () => { lines(); clearTimeout(timer); timer = setTimeout(build, 250); try { localStorage.setItem(DRAFT_KEY, editor.value); } catch { /* */ } });

  function build() {
    try {
      compiled = compile(editor.value);
      inst = new GlowInstance(loadImage(compiled.image), 1);
      t0 = performance.now();
      if (!fileName.value) fileName.value = slug(compiled.name);
      setStatus('ok', `“${compiled.name}” — ${compiled.image.length} bytes, ${compiled.controls.length} control(s)${compiled.twoD ? ', 2D' : ''}`);
      highlight(null);
    } catch (e) {
      compiled = null; inst = null;
      setStatus('error', e.message);
      highlight(e.line);
    }
  }
  function highlight(line) {
    [...gutter.children].forEach((g, i) => g.classList.toggle('err', i + 1 === line));
  }
  function setStatus(kind, msg) { status.className = `status ${kind}`; status.textContent = msg; }

  // simulated strip using the selected segment's length, colours and palette
  function tick() {
    raf = requestAnimationFrame(tick);
    if (!inst || !root.isConnected || root.hidden) return;
    const d = store.get(); const s = selSeg(d);
    const twoD = compiled.twoD; const w = twoD ? 16 : Math.min(300, (s ? s.stop - s.start : 60) || 60); const hh = twoD ? 16 : 1;
    if (!inst.pixels || inst.pixels.length !== w * hh) inst.pixels = new Uint32Array(w * hh);
    const palStops = d.cat?.palx?.[s?.pal ?? 0];
    const host = {
      len: w * hh, w, h: hh, t: performance.now() - t0, pixels: inst.pixels,
      controls: compiled.controls.reduce((c, k) => { c[k.slot] = k.ctl === 'toggle' ? (k.def ? 1 : 0) : k.def; return c; }, [128, 128, 128, 128, 128, 0, 0, 0]),
      colors: (s?.col ?? [[255, 160, 0], [0, 0, 0], [0, 0, 0]]).map(c => ((c[3] ?? 0) << 24 | c[0] << 16 | c[1] << 8 | c[2]) >>> 0),
      palette: i => paletteAt(palStops, i, s?.col),
      audio: { vol: 0, bands: new Array(16).fill(0) },
    };
    try { runFrame(inst, host, 400000); preview.setPixels(inst.pixels, twoD ? w : 0, twoD ? hh : 0); }
    catch (e) { setStatus('error', `runtime: ${e.message}`); inst = null; }
  }

  async function save() {
    if (!compiled) return setStatus('error', 'Fix the errors before saving.');
    const name = fileName.value.trim();
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) return setStatus('error', 'File name: lowercase letters, digits, - and _ only.');
    if (!store.get().info?.glow) return setStatus('error', 'This device firmware has no script engine yet — flash WLED Studio firmware first.');
    setStatus('busy', 'Uploading…');
    try {
      await uploadFile(`/glow/${name}.glow`, editor.value, 'text/plain');
      await uploadFile(`/glow/${name}.glw`, compiled.image);
      await postState({ glow: { reload: true } });
      setStatus('ok', `Saved “${compiled.name}” as ${name}. It appears in the effect list; apply it to the selected segment with “Run on segment”.`);
      setTimeout(refreshDevice, 800);
    } catch (e) { setStatus('error', e.message); }
  }
  async function runOnSegment() {
    const d = store.get(); const s = selSeg(d);
    const slot = d.info?.glow?.slots?.find(x => x.file === fileName.value.trim());
    if (!slot || !s) return setStatus('error', 'Save the script to the device first.');
    send({ seg: [{ id: s.id, fx: slot.fx, fxdef: true }] }, { now: true });
  }
  async function refreshDevice() {
    try { const info = await getJson('/json/info'); store.set({ info, cat: null }); } catch { /* offline */ }
  }
  function renderDevice() {
    const slots = store.get().info?.glow?.slots;
    mount(deviceList, slots === undefined ? h('p.hint', null, 'The connected firmware has no script engine. You can still write and preview scripts here.')
      : !slots.length ? h('p.hint', null, 'No scripts on the device yet.')
      : slots.map(sl => h('div.devscript', null,
        h('button.linkish', {
          onClick: async () => { try { editor.value = await getText(`/glow/${sl.file}.glow`); fileName.value = sl.file; lines(); build(); } catch (e) { setStatus('error', e.message); } },
        }, sl.file), sl.err && h('span.badge.err', { title: sl.err }, 'error'),
        h('button.icon', { 'aria-label': `Delete ${sl.file}`, onClick: async () => { await postState({ glow: { del: sl.file } }); setTimeout(refreshDevice, 600); } }, '✕'))));
  }

  const examples = h('select', { 'aria-label': 'Load example', onChange: e => { const ex = EXAMPLES[+e.target.value]; if (ex) { editor.value = ex.src; fileName.value = ex.file; lines(); build(); } e.target.value = ''; } },
    h('option', { value: '' }, 'Examples…'), EXAMPLES.map((ex, i) => h('option', { value: i }, ex.name)));

  mount(root,
    h('div.scripthead', null, h('h2', null, 'Scripts'), examples),
    h('div.previewwrap', null, preview.el),
    h('div.editorwrap', null, gutter, editor),
    status,
    h('div.actions', null, fileName,
      h('button.btn.primary', { onClick: save }, 'Save to device'),
      h('button.btn', { onClick: runOnSegment }, 'Run on segment'),
      h('a.btn.ghost', { href: 'https://github.com/avchaykin/wled-studio/blob/main/docs/design/glow-language.md', target: '_blank', rel: 'noopener' }, 'Language guide')),
    h('h3', null, 'On this device'), deviceList,
  );
  lines(); build();
  store.subscribe((d, p) => { if (p.info) renderDevice(); });
  renderDevice();
  root.addEventListener('page-shown', () => { cancelAnimationFrame(raf); tick(); });
  return root;
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'script'; }

// Interpolate a /json/palx palette at 0..255 (approximation of WLED's palette blending)
function paletteAt(stops, i, segCols) {
  if (!stops || !stops.length) return ((i << 16) | (i << 8) | i) >>> 0;
  const col = k => segCols?.[k] ?? [0, 0, 0];
  const pts = stops.map((e, k, a) => Array.isArray(e) ? [e[0], e[1], e[2], e[3]]
    : e === 'r' ? [a.length > 1 ? k * 255 / (a.length - 1) : 0, 255, 128, 0]
    : [a.length > 1 ? k * 255 / (a.length - 1) : 0, ...col(+e.slice(1) - 1)]);
  let k = 0; while (k < pts.length - 1 && pts[k + 1][0] < i) k++;
  const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)];
  const f = b[0] === a[0] ? 0 : (i - a[0]) / (b[0] - a[0]);
  const m = j => Math.round(a[j] + (b[j] - a[j]) * Math.max(0, Math.min(1, f)));
  return ((m(1) << 16) | (m(2) << 8) | m(3)) >>> 0;
}
