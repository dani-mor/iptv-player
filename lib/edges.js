// Movie and episode files 302 to a VOD edge, and starting or seeking one makes several
// range requests in a row. Going straight to the edge we were sent to last time saves that
// hop on each; if the edge stops answering (its link may expire), ask the original URL again.

const EDGE_TTL_MS = 5 * 60 * 1000;
const fileEdges = new Map(); // file URL -> { url, at }

// `fetchFile(url, options)` fetches the original URL (the server passes its retrying fetch).
async function fetchViaEdge(targetUrl, options, fetchFile = fetch) {
  const edge = fileEdges.get(targetUrl);
  if (edge && Date.now() - edge.at < EDGE_TTL_MS) {
    const r = await fetch(edge.url, options).catch((e) => {
      if (options.signal?.aborted) throw e;
      return null;
    });
    if (r && r.ok) return r;
    r?.body?.cancel().catch(() => {});
  }
  fileEdges.delete(targetUrl);
  const r = await fetchFile(targetUrl, options);
  if (r.ok && r.redirected) {
    for (const [k, v] of fileEdges) if (Date.now() - v.at >= EDGE_TTL_MS) fileEdges.delete(k);
    fileEdges.set(targetUrl, { url: r.url, at: Date.now() });
  }
  return r;
}

module.exports = { fetchViaEdge, EDGE_TTL_MS };
