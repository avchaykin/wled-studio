// Base controls. Each owns its value while the user interacts with it.
import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import { render } from 'preact';
import { Icon } from './icons.jsx';
import { clampInt } from './lib.js';

// Slider row: label · track · numeric field. Arrow keys ±1 (shift ±10).
export function Slider({ label, value, min = 0, max = 255, onChange, unit, fmt }) {
  const [local, setLocal] = useState(value);
  const active = useRef(false);
  useEffect(() => { if (!active.current) setLocal(value); }, [value]);
  const commit = v => { v = clampInt(v, min, max); setLocal(v); onChange(v); };
  const pct = ((local - min) / (max - min)) * 100;
  return (
    <div class="slider">
      <span class="slider-label">{label}</span>
      <input
        type="range" min={min} max={max} value={local} aria-label={label} style={{ '--p': `${pct}%` }}
        onPointerDown={() => { active.current = true; }}
        onPointerUp={() => { active.current = false; }}
        onBlur={() => { active.current = false; }}
        onInput={e => commit(+e.currentTarget.value)}
      />
      <NumberField value={local} min={min} max={max} label={label} unit={unit} fmt={fmt} onChange={commit} />
    </div>
  );
}

// Numeric text field: type, Enter/blur to commit, ↑/↓ to step, drag vertically to scrub.
export function NumberField({ value, min = 0, max = 65535, onChange, label, unit, fmt, wide }) {
  const [text, setText] = useState(null);
  const shown = text ?? (fmt ? fmt(value) : String(value));
  const finish = () => { if (text !== null) { const n = parseFloat(text); if (!Number.isNaN(n)) onChange(clampInt(n, min, max)); setText(null); } };
  return (
    <span class={`numfield${wide ? ' wide' : ''}`}>
      <input
        value={shown} inputMode="numeric" aria-label={`${label} value`} spellcheck={false}
        onFocus={e => { setText(String(value)); requestAnimationFrame(() => e.currentTarget?.select()); }}
        onInput={e => setText(e.currentTarget.value)}
        onBlur={finish}
        onKeyDown={e => {
          if (e.key === 'Enter') { finish(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { setText(null); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const n = clampInt((text !== null ? parseFloat(text) : value) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), min, max);
            setText(String(n)); onChange(n);
          }
        }}
      />
      {unit && <span class="unit">{unit}</span>}
    </span>
  );
}

export function Switch({ label, checked, onChange, hideLabel }) {
  return (
    <label class="switch">
      <input type="checkbox" role="switch" checked={!!checked} onChange={e => onChange(e.currentTarget.checked)} aria-label={hideLabel ? label : undefined} />
      <span class="switch-track" aria-hidden="true" />
      {!hideLabel && <span>{label}</span>}
    </label>
  );
}

export function IconButton({ icon, label, onClick, pressed, kbd, disabled, tone }) {
  return (
    <button type="button" class={`iconbtn${tone ? ' ' + tone : ''}`} onClick={onClick} aria-label={label} aria-pressed={pressed} disabled={disabled}>
      <Icon name={icon} />
      <span class="tip" aria-hidden="true">{label}{kbd && <kbd class="kbd">{kbd}</kbd>}</span>
    </button>
  );
}

export function Button({ children, onClick, primary, type = 'button', disabled, icon }) {
  return (
    <button type={type} class={`btn${primary ? ' primary' : ''}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} />}{children}
    </button>
  );
}

export function Section({ title, children, actions }) {
  return (
    <section class="section">
      <header class="section-head"><h3>{title}</h3>{actions}</header>
      <div class="section-body">{children}</div>
    </section>
  );
}

// Minimal portal: renders children into a body-level host (keeps preact/compat out of the bundle).
function Portal({ children }) {
  const host = useRef(null);
  if (!host.current) { host.current = document.createElement('div'); document.body.appendChild(host.current); }
  useLayoutEffect(() => { render(children, host.current); });
  useEffect(() => () => { render(null, host.current); host.current.remove(); }, []);
  return null;
}

// Popover anchored to a trigger element; closes on outside pointer, Esc, or scroll of the anchor's panel.
export function Popover({ anchor, onClose, children, width = 280, label }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect(); const vw = innerWidth, vh = innerHeight;
    const w = Math.min(width, vw - 16);
    const h = ref.current?.offsetHeight ?? 300;
    let left = Math.min(Math.max(8, r.left), vw - w - 8);
    let top = r.bottom + 6; if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    setPos({ left, top, width: w });
  }, [anchor]);
  useEffect(() => {
    const down = e => { if (!ref.current?.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor.focus(); } };
    addEventListener('pointerdown', down, true); addEventListener('keydown', key, true);
    return () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); };
  }, [anchor]);
  return (
    <Portal>
      <div class="popover" ref={ref} role="dialog" aria-label={label} style={{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${pos.width ?? width}px` }}>{children}</div>
    </Portal>
  );
}

// Searchable list with keyboard navigation (used by pickers and the command palette).
export function SearchList({ items, onPick, placeholder, render, autoFocus = true, selectedKey, height = 320 }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const listRef = useRef(null), inputRef = useRef(null);
  // the autofocus attribute is ignored for elements inserted after load
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, []);
  const ql = q.trim().toLowerCase();
  const shown = ql ? items.filter(it => it.text.toLowerCase().includes(ql)).sort((a, b) => a.text.toLowerCase().indexOf(ql) - b.text.toLowerCase().indexOf(ql)) : items;
  useEffect(() => { const i = selectedKey == null ? 0 : shown.findIndex(it => it.key === selectedKey); setHi(Math.max(0, i)); }, [ql]);
  useEffect(() => { listRef.current?.children[hi]?.scrollIntoView({ block: 'nearest' }); }, [hi, ql]);
  return (
    <div class="searchlist">
      <div class="searchbox"><Icon name="search" />
        <input
          ref={inputRef} value={q} placeholder={placeholder} aria-label={placeholder} spellcheck={false}
          aria-activedescendant={shown[hi] ? `sl-${shown[hi].key}` : undefined} aria-controls="sl-list"
          onInput={e => setQ(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(shown.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
            else if (e.key === 'Enter' && shown[hi]) { e.preventDefault(); onPick(shown[hi], e); }
          }}
        />
      </div>
      <div class="searchlist-items" id="sl-list" role="listbox" ref={listRef} style={{ maxHeight: `${height}px` }}>
        {shown.length ? shown.map((it, i) => (
          <div
            key={it.key} id={`sl-${it.key}`} role="option" aria-selected={it.key === selectedKey}
            class={`sl-item${i === hi ? ' hi' : ''}`}
            onPointerMove={() => i !== hi && setHi(i)}
            onClick={e => onPick(it, e)}
          >{render ? render(it, it.key === selectedKey) : it.text}</div>
        )) : <div class="sl-empty">No match for “{q}”</div>}
      </div>
    </div>
  );
}

export function Kbd({ children }) { return <kbd class="kbd">{children}</kbd>; }
