// Minimal observable store.
const listeners = new Set();
let data = {
  state: null, info: null, online: false, cat: null,
  sel: 0,                 // selected segment id
  page: 'lights', tab: 'effect',
  favs: load('studio.favs', []),
};

function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
export function persist(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }

export const store = {
  get: () => data,
  set(patch) {
    data = { ...data, ...patch };
    listeners.forEach(fn => fn(data, patch));
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

// selectors
export const seg = (d = data) => d.state?.seg?.find(s => s.id === d.sel) ?? d.state?.seg?.[0];
export const ledCount = (d = data) => d.info?.leds?.count ?? 0;
export const glowFx = (d = data) => new Set((d.info?.glow?.slots ?? []).map(s => s.fx));

// Optimistic local update of one segment, so the UI reacts before the device answers.
export function patchSeg(id, patch) {
  const st = data.state; if (!st) return;
  store.set({ state: { ...st, seg: st.seg.map(s => (s.id === id ? { ...s, ...patch } : s)) } });
}
