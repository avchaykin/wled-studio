// Device connection: WebSocket for state + live LEDs, HTTP for everything else.
import { store } from './store.js';

const base = '';   // same origin (the dev server proxies to the device)
let ws = null, wsReady = false, retry = 0, liveWanted = false;
const liveListeners = new Set();
let sendTimer = null, pending = null;

export async function getJson(path) {
  const r = await fetch(base + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

export async function postState(obj) {
  const r = await fetch(base + '/json/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  return r.json();
}

// Merge partial updates and send at most every 50 ms (sliders produce a flood).
export function send(obj, { now = false } = {}) {
  pending = merge(pending || {}, obj);
  if (now) return flush();
  if (!sendTimer) sendTimer = setTimeout(flush, 50);
}
function flush() {
  clearTimeout(sendTimer); sendTimer = null;
  const msg = pending; pending = null;
  if (!msg) return;
  if (wsReady) ws.send(JSON.stringify(msg));
  else postState(msg).then(applyState).catch(() => {});
}
function merge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (k === 'seg' && Array.isArray(v) && Array.isArray(a.seg)) {
      for (const s of v) {
        const t = a.seg.find(x => x.id === s.id);
        t ? Object.assign(t, s) : a.seg.push(s);
      }
    } else a[k] = v;
  }
  return a;
}

function applyState(msg) {
  if (!msg) return;
  if (msg.state || msg.info) store.set({ state: msg.state ?? store.get().state, info: msg.info ?? store.get().info });
  else if (msg.seg) store.set({ state: msg });
}

export function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    wsReady = true; retry = 0;
    store.set({ online: true });
    if (liveWanted) ws.send('{"lv":true}');
  };
  ws.onmessage = e => {
    if (typeof e.data === 'string') {
      if (e.data === 'pong') return;
      try { applyState(JSON.parse(e.data)); } catch { /* ignore */ }
    } else {
      const b = new Uint8Array(e.data);
      if (b[0] !== 0x4c) return; // 'L'
      const v2 = b[1] === 2;
      const frame = { w: v2 ? b[2] : 0, h: v2 ? b[3] : 0, rgb: b.subarray(v2 ? 4 : 2) };
      liveListeners.forEach(fn => fn(frame));
    }
  };
  ws.onclose = () => {
    wsReady = false;
    store.set({ online: false });
    setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
  };
  ws.onerror = () => ws.close();
  setInterval(() => wsReady && ws.send('p'), 20000);
}

export function onLive(fn) {
  liveListeners.add(fn);
  if (!liveWanted) { liveWanted = true; if (wsReady) ws.send('{"lv":true}'); }
  return () => {
    liveListeners.delete(fn);
    if (!liveListeners.size) { liveWanted = false; if (wsReady) ws.send('{"lv":false}'); }
  };
}

// Static-ish catalogues, cached per firmware build
export async function loadCatalogue(info) {
  const key = `studio.cat.${info.vid}.${info.glow?.slots?.map(s => s.file).join(',') ?? ''}`;
  try { const c = JSON.parse(localStorage.getItem(key)); if (c) return c; } catch { /* no cache */ }
  const [effects, fxdata, palettes] = await Promise.all([getJson('/json/eff'), getJson('/json/fxdata'), getJson('/json/pal')]);
  const palx = {};
  for (let page = 0, max = 0; page <= max; page++) {
    const r = await getJson(`/json/palx?page=${page}`);
    max = r.m; Object.assign(palx, r.p);
  }
  const cat = { effects, fxdata, palettes, palx };
  try { localStorage.setItem(key, JSON.stringify(cat)); } catch { /* quota */ }
  return cat;
}

export async function uploadFile(path, data, type = 'application/octet-stream') {
  const fd = new FormData();
  fd.append('data', new Blob([data], { type }), path);
  const r = await fetch(base + '/upload', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`upload ${path}: HTTP ${r.status}`);
}

export async function getText(path) {
  const r = await fetch(base + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
}
