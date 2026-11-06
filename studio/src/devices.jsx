// Devices: every WLED controller on the LAN in one table — state, look, version, updates,
// and copying presets between them.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, getState, set } from './store.js';
import { Button, IconButton, Switch } from './ui.jsx';
import { Icon } from './icons.jsx';
import { loadSaved, saveSaved, discover, probe, devJson, devPresets, copyPresets } from './devices.js';
import { fetchManifest, updateFor, updateDevice, studioVersion } from './update.js';

const REFRESH_MS = 15000;
const PHASE = { download: 'Downloading', upload: 'Uploading', reboot: 'Restarting', done: 'Updated' };

export function DevicesPage() {
  const selfInfo = useStore(d => d.info);
  const selfIp = selfInfo?.ip;
  const [devs, setDevs] = useState({}); // ip -> { ip, name, saved, found, self, st: 'loading'|'ok'|'off', state, info, effects, err, job }
  const [checked, setChecked] = useState(new Set());
  const [manifest, setManifest] = useState(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const saved = useRef([]);
  const patch = (ip, p) => setDevs(d => ({ ...d, [ip]: { ...d[ip], ...p } }));

  const refreshOne = async ip => {
    try { const r = await probe(ip); patch(ip, { st: 'ok', err: '', ...r, name: r.info.name }); }
    catch (e) { patch(ip, { st: 'off', err: e.message }); }
  };
  const reload = async () => {
    const [list, nodes] = await Promise.all([loadSaved(), discover()]);
    saved.current = list;
    setDevs(d => {
      const out = { ...d };
      const add = (ip, p) => { out[ip] = { ip, st: out[ip]?.st ?? 'loading', ...out[ip], ...p }; };
      if (selfIp) add(selfIp, { self: true, name: selfInfo.name });
      for (const n of nodes) if (n.ip) add(n.ip, { found: true, name: out[n.ip]?.name ?? n.name });
      for (const s of list) add(s.ip, { saved: true, name: out[s.ip]?.name ?? s.name });
      return out;
    });
  };
  useEffect(() => { reload(); fetchManifest().then(setManifest).catch(() => {}); }, [selfIp]);
  const ips = Object.keys(devs).sort((a, b) => (!!devs[b].self - !!devs[a].self) || (devs[a].name ?? a).localeCompare(devs[b].name ?? b));
  // probe new rows at once, all rows every REFRESH_MS (skipping rows that are updating)
  useEffect(() => { ips.filter(ip => devs[ip].st === 'loading' && !devs[ip].probing).forEach(ip => { patch(ip, { probing: true }); refreshOne(ip); }); }, [ips.join()]);
  useEffect(() => {
    const t = setInterval(() => { reload(); Object.values(devs).filter(d => !d.job).forEach(d => refreshOne(d.ip)); }, REFRESH_MS);
    return () => clearInterval(t);
  });

  const toggle = ip => setChecked(c => { const n = new Set(c); n.has(ip) ? n.delete(ip) : n.add(ip); return n; });
  const sel = ips.filter(ip => checked.has(ip));
  const rel = ip => (devs[ip].info ? updateFor(devs[ip].info, manifest) : null);
  const updatable = sel.filter(ip => rel(ip)?.newer && studioVersion(devs[ip].info) && !devs[ip].job);

  const addDevice = async (ip, name) => {
    const { info } = await probe(ip);
    const list = [...saved.current.filter(s => s.ip !== ip), { ip, name: name || info.name }];
    await saveSaved(list); saved.current = list;
    setDevs(d => ({ ...d, [ip]: { ip, saved: true, st: 'loading', name: name || info.name } }));
  };
  const removeDevice = async ip => {
    const list = saved.current.filter(s => s.ip !== ip);
    await saveSaved(list); saved.current = list;
    setDevs(d => { const n = { ...d }; if (n[ip].found || n[ip].self) n[ip] = { ...n[ip], saved: false }; else delete n[ip]; return n; });
  };
  // one at a time (they share one download); this device last, then reload the page
  const updateSelected = async () => {
    const order = [...updatable.filter(ip => !devs[ip].self), ...updatable.filter(ip => devs[ip].self)];
    for (const ip of order) {
      const r = rel(ip);
      try {
        await updateDevice(devs[ip].self ? '' : ip, r, step => patch(ip, { job: step }));
        patch(ip, { job: { phase: 'done' } });
        if (devs[ip].self) { setTimeout(() => location.reload(), 1500); return; }
        refreshOne(ip);
      } catch (e) { patch(ip, { job: { phase: 'error', msg: e.message } }); }
    }
  };

  return (
    <div class="page devices">
      <header class="page-head">
        <h2>Devices</h2><span class="muted">{ips.length} on this network</span>
        <AddDevice onAdd={addDevice} />
      </header>
      <div class={`bulkbar${sel.length ? ' on' : ''}`} role="toolbar" aria-label="Selected devices">
        <span>{sel.length ? `${sel.length} selected` : 'Select devices to update them or copy presets'}</span>
        <Button icon="upload" onClick={updateSelected} disabled={!updatable.length}>{updatable.length ? `Update ${updatable.length}` : 'Update'}</Button>
        <Button icon="presets" onClick={() => setCopyOpen(true)} disabled={!sel.length}>Copy presets…</Button>
        {sel.length > 0 && <button type="button" class="btn ghost" onClick={() => setChecked(new Set())}>Clear</button>}
      </div>
      <div class="table-wrap">
        <table class="table devtable">
          <thead><tr>
            <th class="chk"><input type="checkbox" aria-label="Select all" checked={sel.length === ips.length && ips.length > 0} onChange={e => setChecked(new Set(e.currentTarget.checked ? ips : []))} /></th>
            <th>Device</th><th>Firmware</th><th>Look</th><th>Power</th><th aria-label="Actions" />
          </tr></thead>
          <tbody>
            {ips.map(ip => <DeviceRow key={ip} d={devs[ip]} rel={rel(ip)} checked={checked.has(ip)} onCheck={() => toggle(ip)} onRemove={() => removeDevice(ip)} onChanged={() => refreshOne(ip)} />)}
          </tbody>
        </table>
      </div>
      {!ips.length && <p class="empty-note">Looking for devices…</p>}
      {copyOpen && <CopyPresets devs={devs} ips={ips} targets={sel} onClose={() => setCopyOpen(false)} />}
    </div>
  );
}

function AddDevice({ onAdd }) {
  const [ip, setIp] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault(); const v = ip.trim(); if (!v || busy) return;
    setBusy(true); setErr('');
    try { await onAdd(v, name.trim()); setIp(''); setName(''); }
    catch (x) { setErr(`${v}: ${x.message}`); }
    finally { setBusy(false); }
  };
  return (
    <form class="add-device" onSubmit={submit}>
      <input value={ip} onInput={e => setIp(e.currentTarget.value)} placeholder="IP address, e.g. 192.168.1.50" aria-label="Device IP address" spellcheck={false} />
      <input value={name} onInput={e => setName(e.currentTarget.value)} placeholder="Name (optional)" aria-label="Device name" maxLength={32} />
      <Button type="submit" icon="plus" disabled={!ip.trim() || busy}>{busy ? 'Checking…' : 'Add'}</Button>
      {err && <span class="error" role="alert">{err}</span>}
    </form>
  );
}

function DeviceRow({ d, rel, checked, onCheck, onRemove, onChanged }) {
  const [presets, setPresets] = useState(null);
  const send = async body => {
    try { await devJson(d.self ? '' : d.ip, '/json/state', { body }); onChanged(); }
    catch (e) { set({ toast: { label: `${d.name}: ${e.message}`, done: true } }); }
  };
  const st = d.state, info = d.info;
  const segs = (st?.seg ?? []).filter(s => s.stop > s.start);
  const fx = segs.find(s => s.id === st?.mainseg)?.fx ?? segs[0]?.fx;
  const fxNames = d.effects ? d.effects.map((n, i) => [i, n]).filter(([i, n]) => i === 0 || (n && n !== 'RSVD' && !n.startsWith('-'))).sort((a, b) => (a[0] === 0 ? -1 : b[0] === 0 ? 1 : a[1].localeCompare(b[1]))) : [];
  const sv = studioVersion(info);
  const loadPresets = () => presets || devPresets(d.self ? '' : d.ip).then(p => setPresets(Object.entries(p).filter(([k, v]) => +k > 0 && v?.n).map(([k, v]) => [+k, v.n]).sort((a, b) => a[1].localeCompare(b[1]))));
  const job = d.job;
  return (
    <tr class={d.st === 'off' ? 'offline' : ''}>
      <td class="chk"><input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${d.name ?? d.ip}`} /></td>
      <td>
        <div class="devname">
          <span class={`conn${d.st === 'ok' ? ' on' : ''}`} role="img" aria-label={d.st === 'ok' ? 'Online' : d.st === 'off' ? 'Offline' : 'Checking'} />
          <strong>{d.name ?? d.ip}</strong>
          {d.self && <span class="tag">This device</span>}
        </div>
        <div class="muted mono">{d.ip}{d.st === 'off' ? ` · ${d.err || 'offline'}` : info ? ` · ${info.leds?.count} LEDs` : ''}</div>
      </td>
      <td>
        {!info ? <span class="muted">—</span> : (
          <>
            <div>{sv ? `Studio ${sv}` : `WLED ${info.ver}`}{rel?.newer && sv && <span class="tag accent">{rel.version} available</span>}{rel && !rel.newer && <span class="tag ok">Latest</span>}</div>
            <div class="muted small-line">{sv ? `WLED ${info.ver}` : 'Not WLED Studio'}</div>
            {job && <div class={`jobline${job.phase === 'error' ? ' error' : ''}`} role="status">{job.phase === 'error' ? job.msg : `${PHASE[job.phase]}${job.p != null && (job.phase === 'download' || job.phase === 'upload') ? ` ${Math.round(job.p * 100)}%` : job.phase === 'done' ? '' : '…'}`}</div>}
          </>
        )}
      </td>
      <td class="look">
        {st && (
          <div class="look-in">
            <select aria-label={`Preset on ${d.name}`} value={st.ps > 0 ? st.ps : ''} onFocus={loadPresets} onPointerDown={loadPresets}
              onChange={e => e.currentTarget.value && send({ ps: +e.currentTarget.value })}>
              <option value="">{st.ps > 0 ? `Preset ${st.ps}` : 'Preset…'}</option>
              {(presets ?? []).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
            <select aria-label={`Effect on ${d.name}`} value={fx ?? ''} onChange={e => send({ seg: segs.map(s => ({ id: s.id, fx: +e.currentTarget.value, fxdef: true })) })}>
              {fxNames.length ? fxNames.map(([i, n]) => <option key={i} value={i}>{n}</option>) : <option value={fx}>{`Effect ${fx}`}</option>}
            </select>
          </div>
        )}
      </td>
      <td class="pwr">
        {st && (
          <>
            <Switch label={`${d.name} power`} hideLabel checked={st.on} onChange={on => send({ on })} />
            <Bri value={st.bri} label={`${d.name} brightness`} onCommit={bri => send({ bri })} />
          </>
        )}
      </td>
      <td class="right acts">
        <a class="iconbtn" href={`http://${d.ip}/`} target="_blank" rel="noopener" aria-label={`Open ${d.name} in a new tab`}><Icon name="external" /></a>
        {d.saved && !d.self && <IconButton icon="close" label={`Forget ${d.name}`} onClick={onRemove} />}
      </td>
    </tr>
  );
}

// brightness: follows the device unless being dragged; sends once on release
function Bri({ value, label, onCommit }) {
  const [v, setV] = useState(value); const drag = useRef(false);
  useEffect(() => { if (!drag.current) setV(value); }, [value]);
  return (
    <input type="range" min={1} max={255} value={v} aria-label={label} style={{ '--p': `${((v - 1) / 254) * 100}%` }}
      onPointerDown={() => { drag.current = true; }} onInput={e => setV(+e.currentTarget.value)}
      onChange={e => { drag.current = false; onCommit(+e.currentTarget.value); }} />
  );
}

function CopyPresets({ devs, ips, targets, onClose }) {
  const dlg = useRef(null);
  const online = ips.filter(ip => devs[ip].st === 'ok');
  const [src, setSrc] = useState(online.find(ip => devs[ip].self) ?? online[0]);
  const [list, setList] = useState(null);
  const [pick, setPick] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const dst = targets.filter(ip => ip !== src && devs[ip].st === 'ok');
  useEffect(() => { dlg.current?.showModal?.(); }, []);
  useEffect(() => {
    if (!src) return;
    setList(null); setRes(null);
    devPresets(devs[src].self ? '' : src).then(p => {
      const l = Object.entries(p).filter(([k, v]) => +k > 0 && v?.n).map(([k, v]) => [+k, v.n]).sort((a, b) => a[1].localeCompare(b[1]));
      setList(l); setPick(new Set(l.map(([k]) => k)));
    });
  }, [src]);
  const run = async () => {
    setBusy(true);
    setRes(await copyPresets(devs[src].self ? '' : src, [...pick], dst));
    setBusy(false);
  };
  const close = () => { dlg.current?.close?.(); onClose(); };
  return (
    <dialog ref={dlg} class="modal" aria-label="Copy presets" onClose={onClose} onClick={e => { if (e.target === dlg.current) close(); }}>
      <header class="modal-head"><h3 class="modal-title">Copy presets</h3><IconButton icon="close" label="Close" onClick={close} /></header>
      <div class="pe-body copy-body">
        <label class="field"><span>From</span>
          <select value={src} onChange={e => setSrc(e.currentTarget.value)}>{online.map(ip => <option key={ip} value={ip}>{devs[ip].name} ({ip})</option>)}</select>
        </label>
        <div class="field"><span>Presets</span>
          {list === null ? <p class="muted">Loading…</p> : !list.length ? <p class="muted">No presets on this device.</p> : (
            <div class="checklist">
              {list.map(([id, n]) => (
                <label key={id} class="check"><input type="checkbox" checked={pick.has(id)} onChange={() => setPick(s => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; })} />{n}</label>
              ))}
            </div>
          )}
        </div>
        <div class="field"><span>To</span>
          <p class="to-list">{dst.length ? dst.map(ip => devs[ip].name).join(', ') : 'Select target devices in the table first (online, other than the source).'}</p>
        </div>
        <p class="muted small">Presets with the same name are replaced. Effects are matched by name, and scripts the target lacks are copied along. Segments longer than a target strip are cut to fit.</p>
        {res && (
          <ul class="results">
            {res.map(r => <li key={r.ip} class={r.ok ? '' : 'error'}>{devs[r.ip]?.name ?? r.ip}: {r.ok ? `copied ${r.copied}${r.scripts.length ? ` · with script${r.scripts.length > 1 ? 's' : ''} ${r.scripts.join(', ')}` : ''}${r.missingFx.length ? ` · missing effects shown as Solid: ${r.missingFx.join(', ')}` : ''}` : r.error}</li>)}
          </ul>
        )}
      </div>
      <footer class="modal-foot">
        <span class="spacer" />
        <Button onClick={close}>{res ? 'Done' : 'Cancel'}</Button>
        <Button primary icon="presets" onClick={run} disabled={busy || !pick.size || !dst.length}>{busy ? 'Copying…' : `Copy ${pick.size} to ${dst.length} device${dst.length === 1 ? '' : 's'}`}</Button>
      </footer>
    </dialog>
  );
}
