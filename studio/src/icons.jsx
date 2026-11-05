// 16px stroke icons (authored, 1.5px stroke, round caps) — one consistent set.
const P = {
  lights: 'M8 1.75a4.25 4.25 0 0 0-2.5 7.69V11h5V9.44A4.25 4.25 0 0 0 8 1.75ZM6 13.25h4M6.75 15h2.5',
  presets: 'M2.75 3.25h10.5M2.75 8h10.5M2.75 12.75h6.5',
  code: 'm5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5',
  settings: 'M8 10.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM8 1.5v1.75M8 12.75v1.75M14.5 8h-1.75M3.25 8H1.5M12.6 3.4l-1.24 1.24M4.64 11.36 3.4 12.6M12.6 12.6l-1.24-1.24M4.64 4.64 3.4 3.4',
  power: 'M8 1.75v5.5M4.4 3.9a5.25 5.25 0 1 0 7.2 0',
  search: 'M7 12.25a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5ZM14.25 14.25l-3.5-3.5',
  star: 'm8 1.9 1.85 3.75 4.15.6-3 2.92.7 4.13L8 11.35 4.3 13.3l.7-4.13-3-2.92 4.15-.6L8 1.9Z',
  split: 'M8 1.75v12.5M5.25 5 2.75 8l2.5 3M10.75 5l2.5 3-2.5 3',
  merge: 'M2.75 8h10.5M5 4.75 2.75 8 5 11.25M11 4.75 13.25 8 11 11.25',
  trash: 'M2.75 4h10.5M6.25 4V2.75h3.5V4M4.25 4l.6 9.25h6.3l.6-9.25',
  chevron: 'm4.5 6.25 3.5 3.5 3.5-3.5',
  close: 'm4 4 8 8M12 4l-8 8',
  plus: 'M8 3v10M3 8h10',
  audio: 'M2.75 6.5v3M5.5 4.5v7M8.25 2.5v11M11 5v6M13.75 7v2',
  grid: 'M2.75 2.75h10.5v10.5H2.75zM2.75 8h10.5M8 2.75v10.5',
  eye: 'M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8ZM8 9.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z',
  eyeoff: 'M2.5 2.5l11 11M6.6 4.03A6.6 6.6 0 0 1 8 3.75C12 3.75 14.25 8 14.25 8a11 11 0 0 1-1.7 2.2M10.1 11.8A6.3 6.3 0 0 1 8 12.25C4 12.25 1.75 8 1.75 8a11.2 11.2 0 0 1 2.46-2.9',
  upload: 'M8 10.5V2.5M5 5.25 8 2.25l3 3M2.75 10.5v2.75h10.5V10.5',
  play: 'M4.75 2.75v10.5L13 8 4.75 2.75Z',
  external: 'M9.75 2.75h3.5v3.5M13.25 2.75 7.5 8.5M11.25 9.5v3.75h-8.5v-8.5H6.5',
  dot: 'M8 8h.01',
  check: 'm3 8.25 3.25 3.25L13 4.75',
  device: 'M2.75 3.75h10.5v7H2.75zM6 13.25h4',
};

export function Icon({ name, size = 16, fill = false, label }) {
  return (
    <svg class="ico" width={size} height={size} viewBox="0 0 16 16" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      <path d={P[name]} fill={fill ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
