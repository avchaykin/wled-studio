// WLED Studio — app shell.
import { h, mount, $ } from './dom.js';
import { store, seg as selSeg } from './store.js';
import { connect, getJson, loadCatalogue, onLive, send } from './api.js';
import { LedCanvas, SegmentBar, segHue } from './stage.js';
import { EffectPanel, ColorPanel, PalettePanel, SegmentPanel, Slider } from './panels.js';
import { PresetsPage, ScriptsPage } from './pages.js';

const PAGES = [
  ['lights', 'Lights', 'M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Zm-2.5 15h5v1.5a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5Z'],
  ['presets', 'Presets', 'M5 4h14v4H5Zm0 6h14v4H5Zm0 6h14v4H5Z'],
  ['scripts', 'Scripts', 'M8.6 7.4 7.2 6 1.2 12l6 6 1.4-1.4L4 12Zm6.8 0L20 12l-4.6 4.6 1.4 1.4 6-6-6-6Z'],
  ['settings', 'Settings', 'M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4ZM13 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z'],
];
const TABS = [['effect', 'Effect'], ['color', 'Colour'], ['palette', 'Palette'], ['segment', 'Segment']];
const icon = d => h('span.ico', { 'aria-hidden': true, innerHTML: `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="${d}"/></svg>` });

function Header() {
  const name = h('h1.devname');
  const dot = h('span.dot.conn', { title: 'Connection' });
  const power = h('button.power', { 'aria-label': 'Power', onClick: () => { const on = !store.get().state?.on; store.set({ state: { ...store.get().state, on } }); send({ on }, { now: true }); } },
    h('span', { 'aria-hidden': true, innerHTML: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>' }));
  const bri = h('div.bri');
  let briDrag = false;
  function render() {
    const d = store.get();
    name.textContent = d.info?.name ?? 'WLED';
    dot.classList.toggle('on', d.online);
    dot.title = d.online ? 'Connected' : 'Reconnecting…';
    power.setAttribute('aria-pressed', !!d.state?.on);
    if (!briDrag && d.state) {
      const s = Slider('Brightness', d.state.bri, v => { store.get().state.bri = v; send({ bri: v }); }, { min: 1, fmt: v => `${Math.round(v / 2.55)}%` });
      s.addEventListener('pointerdown', () => { briDrag = true; });
      s.addEventListener('pointerup', () => { briDrag = false; });
      mount(bri, s);
    }
  }
  store.subscribe((d, p) => { if (p.state || p.info || 'online' in p) render(); });
  render();
  return h('header.top', null, h('div.brand', null, dot, name), bri, power);
}

function LightsPage() {
  const live = new LedCanvas();
  let stop = null;
  const panels = { effect: EffectPanel(), color: ColorPanel(), palette: PalettePanel(), segment: SegmentPanel() };
  const tabs = h('div.tabs', { role: 'tablist', 'aria-label': 'Segment controls' });
  const body = h('div.tabbody');
  const segChips = h('div.segchips');
  function renderTabs() {
    const t = store.get().tab;
    mount(tabs, TABS.map(([k, label]) => h('button.tab', { role: 'tab', 'aria-selected': k === t, onClick: () => store.set({ tab: k }) }, label)));
    mount(body, panels[t]);
  }
  function renderChips() {
    const d = store.get(); const sel = selSeg(d)?.id;
    mount(segChips, (d.state?.seg ?? []).filter(s => s.stop > s.start).map(s => h('button.segchip', {
      'aria-pressed': s.id === sel, style: { '--hue': segHue(s.id) }, onClick: () => store.set({ sel: s.id }),
    }, s.n || `Segment ${s.id}`)));
  }
  store.subscribe((d, p) => {
    if ('tab' in p) renderTabs();
    if (p.state || 'sel' in p) {
      renderChips();
      const sel = selSeg(d)?.id;
      live.segs = (d.state?.seg ?? []).filter(s => s.stop > s.start).map(s => ({ start: s.start, stop: s.stop, hue: segHue(s.id), sel: s.id === sel }));
      live.draw();
    }
  });
  renderTabs(); renderChips();
  const root = h('section.page.lights', { 'aria-label': 'Lights' },
    h('div.stage', null, live.el, SegmentBar(), h('p.hint', null, 'Drag a boundary to resize · double-click or long-press inside a segment to split it'), segChips),
    h('div.controls', null, tabs, body));
  root.addEventListener('page-shown', () => { if (!stop) stop = onLive(f => live.setFrame(f)); });
  root.addEventListener('page-hidden', () => { stop?.(); stop = null; });
  return root;
}

function SettingsPage() {
  const links = [['/settings/wifi', 'Wi-Fi'], ['/settings/leds', 'LED hardware'], ['/settings/ui', 'Interface'], ['/settings/sync', 'Sync & integrations'],
    ['/settings/time', 'Time & macros'], ['/settings/sec', 'Security & updates'], ['/settings/um', 'Usermods'], ['/edit', 'File editor'], ['/legacy', 'Classic WLED interface']];
  const info = h('dl.info');
  store.subscribe((d, p) => {
    if (!p.info) return;
    const i = d.info;
    mount(info, [['Version', i.ver], ['LEDs', i.leds?.count], ['Free heap', `${Math.round(i.freeheap / 1024)} KB`], ['Wi-Fi', `${i.wifi?.signal}%`],
      ['Scripts engine', i.glow ? `v${i.glow.v}, ${i.glow.slots.length} loaded` : 'not installed']].map(([k, v]) => [h('dt', null, k), h('dd', null, v ?? '—')]));
  });
  return h('section.page', { 'aria-label': 'Settings' }, h('h2', null, 'Settings'), info,
    h('nav.settinglinks', null, links.map(([href, label]) => h('a.settinglink', { href }, label, h('span', { 'aria-hidden': true }, '›')))));
}

function App() {
  const pages = { lights: LightsPage(), presets: PresetsPage(), scripts: ScriptsPage(), settings: SettingsPage() };
  const main = h('main.main');
  const nav = h('nav.nav', { 'aria-label': 'Sections' });
  let shown = null;
  function show() {
    const p = store.get().page;
    if (shown === p) return;
    if (shown) pages[shown].dispatchEvent(new Event('page-hidden'));
    shown = p;
    mount(main, pages[p]);
    pages[p].dispatchEvent(new Event('page-shown'));
    mount(nav, PAGES.map(([k, label, d]) => h('button.navbtn', { 'aria-current': k === p ? 'page' : null, onClick: () => { location.hash = k; } }, icon(d), h('span', null, label))));
  }
  const fromHash = () => { const k = location.hash.slice(1); store.set({ page: PAGES.some(p => p[0] === k) ? k : 'lights' }); };
  window.addEventListener('hashchange', fromHash);
  store.subscribe((d, p) => { if ('page' in p) show(); });
  fromHash(); show();
  return h('div.app', null, Header(), nav, main);
}

async function boot() {
  mount($('#app'), App());
  connect();
  try {
    const { state, info } = await getJson('/json/si');
    store.set({ state, info, sel: state.mainseg ?? 0 });
    store.set({ cat: await loadCatalogue(info) });
  } catch (e) {
    console.error(e);
  }
  // refetch catalogue when scripts change (effect names come from the device)
  let lastSlots = JSON.stringify(store.get().info?.glow?.slots?.map(s => s.file)), loading = false;
  store.subscribe(async (d, p) => {
    if (!p.info || loading) return;
    const now = JSON.stringify(d.info?.glow?.slots?.map(s => s.file));
    if (now === lastSlots && d.cat) return;
    lastSlots = now; loading = true;
    try { store.set({ cat: await loadCatalogue(d.info) }); } catch (e) { console.error(e); } finally { loading = false; }
  });
  // accent colour follows the selected segment's primary colour (if it is not too dark)
  store.subscribe(d => {
    const c = selSeg(d)?.col?.[0]; if (!c) return;
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    document.documentElement.style.setProperty('--acc', lum > 60 ? `rgb(${c[0]},${c[1]},${c[2]})` : '');
  });
}
boot();
