// Glow compiler + VM as a separate bundle (/studio-glow.js): only the Scripts page needs it,
// so it is loaded on demand instead of with every page load. See glow.js.
import { compile } from '../../glow/compiler.mjs';
import { loadImage, GlowInstance, runFrame } from '../../glow/vm.mjs';

window.__glow = { compile, loadImage, GlowInstance, runFrame };
