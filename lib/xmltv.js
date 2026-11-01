// XMLTV guide parsing without dependencies. The provider's xmltv.php can be tens of MB,
// so the parser takes the download chunk by chunk and keeps only what's asked for.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text) => text.replace(/&/g, '\u0000'))
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        try { return String.fromCodePoint(n); } catch { return m; }
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    // eslint-disable-next-line no-control-regex -- the CDATA placeholder from above
    .replace(/\u0000/g, '&')
    .trim();
}

// "20261101200000 +0100" -> epoch ms. Without an offset the time is UTC.
function parseXmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?:?(\d{2})?/.exec(String(s || '').trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, sec = '00', sign, oh = '00', om = '00'] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  if (!sign) return utc;
  const offset = (Number(oh) * 60 + Number(om)) * 60e3;
  return sign === '+' ? utc - offset : utc + offset;
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeXml(m[2] ?? m[3]) : '';
};
const element = (body, name) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(body);
  return m ? decodeXml(m[1]) : '';
};

// push(chunk) as the download arrives, then end() -> { channels, programmes, totalChannels, totalProgrammes }.
// keep(channelId) picks the channels to keep; programmes outside [from, to) are dropped.
function createXmltvParser({ keep = () => true, from = -Infinity, to = Infinity } = {}) {
  let buf = '';
  const channels = {}; // id -> display name
  const programmes = [];
  let totalChannels = 0;
  let totalProgrammes = 0;
  // Self-closing programmes come first, or the full form would swallow the next one.
  const BLOCK = /<channel\b([^>]*)>([\s\S]*?)<\/channel>|<programme\b([^>]*)\/>|<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;

  function scan(final) {
    BLOCK.lastIndex = 0;
    let m;
    let consumed = 0;
    while ((m = BLOCK.exec(buf))) {
      consumed = BLOCK.lastIndex;
      if (m[1] !== undefined) {
        totalChannels += 1;
        const id = attr(m[1], 'id');
        if (id && keep(id)) channels[id] = element(m[2], 'display-name');
        continue;
      }
      totalProgrammes += 1;
      const tag = m[3] ?? m[4];
      const channel = attr(tag, 'channel');
      if (!channel || !keep(channel)) continue;
      const start = parseXmltvTime(attr(tag, 'start'));
      const end = parseXmltvTime(attr(tag, 'stop'));
      if (!(end > from) || !(start < to)) continue;
      const title = element(m[5] || '', 'title');
      if (!title) continue; // nothing to search for or show
      programmes.push({ channel, start, end, title, desc: element(m[5], 'desc') });
    }
    // Keep only the unfinished tail; a long run without any block is junk between them.
    buf = consumed ? buf.slice(consumed) : (final ? '' : buf.slice(-1e6));
  }

  return {
    push(chunk) {
      buf += chunk;
      if (buf.length > 256 * 1024) scan(false);
    },
    end() {
      scan(true);
      return { channels, programmes, totalChannels, totalProgrammes };
    },
  };
}

function parseXmltv(text, options) {
  const p = createXmltvParser(options);
  p.push(String(text || ''));
  return p.end();
}

module.exports = { decodeXml, parseXmltvTime, createXmltvParser, parseXmltv };
