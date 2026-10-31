// Title matching for the TV show artwork lookup.

const normTitle = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// Provider names look like "Payback (2023)", "|ES| Title", "ES - Title [4K]".
function cleanShowName(name) {
  return String(name || '')
    .replace(/^\s*(\|[^|]{1,6}\||[A-Z]{2,3}\s*[-:|]\s+)/, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\((19|20)\d{2}\)/g, '')
    .replace(/\b(4K|FHD|UHD|HD|MULTI|SUB|VOSE|DUAL)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickShow(results, name, year) {
  const want = normTitle(name);
  const scored = (results || []).map(({ score, show }) => {
    const showYear = show.premiered ? Number(show.premiered.slice(0, 4)) : null;
    const names = [show.name, ...((show._embedded && show._embedded.akas) || []).map((a) => a.name)].map(normTitle);
    const exact = names.includes(want);
    const yearOk = year && showYear ? Math.abs(showYear - year) <= 1 : null;
    return { show, score, exact, yearOk };
  });
  // Year agreement is the strongest signal; without a year, require an exact title.
  return (year && scored.find((s) => s.yearOk && (s.exact || s.score > 0.6)))
    || scored.find((s) => s.exact && s.yearOk !== false)
    || null;
}

module.exports = { normTitle, cleanShowName, pickShow };
