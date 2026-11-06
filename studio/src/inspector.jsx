// Inspector for the selected segment.
import { useRef, useState, useEffect } from 'preact/hooks';
import { useStore, selSeg, editSeg, glowFx, toggleFav } from './store.js';
import { Slider, NumberField, Switch, IconButton, Section, Popover, SearchList, Chips } from './ui.jsx';
import { Icon } from './icons.jsx';
import { fxMeta, hex, fromHex, rgb2hsv, hsv2rgb, paletteCss } from './lib.js';
import { splitSegment, mergeIntoPrevious, deleteSegment } from './timeline.jsx';

export function Inspector() {
  const seg = useStore(d => selSeg(d));
  const cat = useStore(d => d.cat);
  const total = useStore(d => d.info?.leds?.count ?? 0);
  const matrix = useStore(d => d.info?.leds?.matrix);
  const is2D = matrix?.w > 1 && matrix?.h > 1;
  const segCount = useStore(d => (d.state?.seg ?? []).filter(s => s.stop > s.start).length);
  if (!seg) return <aside class="inspector"><p class="muted pad">Connecting…</p></aside>;
  const m = fxMeta(seg.fx, cat);
  const ed = patch => editSeg(seg.id, patch);

  return (
    <aside class="inspector" aria-label="Segment inspector">
      <header class="insp-head">
        <SegName seg={seg} />
        <div class="insp-actions">
          <IconButton icon="split" label="Split in half" kbd="S" onClick={() => splitSegment(seg, Math.floor((seg.start + seg.stop) / 2))} disabled={seg.stop - seg.start < 2} />
          <IconButton icon="merge" label="Merge with previous" onClick={() => mergeIntoPrevious(seg)} disabled={segCount < 2} />
          <IconButton icon="trash" label="Delete segment" kbd="⌫" onClick={() => deleteSegment(seg)} disabled={segCount < 2} tone="danger" />
          <IconButton icon={seg.on ? 'eye' : 'eyeoff'} label={seg.on ? 'Turn segment off' : 'Turn segment on'} pressed={!seg.on} onClick={() => editSeg(seg.id, { on: !seg.on }, { now: true })} />
        </div>
        <p class="insp-range">{is2D
          ? <>Columns {seg.start}–{seg.stop - 1} · rows {seg.startY ?? 0}–{(seg.stopY ?? 1) - 1} · {(seg.stop - seg.start) * ((seg.stopY ?? 1) - (seg.startY ?? 0))} LEDs</>
          : <>LEDs {seg.start}–{seg.stop - 1} · {seg.stop - seg.start} LEDs</>}</p>
      </header>

      <Section title="Effect">
        <EffectField seg={seg} cat={cat} />
        {m.sliders.map(s => <Slider key={`${seg.id}${s.key}`} label={s.label} value={seg[s.key] ?? 128} onChange={v => ed({ [s.key]: v })} />)}
        {m.checks.length > 0 && <div class="switches">{m.checks.map(c => <Switch key={c.key} label={c.label} checked={seg[c.key]} onChange={v => editSeg(seg.id, { [c.key]: v }, { now: true })} />)}</div>}
      </Section>

      {m.colors.length > 0 && (
        <Section title="Colours">
          {m.colors.map(c => <ColorRow key={`${seg.id}${c.i}`} seg={seg} slot={c.i} label={c.label} />)}
        </Section>
      )}

      {m.palette && (
        <Section title="Palette">
          <PaletteField seg={seg} cat={cat} />
        </Section>
      )}

      <Section title="Layout">
        {is2D && (
          <div class="fieldgrid two">
            <Field label="Top row"><NumberField label="Top row" value={seg.startY ?? 0} max={(seg.stopY ?? 1) - 1} onChange={v => editSeg(seg.id, { startY: v }, { now: true })} wide /></Field>
            <Field label="Bottom row (excl.)"><NumberField label="Bottom row" value={seg.stopY ?? 1} min={(seg.startY ?? 0) + 1} max={matrix.h} onChange={v => editSeg(seg.id, { stopY: v }, { now: true })} wide /></Field>
          </div>
        )}
        <div class="fieldgrid two">
          <Field label={is2D ? 'Left column' : 'Start'}><NumberField label="Start" value={seg.start} max={seg.stop - 1} onChange={v => editSeg(seg.id, { start: v }, { now: true })} wide /></Field>
          <Field label={is2D ? 'Right column (excl.)' : 'End'}><NumberField label="End" value={seg.stop} min={seg.start + 1} max={is2D ? matrix.w : total} onChange={v => editSeg(seg.id, { stop: v }, { now: true })} wide /></Field>
        </div>
        <Slider label="Opacity" value={seg.bri ?? 255} onChange={v => ed({ bri: v })} fmt={v => `${Math.round(v / 2.55)}%`} />
        <div class="switches">
          <Switch label="Reverse" checked={seg.rev} onChange={v => editSeg(seg.id, { rev: v }, { now: true })} />
          <Switch label="Mirror" checked={seg.mi} onChange={v => editSeg(seg.id, { mi: v }, { now: true })} />
        </div>
        <details class="advanced">
          <summary><Icon name="chevron" size={14} />Grouping, spacing, offset</summary>
          <div class="fieldgrid">
            <Field label="Group"><NumberField label="Grouping" value={seg.grp ?? 1} min={1} max={255} onChange={v => editSeg(seg.id, { grp: v }, { now: true })} wide /></Field>
            <Field label="Space"><NumberField label="Spacing" value={seg.spc ?? 0} max={255} onChange={v => editSeg(seg.id, { spc: v }, { now: true })} wide /></Field>
            <Field label="Offset"><NumberField label="Offset" value={seg.of ?? 0} max={total} onChange={v => editSeg(seg.id, { of: v }, { now: true })} wide /></Field>
          </div>
          <Switch label="Freeze animation" checked={seg.frz} onChange={v => editSeg(seg.id, { frz: v }, { now: true })} />
        </details>
      </Section>
    </aside>
  );
}

function Field({ label, children }) { return <label class="field"><span>{label}</span>{children}</label>; }

function SegName({ seg }) {
  const [v, setV] = useState(null);
  return (
    <input
      class="segname" value={v ?? (seg.n || '')} placeholder={`Segment ${seg.id}`} aria-label="Segment name" maxLength={32} spellcheck={false}
      onFocus={() => setV(seg.n || '')} onInput={e => setV(e.currentTarget.value)}
      onBlur={() => { if (v !== null && v !== (seg.n || '')) editSeg(seg.id, { n: v }, { now: true }); setV(null); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') setV(null); e.currentTarget.blur(); } }}
    />
  );
}

// ----- effect -----
let itemsMemo = { key: null, items: [] };
export function effectItems(cat, glow, favs) {
  const key = cat && `${cat.effects.length}|${[...glow].join()}|${favs.join()}`;
  if (cat && key === itemsMemo.key && itemsMemo.cat === cat) return itemsMemo.items;
  const items = buildEffectItems(cat, glow, favs);
  itemsMemo = { key, cat, items };
  return items;
}
function buildEffectItems(cat, glow, favs) {
  return (cat?.effects ?? []).map((name, id) => ({ key: id, text: name, id, m: fxMeta(id, cat), glow: glow.has(id), fav: favs.includes(id) }))
    .filter(e => e.text && e.text !== 'RSVD' && !e.text.startsWith('-'))
    .sort((a, b) => (a.id === 0 ? -1 : b.id === 0 ? 1 : (b.fav - a.fav) || a.text.localeCompare(b.text)));
}
// Palettes: the six that are built from the segment colours (Default … Colors Only) stay
// on top in device order; the rest are alphabetical.
const DYNAMIC_PALETTES = 6;
let palMemo = { key: null, items: [] };
export function paletteItems(cat, favs) {
  const key = cat && `${cat.palettes.length}|${favs.join()}`;
  if (cat && key === palMemo.key && palMemo.cat === cat) return palMemo.items;
  const items = (cat?.palettes ?? []).map((text, id) => ({ key: id, id, text, fav: favs.includes(id), dyn: id < DYNAMIC_PALETTES }))
    .sort((a, b) => (b.dyn - a.dyn) || (a.dyn ? a.id - b.id : a.text.localeCompare(b.text)));
  palMemo = { key, cat, items };
  return items;
}
export function FavStar({ it, kind, inList }) {
  return (
    <button type="button" class={`fav${it.fav ? ' on' : ''}${inList ? ' in-list' : ''}`} aria-pressed={it.fav}
      aria-label={it.fav ? `Remove ${it.text} from favourites` : `Add ${it.text} to favourites`}
      onClick={e => { e.stopPropagation(); toggleFav(kind, it.id); }} onPointerDown={e => e.stopPropagation()}>
      <Icon name="star" fill={it.fav} />
    </button>
  );
}

export function FxTags({ it }) {
  return (
    <span class="tags">
      {it.glow && <span class="tag accent">Script</span>}
      {it.m.audio && <span class="tag" title="Sound reactive"><Icon name="audio" size={12} /></span>}
      {it.m.twoD && <span class="tag">2D</span>}
    </span>
  );
}

function EffectField({ seg, cat }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  useStore(d => d.info?.glow?.slots?.length ?? 0); // re-render when scripts change
  const glow = glowFx();
  const favs = useStore(d => d.favs);
  const name = cat?.effects?.[seg.fx] ?? `Effect ${seg.fx}`;
  return (
    <>
      <button ref={btn} type="button" class="picker" onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <span class="picker-value">{name}</span><Icon name="chevron" />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={300} label="Choose effect">
          <SearchList
            placeholder="Search effects" selectedKey={seg.fx}
            items={effectItems(cat, glow, favs)}
            render={(it, selected) => <><span class="sl-text">{it.text}</span><FxTags it={it} />{selected && <Icon name="check" />}</>}
            onPick={it => { editSeg(seg.id, { fx: it.id, fxdef: true }, { now: true }); setOpen(false); btn.current?.focus(); }}
          />
        </Popover>
      )}
    </>
  );
}

// ----- palette -----
function PaletteField({ seg, cat }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const [onlyFav, setOnlyFav] = useState(false);
  const favs = useStore(d => d.palFavs);
  const items = paletteItems(cat, favs);
  const name = items.find(it => it.id === seg.pal)?.text ?? `Palette ${seg.pal}`;
  return (
    <>
      <button ref={btn} type="button" class="picker" onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <span class="swatchbar" style={{ background: paletteCss(cat?.palx?.[seg.pal], seg.col) }} />
        <span class="picker-value">{name}</span><Icon name="chevron" />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={320} label="Choose palette">
          <Chips label="Palette filter" value={onlyFav ? 'fav' : 'all'} onChange={v => setOnlyFav(v === 'fav')} options={[['all', 'All'], ['fav', `Favourites${favs.length ? ` ${favs.length}` : ''}`]]} />
          <SearchList
            key={onlyFav} placeholder="Search palettes" selectedKey={seg.pal}
            items={onlyFav ? items.filter(it => it.fav) : items}
            empty={onlyFav ? 'Star palettes to list them here.' : undefined}
            render={(it, selected) => <><span class="swatchbar" style={{ background: paletteCss(cat.palx[it.id], seg.col) }} /><span class="sl-text">{it.text}</span>{selected && <Icon name="check" />}<FavStar it={it} kind="palFavs" inList /></>}
            onPick={it => { editSeg(seg.id, { pal: it.id }, { now: true }); setOpen(false); btn.current?.focus(); }}
          />
        </Popover>
      )}
    </>
  );
}

// ----- colours -----
function ColorRow({ seg, slot, label }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(null);
  const c = seg.col?.[slot] ?? [0, 0, 0];
  const setColor = rgb => {
    const cols = [0, 1, 2].map(i => (i === slot ? (c.length > 3 ? [...rgb, c[3]] : rgb) : seg.col?.[i] ?? [0, 0, 0]));
    editSeg(seg.id, { col: cols });
  };
  return (
    <div class="colorrow">
      <button ref={btn} type="button" class="swatch" style={{ background: hex(c) }} aria-label={`${label} colour, ${hex(c)}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)} />
      <input
        class="hexfield" value={text ?? hex(c).slice(1).toUpperCase()} aria-label={`${label} hex`} maxLength={7} spellcheck={false}
        onFocus={e => { setText(hex(c).slice(1).toUpperCase()); requestAnimationFrame(() => e.currentTarget?.select()); }}
        onInput={e => { setText(e.currentTarget.value); const rgb = fromHex(e.currentTarget.value); if (rgb) setColor(rgb); }}
        onBlur={() => setText(null)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
      />
      <span class="colorlabel">{label}</span>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={248} label={`${label} colour`}>
          <ColorPicker rgb={c} onChange={setColor} />
        </Popover>
      )}
    </div>
  );
}

const SWATCHES = ['#ff0000', '#ff6a00', '#ffc800', '#00ff3c', '#00d5ff', '#0040ff', '#8c00ff', '#ff00aa', '#ffffff', '#ffb070', '#000000'];

// Saturation/value square + hue strip. Keeps HSV locally so hue survives dark/grey colours.
function ColorPicker({ rgb, onChange }) {
  const [hsv, setHsv] = useState(() => rgb2hsv(rgb));
  const sv = useRef(null), hue = useRef(null);
  const last = useRef(hex(rgb));
  useEffect(() => { const h = hex(rgb); if (h !== last.current) { last.current = h; setHsv(rgb2hsv(rgb)); } }, [hex(rgb)]);
  const apply = ([h, s, v]) => { setHsv([h, s, v]); const out = hsv2rgb(h, s, v); last.current = hex(out); onChange(out); };
  const drag = (el, fn) => e => {
    e.preventDefault(); el.current.setPointerCapture(e.pointerId);
    const r = el.current.getBoundingClientRect();
    const at = ev => fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
    at(e);
    const mv = ev => at(ev);
    const up = () => { el.current?.removeEventListener('pointermove', mv); el.current?.removeEventListener('pointerup', up); };
    el.current.addEventListener('pointermove', mv); el.current.addEventListener('pointerup', up);
  };
  const [h, s, v] = hsv;
  const key = (dx, dy) => e => { e.preventDefault(); apply([h, Math.max(0, Math.min(1, s + dx)), Math.max(0, Math.min(1, v + dy))]); };
  return (
    <div class="cpick">
      <div
        ref={sv} class="cpick-sv" style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${h} 100% 50%))` }}
        role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuetext={`saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`}
        onPointerDown={drag(sv, (x, y) => apply([h, x, 1 - y]))}
        onKeyDown={e => ({ ArrowLeft: key(-0.02, 0), ArrowRight: key(0.02, 0), ArrowUp: key(0, 0.02), ArrowDown: key(0, -0.02) })[e.key]?.(e)}
      >
        <span class="cpick-dot" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hex(hsv2rgb(h, s, v)) }} />
      </div>
      <div
        ref={hue} class="cpick-hue" role="slider" tabIndex={0} aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(h)}
        onPointerDown={drag(hue, x => apply([x * 360, s || 1, v || 1]))}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); apply([(h + (e.key === 'ArrowRight' ? 3 : -3) + 360) % 360, s, v]); } }}
      >
        <span class="cpick-hue-dot" style={{ left: `${(h / 360) * 100}%` }} />
      </div>
      <div class="cpick-swatches">
        {SWATCHES.map(c => <button key={c} type="button" class="mini-swatch" style={{ background: c }} aria-label={c} onClick={() => apply(rgb2hsv(fromHex(c)))} />)}
      </div>
    </div>
  );
}

