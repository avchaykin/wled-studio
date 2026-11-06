// Library: presets, effects and palettes for the selected segment.
import { useState, useRef } from 'preact/hooks';
import { useStore, selSeg, editSeg, set, persist, glowFx, command, presetList, savePreset, deletePreset, renamePreset } from './store.js';
import { IconButton, DeleteButton } from './ui.jsx';
import { Icon } from './icons.jsx';
import { effectItems, FxTags } from './inspector.jsx';
import { paletteCss } from './lib.js';

const FILTERS = [['all', 'All'], ['fav', 'Favourites'], ['glow', 'Scripts'], ['audio', 'Audio'], ['2d', '2D']];
const TABS = [['presets', 'Presets'], ['effects', 'Effects'], ['palettes', 'Palettes']];

export function Library() {
  const tab = useStore(d => d.libTab);
  const cat = useStore(d => d.cat);
  const seg = useStore(d => selSeg(d));
  const favs = useStore(d => d.favs);
  useStore(d => d.info?.glow?.slots?.length ?? 0);
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
        <button key={k} type="button" role="tab" aria-selected={tab === k} class="seg-tab" onClick={() => { set({ libTab: k }); setQ(''); }}>{label}</button>
      ))}
    </div>
  );
  if (tab === 'presets') return <PresetsPanel tabs={tabs} listRef={listRef} onKey={onKey} />;

  const ql = q.trim().toLowerCase();
  let rows;
  if (tab === 'effects') {
    rows = effectItems(cat, glowFx(), favs).filter(it => (!ql || it.text.toLowerCase().includes(ql)) && (filter === 'all'
      || (filter === 'fav' && it.fav) || (filter === 'glow' && it.glow) || (filter === 'audio' && it.m.audio) || (filter === '2d' && it.m.twoD)));
  } else {
    rows = (cat?.palettes ?? []).map((text, id) => ({ key: id, id, text })).filter(it => !ql || it.text.toLowerCase().includes(ql));
  }
  const current = tab === 'effects' ? seg?.fx : seg?.pal;
  const apply = it => seg && editSeg(seg.id, tab === 'effects' ? { fx: it.id, fxdef: true } : { pal: it.id }, { now: true });
  const toggleFav = id => { const f = favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id]; persist('studio.favs', f); set({ favs: f }); };

  return (
    <section class="library" aria-label="Library">
      <div class="lib-bar">
        {tabs}
        <div class="searchbox compact"><Icon name="search" />
          <input value={q} placeholder={tab === 'effects' ? 'Filter effects' : 'Filter palettes'} aria-label="Filter" spellcheck={false} onInput={e => setQ(e.currentTarget.value)} />
        </div>
        {tab === 'effects' && (
          <div class="filters" role="group" aria-label="Effect filters">
            {FILTERS.map(([k, label]) => <button key={k} type="button" class="filter" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
          </div>
        )}
      </div>
      <div class={`lib-list ${tab}`} ref={listRef} onKeyDown={onKey}>
        {rows.length ? rows.map(it => (
          <div key={it.key} class={`lib-row${it.id === current ? ' current' : ''}`}>
            <button type="button" class="lib-apply" onClick={() => apply(it)} aria-current={it.id === current ? 'true' : undefined}>
              {tab === 'palettes' && <span class="swatchbar" style={{ background: paletteCss(cat.palx[it.id], seg?.col) }} />}
              <span class="lib-name">{it.text}</span>
              {tab === 'effects' && <FxTags it={it} />}
            </button>
            {tab === 'effects' && (
              <button type="button" class={`fav${it.fav ? ' on' : ''}`} aria-pressed={it.fav} aria-label={it.fav ? `Remove ${it.text} from favourites` : `Add ${it.text} to favourites`} onClick={() => toggleFav(it.id)}>
                <Icon name="star" fill={it.fav} />
              </button>
            )}
          </div>
        )) : !cat ? (
          <p class="lib-empty">Loading {tab}…</p>
        ) : (
          <p class="lib-empty">{filter === 'fav' && !ql ? 'Star effects to pin them here and to the top of every list.' : filter === 'glow' && !ql ? 'No scripts on this device yet. Write one in Scripts.' : `Nothing matches “${q}”.`}</p>
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
