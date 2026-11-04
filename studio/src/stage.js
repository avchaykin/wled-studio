// LED preview canvas + segment bar (drag boundaries, split, select).
import { h, hex } from './dom.js';
import { store, seg as selSeg } from './store.js';
import { send } from './api.js';

// fields that define a segment's look, copied when splitting
export const SEG_LOOK = ['fx', 'sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3', 'pal', 'col', 'bri', 'si', 'm12', 'rev', 'mi'];
const SEG_HUES = [200, 30, 140, 280, 350, 90, 250, 50, 170, 310];
export const segHue = id => SEG_HUES[id % SEG_HUES.length];

// Reusable LED renderer. Strips wrap into rows; matrices draw as a grid.
export class LedCanvas {
  constructor({ maxRows = 8 } = {}) {
    this.el = h('canvas.leds');
    this.ctx = this.el.getContext('2d');
    this.maxRows = maxRows;
    this.n = 0; this.w = 0; this.h = 0; this.rgb = null;
    this.segs = null; // [{start, stop, hue, sel}] drawn as ticks under the LEDs (strips only)
    new ResizeObserver(() => this.draw()).observe(this.el);
  }
  // rgb: Uint8Array of r,g,b triplets; w/h > 0 for matrices
  setFrame({ rgb, w = 0, h = 0 }) { this.rgb = rgb; this.n = rgb.length / 3 | 0; this.w = w; this.h = h; this.draw(); }
  setPixels(u32, w = 0, h = 0) {
    const rgb = new Uint8Array(u32.length * 3);
    for (let i = 0; i < u32.length; i++) {
      const c = u32[i], wch = (c >>> 24) & 255;
      rgb[i * 3] = Math.min(255, ((c >>> 16) & 255) + wch);
      rgb[i * 3 + 1] = Math.min(255, ((c >>> 8) & 255) + wch);
      rgb[i * 3 + 2] = Math.min(255, (c & 255) + wch);
    }
    this.setFrame({ rgb, w, h });
  }
  draw() {
    const cv = this.el, dpr = devicePixelRatio || 1;
    const W = cv.clientWidth; if (!W || !this.n) return;
    let cols, rows;
    if (this.w && this.h) { cols = this.w; rows = this.h; }
    else {
      // wrap long strips so each LED gets ~12px
      rows = Math.min(this.maxRows, Math.max(1, Math.ceil(this.n * 12 / W)));
      cols = Math.ceil(this.n / rows);
    }
    const cell = W / cols;
    const ch = this.w ? Math.min(cell, 420 / rows) : Math.max(12, Math.min(cell, 28) + 3);
    const H = rows * ch + (this.w ? 0 : 0);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
    const r = this.rgb, rad = Math.max(1, Math.min(cell, ch) * 0.36);
    const tick = !this.w && this.segs ? 3 : 0;
    for (let i = 0; i < this.n; i++) {
      const cx = (i % cols + 0.5) * cell, cy = (Math.floor(i / cols) + 0.5) * ch;
      ctx.fillStyle = `rgb(${r[i * 3]},${r[i * 3 + 1]},${r[i * 3 + 2]})`;
      if (cell >= 6) { ctx.beginPath(); ctx.arc(cx, cy - tick / 2, rad, 0, 6.2832); ctx.fill(); }
      else ctx.fillRect(cx - cell / 2, cy - ch / 2, cell, ch - tick);
    }
    if (tick) for (const s of this.segs) {
      ctx.fillStyle = `hsl(${s.hue} 80% ${s.sel ? 60 : 35}%)`;
      for (let i = s.start; i < s.stop && i < this.n; i++) {
        const x = (i % cols) * cell, y = (Math.floor(i / cols) + 1) * ch - tick;
        ctx.fillRect(x + (i === s.start ? 1 : 0), y, cell - (i === s.stop - 1 ? 1 : 0), 2);
      }
    }
  }
}

// Segment bar: one track for the whole strip, blocks per segment.
// Drag a shared boundary to move it; double-click / long-press inside a segment to split there.
export function SegmentBar() {
  const track = h('div.segtrack', { role: 'listbox', 'aria-label': 'Segments' });
  let drag = null, pressTimer = null;

  const total = () => store.get().info?.leds?.count || 1;
  const posAt = e => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(total(), Math.round((e.clientX - r.left) / r.width * total())));
  };

  function render() {
    const d = store.get(); const segs = d.state?.seg ?? []; const N = total(); const sel = selSeg(d)?.id;
    track.replaceChildren(...segs.filter(s => s.stop > s.start).map(s => {
      const hue = segHue(s.id);
      const block = h('div.seg', {
        role: 'option', 'aria-selected': s.id === sel, tabIndex: 0,
        style: { left: `${s.start / N * 100}%`, width: `${(s.stop - s.start) / N * 100}%`, '--hue': hue, opacity: s.on ? 1 : 0.45 },
        title: `${s.n || 'Segment ' + s.id}: ${s.start}–${s.stop - 1}`,
        onClick: () => store.set({ sel: s.id }),
        onKeydown: e => { if (e.key === 'Enter') store.set({ sel: s.id }); },
        onDblclick: e => split(s, posAt(e)),
        onPointerdown: e => {
          if (e.pointerType !== 'mouse') {
            const x = e.clientX;
            pressTimer = setTimeout(() => split(s, posAt({ clientX: x })), 550);
          }
        },
        onPointerup: () => clearTimeout(pressTimer),
        onPointerleave: () => clearTimeout(pressTimer),
      },
      h('span.seglabel', null, s.n || `${s.id}`),
      h('span.segswatch', { style: { background: hex(s.col?.[0] ?? [0, 0, 0]) } }));
      return block;
    }), ...handles(segs, N));
  }

  // one handle per segment edge; a shared edge moves both neighbours
  function handles(segs, N) {
    const edges = new Map();
    for (const s of segs) {
      if (s.stop <= s.start) continue;
      for (const [pos, side] of [[s.start, 'start'], [s.stop, 'stop']]) {
        if (!edges.has(pos)) edges.set(pos, []);
        edges.get(pos).push({ id: s.id, side });
      }
    }
    return [...edges].map(([pos, owners]) => h('div.seghandle', {
        style: { left: `${pos / N * 100}%` }, title: `LED ${pos}`, 'aria-label': `Boundary at LED ${pos}`,
        onPointerdown: e => {
          e.stopPropagation(); e.preventDefault();
          drag = { owners, from: pos };
          // window listeners: render() replaces handle elements during the drag
          const move = ev => moveEdge(posAt(ev));
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (drag) commit(); drag = null; };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        },
      }));
  }

  function moveEdge(p) {
    const st = store.get().state;
    const segs = st.seg.map(s => {
      const o = drag.owners.find(o => o.id === s.id); if (!o) return s;
      // keep at least one LED in each segment
      const v = o.side === 'start' ? Math.min(p, s.stop - 1) : Math.max(p, s.start + 1);
      return { ...s, [o.side]: v };
    });
    store.set({ state: { ...st, seg: segs } });
    render();
  }
  function commit() {
    const segs = store.get().state.seg.filter(s => drag.owners.some(o => o.id === s.id));
    send({ seg: segs.map(s => ({ id: s.id, start: s.start, stop: s.stop })) }, { now: true });
  }

  function split(s, at) {
    if (at <= s.start || at >= s.stop) return;
    const d = store.get(); const ids = new Set(d.state.seg.map(x => x.id));
    const max = d.info?.leds?.maxseg ?? 16;
    let id = 0; while (ids.has(id)) id++;
    if (id >= max) return;
    // new segment copies look of the one being split
    const copy = Object.fromEntries(SEG_LOOK.filter(k => s[k] !== undefined).map(k => [k, s[k]]));
    send({ seg: [{ id: s.id, stop: at }, { id, start: at, stop: s.stop, ...copy }] }, { now: true });
    store.set({ sel: id });
  }

  store.subscribe((d, p) => { if (!drag && (p.state || p.info || 'sel' in p)) render(); });
  render();
  return track;
}
