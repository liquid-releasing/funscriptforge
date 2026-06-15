// laneSnapshot — rasterize a live TrackStack <svg> lane to a PNG data URL.
//
// The export Preview images must be the EXACT renders the funscript video
// player shows (forgemoment TrackStack), not a separate matplotlib path that
// can drift. We render a hidden full-track TrackStack per lane (audio /
// spectro / funscript) and snapshot its <svg> here, so the bundle ships the
// viewer's own pixels. See project_funscriptforge_pending "Export — Preview
// images should be COPIES OF THE APP'S VIDEO-EDITOR VIEWS".
//
// Catch: a serialized standalone SVG has no document context, so `var(--token)`
// CSS variables (TrackStack uses --bg / --accent / --text-dim / --font-mono)
// don't resolve and would render black. We read their computed values off
// :root and inject a <style> block into the clone before serializing.

const TOKENS = ['--bg', '--accent', '--text-dim', '--font-mono', '--surface', '--border'];

function tokenStyleBlock() {
  if (typeof window === 'undefined') return '';
  const root = getComputedStyle(document.documentElement);
  const decls = TOKENS
    .map((t) => {
      const v = root.getPropertyValue(t).trim();
      return v ? `${t}:${v};` : '';
    })
    .filter(Boolean)
    .join('');
  return decls ? `<style>:root{${decls}} text{font-family:var(--font-mono,monospace);}</style>` : '';
}

// Snapshot an <svg> element to a PNG data URL at its on-screen pixel size
// (scaled by `scale` for crispness). `background` paints under the lanes
// (the svg's own CSS background doesn't serialize). Resolves to a data URL,
// or null on any failure (caller treats null as "no preview, fall back").
export function svgElementToPngDataUrl(svgEl, { scale = 2, background = '#0e1117' } = {}) {
  return new Promise((resolve) => {
    try {
      if (!svgEl || typeof document === 'undefined') { resolve(null); return; }
      const w = Math.max(1, Math.round(svgEl.getAttribute('width') || svgEl.clientWidth || 0));
      const h = Math.max(1, Math.round(svgEl.getAttribute('height') || svgEl.clientHeight || 0));
      if (w < 2 || h < 2) { resolve(null); return; }

      const clone = svgEl.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', w);
      clone.setAttribute('height', h);
      // Inline the design tokens so var(--…) fills resolve in the detached SVG.
      const styleBlock = tokenStyleBlock();
      if (styleBlock) clone.insertAdjacentHTML('afterbegin', styleBlock);

      const svgStr = new XMLSerializer().serializeToString(clone);
      const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = w * scale;
          canvas.height = h * scale;
          const ctx = canvas.getContext('2d');
          if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const url = canvas.toDataURL('image/png');
          resolve(url && url.length > 16 ? url : null);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = svgUrl;
    } catch {
      resolve(null);
    }
  });
}
