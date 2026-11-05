// ⌘K command palette: effects, palettes, presets, segments and actions in one list.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, set, getState, selSeg, editSeg, editTop, command, getJson, glowFx } from './store.js';
import { SearchList, Kbd } from './ui.jsx';
import { Icon } from './icons.jsx';
import { effectItems, FxTags } from './inspector.jsx';
import { paletteCss } from './lib.js';
import { splitSegment, deleteSegment } from './timeline.jsx';

export function CommandPalette() {
  const open = useStore(d => d.palette);
  const [presets, setPresets] = useState({});
  const dlg = useRef(null);
  useEffect(() => {
    if (!open) return;
    dlg.current?.showModal?.();
    getJson('/presets.json').then(setPresets).catch(() => {});
  }, [open]);
  if (!open) return null;

  const d = getState(); const seg = selSeg(d);
  const close = () => { dlg.current?.close?.(); set({ palette: false }); };
  const items = [
    { key: 'a-power', group: 'Action', text: d.state?.on ? 'Turn lights off' : 'Turn lights on', icon: 'power', kbd: 'P', run: () => editTop({ on: !d.state?.on }, { now: true }) },
    seg && { key: 'a-split', group: 'Action', text: 'Split selected segment in half', icon: 'split', run: () => splitSegment(seg, Math.floor((seg.start + seg.stop) / 2)) },
    seg && { key: 'a-del', group: 'Action', text: 'Delete selected segment', icon: 'trash', run: () => deleteSegment(seg) },
    { key: 'g-presets', group: 'Go to', text: 'Presets', icon: 'presets', run: () => { location.hash = 'presets'; } },
    { key: 'g-scripts', group: 'Go to', text: 'Scripts', icon: 'code', run: () => { location.hash = 'scripts'; } },
    { key: 'g-settings', group: 'Go to', text: 'Settings', icon: 'settings', run: () => { location.hash = 'settings'; } },
    ...(d.state?.seg ?? []).filter(s => s.stop > s.start).map(s => ({ key: `s-${s.id}`, group: 'Segment', text: `Select ${s.n || `segment ${s.id}`}`, icon: 'grid', run: () => set({ sel: s.id }) })),
    ...Object.entries(presets).filter(([id, p]) => +id > 0 && p?.n).map(([id, p]) => ({ key: `p-${id}`, group: 'Preset', text: p.n, icon: 'presets', run: () => command({ ps: +id }) })),
    ...(seg ? effectItems(d.cat, glowFx(d), d.favs).map(it => ({ ...it, key: `e-${it.id}`, group: 'Effect', run: () => editSeg(seg.id, { fx: it.id, fxdef: true }, { now: true }) })) : []),
    ...(seg ? (d.cat?.palettes ?? []).map((text, id) => ({ key: `l-${id}`, id, group: 'Palette', text, run: () => editSeg(seg.id, { pal: id }, { now: true }) })) : []),
  ].filter(Boolean);

  return (
    <dialog ref={dlg} class="cmdk" aria-label="Command palette" onClose={() => set({ palette: false })} onClick={e => { if (e.target === dlg.current) close(); }}>
      <SearchList
        placeholder="Type an effect, palette, preset or action…" items={items} height={380}
        render={it => (
          <>
            <span class="cmd-group">{it.group}</span>
            {it.group === 'Palette'
              ? <span class="swatchbar" style={{ background: paletteCss(d.cat.palx[it.id], seg?.col) }} />
              : it.icon ? <Icon name={it.icon} /> : null}
            <span class="sl-text">{it.text}</span>
            {it.m && <FxTags it={it} />}
            {it.kbd && <Kbd>{it.kbd}</Kbd>}
          </>
        )}
        onPick={it => { close(); it.run(); }}
      />
      <footer class="cmdk-foot"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> apply</span><span><Kbd>esc</Kbd> close</span></footer>
    </dialog>
  );
}
