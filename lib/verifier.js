/**
 * verifier.js — Stream URL verification module
 *
 * Validates that a given URL points to a playable video stream, rejecting
 * subtitle tracks (WebVTT/SRT), HTML/JS/json responses, and non-media content.
 *
 * Ported from the proxy project's verifyUrl + isStreamLike logic.
 * Runs as a lightweight pre-filter before presenting streams to Stremio.
 *
 * Usage:
 *   const { verifyUrl, isStreamLike, filterStreams } = require('./verifier');
 *
 *   const result = await verifyUrl('https://example.com/stream.m3u8', 'https://example.com');
 *   if (result.ok) { ... }  // playable
 *
 *   const playable = await filterStreams(urls, referer);  // returns only playable URLs
 */

const axios = require('axios');
const zlib  = require('zlib');

// ── Stream detection helpers ──────────────────────────────────────────────────

const VIDEO_CT = [
  'video/mp4', 'video/webm', 'video/ogg',
  'application/vnd.apple.mpegurl', 'application/x-mpegurl',
  'application/dash+xml', 'video/mp2t'
];

const EXCLUDED_EXTS = [
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg',
  '.woff', '.woff2', '.ttf', '.map', '.html', '.htm', '.vtt', '.srt'
];

const STREAM_EXTS = ['.m3u8', '.mpd', '.mp4', '.webm', '.ts', '.mkv', '.flv'];
const STREAM_KEYS = [
  'pass_md5', '/stream', '/video', '/media', '/play', '/hls', '/file',
  '/playlist.m3u8', '/get_video', '?file=', '&stream=', '?video='
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ── isStreamLike ──────────────────────────────────────────────────────────────

/**
 * Heuristic check: does the URL look like a potential video stream?
 * Filters out static assets, images, fonts, subtitle files.
 */
function isStreamLike(url) {
  const u = url.toLowerCase();
  const pathPart = u.split('?')[0].split('#')[0];

  // Reject excluded extensions
  if (EXCLUDED_EXTS.some(ext => pathPart.endsWith(ext))) {
    return false;
  }

  // Secondary: reject .vtt/.srt anywhere in the path
  // (catches /stream/thumbnails/track.vtt?token=...)
  if (pathPart.includes('.vtt') || pathPart.includes('.srt')) {
    return false;
  }

  return STREAM_EXTS.some(e => u.includes(e)) ||
         STREAM_KEYS.some(k => u.includes(k));
}

// ── Guess stream type ─────────────────────────────────────────────────────────

function guessType(url, ct) {
  const u = (url || '').toLowerCase();
  const c = (ct || '').toLowerCase();
  if (c.includes('mpegurl') || u.includes('.m3u8')) return 'HLS';
  if (c.includes('dash')    || u.includes('.mpd'))  return 'DASH';
  if (c.includes('mp4')     || u.includes('.mp4'))  return 'MP4';
  if (c.includes('webm')    || u.includes('.webm')) return 'WEBM';
  if (c.includes('mp2t')    || u.includes('.ts'))   return 'MPEG-TS';
  return 'stream';
}

// ── Text detection ────────────────────────────────────────────────────────────

/**
 * Check if a buffer looks like text (high ASCII density).
 * Returns true if >90% of bytes in the first 512 are printable ASCII.
 */
function isTextBuffer(buf) {
  const limit = Math.min(buf.length, 512);
  let textChars = 0;
  for (let i = 0; i < limit; i++) {
    const byte = buf[i];
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      textChars++;
    } else if (byte < 7 || (byte > 14 && byte < 32)) {
      return false; // control character (not tab/newline/CR)
    }
  }
  return (textChars / limit) > 0.9;
}

// ── verifyUrl ─────────────────────────────────────────────────────────────────

/**
 * Verify a URL by making a Range request and inspecting the response.
 *
 * @param {string} url       - The stream URL to verify
 * @param {string} referer   - Referer header to send (default: origin of url)
 * @param {object} [opts]    - Optional overrides
 * @param {number} [opts.timeout=12000] - Request timeout in ms
 * @returns {Promise<{ok: boolean, status?: number, contentType?: string,
 *           contentLength?: number, type?: string, error?: string}>}
 */
async function verifyUrl(url, referer, opts = {}) {
  const timeout = opts.timeout || 12000;

  // ── Path-based rejection ──────────────────────────────────────────────
  let pathname = '';
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch (_) {
    pathname = url.toLowerCase().split('?')[0].split('#')[0];
  }
  const cleanPath = pathname.split('#')[0];

  if (cleanPath.endsWith('.vtt') || cleanPath.endsWith('.srt') ||
      cleanPath.includes('.vtt') || cleanPath.includes('.srt')) {
    return { ok: false, error: 'Forbidden path: WebVTT/SRT' };
  }

  // ── Make Range request ─────────────────────────────────────────────────
  let r;
  try {
    let refererUrl = referer;
    if (!refererUrl) {
      try { refererUrl = new URL(url).origin; } catch (_) { refererUrl = url; }
    }

    const headers = {
      'User-Agent': UA,
      'Referer':    refererUrl,
    };

    const isPlaylist = url.toLowerCase().includes('.m3u8') ||
                       url.toLowerCase().includes('.mpd');

    if (!isPlaylist) {
      headers['Range'] = 'bytes=0-8191';
    }

    r = await axios.get(url, {
      responseType: 'stream',
      timeout,
      headers,
      validateStatus: () => true,
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const isSuccess = r.status === 200 || r.status === 206;
  if (!isSuccess) {
    if (r && r.data) { try { r.data.destroy(); } catch (_) {} }
    return { ok: false, status: r.status, error: `HTTP ${r.status}` };
  }

  const h = r.headers;
  const contentType = (h['content-type'] || '').split(';')[0].trim().toLowerCase();

  // ── Content-type rejection ────────────────────────────────────────────
  if (contentType.includes('vtt') || contentType.includes('subtitle') || contentType.includes('subtitles')) {
    if (r && r.data) { try { r.data.destroy(); } catch (_) {} }
    return { ok: false, status: r.status, contentType, error: 'Forbidden content type: Subtitles' };
  }

  const forbiddenTypes = [
    'application/javascript', 'application/x-javascript', 'text/javascript',
    'text/html', 'text/css', 'application/json',
  ];
  const isForbidden = forbiddenTypes.includes(contentType) || contentType.startsWith('image/');
  if (isForbidden) {
    if (r && r.data) { try { r.data.destroy(); } catch (_) {} }
    return { ok: false, status: r.status, contentType, error: 'Forbidden content type' };
  }

  // ── Decompress and read first chunk ────────────────────────────────────
  const contentEncoding = (h['content-encoding'] || '').trim().toLowerCase();
  let stream = r.data;
  if (contentEncoding === 'gzip') {
    stream = r.data.pipe(zlib.createGunzip());
  } else if (contentEncoding === 'deflate') {
    stream = r.data.pipe(zlib.createInflate());
  } else if (contentEncoding === 'br') {
    stream = r.data.pipe(zlib.createBrotliDecompress());
  }

  const isPlaylist = url.toLowerCase().includes('.m3u8') || url.toLowerCase().includes('.mpd');
  const readLimit = isPlaylist ? 65536 : 8192;

  const firstChunk = await new Promise((resolve) => {
    let resolved = false;
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      if (!resolved) {
        try { r.data.destroy(); } catch (_) {}
        try { stream.destroy(); } catch (_) {}
        resolved = true;
        resolve(buffer);
      }
    }, 5000);

    stream.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= readLimit) {
        clearTimeout(timer);
        try { r.data.destroy(); } catch (_) {}
        try { stream.destroy(); } catch (_) {}
        resolved = true;
        resolve(buffer);
      }
    });
    stream.on('end', () => {
      if (!resolved) { clearTimeout(timer); resolved = true; resolve(buffer); }
    });
    stream.on('error', () => {
      if (!resolved) { clearTimeout(timer); resolved = true; resolve(buffer); }
    });
  });

  try { r.data.destroy(); } catch (_) {}
  try { stream.destroy(); } catch (_) {}

  if (firstChunk.length === 0) {
    return { ok: false, status: r.status, contentType, error: 'Empty response body' };
  }

  // ── Decode body ───────────────────────────────────────────────────────
  let bodyString;
  if (firstChunk[0] === 0xFF && firstChunk[1] === 0xFE) {
    bodyString = firstChunk.toString('utf16le');
  } else if (firstChunk[0] === 0xFE && firstChunk[1] === 0xFF) {
    const swapped = Buffer.from(firstChunk);
    for (let i = 0; i < swapped.length - 1; i += 2) {
      const tmp = swapped[i]; swapped[i] = swapped[i+1]; swapped[i+1] = tmp;
    }
    bodyString = swapped.toString('utf16le');
  } else {
    bodyString = firstChunk.toString('utf8');
  }

  // ── WEBVTT signature check ────────────────────────────────────────────
  if (bodyString.includes('WEBVTT') || bodyString.includes('\ufeffWEBVTT')) {
    return { ok: false, status: r.status, contentType, error: 'Forbidden content: WebVTT signature detected' };
  }

  const trimmedBody = bodyString.trim();
  const lowerBody = trimmedBody.toLowerCase();

  // ── HTML/XML rejection ────────────────────────────────────────────────
  const isHtmlOrXml =
    lowerBody.startsWith('<!doctype html') ||
    lowerBody.includes('<html') ||
    lowerBody.includes('<head') ||
    lowerBody.includes('<body') ||
    lowerBody.startsWith('<?xml') ||
    lowerBody.includes('<rss') ||
    (lowerBody.includes('<mpd') && lowerBody.includes('<html'));

  if (isHtmlOrXml) {
    return { ok: false, status: r.status, contentType, error: 'Forbidden content: HTML or XML document detected' };
  }

  // ── JSON rejection ────────────────────────────────────────────────────
  if (lowerBody.startsWith('{"') || lowerBody.startsWith('[')) {
    return { ok: false, status: r.status, contentType, error: 'Forbidden content: JSON detected' };
  }

  // ── M3U8/DASH validation ──────────────────────────────────────────────
  const isM3u8 = url.toLowerCase().includes('.m3u8') ||
                 contentType.includes('mpegurl') || contentType.includes('x-mpegurl');
  const isDASH = url.toLowerCase().includes('.mpd') || contentType.includes('dash');

  if (isM3u8) {
    const hasM3u8Tags = bodyString.includes('#EXTM3U') && (
      bodyString.includes('#EXTINF') || bodyString.includes('#EXT-X-STREAM-INF')
    );
    if (!hasM3u8Tags) {
      return { ok: false, status: r.status, contentType, error: 'Invalid or empty M3U8 playlist contents' };
    }
  } else if (isDASH) {
    const hasDashTags = (bodyString.includes('<MPD') || bodyString.includes('urn:mpeg:dash:schema:mpd')) &&
                        bodyString.includes('<Period');
    if (!hasDashTags) {
      return { ok: false, status: r.status, contentType, error: 'Invalid DASH manifest contents' };
    }
  } else {
    // For non-playlist files, text content is a false positive
    const isText = isTextBuffer(firstChunk);
    if (isText) {
      return { ok: false, status: r.status, contentType, error: 'Forbidden content: Plain text or script detected for binary media' };
    }
  }

  // ── Success ───────────────────────────────────────────────────────────
  const cr = h['content-range'] || '';
  const totalMatch = cr.match(/\/(\d+)$/);

  return {
    ok:            true,
    status:        r.status,
    contentType:   h['content-type'] ? h['content-type'].split(';')[0].trim() : '',
    contentLength: h['content-length'] ? parseInt(h['content-length']) : null,
    totalBytes:    totalMatch ? parseInt(totalMatch[1]) : null,
    acceptRanges:  h['accept-ranges'],
    type:          guessType(url, contentType),
  };
}

// ── filterStreams ─────────────────────────────────────────────────────────────

/**
 * Filter an array of URLs, returning only verified playable ones.
 * Stops after finding the first N playable URLs (default: 3).
 *
 * @param {string[]} urls       - URLs to verify
 * @param {string}   referer    - Referer header
 * @param {object}   [opts]
 * @param {number}   [opts.maxResults=3] - Max playable results to return
 * @param {number}   [opts.timeout=12000]
 * @returns {Promise<{playable: Array, rejected: Array, all: Array}>}
 */
async function filterStreams(urls, referer, opts = {}) {
  const maxResults = opts.maxResults || 3;
  const results = [];

  for (const url of urls) {
    if (results.filter(r => r.ok).length >= maxResults) break;

    const verify = await verifyUrl(url, referer, opts);
    results.push({ url, ...verify });

    if (verify.ok) {
      console.log(`[Verifier] ✅ ${verify.type} — ${url.slice(0, 80)}`);
    } else {
      console.log(`[Verifier] ❌ ${verify.error} — ${url.slice(0, 80)}`);
    }
  }

  const playable = results.filter(r => r.ok);
  const rejected = results.filter(r => !r.ok);

  return { playable, rejected, all: results };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { verifyUrl, isStreamLike, filterStreams, guessType };
