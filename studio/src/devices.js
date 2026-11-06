// Other WLED devices on the LAN: discovery, the shared device list, remote state and presets.
// Every WLED device answers cross-origin requests (Access-Control-Allow-Origin: *), so the
// Studio on one controller can drive the others directly from the browser.
import { getJson, upload } from './store.js';

const LIST = '/studio-devices.json'; // [{ ip, name }] added by hand, stored on this device

const base = ip => (ip ? `http://${ip}` : '');
// fetch with a timeout and one retry: some controllers sit on weak Wi-Fi
export async function devJson(ip, path, { body, timeout = 5000, retries = 1 } = {}) {
  for (let i = 0; ; i++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(base(ip) + path, body === undefined ? { cache: 'no-store', signal: ctl.signal }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= retries) throw new Error(e.name === 'AbortError' ? 'no answer' : e.message);
    } finally { clearTimeout(t); }
  }
}
// multipart upload to another device (a "simple" CORS request: no preflight needed)
export async function devUpload(ip, path, body) {
  const fd = new FormData(); fd.append('data', body instanceof Blob ? body : new Blob([body], { type: 'application/json' }), path);
  const r = await fetch(`${base(ip)}/upload`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`Upload to ${ip || 'this device'} failed (HTTP ${r.status})`);
}

export const loadSaved = () => getJson(LIST).then(l => (Array.isArray(l) ? l : [])).catch(() => []);
export const saveSaved = list => upload(LIST, JSON.stringify(list), 'application/json');
export const discover = () => getJson('/json/nodes').then(r => r.nodes ?? []).catch(() => []);

// state + info of one device, plus effect names (cached per firmware build + script set)
const fxCache = new Map();
export async function probe(ip) {
  const { state, info } = await devJson(ip, '/json/si');
  const key = `${ip}|${info.vid}|${(info.glow?.slots ?? []).map(s => s.file).join()}`;
  if (!fxCache.has(key)) fxCache.set(key, devJson(ip, '/json/eff').catch(() => null));
  return { state, info, effects: await fxCache.get(key) };
}
export const devPresets = ip => devJson(ip, '/presets.json').catch(() => ({}));

// Copy presets between devices. Effects are matched by name (script effects get different
// ids on each device); a Glow script the target lacks is copied along (.glow + .glw) first.
// Presets whose name already exists on the target replace it.
// Returns per target { ok, copied, scripts: [names copied], missingFx: [names shown as Solid] }.
export async function copyPresets(src, ids, targets) {
  const [srcP, srcFx, srcInfo] = await Promise.all([devPresets(src), devJson(src, '/json/eff'), devJson(src, '/json/info')]);
  const scriptByFx = new Map((srcInfo.glow?.slots ?? []).map(s => [s.fx, s.file]));
  const used = new Set(ids.flatMap(id => (srcP[id]?.seg ?? []).map(s => s.fx)).filter(fx => typeof fx === 'number' && fx > 0));
  const results = [];
  for (const dst of targets) {
    try {
      const [dstP, dstInfo] = await Promise.all([devJson(dst, '/presets.json').catch(() => ({ 0: {} })), devJson(dst, '/json/info')]);
      let dstFx = await devJson(dst, '/json/eff');
      // scripts used by these presets that the target does not have (by effect name)
      const need = [...used].filter(fx => scriptByFx.has(fx) && !dstFx.includes(srcFx[fx]));
      const scripts = [];
      if (need.length && dstInfo.glow) {
        for (const fx of need) {
          const file = scriptByFx.get(fx);
          for (const ext of ['glow', 'glw']) {
            const r = await fetch(`${src ? `http://${src}` : ''}/glow/${file}.${ext}`, { cache: 'no-store' });
            if (!r.ok) throw new Error(`reading script ${file}.${ext}: HTTP ${r.status}`);
            await devUpload(dst, `/glow/${file}.${ext}`, await r.blob());
          }
          scripts.push(srcFx[fx]);
        }
        await devJson(dst, '/json/state', { body: { glow: { reload: true } } });
        for (let i = 0; i < 10 && !scripts.every(n => dstFx.includes(n)); i++) {
          await new Promise(r => setTimeout(r, 600));
          dstFx = await devJson(dst, '/json/eff');
        }
      }
      const fxByName = new Map(dstFx.map((n, i) => [n, i]));
      const missing = new Set();
      const mapFx = fx => { const n = srcFx[fx]; if (fx === 0 || n == null) return fx; if (fxByName.has(n)) return fxByName.get(n); missing.add(n); return 0; };
      for (const id of ids) {
        const p = structuredClone(srcP[id]); if (!p) continue;
        if (Array.isArray(p.seg)) for (const s of p.seg) if (typeof s.fx === 'number') s.fx = mapFx(s.fx);
        let slot = Object.keys(dstP).find(k => +k > 0 && dstP[k]?.n === p.n);
        if (!slot) { slot = 1; while (dstP[slot] && slot < 250) slot++; }
        dstP[slot] = p;
      }
      await devUpload(dst, '/presets.json', JSON.stringify(dstP));
      results.push({ ip: dst, ok: true, copied: ids.length, scripts, missingFx: [...missing] });
    } catch (e) { results.push({ ip: dst, ok: false, error: e.message }); }
  }
  return results;
}
