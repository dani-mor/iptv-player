// Channel name parsing. Pure functions (no DOM), so they're unit tested in test/.
//
// Providers name channels like "|ES| DAZN LALIGA FHD", "ES: M+ LaLiga TV HD" or
// "DAZN 1 ᶠᴴᴰ". We show a clean title with the quality as a badge, and group the
// FHD / HD / SD copies of one channel as "versions" of it.

// Lower-case, accents removed: "Película" and "pelicula" compare equal.
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// "|ES| ", "[ES] ", "ES| ", "ES: ", "ESP - ". Two letters for ":" so "BBC: News" stays intact.
const PREFIX = /^\s*(?:\|[^|]{1,8}\|\s*|\[[^\]]{1,8}\]\s*|[A-Z]{2}\s*[|:]\s*|[A-Z]{3}\s*\|\s*|[A-Z]{2,3}\s+-\s+)/;

// Checked in order: 4K before FHD before HD, since "ᶠᴴᴰ" contains "ᴴᴰ".
const QUALITIES = [
  ['4K', /\b(?:4K|UHD|2160P?)\b|ᵁᴴᴰ|⁴ᴷ/gi],
  ['FHD', /\b(?:FHD|FULL\s?HD|1080[PI]?)\b|ᶠᴴᴰ/gi],
  ['HD', /\b(?:HD|720P?)\b|ᴴᴰ/gi],
  ['SD', /\b(?:SD|480P?|576P?)\b|ˢᴰ/gi],
];
const EXTRAS = [
  ['HEVC', /\b(?:HEVC|H\.?265|X265)\b/gi],
  ['50fps', /\b50\s?FPS\b/gi],
  ['60fps', /\b60\s?FPS\b/gi],
];
const QUALITY_RANK = { '4K': 0, FHD: 1, HD: 2, '': 3, SD: 4 };

const parsed = new Map();

// "|ES| DAZN LALIGA FHD" -> { title: "DAZN LALIGA", quality: "FHD", tags: ["FHD"] }
export function parseChannelName(name) {
  const raw = String(name || '');
  const hit = parsed.get(raw);
  if (hit) return hit;
  let title = raw.replace(PREFIX, '');
  let quality = '';
  for (const [label, re] of QUALITIES) {
    if (!quality && re.test(title)) quality = label;
    re.lastIndex = 0;
    title = title.replace(re, ' ');
  }
  const tags = quality ? [quality] : [];
  for (const [label, re] of EXTRAS) {
    if (re.test(title)) tags.push(label);
    re.lastIndex = 0;
    title = title.replace(re, ' ');
  }
  title = title
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|:\-–·]+|[\s|:\-–·]+$/g, '')
    .trim();
  const result = { title: title || raw.trim(), quality, tags };
  if (parsed.size > 50000) parsed.clear();
  parsed.set(raw, result);
  return result;
}

// Channels with the same key are copies of one channel in different qualities.
const keys = new Map();
export function versionKey(name) {
  const raw = String(name || '');
  let key = keys.get(raw);
  if (key === undefined) {
    key = fold(parseChannelName(raw).title)
      .replace(/\b(?:backup|bkp|alt|op(?:cion|tion)?\s?\d)\b/g, ' ')
      .replace(/[^a-z0-9+]+/g, ' ')
      .trim();
    if (keys.size > 50000) keys.clear();
    keys.set(raw, key);
  }
  return key;
}

export const qualityRank = (name) => QUALITY_RANK[parseChannelName(name).quality] ?? 3;

// Accent- and case-insensitive substring match against the raw provider name.
const foldedNames = new WeakMap();
export function matchesQuery(item, foldedQuery) {
  if (!foldedQuery) return true;
  let f = foldedNames.get(item);
  if (f === undefined) {
    f = fold(item.name);
    foldedNames.set(item, f);
  }
  return f.includes(foldedQuery);
}

// Short labels for a set of versions: "FHD", "HD", "SD", "FHD 2" when two share a quality.
export function versionLabels(items) {
  const counts = {};
  return items.map((it) => {
    const { tags } = parseChannelName(it.name);
    const base = tags.join(' ') || 'Standard';
    counts[base] = (counts[base] || 0) + 1;
    return counts[base] > 1 ? `${base} ${counts[base]}` : base;
  });
}
