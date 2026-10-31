// Small shared helpers: DOM, formatting, storage, icons, toast.

export const $ = (sel, root = document) => root.querySelector(sel);

const ICON_PATHS = {
  play: '<path d="M7.5 5.2v13.6a1 1 0 0 0 1.53.85l10.6-6.8a1 1 0 0 0 0-1.7L9.03 4.35A1 1 0 0 0 7.5 5.2z"/>',
  star: '<path d="M12 3.6l2.55 5.2 5.75.83-4.16 4.05.98 5.72L12 16.7l-5.12 2.7.98-5.72L3.7 9.63l5.75-.83z"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  rewind: '<path d="M11 7l-6 5 6 5zM19 7l-6 5 6 5z"/>',
  forward: '<path d="M13 7l6 5-6 5zM5 7l6 5-6 5z"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4h4"/>',
  pip: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  next: '<path d="M6 6.5l8.5 5.5L6 17.5z"/><path d="M18 6v12"/>',
  prev: '<path d="M18 6.5L9.5 12l8.5 5.5z"/><path d="M6 6v12"/>',
  speed: '<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 13.5l3.5-4"/>',
  check: '<path d="M5.5 12.5l4 4 9-9"/>',
  close: '<path d="M7 7l10 10M17 7L7 17"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8 20.5h8"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
  film: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7M6.3 7.6A16.5 16.5 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  swap: '<path d="M7 7h11l-3.5-3.5M17 17H6l3.5 3.5"/>',
  multiview: '<rect x="3" y="4.5" width="8" height="6.5" rx="1.5"/><rect x="13" y="4.5" width="8" height="6.5" rx="1.5"/><rect x="3" y="13" width="8" height="6.5" rx="1.5"/><rect x="13" y="13" width="8" height="6.5" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
};
export const icon = (name, filled = false) => `<svg viewBox="0 0 24 24" aria-hidden="true"${filled ? ' class="filled"' : ''}>${ICON_PATHS[name]}</svg>`;

export function qs(obj) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  return params.toString();
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtClock(secs) {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function fmtDuration(secs) {
  const mins = Math.round(secs / 60);
  if (mins < 1) return '<1 min';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Provider durations come as "01:52:10" strings and/or a duration_secs number.
export function parseDurationSecs(info) {
  if (!info) return 0;
  if (Number(info.duration_secs) > 0) return Number(info.duration_secs);
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(info.duration || '').trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

export function yearOf(str) {
  const m = /(19|20)\d{2}/.exec(String(str || ''));
  return m ? m[0] : '';
}

export function b64decode(str) {
  if (!str) return '';
  try {
    return decodeURIComponent(escape(window.atob(str)));
  } catch {
    return str;
  }
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// localStorage that never throws (private windows, full or blocked storage).
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not persisted */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
  // Plain strings (keys that predate JSON storage, e.g. the last tab).
  getRaw(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setRaw(key, value) {
    try { localStorage.setItem(key, value); } catch { /* not persisted */ }
  },
};

// Makes a clickable div reachable with Tab; Enter/Space are handled globally in main.js.
export function makeActivatable(node, label) {
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.dataset.activate = '';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

export function actionButton(label, iconName, onClick, primary = false) {
  const b = document.createElement('button');
  b.className = `action-btn${primary ? ' primary' : ''}`;
  b.innerHTML = `${iconName ? icon(iconName, iconName === 'play') : ''}<span>${escapeHtml(label)}</span>`;
  b.addEventListener('click', onClick);
  return b;
}

export function renderMetaLine(container, parts, rating) {
  const items = parts.filter(Boolean).map((p) => `<span>${escapeHtml(p)}</span>`);
  const r = Number(rating);
  if (r > 0) items.unshift(`<span class="star-rating">★ ${escapeHtml(r.toFixed(1))}</span>`);
  container.innerHTML = items.join('<span class="dot"></span>');
}

// Placeholder cards with a shimmer while a list loads.
export function skeletonCards(count, wide) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'card skeleton-card';
    card.innerHTML = `<div class="card-thumb skeleton ${wide ? 'aspect-wide' : 'aspect-poster'}"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div>`;
    frag.appendChild(card);
  }
  return frag;
}

let toastTimer = null;
export function toast(msg, action) {
  const box = $('#toast');
  const btn = $('#toast-action');
  $('#toast-msg').textContent = msg;
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { box.hidden = true; action.run(); };
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, (action && action.duration) || 4000);
}
