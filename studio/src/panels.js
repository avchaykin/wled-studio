// Segment panels: Effect, Colour, Palette, Segment.
import { h, mount, hex, fromHex, rgb2hsv, hsv2rgb, paletteCss, throttle } from './dom.js';
import { store, seg as selSeg, patchSeg, glowFx, persist } from './store.js';
import { send } from './api.js';
import { SEG_LOOK } from './stage.js';

const SLIDER_KEYS = ['sx', 'ix', 'c1', 'c2', 'c3'];
const CHECK_KEYS = ['o1', 'o2', 'o3'];
const DEFAULT_SLIDER = ['Speed', 'Intensity', 'Custom 1', 'Custom 2', 'Custom 3'];
const COLOR_NAMES = ['Primary', 'Background', 'Accent'];

// Parse WLED effect metadata ("sliders;colours;palette;flags;defaults")
export function fxMeta(id, cat) {
  const raw = cat?.fxdata?.[id];
  const defined = raw !== undefined && raw !== null && raw.length > 0;
  const parts = defined ? raw.split(';') : [];
  const sl = parts[0] ? parts[0].split(',') : [];
  const co = parts[1] ? parts[1].split(',') : [];
  const flags = parts[3] ?? '';
  const sliders = [], checks = [], colors = [];
  for (let i = 0; i < 5; i++) {
    if ((!defined && i < 2) || (sl[i] && sl[i] !== '')) sliders.push({ key: SLIDER_KEYS[i], label: !sl[i] || sl[i] === '!' ? DEFAULT_SLIDER[i] : sl[i] });
  }
  for (let i = 0; i < 3; i++) if (sl[5 + i]) checks.push({ key: CHECK_KEYS[i], label: sl[5 + i] === '!' ? `Option ${i + 1}` : sl[5 + i] });
  for (let i = 0; i < 3; i++) {
    if (!defined) colors.push({ i, label: COLOR_NAMES[i] });
    else if (co[i]) colors.push({ i, label: co[i] === '!' ? COLOR_NAMES[i] : co[i] });
  }
  if (id === 0) return { sliders: [], checks: [], colors: [{ i: 0, label: 'Colour' }], palette: false, audio: false, twoD: false }; // Solid
  return {
    sliders, checks, colors,
    palette: !defined || (parts[2] ?? '') !== '',
    audio: /[vf]/.test(flags), twoD: flags.includes('2') && !flags.includes('1'),
  };
}

// ---------------------------------------------------------------- Effect
export function EffectPanel() {
  const root = h('section.panel', { 'aria-label': 'Effect' });
  let query = '', filter = 'all', listEl, ctlEl;

  const search = h('input.search', {
    type: 'search', placeholder: 'Search effects', 'aria-label': 'Search effects',
    onInput: e => { query = e.target.value.toLowerCase(); renderList(); },
  });
  const chips = h('div.chips', { role: 'tablist' }, ...[['all', 'All'], ['fav', '★ Favourites'], ['glow', 'Scripts'], ['audio', '♪ Audio'], ['2d', '2D']]
    .map(([k, label]) => h('button.chip', { role: 'tab', 'aria-selected': k === filter, onClick: () => { filter = k; renderChips(); renderList(); } }, label)));
  const renderChips = () => [...chips.children].forEach((c, i) => c.setAttribute('aria-selected', ['all', 'fav', 'glow', 'audio', '2d'][i] === filter));

  function renderList() {
    const d = store.get(); const cat = d.cat; if (!cat || !listEl) return;
    const s = selSeg(d); const glow = glowFx(d); const favs = new Set(d.favs);
    const items = cat.effects.map((name, id) => ({ name, id, m: fxMeta(id, cat) }))
      .filter(e => e.name && e.name !== 'RSVD' && !e.name.startsWith('-'))
      .filter(e => !query || e.name.toLowerCase().includes(query))
      .filter(e => filter === 'all' || (filter === 'fav' && favs.has(e.id)) || (filter === 'glow' && glow.has(e.id))
        || (filter === 'audio' && e.m.audio) || (filter === '2d' && e.m.twoD))
      .sort((a, b) => (a.id === 0 ? -1 : b.id === 0 ? 1 : (favs.has(b.id) - favs.has(a.id)) || a.name.localeCompare(b.name)));
    mount(listEl, items.length ? items.map(e => h('div.fxrow', { role: 'option', 'aria-selected': s?.fx === e.id },
      h('button.fxname', { onClick: () => { patchSeg(s.id, { fx: e.id }); send({ seg: [{ id: s.id, fx: e.id, fxdef: true }] }, { now: true }); } },
        e.name,
        glow.has(e.id) && h('span.badge.glow', null, 'script'),
        e.m.audio && h('span.badge', { title: 'Sound reactive' }, '♪'),
        e.m.twoD && h('span.badge', null, '2D')),
      h('button.fav', {
        'aria-label': favs.has(e.id) ? `Unfavourite ${e.name}` : `Favourite ${e.name}`, 'aria-pressed': favs.has(e.id),
        onClick: () => { const f = favs.has(e.id) ? d.favs.filter(x => x !== e.id) : [...d.favs, e.id]; persist('studio.favs', f); store.set({ favs: f }); renderList(); },
      }, favs.has(e.id) ? '★' : '☆'),
    )) : h('p.empty', null, filter === 'fav' ? 'Star effects to keep them here.' : 'No effects match.'));
  }

  function renderControls() {
    const d = store.get(); const s = selSeg(d); if (!s || !d.cat) return;
    const m = fxMeta(s.fx, d.cat);
    mount(ctlEl,
      h('h3.fxtitle', null, d.cat.effects[s.fx] ?? `Effect ${s.fx}`),
      m.sliders.map(sl => Slider(sl.label, s[sl.key] ?? 128, v => { patchSeg(s.id, { [sl.key]: v }); send({ seg: [{ id: s.id, [sl.key]: v }] }); })),
      m.checks.length > 0 && h('div.checks', null, m.checks.map(c => Toggle(c.label, !!s[c.key], v => { patchSeg(s.id, { [c.key]: v }); send({ seg: [{ id: s.id, [c.key]: v }] }); }))),
    );
  }

  ctlEl = h('div.fxcontrols');
  listEl = h('div.fxlist', { role: 'listbox', 'aria-label': 'Effects' });
  mount(root, ctlEl, h('div.fxsearch', null, search, chips), listEl);
  let lastKey = '', lastCtl = '';
  store.subscribe((d, p) => {
    const s = selSeg(d);
    const key = `${s?.id}:${s?.fx}:${d.cat ? 1 : 0}:${(d.info?.glow?.slots ?? []).length}`;
    if (key !== lastKey) { lastKey = key; renderList(); }
    // controls: rebuild only when values changed from outside (not while dragging)
    const ctl = s ? JSON.stringify([!!d.cat, s.id, s.fx, s.sx, s.ix, s.c1, s.c2, s.c3, s.o1, s.o2, s.o3]) : '';
    if (!dragging && ctl !== lastCtl) { lastCtl = ctl; renderControls(); }
  });
  renderList(); renderControls();
  return root;
}

// While a slider is being dragged we don't re-render controls (state echoes would fight the finger).
let dragging = false;
export function Slider(label, value, onChange, { min = 0, max = 255, fmt } = {}) {
  const out = h('output', null, fmt ? fmt(value) : value);
  const input = h('input', {
    type: 'range', min, max, value, 'aria-label': label,
    onPointerdown: () => { dragging = true; }, onPointerup: () => { dragging = false; },
    onBlur: () => { dragging = false; },
    onInput: e => { const v = +e.target.value; out.textContent = fmt ? fmt(v) : v; e.target.style.setProperty('--p', `${(v - min) / (max - min) * 100}%`); onChange(v); },
  });
  input.style.setProperty('--p', `${(value - min) / (max - min) * 100}%`);
  return h('label.slider', null, h('span.slabel', null, label, out), input);
}

export function Toggle(label, value, onChange) {
  return h('label.toggle', null,
    h('input', { type: 'checkbox', checked: value, role: 'switch', onChange: e => onChange(e.target.checked) }),
    h('span.track', { 'aria-hidden': true }), h('span', null, label));
}

// ---------------------------------------------------------------- Colour
export function ColorPanel() {
  const root = h('section.panel', { 'aria-label': 'Colour' });
  let slot = 0;
  const wheel = h('canvas.wheel', { width: 240, height: 240, 'aria-label': 'Hue and saturation' });
  const wctx = wheel.getContext('2d');
  const marker = h('div.wheelmark');
  const valueSlider = h('div');
  const slots = h('div.slots', { role: 'tablist' });
  const hexIn = h('input.hex', { 'aria-label': 'Hex colour', maxLength: 7, spellcheck: false, onChange: e => { if (/^#?[0-9a-f]{6}$/i.test(e.target.value)) setColor(fromHex(e.target.value)); } });
  const swatches = h('div.swatches', null, ['#ff0000', '#ff7a00', '#ffd400', '#00ff40', '#00e0ff', '#0050ff', '#8a00ff', '#ff00a8', '#ffffff', '#ffb46b', '#000000']
    .map(c => h('button.sw', { style: { background: c }, 'aria-label': c, onClick: () => setColor(fromHex(c)) })));

  // hue/sat disc
  (function paint() {
    const R = 120, img = wctx.createImageData(240, 240);
    for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) {
      const dx = x - R, dy = y - R, r = Math.hypot(dx, dy); const k = (y * 240 + x) * 4;
      if (r > R) { img.data[k + 3] = 0; continue; }
      const [cr, cg, cb] = hsv2rgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, r / R, 1);
      img.data[k] = cr; img.data[k + 1] = cg; img.data[k + 2] = cb; img.data[k + 3] = r > R - 1 ? 128 : 255;
    }
    wctx.putImageData(img, 0, 0);
  })();

  const cur = () => { const s = selSeg(); return s?.col?.[slot] ?? [0, 0, 0]; };
  const push = throttle((s, cols) => send({ seg: [{ id: s.id, col: cols }] }), 60);
  function setColor(rgb) {
    const s = selSeg(); if (!s) return;
    const cols = [0, 1, 2].map(i => (i === slot ? [...rgb, ...(s.col?.[i]?.length > 3 ? [s.col[i][3]] : [])] : s.col?.[i] ?? [0, 0, 0]));
    patchSeg(s.id, { col: cols }); push(s, cols); sync();
  }
  function fromWheel(e) {
    const r = wheel.getBoundingClientRect(); const R = r.width / 2;
    const dx = e.clientX - r.left - R, dy = e.clientY - r.top - R;
    const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, sat = Math.min(1, Math.hypot(dx, dy) / R);
    const v = rgb2hsv(cur())[2] || 1;
    setColor(hsv2rgb(hue, sat, v));
  }
  let wheelDown = false;
  wheel.addEventListener('pointerdown', e => { wheelDown = dragging = true; wheel.setPointerCapture(e.pointerId); fromWheel(e); });
  wheel.addEventListener('pointermove', e => wheelDown && fromWheel(e));
  wheel.addEventListener('pointerup', () => { wheelDown = dragging = false; });

  function sync() {
    const d = store.get(); const s = selSeg(d); if (!s) return;
    const m = fxMeta(s.fx, d.cat);
    if (!m.colors.some(c => c.i === slot)) slot = m.colors[0]?.i ?? 0;
    mount(slots, m.colors.map(c => h('button.slot', {
      role: 'tab', 'aria-selected': c.i === slot, onClick: () => { slot = c.i; sync(); },
    }, h('span.dot', { style: { background: hex(s.col?.[c.i] ?? [0, 0, 0]) } }), c.label)));
    const rgb = cur(); const [hh, ss, vv] = rgb2hsv(rgb);
    const a = hh * Math.PI / 180;
    marker.style.left = `${50 + Math.cos(a) * ss * 50}%`; marker.style.top = `${50 + Math.sin(a) * ss * 50}%`;
    marker.style.background = hex(rgb);
    if (document.activeElement !== hexIn) hexIn.value = hex(rgb);
    if (!dragging) mount(valueSlider, Slider('Brightness of colour', Math.round(vv * 255), v => setColor(hsv2rgb(hh, ss, v / 255))));
  }
  mount(root, slots, h('div.colorrow', null, h('div.wheelwrap', null, wheel, marker), h('div.colorside', null, valueSlider, hexIn, swatches)));
  store.subscribe((d, p) => { if (p.state || 'sel' in p || p.cat) sync(); });
  sync();
  return root;
}

// ---------------------------------------------------------------- Palette
export function PalettePanel() {
  const root = h('section.panel', { 'aria-label': 'Palette' });
  let q = '';
  const list = h('div.palgrid', { role: 'listbox', 'aria-label': 'Palettes' });
  const search = h('input.search', { type: 'search', placeholder: 'Search palettes', 'aria-label': 'Search palettes', onInput: e => { q = e.target.value.toLowerCase(); render(); } });
  function render() {
    const d = store.get(); const s = selSeg(d); if (!d.cat || !s) return;
    const pals = d.cat.palettes.map((name, id) => ({ name, id })).filter(p => !q || p.name.toLowerCase().includes(q));
    mount(list, pals.map(p => h('button.pal', {
      role: 'option', 'aria-selected': s.pal === p.id,
      onClick: () => { patchSeg(s.id, { pal: p.id }); send({ seg: [{ id: s.id, pal: p.id }] }, { now: true }); },
    }, h('span.palgrad', { style: { background: paletteCss(d.cat.palx[p.id], s.col) } }), h('span.palname', null, p.name))));
  }
  mount(root, search, list);
  store.subscribe((d, p) => { if (p.cat || 'sel' in p || p.state) render(); });
  render();
  return root;
}

// ---------------------------------------------------------------- Segment
export function SegmentPanel() {
  const root = h('section.panel', { 'aria-label': 'Segment settings' });
  function num(label, key, s, opts = {}) {
    return h('label.field', null, h('span', null, label), h('input', {
      type: 'number', value: s[key] ?? 0, min: opts.min ?? 0, max: opts.max ?? 65535, inputMode: 'numeric',
      onChange: e => { const v = +e.target.value; send({ seg: [{ id: s.id, [key]: v }] }, { now: true }); },
    }));
  }
  function render() {
    const d = store.get(); const s = selSeg(d); if (!s) return;
    const N = d.info?.leds?.count ?? 0; const segs = d.state.seg;
    const set = (k, v) => { patchSeg(s.id, { [k]: v }); send({ seg: [{ id: s.id, [k]: v }] }, { now: true }); };
    mount(root,
      h('label.field.wide', null, h('span', null, 'Name'), h('input', {
        value: s.n ?? '', placeholder: `Segment ${s.id}`, maxLength: 32,
        onChange: e => set('n', e.target.value),
      })),
      h('div.fieldgrid', null, num('First LED', 'start', s, { max: N - 1 }), num('End (exclusive)', 'stop', s, { max: N }),
        num('Grouping', 'grp', s, { min: 1, max: 255 }), num('Spacing', 'spc', s, { max: 255 }), num('Offset', 'of', s, { max: N })),
      Slider('Segment brightness', s.bri ?? 255, v => { patchSeg(s.id, { bri: v }); send({ seg: [{ id: s.id, bri: v }] }); }),
      h('div.checks', null,
        Toggle('On', s.on, v => set('on', v)), Toggle('Reverse', s.rev, v => set('rev', v)),
        Toggle('Mirror', s.mi, v => set('mi', v)), Toggle('Freeze', s.frz, v => set('frz', v))),
      h('div.actions', null,
        h('button.btn', { onClick: () => { const mid = Math.floor((s.start + s.stop) / 2); splitAt(s, mid); } }, 'Split in half'),
        segs.length > 1 && h('button.btn', { onClick: () => mergePrev(s, segs) }, 'Merge with previous'),
        segs.length > 1 && h('button.btn.danger', { onClick: () => { send({ seg: [{ id: s.id, stop: 0 }] }, { now: true }); store.set({ sel: segs.find(x => x.id !== s.id).id }); } }, 'Delete')),
    );
  }
  function splitAt(s, at) {
    const ids = new Set(store.get().state.seg.map(x => x.id)); let id = 0; while (ids.has(id)) id++;
    const look = Object.fromEntries(SEG_LOOK.filter(k => s[k] !== undefined).map(k => [k, s[k]]));
    send({ seg: [{ id: s.id, stop: at }, { id, start: at, stop: s.stop, ...look }] }, { now: true });
    store.set({ sel: id });
  }
  function mergePrev(s, segs) {
    const prev = segs.filter(x => x.stop <= s.start).sort((a, b) => b.stop - a.stop)[0];
    if (!prev) return;
    send({ seg: [{ id: prev.id, stop: s.stop }, { id: s.id, stop: 0 }] }, { now: true });
    store.set({ sel: prev.id });
  }
  store.subscribe((d, p) => { if (!dragging && (p.state || 'sel' in p)) { if (!root.contains(document.activeElement)) render(); } });
  render();
  return root;
}
