// Palette editor: gradient stops on a bar; saved as /palette<idx>.json on the device.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, set, getState, selSeg, editSeg, saveCustomPalette, deleteCustomPalette } from './store.js';
import { Button, IconButton, DeleteButton, NumberField } from './ui.jsx';
import { ColorPicker } from './inspector.jsx';
import { hex, fromHex, paletteStops, paletteAt } from './lib.js';

const MAX_STOPS = 16; // the firmware reads up to 18 entries; 2 are kept for the 0/255 ends
let nextKey = 1;
const mk = (pos, r, g, b) => ({ k: nextKey++, pos, rgb: [r, g, b] });
const sorted = stops => [...stops].sort((a, b) => a.pos - b.pos || a.k - b.k);
const css = stops => `linear-gradient(90deg,${sorted(stops).map(s => `${hex(s.rgb)} ${(s.pos / 2.55).toFixed(1)}%`).join(',')})`;

// Open the editor: an existing custom palette (by idx) or a new one seeded from `seed` (palx entry).
export function editPalette({ idx = null, name, seed, cols }) {
  let st = paletteStops(seed, cols);
  if (st.length > MAX_STOPS) st = Array.from({ length: MAX_STOPS }, (_, i) => st[Math.round(i * (st.length - 1) / (MAX_STOPS - 1))]);
  set({ palEdit: { key: nextKey++, idx, name, stops: st.map(s => mk(...s)) } });
}

export function PaletteEditor() {
  const ed = useStore(d => d.palEdit);
  return ed ? <EditorDialog key={ed.key} init={ed} /> : null;
}

function HexField({ rgb, onChange }) {
  const [text, setText] = useState(null); // own the text while focused
  return (
    <input class="hexfield" value={text ?? hex(rgb).slice(1).toUpperCase()} maxLength={7} spellcheck={false} aria-label="Stop colour hex"
      onFocus={e => { setText(hex(rgb).slice(1).toUpperCase()); requestAnimationFrame(() => e.currentTarget?.select()); }}
      onInput={e => { setText(e.currentTarget.value); const c = fromHex(e.currentTarget.value); if (c) onChange(c); }}
      onBlur={() => setText(null)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

function EditorDialog({ init }) {
  const dlg = useRef(null), bar = useRef(null);
  const [name, setName] = useState(init.name);
  // stops + selection in one state, updated functionally: rapid key repeats chain correctly
  const [ed, setEd] = useState({ stops: init.stops, sel: init.stops[0]?.k });
  const { stops, sel } = ed;
  // only a stop that still exists can be selected (a focus event can arrive for one just removed)
  const setSel = k => setEd(e => (e.stops.some(s => s.k === k) ? { ...e, sel: k } : e));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { dlg.current?.showModal?.(); }, []);
  useEffect(() => { addEventListener('keydown', keys); return () => removeEventListener('keydown', keys); }, []);
  const close = () => { dlg.current?.close?.(); set({ palEdit: null }); };
  const cur = stops.find(s => s.k === sel);
  const patch = (k, p) => setEd(e => ({ ...e, stops: e.stops.map(s => (s.k === k ? { ...s, ...p } : s)) }));
  // remove the selected stop and select its neighbour, so Delete can be repeated
  const removeSel = () => setEd(e => {
    if (e.stops.length <= 2) return e;
    const order = sorted(e.stops), i = order.findIndex(s => s.k === e.sel);
    if (i < 0) return e;
    const rest = order.filter(s => s.k !== e.sel);
    return { stops: rest, sel: rest[Math.min(i, rest.length - 1)].k };
  });
  const track = useRef(null);
  // keep keyboard focus on the selected stop when the focused one was removed
  useEffect(() => { if (document.activeElement === document.body || !document.activeElement) track.current?.querySelector('.pe-stop.sel')?.focus(); }, [sel]);

  const posAt = e => { const r = bar.current.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 255); };
  // click on the bar adds a stop with the colour already there
  const addAt = e => {
    if (stops.length >= MAX_STOPS) return setErr(`A palette can have at most ${MAX_STOPS} stops.`);
    const pos = posAt(e);
    const c = paletteAt(sorted(stops).map(s => [s.pos, ...s.rgb]), pos);
    const s = mk(pos, (c >> 16) & 255, (c >> 8) & 255, c & 255);
    setEd(x => ({ stops: [...x.stops, s], sel: s.k })); setErr('');
  };
  const drag = s => e => {
    e.preventDefault(); e.stopPropagation(); setSel(s.k);
    const el = e.currentTarget; el.setPointerCapture(e.pointerId); el.focus();
    const mv = ev => patch(s.k, { pos: posAt(ev) });
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  // ←/→ nudge and Delete act on the selected stop wherever focus is (also while focus is
  // briefly on <body> after the focused stop was removed), except in text fields
  const keys = e => {
    if (e.target.closest?.('input, textarea, .cpick')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 16 : 1);
      setEd(x => ({ ...x, stops: x.stops.map(s => (s.k === x.sel ? { ...s, pos: Math.max(0, Math.min(255, s.pos + d)) } : s)) }));
    } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); }
  };

  const save = async () => {
    const n = name.trim(); if (!n) return setErr('Give the palette a name.');
    const out = sorted(stops).map(s => [s.pos, ...s.rgb]);
    // the firmware's gradient format needs entries at 0 and 255
    if (out[0][0] > 0) out.unshift([0, ...out[0].slice(1)]);
    if (out[out.length - 1][0] < 255) out.push([255, ...out[out.length - 1].slice(1)]);
    setBusy(true); setErr('');
    try {
      const id = await saveCustomPalette(init.idx, n, out);
      const seg = selSeg(getState()); if (seg) editSeg(seg.id, { pal: id }, { now: true });
      set({ toast: { label: `Saved palette “${n}”${seg ? ' and applied it' : ''}`, done: true } });
      close();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const del = async () => {
    setBusy(true);
    try { await deleteCustomPalette(init.idx); set({ toast: { label: `Deleted palette “${init.name}”`, done: true } }); close(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <dialog ref={dlg} class="modal pal-editor" aria-label="Palette editor" onClose={() => set({ palEdit: null })} onClick={e => { if (e.target === dlg.current) close(); }}>
      <header class="modal-head">
        <input class="pe-name" value={name} onInput={e => setName(e.currentTarget.value)} placeholder="Palette name" aria-label="Palette name" maxLength={32} spellcheck={false} />
        <IconButton icon="close" label="Close" onClick={close} />
      </header>
      <div class="pe-body">
        <div class="pe-gradient">
          <div ref={bar} class="pe-bar" style={{ background: css(stops) }} onPointerDown={addAt} title="Click to add a stop" />
          <div class="pe-track" ref={track}>
            {stops.map(s => (
              <button
                key={s.k} type="button" class={`pe-stop${s.k === sel ? ' sel' : ''}`} style={{ left: `${(s.pos / 255) * 100}%`, '--c': hex(s.rgb) }}
                aria-label={`Stop at ${s.pos}, ${hex(s.rgb)}`} aria-pressed={s.k === sel}
                onPointerDown={drag(s)} onFocus={() => setSel(s.k)}
              />
            ))}
          </div>
          <p class="muted pe-hint">Click the bar to add a stop · drag stops to move them · ←/→ nudge, Delete removes · {stops.length}/{MAX_STOPS} stops</p>
        </div>
        {cur && (
          <div class="pe-stopedit">
            <ColorPicker key={cur.k} rgb={cur.rgb} onChange={rgb => patch(cur.k, { rgb })} />
            <div class="pe-fields">
              <label class="field"><span>Colour</span>
                <HexField rgb={cur.rgb} onChange={rgb => patch(cur.k, { rgb })} />
              </label>
              <label class="field"><span>Position</span>
                <NumberField label="Stop position" value={cur.pos} max={255} onChange={v => patch(cur.k, { pos: v })} wide />
              </label>
              <Button icon="trash" onClick={removeSel} disabled={stops.length <= 2}>Remove stop</Button>
            </div>
          </div>
        )}
      </div>
      {err && <p class="pe-err" role="alert">{err}</p>}
      <footer class="modal-foot">
        {init.idx != null && <DeleteButton name={`palette ${init.name}`} onDelete={del} />}
        <span class="spacer" />
        <Button onClick={close}>Cancel</Button>
        <Button primary icon="save" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save and apply'}</Button>
      </footer>
    </dialog>
  );
}
