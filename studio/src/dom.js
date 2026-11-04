// Tiny DOM helpers.
export function h(tag, props, ...children) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    }
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export function mount(el, ...children) { el.replaceChildren(); append(el, children); return el; }

// colour utilities (WLED colours are [r,g,b(,w)] arrays)
export const hex = c => '#' + [c[0], c[1], c[2]].map(v => (v | 0).toString(16).padStart(2, '0')).join('');
export const fromHex = s => { const n = parseInt(s.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export function rgb2hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((hh * 60) + 360) % 360, mx ? d / mx : 0, mx];
}
export function hsv2rgb(hh, s, v) {
  const f = n => { const k = (n + hh / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return [f(5), f(3), f(1)];
}

// CSS gradient for a palette preview from /json/palx data
export function paletteCss(entry, colors) {
  if (!entry) return '#333';
  const segCol = k => hex(colors?.[k] ?? [0, 0, 0]);
  const stops = entry.map((e, i, a) => {
    if (Array.isArray(e)) return `rgb(${e[1]},${e[2]},${e[3]}) ${(e[0] / 255 * 100).toFixed(1)}%`;
    const pos = a.length > 1 ? (i / (a.length - 1) * 100).toFixed(1) : 0;
    if (e === 'r') return `hsl(${(i * 67) % 360} 90% 55%) ${pos}%`;
    return `${segCol(+e.slice(1) - 1)} ${pos}%`;
  });
  return stops.length > 1 ? `linear-gradient(90deg, ${stops.join(',')})` : stops[0];
}

export function throttle(fn, ms) {
  let last = 0, timer = null, args;
  return (...a) => {
    args = a;
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else if (!timer) timer = setTimeout(() => { timer = null; last = performance.now(); fn(...args); }, ms - (now - last));
  };
}
