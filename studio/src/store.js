// App state + device sync.
//
// Lag rules (PRODUCT.md principle 1, "input is sacred"):
//  - every edit is applied locally first and rendered on the same frame;
//  - outgoing changes are merged and flushed at most once per animation frame;
//  - a field the user touched keeps its local value for GUARD_MS, so WebSocket
//    echoes of older values can never move a control under the user's finger.
import { useEffect, useState, useRef } from 'preact/hooks';

const GUARD_MS = 800;

let data = {
  state: null, info: null, cat: null, online: false,
  sel: 0, page: 'lights', libTab: 'presets',
  presets: null,            // /presets.json, null until loaded
  customPals: [],           // [{ idx, id, name, stops }] from /palette<idx>.json
  favs: load('studio.favs', []),        // effect ids
  palFavs: load('studio.palfavs', []),  // palette ids
  palette: false,           // command palette open
};
const subs = new Set();
const guards = new Map();   // "seg.<id>.<key>" | "<key>" -> timestamp

export function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
export function persist(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }

export const getState = () => data;
// star / unstar an effect ('favs') or palette ('palFavs'); kept per browser
export function toggleFav(kind, id) {
  const cur = data[kind]; const f = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
  persist(kind === 'favs' ? 'studio.favs' : 'studio.palfavs', f); set({ [kind]: f });
}
export function set(patch) { data = { ...data, ...patch }; subs.forEach(fn => fn()); }

// Subscribe a component to a slice; re-renders only when the selected value changes (shallow).
export function useStore(sel) {
  const [, force] = useState(0);
  const selRef = useRef(sel); selRef.current = sel;
  const last = useRef(sel(data));
  last.current = sel(data);
  useEffect(() => {
    const fn = () => {
      const next = selRef.current(data);
      if (!shallowEq(next, last.current)) { last.current = next; force(n => n + 1); }
    };
    subs.add(fn); return () => subs.delete(fn);
  }, []);
  return last.current;
}
function shallowEq(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a); if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => Object.is(a[k], b[k]));
}

// ---------- selectors ----------
export const selSeg = (d = data) => d.state?.seg?.find(s => s.id === d.sel) ?? d.state?.seg?.[0];
export const glowFx = (d = data) => new Set((d.info?.glow?.slots ?? []).map(s => s.fx));

// ---------- local edits ----------
export function editSeg(id, patch, { now = false } = {}) {
  const st = data.state; if (!st) return;
  const t = performance.now();
  for (const k of Object.keys(patch)) guards.set(`seg.${id}.${k}`, t);
  set({ state: { ...st, seg: st.seg.map(s => (s.id === id ? { ...s, ...patch } : s)) } });
  queue({ seg: [{ id, ...patch }] }, now);
}
export function editTop(patch, { now = false } = {}) {
  const st = data.state; if (!st) return;
  const t = performance.now();
  for (const k of Object.keys(patch)) guards.set(k, t);
  set({ state: { ...st, ...patch } });
  queue(patch, now);
}
// structural changes (split, merge, delete, presets): no optimistic merge, device answers
export function command(obj) { queue(obj, true); }

// incoming device state, minus fields the user is touching
function applyRemote(remote) {
  const t = performance.now();
  const fresh = k => t - (guards.get(k) ?? -1e9) < GUARD_MS;
  const local = data.state;
  if (local) {
    for (const k of Object.keys(remote)) if (k !== 'seg' && fresh(k)) remote[k] = local[k];
    if (Array.isArray(remote.seg)) {
      remote.seg = remote.seg.map(rs => {
        const ls = local.seg?.find(s => s.id === rs.id); if (!ls) return rs;
        let out = rs;
        for (const k of Object.keys(ls)) if (fresh(`seg.${rs.id}.${k}`)) { if (out === rs) out = { ...rs }; out[k] = ls[k]; }
        return out;
      });
    }
  }
  return remote;
}

// ---------- transport ----------
let ws = null, wsReady = false, retry = 0, liveWanted = false, pending = null, raf = 0;
const liveSubs = new Set();

function queue(obj, now) {
  pending = mergeMsg(pending ?? {}, obj);
  if (now) return flush();
  if (!raf) raf = requestAnimationFrame(flush);
}
function flush() {
  cancelAnimationFrame(raf); raf = 0;
  if (!pending) return;
  // don't pile up messages on a slow link; try again next frame
  if (wsReady && ws.bufferedAmount > 2048) { raf = requestAnimationFrame(flush); return; }
  const msg = pending; pending = null;
  if (wsReady) ws.send(JSON.stringify(msg));
  else postJson('/json/state', msg).then(r => r && receive(r)).catch(() => {});
}
function mergeMsg(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (k === 'seg' && Array.isArray(a.seg)) {
      for (const s of v) { const t = a.seg.find(x => x.id === s.id); t ? Object.assign(t, s) : a.seg.push({ ...s }); }
    } else a[k] = k === 'seg' ? v.map(s => ({ ...s })) : v;
  }
  return a;
}
function receive(msg) {
  if (msg.state || msg.info) set({ state: msg.state ? applyRemote(msg.state) : data.state, info: msg.info ?? data.info });
  else if (msg.seg) set({ state: applyRemote(msg) });
}

export function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { wsReady = true; retry = 0; set({ online: true }); if (liveWanted) ws.send('{"lv":true}'); };
  ws.onmessage = e => {
    if (typeof e.data === 'string') {
      if (e.data !== 'pong') try { receive(JSON.parse(e.data)); } catch { /* ignore */ }
      return;
    }
    const b = new Uint8Array(e.data);
    if (b[0] !== 0x4c) return; // 'L'
    const v2 = b[1] === 2;
    const frame = { w: v2 ? b[2] : 0, h: v2 ? b[3] : 0, rgb: b.subarray(v2 ? 4 : 2) };
    liveSubs.forEach(fn => fn(frame));
  };
  ws.onclose = () => { wsReady = false; set({ online: false }); setTimeout(connect, Math.min(8000, 400 * 2 ** retry++)); };
  ws.onerror = () => ws.close();
}
setInterval(() => wsReady && ws.send('p'), 20000);

export function onLive(fn) {
  liveSubs.add(fn);
  if (!liveWanted) { liveWanted = true; if (wsReady) ws.send('{"lv":true}'); }
  return () => { liveSubs.delete(fn); if (!liveSubs.size) { liveWanted = false; if (wsReady) ws.send('{"lv":false}'); } };
}

export async function getJson(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
export async function postJson(path, obj) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
export async function getText(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
}
export async function upload(path, body, type = 'application/octet-stream') {
  const fd = new FormData();
  fd.append('data', new Blob([body], { type }), path);
  const r = await fetch('/upload', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`Upload of ${path} failed (HTTP ${r.status})`);
}

// ---------- presets ----------
// Presets live in /presets.json; the device answers psave/pdel and writes the file itself.
export const presetList = p => Object.entries(p ?? {}).filter(([id, x]) => +id > 0 && x && x.n !== undefined)
  .map(([id, x]) => ({ id: +id, name: x.n || `Preset ${id}`, playlist: !!x.playlist, segs: (x.seg ?? []).filter(s => (s.stop ?? 1) > (s.start ?? 0)).length }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
export function loadPresets() {
  return getJson('/presets.json').then(p => { set({ presets: p }); return p; }).catch(() => { set({ presets: data.presets ?? {} }); return data.presets; });
}
// The device answers first and writes the file a moment later (in its main loop), so poll
// until the change shows up instead of reloading once.
async function reloadUntil(done) {
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 300 + i * 150));
    const p = await loadPresets();
    if (p && done(p)) return;
  }
}
export async function savePreset(name, id) {
  const p = data.presets ?? {};
  if (id == null) { id = 1; while (p[id] && id < 250) id++; }
  await postJson('/json/state', { psave: id, n: name, ib: true, sb: true });
  await reloadUntil(q => q[id]?.n === name);
}
export async function deletePreset(id) {
  await postJson('/json/state', { pdel: id });
  await reloadUntil(q => !q[id]);
}
// renaming keeps the stored look, so it rewrites the file instead of saving the current state
export async function renamePreset(id, name) {
  const old = data.presets;
  if (old?.[id]) set({ presets: { ...old, [id]: { ...old[id], n: name } } }); // show it at once
  const p = await getJson('/presets.json').catch(e => { set({ presets: old }); throw e; });
  if (!p[id]) return;
  p[id].n = name;
  await upload('/presets.json', JSON.stringify(p), 'application/json');
  set({ presets: p });
}

// ---------- custom palettes ----------
// /palette<idx>.json = { name, palette: [pos, "rrggbb", ...] }; the device reloads them on
// upload and serves them as palette id 200 - idx. "name" is ours (the firmware ignores it).
export const CUSTOM_PAL_BASE = 200;
const parseStops = arr => {
  const out = [];
  if (typeof arr?.[1] === 'string') for (let i = 0; i + 1 < arr.length; i += 2) { const n = parseInt(arr[i + 1], 16); out.push([arr[i], (n >> 16) & 255, (n >> 8) & 255, n & 255]); }
  else for (let i = 0; i + 3 < (arr?.length ?? 0); i += 4) out.push(arr.slice(i, i + 4));
  return out;
};
export async function loadCustomPalettes() {
  const files = await getJson('/edit?list=/').catch(() => []);
  const idxs = files.map(f => /^\/?palette(\d+)\.json$/.exec(f.name)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  const pals = [];
  for (const idx of idxs) {
    try {
      const f = await getJson(`/palette${idx}.json`);
      pals.push({ idx, id: CUSTOM_PAL_BASE - idx, name: f.name || `Custom ${idx}`, stops: parseStops(f.palette) });
    } catch { /* unreadable file: skip */ }
  }
  set({ customPals: pals, cat: withCustoms(data.cat, pals) });
  return pals;
}
// merge custom palettes into the (cached, device-wide) catalogue
function withCustoms(cat, pals = data.customPals) {
  if (!cat) return cat;
  const palx = { ...cat.palx };
  for (const p of pals) palx[p.id] = p.stops;
  return { ...cat, palx, custom: pals };
}
export async function saveCustomPalette(idx, name, stops) {
  if (idx == null) { const used = new Set(data.customPals.map(p => p.idx)); idx = 0; while (used.has(idx)) idx++; }
  const palette = stops.flatMap(([pos, r, g, b]) => [pos, ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')]);
  await upload(`/palette${idx}.json`, JSON.stringify({ name, palette }), 'application/json');
  await loadCustomPalettes();
  return CUSTOM_PAL_BASE - idx;
}
export async function deleteCustomPalette(idx) {
  await postJson('/json/state', { rmcpal: idx });
  await loadCustomPalettes();
}

// Effect/palette catalogue, cached per firmware build + script set
export async function loadCatalogue(info) {
  const key = `studio.cat.${info.vid}.${(info.glow?.slots ?? []).map(s => s.file).join(',')}`;
  const cached = load(key, null); if (cached) return cached;
  const [effects, fxdata, palettes] = await Promise.all([getJson('/json/eff'), getJson('/json/fxdata'), getJson('/json/pal')]);
  const first = await getJson('/json/palx?page=0');
  const palx = { ...first.p };
  // the device serves one request at a time well; fetch the rest two at a time
  for (let page = 1; page <= first.m; page += 2) {
    const pages = await Promise.all([page, page + 1].filter(p => p <= first.m).map(p => getJson(`/json/palx?page=${p}`)));
    pages.forEach(r => Object.assign(palx, r.p));
  }
  const cat = { effects, fxdata, palettes, palx };
  persist(key, cat);
  return cat;
}

export async function boot() {
  connect();
  const { state, info } = await getJson('/json/si');
  set({ state, info, sel: state.mainseg ?? 0 });
  loadPresets();
  set({ cat: withCustoms(await loadCatalogue(info)) });
  loadCustomPalettes();
  let lastScripts = (info.glow?.slots ?? []).map(s => s.file).join(','), loading = false;
  subs.add(async () => {
    const now = (data.info?.glow?.slots ?? []).map(s => s.file).join(',');
    if (now === lastScripts || loading || !data.info) return;
    lastScripts = now; loading = true;
    try { set({ cat: withCustoms(await loadCatalogue(data.info)) }); } finally { loading = false; }
  });
}
