// HLS playlist rewriting: the browser can't attach the provider's required User-Agent,
// so every segment / variant / key URI is routed back through our proxy.

const proxiedMediaUrl = (absoluteUrl, ua) => `/proxy/media?url=${encodeURIComponent(absoluteUrl)}&ua=${encodeURIComponent(ua)}`;
const isPlaylistUrl = (url) => /\.m3u8(\?|$)/i.test(url);

function rewritePlaylist(text, baseUrl, ua) {
  const proxied = (absoluteUrl) => proxiedMediaUrl(absoluteUrl, ua);

  const lines = text.split(/\r?\n/).map((line) => {
    if (line.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (match, uri) => {
        try {
          const abs = new URL(uri, baseUrl).toString();
          return `URI="${proxied(abs)}"`;
        } catch {
          return match;
        }
      });
    }
    const trimmed = line.trim();
    if (!trimmed) return line;
    try {
      const abs = new URL(trimmed, baseUrl).toString();
      return proxied(abs);
    } catch {
      return line;
    }
  });
  return lines.join('\n');
}

module.exports = { proxiedMediaUrl, isPlaylistUrl, rewritePlaylist };
