// Presets, Scripts and Settings pages.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, getState, selSeg, command, editSeg, getJson, postJson, getText, upload, set } from './store.js';
import { Button, IconButton, Kbd } from './ui.jsx';
import { Icon } from './icons.jsx';
import { paletteStops, paletteAt } from './lib.js';
import { compile } from '../../glow/compiler.mjs';
import { loadImage, GlowInstance, runFrame } from '../../glow/vm.mjs';
import EXAMPLES from './examples.gen.js';

// ---------------------------------------------------------------- Presets
export function PresetsPage() {
  const ps = useStore(d => d.state?.ps);
  const [presets, setPresets] = useState(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const load = () => getJson('/presets.json').then(p => { setPresets(p); setErr(''); }).catch(e => { setErr(e.message); setPresets({}); });
  useEffect(() => { load(); }, []);
  const list = Object.entries(presets ?? {}).filter(([id, p]) => +id > 0 && p && p.n !== undefined)
    .map(([id, p]) => ({ id: +id, name: p.n || `Preset ${id}`, playlist: !!p.playlist, segs: (p.seg ?? []).filter(s => (s.stop ?? 1) > (s.start ?? 0)).length }))
    .sort((a, b) => a.id - b.id);
  const save = async e => {
    e.preventDefault();
    const n = name.trim(); if (!n) return;
    let id = 1; while (presets?.[id]) id++;
    await postJson('/json/state', { psave: id, n, ib: true, sb: true });
    setName(''); setTimeout(load, 400);
  };
  return (
    <div class="page">
      <header class="page-head"><h2>Presets</h2><span class="muted">{list.length} saved</span></header>
      {err && <p class="error">Could not load presets: {err}</p>}
      <form class="inline-form" onSubmit={save}>
        <input value={name} onInput={e => setName(e.currentTarget.value)} placeholder="Name for the current look" aria-label="Preset name" maxLength={32} />
        <Button type="submit" primary icon="plus" disabled={!name.trim()}>Save current</Button>
      </form>
      {presets === null ? <p class="muted">Loading…</p> : list.length ? (
        <table class="table">
          <thead><tr><th class="num">ID</th><th>Name</th><th>Type</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id} class={ps === p.id ? 'current' : ''}>
                <td class="num">{p.id}</td>
                <td>{p.name}</td>
                <td class="muted">{p.playlist ? 'Playlist' : p.segs ? `${p.segs} segment${p.segs > 1 ? 's' : ''}` : 'State'}</td>
                <td class="right"><Button onClick={() => command({ ps: p.id })} icon="play">{ps === p.id ? 'Active' : 'Apply'}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p class="empty-note">No presets yet. Set up a look on Lights, then name it above to save it.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Scripts
const DRAFT = 'studio.glow.draft';
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'script';

export function ScriptsPage() {
  const slots = useStore(d => d.info?.glow?.slots);
  const [src, setSrc] = useState(() => { try { return localStorage.getItem(DRAFT) || EXAMPLES[0].src; } catch { return EXAMPLES[0].src; } });
  const [file, setFile] = useState('');
  const [status, setStatus] = useState({ kind: '', msg: '' });
  const [errLine, setErrLine] = useState(null);
  const compiled = useRef(null), inst = useRef(null), t0 = useRef(0);
  const cv = useRef(null), gutter = useRef(null), ta = useRef(null);

  // compile on edit (debounced)
  useEffect(() => {
    try { localStorage.setItem(DRAFT, src); } catch { /* */ }
    const t = setTimeout(() => {
      try {
        const c = compile(src);
        compiled.current = c; inst.current = new GlowInstance(loadImage(c.image), 1); t0.current = performance.now();
        setFile(f => f || slug(c.name));
        setStatus({ kind: 'ok', msg: `${c.name} · ${c.image.length} bytes · ${c.controls.length} control${c.controls.length === 1 ? '' : 's'}${c.twoD ? ' · 2D' : ''}` });
        setErrLine(null);
      } catch (e) {
        compiled.current = null; inst.current = null;
        setStatus({ kind: 'error', msg: e.message }); setErrLine(e.line ?? null);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [src]);

  // preview loop using the selected segment's length, colours and palette
  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = compiled.current, i = inst.current, canvas = cv.current;
      if (!c || !i || !canvas) return;
      const d = getState(); const s = selSeg(d);
      const w = c.twoD ? 16 : Math.max(8, Math.min(600, s ? s.stop - s.start : 60)), h = c.twoD ? 16 : 1;
      if (!i.pixels || i.pixels.length !== w * h) i.pixels = new Uint32Array(w * h);
      const stops = paletteStops(d.cat?.palx?.[s?.pal ?? 0], s?.col);
      const host = {
        len: w * h, w, h, t: performance.now() - t0.current, pixels: i.pixels,
        controls: c.controls.reduce((a, k) => { a[k.slot] = k.ctl === 'toggle' ? (k.def ? 1 : 0) : k.def; return a; }, [128, 128, 128, 128, 128, 0, 0, 0]),
        colors: (s?.col ?? [[255, 160, 0], [0, 0, 0], [0, 0, 0]]).map(x => (((x[3] ?? 0) << 24) | (x[0] << 16) | (x[1] << 8) | x[2]) >>> 0),
        palette: k => paletteAt(stops, k), audio: { vol: 0, bands: new Array(16).fill(0) },
      };
      try { runFrame(i, host); } catch (e) { setStatus({ kind: 'error', msg: `Runtime: ${e.message}` }); inst.current = null; return; }
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const ctx = canvas.getContext('2d'); const img = ctx.createImageData(w, h);
      for (let k = 0; k < w * h; k++) {
        const p = i.pixels[k], wc = (p >>> 24) & 255;
        img.data[k * 4] = Math.min(255, ((p >>> 16) & 255) + wc); img.data[k * 4 + 1] = Math.min(255, ((p >>> 8) & 255) + wc);
        img.data[k * 4 + 2] = Math.min(255, (p & 255) + wc); img.data[k * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const lines = src.split('\n').length;
  const save = async () => {
    const c = compiled.current;
    if (!c) return setStatus({ kind: 'error', msg: 'Fix the errors above before saving.' });
    if (!/^[a-z0-9_-]{1,32}$/.test(file)) return setStatus({ kind: 'error', msg: 'File name: lowercase letters, digits, - and _ (max 32).' });
    if (!getState().info?.glow) return setStatus({ kind: 'error', msg: 'This firmware has no script engine. Flash WLED Studio firmware first.' });
    setStatus({ kind: 'busy', msg: 'Uploading…' });
    try {
      await upload(`/glow/${file}.glow`, src, 'text/plain');
      await upload(`/glow/${file}.glw`, c.image);
      await postJson('/json/state', { glow: { reload: true } });
      setStatus({ kind: 'ok', msg: `Saved “${c.name}” as ${file}.` });
      setTimeout(refresh, 700);
    } catch (e) { setStatus({ kind: 'error', msg: e.message }); }
  };
  const refresh = () => getJson('/json/info').then(info => set({ info })).catch(() => {});
  const run = () => {
    const slot = getState().info?.glow?.slots?.find(x => x.file === file); const s = selSeg();
    if (!slot) return setStatus({ kind: 'error', msg: 'Save the script to the device first.' });
    if (s) editSeg(s.id, { fx: slot.fx, fxdef: true }, { now: true });
    setStatus({ kind: 'ok', msg: `Running ${file} on ${s?.n || `segment ${s?.id}`}.` });
  };
  const openFile = async name => {
    try { setSrc(await getText(`/glow/${name}.glow`)); setFile(name); } catch (e) { setStatus({ kind: 'error', msg: e.message }); }
  };

  return (
    <div class="page scripts">
      <header class="page-head">
        <h2>Scripts</h2>
        <select aria-label="Open an example" value="" onChange={e => { const ex = EXAMPLES[+e.currentTarget.value]; if (ex) { setSrc(ex.src); setFile(ex.file); } }}>
          <option value="">Open example…</option>
          {EXAMPLES.map((ex, i) => <option key={ex.file} value={i}>{ex.name}</option>)}
        </select>
        <a class="btn ghost" href="https://github.com/avchaykin/wled-studio/blob/main/docs/design/glow-language.md" target="_blank" rel="noopener">Language guide <Icon name="external" /></a>
      </header>
      <div class="scripts-grid">
        <div class="editor">
          <div class="editor-preview"><canvas ref={cv} class="preview-canvas" aria-label="Script preview" /></div>
          <div class="editor-body">
            <div class="gutter" ref={gutter} aria-hidden="true">
              {Array.from({ length: lines }, (_, i) => <div key={i} class={i + 1 === errLine ? 'err' : ''}>{i + 1}</div>)}
            </div>
            <textarea
              ref={ta} class="code" value={src} spellcheck={false} autocapitalize="off" autocomplete="off" wrap="off" aria-label="Glow source"
              onInput={e => setSrc(e.currentTarget.value)}
              onScroll={e => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
              onKeyDown={e => {
                if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
                if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
              }}
            />
          </div>
          <div class={`status ${status.kind}`} role="status" aria-live="polite">{status.msg}</div>
          <div class="editor-actions">
            <label class="field inline"><span>File</span>
              <input class="mono" value={file} onInput={e => setFile(e.currentTarget.value)} aria-label="File name on device" maxLength={32} spellcheck={false} />
            </label>
            <Button primary icon="upload" onClick={save}>Save to device <Kbd>{navigator.platform.includes('Mac') ? '⌘S' : 'Ctrl S'}</Kbd></Button>
            <Button icon="play" onClick={run}>Run on selected segment</Button>
          </div>
        </div>
        <aside class="devscripts" aria-label="Scripts on this device">
          <h3>On this device</h3>
          {slots === undefined ? <p class="muted">This firmware has no script engine. Scripts can still be written and previewed here.</p>
            : !slots.length ? <p class="muted">No scripts yet. Save one to see it here and in the effect list.</p>
            : (
              <ul class="filelist">
                {slots.map(s => (
                  <li key={s.file} class={s.file === file ? 'current' : ''}>
                    <button type="button" class="file" onClick={() => openFile(s.file)}><span class="mono">{s.file}</span><span class="muted">#{s.fx}</span></button>
                    {s.err && <span class="tag danger" title={s.err}>Error</span>}
                    <IconButton icon="trash" label={`Delete ${s.file}`} tone="danger" onClick={async () => { await postJson('/json/state', { glow: { del: s.file } }); setTimeout(refresh, 500); }} />
                  </li>
                ))}
              </ul>
            )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Settings
const LINKS = [['/settings/wifi', 'Wi-Fi'], ['/settings/leds', 'LED hardware'], ['/settings/ui', 'Interface'], ['/settings/sync', 'Sync & integrations'],
  ['/settings/time', 'Time & macros'], ['/settings/sec', 'Security & updates'], ['/settings/um', 'Usermods'], ['/edit', 'File editor'], ['/legacy', 'Classic WLED interface']];

export function SettingsPage() {
  const info = useStore(d => d.info);
  const rows = info ? [['Firmware', info.ver], ['Name', info.name], ['LEDs', info.leds?.count], ['Frame rate', `${info.leds?.fps ?? '—'} fps`],
    ['Free memory', `${Math.round((info.freeheap ?? 0) / 1024)} KB`], ['Wi-Fi signal', `${info.wifi?.signal ?? '—'}%`],
    ['Uptime', `${Math.floor((info.uptime ?? 0) / 3600)} h ${Math.floor(((info.uptime ?? 0) % 3600) / 60)} min`],
    ['Script engine', info.glow ? `v${info.glow.v} · ${info.glow.slots.length} loaded` : 'Not installed']] : [];
  return (
    <div class="page">
      <header class="page-head"><h2>Settings</h2></header>
      <div class="settings-grid">
        <dl class="kv">{rows.map(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`}>{v ?? '—'}</dd>])}</dl>
        <nav class="linklist" aria-label="Device settings">
          {LINKS.map(([href, label]) => <a key={href} href={href}>{label}<Icon name="chevron" /></a>)}
        </nav>
      </div>
    </div>
  );
}
