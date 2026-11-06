// Firmware updates: release manifest on GitHub Pages (CORS-enabled), downloaded by the
// browser and posted to a device's /update. Works for this device and for others on the LAN.
//
// manifest.json: { latest, releases: [{ version, date, notes: [..], builds: { <info.release>: { file, size } } }] }
import { load, persist } from './store.js';

export const RELEASES = 'https://avchaykin.github.io/wled-studio-releases/';
const CHECK_EVERY = 6 * 3600e3;

// "0.10.1" > "0.9.3"; a device without info.studio predates versioning (0.1.0)
export function cmpVer(a, b) {
  const pa = String(a ?? '0').split('.').map(Number), pb = String(b ?? '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
export const studioVersion = info => info?.studio ?? (info?.glow ? '0.1.0' : null); // null: not WLED Studio

// Latest manifest, cached in the browser for a few hours unless forced.
export async function fetchManifest(force = false) {
  const c = load('studio.manifest', null);
  if (!force && c && Date.now() - c.at < CHECK_EVERY) return c.m;
  const r = await fetch(`${RELEASES}manifest.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Release list: HTTP ${r.status}`);
  const m = await r.json();
  persist('studio.manifest', { at: Date.now(), m });
  return m;
}

// The newest release with a build for this device, if newer than what it runs.
export function updateFor(info, manifest) {
  const cur = studioVersion(info);
  if (!manifest || !info?.release) return null;
  const rel = (manifest.releases ?? []).filter(r => r.builds?.[info.release]).sort((a, b) => cmpVer(b.version, a.version))[0];
  if (!rel) return null;
  return { ...rel, build: rel.builds[info.release], newer: cur === null || cmpVer(rel.version, cur) > 0 };
}

const blobs = new Map(); // file -> Promise<Blob>, so several devices share one download
export function downloadFirmware(build, onProgress) {
  if (blobs.has(build.file)) return blobs.get(build.file);
  const p = (async () => {
    const r = await fetch(RELEASES + build.file, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Download: HTTP ${r.status}`);
    const total = +r.headers.get('content-length') || build.size || 0;
    const reader = r.body.getReader(); const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      parts.push(value); got += value.length; onProgress?.(total ? got / total : 0);
    }
    if (build.size && got !== build.size) throw new Error(`Download incomplete (${got} of ${build.size} bytes)`);
    return new Blob(parts, { type: 'application/octet-stream' });
  })();
  blobs.set(build.file, p);
  p.catch(() => blobs.delete(build.file));
  return p;
}

// POST the image to http://<host>/update ('' = this device). Resolves when the device has
// accepted it; it then reboots. The device checks the image itself before switching to it.
export function flashFirmware(host, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${host ? `http://${host}` : ''}/update`);
    x.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => (x.status === 200 && /successful/i.test(x.responseText) ? resolve()
      : reject(new Error(`Update failed (HTTP ${x.status}): ${x.responseText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`)));
    x.onerror = () => reject(new Error('Connection lost during upload'));
    x.timeout = 300e3; x.ontimeout = () => reject(new Error('Upload timed out'));
    const fd = new FormData(); fd.append('update', blob, 'firmware.bin');
    x.send(fd);
  });
}

// Poll until the device answers with the expected version (after its reboot).
export async function waitForVersion(host, version, timeoutMs = 90e3) {
  const t0 = Date.now();
  await new Promise(r => setTimeout(r, 4000));
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
      const info = await fetch(`${host ? `http://${host}` : ''}/json/info`, { cache: 'no-store', signal: ctl.signal }).then(r => r.json());
      clearTimeout(t);
      if (studioVersion(info) === version) return info;
    } catch { /* rebooting */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('The device did not come back with the new version in time');
}

// Whole flow for one device; onStep({ phase: 'download'|'upload'|'reboot'|'done', p, attempt })
// A dropped upload leaves the old firmware running, so it is simply tried again (weak Wi-Fi).
export async function updateDevice(host, rel, onStep) {
  const blob = await downloadFirmware(rel.build, p => onStep?.({ phase: 'download', p }));
  for (let attempt = 1; ; attempt++) {
    try { await flashFirmware(host, blob, p => onStep?.({ phase: 'upload', p, attempt })); break; }
    catch (e) {
      if (attempt >= 3 || !/Connection lost|timed out|HTTP (0|503)/.test(e.message)) throw e;
      onStep?.({ phase: 'upload', p: 0, attempt: attempt + 1 });
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  onStep?.({ phase: 'reboot' });
  const info = await waitForVersion(host, rel.version);
  onStep?.({ phase: 'done', info });
  return info;
}
