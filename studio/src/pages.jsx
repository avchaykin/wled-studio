// Scripts and Settings pages.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, getState, selSeg, editSeg, getJson, postJson, getText, upload, set } from './store.js';
import { Button, IconButton, DeleteButton, Kbd } from './ui.jsx';
import { Icon } from './icons.jsx';
import { paletteStops, paletteAt } from './lib.js';
import { loadGlow } from './glow.js';
import { fetchManifest, updateFor, updateDevice, studioVersion } from './update.js';
import EXAMPLES from './examples.gen.js';

// ---------------------------------------------------------------- Scripts
const DRAFT = 'studio.glow.draft';
// argument part of a show handler (the type is shown as a tag)
const eventLabel = e => e.type === 'every' ? (e.arg >= 60000 ? `${e.arg / 60000} min` : `${e.arg / 1000} s`)
  : e.type === 'at' ? `${String(Math.floor(e.arg / 60)).padStart(2, '0')}:${String(e.arg % 60).padStart(2, '0')}`
  : e.type === 'button' ? `#${e.arg}` : '';
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'script';

export function ScriptsPage() {
  const slots = useStore(d => d.info?.glow?.slots);
  const shows = useStore(d => d.info?.glow?.shows);
  const running = useStore(d => d.info?.glow?.show);
  const [kind, setKind] = useState('effect');
  const [events, setEvents] = useState([]);
  const [src, setSrc] = useState(() => { try { return localStorage.getItem(DRAFT) || EXAMPLES[0].src; } catch { return EXAMPLES[0].src; } });
  const [file, setFile] = useState('');
  const [status, setStatus] = useState({ kind: '', msg: '' });
  const [errLine, setErrLine] = useState(null);
  const compiled = useRef(null), inst = useRef(null), t0 = useRef(0);
  const cv = useRef(null), gutter = useRef(null), ta = useRef(null);
  const [glow, setGlow] = useState(() => window.__glow ?? null);

  // the compiler + VM bundle loads on first visit to this page
  useEffect(() => {
    if (glow) return;
    setStatus({ kind: 'busy', msg: 'Loading the script engine…' });
    loadGlow().then(setGlow).catch(e => setStatus({ kind: 'error', msg: e.message }));
  }, []);

  // compile on edit (debounced)
  useEffect(() => {
    try { localStorage.setItem(DRAFT, src); } catch { /* */ }
    if (!glow) return;
    const { compile, loadImage, GlowInstance } = glow;
    const t = setTimeout(() => {
      try {
        const c = compile(src);
        compiled.current = c; t0.current = performance.now();
        inst.current = c.kind === 'effect' ? new GlowInstance(loadImage(c.image), 1) : null;
        setKind(c.kind); setEvents(c.events ?? []);
        setFile(f => f || slug(c.name));
        setStatus({ kind: 'ok', msg: c.kind === 'show'
          ? `${c.name} · show · ${c.events.length} handler${c.events.length === 1 ? '' : 's'} · ${c.image.length} bytes`
          : `${c.name} · ${c.image.length} bytes · ${c.controls.length} control${c.controls.length === 1 ? '' : 's'}${c.twoD ? ' · 2D' : ''}` });
        setErrLine(null);
      } catch (e) {
        compiled.current = null; inst.current = null;
        setStatus({ kind: 'error', msg: e.message }); setErrLine(e.line ?? null);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [src, glow]);

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
      try { glow.runFrame(i, host); } catch (e) { setStatus({ kind: 'error', msg: `Runtime: ${e.message}` }); inst.current = null; return; }
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
  }, [glow]);

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
  const run = async () => {
    if (kind === 'show') {
      if (!shows?.includes(file)) return setStatus({ kind: 'error', msg: 'Save the show to the device first.' });
      await postJson('/json/state', { glow: { show: running === file ? '' : file } });
      setStatus({ kind: 'ok', msg: running === file ? `Stopped ${file}.` : `Started ${file}.` });
      return setTimeout(refresh, 500);
    }
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
          <div class="editor-preview">
            <canvas ref={cv} class="preview-canvas" aria-label="Script preview" hidden={kind === 'show'} />
            {kind === 'show' && (
              <ul class="eventlist" aria-label="Show handlers">
                {events.map((e, i) => <li key={i}><span class="tag">{e.type}</span>{eventLabel(e)}</li>)}
              </ul>
            )}
          </div>
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
            <Button icon="play" onClick={run}>{kind === 'show' ? (running === file ? 'Stop show' : 'Start show') : 'Run on selected segment'}</Button>
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
                    <DeleteButton name={s.file} onDelete={async () => { await postJson('/json/state', { glow: { del: s.file } }); setTimeout(refresh, 500); }} />
                  </li>
                ))}
              </ul>
            )}
          {shows?.length > 0 && (
            <>
              <h3 class="spaced">Shows</h3>
              <ul class="filelist">
                {shows.map(name => (
                  <li key={name} class={name === file ? 'current' : ''}>
                    <button type="button" class="file" onClick={() => openFile(name)}><span class="mono">{name}</span>{running === name && <span class="tag accent">Running</span>}</button>
                    <IconButton icon={running === name ? 'close' : 'play'} label={running === name ? `Stop ${name}` : `Start ${name}`}
                      onClick={async () => { await postJson('/json/state', { glow: { show: running === name ? '' : name } }); setTimeout(refresh, 500); }} />
                    <DeleteButton name={name} onDelete={async () => { await postJson('/json/state', { glow: { del: name } }); setTimeout(refresh, 600); }} />
                  </li>
                ))}
              </ul>
            </>
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
  const rows = info ? [['WLED Studio', studioVersion(info) ?? '—'], ['WLED core', `${info.ver} (${info.release})`], ['Name', info.name], ['LEDs', info.leds?.count], ['Frame rate', `${info.leds?.fps ?? '—'} fps`],
    ['Free memory', `${Math.round((info.freeheap ?? 0) / 1024)} KB`], ['Wi-Fi signal', `${info.wifi?.signal ?? '—'}%`],
    ['Uptime', `${Math.floor((info.uptime ?? 0) / 3600)} h ${Math.floor(((info.uptime ?? 0) % 3600) / 60)} min`],
    ['Script engine', info.glow ? `v${info.glow.v} · ${info.glow.slots.length} loaded` : 'Not installed']] : [];
  return (
    <div class="page">
      <header class="page-head"><h2>Settings</h2></header>
      <div class="settings-grid">
        <div>
          <UpdateCard />
          <dl class="kv">{rows.map(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`}>{v ?? '—'}</dd>])}</dl>
        </div>
        <nav class="linklist" aria-label="Device settings">
          {LINKS.map(([href, label]) => <a key={href} href={href}>{label}<Icon name="chevron" /></a>)}
        </nav>
      </div>
    </div>
  );
}

// Checks the release list once per session (cached a few hours) and flags Settings in the rail.
export async function checkForUpdate(force = false) {
  const info = getState().info;
  try { const rel = updateFor(info, await fetchManifest(force)); set({ update: rel, updateErr: '' }); return rel; }
  catch (e) { set({ updateErr: e.message }); return null; }
}

const PHASE = { download: 'Downloading', upload: 'Sending to the device', reboot: 'Restarting', done: 'Updated' };
function UpdateCard() {
  const info = useStore(d => d.info);
  const rel = useStore(d => d.update);
  const err = useStore(d => d.updateErr);
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState(null); // { phase, p } while updating
  const [fail, setFail] = useState('');
  const cur = studioVersion(info);
  const check = async () => { setChecking(true); await checkForUpdate(true); setChecking(false); };
  const run = async () => {
    setFail(''); setStep({ phase: 'download', p: 0 });
    try { await updateDevice('', rel, setStep); setTimeout(() => location.reload(), 1200); }
    catch (e) { setFail(e.message); setStep(null); }
  };
  const busy = !!step && step.phase !== 'done';
  return (
    <section class="card update-card" aria-label="Firmware update">
      <header class="card-head">
        <h3>Firmware</h3>
        <button type="button" class="btn ghost" onClick={check} disabled={checking || busy}>{checking ? 'Checking…' : 'Check for updates'}</button>
      </header>
      <p class="update-line">
        <span>WLED Studio <strong>{cur ?? 'not installed'}</strong></span>
        {rel && !rel.newer && <span class="tag ok">Up to date</span>}
        {rel?.newer && <span class="tag accent">{rel.version} available</span>}
      </p>
      {err && !rel && <p class="muted">Could not check for updates: {err}</p>}
      {!err && !rel && info && <p class="muted">{checking ? 'Checking…' : `No published build for ${info.release} yet.`}</p>}
      {rel?.newer && (
        <>
          {rel.notes?.length > 0 && <ul class="notes">{rel.notes.map(n => <li key={n}>{n}</li>)}</ul>}
          {step ? (
            <div class="progress" role="status" aria-live="polite">
              <span>{PHASE[step.phase]}{step.p != null && step.phase !== 'reboot' && step.phase !== 'done' ? ` ${Math.round(step.p * 100)}%` : '…'}</span>
              <span class="bar"><span style={{ width: `${step.phase === 'download' ? step.p * 50 : step.phase === 'upload' ? 50 + step.p * 45 : 100}%` }} /></span>
            </div>
          ) : (
            <Button primary icon="upload" onClick={run}>Update to {rel.version}</Button>
          )}
          <p class="muted small">{busy ? 'Keep this page open. The lights restart once the update is written; settings, presets and scripts stay.' : `${(rel.build.size / 1048576).toFixed(1)} MB · released ${rel.date ?? ''}`}</p>
        </>
      )}
      {fail && <p class="error" role="alert">{fail}</p>}
    </section>
  );
}
