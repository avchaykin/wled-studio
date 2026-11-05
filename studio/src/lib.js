// Shared helpers: colour maths, palette rendering, effect metadata.

export const hex = c => '#' + [c?.[0] ?? 0, c?.[1] ?? 0, c?.[2] ?? 0].map(v => (v | 0).toString(16).padStart(2, '0')).join('');
export function fromHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim()); if (!m) return null;
  const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgb2hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx];
}
export function hsv2rgb(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return [f(5), f(3), f(1)];
}

// Palette stops from /json/palx -> [[pos, r, g, b], ...] (segment colours / random resolved)
export function paletteStops(entry, segCols) {
  if (!entry?.length) return [[0, 0, 0, 0], [255, 255, 255, 255]];
  const col = k => segCols?.[k] ?? [0, 0, 0];
  return entry.map((e, i, a) => {
    if (Array.isArray(e)) return e;
    const pos = a.length > 1 ? Math.round(i * 255 / (a.length - 1)) : 0;
    if (e === 'r') { const [r, g, b] = hsv2rgb((i * 67) % 360, 0.85, 1); return [pos, r, g, b]; }
    return [pos, ...col(+e.slice(1) - 1)];
  });
}
export const paletteCss = (entry, segCols) =>
  `linear-gradient(90deg,${paletteStops(entry, segCols).map(([p, r, g, b]) => `rgb(${r},${g},${b}) ${(p / 2.55).toFixed(1)}%`).join(',')})`;
export function paletteAt(stops, i) {
  let k = 0; while (k < stops.length - 1 && stops[k + 1][0] < i) k++;
  const a = stops[k], b = stops[Math.min(k + 1, stops.length - 1)];
  const f = b[0] === a[0] ? 0 : Math.max(0, Math.min(1, (i - a[0]) / (b[0] - a[0])));
  const m = j => Math.round(a[j] + (b[j] - a[j]) * f);
  return ((m(1) << 16) | (m(2) << 8) | m(3)) >>> 0;
}

// WLED effect metadata: "sliders;colours;palette;flags;defaults"
const SLIDER_KEYS = ['sx', 'ix', 'c1', 'c2', 'c3'];
const CHECK_KEYS = ['o1', 'o2', 'o3'];
const SLIDER_DEFAULT = ['Speed', 'Intensity', 'Custom 1', 'Custom 2', 'Custom 3'];
const COLOR_DEFAULT = ['Primary', 'Secondary', 'Tertiary'];
export function fxMeta(id, cat) {
  if (id === 0) return { sliders: [], checks: [], colors: [{ i: 0, label: 'Colour' }], palette: false, audio: false, twoD: false };
  const raw = cat?.fxdata?.[id];
  const defined = !!raw;
  const parts = defined ? raw.split(';') : [];
  const sl = parts[0] ? parts[0].split(',') : [];
  const co = parts[1] ? parts[1].split(',') : [];
  const flags = parts[3] ?? '';
  const sliders = [], checks = [], colors = [];
  for (let i = 0; i < 5; i++) if ((!defined && i < 2) || sl[i]) sliders.push({ key: SLIDER_KEYS[i], label: !sl[i] || sl[i] === '!' ? SLIDER_DEFAULT[i] : sl[i] });
  for (let i = 0; i < 3; i++) if (sl[5 + i]) checks.push({ key: CHECK_KEYS[i], label: sl[5 + i] === '!' ? `Option ${i + 1}` : sl[5 + i] });
  for (let i = 0; i < 3; i++) {
    if (!defined) colors.push({ i, label: COLOR_DEFAULT[i] });
    else if (co[i]) colors.push({ i, label: co[i] === '!' ? COLOR_DEFAULT[i] : co[i] });
  }
  return { sliders, checks, colors, palette: !defined || (parts[2] ?? '') !== '', audio: /[vf]/.test(flags), twoD: flags.includes('2') && !flags.includes('1') };
}

export const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
