// WLED Studio — app shell, navigation and keyboard shortcuts.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore, set, getState, selSeg, editTop, boot } from './store.js';
import { Slider, IconButton, Kbd } from './ui.jsx';
import { Icon } from './icons.jsx';
import { Timeline, hover, splitSegment, deleteSegment, undo } from './timeline.jsx';
import { Inspector } from './inspector.jsx';
import { Library } from './library.jsx';
import { CommandPalette } from './command.jsx';
import { PaletteEditor } from './palette-editor.jsx';
import { ScriptsPage, SettingsPage, checkForUpdate } from './pages.jsx';
import { isMac } from './lib.js';

const PAGES = [['lights', 'Lights', 'lights'], ['scripts', 'Scripts', 'code'], ['settings', 'Settings', 'settings']];

function TopBar() {
  const { name, online, on, bri, ip } = useStore(d => ({ name: d.info?.name, online: d.online, on: d.state?.on, bri: d.state?.bri, ip: d.info?.ip }));
  return (
    <header class="topbar">
      <div class="device" title={ip ? `${name} · ${ip}` : name}>
        <span class={`conn${online ? ' on' : ''}`} role="img" aria-label={online ? 'Connected' : 'Reconnecting'} />
        <span class="device-name">{name ?? 'WLED'}</span>
        {ip && <span class="device-ip">{ip}</span>}
      </div>
      <div class="topbar-right">
        <button type="button" class="cmdk-trigger" onClick={() => set({ palette: true })} aria-label="Open command palette">
          <Icon name="search" /><span>Search or run</span><Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
        </button>
        {bri != null && <div class="master"><Slider label="Brightness" value={bri} min={1} onChange={v => editTop({ bri: v })} fmt={v => `${Math.round(v / 2.55)}`} unit="%" /></div>}
        <button type="button" class={`power${on ? ' on' : ''}`} aria-pressed={!!on} aria-label={on ? 'Turn lights off' : 'Turn lights on'} title={`${on ? 'Turn off' : 'Turn on'} (P)`} onClick={() => editTop({ on: !on }, { now: true })}>
          <Icon name="power" />
        </button>
      </div>
    </header>
  );
}

function Rail({ page }) {
  const upd = useStore(d => !!d.update?.newer);
  return (
    <nav class="rail" aria-label="Sections">
      {PAGES.map(([k, label, icon]) => (
        <a key={k} href={`#${k}`} class="rail-item" aria-current={page === k ? 'page' : undefined} title={label}>
          <Icon name={icon} size={18} /><span>{label}</span>
          {k === 'settings' && upd && <span class="rail-badge" role="img" aria-label="Update available" />}
        </a>
      ))}
    </nav>
  );
}

function Lights() {
  return (
    <div class="lights">
      <div class="workarea">
        <Timeline />
        <Library />
      </div>
      <Inspector />
    </div>
  );
}

function App() {
  const page = useStore(d => d.page);
  const [error, setError] = useState('');
  useEffect(() => {
    const fromHash = () => {
      const k = location.hash.slice(1);
      if (k === 'presets') { set({ libTab: 'presets' }); history.replaceState(null, '', '#lights'); }
      set({ page: PAGES.some(p => p[0] === k) ? k : 'lights' });
    };
    addEventListener('hashchange', fromHash); fromHash();
    boot().then(() => checkForUpdate()).catch(e => setError(e.message));
    addEventListener('keydown', shortcuts);
    return () => { removeEventListener('hashchange', fromHash); removeEventListener('keydown', shortcuts); };
  }, []);
  return (
    <div class="app">
      <TopBar />
      <Rail page={page} />
      <main class="main" id="main">
        {error && <div class="banner error" role="alert">Can't reach the device: {error}. Retrying in the background.</div>}
        {page === 'lights' && <Lights />}
        {page === 'scripts' && <ScriptsPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
      <CommandPalette />
      <PaletteEditor />
      <Toast />
    </div>
  );
}

function Toast() {
  const t = useStore(d => d.toast);
  useEffect(() => { if (!t) return; const id = setTimeout(() => set({ toast: null }), 6000); return () => clearTimeout(id); }, [t]);
  if (!t) return null;
  return (
    <div class="toast" role="status" aria-live="polite">
      <span>{t.label}</span>
      {!t.done && <button type="button" class="btn" onClick={() => undo()}>Undo <Kbd>{isMac ? '⌘Z' : 'Ctrl Z'}</Kbd></button>}
    </div>
  );
}

function shortcuts(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); set({ palette: !getState().palette }); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.target.closest?.('input, textarea') && !document.querySelector('dialog[open]')) { if (undo()) e.preventDefault(); return; }
  const t = e.target;
  // nothing reaches the page behind an open modal (palette editor, command palette)
  if (mod || e.altKey || getState().palette || document.querySelector('dialog[open]') || t.closest?.('input, textarea, select, [contenteditable], dialog')) return;
  const d = getState(); const segs = (d.state?.seg ?? []).filter(s => s.stop > s.start); const seg = selSeg(d);
  const i = segs.findIndex(s => s.id === seg?.id);
  switch (e.key) {
    case '[': if (segs.length) set({ sel: segs[(i - 1 + segs.length) % segs.length].id }); break;
    case ']': if (segs.length) set({ sel: segs[(i + 1) % segs.length].id }); break;
    case 's': case 'S': {
      if (d.page !== 'lights' || !seg) return;
      const at = hover.led;
      const target = at != null ? segs.find(s => at > s.start && at < s.stop) : seg;
      if (target) splitSegment(target, at != null ? at : Math.floor((target.start + target.stop) / 2));
      break;
    }
    case 'Backspace': case 'Delete': if (d.page === 'lights' && seg) deleteSegment(seg); break;
    case 'p': case 'P': editTop({ on: !d.state?.on }, { now: true }); break;
    case '1': case '2': case '3': location.hash = PAGES[+e.key - 1][0]; break;
    default: return;
  }
  e.preventDefault();
}

render(<App />, document.getElementById('app'));
