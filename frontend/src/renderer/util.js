// Tiny DOM + string helpers shared by the renderer modules.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svgCache = new Map();
export function icon(name) {
  const paths = {
    close: '<path d="M3 3l6 6M9 3l-6 6"/>',
    minimize: '<path d="M2.5 6h7"/>',
    maximize: '<rect x="2.5" y="2.5" width="7" height="7" rx="1"/>',
    restore: '<rect x="2.5" y="4" width="5.5" height="5.5" rx="1"/><path d="M4.5 4V3.2c0-.4.3-.7.7-.7h3.6c.4 0 .7.3.7.7v3.6c0 .4-.3.7-.7.7H8"/>',
    split: '<rect x="1.5" y="2" width="9" height="8" rx="1.5"/><path d="M6 2v8"/>',
    up: '<path d="M3 7.5l3-3 3 3"/>',
    down: '<path d="M3 4.5l3 3 3-3"/>',
    minus: '<path d="M3 6h6"/>',
    plus: '<path d="M3 6h6M6 3v6"/>',
  };
  if (!svgCache.has(name)) {
    svgCache.set(name, `<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`);
  }
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = svgCache.get(name);
  return span;
}

export function hexToRgb(hex) {
  let s = String(hex || '').replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isLight = (hex) => luminance(hex) > 0.4;

export function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Subsequence match: every query char must appear in order. Higher is better.
export function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return 800 - idx;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - (found - ti);
    ti = found + 1;
  }
  return score;
}

const MONO_FALLBACK = ['"JetBrains Mono Variable"', '"Cascadia Mono"', 'Consolas', 'monospace'];
const UI_FALLBACK = ['"Inter Variable"', '"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'];

export function fontStack(family, kind = 'mono') {
  const fam = String(family || '').trim();
  const first = !fam ? [] : (fam.includes(',') || /^["']/.test(fam)) ? [fam] : [`"${fam.replace(/"/g, '')}"`];
  return [...first, ...(kind === 'mono' ? MONO_FALLBACK : UI_FALLBACK)].join(', ');
}

// Bundled web fonts must be loaded before xterm measures its cell size.
export async function ensureFont(family, weights = [400, 700]) {
  const fam = String(family || '').replace(/"/g, '');
  if (!fam) return;
  await Promise.all(weights.map((w) => document.fonts.load(`${w} 16px "${fam}"`).catch(() => null)));
}

export function basename(p) {
  if (!p) return '';
  const trimmed = p.replace(/[\\/]+$/, '');
  if (/^[a-zA-Z]:$/.test(trimmed)) return `${trimmed}\\`;
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function fileUrlToPath(url) {
  const m = /^file:\/\/[^/]*(\/.*)$/i.exec(url.trim());
  if (!m) return null;
  let p = m[1];
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
  if (msys) return `${msys[1].toUpperCase()}:${(msys[2] || '\\').replace(/\//g, '\\')}`;
  const win = /^\/([a-zA-Z]:.*)$/.exec(p);
  if (win) return win[1].replace(/\//g, '\\');
  return null;
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
