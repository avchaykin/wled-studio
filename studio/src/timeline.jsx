// Timeline: LED ruler + one lane of segment clips that render their live pixels.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, set, getState, onLive, command } from './store.js';
import { Icon } from './icons.jsx';

// Shared with keyboard shortcuts: which LED the pointer is over (or null).
export const hover = { led: null };

// ---- undo for structural segment changes ----
const SNAP_KEYS = ['start', 'stop', 'grp', 'spc', 'of', 'on', 'bri', 'n', 'fx', 'sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3', 'pal', 'col', 'rev', 'mi', 'frz', 'si', 'm12', 'cct'];
const undoStack = [];
function snapshot() {
  return (getState().state?.seg ?? []).map(s => Object.fromEntries([['id', s.id], ...SNAP_KEYS.filter(k => s[k] !== undefined).map(k => [k, s[k]])]));
}
// run a structural change and remember how to undo it; toast=true announces it
export function structural(label, msg, toast = true) {
  undoStack.push({ label, segs: snapshot(), sel: getState().sel });
  if (undoStack.length > 30) undoStack.shift();
  command(msg);
  if (toast) set({ toast: { label, at: Date.now() } });
}
export function undo() {
  const u = undoStack.pop(); if (!u) return false;
  const keep = new Set(u.segs.map(s => s.id));
  const extra = (getState().state?.seg ?? []).filter(s => !keep.has(s.id) && s.stop > s.start).map(s => ({ id: s.id, stop: 0 }));
  command({ seg: [...extra, ...u.segs] });
  set({ sel: u.sel, toast: { label: `Undid: ${u.label.toLowerCase()}`, at: Date.now(), done: true } });
  return true;
}

// fields that define a segment's look, copied when splitting
const LOOK = ['fx', 'sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3', 'pal', 'col', 'bri', 'si', 'm12', 'rev', 'mi', 'cct'];

export function splitSegment(seg, at) {
  const d = getState();
  if (!seg || at <= seg.start || at >= seg.stop) return false;
  const ids = new Set(d.state.seg.map(s => s.id));
  let id = 0; while (ids.has(id)) id++;
  if (id >= (d.info?.leds?.maxseg ?? 16)) return false;
  const look = Object.fromEntries(LOOK.filter(k => seg[k] !== undefined).map(k => [k, seg[k]]));
  structural(`Split ${seg.n || `segment ${seg.id}`} at LED ${at}`, { seg: [{ id: seg.id, stop: at }, { id, start: at, stop: seg.stop, ...look }] });
  set({ sel: id });
  return true;
}
export function mergeIntoPrevious(seg) {
  const segs = getState().state.seg;
  const prev = segs.filter(s => s.id !== seg.id && s.stop > s.start && s.stop <= seg.start).sort((a, b) => b.stop - a.stop)[0];
  if (!prev) return false;
  structural(`Merged ${seg.n || `segment ${seg.id}`} into ${prev.n || `segment ${prev.id}`}`, { seg: [{ id: prev.id, stop: seg.stop }, { id: seg.id, stop: 0 }] });
  set({ sel: prev.id });
  return true;
}
export function deleteSegment(seg) {
  const segs = getState().state.seg.filter(s => s.stop > s.start);
  if (segs.length < 2) return false;
  structural(`Deleted ${seg.n || `segment ${seg.id}`}`, { seg: [{ id: seg.id, stop: 0 }] });
  set({ sel: segs.find(s => s.id !== seg.id).id });
  return true;
}

function OffscreenCanvasOr(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

function niceStep(n, px) {
  const target = n * 64 / Math.max(px, 1);   // ~64px between labels
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (s >= target) return s;
  return 1000;
}

export function Timeline() {
  const { segs, total, sel } = useStore(d => ({ segs: d.state?.seg, total: d.info?.leds?.count ?? 0, sel: d.sel }));
  const wrap = useRef(null), canvas = useRef(null);
  const [width, setWidth] = useState(0);
  const [hoverLed, setHoverLed] = useState(null);
  const [drag, setDrag] = useState(null);      // { owners:[{id,side}], pos }
  const frame = useRef(null);
  const row = useRef(null);
  const matrix = useRef(null);

  const clips = (segs ?? []).filter(s => s.stop > s.start).map(s => {
    if (!drag) return s;
    const o = drag.owners.find(o => o.id === s.id);
    if (!o) return s;
    return o.side === 'start' ? { ...s, start: Math.min(drag.pos, s.stop - 1) } : { ...s, stop: Math.max(drag.pos, s.start + 1) };
  });

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrap.current); return () => ro.disconnect();
  }, []);

  // live pixels -> canvas, drawn inside clip rects
  const clipsRef = useRef(clips); clipsRef.current = clips;
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      const cv = canvas.current; if (!cv || !width || !total) return;
      const dpr = devicePixelRatio || 1, H = cv.clientHeight;
      if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(width * dpr); cv.height = Math.round(H * dpr); }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, H);
      const f = frame.current; const px = width / total;
      // one RGBA row for the whole strip, stretched into each clip with nearest-neighbour scaling
      if (f) {
        const n = f.rgb.length / 3 | 0;
        if (!row.current || row.current.width !== total) { row.current = new OffscreenCanvasOr(total, 1); }
        const rctx = row.current.getContext('2d'); const img = rctx.createImageData(total, 1);
        for (let i = 0; i < total; i++) {
          const k = Math.min(n - 1, Math.floor(i * n / total)) * 3;
          img.data[i * 4] = f.rgb[k]; img.data[i * 4 + 1] = f.rgb[k + 1]; img.data[i * 4 + 2] = f.rgb[k + 2]; img.data[i * 4 + 3] = 255;
        }
        rctx.putImageData(img, 0, 0);
      }
      ctx.imageSmoothingEnabled = false;
      for (const c of clipsRef.current) {
        const x0 = c.start * px, x1 = c.stop * px;
        ctx.save();
        ctx.beginPath(); ctx.roundRect(x0 + 1, 2, x1 - x0 - 2, H - 4, 5); ctx.clip();
        ctx.fillStyle = '#08090a'; ctx.fillRect(x0, 0, x1 - x0, H);
        if (f) {
          ctx.drawImage(row.current, c.start, 0, c.stop - c.start, 1, x0, 0, x1 - x0, H);
          // faint LED separators once LEDs are wide enough to read individually
          if (px >= 6) {
            ctx.fillStyle = 'rgb(8 9 10 / .35)';
            for (let i = c.start + 1; i < c.stop; i++) ctx.fillRect(Math.round(i * px), 0, 1, H);
          }
        }
        ctx.restore();
      }
    };
    const stop = onLive(f => {
      frame.current = f;
      matrix.current?.(f);
      if (!raf) raf = requestAnimationFrame(draw);
    });
    draw();
    return () => { stop(); cancelAnimationFrame(raf); };
  }, [width, total, clips.map(c => `${c.id}:${c.start}:${c.stop}`).join()]);

  const ledAt = e => {
    const r = wrap.current.getBoundingClientRect();
    return Math.max(0, Math.min(total, Math.round((e.clientX - r.left) / r.width * total)));
  };

  // edges: a shared boundary moves both neighbours
  const edges = new Map();
  for (const c of clips) for (const [pos, side] of [[c.start, 'start'], [c.stop, 'stop']]) {
    if (!edges.has(pos)) edges.set(pos, []);
    edges.get(pos).push({ id: c.id, side });
  }

  function startDrag(e, owners, from) {
    e.preventDefault(); e.stopPropagation();
    let pos = from;
    setDrag({ owners, pos });
    const move = ev => {
      let p = ledAt(ev);
      if (ev.shiftKey) p = Math.round(p / 10) * 10;
      // keep every segment at least one LED long
      for (const o of owners) {
        const s = segs.find(x => x.id === o.id);
        p = o.side === 'start' ? Math.min(p, s.stop - 1) : Math.max(p, s.start + 1);
      }
      pos = p; setDrag({ owners, pos }); setHoverLed(p);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (pos !== from) structural(`Moved boundary to LED ${pos}`, { seg: owners.map(o => ({ id: o.id, [o.side]: pos })) }, false);
      // keep the dragged geometry until the device confirms
      setTimeout(() => setDrag(null), 350);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  const step = niceStep(total, width);
  const ticks = [];
  for (let i = 0; i <= total; i += step) ticks.push(i);
  const pct = i => `${(i / Math.max(total, 1)) * 100}%`;
  const readout = drag ? drag.pos : hoverLed;

  return (
    <div class="timeline">
      <MatrixPreview hook={matrix} />
      <div class="ruler" aria-hidden="true">
        {ticks.map(t => <span key={t} class="tick" style={{ left: pct(t) }}>{t}</span>)}
      </div>
      <div
        class="lane" ref={wrap}
        onPointerMove={e => { const l = ledAt(e); hover.led = l; if (!drag) setHoverLed(l); }}
        onPointerLeave={() => { hover.led = null; if (!drag) setHoverLed(null); }}
      >
        <canvas ref={canvas} class="lane-canvas" />
        {clips.map(c => (
          <button
            key={c.id} type="button"
            class={`clip${c.id === sel ? ' sel' : ''}${c.on === false ? ' off' : ''}`}
            style={{ left: pct(c.start), width: pct(c.stop - c.start) }}
            aria-pressed={c.id === sel}
            aria-label={`${c.n || `Segment ${c.id}`}, LEDs ${c.start} to ${c.stop - 1}`}
            onClick={() => set({ sel: c.id })}
            onDblClick={e => splitSegment(c, ledAt(e))}
          >
            <span class="clip-label">{c.n || `Seg ${c.id}`}{c.on === false && <Icon name="eyeoff" size={12} />}</span>
          </button>
        ))}
        {[...edges].map(([pos, owners]) => (
          <div
            key={`e${pos}`} class={`edge${drag?.owners === owners ? ' active' : ''}`} style={{ left: pct(pos) }}
            role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Boundary at LED ${pos}`} aria-valuenow={pos} aria-valuemin={0} aria-valuemax={total}
            onPointerDown={e => startDrag(e, owners, pos)}
            onFocus={() => setHoverLed(pos)} onBlur={() => setHoverLed(null)}
            onKeyDown={e => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              let p = pos + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
              for (const o of owners) { const s = segs.find(x => x.id === o.id); p = o.side === 'start' ? Math.min(p, s.stop - 1) : Math.max(p, s.start + 1); }
              p = Math.max(0, Math.min(total, p));
              if (p !== pos) structural(`Moved boundary to LED ${p}`, { seg: owners.map(o => ({ id: o.id, [o.side]: p })) }, false);
            }}
          />
        ))}
        {readout != null && (
          <div class={`cursor${drag ? ' dragging' : ''}`} style={{ left: pct(readout) }}>
            <span class="cursor-chip">{readout}</span>
          </div>
        )}
      </div>
      <p class="timeline-hint">
        <span class="hint-group">Drag an edge to resize, <kbd class="kbd">⇧</kbd> snaps to 10</span> · <span class="hint-group"><kbd class="kbd">S</kbd> or double-click splits at the cursor</span> · <span class="hint-group"><kbd class="kbd">[</kbd> <kbd class="kbd">]</kbd> select previous/next</span> · <span class="hint-group"><kbd class="kbd">⌘Z</kbd> undo</span>
      </p>
    </div>
  );
}

// 2D devices get a grid preview above the lane.
function MatrixPreview({ hook }) {
  const cv = useRef(null);
  const [dims, setDims] = useState(null);
  useEffect(() => {
    hook.current = f => {
      if (!f.w || !f.h) { if (dims) setDims(null); return; }
      if (!dims || dims.w !== f.w || dims.h !== f.h) setDims({ w: f.w, h: f.h });
      const c = cv.current; if (!c) return;
      if (c.width !== f.w || c.height !== f.h) { c.width = f.w; c.height = f.h; }
      const ctx = c.getContext('2d'); const img = ctx.createImageData(f.w, f.h);
      for (let i = 0, j = 0; i < f.w * f.h; i++, j += 3) { img.data[i * 4] = f.rgb[j]; img.data[i * 4 + 1] = f.rgb[j + 1]; img.data[i * 4 + 2] = f.rgb[j + 2]; img.data[i * 4 + 3] = 255; }
      ctx.putImageData(img, 0, 0);
    };
  }, [dims]);
  if (!dims) return null;
  return <canvas ref={cv} class="matrix" style={{ aspectRatio: `${dims.w} / ${dims.h}` }} aria-label={`Live ${dims.w}×${dims.h} matrix`} />;
}
