// Library: browse effects and palettes, apply to the selected segment.
import { useState, useRef } from 'preact/hooks';
import { useStore, selSeg, editSeg, set, persist, glowFx } from './store.js';
import { Icon } from './icons.jsx';
import { effectItems, FxTags } from './inspector.jsx';
import { paletteCss } from './lib.js';

const FILTERS = [['all', 'All'], ['fav', 'Favourites'], ['glow', 'Scripts'], ['audio', 'Audio'], ['2d', '2D']];

export function Library() {
  const tab = useStore(d => d.libTab);
  const cat = useStore(d => d.cat);
  const seg = useStore(d => selSeg(d));
  const favs = useStore(d => d.favs);
  useStore(d => d.info?.glow?.slots?.length ?? 0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const listRef = useRef(null);

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

  // ↑/↓ moves between rows, Enter/Space applies (native button behaviour)
  const onKey = e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = [...listRef.current.querySelectorAll('.lib-apply')];
    const i = btns.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  return (
    <section class="library" aria-label="Library">
      <div class="lib-bar">
        <div class="seg-tabs" role="tablist" aria-label="Library">
          {[['effects', 'Effects'], ['palettes', 'Palettes']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} class="seg-tab" onClick={() => { set({ libTab: k }); setQ(''); }}>{label}</button>
          ))}
        </div>
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

