// Library: presets and palettes (effects are picked in the inspector).
import { useState, useRef } from 'preact/hooks';
import { useStore, selSeg, editSeg, set, command, presetList, savePreset, deletePreset, renamePreset } from './store.js';
import { IconButton, DeleteButton, Chips } from './ui.jsx';
import { Icon } from './icons.jsx';
import { paletteItems, FavStar } from './inspector.jsx';
import { paletteCss } from './lib.js';
import { editPalette } from './palette-editor.jsx';

const PAL_FILTERS = [['all', 'All'], ['fav', 'Favourites']];
const TABS = [['presets', 'Presets'], ['palettes', 'Palettes']];

export function Library() {
  const tab = useStore(d => d.libTab);
  const cat = useStore(d => d.cat);
  const seg = useStore(d => selSeg(d));
  const palFavs = useStore(d => d.palFavs);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const listRef = useRef(null);

  // ↑/↓ moves between rows, Enter/Space applies (native button behaviour)
  const onKey = e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = [...listRef.current.querySelectorAll('.lib-apply')];
    const i = btns.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  const tabs = (
    <div class="seg-tabs" role="tablist" aria-label="Library">
      {TABS.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} class="seg-tab" onClick={() => { set({ libTab: k }); setQ(''); setFilter('all'); }}>{label}</button>
      ))}
    </div>
  );
  if (tab !== 'palettes') return <PresetsPanel tabs={tabs} listRef={listRef} onKey={onKey} />;

  const ql = q.trim().toLowerCase();
  const rows = paletteItems(cat, palFavs).filter(it => (!ql || it.text.toLowerCase().includes(ql)) && (filter !== 'fav' || it.fav));
  const apply = it => seg && editSeg(seg.id, { pal: it.id }, { now: true });

  return (
    <section class="library" aria-label="Library">
      <div class="lib-bar">
        {tabs}
        <div class="searchbox compact"><Icon name="search" />
          <input value={q} placeholder="Filter palettes" aria-label="Filter palettes" spellcheck={false} onInput={e => setQ(e.currentTarget.value)} />
        </div>
        <Chips label="Palette filters" options={PAL_FILTERS} value={filter} onChange={setFilter} />
        {cat && (
          <button type="button" class="btn lib-new" title="Start from the selected segment's palette"
            onClick={() => editPalette({ name: `${paletteItems(cat, palFavs).find(it => it.id === seg?.pal)?.text?.replace(/^\* /, '') ?? 'New'} copy`, seed: cat.palx[seg?.pal ?? 0], cols: seg?.col })}>
            <Icon name="plus" />New palette
          </button>
        )}
      </div>
      <div class="lib-list palettes" ref={listRef} onKeyDown={onKey}>
        {rows.length ? rows.map(it => (
          <div key={it.key} class={`lib-row${it.id === seg?.pal ? ' current' : ''}`}>
            <button type="button" class="lib-apply" onClick={() => apply(it)} aria-current={it.id === seg?.pal ? 'true' : undefined}>
              <span class="swatchbar" style={{ background: paletteCss(cat.palx[it.id], seg?.col) }} />
              <span class="lib-name">{it.text}</span>
              {it.custom != null && <span class="tags"><span class="tag">Custom</span></span>}
            </button>
            {it.custom != null && (
              <span class="lib-actions">
                <IconButton icon="pencil" label={`Edit ${it.text}`} onClick={() => editPalette({ idx: it.custom, name: it.text, seed: cat.palx[it.id] })} />
              </span>
            )}
            <FavStar it={it} kind="palFavs" />
          </div>
        )) : (
          <p class="lib-empty">{!cat ? 'Loading palettes…' : filter === 'fav' && !ql ? 'Star palettes to list them here.' : `Nothing matches “${q}”.`}</p>
        )}
      </div>
    </section>
  );
}

// ----- presets: save the current look, apply, update, rename, delete -----
function PresetsPanel({ tabs, listRef, onKey }) {
  const presets = useStore(d => d.presets);
  const ps = useStore(d => d.state?.ps);
  const [name, setName] = useState('');
  const busy = useRef(false); // a ref, so a second Enter in the same frame is ignored too
  const [editing, setEditing] = useState(null); // preset id being renamed
  const list = presetList(presets);
  const taken = list.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
  const save = async e => {
    e.preventDefault();
    const n = name.trim(); if (!n || busy.current) return;
    busy.current = true; setName('');
    try { await savePreset(n, taken?.id); set({ toast: { label: taken ? `Updated “${n}”` : `Saved “${n}”`, done: true } }); }
    catch (err) { setName(n); set({ toast: { label: `Could not save: ${err.message}`, done: true } }); }
    finally { busy.current = false; }
  };
  const act = (fn, label) => fn().then(() => set({ toast: { label, done: true } })).catch(err => set({ toast: { label: err.message, done: true } }));
  return (
    <section class="library" aria-label="Library">
      <div class="lib-bar">
        {tabs}
        <form class="preset-save" onSubmit={save}>
          <input value={name} onInput={e => setName(e.currentTarget.value)} placeholder="Name the current look" aria-label="Preset name" maxLength={32} spellcheck={false} />
          <button type="submit" class="btn primary" disabled={!name.trim()}><Icon name="save" />{taken ? 'Update' : 'Save'}</button>
        </form>
        <span class="muted lib-note">{presets === null ? '' : `${list.length} preset${list.length === 1 ? '' : 's'}`}</span>
      </div>
      <div class="lib-list presets" ref={listRef} onKeyDown={onKey}>
        {presets === null ? <p class="lib-empty">Loading presets…</p> : !list.length ? (
          <p class="lib-empty">No presets yet. Set up a look, name it above and press Save.</p>
        ) : list.map(p => (
          <div key={p.id} class={`lib-row${ps === p.id ? ' current' : ''}`}>
            {editing === p.id ? (
              <input
                class="lib-rename" defaultValue={p.name} aria-label={`New name for ${p.name}`} maxLength={32} spellcheck={false}
                ref={el => el && requestAnimationFrame(() => { if (document.activeElement !== el) { el.focus(); el.select(); } })}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = p.name; e.currentTarget.blur(); } }}
                onBlur={e => { const v = e.currentTarget.value.trim(); setEditing(null); if (v && v !== p.name) act(() => renamePreset(p.id, v), `Renamed to “${v}”`); }}
              />
            ) : (
              <button type="button" class="lib-apply" onClick={() => command({ ps: p.id })} aria-current={ps === p.id ? 'true' : undefined} title={`Apply ${p.name}`}>
                <span class="lib-name">{p.name}</span>
                <span class="tags"><span class="tag">{p.playlist ? 'Playlist' : p.segs > 1 ? `${p.segs} segments` : `#${p.id}`}</span></span>
              </button>
            )}
            <span class="lib-actions">
              <IconButton icon="save" label={`Update ${p.name} with the current look`} onClick={() => act(() => savePreset(p.name, p.id), `Updated “${p.name}”`)} />
              <IconButton icon="pencil" label={`Rename ${p.name}`} onClick={() => setEditing(p.id)} />
              <DeleteButton name={p.name} onDelete={() => act(() => deletePreset(p.id), `Deleted “${p.name}”`)} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
