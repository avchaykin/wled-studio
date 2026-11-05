// Loads the Glow compiler + VM bundle (/studio-glow.js) once, on first use.
let pending = null;

export function loadGlow() {
  if (window.__glow) return Promise.resolve(window.__glow);
  if (!pending) pending = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/studio-glow.js';
    s.onload = () => (window.__glow ? resolve(window.__glow) : reject(new Error('The script engine did not load.')));
    s.onerror = () => { pending = null; s.remove(); reject(new Error('Could not load the script engine. Check the connection and reopen Scripts.')); };
    document.head.appendChild(s);
  });
  return pending;
}
